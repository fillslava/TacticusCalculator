/**
 * Loader for the map-mode catalogs. Parses + caches the four JSON files
 * shipped in Phase 1 so downstream code (MapPage, initMapBattle, bossAi)
 * doesn't re-parse on every render.
 *
 * Kept parallel to `src/data/catalog.ts` rather than folded into it so
 * the existing single/team pages have zero coupling to map data — if a
 * build excludes the map layer entirely (theoretical CDN split), the
 * tree-shaker prunes map catalogs without help.
 */
import {
  BossScriptCatalogSchema,
  HexEffectCatalogSchema,
  MapCatalogSchema,
  TerrainCatalogSchema,
  type BossScript,
  type HexEffectDef,
  type MapDef,
  type TerrainDef,
  type TerrainId,
  type HexEffectId,
} from './mapSchema';
import terrainRaw from '../../data/terrain.json';
import hexEffectsRaw from '../../data/hexEffects.json';
import mapsRaw from '../../data/maps.json';
import bossScriptsRaw from '../../data/bossScripts.json';

export interface MapCatalog {
  terrain: TerrainDef[];
  terrainById: Record<TerrainId, TerrainDef>;
  hexEffects: HexEffectDef[];
  hexEffectById: Record<HexEffectId, HexEffectDef>;
  maps: MapDef[];
  mapById: Record<string, MapDef>;
  bossScripts: BossScript[];
  bossScriptById: Record<string, BossScript>;
}

let cached: MapCatalog | null = null;

export function loadMapCatalog(): MapCatalog {
  if (cached) return cached;
  const terrain = TerrainCatalogSchema.parse(terrainRaw);
  const hexEffects = HexEffectCatalogSchema.parse(hexEffectsRaw);
  const mapsParsed = MapCatalogSchema.parse(mapsRaw);
  const maps = mapsParsed.map(normaliseMapCoords);
  const bossScripts = BossScriptCatalogSchema.parse(bossScriptsRaw);
  cached = {
    terrain,
    terrainById: byId(terrain) as Record<TerrainId, TerrainDef>,
    hexEffects,
    hexEffectById: byId(hexEffects) as Record<HexEffectId, HexEffectDef>,
    maps,
    mapById: byId(maps),
    bossScripts,
    bossScriptById: byId(bossScripts),
  };
  return cached;
}

function byId<T extends { id: string }>(xs: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of xs) out[x.id] = x;
  return out;
}

/**
 * If the map declares `coordsIn: 'offsetOddR'`, rewrite every cell's
 * `{q, r}` from odd-r offset into pure axial so the engine (distance,
 * neighbours, BFS) and renderer (`hexToPixel`) can continue to treat
 * coords as axial. Cells carry their `spawn` along unchanged — it lives
 * on the same hex, so the single coord transform covers spawns too.
 *
 * The `coordsIn` flag is stripped from the returned MapDef so downstream
 * code can't accidentally re-apply the transform.
 */
function normaliseMapCoords(map: MapDef): MapDef {
  if ((map.coordsIn ?? 'axial') === 'axial') return map;
  const hexes = map.hexes.map((c) => ({
    ...c,
    q: c.q - Math.floor(c.r / 2),
    r: c.r,
  }));
  return { ...map, coordsIn: 'axial', hexes };
}
