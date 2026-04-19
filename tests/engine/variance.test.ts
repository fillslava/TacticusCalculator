import { describe, it, expect } from 'vitest';
import { varianceBand, varianceBuckets } from '../../src/engine/variance';

describe('varianceBand', () => {
  it('returns 0.8x, 1.0x, 1.2x of damage', () => {
    const b = varianceBand(100);
    expect(b.low).toBeCloseTo(80);
    expect(b.mid).toBeCloseTo(100);
    expect(b.high).toBeCloseTo(120);
  });
});

describe('varianceBuckets', () => {
  it('returns evenly spaced band', () => {
    const b = varianceBuckets(100, 3);
    expect(b).toHaveLength(3);
    expect(b[0]).toBeCloseTo(80);
    expect(b[1]).toBeCloseTo(100);
    expect(b[2]).toBeCloseTo(120);
  });

  it('supports more buckets', () => {
    const b = varianceBuckets(100, 5);
    expect(b).toHaveLength(5);
    expect(b[0]).toBeCloseTo(80);
    expect(b[4]).toBeCloseTo(120);
  });

  it('throws on buckets < 1', () => {
    expect(() => varianceBuckets(100, 0)).toThrow();
  });
});
