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
    return ability.profiles.map<AttackContext>((profile) => ({
      profile,
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
 * Build an {@link Attacker} for a team slot. Priority:
 *  1. owned-hero memo — stars, rank, xpLevel, equipment from API sync
 *  2. fallback: the single-attacker BuildOverrides (so unowned heroes
 *     inherit whatever the player last configured). Equipment slots stay
 *     empty in this case to avoid copying the wrong-faction gear.
 */
function buildAttacker(
  char: CatalogCharacter,
  memo: UnitBuildMemo | undefined,
  fallback: BuildOverrides,
): Attacker {
  const progression = memo?.progression ?? fallback.progression;
  const rank = memo?.rank ?? fallback.rank;
  const xpLevel = memo?.xpLevel ?? fallback.xpLevel;
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
    abilityLevels: memo?.abilityLevels,
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
): TeamRotation | null {
  const teamMembers: TeamMember[] = [];
  const slotToMemberId: Record<string, string> = {};
  const slotToChar: Record<string, CatalogCharacter> = {};

  for (const m of members) {
    if (!m.characterId) continue;
    const char = getCharacter(m.characterId);
    if (!char) continue;
    const attacker = buildAttacker(char, unitBuilds[m.characterId], fallback);
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
  /** Raw engine output with per-member breakdowns, cumulative team damage,
   *  turns-to-kill, every applied team buff, and cooldown skips. */
  result: ReturnType<typeof resolveTeamRotation>;
  /** Human-friendly per-slot action context for the result panel — maps
   *  each TeamMember.id to the catalog character so the UI can show
   *  display names without re-fetching. */
  charById: Record<string, CatalogCharacter>;
}

export function useTeamDamage(): TeamDamageResultData | null {
  const team = useApp((s) => s.team);
  const target = useApp((s) => s.target);
  const unitBuilds = useApp((s) => s.unitBuilds);
  const build = useApp((s) => s.build);

  return useMemo(() => {
    const targetResolved = buildTargetResolved(target);
    if (!targetResolved) return null;
    const rotation = buildTeamRotation(
      team.members,
      team.turns,
      unitBuilds,
      build,
    );
    if (!rotation) return null;

    const charById: Record<string, CatalogCharacter> = {};
    for (const m of rotation.members) {
      charById[m.id] = m.attacker.source;
    }

    const result = resolveTeamRotation(rotation, targetResolved);
    return { rotation, target: targetResolved, result, charById };
  }, [team, target, unitBuilds, build]);
}
