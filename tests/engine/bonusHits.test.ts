import { describe, expect, it } from 'vitest';
import { applyBonusHits } from '../../src/engine/rotation';
import type { AttackProfile, TurnBuff } from '../../src/engine/types';

function profile(kind: AttackProfile['kind'], hits = 2): AttackProfile {
  return { label: 'test', damageType: 'power', hits, kind };
}

function buff(patch: Partial<TurnBuff>): TurnBuff {
  return { id: 'b', name: 'test', ...patch };
}

describe('applyBonusHits', () => {
  it('returns unchanged profile when no buffs have bonusHits', () => {
    const p = profile('melee');
    expect(applyBonusHits(p, [buff({ damageFlat: 10 })], false)).toBe(p);
  });

  it('adds hits only to first turn when trigger=first', () => {
    const p = profile('melee', 2);
    const b = [buff({ bonusHits: 1, bonusHitsOn: 'first' })];
    expect(applyBonusHits(p, b, true).hits).toBe(3);
    expect(applyBonusHits(p, b, false).hits).toBe(2);
  });

  it('normal trigger matches melee and ranged, not ability', () => {
    const b = [buff({ bonusHits: 2, bonusHitsOn: 'normal' })];
    expect(applyBonusHits(profile('melee', 1), b, false).hits).toBe(3);
    expect(applyBonusHits(profile('ranged', 1), b, false).hits).toBe(3);
    expect(applyBonusHits(profile('ability', 1), b, false).hits).toBe(1);
  });

  it('ability trigger only matches ability', () => {
    const b = [buff({ bonusHits: 1, bonusHitsOn: 'ability' })];
    expect(applyBonusHits(profile('ability', 1), b, false).hits).toBe(2);
    expect(applyBonusHits(profile('melee', 1), b, false).hits).toBe(1);
  });

  it('all trigger applies to every kind', () => {
    const b = [buff({ bonusHits: 1, bonusHitsOn: 'all' })];
    expect(applyBonusHits(profile('ability', 1), b, false).hits).toBe(2);
    expect(applyBonusHits(profile('ranged', 1), b, true).hits).toBe(2);
  });

  it('stacks multiple buffs', () => {
    const buffs = [
      buff({ bonusHits: 1, bonusHitsOn: 'first' }),
      buff({ bonusHits: 2, bonusHitsOn: 'normal' }),
    ];
    expect(applyBonusHits(profile('melee', 1), buffs, true).hits).toBe(4);
  });
});
