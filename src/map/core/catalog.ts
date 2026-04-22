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
  const maps = MapCatalogSchema.parse(mapsRaw);
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
