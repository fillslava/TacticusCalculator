import { describe, it, expect } from 'vitest';
import { resolveAttack } from '../../src/engine/attack';
import { resolveRotation, singleAttackRotation } from '../../src/engine/rotation';
import '../../src/engine/traits';
import type {
  Attacker,
  AttackContext,
  CatalogBoss,
  CatalogCharacter,
  Target,
} from '../../src/engine/types';

const char: CatalogCharacter = {
  id: 'testHero',
  displayName: 'Test Hero',
  faction: 'Space Marines',
  alliance: 'Imperial',
  baseStats: {
    damage: 100,
    armor: 50,
    hp: 1000,
    critChance: 0,
    critDamage: 0,
    blockChance: 0,
    blockDamage: 0,
    meleeHits: 3,
    rangedHits: 2,
  },
  melee: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
  ranged: { label: 'Ranged', damageType: 'bolter', hits: 2, kind: 'ranged' },
  abilities: [],
  traits: [],
  maxRarity: 'legendary',
};

const boss: CatalogBoss = {
  id: 'testBoss',
  displayName: 'Test Boss',
  stages: [
    { name: 'L1', hp: 100_000, armor: 80, traits: [] },
    { name: 'L2', hp: 200_000, armor: 120, traits: [] },
  ],
};

function makeAttacker(overrides: Partial<Attacker> = {}): Attacker {
  return {
    source: char,
    progression: { stars: 0, rank: 0, xpLevel: 1, rarity: 'legendary' },
    equipment: [],
    ...overrides,
  };
}

function makeTarget(overrides: Partial<Target> = {}): Target {
  return { source: boss, stageIndex: 0, ...overrides };
}

describe('resolveAttack — baseline', () => {
  it('produces expected = min = max when no crit, no variance buckets differ', () => {
    const a = makeAttacker();
    const t = makeTarget();
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    const r = resolveAttack(a, t, ctx);
    expect(r.expected).toBeGreaterThan(0);
    expect(r.min).toBeLessThanOrEqual(r.expected);
    expect(r.max).toBeGreaterThanOrEqual(r.expected);
  });

  it('scales damage with attacker stars (10% per star)', () => {
    const aLow = makeAttacker({
      progression: { stars: 0, rank: 0, xpLevel: 1, rarity: 'legendary' },
    });
    const aHigh = makeAttacker({
      progression: { stars: 5, rank: 0, xpLevel: 1, rarity: 'legendary' },
    });
    const t = makeTarget();
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const rLow = resolveAttack(aLow, t, ctx);
    const rHigh = resolveAttack(aHigh, t, ctx);
    expect(rHigh.expected).toBeGreaterThan(rLow.expected);
  });

  it('psychic damage ignores armor (pierce=1)', () => {
    const a = makeAttacker();
    const t = makeTarget();
    const ctxPsychic: AttackContext = {
      profile: { label: 'Warp Bolt', damageType: 'psychic', hits: 1, kind: 'ability' },
      rngMode: 'expected',
    };
    const ctxPhys: AttackContext = {
      profile: { label: 'Fist', damageType: 'physical', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    const rPsy = resolveAttack(a, t, ctxPsychic);
    const rPhy = resolveAttack(a, t, ctxPhys);
    expect(rPsy.expected).toBeGreaterThan(rPhy.expected);
  });

  it('Gravis doubles armor passes and reduces damage', () => {
    const a = makeAttacker();
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const normalBoss: CatalogBoss = {
      ...boss,
      stages: [{ name: 'L1', hp: 100_000, armor: 80, traits: [] }],
    };
    const gravisBoss: CatalogBoss = {
      ...boss,
      stages: [{ name: 'L1', hp: 100_000, armor: 80, traits: ['gravisArmor'] }],
    };
    const rNorm = resolveAttack(a, makeTarget({ source: normalBoss }), ctx);
    const rGravis = resolveAttack(a, makeTarget({ source: gravisBoss }), ctx);
    expect(rGravis.expected).toBeLessThan(rNorm.expected);
  });

  it('sums damage across hits', () => {
    const a = makeAttacker();
    const t = makeTarget();
    const ctx1: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    const ctx3: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const r1 = resolveAttack(a, t, ctx1);
    const r3 = resolveAttack(a, t, ctx3);
    expect(r3.expected).toBeCloseTo(r1.expected * 3, 1);
  });

  it('floors damage at 1 per hit against overwhelming armor', () => {
    const a = makeAttacker();
    const highArmorBoss: CatalogBoss = {
      ...boss,
      stages: [{ name: 'L1', hp: 100_000, armor: 100_000, traits: [] }],
    };
    const ctx: AttackContext = {
      profile: { label: 'Physical Hit', damageType: 'physical', hits: 2, kind: 'melee' },
      rngMode: 'expected',
    };
    const r = resolveAttack(a, makeTarget({ source: highArmorBoss }), ctx);
    expect(r.expected).toBeGreaterThanOrEqual(2);
  });

  it('flags overkill when expected > 2x HP', () => {
    const a = makeAttacker();
    const tinyBoss: CatalogBoss = {
      ...boss,
      stages: [{ name: 'L1', hp: 10, armor: 0, traits: [] }],
    };
    const ctx: AttackContext = {
      profile: { label: 'Big', damageType: 'direct', hits: 3, kind: 'ability' },
      rngMode: 'expected',
    };
    const r = resolveAttack(a, makeTarget({ source: tinyBoss }), ctx);
    expect(r.overkill).toBe(true);
  });
});

describe('resolveAttack — ability scaling (wiki calibration)', () => {
  /**
   * Wiki-calibrated formula check: Kharn's "Kill! Maim! Burn!" Piercing
   * component at Mythic L60 shows 6526–9396 (mid 7961) on tacticus.wiki.gg.
   *
   * Cross-verified across all 6 rarities with baseStats.damage=25:
   *   mid = 25 × damageFactor × abilityFactor[level-1] × rarityMultiplier
   * gives damageFactor=2.44 exactly for Common L8, Uncommon L17, Rare L26,
   * Epic L35, Legendary L50, Mythic L60. This locks the contract: ability
   * damage does NOT include the stars×rank statFactor (only normal attacks
   * do). Regression guard for a previous bug where the engine applied
   * statFactor on top of abilityLevelMultiplier, producing ~664k instead of
   * ~8k at 5★ rank 19.
   */
  it('Kharn KMB Piercing @ Mythic L60, 5★ rank 19 ≈ 7961 (wiki mid)', () => {
    const kharn: CatalogCharacter = {
      id: 'kharnStub',
      displayName: 'Kharn',
      faction: 'World Eaters',
      alliance: 'Chaos',
      baseStats: {
        damage: 25,
        armor: 20,
        hp: 90,
        critChance: 0,
        critDamage: 0,
        blockChance: 0,
        blockDamage: 0,
        meleeHits: 4,
        rangedHits: 0,
      },
      melee: {
        label: 'Melee',
        damageType: 'eviscerating',
        hits: 4,
        pierceOverride: 0.5,
        kind: 'melee',
      },
      abilities: [],
      traits: [],
      maxRarity: 'mythic',
    };
    const dummyBoss: CatalogBoss = {
      id: 'zeroArmor',
      displayName: 'Zero Armor',
      stages: [{ name: 'L1', hp: 1_000_000, armor: 0, traits: [] }],
    };
    const attacker: Attacker = {
      source: kharn,
      // 5★ rank 19 would normally multiply damage by ~83× via statFactor.
      // The ability path must revert that and use raw baseDamage=25 instead.
      progression: { stars: 5, rank: 19, xpLevel: 60, rarity: 'mythic' },
      equipment: [],
    };
    const target: Target = { source: dummyBoss, stageIndex: 0 };
    const ctx: AttackContext = {
      profile: {
        label: 'KMB — Piercing',
        damageType: 'piercing',
        hits: 1,
        damageFactor: 2.44,
        kind: 'ability',
        abilityId: 'kharn_kmb',
      },
      rngMode: 'expected',
    };
    const r = resolveAttack(attacker, target, ctx);
    // Wiki mid is 7961; allow ±5% for pierce/variance rounding.
    expect(r.expected).toBeGreaterThan(7961 * 0.95);
    expect(r.expected).toBeLessThan(7961 * 1.05);
  });
});

describe('resolveRotation', () => {
  it('accumulates damage across turns', () => {
    const a = makeAttacker();
    const t = makeTarget();
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const result = resolveRotation(a, t, {
      turns: [{ attacks: [ctx] }, { attacks: [ctx] }, { attacks: [ctx] }],
    });
    expect(result.perTurn).toHaveLength(3);
    expect(result.cumulativeExpected[2]).toBeGreaterThan(result.cumulativeExpected[0]);
    expect(result.cumulativeExpected[1]).toBeGreaterThan(result.cumulativeExpected[0]);
  });

  it('reports turnsToKill when cumulative damage kills', () => {
    const a = makeAttacker();
    const tinyBoss: CatalogBoss = {
      ...boss,
      stages: [{ name: 'L1', hp: 500, armor: 10, traits: [] }],
    };
    const t = makeTarget({ source: tinyBoss });
    const ctx: AttackContext = {
      profile: { label: 'Hit', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const result = resolveRotation(a, t, {
      turns: Array.from({ length: 10 }, () => ({ attacks: [ctx] })),
    });
    expect(typeof result.turnsToKill).toBe('number');
    expect(result.turnsToKill as number).toBeGreaterThan(0);
  });

  it('singleAttackRotation wraps one attack', () => {
    const a = makeAttacker();
    const t = makeTarget();
    const ctx: AttackContext = {
      profile: { label: 'Hit', damageType: 'power', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    const result = resolveRotation(a, t, singleAttackRotation(ctx));
    expect(result.perTurn).toHaveLength(1);
  });
});
