import type { AttackContext, DamageBreakdown } from '../../engine/types';
import type { MapBattleState, Unit } from '../battle/mapBattleState';
import type { AttackKey } from '../battle/playerTurn';

/**
 * Phase 6 — Policy interface.
 *
 * A `Policy` is the "who should attack whom, with what?" oracle the
 * MapPage predict panel consults. The shape is deliberately narrow and
 * stable so a future ML-trained policy (TF.js, trained on exported
 * battle traces) can be dropped in without touching the UI.
 *
 *   const suggestions = policy.suggest(activeUnit, battleState);
 *
 * The default reference implementation lives in `predict.ts`. Any
 * Policy implementation MUST:
 *  - be deterministic given identical inputs (battles are replayable);
 *  - never mutate the battle state (`suggest` may be called mid-turn);
 *  - return an array sorted by descending desirability (first = best).
 *
 * `Suggestion` is the canonical ranking row. ML-trained policies will
 * produce the same shape — only `score` and its ranking order change.
 */

export interface Suggestion {
  /** Attacker (the unit taking the action). */
  attackerId: string;
  /** Victim the attacker would hit. */
  targetId: string;
  /** The attack vocabulary key (melee / ranged / ability:<id>). */
  attackKey: AttackKey;
  /** Which underlying profile the key resolved to (for UI labels). */
  profileLabel: string;
  /** Expected damage this attack would inflict (engine `expected`). */
  expectedDamage: number;
  /**
   * Probability the victim dies on this action (sum of distribution
   * buckets whose `value >= victim.currentHp + victim.currentShield`).
   * Ranges [0, 1].
   */
  killChance: number;
  /**
   * Composite ranking score. Heuristic policy uses a killChance-weighted
   * expected-damage formula; ML policies may emit any scalar — higher
   * means "pick me". Scenario tests compare ordering by this field.
   */
  score: number;
  /** Optional full breakdown for UI tooltips. Omitted to keep lists small. */
  breakdown?: DamageBreakdown;
  /** Context used to run the attack — useful when the caller wants to
   *  re-simulate without reconstructing it. */
  ctx: AttackContext;
}

export interface Policy {
  id: string;
  displayName: string;
  suggest(active: Unit, battle: MapBattleState): Suggestion[];
}
