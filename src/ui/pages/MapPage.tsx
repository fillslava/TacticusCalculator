import { useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { loadMapCatalog } from '../../map/core/catalog';
import type { MapDef } from '../../map/core/mapSchema';
import { HexGrid } from '../components/map/HexGrid';
import { UnitLayer } from '../components/map/UnitLayer';
import { HexEffectLayer } from '../components/map/HexEffectLayer';
import { MapCalibrator } from './MapCalibrator';

/**
 * Parse `?calibrate=1` off the current URL. `typeof window` guard keeps
 * the check SSR-safe in case the project ever adds a static-export step.
 */
function isCalibratorMode(): boolean {
  if (typeof window === 'undefined') return false;
  const sp = new URLSearchParams(window.location.search);
  return sp.get('calibrate') === '1';
}

/**
 * Top-level Map page — the hex-board sibling of SinglePage and TeamPage.
 *
 * Phase 3 scope (intentionally narrow):
 *   1. Present the map-catalog picker.
 *   2. Render the selected map: terrain grid (HexGrid) + spawn markers
 *      (UnitLayer reads `hexes[].spawn` when no live units are present) +
 *      hex-effect overlay (empty pre-battle).
 *   3. Expose a toolbar with turn counter and a placeholder mode toggle
 *      that later phases will wire up.
 *
 * No click-to-move, no click-to-attack, no boss AI, no trace export —
 * those land in Phases 4–6. The entire interactive surface is
 * deliberately read-only for now.
 *
 * The active `MapBattleState` is stored in `useApp((s) => s.map)` but is
 * null until Phase 4 adds a "Start battle" action. This page therefore
 * reads the map id from local component state (not persisted) and
 * derives everything from the static `MapDef`.
 */
export function MapPage() {
  const t = useT();
  const battle = useApp((s) => s.map);
  const catalog = useMemo(() => loadMapCatalog(), []);
  const calibrator = useMemo(() => isCalibratorMode(), []);

  // Default to the first map in the catalog. A "currentMapId" store slice
  // is a Phase 4 concern (persist the user's last pick).
  const [mapId, setMapId] = useState<string>(() => catalog.maps[0]?.id ?? '');
  const map = catalog.mapById[mapId];

  if (calibrator) return <MapCalibrator />;

  if (!map) {
    return (
      <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
        <p className="text-sm text-slate-400">{t('map.empty')}</p>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_1fr]">
      <div className="flex flex-col gap-3">
        <MapToolbar
          maps={catalog.maps}
          currentMapId={mapId}
          onPick={setMapId}
          turnIdx={battle?.turnIdx ?? 0}
        />
        <MapCanvas map={map} />
      </div>
      <ActionPanel map={map} />
    </div>
  );
}

function MapToolbar(props: {
  maps: MapDef[];
  currentMapId: string;
  onPick: (id: string) => void;
  turnIdx: number;
}) {
  const t = useT();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded border border-bg-subtle bg-bg-elevated p-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {t('map.pickMap')}
        </span>
        <select
          value={props.currentMapId}
          onChange={(e) => props.onPick(e.target.value)}
          className="rounded border border-bg-subtle bg-bg-base px-2 py-1 text-sm"
        >
          {props.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span>
          {t('map.turn')}: <span className="text-slate-200">{props.turnIdx}</span>
        </span>
        <span className="rounded bg-bg-subtle px-2 py-1 uppercase tracking-wide">
          {t('map.phase3Preview')}
        </span>
      </div>
    </header>
  );
}

function MapCanvas({ map }: { map: MapDef }) {
  const battle = useApp((s) => s.map);
  const viewBox = `0 0 ${map.image.width} ${map.image.height}`;

  return (
    <div className="overflow-hidden rounded border border-bg-subtle bg-black/50">
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full"
        style={{ aspectRatio: `${map.image.width} / ${map.image.height}` }}
      >
        {/* Background image when calibrated; otherwise a dark rectangle so
            the hex grid has clear contrast on the stub map. */}
        {map.image.href && map.image.href !== 'placeholder.png' ? (
          <image
            href={`/maps/${map.image.href}`}
            x={0}
            y={0}
            width={map.image.width}
            height={map.image.height}
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <rect
            x={0}
            y={0}
            width={map.image.width}
            height={map.image.height}
            fill="#1a1d24"
          />
        )}
        <HexGrid map={map} />
        <HexEffectLayer map={map} battle={battle} />
        <UnitLayer map={map} units={battle ? Object.values(battle.units) : []} />
      </svg>
    </div>
  );
}

function ActionPanel({ map }: { map: MapDef }) {
  const t = useT();
  const spawns = {
    player: map.hexes.filter((c) => c.spawn === 'player').length,
    enemy: map.hexes.filter((c) => c.spawn === 'enemy').length,
    boss: map.hexes.filter((c) => c.spawn === 'boss').length,
  };
  return (
    <aside className="flex flex-col gap-3 rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
      <h3 className="text-base font-semibold">{map.displayName}</h3>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-400">{t('map.hexes')}</dt>
        <dd className="text-slate-200">{map.hexes.length}</dd>
        <dt className="text-slate-400">{t('map.orientation')}</dt>
        <dd className="text-slate-200">{map.orientation}</dd>
        <dt className="text-slate-400">{t('map.spawns.player')}</dt>
        <dd className="text-slate-200">{spawns.player}</dd>
        <dt className="text-slate-400">{t('map.spawns.enemy')}</dt>
        <dd className="text-slate-200">{spawns.enemy}</dd>
        <dt className="text-slate-400">{t('map.spawns.boss')}</dt>
        <dd className="text-slate-200">{spawns.boss}</dd>
      </dl>
      <p className="text-xs leading-relaxed text-slate-400">
        {t('map.phase3Description')}
      </p>
    </aside>
  );
}
