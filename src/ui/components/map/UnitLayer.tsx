import { useMemo } from 'react';
import { hexToPixel } from '../../../map/render/layout';
import type { MapDef } from '../../../map/core/mapSchema';
import type { Unit } from '../../../map/battle/mapBattleState';

/**
 * Renders a coloured token for every live unit on the board. Size is
 * anchored to the map's `hexSizePx` so one outer-radius unit sits
 * comfortably inside a hex regardless of calibration.
 *
 * When `units` is empty this layer also renders spawn markers derived
 * from the map's `hexes[].spawn` field — that lets Phase 3 show where
 * player / boss / enemy units will appear *before* any battle is
 * actually initialised, which is what the plan's exit criteria needs
 * ("spawned markers" visible in `npm run dev`).
 */
interface Props {
  map: MapDef;
  /** Live units on the board. Empty in preview / placeholder mode. */
  units?: Unit[];
}

const SIDE_STYLE = {
  player: { fill: '#3b82f6', stroke: '#1e3a8a' }, // blue
  enemy: { fill: '#ef4444', stroke: '#7f1d1d' }, // red
  boss: { fill: '#9333ea', stroke: '#4c1d95' }, // purple
} as const;

export function UnitLayer({ map, units = [] }: Props) {
  const tokens = useMemo(() => {
    if (units.length > 0) {
      return units.map((u) => {
        const c = hexToPixel(u.position, map);
        const side =
          u.kind === 'boss' ? 'boss' : u.side === 'player' ? 'player' : 'enemy';
        return {
          key: u.id,
          x: c.x,
          y: c.y,
          label: shortLabel(u),
          fill: SIDE_STYLE[side].fill,
          stroke: SIDE_STYLE[side].stroke,
        };
      });
    }
    // No live units — render spawn markers from the map definition.
    return map.hexes
      .filter((cell) => cell.spawn)
      .map((cell) => {
        const c = hexToPixel(cell, map);
        const side =
          cell.spawn === 'boss'
            ? 'boss'
            : cell.spawn === 'enemy'
              ? 'enemy'
              : 'player';
        return {
          key: `spawn:${cell.q},${cell.r}`,
          x: c.x,
          y: c.y,
          label: cell.spawn === 'boss' ? 'B' : cell.spawn === 'enemy' ? 'E' : 'P',
          fill: SIDE_STYLE[side].fill,
          stroke: SIDE_STYLE[side].stroke,
        };
      });
  }, [map, units]);

  const r = map.hexSizePx * 0.55;
  const fontSize = Math.max(10, Math.round(map.hexSizePx * 0.5));

  return (
    <g data-layer="units">
      {tokens.map((t) => (
        <g key={t.key} transform={`translate(${t.x} ${t.y})`}>
          <circle
            r={r}
            fill={t.fill}
            stroke={t.stroke}
            strokeWidth={2}
            fillOpacity={0.85}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={fontSize}
            fontWeight={700}
            fill="#ffffff"
          >
            {t.label}
          </text>
        </g>
      ))}
    </g>
  );
}

function shortLabel(u: Unit): string {
  // Deterministic 1–2 char badge from the unit's display name or id.
  const raw = u.attacker.source.displayName ?? u.id;
  const initials = raw
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .filter(Boolean);
  if (initials.length >= 2) return initials[0] + initials[1];
  return raw.slice(0, 2).toUpperCase();
}
