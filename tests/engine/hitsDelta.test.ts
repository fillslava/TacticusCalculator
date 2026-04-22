import { describe, expect, it } from 'vitest';
import { applyBonusHits, applyHitsDelta } from '../../src/engine/rotation';
import type { AttackProfile, TurnBuff } from '../../src/engine/types';

function profile(kind: AttackProfile['kind'], hits = 2): AttackProfile {
  return { label: 'test', damageType: 'power', hits, kind };
}

function buff(patch: Partial<TurnBuff>): TurnBuff {
  return { id: 'b', name: 'test', ...patch };
}

describe('applyHitsDelta', () => {
  it('returns the input profile unchanged when no buffs contribute', () => {
    const p = profile('ranged', 4);
    expect(applyHitsDelta(p, [], false)).toBe(p);
    expect(applyHitsDelta(p, [buff({ damageFlat: 10 })], false)).toBe(p);
  });

  it('subtracts hits for tall-grass-style ranged penalty', () => {
    const p = profile('ranged', 4);
    const b = [buff({ hitsDelta: -2, hitsDeltaOn: 'normal' })];
    expect(applyHitsDelta(p, b, false).hits).toBe(2);
  });

  it('floors the resulting hit count at 1 (never below)', () => {
    const p = profile('ranged', 2);
    const b = [buff({ hitsDelta: -5, hitsDeltaOn: 'normal' })];
    expect(applyHitsDelta(p, b, false).hits).toBe(1);
  });

  it('gates on hitsDeltaOn: "normal" matches melee and ranged only', () => {
    const b = [buff({ hitsDelta: -1, hitsDeltaOn: 'normal' })];
    expect(applyHitsDelta(profile('melee', 3), b, false).hits).toBe(2);
    expect(applyHitsDelta(profile('ranged', 3), b, false).hits).toBe(2);
    expect(applyHitsDelta(profile('ability', 3), b, false).hits).toBe(3);
  });

  it('gates on hitsDeltaOn: "ability" matches ability only', () => {
    const b = [buff({ hitsDelta: -1, hitsDeltaOn: 'ability' })];
    expect(applyHitsDelta(profile('ability', 3), b, false).hits).toBe(2);
    expect(applyHitsDelta(profile('melee', 3), b, false).hits).toBe(3);
  });

  it('defaults to hitsDeltaOn: "all" when unspecified', () => {
    const b = [buff({ hitsDelta: -1 })];
    expect(applyHitsDelta(profile('ability', 3), b, false).hits).toBe(2);
    expect(applyHitsDelta(profile('melee', 3), b, false).hits).toBe(2);
    expect(applyHitsDelta(profile('ranged', 3), b, false).hits).toBe(2);
  });

  it('gates on "first" — only applies during the first turn of a rotation', () => {
    const p = profile('ranged', 3);
    const b = [buff({ hitsDelta: -1, hitsDeltaOn: 'first' })];
    expect(applyHitsDelta(p, b, /* isFirstTurn */ true).hits).toBe(2);
    expect(applyHitsDelta(p, b, /* isFirstTurn */ false).hits).toBe(3);
  });

  it('stacks additively across multiple contributing buffs', () => {
    const p = profile('ranged', 5);
    const b = [
      buff({ id: 'a', hitsDelta: -2, hitsDeltaOn: 'normal' }),
      buff({ id: 'b', hitsDelta: -1, hitsDeltaOn: 'normal' }),
    ];
    expect(applyHitsDelta(p, b, false).hits).toBe(2);
  });

  it('accepts positive deltas (generic hit boost, ungated by STMA)', () => {
    const p = profile('ranged', 2);
    const b = [buff({ hitsDelta: +3 })];
    expect(applyHitsDelta(p, b, false).hits).toBe(5);
  });

  it('does NOT short-circuit on abilityProfileIdx > 0 (unlike applyBonusHits)', () => {
    // Multi-profile ability: 2nd profile would be STMA-skipped by
    // applyBonusHits but MUST still receive hitsDelta — tall grass
    // applies on every profile.
    const p: AttackProfile = {
      label: 'ability-profile-2',
      damageType: 'power',
      hits: 3,
      kind: 'ranged',
      abilityProfileIdx: 1,
    };
    const grass = [buff({ hitsDelta: -2, hitsDeltaOn: 'normal' })];
    expect(applyHitsDelta(p, grass, false).hits).toBe(1);
    // Sanity: applyBonusHits on the same profile would skip the delta.
    const extraHits = [buff({ bonusHits: 2, bonusHitsOn: 'normal' })];
    expect(applyBonusHits(p, extraHits, false).hits).toBe(3); // STMA skip.
  });

  it('composes with applyBonusHits: bonus first, delta second, clamp at 1', () => {
    const p = profile('ranged', 2);
    const buffs: TurnBuff[] = [
      buff({ id: 'bonus', bonusHits: 1, bonusHitsOn: 'normal' }), // 2 → 3
      buff({ id: 'grass', hitsDelta: -4, hitsDeltaOn: 'normal' }), // 3 → 1 (floor)
    ];
    const afterBonus = applyBonusHits(p, buffs, false);
    expect(afterBonus.hits).toBe(3);
    const afterDelta = applyHitsDelta(afterBonus, buffs, false);
    expect(afterDelta.hits).toBe(1);
  });
});
