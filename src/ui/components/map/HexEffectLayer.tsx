import { useMemo } from 'react';
import { hexPolygonPoints } from '../../../map/render/layout';
import { hexKey } from '../../../map/core/hex';
import type { MapDef, HexEffectId } from '../../../map/core/mapSchema';
import type { MapBattleState } from '../../../map/battle/mapBattleState';

/**
 * Semi-transparent overlay for positional hex effects — Fire, Ice,
 * Contamination, Despoiled Ground, Spore Mine. Each effect has a
 * distinctive tint so a glance at the board reads the threat landscape
 * without a legend lookup.
 *
 * Effects are read from `battle.hexEffectsAt` — a map from hex coord to
 * `AppliedHexEffect[]`. Expired effects are filtered by turnIdx. When
 * multiple effects stack on one hex we draw them blended.
 *
 * This layer is passive: no click handling, no state. Phase 4+ layers
 * (HighlightLayer) handle interaction.
 */
interface Props {
  map: MapDef;
  /** Active battle. When absent, the layer is empty (preview mode). */
  battle?: MapBattleState | null;
}

/** Overlay tint per effect id. */
const EFFECT_STYLE: Record<HexEffectId, { fill: string; opacity: number }> = {
  fire: { fill: '#ff6a2e', opacity: 0.35 },
  ice: { fill: '#8fd3ff', opacity: 0.35 },
  contamination: { fill: '#8a6de0', opacity: 0.3 },
  despoiledGround: { fill: '#7a5b3a', opacity: 0.35 },
  sporeMine: { fill: '#5fa85f', opacity: 0.5 },
};

export function HexEffectLayer({ map, battle }: Props) {
  const overlays = useMemo(() => {
    if (!battle) return [];
    const out: {
      key: string;
      points: string;
      fill: string;
      opacity: number;
    }[] = [];
    for (const cell of map.hexes) {
      const applied = battle.hexEffectsAt[hexKey(cell)];
      if (!applied || applied.length === 0) continue;
      for (const a of applied) {
        if (battle.turnIdx > a.expiresAtTurn) continue;
        const style = EFFECT_STYLE[a.effectId];
        if (!style) continue;
        out.push({
          key: `${hexKey(cell)}:${a.effectId}:${a.expiresAtTurn}`,
          points: hexPolygonPoints(cell, map),
          ...style,
        });
      }
    }
    return out;
  }, [map, battle]);

  if (overlays.length === 0) return null;

  return (
    <g data-layer="hex-effects">
      {overlays.map((o) => (
        <polygon
          key={o.key}
          points={o.points}
          fill={o.fill}
          fillOpacity={o.opacity}
          stroke="none"
          pointerEvents="none"
        />
      ))}
    </g>
  );
}
