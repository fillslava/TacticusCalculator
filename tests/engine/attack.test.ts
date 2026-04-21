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

  /**
   * HDTW step 1 reads "Damage value" as the per-hit ability damage (already
   * includes damageFactor × abilityMul). Crit "replaces Damage with Damage +
   * Crit Damage" at that per-hit level — so critDamage is a FLAT bonus on
   * top of the already-scaled ability hit, not a multiplier input.
   *
   * User-reported regression: with a 1797-crit Mythic weapon equipped, the
   * calculator's crit-max ballooned to ~595 000 on a single Kharn KMB
   * because the engine folded critDamage into baseDamage BEFORE multiplying
   * by damageFactor×abilityMul (~130 at Mythic L60). Expected crit hit is
   * roughly `7961 + 1797 ≈ 9758`, not `(25+1797) × 2.44 × 130.5 ≈ 579 829`.
   */
  it('crit bonus is added after damageFactor, not multiplied by it', () => {
    const kharn: CatalogCharacter = {
      id: 'kharnCritStub',
      displayName: 'Kharn',
      faction: 'World Eaters',
      alliance: 'Chaos',
      baseStats: {
        damage: 25,
        armor: 20,
        hp: 90,
        critChance: 1,
        critDamage: 1797,
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
      stages: [{ name: 'L1', hp: 10_000_000, armor: 0, traits: [] }],
    };
    const attacker: Attacker = {
      source: kharn,
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
    // All crits at 100% crit chance; per-hit = 7961 + 1797 = 9758 mid.
    // Allow ±15% for pierce (piercing=0.8) + variance rounding.
    expect(r.expected).toBeGreaterThan(9758 * 0.85);
    expect(r.expected).toBeLessThan(9758 * 1.15);
    // Hard upper bound: must be nowhere near the old buggy 500k+ regime.
    expect(r.expected).toBeLessThan(20_000);
  });

  /**
   * Range reporting regression: with pCrit=0 the max field should equal the
   * non-crit max, and with pCrit=1 the min field should equal the crit min.
   * The old engine always used `nonCrit.min` and `crit.max` regardless of
   * crit chance, which produced misleading envelopes like "6150–51366" for
   * a 0%-crit build.
   */
  it('pCrit=0 reports non-crit max (range not inflated by unreachable crits)', () => {
    const charNoCrit: CatalogCharacter = {
      id: 'zeroCritStub',
      displayName: 'Zero Crit',
      faction: 'Space Marines',
      alliance: 'Imperial',
      baseStats: {
        damage: 100,
        armor: 50,
        hp: 1000,
        critChance: 0,
        critDamage: 5000, // huge critDamage — should NOT appear if pCrit=0
        blockChance: 0,
        blockDamage: 0,
        meleeHits: 3,
        rangedHits: 0,
      },
      melee: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      abilities: [],
      traits: [],
      maxRarity: 'legendary',
    };
    const attacker: Attacker = {
      source: charNoCrit,
      progression: { stars: 0, rank: 0, xpLevel: 1, rarity: 'legendary' },
      equipment: [],
    };
    const target: Target = {
      source: {
        id: 'z',
        displayName: 'Z',
        stages: [{ name: 'L1', hp: 100_000, armor: 0, traits: [] }],
      },
      stageIndex: 0,
    };
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const r = resolveAttack(attacker, target, ctx);
    // expected = 100 × 3 hits × 1.0 mid = 300 per-hit × variance ≈ 300 × 3.
    // max should be variance-high only (≤ 360), NOT critDamage-inflated.
    expect(r.max).toBeLessThan(r.expected * 1.35);
    expect(r.min).toBeLessThan(r.expected);
  });
});

describe('resolveAttack — shield routing (HDTW_Shields)', () => {
  /**
   * Wiki: "Shields act as Health"... "Shields have 0 Armour"... so damage that
   * lands on a shield must NOT be reduced by armor. The old engine first
   * armor-reduced every hit, THEN subtracted shield from the already-reduced
   * total, which under-reports damage done vs high-armor shielded bosses.
   */
  it('shield absorbs pre-armor damage (armor does not reduce shield hits)', () => {
    const a = makeAttacker();
    // Heavily armored target: 500 armor. Against 100-damage power hits with
    // pierce=0.4, post-armor per hit floors at 100×0.4 = 40. 3 hits => 120 HP
    // damage with no shield. Now give it a 5000 shield, no HP damage at all,
    // and verify the expected pulls from shield directly at roughly pre-armor
    // values (3 hits × ~100 per-hit pre-armor = ~300 into shield).
    const shieldedBoss: CatalogBoss = {
      id: 'shielded',
      displayName: 'Shielded',
      stages: [{ name: 'L1', hp: 100_000, armor: 500, shield: 5000, traits: [] }],
    };
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const r = resolveAttack(a, makeTarget({ source: shieldedBoss }), ctx);
    // Shield absorbs ~300 pre-armor dmg; HP takes 0.
    expect(r.postShieldExpected).toBe(0);
    expect(r.expected).toBeGreaterThan(200);
    expect(r.expected).toBeLessThan(400);
  });

  /**
   * Regression: prior naive shield routing computed post-armor damage and
   * THEN subtracted shield from the armor-reduced total. Under the new
   * routing, against a high-armor target a shielded vs unshielded comparison
   * should show the shielded target take MORE total damage (pre-armor path)
   * but LESS HP damage (shield absorbs a big chunk).
   */
  it('shielded high-armor target takes more total damage than unshielded', () => {
    const a = makeAttacker();
    const highArmor: CatalogBoss = {
      id: 'ha',
      displayName: 'HA',
      stages: [{ name: 'L1', hp: 100_000, armor: 200, traits: [] }],
    };
    const highArmorShielded: CatalogBoss = {
      id: 'has',
      displayName: 'HAS',
      stages: [{ name: 'L1', hp: 100_000, armor: 200, shield: 1000, traits: [] }],
    };
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const rNoShield = resolveAttack(a, makeTarget({ source: highArmor }), ctx);
    const rShield = resolveAttack(a, makeTarget({ source: highArmorShielded }), ctx);
    // Shield absorbs un-armored dmg; total damage dealt is larger even if no
    // HP damage lands.
    expect(rShield.expected).toBeGreaterThan(rNoShield.expected);
    // HP damage is smaller or zero.
    expect(rShield.postShieldExpected).toBeLessThan(rNoShield.postShieldExpected);
  });

  it('overflow from a shield-breaking hit reduces HP via armor+pierce', () => {
    const a = makeAttacker();
    // Shield = 50, each pre-armor hit is ~100. First hit breaks shield and
    // the remainder (~50) goes through armor as a partial new attack.
    const partial: CatalogBoss = {
      id: 'partial',
      displayName: 'Partial',
      stages: [{ name: 'L1', hp: 10_000, armor: 80, shield: 50, traits: [] }],
    };
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const r = resolveAttack(a, makeTarget({ source: partial }), ctx);
    // Shield consumed fully: shield portion = 50.
    // Overflow from hit 1 (~50 pre-armor) → armor/pierce reduce to
    //   max(50 - 80, 50 × 0.4) = 20 per armor pass.
    // Then hits 2 and 3 go entirely through armor (100 → max(100-80, 40)=40).
    // HP damage ≈ 20 + 40 + 40 = 100, total ≈ 150.
    expect(r.postShieldExpected).toBeGreaterThan(50);
    expect(r.postShieldExpected).toBeLessThan(200);
    expect(r.expected).toBeGreaterThan(r.postShieldExpected);
  });
});

describe('resolveAttack — block formula (HDTW wiki)', () => {
  const blockingChar: CatalogCharacter = {
    id: 'blocker',
    displayName: 'Blocker',
    faction: 'Space Marines',
    alliance: 'Imperial',
    baseStats: {
      damage: 10,
      armor: 0,
      hp: 100_000,
      critChance: 0,
      critDamage: 0,
      // Target-side block: chain-rolled per-hit, flat subtract per wiki.
      blockChance: 1,
      blockDamage: 40,
      meleeHits: 1,
      rangedHits: 1,
    },
    melee: { label: 'M', damageType: 'power', hits: 1, kind: 'melee' },
    abilities: [],
    traits: [],
    maxRarity: 'legendary',
  };

  it('block flatly subtracts blockDamage, floored at 0 ("reduce to 0")', () => {
    // Attacker hits for 100 pre-armor. Target has blockChance=1, blockDamage=40.
    // Every hit blocked → each lands for 60. Floor-at-0 rule applies when
    // blockDamage ≥ hit damage, verified in the next test.
    const a = makeAttacker();
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    const r = resolveAttack(a, { source: blockingChar } as Target, ctx);
    expect(r.expected).toBeGreaterThan(40);
    expect(r.expected).toBeLessThan(80);
  });

  it('blockDamage > hit damage floors result at 0', () => {
    // Weak attacker: ~10 raw damage; blockDamage=40 > hit, so blocks bring
    // HP damage to 0 for every hit.
    const weakAttacker: Attacker = {
      source: {
        ...char,
        baseStats: { ...char.baseStats, damage: 5 },
      },
      progression: { stars: 0, rank: 0, xpLevel: 1, rarity: 'legendary' },
      equipment: [],
    };
    const ctx: AttackContext = {
      profile: { label: 'Weak', damageType: 'power', hits: 3, kind: 'melee' },
      rngMode: 'expected',
    };
    const r = resolveAttack(weakAttacker, { source: blockingChar } as Target, ctx);
    expect(r.expected).toBe(0);
  });

  it('block chain rule: P(n blocks) = blockChance^n (hit 2 less reduced than hit 1)', () => {
    // blockChance=0.6 → hit 1 blocked with p=0.6; hit 2 blocked with p=0.36.
    // Expected reduction on hit 2 is smaller than hit 1 → per-hit expected
    // damage on hit 2 should be HIGHER than hit 1.
    const chainBlocker: CatalogCharacter = {
      ...blockingChar,
      baseStats: { ...blockingChar.baseStats, blockChance: 0.6, blockDamage: 40 },
    };
    const a = makeAttacker();
    const ctx: AttackContext = {
      profile: { label: 'Multi', damageType: 'power', hits: 2, kind: 'melee' },
      rngMode: 'expected',
    };
    const r = resolveAttack(a, { source: chainBlocker } as Target, ctx);
    expect(r.perHit).toHaveLength(2);
    expect(r.perHit[1].expected).toBeGreaterThan(r.perHit[0].expected);
  });

  it('block does not reduce shield damage (cosmetic vs shields)', () => {
    // Shielded blocker vs unshielded blocker: with identical block stats,
    // shield damage should equal unblocked pre-armor damage; HP damage
    // accounts for block reduction.
    const shielded: CatalogCharacter = {
      ...blockingChar,
      baseStats: { ...blockingChar.baseStats, blockChance: 1, blockDamage: 40 },
    };
    const a = makeAttacker();
    const ctx: AttackContext = {
      profile: { label: 'Shield poke', damageType: 'power', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    // No shield: HP takes ~60 (100 - 40 block).
    const rNoShield = resolveAttack(a, { source: shielded, currentShield: 0 } as Target, ctx);
    // With shield > pre-armor: all damage to shield, block does NOT reduce.
    const rShield = resolveAttack(a, { source: shielded, currentShield: 1000 } as Target, ctx);
    expect(rNoShield.expected).toBeLessThan(80);
    expect(rShield.expected).toBeGreaterThan(rNoShield.expected);
    expect(rShield.postShieldExpected).toBe(0);
  });

  it('daemon trait adds +25% block chance and 50%-of-attacker-damage reduction', () => {
    // Attacker has 100 damage. Daemon sets target blockDamage to 50, so a
    // fully-blocked hit lands for 50 (with block chance ≥ the +25% alone).
    const daemonBoss: CatalogBoss = {
      id: 'daemonBoss',
      displayName: 'Daemon',
      stages: [{ name: 'L1', hp: 100_000, armor: 0, traits: ['daemon'] }],
    };
    const plainBoss: CatalogBoss = {
      id: 'plain',
      displayName: 'Plain',
      stages: [{ name: 'L1', hp: 100_000, armor: 0, traits: [] }],
    };
    const a = makeAttacker();
    const ctx: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    const rDaemon = resolveAttack(a, makeTarget({ source: daemonBoss }), ctx);
    const rPlain = resolveAttack(a, makeTarget({ source: plainBoss }), ctx);
    // Daemon variant deals less damage (25% of hits partially blocked).
    expect(rDaemon.expected).toBeLessThan(rPlain.expected);
    // But not so little that blocks alone explain a 0 result.
    expect(rDaemon.expected).toBeGreaterThan(0);
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
