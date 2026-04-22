import { resolveAttack } from '../../engine/attack';
import {
  applyBonusHits,
  applyHitsDelta,
  applyPierceBuffs,
  applyTurnBuffs,
} from '../../engine/rotation';
import type { AttackContext, DamageBreakdown } from '../../engine/types';
import { deriveHexBuffs } from './hexBuffs';
import type { MapBattleState, Unit } from './mapBattleState';
import { unitToTarget } from './targetAdapter';

/**
 * Resolve a single incoming attack — symmetric with outgoing damage.
 *
 * Pipeline (mirrors the pipeline inside `resolveTeamRotation` so attack
 * math is identical regardless of direction):
 *   1. `deriveHexBuffs` — terrain & hex-effect modifiers become TurnBuffs
 *   2. `applyTurnBuffs` on the attacker
 *   3. `applyBonusHits` on the profile (STMA-gated)
 *   4. `applyHitsDelta` on the profile (ungated; tall grass -2)
 *   5. `applyPierceBuffs` on the profile (pierce deltas)
 *   6. `unitToTarget` converts the victim Unit into an engine Target
 *      (currentHp/currentShield + armor overrides from contamination etc.)
 *   7. `resolveAttack` produces the `DamageBreakdown`
 *
 * This function does NOT mutate the `MapBattleState` — no HP is drained,
 * no effects are ticked. That is the battle-orchestrator's job (Phase 4
 * for the player side, Phase 5 for the enemy side). Keeping this pure
 * lets the AI layer call `resolveIncomingAttack` speculatively (predict
 * mode) without side effects.
 *
 * MVP scope: no "first turn" semantics (single-turn map mode treats
 * every attack as mid-rotation). If a later phase needs first-turn
 * bonusHits triggers, the caller can stamp an explicit `isFirstTurn`
 * param — today the constant `false` is deliberate.
 */
export function resolveIncomingAttack(
  attacker: Unit,
  victim: Unit,
  ctx: AttackContext,
  battle: MapBattleState,
): DamageBreakdown {
  const hexBuffs = deriveHexBuffs(attacker, victim, battle, ctx.profile);
  const buffedAttacker = applyTurnBuffs(attacker.attacker, hexBuffs);

  const withBonusHits = applyBonusHits(ctx.profile, hexBuffs, /*isFirstTurn*/ false);
  const withHitsDelta = applyHitsDelta(withBonusHits, hexBuffs, false);
  const withPierce = applyPierceBuffs(withHitsDelta, hexBuffs);
  const adjustedCtx: AttackContext = { ...ctx, profile: withPierce };

  const victimTarget = unitToTarget(victim, battle);
  return resolveAttack(buffedAttacker, victimTarget, adjustedCtx);
}
