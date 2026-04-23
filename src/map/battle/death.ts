import type { MapBattleState, Unit } from './mapBattleState';

/**
 * Phase 5 — unit death handling.
 *
 * Dead units must be removed from the battle completely so:
 *   - `runEnemyTurn` does not fire ability targets against corpses,
 *   - `targetPolicy.pick` cannot select them,
 *   - the MapPage renderer stops drawing their sprite,
 *   - `battleState` book-keeping stays consistent with "live roster".
 *
 * The engine's `BattleState` keeps three structures that reference unit
 * ids: `membersInRotation`, `vitruviusMarkedSources`, and
 * `helbrechtCrusadeActiveUntil`. All three must be pruned when a unit
 * dies, otherwise a subsequent friendly turn could continue buffing from
 * a dead Helbrecht / dead Vitruvius and a dead player unit could still
 * satisfy Trajann's "carrier is on the board" check.
 *
 * This is deliberately a standalone helper instead of folded into
 * `playerTurn.ts` / `bossAi.ts` so both sides funnel through the same
 * cleanup path — and so death-based scenarios (e.g. the spore mine
 * getting 1-shot by Wrath of Khaine) can assert against a single API.
 */

export interface KillResult {
  /** Whether the unit was actually removed (false if it was already gone). */
  removed: boolean;
  /** The unit reference as it was right before removal, for event logs. */
  unit?: Unit;
}

export function killUnit(battle: MapBattleState, unitId: string): KillResult {
  const unit = battle.units[unitId];
  if (!unit) return { removed: false };

  // Primary removal.
  delete battle.units[unitId];

  // BattleState pruning. These structures are keyed/valued by memberId,
  // which we have aligned with `Unit.id` at hydration time — so the same
  // id works for both worlds.
  battle.battleState.membersInRotation.delete(unitId);
  battle.battleState.vitruviusMarkedSources.delete(unitId);
  if (unitId in battle.battleState.helbrechtCrusadeActiveUntil) {
    delete battle.battleState.helbrechtCrusadeActiveUntil[unitId];
  }

  return { removed: true, unit };
}

/**
 * Apply a pre-computed damage amount to a unit's shield/HP and return
 * whether the unit died. Kept here rather than inside `playerTurn.ts` so
 * both the scripted AI and the player orchestrator drain health through
 * one code path with identical clamping semantics.
 *
 * Shield is consumed first, then HP. Overflow damage that punches through
 * an empty shield continues into HP in the same call. Negative damage is
 * coerced to 0 (healing is out of scope for Phase 5).
 */
export function applyDamageToUnit(
  unit: Unit,
  amount: number,
): { shieldAfter: number; hpAfter: number; killed: boolean } {
  const dmg = Math.max(0, amount);
  const shieldAfter = Math.max(0, unit.currentShield - dmg);
  const bleedToHp = Math.max(0, dmg - unit.currentShield);
  const hpAfter = Math.max(0, unit.currentHp - bleedToHp);
  unit.currentShield = shieldAfter;
  unit.currentHp = hpAfter;
  return { shieldAfter, hpAfter, killed: hpAfter <= 0 };
}
