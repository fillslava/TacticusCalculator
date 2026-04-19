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
 * Resolve an API equipment reference into a catalog entry.
 *
 * The API uses its own item id scheme that doesn't match our scraped catalog:
 *   - `I_Crit_L008`           → legendary crit weapon (slot 1)
 *   - `I_Crit_M006`           → mythic crit weapon (slot 1)
 *   - `I_Block_L003`          → legendary shield (slot 2)
 *   - `I_Block_M003`          → mythic shield (slot 2)
 *   - `I_Booster_Crit_L002`   → legendary crit booster (slot 1/3)
 *   - `I_Booster_Crit_M003`   → mythic crit booster (slot 1/3)
 *   - `I_Booster_Block_L002`  → legendary block booster (slot 3)
 *   - `R_Crit_TalonOfHorus`   → relic (unique catalog entry — treat as relic stub)
 *
 * The numeric tail (008, 003, 002) is an item-family identifier, not a crit/block
 * percentage. We map to the canonical 20% variant at the given upgrade level;
 * this covers the standard-tier weapon/shield every character can use. Mythic
 * entries fall back to legendary until we have mythic catalog data — they get
 * flagged as relic so stats are skipped but the slot is still accounted for.
 */
const API_ITEM_PATTERN =
  /^I_(Booster_Crit|Booster_Block|Crit|Block|Defensive)_([CURELM])(\d+)$/i;

/**
 * Relics (`R_*`) are unique named items with bespoke stats. Until we have
 * relic-specific catalog entries, approximate each one with the strongest
 * legendary variant of the matching family so it contributes stats instead
 * of being skipped entirely.
 */
const API_RELIC_PATTERN =
  /^R_(Booster_Crit|Booster_Block|Crit|Block|Defensive)_[A-Za-z0-9]+$/i;
const RELIC_APPROX_LEVEL = 11;

const API_RARITY_LETTER: Record<string, Rarity> = {
  C: 'common',
  U: 'uncommon',
  R: 'rare',
  E: 'epic',
  L: 'legendary',
  M: 'mythic',
};

function canonicalCatalogId(
  family: string,
  rarity: Rarity,
  level: number,
): string | null {
  const f = family.toLowerCase();
  // Mythic has no catalog equivalent yet — fall back to legendary stats.
  const effectiveRarity: Rarity = rarity === 'mythic' ? 'legendary' : rarity;
  if (f === 'crit') return `crit_20_${effectiveRarity}_crit-dmg_L${level}`;
  if (f === 'block') return `block_20_${effectiveRarity}_block_L${level}`;
  if (f === 'booster_crit')
    return `crit_booster_1_${effectiveRarity}_crit-dmg_L${level}`;
  if (f === 'booster_block')
    return `block_booster_1_${effectiveRarity}_block_L${level}`;
  if (f === 'defensive')
    return `defense_0_${effectiveRarity}_armour_L${level}`;
  return null;
}

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
  const m = API_ITEM_PATTERN.exec(apiId);
  if (m) {
    const family = m[1];
    const rarity = API_RARITY_LETTER[m[2].toUpperCase()] ?? 'legendary';
    const canonicalId = canonicalCatalogId(family, rarity, apiLevel);
    if (canonicalId) {
      const hit = catalog.equipment.get(canonicalId);
      if (hit) return hit;
      const fallback = catalog.equipment.get(
        canonicalId.replace(/_L\d+$/, '_L1'),
      );
      if (fallback) return fallback;
    }
  }
  const relicMatch = API_RELIC_PATTERN.exec(apiId);
  if (relicMatch) {
    const canonicalId = canonicalCatalogId(
      relicMatch[1],
      'legendary',
      RELIC_APPROX_LEVEL,
    );
    if (canonicalId) {
      let hit = catalog.equipment.get(canonicalId);
      if (!hit) {
        for (let lvl = RELIC_APPROX_LEVEL; lvl >= 1; lvl--) {
          hit = catalog.equipment.get(canonicalId.replace(/_L\d+$/, `_L${lvl}`));
          if (hit) break;
        }
      }
      if (hit) return { ...hit, relic: true };
    }
  }
  return null;
}

export function apiUnitRarity(unit: ApiUnit): Rarity {
  // The /player endpoint doesn't expose a `rarity` string — it returns
  // `progressionIndex` instead. Derive rarity from that so heroes that have
  // ascended past legendary are treated as mythic in buff/ability scaling.
  if (unit.rarity) return API_RARITY[unit.rarity] ?? 'common';
  return progressionIndexToRarity(unit.progressionIndex);
}

// Mirrors STEPS_PER_RARITY / CUMULATIVE_START in engine/progression.ts.
// Keep this inlined — merge.ts is imported from the store during migration
// where the engine module hasn't been initialised yet.
const RARITY_RANGES: [Rarity, number, number][] = [
  ['common', 0, 2],
  ['uncommon', 3, 5],
  ['rare', 6, 8],
  ['epic', 9, 11],
  ['legendary', 12, 15],
  ['mythic', 16, 19],
];

function progressionIndexToRarity(idx: number | undefined): Rarity {
  const p = typeof idx === 'number' ? idx : 0;
  for (const [r, lo, hi] of RARITY_RANGES) {
    if (p >= lo && p <= hi) return r;
  }
  return p > 19 ? 'mythic' : 'common';
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
      rank: Math.max(0, unit.rank ?? 0),
      xpLevel: unit.xpLevel,
      rarity,
    },
    equipment,
    abilityLevels: parseUnitAbilities(unit),
  };
  return { attacker, unit };
}

export { slotNumber };
