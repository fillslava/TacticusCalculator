import { describe, it, expect } from 'vitest';
import {
  AXIAL_DIRECTIONS,
  hexAdd,
  hexBfs,
  hexDistance,
  hexEquals,
  hexKey,
  hexLerp,
  hexLine,
  hexNeighbors,
  hexRange,
  hexRing,
  hexRound,
  hexSubtract,
} from '../../src/map/core/hex';

describe('hexDistance', () => {
  it('is zero for identical hexes', () => {
    expect(hexDistance({ q: 3, r: -2 }, { q: 3, r: -2 })).toBe(0);
  });

  it('is one between adjacent hexes in every direction', () => {
    for (const d of AXIAL_DIRECTIONS) {
      expect(hexDistance({ q: 0, r: 0 }, d)).toBe(1);
    }
  });

  it('matches the Red Blob Games axial formula on a fixture pair', () => {
    // (0,0) → (2,-1): cube = (2, -1, -1) → max(|2|,|-1|,|-1|) = 2
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
    // (1,-2) → (-2,2): cube (1,1,-2) → (-2,0,2) ; dq=3, dr=-4, |3+(-4)|=1 → (3+4+1)/2=4
    expect(hexDistance({ q: 1, r: -2 }, { q: -2, r: 2 })).toBe(4);
  });

  it('is symmetric', () => {
    expect(hexDistance({ q: 5, r: 3 }, { q: -1, r: 4 })).toBe(
      hexDistance({ q: -1, r: 4 }, { q: 5, r: 3 }),
    );
  });
});

describe('hexNeighbors', () => {
  it('returns exactly six unique hexes at distance 1', () => {
    const n = hexNeighbors({ q: 0, r: 0 });
    expect(n).toHaveLength(6);
    for (const h of n) expect(hexDistance({ q: 0, r: 0 }, h)).toBe(1);
    const keys = new Set(n.map(hexKey));
    expect(keys.size).toBe(6);
  });

  it('is translation-invariant', () => {
    const origin = hexNeighbors({ q: 0, r: 0 });
    const shifted = hexNeighbors({ q: 10, r: -4 });
    for (let i = 0; i < 6; i++) {
      expect(shifted[i]).toEqual(hexAdd(origin[i], { q: 10, r: -4 }));
    }
  });
});

describe('hexRing + hexRange', () => {
  it('hexRing(center, 0) returns just the center', () => {
    const ring = hexRing({ q: 2, r: 3 }, 0);
    expect(ring).toHaveLength(1);
    expect(ring[0]).toEqual({ q: 2, r: 3 });
  });

  it('hexRing(center, k) has 6*k hexes for k>=1', () => {
    for (let k = 1; k <= 4; k++) {
      expect(hexRing({ q: 0, r: 0 }, k)).toHaveLength(6 * k);
    }
  });

  it('every hex on a ring of radius k is exactly distance k from center', () => {
    const center = { q: -1, r: 4 };
    const ring = hexRing(center, 3);
    for (const h of ring) expect(hexDistance(center, h)).toBe(3);
  });

  it('hexRange(center, k) has 1+3k(k+1) hexes (the hex-hex number)', () => {
    // Classic: 1, 7, 19, 37, 61, ...
    expect(hexRange({ q: 0, r: 0 }, 0)).toHaveLength(1);
    expect(hexRange({ q: 0, r: 0 }, 1)).toHaveLength(7);
    expect(hexRange({ q: 0, r: 0 }, 2)).toHaveLength(19);
    expect(hexRange({ q: 0, r: 0 }, 3)).toHaveLength(37);
  });
});

describe('hexLine', () => {
  it('returns distance+1 hexes with matching endpoints', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 3, r: -1 };
    const line = hexLine(a, b);
    expect(line).toHaveLength(hexDistance(a, b) + 1);
    expect(line[0]).toEqual(a);
    expect(line[line.length - 1]).toEqual(b);
  });

  it('returns a single hex for a=b', () => {
    expect(hexLine({ q: 4, r: -2 }, { q: 4, r: -2 })).toEqual([
      { q: 4, r: -2 },
    ]);
  });

  it('every hex on the line is within distance of both endpoints', () => {
    const a = { q: -2, r: 1 };
    const b = { q: 3, r: -2 };
    const line = hexLine(a, b);
    const total = hexDistance(a, b);
    for (const h of line) {
      expect(hexDistance(a, h) + hexDistance(h, b)).toBe(total);
    }
  });
});

describe('hexBfs', () => {
  it('includes the start hex at distance 0', () => {
    const out = hexBfs({ q: 0, r: 0 }, 3);
    expect(out.find((e) => hexEquals(e.hex, { q: 0, r: 0 }))).toEqual({
      hex: { q: 0, r: 0 },
      distance: 0,
    });
  });

  it('returns the same set as hexRange when nothing is blocked', () => {
    const start = { q: 1, r: 2 };
    const radius = 3;
    const bfs = hexBfs(start, radius).map((e) => hexKey(e.hex)).sort();
    const range = hexRange(start, radius).map(hexKey).sort();
    expect(bfs).toEqual(range);
  });

  it('respects the blocked predicate', () => {
    // Block the entire ring of radius 1 — only center is reachable.
    const center = { q: 0, r: 0 };
    const blockedSet = new Set(hexRing(center, 1).map(hexKey));
    const out = hexBfs(center, 5, (h) => blockedSet.has(hexKey(h)));
    expect(out).toHaveLength(1);
    expect(out[0].hex).toEqual(center);
  });

  it('reports the shortest distance to each reachable hex', () => {
    const out = hexBfs({ q: 0, r: 0 }, 2);
    const d2 = out.filter((e) => e.distance === 2);
    expect(d2).toHaveLength(12); // ring 2 has 12 hexes
    for (const e of d2) expect(hexDistance({ q: 0, r: 0 }, e.hex)).toBe(2);
  });

  it('treats negative maxSteps as "only the start"', () => {
    const out = hexBfs({ q: 4, r: -4 }, -1);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ hex: { q: 4, r: -4 }, distance: 0 });
  });
});

describe('algebraic helpers', () => {
  it('hexAdd/hexSubtract/hexEquals round-trip', () => {
    const a = { q: 3, r: -1 };
    const d = { q: -2, r: 4 };
    expect(hexEquals(hexSubtract(hexAdd(a, d), d), a)).toBe(true);
  });

  it('hexKey is unique per hex', () => {
    expect(hexKey({ q: 0, r: 0 })).toBe('0,0');
    expect(hexKey({ q: -3, r: 4 })).toBe('-3,4');
    expect(hexKey({ q: 1, r: 2 })).not.toBe(hexKey({ q: 2, r: 1 }));
  });
});

describe('hexRound', () => {
  it('rounds exact integers to themselves', () => {
    expect(hexRound({ q: 2, r: -3 })).toEqual({ q: 2, r: -3 });
  });

  it('hexLerp at t=0 and t=1 returns endpoints after rounding', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 4, r: -2 };
    expect(hexRound(hexLerp(a, b, 0))).toEqual(a);
    expect(hexRound(hexLerp(a, b, 1))).toEqual(b);
  });

  it('preserves the cube invariant (q + r + s = 0) after rounding', () => {
    // Pick a fractional hex that exercises all three rounding branches.
    const samples = [
      { q: 0.4, r: 0.4 },
      { q: 1.5, r: -0.6 },
      { q: -2.3, r: 1.4 },
    ];
    for (const frac of samples) {
      const rounded = hexRound(frac);
      const s = -rounded.q - rounded.r;
      expect(rounded.q + rounded.r + s).toBe(0);
    }
  });
});
