import type {
  Attacker,
  CatalogCharacter,
  CatalogEquipmentSlot,
  Rarity,
} from '../engine/types';
import type { Catalog } from '../data/catalog';
import type { ApiUnit, ApiUnitAbility } from './types';
import { aliasLookup, normalizeId } from './aliases';

const API_RARITY: Record<string, Rarity> = {
  Common: 'common',
  Uncommon: 'uncommon',
  Rare: 'rare',
  Epic: 'epic',
  Legendary: 'legendary',
  'Legendary+': 'legendary',
  Mythic: 'mythic',
};

export interface MergeResult {
  attacker?: Attacker;
  warning?: string;
  unit: ApiUnit;
}

function slotNumber(slotId: string): 1 | 2 | 3 {
  if (slotId === 'Slot1') return 1;
  if (slotId === 'Slot2') return 2;
  if (slotId === 'Slot3') return 3;
  const n = Number(slotId);
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

export function matchCatalogCharacter(
  apiId: string,
  catalog: Catalog,
  apiName?: string,
): CatalogCharacter | undefined {
  const direct = catalog.characters.get(apiId);
  if (direct) return direct;

  const aliasId = aliasLookup(apiId);
  if (aliasId) {
    const aliased = catalog.characters.get(aliasId);
    if (aliased) return aliased;
  }

  if (apiName) {
    const byName = matchByName(apiName, catalog);
    if (byName) return byName;
  }

  const target = normalizeId(apiId);
  if (target.length < 3) return undefined;

  let best: { c: CatalogCharacter; score: number } | null = null;
  for (const c of catalog.characters.values()) {
    const cid = normalizeId(c.id);
    const cname = normalizeId(c.displayName);
    const score = matchScore(target, cid, cname);
    if (score > 0 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c;
}

function matchByName(
  apiName: string,
  catalog: Catalog,
): CatalogCharacter | undefined {
  const target = normalizeId(apiName);
  if (target.length < 3) return undefined;
  let best: { c: CatalogCharacter; score: number } | null = null;
  for (const c of catalog.characters.values()) {
    const cname = normalizeId(c.displayName);
    if (cname === target) return c;
    const cid = normalizeId(c.id);
    if (cid === target) return c;
    if (cname.startsWith(target) || target.startsWith(cname)) {
      const score = 900 + Math.min(cname.length, target.length);
      if (!best || score > best.score) best = { c, score };
    }
  }
  return best?.c;
}

function matchScore(target: string, cid: string, cname: string): number {
  if (target === cid || target === cname) return 1000;
  if (target.startsWith(cid) && cid.length >= 3) return 800 + cid.length;
  if (cid.startsWith(target) && target.length >= 3) return 700 + target.length;
  if (target.startsWith(cname) && cname.length >= 3) return 600 + cname.length;
  if (cname.startsWith(target) && target.length >= 3) return 500 + target.length;
  if (target.endsWith(cid) && cid.length >= 4) return 450 + cid.length;
  if (target.endsWith(cname) && cname.length >= 4) return 430 + cname.length;
  if (target.includes(cid) && cid.length >= 4) return 400 + cid.length;
  if (target.includes(cname) && cname.length >= 5) return 380 + cname.length;
  if (cid.includes(target) && target.length >= 4) return 350 + target.length;
  if (cname.includes(target) && target.length >= 5) return 330 + target.length;
  return 0;
}

export interface AbilityLevelEntry {
  id: string;
  level: number;
  rarity?: Rarity;
  kind?: 'active' | 'passive';
}

export function parseUnitAbilities(unit: ApiUnit): AbilityLevelEntry[] {
  const out: AbilityLevelEntry[] = [];
  for (const raw of unit.abilities ?? []) {
    const entry = extractAbility(raw);
    if (entry) out.push(entry);
  }
  return out;
}

function extractAbility(raw: ApiUnitAbility | unknown): AbilityLevelEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id =
    typeof r.id === 'string'
      ? r.id
      : typeof r.abilityId === 'string'
        ? r.abilityId
        : typeof r.name === 'string'
          ? r.name
          : null;
  if (!id) return null;
  const level =
    typeof r.level === 'number'
      ? r.level
      : typeof r.abilityLevel === 'number'
        ? r.abilityLevel
        : typeof r.xpLevel === 'number'
          ? r.xpLevel
          : 0;
  const rarity =
    typeof r.rarity === 'string' ? API_RARITY[r.rarity] : undefined;
  const kindRaw =
    typeof r.kind === 'string'
      ? r.kind
      : typeof r.type === 'string'
        ? r.type
        : undefined;
  const kind =
    kindRaw === 'active' || kindRaw === 'Active'
      ? 'active'
      : kindRaw === 'passive' || kindRaw === 'Passive'
        ? 'passive'
        : inferKindFromId(id);
  return { id, level, rarity, kind };
}

function inferKindFromId(id: string): 'active' | 'passive' | undefined {
  const low = id.toLowerCase();
  if (low.includes('active')) return 'active';
  if (low.includes('passive')) return 'passive';
  return undefined;
}

/**
 * Resolve an API equipment reference into a catalog entry. The API may send
 * the item id either fully-qualified ("crit_20_legendary_crit-dmg_L9") or as
 * a base-tier variant ("crit_20_legendary_crit-dmg_L1") with the real upgrade
 * level in a separate `level` field. Try both.
 */
export function resolveEquipment(
  apiId: string,
  apiLevel: number,
  catalog: Catalog,
): CatalogEquipmentSlot | null {
  const direct = catalog.equipment.get(apiId);
  if (direct) return direct;
  const rewrite = apiId.replace(/_L\d+$/, `_L${apiLevel}`);
  if (rewrite !== apiId) {
    const byLevel = catalog.equipment.get(rewrite);
    if (byLevel) return byLevel;
  }
  return null;
}

export function apiUnitRarity(unit: ApiUnit): Rarity {
  return unit.rarity ? API_RARITY[unit.rarity] ?? 'common' : 'common';
}

export function mergePlayerUnitWithCatalog(
  unit: ApiUnit,
  catalog: Catalog,
): MergeResult {
  const source = matchCatalogCharacter(unit.id, catalog, unit.name);
  if (!source) {
    return {
      unit,
      warning: `Unknown unit id "${unit.id}" — not in catalog.`,
    };
  }

  const equipment: CatalogEquipmentSlot[] = [];
  for (const item of unit.items) {
    const catItem = resolveEquipment(item.id, item.level, catalog);
    if (!catItem) {
      equipment.push({
        slotId: slotNumber(item.slotId),
        id: item.id,
        rarity: (item.rarity && API_RARITY[item.rarity]) ?? 'legendary',
        level: item.level,
        mods: {},
        relic: true,
      });
      continue;
    }
    equipment.push(catItem);
  }

  const rarity = apiUnitRarity(unit);

  const attacker: Attacker = {
    source,
    progression: {
      stars: unit.progressionIndex,
      rank: unit.rank,
      xpLevel: unit.xpLevel,
      rarity,
    },
    equipment,
    abilityLevels: parseUnitAbilities(unit),
  };
  return { attacker, unit };
}

export { slotNumber };
