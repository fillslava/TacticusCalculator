import { describe, it, expect } from 'vitest';
import {
  starMultiplier,
  applyStarAndRank,
  applyEquipmentMods,
  rarityAbilityMultiplier,
  statFactor,
  abilityLevelMultiplier,
  RANK_STAT_BASE,
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

describe('statFactor', () => {
  it('is 1.0 at 0 stars, 0 rank', () => {
    expect(statFactor(0, 0)).toBeCloseTo(1);
  });
  it('applies 10% per star linearly when rank=0', () => {
    expect(statFactor(5, 0)).toBeCloseTo(1.5);
    expect(statFactor(15, 0)).toBeCloseTo(2.5);
  });
  it('applies exponential rank multiplier', () => {
    expect(statFactor(0, 1)).toBeCloseTo(RANK_STAT_BASE);
    expect(statFactor(0, 5)).toBeCloseTo(Math.pow(RANK_STAT_BASE, 5));
  });
  it('combines stars and rank multiplicatively (halmmar formula)', () => {
    expect(statFactor(5, 10)).toBeCloseTo(Math.pow(RANK_STAT_BASE, 10) * 1.5);
  });
});

describe('applyStarAndRank', () => {
  it('scales all three offensive stats by statFactor', () => {
    const r = applyStarAndRank(baseStats, 5, 0);
    expect(r.damage).toBeCloseTo(150);
    expect(r.armor).toBeCloseTo(75);
    expect(r.hp).toBeCloseTo(1500);
  });
  it('rank raises stats exponentially', () => {
    const r = applyStarAndRank(baseStats, 0, 10);
    const f = Math.pow(RANK_STAT_BASE, 10);
    expect(r.damage).toBeCloseTo(100 * f);
    expect(r.armor).toBeCloseTo(50 * f);
    expect(r.hp).toBeCloseTo(1000 * f);
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
  it('is 1.0 at common and grows by 10% per tier (mythic = 1.5)', () => {
    expect(rarityAbilityMultiplier('common')).toBeCloseTo(1.0);
    expect(rarityAbilityMultiplier('uncommon')).toBeCloseTo(1.1);
    expect(rarityAbilityMultiplier('legendary')).toBeCloseTo(1.4);
    expect(rarityAbilityMultiplier('mythic')).toBeCloseTo(1.5);
  });
});

describe('abilityLevelMultiplier', () => {
  it('returns table value * rarity multiplier', () => {
    const table = [1, 1.2, 1.4, 1.6];
    expect(abilityLevelMultiplier(1, 'common', table)).toBeCloseTo(1);
    expect(abilityLevelMultiplier(3, 'legendary', table)).toBeCloseTo(1.4 * 1.4);
  });
  it('clamps to table bounds', () => {
    const table = [1, 2, 3];
    expect(abilityLevelMultiplier(999, 'common', table)).toBeCloseTo(3);
    expect(abilityLevelMultiplier(0, 'common', table)).toBeCloseTo(1);
  });
});

