import type { Hex } from '../core/hex';
import { hexBfs, hexEquals, hexKey } from '../core/hex';
import type { MapBattleState, Unit } from './mapBattleState';

/**
 * Phase 4 movement primitive. Converts a unit + battle state into the
 * set of hexes the unit can legally stand on this turn, respecting:
 *
 *   - Map boundary: hexes not in `map.hexes` are unreachable.
 *   - Occupancy:    a live unit (self-excluded) blocks its hex.
 *   - Terrain:      `blocksMove=true` blocks unless the moving unit
 *                   carries a trait listed in `blocksMoveUnlessTrait`.
 *   - Hex effects:  any live effect with modifier `kind:'blocksMove'`
 *                   blocks unless the unit carries a trait listed in
 *                   `exemptTraits` (e.g. Fire blocks everyone except
 *                   Flying). Expired effects are skipped.
 *
 * The unit's own starting hex is always reachable at distance 0 — it
 * represents "stay put" and is how the UI reconciles a no-op turn.
 *
 * MVP movement budget is a flat `DEFAULT_MOVEMENT` for every unit.
 * Per-catalog movement lives on the roadmap (risk #4 in the plan); when
 * the wiki importer surfaces a real stat, callers pass `budget` override.
 *
 * This module is pure — no mutation of `battle`, no engine imports.
 * That lets `playerTurn.ts` and the upcoming `bossAi.ts` share the same
 * legality checks with zero risk of hidden state drift.
 */
export const DEFAULT_MOVEMENT = 3;

export interface ReachableHex {
  hex: Hex;
  /** BFS distance from the unit's origin. 0 means "don't move". */
  distance: number;
}

/**
 * Return every hex the unit can end a turn on, ordered by BFS discovery
 * (origin first). When `budget` is omitted we fall back to
 * `DEFAULT_MOVEMENT`. Passing `budget: 0` yields only the origin — handy
 * for "do not move" flows without a branch at the call site.
 */
export function reachableHexes(
  unit: Unit,
  battle: MapBattleState,
  budget?: number,
): ReachableHex[] {
  const steps = budget ?? DEFAULT_MOVEMENT;
  return hexBfs(unit.position, steps, (h) => blockedForUnit(h, unit, battle));
}

/**
 * Convenience for the UI: is `to` a valid destination for `unit`'s
 * current turn? Staying put is always legal. Off-map, occupied, and
 * blocked-terrain destinations are not.
 */
export function isMoveLegal(
  unit: Unit,
  to: Hex,
  battle: MapBattleState,
  budget?: number,
): boolean {
  if (hexEquals(unit.position, to)) return true;
  const reach = reachableHexes(unit, battle, budget);
  return reach.some((r) => hexEquals(r.hex, to));
}

// ────────────────────────────────────────────────────────────────────
// Internals — the `blocked` predicate fed to `hexBfs`. Kept separate so
// that `bossAi.ts` can build its own predicates (e.g. ignoring friendly
// occupancy when evaluating kill-move targets) without duplicating the
// terrain/effect logic.
// ────────────────────────────────────────────────────────────────────

export function blockedForUnit(
  h: Hex,
  unit: Unit,
  battle: MapBattleState,
): boolean {
  const cell = battle.hexAt[hexKey(h)];
  if (!cell) return true; // off-map

  // Occupancy: any OTHER live unit blocks. We intentionally don't treat
  // same-side units as phaseable — the MVP is "one unit per hex, always".
  for (const other of Object.values(battle.units)) {
    if (other.id === unit.id) continue;
    if (hexEquals(other.position, h)) return true;
  }

  const unitTraits = unit.attacker.source.traits;

  const terrain = battle.terrainById[cell.terrain];
  if (terrain) {
    if (terrain.blocksMove && !hasAny(unitTraits, terrain.blocksMoveUnlessTrait)) {
      return true;
    }
  }

  const effects = battle.hexEffectsAt[hexKey(h)];
  if (effects && effects.length > 0) {
    for (const applied of effects) {
      if (battle.turnIdx > applied.expiresAtTurn) continue;
      const def = battle.hexEffectById[applied.effectId];
      if (!def) continue;
      if (def.modifier.kind !== 'blocksMove') continue;
      if (hasAny(unitTraits, def.modifier.exemptTraits)) continue;
      return true;
    }
  }

  return false;
}

function hasAny(traits: readonly string[], exempt: readonly string[]): boolean {
  if (exempt.length === 0) return false;
  for (const t of exempt) if (traits.includes(t)) return true;
  return false;
}
