import { describe, it, expect } from 'vitest';
import { resolveTraits, sortByPhase, fold } from '../../src/engine/modifiers';
import '../../src/engine/traits';
import type { Frame } from '../../src/engine/types';

function baseFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    attacker: {
      damage: 100,
      armor: 0,
      hp: 0,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 3,
      rangedHits: 0,
      traits: [],
    },
    target: {
      armor: 50,
      hp: 1000,
      shield: 0,
      blockChance: 0,
      blockDamage: 0,
      traits: [],
    },
    profile: { label: 'Melee', damageType: 'power', hits: 3, kind: 'melee' },
    pierce: 0.4,
    armorPasses: 1,
    armorPassesOnCrit: 1,
    preArmorFlat: 0,
    preArmorMultiplier: 1,
    postArmorMultiplier: 1,
    critChance: 0,
    critDamage: 0,
    damageFactor: 1,
    trace: [],
    ...overrides,
  };
}

describe('trait registry', () => {
  it('resolves known traits and skips unknown', () => {
    const mods = resolveTraits(['gravisArmor', 'unknownTrait', 'heavy weapon']);
    expect(mods.map((m) => m.id)).toEqual(['gravisArmor', 'heavy weapon']);
  });
});

describe('gravisArmor', () => {
  it('forces armor passes to >= 2', () => {
    const mods = resolveTraits(['gravisArmor']);
    const out = fold(baseFrame(), mods);
    expect(out.armorPasses).toBe(2);
    expect(out.armorPassesOnCrit).toBe(1);
  });
});

describe('heavyWeapon', () => {
  it('buffs ranged by 25%', () => {
    const mods = resolveTraits(['heavy weapon']);
    const rangedFrame = baseFrame({
      profile: { label: 'Ranged', damageType: 'bolter', hits: 3, kind: 'ranged' },
    });
    const out = fold(rangedFrame, mods);
    expect(out.postArmorMultiplier).toBeCloseTo(1.25);
  });

  it('does not buff melee', () => {
    const mods = resolveTraits(['heavy weapon']);
    const out = fold(baseFrame(), mods);
    expect(out.postArmorMultiplier).toBe(1);
  });
});

describe('parry', () => {
  it('reduces melee hits by 1 with floor of 1', () => {
    const mods = resolveTraits(['parry']);
    const out = fold(baseFrame(), mods);
    expect(out.profile.hits).toBe(2);
    const single = fold(
      baseFrame({ profile: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' } }),
      mods,
    );
    expect(single.profile.hits).toBe(1);
  });

  it('does not reduce ranged hits', () => {
    const mods = resolveTraits(['parry']);
    const rangedFrame = baseFrame({
      profile: { label: 'Ranged', damageType: 'bolter', hits: 3, kind: 'ranged' },
    });
    const out = fold(rangedFrame, mods);
    expect(out.profile.hits).toBe(3);
  });
});

describe('emplacement', () => {
  it('halves melee damage', () => {
    const mods = resolveTraits(['emplacement']);
    const out = fold(baseFrame(), mods);
    expect(out.postArmorMultiplier).toBeCloseTo(0.5);
  });

  it('leaves ranged alone', () => {
    const mods = resolveTraits(['emplacement']);
    const rangedFrame = baseFrame({
      profile: { label: 'Ranged', damageType: 'bolter', hits: 3, kind: 'ranged' },
    });
    const out = fold(rangedFrame, mods);
    expect(out.postArmorMultiplier).toBe(1);
  });
});

describe('phase ordering', () => {
  it('sorts by PHASE_ORDER then priority', () => {
    const mods = resolveTraits(['heavy weapon', 'gravisArmor', 'parry']);
    const sorted = sortByPhase(mods);
    expect(sorted.map((m) => m.id)).toEqual(['parry', 'gravisArmor', 'heavy weapon']);
  });
});
