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
  TargetState,
  TeamMemberOverride,
  TeamMemberState,
  UnitBuildMemo,
} from '../../state/store';
import { loadMapCatalog, type MapCatalog } from '../core/catalog';
import type { Hex } from '../core/hex';
import type { MapDef } from '../core/mapSchema';
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

  const bossUnit = buildBossUnit(target, bossSpawns[0]);
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
  const { teamMembers, unitBuilds, teamMemberOverrides, fallback } = inputs;
  const out: Unit[] = [];
  let spawnIdx = 0;
  for (const member of teamMembers) {
    if (!member.characterId) continue;
    if (spawnIdx >= playerSpawns.length) break;
    const char = getCharacter(member.characterId);
    if (!char) continue;
    const attacker = buildAttackerForSlot(
      char,
      unitBuilds[member.characterId],
      teamMemberOverrides[member.slotId],
      fallback,
    );
    const spawn = playerSpawns[spawnIdx++];
    const hp = Math.max(1, Math.round(char.baseStats.hp));
    out.push({
      id: member.slotId,
      side: 'player',
      kind: member.kind === 'mow' ? 'mow' : 'hero',
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

function buildBossUnit(target: TargetState, spawn: Hex): Unit | null {
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

  // Synthetic attacker. The boss doesn't attack in Phase 4 — `melee` is a
  // placeholder so the CatalogCharacter schema is satisfied. Phase 5's
  // `bossToAttacker` replaces this with a script-driven profile set.
  const placeholderMelee: AttackProfile = {
    label: 'Strike',
    damageType: 'power',
    hits: 1,
    kind: 'melee',
  };
  const char: CatalogCharacter = {
    id: boss?.id ?? 'target',
    displayName,
    faction: 'Neutral',
    alliance: 'chaos',
    baseStats: {
      damage: 0,
      armor,
      hp,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 1,
      rangedHits: 1,
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
  };
}

/** Re-export so MapPage only needs a single import path. */
export type { MapCatalog };
