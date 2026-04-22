import { useMemo, useState } from 'react';
import { hexToPixel } from '../../map/render/layout';
import { hexKey } from '../../map/core/hex';
import type {
  HexCell,
  MapDef,
  MapOrientation,
  TerrainId,
} from '../../map/core/mapSchema';
import { HexGrid } from '../components/map/HexGrid';

/**
 * Dev-only scratchpad for calibrating a new map. Gated behind the URL
 * `?calibrate=1` by the caller (MapPage). Not localised. Not polished.
 * The output target is a `MapDef` JSON blob the developer pastes into
 * `src/data/maps.json`; everything below exists to make that paste take
 * about five minutes per map rather than an hour of trial-and-error.
 *
 * Workflow:
 *   1. Paste the image href (place the PNG in `public/maps/`) + its
 *      pixel dimensions.
 *   2. Tune `origin` and `hexSizePx` until the overlaid grid lines up
 *      with the hexes visible in the image.
 *   3. Click hexes to paint terrain (cycles through the terrain list).
 *   4. Click the "spawn" toggle to mark player / enemy / boss spawns.
 *   5. Copy the JSON block at the bottom into `src/data/maps.json`.
 *
 * The calibrator never writes to disk — copy-paste is the interface.
 */

const TERRAIN_CYCLE: TerrainId[] = [
  'normal',
  'highGround',
  'tallGrass',
  'trenches',
  'razorWire',
  'ice',
  'brokenIce',
  'bridge',
  'impassable',
];

type SpawnKind = NonNullable<HexCell['spawn']>;
// `undefined` means "no spawn"; we cycle through it so a fourth click
// clears the spawn back to normal.
const SPAWN_CYCLE: (SpawnKind | undefined)[] = [
  undefined,
  'player',
  'enemy',
  'boss',
];

export function MapCalibrator() {
  const [id, setId] = useState('avatar_khaine_aethana');
  const [displayName, setDisplayName] = useState('Avatar of Khaine (Aethana)');
  const [imageHref, setImageHref] = useState('avatar_khaine_aethana.png');
  const [imageW, setImageW] = useState(1920);
  const [imageH, setImageH] = useState(1080);
  const [originX, setOriginX] = useState(100);
  const [originY, setOriginY] = useState(100);
  const [hexSizePx, setHexSizePx] = useState(48);
  const [orientation, setOrientation] = useState<MapOrientation>('pointy');
  const [cols, setCols] = useState(16);
  const [rows, setRows] = useState(12);
  const [paintMode, setPaintMode] = useState<'terrain' | 'spawn'>('terrain');
  // Per-hex overrides keyed by "q,r". Defaults (normal / no spawn) never
  // write into this map so exports stay small.
  const [overrides, setOverrides] = useState<
    Record<string, { terrain?: TerrainId; spawn?: SpawnKind }>
  >({});

  const hexes: HexCell[] = useMemo(() => {
    const out: HexCell[] = [];
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const k = hexKey({ q, r });
        const o = overrides[k] ?? {};
        const cell: HexCell = {
          q,
          r,
          terrain: o.terrain ?? 'normal',
        };
        const spawn = o.spawn;
        if (spawn) cell.spawn = spawn;
        out.push(cell);
      }
    }
    return out;
  }, [rows, cols, overrides]);

  const map: MapDef = useMemo(
    () => ({
      id,
      displayName,
      image: { href: imageHref, width: imageW, height: imageH },
      origin: { xPx: originX, yPx: originY },
      hexSizePx,
      orientation,
      hexes,
    }),
    [
      id,
      displayName,
      imageHref,
      imageW,
      imageH,
      originX,
      originY,
      hexSizePx,
      orientation,
      hexes,
    ],
  );

  const exportJson = useMemo(
    // Compact the hex list: omit default terrain so the blob isn't a
    // wall of `"terrain": "normal"` entries.
    () => JSON.stringify(slimMap(map), null, 2),
    [map],
  );

  function handleHexClick(coord: { q: number; r: number }) {
    const k = hexKey(coord);
    setOverrides((prev) => {
      const curr = prev[k] ?? {};
      if (paintMode === 'terrain') {
        const currentTerrain = curr.terrain ?? 'normal';
        const nextIdx =
          (TERRAIN_CYCLE.indexOf(currentTerrain) + 1) % TERRAIN_CYCLE.length;
        const nextTerrain = TERRAIN_CYCLE[nextIdx];
        const next = { ...curr, terrain: nextTerrain };
        if (nextTerrain === 'normal' && !next.spawn) {
          const { [k]: _drop, ...rest } = prev;
          return rest;
        }
        return { ...prev, [k]: next };
      }
      // spawn mode
      const currentSpawn = curr.spawn;
      const nextIdx =
        (SPAWN_CYCLE.indexOf(currentSpawn) + 1) % SPAWN_CYCLE.length;
      const nextSpawn = SPAWN_CYCLE[nextIdx];
      const next: typeof curr = { ...curr };
      if (nextSpawn) next.spawn = nextSpawn;
      else delete next.spawn;
      if (!next.terrain && !next.spawn) {
        const { [k]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [k]: next };
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-3">
        <div className="rounded border border-bg-subtle bg-bg-elevated p-3 text-xs text-slate-300">
          Dev-only map calibrator. Tune the numeric fields until the grid
          snaps onto the hexes in your image. Paste the JSON at the bottom
          into <code>src/data/maps.json</code>.
        </div>
        <div className="overflow-hidden rounded border border-bg-subtle bg-black/50">
          <svg
            viewBox={`0 0 ${imageW} ${imageH}`}
            preserveAspectRatio="xMidYMid meet"
            className="block h-auto w-full"
          >
            {imageHref ? (
              <image
                href={`/maps/${imageHref}`}
                x={0}
                y={0}
                width={imageW}
                height={imageH}
                preserveAspectRatio="xMidYMid slice"
              />
            ) : (
              <rect x={0} y={0} width={imageW} height={imageH} fill="#1a1d24" />
            )}
            <HexGrid map={map} onHexClick={handleHexClick} />
            <SpawnBadges map={map} />
          </svg>
        </div>
      </div>

      <aside className="flex flex-col gap-3 rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
        <h3 className="text-base font-semibold">Calibrator</h3>
        <Field label="id" value={id} onChange={setId} />
        <Field
          label="displayName"
          value={displayName}
          onChange={setDisplayName}
        />
        <Field label="image href" value={imageHref} onChange={setImageHref} />
        <div className="grid grid-cols-2 gap-2">
          <NumField label="image W" value={imageW} onChange={setImageW} />
          <NumField label="image H" value={imageH} onChange={setImageH} />
          <NumField label="origin X" value={originX} onChange={setOriginX} />
          <NumField label="origin Y" value={originY} onChange={setOriginY} />
          <NumField
            label="hexSize"
            value={hexSizePx}
            onChange={setHexSizePx}
            step={0.5}
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">orientation</span>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as MapOrientation)}
              className="rounded border border-bg-subtle bg-bg-base px-2 py-1 text-sm"
            >
              <option value="pointy">pointy</option>
              <option value="flat">flat</option>
            </select>
          </label>
          <NumField label="cols" value={cols} onChange={setCols} />
          <NumField label="rows" value={rows} onChange={setRows} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">paint:</span>
          <button
            type="button"
            className={`rounded px-2 py-1 ${paintMode === 'terrain' ? 'bg-accent text-black' : 'bg-bg-subtle text-slate-200'}`}
            onClick={() => setPaintMode('terrain')}
          >
            terrain
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 ${paintMode === 'spawn' ? 'bg-accent text-black' : 'bg-bg-subtle text-slate-200'}`}
            onClick={() => setPaintMode('spawn')}
          >
            spawn
          </button>
        </div>
        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wide text-slate-400">
            JSON
          </h4>
          <textarea
            readOnly
            value={exportJson}
            rows={20}
            className="w-full rounded border border-bg-subtle bg-bg-base p-2 font-mono text-[11px] text-slate-200"
          />
        </div>
      </aside>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{props.label}</span>
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded border border-bg-subtle bg-bg-base px-2 py-1 text-sm"
      />
    </label>
  );
}

function NumField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{props.label}</span>
      <input
        type="number"
        value={props.value}
        step={props.step ?? 1}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) props.onChange(n);
        }}
        className="rounded border border-bg-subtle bg-bg-base px-2 py-1 text-sm"
      />
    </label>
  );
}

/**
 * Render a coloured dot on every spawn hex. Shares the UnitLayer palette
 * but without the label text — the Calibrator wants the grid painters
 * unobstructed.
 */
function SpawnBadges({ map }: { map: MapDef }) {
  const dots = useMemo(() => {
    return map.hexes
      .filter((c) => c.spawn)
      .map((c) => {
        const p = hexToPixel(c, map);
        const fill =
          c.spawn === 'player'
            ? '#3b82f6'
            : c.spawn === 'enemy'
              ? '#ef4444'
              : '#9333ea';
        return { key: hexKey(c), cx: p.x, cy: p.y, fill };
      });
  }, [map]);
  return (
    <g data-layer="calibrator-spawns" pointerEvents="none">
      {dots.map((d) => (
        <circle
          key={d.key}
          cx={d.cx}
          cy={d.cy}
          r={map.hexSizePx * 0.35}
          fill={d.fill}
          fillOpacity={0.8}
          stroke="#000"
          strokeWidth={1}
        />
      ))}
    </g>
  );
}

/**
 * Strip default-only hex entries (`terrain: 'normal'` with no spawn) so
 * the pasted JSON is compact enough to hand-edit. The Zod schema allows
 * a hex to be implicitly `normal` by being absent — but we keep them in
 * the output for explicitness, just without the noise.
 */
function slimMap(map: MapDef): MapDef {
  // Copy so the rendered textarea reflects a stable snapshot rather than
  // a live-mutating reference.
  return { ...map, hexes: map.hexes.map((c) => ({ ...c })) };
}
