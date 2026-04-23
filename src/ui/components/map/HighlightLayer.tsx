import { useMemo } from 'react';
import { hexPolygonPoints, hexToPixel } from '../../../map/render/layout';
import { hexKey } from '../../../map/core/hex';
import type { MapBattleState, Unit } from '../../../map/battle/mapBattleState';
import { reachableHexes } from '../../../map/battle/movement';
import { attackRangeInfo } from '../../../map/battle/playerTurn';

/**
 * Phase 4 — interactive overlay. Given a selected unit, renders:
 *
 *   - Green translucent polygons on every hex the unit can move to.
 *     Includes the origin at distance 0 so the UI can render a "stay
 *     put" affordance without special-casing it.
 *   - Red outline rings on enemy units the selected unit can attack.
 *     Range is permissive in MVP (any enemy on a different hex), with
 *     per-profile range / LoS gating deferred to Phase 5+.
 *
 * Clicks split across layers:
 *   - Move clicks land on the green reachable polygons here.
 *   - Attack clicks do NOT land on the dashed attack rings — the rings
 *     are pure visual affordance (`pointerEvents: none`), and clicks on
 *     the enemy unit route through `UnitLayer`'s `onEnemyClick` instead.
 *     Two reasons: the enemy's token is bigger than the ring it sits on
 *     (so the ring never got clicked in practice), and centralising
 *     enemy-click handling in UnitLayer lets us treat the whole token
 *     as the hitbox the user actually aims for.
 */
interface Props {
  battle: MapBattleState;
  /** The selected unit. When null the layer renders nothing. */
  active: Unit | null;
  /** Click a reachable hex — MapPage turns this into a queued `move`. */
  onReachableClick?: (coord: { q: number; r: number }) => void;
}

export function HighlightLayer({
  battle,
  active,
  onReachableClick,
}: Props) {
  const reachable = useMemo(() => {
    if (!active || active.side !== 'player' || active.currentHp <= 0) return [];
    return reachableHexes(active, battle).map((r) => ({
      key: hexKey(r.hex),
      q: r.hex.q,
      r: r.hex.r,
      distance: r.distance,
      points: hexPolygonPoints(r.hex, battle.map),
    }));
  }, [active, battle]);

  const attackable = useMemo(() => {
    if (!active || active.side !== 'player' || active.currentHp <= 0) return [];
    const out: { id: string; cx: number; cy: number }[] = [];
    for (const u of Object.values(battle.units)) {
      if (u.side === 'player') continue;
      if (u.currentHp <= 0) continue;
      const { inRange } = attackRangeInfo(active, u);
      if (!inRange) continue;
      const p = hexToPixel(u.position, battle.map);
      out.push({ id: u.id, cx: p.x, cy: p.y });
    }
    return out;
  }, [active, battle]);

  if (!active) return null;

  return (
    <g data-layer="highlights">
      {/* Move range */}
      {reachable.map((h) => (
        <polygon
          key={`reach:${h.key}`}
          points={h.points}
          fill="#34d399"
          fillOpacity={h.distance === 0 ? 0.15 : 0.28}
          stroke="#34d399"
          strokeOpacity={0.85}
          strokeWidth={1.5}
          style={{ cursor: onReachableClick ? 'pointer' : 'default' }}
          onClick={
            onReachableClick ? () => onReachableClick({ q: h.q, r: h.r }) : undefined
          }
        />
      ))}
      {/* Attack range — a ring drawn around each hittable enemy. Larger
          radius than the UnitLayer token so the outline is clearly
          separate from the token body. The ring itself is non-
          interactive (`pointerEvents: none`) — clicks on the enemy are
          handled by `UnitLayer`'s `onEnemyClick`. */}
      {attackable.map((a) => (
        <circle
          key={`atk:${a.id}`}
          cx={a.cx}
          cy={a.cy}
          r={battle.map.hexSizePx * 0.7}
          fill="transparent"
          stroke="#ef4444"
          strokeOpacity={0.95}
          strokeWidth={3}
          strokeDasharray="4 3"
          style={{ pointerEvents: 'none' }}
        />
      ))}
    </g>
  );
}
