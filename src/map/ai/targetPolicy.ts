import { hexDistance } from '../core/hex';
import type { TargetPolicyId } from '../core/mapSchema';
import type { MapBattleState, Unit } from '../battle/mapBattleState';

/**
 * Phase 5 — deterministic target pickers shared by the scripted boss AI
 * and by the player-side `predict.ts` helper (Phase 6). Every picker is a
 * pure function of `(candidates, ctx)` so the scripted enemy turn can be
 * replayed identically across multiple runs, which the scenario test
 * relies on.
 *
 * The three shipped policies mirror the target-policy ids declared in
 * `mapSchema::TargetPolicyIdSchema`. Adding a new policy requires:
 *   1. a new entry in that enum,
 *   2. an exported policy object here,
 *   3. a branch in `getTargetPolicy` below.
 *
 * Tie-breaking is deterministic: policies fall back to the unit id
 * comparison when the primary metric ties, avoiding insertion-order or
 * Map-iteration sensitivity. Scenario tests pin one policy at a time and
 * rely on this.
 */

export interface TargetPolicyCtx {
  /** The unit that is ATTACKING (scripted boss, or the active player
   *  unit in predict mode). */
  attacker: Unit;
  battle: MapBattleState;
}

export interface TargetPolicy {
  id: TargetPolicyId;
  pick(candidates: Unit[], ctx: TargetPolicyCtx): Unit | null;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function byIdTieBreak(a: Unit, b: Unit): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function totalEffectiveHp(u: Unit): number {
  return Math.max(0, u.currentHp) + Math.max(0, u.currentShield);
}

/**
 * Alive filter — the battle layer is supposed to purge dead units but
 * defensive filters keep every policy safe when called speculatively
 * (predict mode) before the battle has advanced its bookkeeping.
 */
function alive(u: Unit): boolean {
  return u.currentHp > 0;
}

// ────────────────────────────────────────────────────────────────────
// Policies
// ────────────────────────────────────────────────────────────────────

export const WEAKEST: TargetPolicy = {
  id: 'weakest',
  pick(candidates) {
    const live = candidates.filter(alive);
    if (live.length === 0) return null;
    let best = live[0];
    let bestHp = totalEffectiveHp(best);
    for (const u of live.slice(1)) {
      const hp = totalEffectiveHp(u);
      if (hp < bestHp || (hp === bestHp && byIdTieBreak(u, best) < 0)) {
        best = u;
        bestHp = hp;
      }
    }
    return best;
  },
};

export const NEAREST: TargetPolicy = {
  id: 'nearest',
  pick(candidates, ctx) {
    const live = candidates.filter(alive);
    if (live.length === 0) return null;
    let best = live[0];
    let bestD = hexDistance(ctx.attacker.position, best.position);
    for (const u of live.slice(1)) {
      const d = hexDistance(ctx.attacker.position, u.position);
      if (d < bestD || (d === bestD && byIdTieBreak(u, best) < 0)) {
        best = u;
        bestD = d;
      }
    }
    return best;
  },
};

/**
 * Summons-first targeting with a weakest-HP fallback. Matches the
 * Avatar-of-Khaine behaviour from the reference YouTube fight: the boss
 * prefers to clear Biovore spore mines (player-side summons) before
 * engaging heroes, then picks the weakest remaining hero when no summon
 * is on the board.
 *
 * Implementation: partition candidates into {summons, others}. If any
 * summon is alive, run `WEAKEST.pick` over summons only. Else run
 * `WEAKEST.pick` over the remaining candidates.
 */
export const PREFER_SUMMONS_THEN_WEAKEST: TargetPolicy = {
  id: 'preferSummonsThenWeakest',
  pick(candidates, ctx) {
    const live = candidates.filter(alive);
    const summons = live.filter((u) => u.kind === 'summon');
    const pool = summons.length > 0 ? summons : live;
    return WEAKEST.pick(pool, ctx);
  },
};

// ────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────

const REGISTRY: Record<TargetPolicyId, TargetPolicy> = {
  weakest: WEAKEST,
  nearest: NEAREST,
  preferSummonsThenWeakest: PREFER_SUMMONS_THEN_WEAKEST,
};

export function getTargetPolicy(id: TargetPolicyId): TargetPolicy {
  return REGISTRY[id];
}
