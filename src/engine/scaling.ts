import type { BaseStats, ItemStatMods, Rarity } from './types';
import { RARITY_ORDER } from './types';

export const RANK_STAT_BASE = 1.25205;

export function statFactor(stars: number, rank: number): number {
  const s = Math.max(0, stars);
  const r = Math.max(0, rank);
  return Math.pow(RANK_STAT_BASE, r) * (1 + 0.1 * s);
}

export function starMultiplier(stars: number): number {
  if (stars < 0) return 1;
  return 1 + 0.1 * stars;
}

export function applyStarAndRank(
  base: BaseStats,
  stars: number,
  rank: number,
): BaseStats {
  const f = statFactor(stars, rank);
  return {
    ...base,
    damage: base.damage * f,
    armor: base.armor * f,
    hp: base.hp * f,
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
  for (const m of mods) {
    if (m.damagePct) damage *= 1 + m.damagePct;
    if (m.armorPct) armor *= 1 + m.armorPct;
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
