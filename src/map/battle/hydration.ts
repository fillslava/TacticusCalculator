import { getBoss, getCharacter, getEquipment } from '../../data/catalog';
import {
  progressionToRarity,
  progressionToStarLevel,
} from '../../engine/progression';
import type {
  Attacker,
  AttackProfile,
  CatalogCharacter,
  CatalogEquipmentSlot,
} from '../../engine/types';
import type {
  BuildOverrides,
  MapTeamSlot,
  TargetState,
  TeamMemberOverride,
  TeamMemberState,
  UnitBuildMemo,
} from '../../state/store';
import { loadMapCatalog, type MapCatalog } from '../core/catalog';
import { hexKey, type Hex } from '../core/hex';
import type { BossScript, MapDef } from '../core/mapSchema';
import { initMapBattle, type MapBattleState, type Unit } from './mapBattleState';

/**
 * Phase 4 — "Start battle" hydration.
 *
 * Converts the user's current team roster + target selection into a
 * concrete {@link MapBattleState} suitable for the MapPage interactive
 * flow. Intentionally narrow:
 *
 *   - Player units are drawn from the Guild-Raid team roster (the same
 *     state TeamPage edits). Empty slots are skipped so a half-built team
 *     still hydrates. We place them on hexes tagged `spawn: 'player'` in
 *     the map definition, filling in stable member-slot order.
 *   - The enemy side is a single synthetic boss unit derived from the
 *     target-editor state. For Phase 4 the boss never ATTACKS — we only
 *     need its stats + traits for `targetAdapter`/`deriveHexBuffs` to
 *     work. `bossToAttacker` (Phase 5) will give it real attack profiles.
 *   - No summons, no hex effects pre-applied — those are Phase 5/content
 *     concerns. `initMapBattle` seeds an empty `hexEffectsAt` map.
 *
 * Returns `null` when the inputs are insufficient (no populated team
 * slots, no target, or the map has no spawn points). The UI surfaces
 * these as disabled "Start battle" states rather than opaque errors.
 */

export interface HydrationInputs {
  map: MapDef;
  teamMembers: TeamMemberState[];
  unitBuilds: Record<string, UnitBuildMemo>;
  teamMemberOverrides: Record<string, TeamMemberOverride>;
  fallback: BuildOverrides;
  target: TargetState;
  /**
   * Per-map roster override. When provided, each spawn hex is looked
   * up by its `hexKey` and, if a `characterId` is pinned, that
   * character is placed on that hex using the regular `unitBuilds`
   * baseline. Hexes without an entry (or with `characterId: null`)
   * fall back to sequential-fill from `teamMembers`.
   *
   * Omitting the override entirely preserves the Phase-4 default: a
   * straight zip of `teamMembers` → `playerSpawns` in array order.
   */
  mapTeamOverride?: MapTeamSlot[];
}

export function buildMapBattleFromTeam(
  inputs: HydrationInputs,
): MapBattleState | null {
  const { map, target } = inputs;
  const catalog = loadMapCatalog();

  const playerSpawns = map.hexes.filter((c) => c.spawn === 'player');
  const bossSpawns = map.hexes
    .filter((c) => c.spawn === 'boss')
    .concat(map.hexes.filter((c) => c.spawn === 'enemy'));
  if (playerSpawns.length === 0 || bossSpawns.length === 0) return null;

  const playerUnits = buildPlayerUnits(inputs, playerSpawns);
  if (playerUnits.length === 0) return null;

  const script = map.bossScriptId
    ? catalog.bossScriptById[map.bossScriptId]
    : undefined;
  const bossUnit = buildBossUnit(target, bossSpawns[0], script);
  if (!bossUnit) return null;

  return initMapBattle({
    map,
    terrain: catalog.terrain,
    hexEffects: catalog.hexEffects,
    playerUnits,
    enemyUnits: [bossUnit],
  });
}

// ────────────────────────────────────────────────────────────────────
// Player-side: team roster → Units
// ────────────────────────────────────────────────────────────────────

function buildPlayerUnits(
  inputs: HydrationInputs,
  playerSpawns: Array<{ q: number; r: number }>,
): Unit[] {
  const {
    teamMembers,
    unitBuilds,
    teamMemberOverrides,
    fallback,
    mapTeamOverride,
  } = inputs;

  // Map the override array → hexKey lookup for O(1) resolution per spawn.
  // Entries with `characterId: null` explicitly fall through to the team-tab
  // roster, so we only index non-null ones.
  const pinnedByHex = new Map<string, string>();
  if (mapTeamOverride) {
    for (const slot of mapTeamOverride) {
      if (slot.characterId) pinnedByHex.set(slot.spawnHexKey, slot.characterId);
    }
  }

  // Characters that are "already placed" via an override shouldn't also get
  // picked up by the sequential-fill walk — otherwise a user who pins a
  // character to slot 3 would see them appear twice (once at slot 3, once
  // at whatever slot 1's sequential fill lands on).
  const pinnedIds = new Set(pinnedByHex.values());

  // Index team members that aren't pinned — these feed the sequential
  // fallback. Skip empty slots and any member whose character is already
  // pinned somewhere on the board.
  const fallbackQueue = teamMembers.filter(
    (m) => m.characterId && !pinnedIds.has(m.characterId),
  );
  let fallbackIdx = 0;

  const out: Unit[] = [];
  for (const spawn of playerSpawns) {
    const pinnedId = pinnedByHex.get(hexKey({ q: spawn.q, r: spawn.r }));
    let chosenCharId: string | null = null;
    let chosenSlotId: string;
    let chosenKind: TeamMemberState['kind'] = 'hero';

    if (pinnedId) {
      chosenCharId = pinnedId;
      // Synthetic slotId so the Unit id is stable and unique per hex.
      // The Team-tab overrides (teamMemberOverrides) don't apply to
      // pinned characters — the picker intentionally carries only
      // "which character", not their sim knobs.
      chosenSlotId = `map:${hexKey({ q: spawn.q, r: spawn.r })}`;
      chosenKind = 'hero';
    } else {
      // Sequential fallback: pull the next unpinned team member.
      const member = fallbackQueue[fallbackIdx++];
      if (!member || !member.characterId) continue;
      chosenCharId = member.characterId;
      chosenSlotId = member.slotId;
      chosenKind = member.kind;
    }

    const char = getCharacter(chosenCharId);
    if (!char) continue;
    const attacker = buildAttackerForSlot(
      char,
      unitBuilds[chosenCharId],
      teamMemberOverrides[chosenSlotId],
      fallback,
    );
    const hp = Math.max(1, Math.round(char.baseStats.hp));
    out.push({
      id: chosenSlotId,
      side: 'player',
      kind: chosenKind === 'mow' ? 'mow' : 'hero',
      position: { q: spawn.q, r: spawn.r },
      attacker,
      maxHp: hp,
      maxShield: 0,
      currentHp: hp,
      currentShield: 0,
      statusEffects: [],
    });
  }
  return out;
}

/**
 * Mirrors `useTeamDamage.buildAttacker` — kept as a parallel impl here so
 * the map layer doesn't import a UI hook. Resolution order stays
 * identical: override > memo > fallback.
 *
 * Extracted now so Phase 5's incoming-damage path can reuse the same
 * resolution logic without the React hook dependency.
 */
function buildAttackerForSlot(
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

// ────────────────────────────────────────────────────────────────────
// Enemy-side: synthetic boss Unit from TargetState
// ────────────────────────────────────────────────────────────────────

function buildBossUnit(
  target: TargetState,
  spawn: Hex,
  script?: BossScript,
): Unit | null {
  const boss = target.bossId ? getBoss(target.bossId) : null;
  const stageIdx = boss
    ? Math.min(target.stageIndex, Math.max(0, boss.stages.length - 1))
    : 0;
  const stage = boss?.stages[stageIdx];
  const displayName = boss?.displayName ?? 'Target';
  const traits = stage?.traits ?? target.customTraits ?? [];
  const hp = Math.max(
    1,
    stage?.hp ?? target.customHp ?? 100_000,
  );
  const shield = Math.max(0, stage?.shield ?? target.customShield ?? 0);
  const armor = Math.max(0, stage?.armor ?? target.customArmor ?? 0);

  // Script-provided stats flow straight into the synthetic
  // CatalogCharacter's baseStats. Without a script the boss has 0 damage
  // (Phase 4 behaviour, preserved so the stub map + generic target path
  // doesn't start landing real hits). A script's `stats` block lets the
  // hydration layer say "this fight's boss hits for 30k base" without
  // every downstream system needing to know about map mode.
  const scriptStats = script?.stats;
  const damage = Math.max(0, scriptStats?.damage ?? 0);
  const critChance = Math.max(0, scriptStats?.critChance ?? 0);
  const critDamage = Math.max(0, scriptStats?.critDamage ?? 0);
  const meleeHits = Math.max(1, scriptStats?.meleeHits ?? 1);
  const rangedHits = Math.max(1, scriptStats?.rangedHits ?? 1);

  // Synthetic attacker. `melee` is the generic normal attack — used when
  // the script step is `{ kind: 'normal' }`. Ability profiles ride in the
  // script itself (keyed by `abilityId`) and are resolved per-turn by
  // `bossAi.ts`, so we don't have to mirror them here.
  const placeholderMelee: AttackProfile = {
    label: 'Strike',
    damageType: 'power',
    hits: meleeHits,
    kind: 'melee',
  };
  const char: CatalogCharacter = {
    id: boss?.id ?? 'target',
    displayName,
    faction: 'Neutral',
    alliance: 'chaos',
    baseStats: {
      damage,
      armor,
      hp,
      critChance,
      critDamage,
      blockChance: 0,
      blockDamage: 0,
      meleeHits,
      rangedHits,
    },
    melee: placeholderMelee,
    abilities: [],
    traits,
    maxRarity: 'legendary',
  };

  return {
    id: 'boss',
    side: 'enemy',
    kind: 'boss',
    position: { q: spawn.q, r: spawn.r },
    attacker: {
      source: char,
      progression: { stars: 0, rank: 0, xpLevel: 1, rarity: 'legendary' },
      equipment: [],
    },
    maxHp: hp,
    maxShield: shield,
    currentHp: hp,
    currentShield: shield,
    statusEffects: [],
    ...(script ? { scriptPointer: { scriptId: script.id, turnIdx: 0 } } : {}),
  };
}

/** Re-export so MapPage only needs a single import path. */
export type { MapCatalog };
