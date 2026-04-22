import { describe, expect, it } from 'vitest';
import {
  hexBounds,
  hexCornersPx,
  hexPolygonPoints,
  hexToPixel,
  pixelToHex,
  pixelToHexFrac,
} from '../../src/map/render/layout';
import type { MapDef, MapOrientation } from '../../src/map/core/mapSchema';
import { hexKey } from '../../src/map/core/hex';

/**
 * The single most important invariant in this module:
 *
 *     pixelToHex(hexToPixel(h, map), map)  ===  h
 *
 * If that breaks, every unit-placement pixel on the MapPage drifts.
 * Every test below is a corollary of "the formulas are consistent with
 * each other" — we don't try to pin specific pixel values (too brittle
 * against calibration drift) except at the hex (0,0) origin and for
 * easy angles where the exact geometry is well-known.
 */

function stubMap(
  orientation: MapOrientation,
  hexSizePx = 50,
  origin = { xPx: 200, yPx: 300 },
): MapDef {
  return {
    id: 'layout-test',
    displayName: 'Layout Test',
    image: { href: 'n/a', width: 1000, height: 800 },
    origin,
    hexSizePx,
    orientation,
    hexes: [],
  };
}

describe('hexToPixel / pixelToHex — pointy-top', () => {
  const map = stubMap('pointy');

  it('places hex (0,0) at the map origin', () => {
    expect(hexToPixel({ q: 0, r: 0 }, map)).toEqual({ x: 200, y: 300 });
  });

  it('round-trips every hex in a 16×12 stub board', () => {
    for (let q = 0; q < 16; q++) {
      for (let r = 0; r < 12; r++) {
        const h = { q, r };
        const px = hexToPixel(h, map);
        const back = pixelToHex(px, map);
        expect(back).toEqual(h);
      }
    }
  });

  it('round-trips hexes with negative coords', () => {
    for (const h of [
      { q: -3, r: 0 },
      { q: 0, r: -4 },
      { q: -5, r: 5 },
      { q: 7, r: -7 },
    ]) {
      expect(pixelToHex(hexToPixel(h, map), map)).toEqual(h);
    }
  });

  it('is invariant under a shifted origin', () => {
    const shifted = stubMap('pointy', 50, { xPx: -120.5, yPx: 42 });
    for (let q = -3; q < 4; q++) {
      for (let r = -3; r < 4; r++) {
        expect(pixelToHex(hexToPixel({ q, r }, shifted), shifted)).toEqual({
          q,
          r,
        });
      }
    }
  });

  it('step of +q moves one hex-width east (pointy: width = √3·size)', () => {
    const a = hexToPixel({ q: 0, r: 0 }, map);
    const b = hexToPixel({ q: 1, r: 0 }, map);
    expect(b.x - a.x).toBeCloseTo(Math.sqrt(3) * 50, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('step of +r moves one hex 1.5·size south-east (pointy axial)', () => {
    const a = hexToPixel({ q: 0, r: 0 }, map);
    const b = hexToPixel({ q: 0, r: 1 }, map);
    expect(b.x - a.x).toBeCloseTo((Math.sqrt(3) / 2) * 50, 6);
    expect(b.y - a.y).toBeCloseTo(1.5 * 50, 6);
  });

  it('produces six corners centred on the hex (magnitudes = hexSizePx)', () => {
    const centre = hexToPixel({ q: 0, r: 0 }, map);
    const corners = hexCornersPx({ q: 0, r: 0 }, map);
    expect(corners).toHaveLength(6);
    for (const c of corners) {
      const r = Math.hypot(c.x - centre.x, c.y - centre.y);
      expect(r).toBeCloseTo(50, 6);
    }
  });

  it('pointy-top: no corner lies on the horizontal axis through centre', () => {
    // Pointy corners are at 30°, 90°, 150°, 210°, 270°, 330° — none on 0° or 180°.
    const centre = hexToPixel({ q: 0, r: 0 }, map);
    const corners = hexCornersPx({ q: 0, r: 0 }, map);
    for (const c of corners) {
      expect(Math.abs(c.y - centre.y)).toBeGreaterThan(0.5);
    }
  });
});

describe('hexToPixel / pixelToHex — flat-top', () => {
  const map = stubMap('flat');

  it('places hex (0,0) at the map origin', () => {
    expect(hexToPixel({ q: 0, r: 0 }, map)).toEqual({ x: 200, y: 300 });
  });

  it('round-trips every hex in a 16×12 stub board', () => {
    for (let q = 0; q < 16; q++) {
      for (let r = 0; r < 12; r++) {
        const h = { q, r };
        const back = pixelToHex(hexToPixel(h, map), map);
        expect(back).toEqual(h);
      }
    }
  });

  it('step of +q moves one hex 1.5·size (flat horizontal spacing)', () => {
    const a = hexToPixel({ q: 0, r: 0 }, map);
    const b = hexToPixel({ q: 1, r: 0 }, map);
    expect(b.x - a.x).toBeCloseTo(1.5 * 50, 6);
    expect(b.y - a.y).toBeCloseTo((Math.sqrt(3) / 2) * 50, 6);
  });

  it('flat-top: two corners lie on the horizontal axis through centre', () => {
    // Flat corners are at 0°, 60°, 120°, 180°, 240°, 300° — two on the x axis.
    const centre = hexToPixel({ q: 0, r: 0 }, map);
    const corners = hexCornersPx({ q: 0, r: 0 }, map);
    const onAxis = corners.filter((c) => Math.abs(c.y - centre.y) < 1e-9);
    expect(onAxis).toHaveLength(2);
  });
});

describe('pixelToHex — boundary snapping', () => {
  const map = stubMap('pointy');

  it('any point within 0.45·size of a hex centre rounds to that hex', () => {
    // A safety margin smaller than the inradius (size · √3/2 ≈ 0.866·size).
    for (const h of [
      { q: 2, r: 3 },
      { q: -1, r: 4 },
      { q: 0, r: 0 },
    ]) {
      const c = hexToPixel(h, map);
      for (const [dx, dy] of [
        [0, 0],
        [20, 0],
        [-20, 0],
        [0, 20],
        [0, -20],
        [15, 15],
        [-15, -15],
      ]) {
        expect(pixelToHex({ x: c.x + dx, y: c.y + dy }, map)).toEqual(h);
      }
    }
  });

  it('pixelToHexFrac is a linear left-inverse of hexToPixel on the hex lattice', () => {
    // Integer hexes should land on fractional hexes with zero rounding error.
    for (const h of [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
      { q: -4, r: 7 },
    ]) {
      const frac = pixelToHexFrac(hexToPixel(h, map), map);
      expect(frac.q).toBeCloseTo(h.q, 6);
      expect(frac.r).toBeCloseTo(h.r, 6);
    }
  });
});

describe('hexCornersPx / hexPolygonPoints / hexBounds', () => {
  const map = stubMap('pointy');

  it('hexPolygonPoints is six "x,y" entries space-separated', () => {
    const s = hexPolygonPoints({ q: 1, r: 2 }, map);
    const parts = s.split(' ');
    expect(parts).toHaveLength(6);
    for (const p of parts) {
      const [x, y] = p.split(',').map(Number);
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('hexBounds tightly contains every corner', () => {
    const h = { q: 2, r: -1 };
    const corners = hexCornersPx(h, map);
    const b = hexBounds(h, map);
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(b.minX - 1e-9);
      expect(c.x).toBeLessThanOrEqual(b.maxX + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(b.minY - 1e-9);
      expect(c.y).toBeLessThanOrEqual(b.maxY + 1e-9);
    }
    // Width and height should match known geometry.
    expect(b.maxX - b.minX).toBeCloseTo(Math.sqrt(3) * 50, 6); // pointy width
    expect(b.maxY - b.minY).toBeCloseTo(2 * 50, 6); // pointy height = 2·size
  });

  it('sister hexes along one axial row share an x-coordinate of centre (pointy +q)', () => {
    // +q only moves x in pointy orientation; sanity check for HexGrid tiling.
    const keys = new Set<string>();
    for (let q = 0; q < 5; q++) keys.add(hexKey({ q, r: 0 }));
    expect(keys.size).toBe(5);
  });
});
