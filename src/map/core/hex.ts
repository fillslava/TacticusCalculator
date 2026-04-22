/**
 * Axial hex coordinate math — the foundation for map mode.
 *
 * We use **axial coordinates** `{ q, r }` following Red Blob Games'
 * conventions (see https://www.redblobgames.com/grids/hexagons/). All
 * distance, neighbour, line, ring, and flood-fill queries are
 * orientation-agnostic — the pointy-vs-flat split only matters when we
 * convert hex coords to screen pixels (see `src/map/render/layout.ts`).
 *
 * When an algorithm needs the third cube axis we derive it locally:
 *     s = -q - r
 * …so the cube invariant `q + r + s === 0` is always maintained.
 *
 * This module has zero dependencies and is pure — safe to import from
 * engine, battle, AI, or rendering code without cycles.
 */

export interface Hex {
  q: number;
  r: number;
}

/**
 * Canonical axial neighbour offsets. Order is stable so callers that
 * care about neighbour indices (e.g. hex-line tie-breaking) can rely
 * on it. Direction 0 = east; traversal is counter-clockwise for pointy
 * tops and clockwise for flat tops — the six directions are the same
 * either way, only the on-screen angle differs.
 */
export const AXIAL_DIRECTIONS: readonly Hex[] = [
  { q: +1, r: 0 },
  { q: +1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: +1 },
  { q: 0, r: +1 },
] as const;

/** Stable string key for a hex — `"q,r"`. Used as a Map/Set key. */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSubtract(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

/**
 * Hex distance in the axial/cube metric. Derivation:
 *   given cube coords (x, y, z) with x+y+z=0, distance = max(|x|,|y|,|z|)
 *   in axial form this collapses to (|dq| + |dr| + |dq+dr|) / 2.
 */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** The six axial neighbours of `h`, in `AXIAL_DIRECTIONS` order. */
export function hexNeighbors(h: Hex): Hex[] {
  return AXIAL_DIRECTIONS.map((d) => hexAdd(h, d));
}

/**
 * All hexes at exactly `radius` distance from `center` — a single ring.
 * Radius 0 returns `[center]`. Negative radius returns `[]`.
 *
 * The ring is walked by starting `radius` steps in direction 4 (south-west)
 * then taking `radius` steps in each of the other five directions in turn,
 * yielding exactly `6 * radius` hexes for any radius > 0.
 */
export function hexRing(center: Hex, radius: number): Hex[] {
  if (radius < 0) return [];
  if (radius === 0) return [{ ...center }];
  const out: Hex[] = [];
  // Start at the hex `radius` steps in direction 4 from center.
  let cursor: Hex = { q: center.q, r: center.r };
  for (let i = 0; i < radius; i++) cursor = hexAdd(cursor, AXIAL_DIRECTIONS[4]);
  // Walk 6 sides of `radius` steps each; the direction used per side is
  // offset by 2 from the usual "next direction" so the path traces a ring.
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(cursor);
      cursor = hexAdd(cursor, AXIAL_DIRECTIONS[side]);
    }
  }
  return out;
}

/** All hexes within `radius` of `center`, inclusive (includes center itself). */
export function hexRange(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let r = 0; r <= radius; r++) out.push(...hexRing(center, r));
  return out;
}

/**
 * Linear-interpolate from `a` to `b` in cube space, rounding each sample
 * back to a valid hex. Returns `hexDistance(a,b)+1` hexes (endpoints
 * inclusive). Used for line-of-sight tests and AoE aim lines.
 */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(hexRound(hexLerp(a, b, t)));
  }
  return out;
}

/**
 * BFS from `start` up to `maxSteps` moves. `blocked(h)` returns true when
 * a hex may not be entered; blocked hexes are excluded from the result.
 * Returns `start` at distance 0 even if `blocked(start)` is true — the
 * caller is responsible for filtering the origin if that matters.
 */
export function hexBfs(
  start: Hex,
  maxSteps: number,
  blocked: (h: Hex) => boolean = () => false,
): { hex: Hex; distance: number }[] {
  if (maxSteps < 0) return [{ hex: { ...start }, distance: 0 }];
  const seen = new Set<string>([hexKey(start)]);
  const frontier: { hex: Hex; distance: number }[] = [
    { hex: { ...start }, distance: 0 },
  ];
  const out: { hex: Hex; distance: number }[] = [
    { hex: { ...start }, distance: 0 },
  ];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      if (node.distance === maxSteps) continue;
      for (const n of hexNeighbors(node.hex)) {
        const k = hexKey(n);
        if (seen.has(k)) continue;
        if (blocked(n)) continue;
        seen.add(k);
        const entry = { hex: n, distance: node.distance + 1 };
        out.push(entry);
        next.push(entry);
      }
    }
    frontier.length = 0;
    frontier.push(...next);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Internal helpers — fractional hexes + cube rounding. Exposed only
// to unit tests; battle code should prefer the integer-returning API.
// ────────────────────────────────────────────────────────────────────

/** Fractional axial hex — intermediate value of `hexLerp`. */
export interface HexFrac {
  q: number;
  r: number;
}

export function hexLerp(a: Hex, b: Hex, t: number): HexFrac {
  return {
    q: a.q + (b.q - a.q) * t,
    r: a.r + (b.r - a.r) * t,
  };
}

/**
 * Round a fractional axial hex to the nearest integer hex. Classic cube
 * rounding: round each of x,y,z, then zero out the axis with the largest
 * rounding error so the cube invariant `x+y+z=0` is preserved.
 */
export function hexRound(frac: HexFrac): Hex {
  const x = frac.q;
  const z = frac.r;
  const y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);
  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  // axial: q = x, r = z. The `+ 0` normalizes IEEE-754 signed zero
  // (e.g. `-0 - 0 === -0`) so callers doing `toEqual({q:0,r:0})` don't
  // see a phantom `-0` drift through `pixelToHex` at the origin hex.
  void ry;
  return { q: rx + 0, r: rz + 0 };
}
