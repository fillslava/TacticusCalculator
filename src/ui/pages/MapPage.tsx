import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { loadMapCatalog } from '../../map/core/catalog';
import type { MapDef } from '../../map/core/mapSchema';
import { buildMapBattleFromTeam } from '../../map/battle/hydration';
import { hexKey } from '../../map/core/hex';
import type { Unit } from '../../map/battle/mapBattleState';
import type { AttackKey } from '../../map/battle/playerTurn';
import { ActionPanel } from '../components/map/ActionPanel';
import { HexGrid } from '../components/map/HexGrid';
import { HighlightLayer } from '../components/map/HighlightLayer';
import { HexEffectLayer } from '../components/map/HexEffectLayer';
import { PredictSuggestions } from '../components/map/PredictSuggestions';
import { UnitLayer } from '../components/map/UnitLayer';
import { MapCalibrator } from './MapCalibrator';
import type { Suggestion } from '../../map/ai/policy';

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
 * Phase 4 scope:
 *   1. Map-catalog picker (carry-over from Phase 3).
 *   2. Static render path (HexGrid + UnitLayer showing spawn markers)
 *      while no battle is live — keeps the map visible while the user
 *      chooses a team elsewhere.
 *   3. "Start battle" hydrates a `MapBattleState` from the current
 *      Guild-Raid team + target, at which point the UI flips into
 *      interactive mode: click-to-select, click-to-move, click-to-attack,
 *      End turn → engine resolves the queued actions.
 *
 * The page intentionally owns all click wiring so HexGrid /
 * HighlightLayer / UnitLayer stay presentation-only and reusable by the
 * dev Calibrator. Store mutations happen inline here via useApp actions.
 */
export function MapPage() {
  const t = useT();
  const battle = useApp((s) => s.map);
  const setMap = useApp((s) => s.setMap);
  const activeUnitId = useApp((s) => s.activeUnitId);
  const setActiveUnit = useApp((s) => s.setActiveUnit);
  const queuedActions = useApp((s) => s.queuedActions);
  const queueAction = useApp((s) => s.queueAction);
  const clearQueuedActions = useApp((s) => s.clearQueuedActions);
  const lastTurnLog = useApp((s) => s.lastTurnLog);
  const endPlayerTurn = useApp((s) => s.endPlayerTurn);
  const predictMode = useApp((s) => s.mapPredictMode);
  const setPredictMode = useApp((s) => s.setMapPredictMode);
  const exportCurrentMapTrace = useApp((s) => s.exportCurrentMapTrace);

  // Snapshot of the other store slices needed by the hydrator. Read as
  // selectors so unrelated store churn doesn't rerender us.
  const teamMembers = useApp((s) => s.team.members);
  const unitBuilds = useApp((s) => s.unitBuilds);
  const teamMemberOverrides = useApp((s) => s.teamMemberOverrides);
  const fallbackBuild = useApp((s) => s.build);
  const target = useApp((s) => s.target);

  const catalog = useMemo(() => loadMapCatalog(), []);
  const calibrator = useMemo(() => isCalibratorMode(), []);

  // Map-id is deliberately local state — not persisted. When a battle is
  // active the battle's `map.id` wins over this local pick so the UI can
  // never drift into "map X selected but battle on map Y".
  const [mapId, setMapId] = useState<string>(() => catalog.maps[0]?.id ?? '');
  const currentMap = battle ? battle.map : catalog.mapById[mapId];

  const activeUnit = useMemo<Unit | null>(() => {
    if (!battle || !activeUnitId) return null;
    return battle.units[activeUnitId] ?? null;
  }, [battle, activeUnitId]);

  const handleStartBattle = useCallback(() => {
    const map = catalog.mapById[mapId];
    if (!map) return;
    const hydrated = buildMapBattleFromTeam({
      map,
      teamMembers,
      unitBuilds,
      teamMemberOverrides,
      fallback: fallbackBuild,
      target,
    });
    if (hydrated) setMap(hydrated);
  }, [
    catalog,
    mapId,
    teamMembers,
    unitBuilds,
    teamMemberOverrides,
    fallbackBuild,
    target,
    setMap,
  ]);

  const handleEndBattle = useCallback(() => {
    setMap(null);
  }, [setMap]);

  // Hex click: when a battle is live and a player unit owns the hex, set
  // it as the active selection. (Enemy clicks route through
  // HighlightLayer's `onAttackableClick` instead — HexGrid clicks are the
  // "select/deselect" channel, not the "attack" channel.)
  const handleHexClick = useCallback(
    (coord: { q: number; r: number }) => {
      if (!battle) return;
      const key = hexKey(coord);
      for (const u of Object.values(battle.units)) {
        if (u.side !== 'player') continue;
        if (u.currentHp <= 0) continue;
        if (hexKey(u.position) !== key) continue;
        setActiveUnit(u.id);
        return;
      }
      // Clicked an empty hex — don't clear selection. The user may be
      // lining up a move; let HighlightLayer's reachable polygons
      // intercept reachable-hex clicks via their own onClick.
    },
    [battle, setActiveUnit],
  );

  const handleReachableClick = useCallback(
    (coord: { q: number; r: number }) => {
      if (!activeUnit) return;
      queueAction({ kind: 'move', unitId: activeUnit.id, to: coord });
    },
    [activeUnit, queueAction],
  );

  const handleAttackableClick = useCallback(
    (targetId: string) => {
      if (!activeUnit) return;
      const pickedKey = defaultAttackKey(activeUnit);
      if (!pickedKey) return;
      queueAction({
        kind: 'attack',
        attackerId: activeUnit.id,
        targetId,
        attackKey: pickedKey,
      });
    },
    [activeUnit, queueAction],
  );

  const handlePickAttack = useCallback(
    (key: AttackKey) => {
      if (!activeUnit) return;
      // Preset: next enemy click will use this attack key. For Phase 4 we
      // keep it simple — the button doubles as "queue an attack against
      // the first live enemy", since there's only one boss in hydration.
      const firstEnemy = battle
        ? Object.values(battle.units).find(
            (u) => u.side === 'enemy' && u.currentHp > 0,
          )
        : null;
      if (!firstEnemy) return;
      queueAction({
        kind: 'attack',
        attackerId: activeUnit.id,
        targetId: firstEnemy.id,
        attackKey: key,
      });
    },
    [activeUnit, battle, queueAction],
  );

  const handlePickSuggestion = useCallback(
    (s: Suggestion) => {
      queueAction({
        kind: 'attack',
        attackerId: s.attackerId,
        targetId: s.targetId,
        attackKey: s.attackKey,
      });
    },
    [queueAction],
  );

  const handleExportTrace = useCallback(() => {
    if (!battle) return;
    const jsonl = exportCurrentMapTrace();
    if (!jsonl) return;
    // Browser download. The trace is a few KB at most — inlining it in a
    // blob URL avoids any dependency on a streaming download helper and
    // works identically in every browser that runs Vite dev.
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tacticus-${battle.map.id}-${Date.now()}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [battle, exportCurrentMapTrace]);

  if (calibrator) return <MapCalibrator />;

  if (!currentMap) {
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
          currentMapId={currentMap.id}
          onPick={setMapId}
          turnIdx={battle?.turnIdx ?? 0}
          battleActive={battle != null}
          canStart={
            teamMembers.some((m) => m.characterId) &&
            currentMap.hexes.some((c) => c.spawn === 'player') &&
            currentMap.hexes.some((c) => c.spawn === 'boss' || c.spawn === 'enemy')
          }
          onStartBattle={handleStartBattle}
          onEndBattle={handleEndBattle}
          predictMode={predictMode}
          onTogglePredict={() => setPredictMode(!predictMode)}
          canExportTrace={battle != null}
          onExportTrace={handleExportTrace}
        />
        <MapCanvas
          map={currentMap}
          onHexClick={battle ? handleHexClick : undefined}
          onReachableClick={handleReachableClick}
          onAttackableClick={handleAttackableClick}
          activeUnit={activeUnit}
        />
      </div>
      {battle ? (
        <div className="flex flex-col gap-3">
          {predictMode ? (
            <PredictSuggestions
              battle={battle}
              active={activeUnit}
              onPick={handlePickSuggestion}
            />
          ) : null}
          <ActionPanel
            battle={battle}
            active={activeUnit}
            queuedActions={queuedActions}
            lastTurnLog={lastTurnLog}
            onPickAttack={handlePickAttack}
            onClearQueue={clearQueuedActions}
            onEndTurn={endPlayerTurn}
          />
        </div>
      ) : (
        <StaticSummary map={currentMap} />
      )}
    </div>
  );
}

/**
 * Pick a default attack key when the user clicks an attackable enemy
 * directly (without having picked a profile in ActionPanel). Prefers
 * melee → ranged → first active ability to match the "just click the
 * thing" mental model.
 */
function defaultAttackKey(unit: Unit): AttackKey | null {
  if (unit.attacker.source.melee) return 'melee';
  if (unit.attacker.source.ranged) return 'ranged';
  const firstActive = unit.attacker.source.abilities.find(
    (a) => a.kind === 'active' && a.profiles.length > 0,
  );
  return firstActive ? (`ability:${firstActive.id}` as AttackKey) : null;
}

function MapToolbar(props: {
  maps: MapDef[];
  currentMapId: string;
  onPick: (id: string) => void;
  turnIdx: number;
  battleActive: boolean;
  canStart: boolean;
  onStartBattle: () => void;
  onEndBattle: () => void;
  predictMode: boolean;
  onTogglePredict: () => void;
  canExportTrace: boolean;
  onExportTrace: () => void;
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
          disabled={props.battleActive}
          className="rounded border border-bg-subtle bg-bg-base px-2 py-1 text-sm disabled:opacity-50"
        >
          {props.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>
          {t('map.turn')}: <span className="text-slate-200">{props.turnIdx}</span>
        </span>
        {props.battleActive ? (
          <>
            <button
              type="button"
              onClick={props.onTogglePredict}
              aria-pressed={props.predictMode}
              className={
                'rounded border px-2 py-1 text-xs ' +
                (props.predictMode
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-bg-subtle bg-bg-base hover:border-accent hover:text-accent')
              }
              title="Toggle predict mode — show ranked action suggestions for the active unit."
            >
              Predict {props.predictMode ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={props.onExportTrace}
              disabled={!props.canExportTrace}
              className="rounded border border-bg-subtle bg-bg-base px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-40"
              title="Download the battle's JSONL trace for future ML training."
            >
              Export trace
            </button>
            <span className="rounded bg-bg-subtle px-2 py-1 uppercase tracking-wide text-accent">
              {t('map.battleActive')}
            </span>
            <button
              type="button"
              onClick={props.onEndBattle}
              className="rounded border border-bg-subtle bg-bg-base px-3 py-1 text-xs hover:border-accent hover:text-accent"
            >
              {t('map.endBattle')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={props.onStartBattle}
            disabled={!props.canStart}
            className="rounded bg-accent px-3 py-1 text-xs font-semibold text-black disabled:opacity-40"
          >
            {t('map.startBattle')}
          </button>
        )}
      </div>
    </header>
  );
}

function MapCanvas(props: {
  map: MapDef;
  onHexClick?: (coord: { q: number; r: number }) => void;
  onReachableClick: (coord: { q: number; r: number }) => void;
  onAttackableClick: (unitId: string) => void;
  activeUnit: Unit | null;
}) {
  const battle = useApp((s) => s.map);
  const viewBox = `0 0 ${props.map.image.width} ${props.map.image.height}`;

  return (
    <div className="overflow-hidden rounded border border-bg-subtle bg-black/50">
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full"
        style={{ aspectRatio: `${props.map.image.width} / ${props.map.image.height}` }}
      >
        {/* Background image when calibrated; otherwise a dark rectangle so
            the hex grid has clear contrast on the stub map. */}
        {props.map.image.href && props.map.image.href !== 'placeholder.png' ? (
          <image
            href={`/maps/${props.map.image.href}`}
            x={0}
            y={0}
            width={props.map.image.width}
            height={props.map.image.height}
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <rect
            x={0}
            y={0}
            width={props.map.image.width}
            height={props.map.image.height}
            fill="#1a1d24"
          />
        )}
        <HexGrid map={props.map} onHexClick={props.onHexClick} />
        <HexEffectLayer map={props.map} battle={battle} />
        {battle && props.activeUnit && (
          <HighlightLayer
            battle={battle}
            active={props.activeUnit}
            onReachableClick={props.onReachableClick}
            onAttackableClick={props.onAttackableClick}
          />
        )}
        <UnitLayer
          map={props.map}
          units={battle ? Object.values(battle.units) : []}
        />
      </svg>
    </div>
  );
}

/**
 * Pre-battle side panel — shown when `battle == null`. Mirrors the
 * Phase-3 read-only summary so the map picker remains informative before
 * the user clicks "Start battle".
 */
function StaticSummary({ map }: { map: MapDef }) {
  const t = useT();
  const teamMembers = useApp((s) => s.team.members);
  const populatedSlots = teamMembers.filter((m) => m.characterId).length;
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
        {populatedSlots === 0 ? t('map.needTeam') : t('map.phase4Note')}
      </p>
    </aside>
  );
}
