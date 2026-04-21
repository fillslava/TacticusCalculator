import { clamp01 } from './crit';

/**
 * Per-hit block probability under the HDTW chain rule:
 * "The chain continues until either you fail a Block Chance roll or you
 * successfully Block all hits." Blocks chain exactly like crits —
 * P(n consecutive blocks) = blockChance^n.
 */
export function blockProbabilityAtHit(chance: number, hitIndex: number): number {
  return Math.pow(clamp01(chance), hitIndex);
}

export interface DamageBand {
  expected: number;
  min: number;
  max: number;
}

/**
 * Apply block reduction to an expected-value damage band.
 *
 * HDTW wiki: block subtracts a flat `blockDamage` amount from the hit,
 * floored at 0 ("Blocks are able to reduce damage dealt to 0"). No %
 * reduction, no cap, no min-damage floor.
 *
 * Range semantics: because block can fire on any hit when pBlock > 0, the
 * *floor* of possible damage is the blocked minimum (variance low minus
 * blockDamage, floored at 0). The *ceiling* is the unblocked max (block
 * never fires in the best case).
 */
export function applyBlockToBand(
  band: DamageBand,
  pBlock: number,
  blockDamage: number,
): DamageBand {
  if (pBlock <= 0 || blockDamage <= 0) return band;
  const reduce = (v: number) => Math.max(0, v - blockDamage);
  return {
    expected: band.expected * (1 - pBlock) + reduce(band.expected) * pBlock,
    // pBlock > 0 => block can fire => floor drops to the blocked variant
    min: reduce(band.min),
    // pBlock < 1 => block may not fire => ceiling stays at unblocked max
    max: pBlock >= 1 ? reduce(band.max) : band.max,
  };
}

/**
 * Blend two damage bands by a probability weight on band A.
 * Used to combine crit vs non-crit bands by pCrit.
 *
 * Range: min is reachable iff its parent band is reachable (pA=0 for B, pA=1
 * for A). max is reachable iff its parent band is reachable.
 */
export function blendBands(a: DamageBand, b: DamageBand, pA: number): DamageBand {
  const p = clamp01(pA);
  return {
    expected: a.expected * p + b.expected * (1 - p),
    min: p >= 1 ? a.min : b.min,
    max: p <= 0 ? b.max : a.max,
  };
}
