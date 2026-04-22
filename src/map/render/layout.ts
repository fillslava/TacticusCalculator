/**
 * Hex ↔ pixel geometry. One module, one responsibility: convert between
 * axial hex coords (`{q,r}`) and screen-space pixels, and emit the six
 * corner points of a hex as SVG `points=` data.
 *
 * The math follows Red Blob Games' "Hexagonal Grids" reference
 * (https://www.redblobgames.com/grids/hexagons/#hex-to-pixel) with the
 * orientation matrix packaged as a tiny struct. Every formula in this
 * file has a direct counterpart in that article.
 *
 * Coordinate conventions:
 *   • Pixel origin is the map image's top-left corner.
 *   • Y increases downward (screen convention — NOT Red Blob Games'
 *     mathematical convention). Each orientation's `f2/f3` matrix row
 *     is flipped accordingly.
 *   • `hexSizePx` is the outer radius (centre → vertex), not the flat-
 *     to-flat distance. A pointy-top hex with `hexSizePx=50` is 100px
 *     tall and ~86.6px wide; a flat-top is 100px wide and ~86.6px tall.
 *   • `origin.{xPx,yPx}` is the pixel position of hex `{q:0, r:0}`'s
 *     centre. It's how each map defines "where the (0,0) hex sits on
 *     top of the calibrated image".
 *
 * This module has no React or DOM dependencies — safe for tests,
 * calibrator tooling, and any future server-side rendering.
 */

import type { Hex, HexFrac } from '../core/hex';
import { hexRound } from '../core/hex';
import type { MapDef, MapOrientation } from '../core/mapSchema';

/** A 2-D pixel position on the map image (top-left origin). */
export interface PixelXY {
  x: number;
  y: number;
}

/**
 * Orientation matrix. `f*` converts hex → pixel, `b*` is the inverse.
 * `startAngle` is the offset (in 60° units) of the first corner:
 * pointy-top's first corner is at 30° from +x; flat-top's is at 0°.
 *
 * Kept as a module-local constant so callers pass a string orientation
 * (which is all the map schema stores) and we do the table lookup here.
 */
interface Orientation {
  f0: number;
  f1: number;
  f2: number;
  f3: number;
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  startAngle: number; // in multiples of 60°
}

const SQRT3 = Math.sqrt(3);

const POINTY: Orientation = {
  f0: SQRT3,
  f1: SQRT3 / 2,
  f2: 0,
  f3: 3 / 2,
  b0: SQRT3 / 3,
  b1: -1 / 3,
  b2: 0,
  b3: 2 / 3,
  startAngle: 0.5,
};

const FLAT: Orientation = {
  f0: 3 / 2,
  f1: 0,
  f2: SQRT3 / 2,
  f3: SQRT3,
  b0: 2 / 3,
  b1: 0,
  b2: -1 / 3,
  b3: SQRT3 / 3,
  startAngle: 0,
};

function orientationFor(o: MapOrientation): Orientation {
  return o === 'pointy' ? POINTY : FLAT;
}

/**
 * Hex-centre pixel for a given axial `{q,r}`.
 *
 * Derivation (pointy):
 *   localX = size · (√3 · q  +  √3/2 · r)
 *   localY = size · (         3/2 · r)
 * Then translate by the map origin.
 */
export function hexToPixel(h: Hex, map: MapDef): PixelXY {
  const m = orientationFor(map.orientation);
  const s = map.hexSizePx;
  const x = (m.f0 * h.q + m.f1 * h.r) * s + map.origin.xPx;
  const y = (m.f2 * h.q + m.f3 * h.r) * s + map.origin.yPx;
  return { x, y };
}

/**
 * Pixel → fractional hex (no rounding). Useful when the caller wants to
 * test which side of a boundary a point lies on, rather than which hex
 * it rounds into.
 */
export function pixelToHexFrac(p: PixelXY, map: MapDef): HexFrac {
  const m = orientationFor(map.orientation);
  const s = map.hexSizePx;
  const x = (p.x - map.origin.xPx) / s;
  const y = (p.y - map.origin.yPx) / s;
  return {
    q: m.b0 * x + m.b1 * y,
    r: m.b2 * x + m.b3 * y,
  };
}

/**
 * Pixel → integer hex. Does a cube-rounded snap via `hexRound`, so
 * points near hex boundaries tie-break consistently and the cube
 * invariant `q+r+s=0` holds on the result.
 */
export function pixelToHex(p: PixelXY, map: MapDef): Hex {
  return hexRound(pixelToHexFrac(p, map));
}

/**
 * The six corner offsets for a hex of radius `size` in the given
 * orientation, measured from the hex centre. Starts at `startAngle · 60°`
 * and walks counter-clockwise (or clockwise in screen-Y-down, same
 * thing — each corner is one of the six vertices).
 */
function hexCornerOffsets(orientation: MapOrientation, size: number): PixelXY[] {
  const m = orientationFor(orientation);
  const out: PixelXY[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * (m.startAngle + i);
    out.push({ x: size * Math.cos(angle), y: size * Math.sin(angle) });
  }
  return out;
}

/**
 * Absolute pixel positions of the six corners of hex `h` on the map.
 * Returns a fresh array of six `{x,y}` pairs — feed them to an SVG
 * `<polygon points="…">` via `.map(p => \`${p.x},${p.y}\`).join(' ')`.
 */
export function hexCornersPx(h: Hex, map: MapDef): PixelXY[] {
  const c = hexToPixel(h, map);
  const offsets = hexCornerOffsets(map.orientation, map.hexSizePx);
  return offsets.map((o) => ({ x: c.x + o.x, y: c.y + o.y }));
}

/**
 * Convenience: SVG `points=` string for hex `h`. Saves every consumer
 * from writing the same join + template.
 */
export function hexPolygonPoints(h: Hex, map: MapDef): string {
  return hexCornersPx(h, map)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
}

/**
 * Bounding box of a hex on the map — useful for view-centring a single
 * unit without routing through every corner.
 */
export function hexBounds(
  h: Hex,
  map: MapDef,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = hexCornersPx(h, map);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, minY, maxX, maxY };
}
