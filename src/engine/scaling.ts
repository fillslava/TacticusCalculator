import type { BaseStats, ItemStatMods, Rarity } from './types';
import { RARITY_ORDER } from './types';

/**
 * Per-rank stat multipliers, derived from tacticustable.com's rank comparator
 * at 1★ (divided by 1.1 to back out the star factor). Index = rank (0 = Stone I,
 * 19 = Adamantine II). Applies to HP, damage, armor identically.
 *
 * Ranks 0..17 grow roughly ×1.252 per tier; Adamantine I/II add a flat +5
 * factor each (the exponential growth flattens at the top two ranks).
 *
 * Replaces the older `Math.pow(1.25205, rank)` halmmar formula which
 * over-estimates by ~29% at rank 19.
 */
export const RANK_FACTORS: readonly number[] = [
  1.0,      // 0  Stone I
  1.2545,   // 1  Stone II
  1.5727,   // 2  Stone III
  1.9545,   // 3  Iron I
  2.4545,   // 4  Iron II
  3.0727,   // 5  Iron III
  3.8455,   // 6  Bronze I
  4.8182,   // 7  Bronze II
  6.0364,   // 8  Bronze III
  7.5545,   // 9  Silver I
  9.4545,   // 10 Silver II
  11.8455,  // 11 Silver III
  14.8273,  // 12 Gold I
  18.5636,  // 13 Gold II
  23.2455,  // 14 Gold III
  29.1091,  // 15 Diamond I
  36.4455,  // 16 Diamond II
  45.6273,  // 17 Diamond III
  50.6273,  // 18 Adamantine I
  55.6273,  // 19 Adamantine II
];

export function rankFactor(rank: number): number {
  if (rank <= 0) return RANK_FACTORS[0];
  if (rank >= RANK_FACTORS.length) return RANK_FACTORS[RANK_FACTORS.length - 1];
  return RANK_FACTORS[rank];
}

export function statFactor(stars: number, rank: number): number {
  const s = Math.max(0, stars);
  return rankFactor(rank) * (1 + 0.1 * s);
}

export function starMultiplier(stars: number): number {
  if (stars < 0) return 1;
  return 1 + 0.1 * stars;
}

/**
 * Scale base HP/damage/armor by (rank × star) factor. Floors each stat to an
 * integer because the in-game UI displays truncated values.
 */
export function applyStarAndRank(
  base: BaseStats,
  stars: number,
  rank: number,
): BaseStats {
  const f = statFactor(stars, rank);
  return {
    ...base,
    damage: Math.floor(base.damage * f),
    armor: Math.floor(base.armor * f),
    hp: Math.floor(base.hp * f),
  };
}

export function applyEquipmentMods(base: BaseStats, mods: ItemStatMods[]): BaseStats {
  let damage = base.damage;
  let armor = base.armor;
  let hp = base.hp;
  let critChance = base.critChance;
  let critDamage = base.critDamage;
  let blockChance = base.blockChance;
  let blockDamage = base.blockDamage;

  for (const m of mods) {
    damage += m.damageFlat ?? 0;
    armor += m.armorFlat ?? 0;
    hp += m.hpFlat ?? 0;
    critChance += m.critChance ?? 0;
    critDamage += m.critDamage ?? 0;
    blockChance += m.blockChance ?? 0;
    blockDamage += m.blockDamage ?? 0;
  }
  // NOTE: armorPct removed — zero scraped equipment entries ever used it. If
  // future catalog data includes percent-armor mods, re-add both the field
  // (types.ts, schema.ts) and the multiplier here.
  for (const m of mods) {
    if (m.damagePct) damage *= 1 + m.damagePct;
    if (m.hpPct) hp *= 1 + m.hpPct;
  }

  return {
    ...base,
    damage,
    armor,
    hp,
    critChance,
    critDamage,
    blockChance,
    blockDamage,
  };
}

export function rarityIndex(r: Rarity): number {
  return RARITY_ORDER.indexOf(r);
}

/**
 * Rarity scales ability values by +20% per tier (common = 1.0, legendary = 1.8,
 * mythic = 2.0). Calibrated from the tacticus.wiki.gg passive-ability
 * comparators: e.g. Abaddon's `extraDmg` at level 60 shows 652 on Mythic vs a
 * raw gameinfo value of 326 (×2.0), and Calgar's imperial `extraDmg_2` at
 * Legendary level 50 shows 1298 vs raw 721 (×1.8).
 */
export function rarityAbilityMultiplier(r: Rarity): number {
  const idx = rarityIndex(r);
  return 1 + 0.2 * Math.max(0, idx);
}

export function abilityLevelMultiplier(
  xpLevel: number,
  rarity: Rarity,
  abilityFactorTable: number[],
): number {
  const idx = Math.max(0, Math.min(xpLevel - 1, abilityFactorTable.length - 1));
  const factor = abilityFactorTable[idx] ?? 1;
  return factor * rarityAbilityMultiplier(rarity);
}
