import { useMemo } from 'react';
import { hexPolygonPoints } from '../../../map/render/layout';
import { hexKey } from '../../../map/core/hex';
import type { MapDef, TerrainId } from '../../../map/core/mapSchema';

/**
 * Renders the hex terrain grid for a `MapDef` as SVG polygons.
 *
 * Each terrain type gets a deterministic fill + stroke so the painted
 * board stays readable without an image underneath. Blend mode is
 * `multiply`-friendly — once the real map image lands behind it, the
 * overlay darkens elevated / impassable hexes without hiding the art.
 *
 * One polygon per hex cell. No hover state yet — Phase 4 will layer
 * interactivity on top (move / attack highlight, click-to-select).
 */
interface Props {
  map: MapDef;
  /** Optional callback fired when a hex is clicked. */
  onHexClick?: (coord: { q: number; r: number }) => void;
}

/** Terrain fill/stroke palette. Tailwind-adjacent hex codes. */
const TERRAIN_STYLE: Record<
  TerrainId,
  { fill: string; stroke: string; opacity: number }
> = {
  normal: { fill: '#5b6373', stroke: '#2d323b', opacity: 0.35 },
  highGround: { fill: '#7a6b3a', stroke: '#3f381e', opacity: 0.55 },
  lowGround: { fill: '#3a4a5b', stroke: '#1e2733', opacity: 0.45 },
  razorWire: { fill: '#7a3a3a', stroke: '#3f1e1e', opacity: 0.55 },
  tallGrass: { fill: '#3a7a4a', stroke: '#1e3f25', opacity: 0.5 },
  trenches: { fill: '#5b4a3a', stroke: '#2d241e', opacity: 0.55 },
  ice: { fill: '#6a8fb0', stroke: '#35475a', opacity: 0.5 },
  brokenIce: { fill: '#4a6d85', stroke: '#25374a', opacity: 0.55 },
  bridge: { fill: '#8a7a55', stroke: '#453c2a', opacity: 0.55 },
  impassable: { fill: '#1a1d24', stroke: '#000000', opacity: 0.75 },
};

export function HexGrid({ map, onHexClick }: Props) {
  // Pre-render each polygon string once per map — hexPolygonPoints is
  // cheap but recomputing it across every React render for 200+ cells
  // adds up during drag/resize interactions in later phases.
  const polygons = useMemo(() => {
    return map.hexes.map((cell) => {
      const style = TERRAIN_STYLE[cell.terrain] ?? TERRAIN_STYLE.normal;
      return {
        key: hexKey(cell),
        q: cell.q,
        r: cell.r,
        points: hexPolygonPoints(cell, map),
        ...style,
      };
    });
  }, [map]);

  return (
    <g data-layer="hex-grid">
      {polygons.map((p) => (
        <polygon
          key={p.key}
          points={p.points}
          fill={p.fill}
          fillOpacity={p.opacity}
          stroke={p.stroke}
          strokeWidth={1}
          strokeOpacity={0.8}
          onClick={onHexClick ? () => onHexClick({ q: p.q, r: p.r }) : undefined}
          style={{ cursor: onHexClick ? 'pointer' : 'default' }}
        />
      ))}
    </g>
  );
}
