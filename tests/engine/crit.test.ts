import { describe, it, expect } from 'vitest';
import {
  clamp01,
  combineTwoCritChances,
  critProbabilityAtHit,
  expectedCritsChained,
} from '../../src/engine/crit';

describe('clamp01', () => {
  it('bounds values to [0, 1]', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.3)).toBe(0.3);
    expect(clamp01(1.7)).toBe(1);
  });
});

describe('combineTwoCritChances', () => {
  it('combines via complement product (two crit items)', () => {
    expect(combineTwoCritChances(0.35, 0.35)).toBeCloseTo(0.5775, 4);
  });

  it('returns a when b is 0', () => {
    expect(combineTwoCritChances(0.5, 0)).toBe(0.5);
  });

  it('returns 1 if either is 1', () => {
    expect(combineTwoCritChances(0.3, 1)).toBe(1);
  });
});

describe('critProbabilityAtHit', () => {
  it('chains: P(nth hit crits) = p^n', () => {
    expect(critProbabilityAtHit(0.5, 1)).toBeCloseTo(0.5);
    expect(critProbabilityAtHit(0.5, 2)).toBeCloseTo(0.25);
    expect(critProbabilityAtHit(0.5, 3)).toBeCloseTo(0.125);
  });

  it('returns 1 when chance is 1 regardless of hit index', () => {
    expect(critProbabilityAtHit(1, 5)).toBe(1);
  });

  it('returns 0 when chance is 0', () => {
    expect(critProbabilityAtHit(0, 1)).toBe(0);
  });
});

describe('expectedCritsChained', () => {
  it('sums p^n for n in 1..hits', () => {
    const e = expectedCritsChained(0.5, 3);
    expect(e).toBeCloseTo(0.5 + 0.25 + 0.125, 5);
  });

  it('equals hits when p=1', () => {
    expect(expectedCritsChained(1, 4)).toBe(4);
  });

  it('is zero when p=0', () => {
    expect(expectedCritsChained(0, 5)).toBe(0);
  });
});
