import { describe, it, expect } from 'vitest';
import {
  starMultiplier,
  applyStarAndRank,
  applyEquipmentMods,
  rarityAbilityMultiplier,
  statFactor,
  rankFactor,
  RANK_FACTORS,
  abilityLevelMultiplier,
} from '../../src/engine/scaling';
import type { BaseStats } from '../../src/engine/types';

const baseStats: BaseStats = {
  damage: 100,
  armor: 50,
  hp: 1000,
  critChance: 0,
  critDamage: 0,
  blockChance: 0,
  blockDamage: 0,
  meleeHits: 2,
  rangedHits: 1,
};

describe('starMultiplier', () => {
  it('is 1.0 at 0 stars', () => {
    expect(starMultiplier(0)).toBe(1);
  });
  it('adds 10% per star', () => {
    expect(starMultiplier(5)).toBeCloseTo(1.5);
    expect(starMultiplier(13)).toBeCloseTo(2.3);
  });
});

describe('rankFactor', () => {
  it('is 1.0 at Stone I (rank 0)', () => {
    expect(rankFactor(0)).toBe(1.0);
  });
  it('matches tacticustable rank 19 (Adamantine II) at ~55.63', () => {
    expect(rankFactor(19)).toBeCloseTo(55.6273, 3);
  });
  it('clamps below 0 and above table length', () => {
    expect(rankFactor(-3)).toBe(RANK_FACTORS[0]);
    expect(rankFactor(99)).toBe(RANK_FACTORS[19]);
  });
});

describe('statFactor', () => {
  it('is 1.0 at 0 stars, 0 rank', () => {
    expect(statFactor(0, 0)).toBeCloseTo(1);
  });
  it('applies 10% per star linearly when rank=0', () => {
    expect(statFactor(5, 0)).toBeCloseTo(1.5);
    expect(statFactor(14, 0)).toBeCloseTo(2.4);
  });
  it('uses rank lookup table, not exponential', () => {
    expect(statFactor(0, 1)).toBeCloseTo(RANK_FACTORS[1]);
    expect(statFactor(0, 19)).toBeCloseTo(RANK_FACTORS[19]);
  });
  it('combines rank and star factors multiplicatively', () => {
    expect(statFactor(13, 19)).toBeCloseTo(RANK_FACTORS[19] * 2.3);
  });
});

describe('applyStarAndRank', () => {
  it('scales offensive stats by statFactor, floored to integers', () => {
    const r = applyStarAndRank(baseStats, 5, 0);
    expect(r.damage).toBe(150);
    expect(r.armor).toBe(75);
    expect(r.hp).toBe(1500);
  });
  it('matches Abaddon at Adamantine II / mythic (13 stars)', () => {
    // Real Abaddon base: hp=100, damage=15, armor=25; at rank 19, stars 13
    // tacticustable shows 12794 / 1918 / 3199 — our lookup should match ~exactly.
    const abaddonBase: BaseStats = {
      ...baseStats,
      damage: 15,
      armor: 25,
      hp: 100,
    };
    const r = applyStarAndRank(abaddonBase, 13, 19);
    expect(r.hp).toBeGreaterThanOrEqual(12790);
    expect(r.hp).toBeLessThanOrEqual(12800);
    expect(r.damage).toBeGreaterThanOrEqual(1914);
    expect(r.damage).toBeLessThanOrEqual(1920);
    expect(r.armor).toBeGreaterThanOrEqual(3195);
    expect(r.armor).toBeLessThanOrEqual(3205);
  });
});

describe('applyEquipmentMods', () => {
  it('applies flat bonuses additively', () => {
    const r = applyEquipmentMods(baseStats, [
      { damageFlat: 20, critChance: 0.15, critDamage: 30 },
      { damageFlat: 10, blockChance: 0.1, blockDamage: 40 },
    ]);
    expect(r.damage).toBe(130);
    expect(r.critChance).toBeCloseTo(0.15);
    expect(r.critDamage).toBe(30);
    expect(r.blockChance).toBeCloseTo(0.1);
  });
  it('applies percent bonuses multiplicatively after flats', () => {
    const r = applyEquipmentMods(baseStats, [
      { damageFlat: 20, damagePct: 0.1 },
    ]);
    expect(r.damage).toBeCloseTo(120 * 1.1);
  });
});

describe('rarityAbilityMultiplier', () => {
  it('steps by 20% per tier, calibrated from wiki ability tables', () => {
    expect(rarityAbilityMultiplier('common')).toBeCloseTo(1.0);
    expect(rarityAbilityMultiplier('uncommon')).toBeCloseTo(1.2);
    expect(rarityAbilityMultiplier('rare')).toBeCloseTo(1.4);
    expect(rarityAbilityMultiplier('epic')).toBeCloseTo(1.6);
    expect(rarityAbilityMultiplier('legendary')).toBeCloseTo(1.8);
    expect(rarityAbilityMultiplier('mythic')).toBeCloseTo(2.0);
  });
});

describe('abilityLevelMultiplier', () => {
  it('returns table value * rarity multiplier', () => {
    const table = [1, 1.2, 1.4, 1.6];
    expect(abilityLevelMultiplier(1, 'common', table)).toBeCloseTo(1);
    expect(abilityLevelMultiplier(3, 'legendary', table)).toBeCloseTo(1.4 * 1.8);
  });
  it('clamps to table bounds', () => {
    const table = [1, 2, 3];
    expect(abilityLevelMultiplier(999, 'common', table)).toBeCloseTo(3);
    expect(abilityLevelMultiplier(0, 'common', table)).toBeCloseTo(1);
  });
});
