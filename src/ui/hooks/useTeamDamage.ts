import { useMemo } from 'react';
import { useApp } from '../../state/store';
import {
  getBoss,
  getCharacter,
  getEquipment,
} from '../../data/catalog';
import { applyPrimeDebuffs } from '../../engine/bossDebuffs';
import {
  progressionToRarity,
  progressionToStarLevel,
} from '../../engine/progression';
import { resolveTeamRotation } from '../../engine/team';
import type {
  Attacker,
  AttackContext,
  CatalogBoss,
  CatalogCharacter,
  CatalogEquipmentSlot,
  ItemStatMods,
  Target,
  TeamAction,
  TeamMember,
  TeamRotation,
} from '../../engine/types';
import type {
  UnitBuildMemo,
  BuildOverrides,
  TeamMemberState,
  TeamMemberOverride,
  TeamTurnState,
  TargetState,
} from '../../state/store';

/**
 * Expand an `attackKey` (melee / ranged / ability:id) into atomic
 * AttackContexts. Identical logic to useDamage.attackContextsFor — a
 * multi-profile ability like Kharn's "Kill! Maim! Burn!" returns one
 * context per profile, each becoming its own TeamAction.
 */
function attackContextsFor(
  key: string,
  char: CatalogCharacter,
): AttackContext[] {
  if (key === 'melee' && char.melee)
    return [{ profile: char.melee, rngMode: 'expected' }];
  if (key === 'ranged' && char.ranged)
    return [{ profile: char.ranged, rngMode: 'expected' }];
  if (key.startsWith('ability:')) {
    const id = key.slice('ability:'.length);
    const ability = char.abilities.find((a) => a.id === id);
    if (!ability) return [];
    // Stamp `abilityProfileIdx` on multi-profile abilities so the engine's
    // applyBonusHits can enforce the wiki STMA rule (extra hits only on
    // the first profile to hit the target). Single-profile abilities are
    // left untagged (undefined ≡ 0 ≡ "first profile").
    const isMulti = ability.profiles.length > 1;
    return ability.profiles.map<AttackContext>((profile, idx) => ({
      profile: isMulti ? { ...profile, abilityProfileIdx: idx } : profile,
      rngMode: 'expected',
    }));
  }
  return [];
}

function customBoss(
  armor: number,
  hp: number,
  shield: number,
  traits: string[],
): CatalogBoss {
  return {
    id: 'custom',
    displayName: 'Custom',
    stages: [{ name: 'custom', armor, hp, shield, traits }],
  };
}

function extraStatsSlot(
  mods: ItemStatMods | undefined,
): CatalogEquipmentSlot | null {
  if (!mods) return null;
  const hasAny = Object.values(mods).some(
    (v) => typeof v === 'number' && v !== 0,
  );
  if (!hasAny) return null;
  return {
    slotId: 1,
    id: '__extra_stats__',
    rarity: 'legendary',
    level: 1,
    mods,
  };
}

/**
 * Build an {@link Attacker} for a team slot. Resolution order (each field
 * independently): `override` → `memo` → `fallback` (single-attacker build).
 *
 *  - `memo` is the API-sourced baseline — stars, rank, xpLevel, equipment
 *    synced from /player.
 *  - `override` is the Team-mode "training simulator" patch: per-slot
 *    what-if values the user can dial in to preview damage uplift without
 *    mutating the real build. Any fields the user didn't touch fall
 *    through to the memo.
 *  - `fallback` covers unowned heroes (no memo): progression/rank/xpLevel
 *    inherit whatever the player last configured in the single-attacker
 *    editor. Equipment slots stay empty for unowned heroes to avoid
 *    copying wrong-faction gear.
 *
 * Equipment is intentionally NOT overridable — it's a separate economy
 * axis (need specific-faction gear drops) and the training simulator
 * focuses on progression/skills, which cost training tokens instead.
 */
function buildAttacker(
  char: CatalogCharacter,
  memo: UnitBuildMemo | undefined,
  override: TeamMemberOverride | undefined,
  fallback: BuildOverrides,
): Attacker {
  const baseProgression = memo?.progression ?? fallback.progression;
  const baseRank = memo?.rank ?? fallback.rank;
  const baseXpLevel = memo?.xpLevel ?? fallback.xpLevel;
  const baseAbilityLevels = memo?.abilityLevels;

  const progression = override?.progression ?? baseProgression;
  const rank = override?.rank ?? baseRank;
  const xpLevel = override?.xpLevel ?? baseXpLevel;
  const abilityLevels = override?.abilityLevels ?? baseAbilityLevels;
  const equipmentIds = memo?.equipmentIds ?? [];

  const equipment: CatalogEquipmentSlot[] = equipmentIds
    .map((id) => (id ? getEquipment(id) : undefined))
    .filter((e): e is CatalogEquipmentSlot => Boolean(e));
  const extra = extraStatsSlot(memo?.extraStats);
  if (extra) equipment.push(extra);

  return {
    source: char,
    progression: {
      stars: progressionToStarLevel(progression),
      rank,
      xpLevel,
      rarity: progressionToRarity(progression),
    },
    equipment,
    abilityLevels,
  };
}

function buildTargetResolved(target: TargetState): Target | null {
  const boss = target.bossId
    ? getBoss(target.bossId)
    : customBoss(
        target.customArmor ?? 0,
        target.customHp ?? 100_000,
        target.customShield ?? 0,
        target.customTraits ?? [],
      );
  if (!boss) return null;
  const stageIdx = Math.min(
    target.stageIndex,
    Math.max(0, boss.stages.length - 1),
  );
  const stage = boss.stages[stageIdx];
  const primeLevels = [target.prime1Level ?? 0, target.prime2Level ?? 0];
  const hasAnyPrime = primeLevels.some((l) => l > 0);
  const debuffed = hasAnyPrime
    ? applyPrimeDebuffs(
        { armor: stage.armor, hp: stage.hp },
        boss.primes,
        primeLevels,
      )
    : null;
  return {
    source: boss,
    stageIndex: target.stageIndex,
    ...(debuffed
      ? { statOverrides: { armor: debuffed.armor, hp: debuffed.hp } }
      : {}),
  };
}

/**
 * Build the engine-shaped {@link TeamRotation} from the Zustand team state.
 * Returns `null` when there are no populated slots or no scheduled actions
 * (so the UI can render a "nothing to see yet" placeholder).
 *
 * Key orchestration:
 *  - Only slots with a valid catalog character become TeamMembers.
 *  - Actions referencing missing or empty slots are silently dropped.
 *  - Multi-profile abilities expand into multiple TeamActions sharing the
 *    same memberId; the engine processes them in order, which is correct
 *    for reactive buffs (Outrage ledger, active-fired flag, spore-mine).
 */
function buildTeamRotation(
  members: TeamMemberState[],
  turns: TeamTurnState[],
  unitBuilds: Record<string, UnitBuildMemo>,
  fallback: BuildOverrides,
  overrides: Record<string, TeamMemberOverride>,
): TeamRotation | null {
  const teamMembers: TeamMember[] = [];
  const slotToMemberId: Record<string, string> = {};
  const slotToChar: Record<string, CatalogCharacter> = {};

  for (const m of members) {
    if (!m.characterId) continue;
    const char = getCharacter(m.characterId);
    if (!char) continue;
    const attacker = buildAttacker(
      char,
      unitBuilds[m.characterId],
      overrides[m.slotId],
      fallback,
    );
    teamMembers.push({
      id: m.slotId,
      attacker,
      position: m.position,
    });
    slotToMemberId[m.slotId] = m.slotId;
    slotToChar[m.slotId] = char;
  }

  if (teamMembers.length === 0) return null;

  const engineTurns = turns.map((t) => {
    const actions: TeamAction[] = [];
    for (const a of t.actions) {
      const memberId = slotToMemberId[a.memberSlotId];
      const char = slotToChar[a.memberSlotId];
      if (!memberId || !char) continue;
      const ctxs = attackContextsFor(a.attackKey, char);
      for (const ctx of ctxs) {
        actions.push({ memberId, attack: ctx });
      }
    }
    return { actions };
  });

  const anyActions = engineTurns.some((t) => t.actions.length > 0);
  if (!anyActions) return null;

  return { members: teamMembers, turns: engineTurns };
}

export interface TeamDamageResultData {
  rotation: TeamRotation;
  target: Target;
  /** Raw engine output (with any training-simulator overrides applied) —
   *  per-member breakdowns, cumulative team damage, turns-to-kill, every
   *  applied team buff, and cooldown skips. */
  result: ReturnType<typeof resolveTeamRotation>;
  /**
   * Baseline run (WITHOUT training overrides) — same rotation + target,
   * but every slot uses pure API-sourced memo values. Populated only when
   * at least one slot has an active override; `null` otherwise.
   *
   * The UI diffs `result` against `baseline` to surface "+X damage from
   * training" both per-member and team-wide. If no slot has an override,
   * there's nothing to compare and we skip the second pass entirely (the
   * engine work isn't free — a 5-turn team rotation has many trigger re-
   * derivations; doing twice the work for every render is wasteful).
   */
  baseline: ReturnType<typeof resolveTeamRotation> | null;
  /** Human-friendly per-slot action context for the result panel — maps
   *  each TeamMember.id to the catalog character so the UI can show
   *  display names without re-fetching. */
  charById: Record<string, CatalogCharacter>;
}

/** True when at least one slot has any override field set. Gates the
 *  "run the rotation twice to compute training uplift" fast-path in
 *  {@link useTeamDamage}. */
function anyOverridesActive(
  overrides: Record<string, TeamMemberOverride>,
): boolean {
  for (const slotId of Object.keys(overrides)) {
    const ov = overrides[slotId];
    if (!ov) continue;
    if (ov.progression !== undefined) return true;
    if (ov.rank !== undefined) return true;
    if (ov.xpLevel !== undefined) return true;
    if (ov.abilityLevels !== undefined && ov.abilityLevels.length > 0) {
      return true;
    }
  }
  return false;
}

export function useTeamDamage(): TeamDamageResultData | null {
  const team = useApp((s) => s.team);
  const target = useApp((s) => s.target);
  const unitBuilds = useApp((s) => s.unitBuilds);
  const build = useApp((s) => s.build);
  const teamMemberOverrides = useApp((s) => s.teamMemberOverrides);

  return useMemo(() => {
    const targetResolved = buildTargetResolved(target);
    if (!targetResolved) return null;
    const rotation = buildTeamRotation(
      team.members,
      team.turns,
      unitBuilds,
      build,
      teamMemberOverrides,
    );
    if (!rotation) return null;

    const charById: Record<string, CatalogCharacter> = {};
    for (const m of rotation.members) {
      charById[m.id] = m.attacker.source;
    }

    const result = resolveTeamRotation(rotation, targetResolved);

    // Run a second pass without overrides ONLY when at least one slot is
    // actively trained — otherwise baseline == result and we'd waste
    // engine cycles doing the same work twice. The baseline rotation
    // reuses the exact same target + action sequence; the only thing that
    // differs is each member's Attacker (progression/rank/xpLevel/abilityLevels).
    let baseline: ReturnType<typeof resolveTeamRotation> | null = null;
    if (anyOverridesActive(teamMemberOverrides)) {
      const baselineRotation = buildTeamRotation(
        team.members,
        team.turns,
        unitBuilds,
        build,
        {}, // no overrides → pure baseline
      );
      if (baselineRotation) {
        baseline = resolveTeamRotation(baselineRotation, targetResolved);
      }
    }

    return { rotation, target: targetResolved, result, baseline, charById };
  }, [team, target, unitBuilds, build, teamMemberOverrides]);
}
