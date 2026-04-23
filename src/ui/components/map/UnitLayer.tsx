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
 *
 * ## Click behaviour
 *
 * The token circle is the topmost SVG element on the board — bigger
 * than ~55 % of the hex it sits on — so its hitbox effectively owns
 * the unit. The optional `onPlayerClick` / `onEnemyClick` callbacks
 * let MapPage treat a click on the circle as a direct unit interaction
 * (select the player, attack the enemy) without the user having to
 * aim for the sliver of hex still visible around the token.
 *
 * When no callback is supplied the circle remains a passive visual
 * (preview mode, calibrator) — so z-order is a non-issue for the
 * pre-battle view where HexGrid still needs to handle spawn-point
 * clicks for the calibrator flow.
 */
interface Props {
  map: MapDef;
  /** Live units on the board. Empty in preview / placeholder mode. */
  units?: Unit[];
  /** Click a live player token. MapPage maps this to `setActiveUnit`. */
  onPlayerClick?: (unitId: string) => void;
  /** Click a live enemy/boss token. MapPage queues an attack. */
  onEnemyClick?: (unitId: string) => void;
}

const SIDE_STYLE = {
  player: { fill: '#3b82f6', stroke: '#1e3a8a' }, // blue
  mow: { fill: '#f59e0b', stroke: '#78350f' }, // amber — off-map MoW tray
  enemy: { fill: '#ef4444', stroke: '#7f1d1d' }, // red
  boss: { fill: '#9333ea', stroke: '#4c1d95' }, // purple
} as const;

type TokenSide = keyof typeof SIDE_STYLE;

interface Token {
  key: string;
  x: number;
  y: number;
  label: string;
  fill: string;
  stroke: string;
  side: TokenSide;
  unitId: string | null;
  interactive: boolean;
}

export function UnitLayer({
  map,
  units = [],
  onPlayerClick,
  onEnemyClick,
}: Props) {
  const tokens = useMemo<Token[]>(() => {
    if (units.length > 0) {
      return units.map((u) => {
        const c = hexToPixel(u.position, map);
        const side: TokenSide =
          u.kind === 'boss'
            ? 'boss'
            : u.kind === 'mow'
              ? 'mow'
              : u.side === 'player'
                ? 'player'
                : 'enemy';
        const isAlive = u.currentHp > 0;
        // MoWs use the player click handler — selecting them opens the
        // ActionPanel the same way selecting a hero does. The panel's
        // own "Move" affordance is a no-op because `reachableHexes`
        // returns only the origin for MoW kind.
        const interactive =
          isAlive &&
          (((side === 'player' || side === 'mow') && Boolean(onPlayerClick)) ||
            ((side === 'enemy' || side === 'boss') && Boolean(onEnemyClick)));
        return {
          key: u.id,
          x: c.x,
          y: c.y,
          label: shortLabel(u),
          fill: SIDE_STYLE[side].fill,
          stroke: SIDE_STYLE[side].stroke,
          side,
          unitId: u.id,
          interactive,
        };
      });
    }
    // No live units — render spawn markers from the map definition.
    // Spawn markers are never interactive (no unit to click).
    return map.hexes
      .filter((cell) => cell.spawn)
      .map((cell) => {
        const c = hexToPixel(cell, map);
        const side: TokenSide =
          cell.spawn === 'boss'
            ? 'boss'
            : cell.spawn === 'enemy'
              ? 'enemy'
              : cell.spawn === 'mow'
                ? 'mow'
                : 'player';
        const label =
          cell.spawn === 'boss'
            ? 'B'
            : cell.spawn === 'enemy'
              ? 'E'
              : cell.spawn === 'mow'
                ? 'M'
                : 'P';
        return {
          key: `spawn:${cell.q},${cell.r}`,
          x: c.x,
          y: c.y,
          label,
          fill: SIDE_STYLE[side].fill,
          stroke: SIDE_STYLE[side].stroke,
          side,
          unitId: null,
          interactive: false,
        };
      });
  }, [map, units, onPlayerClick, onEnemyClick]);

  const r = map.hexSizePx * 0.55;
  const fontSize = Math.max(10, Math.round(map.hexSizePx * 0.5));

  const handleClick = (tok: Token) => {
    if (!tok.unitId) return;
    if (tok.side === 'player' || tok.side === 'mow') onPlayerClick?.(tok.unitId);
    else onEnemyClick?.(tok.unitId);
  };

  return (
    <g data-layer="units">
      {tokens.map((t) => (
        <g
          key={t.key}
          transform={`translate(${t.x} ${t.y})`}
          style={t.interactive ? { cursor: 'pointer' } : undefined}
          onClick={t.interactive ? () => handleClick(t) : undefined}
        >
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
            // Prevent text from swallowing the click — events bubble from
            // the text back to the <g>, so without this the user would
            // need to click the thin coloured ring to trigger onClick.
            style={{ pointerEvents: 'none', userSelect: 'none' }}
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
