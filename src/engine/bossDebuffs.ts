import type { BossData } from '../data/schema';

export interface DebuffedStageStats {
  armor: number;
  hp: number;
  damage: number;
  critDamage: number;
}

/**
 * Apply a boss's prime-kill debuffs cumulatively. `primeLevels[i]` is the
 * number of times prime i has been killed (0 = no debuffs). Each kill tier
 * consumes one step from the prime's `steps` array; stat-affecting steps
 * reduce the corresponding stat, inert steps (ability-specific) are no-ops.
 *
 * Percent debuffs stack additively against the base stat (matches how the
 * game visually cumulates "−20% armor, −15% armor" to "−35% effective armor"
 * — if gameplay data shows otherwise we can switch to multiplicative here).
 */
export function applyPrimeDebuffs(
  base: { armor: number; hp: number; damage?: number; critDamage?: number },
  primes: BossData['primes'] | undefined,
  primeLevels: number[],
): DebuffedStageStats {
  const reductions = { armor: 0, hp: 0, damage: 0, critDamage: 0 };
  const flats = { armor: 0, hp: 0, damage: 0, critDamage: 0 };
  (primes ?? []).forEach((prime, i) => {
    const n = Math.min(primeLevels[i] ?? 0, prime.steps.length);
    for (let s = 0; s < n; s++) {
      const step = prime.steps[s];
      if (step.stat === null) continue;
      if (step.mode === 'pct') reductions[step.stat] += step.value;
      else flats[step.stat] += step.value;
    }
  });
  return {
    armor: Math.max(0, base.armor * (1 - reductions.armor) - flats.armor),
    hp: Math.max(0, base.hp * (1 - reductions.hp) - flats.hp),
    damage: Math.max(0, (base.damage ?? 0) * (1 - reductions.damage) - flats.damage),
    critDamage: Math.max(
      0,
      (base.critDamage ?? 0) * (1 - reductions.critDamage) - flats.critDamage,
    ),
  };
}
