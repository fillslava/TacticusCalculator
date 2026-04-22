/**
 * Generate mythic-tier equipment entries and append to src/data/equipment.json.
 *
 * Wiki source: https://tacticus.wiki.gg/wiki/Equipment (fetched 2025-11 for the
 * v2 mythic-progression patch). The wiki lists L1 and L10 anchor values for each
 * mythic variant; intermediate levels L2..L9 are linearly interpolated here.
 * This is an *approximation* — the real curve is not perfectly linear (see the
 * legendary L1..L11 curves in equipment.json for the pattern), but without
 * per-level wiki data it's the best shape we have. The error is bounded by the
 * L1/L10 endpoints matching exactly, so any single-item calibration against the
 * in-game preview will still pass at those levels.
 *
 * Idempotent: existing entries with the same `id` are left untouched. Re-running
 * the script after we later add more accurate per-level data is safe — delete
 * the stale mythic entries first, then re-run.
 *
 * Usage: `npx tsx scripts/generate-mythic-equipment.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EquipmentCatalogSchema,
  type EquipmentData,
} from '../src/data/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const EQUIP_JSON = join(ROOT, 'src', 'data', 'equipment.json');

/** Faction list for the crit weapon 20% variant (most-common pool). */
const CRIT_20_FACTIONS = [
  'Necrons',
  'Adepta Sororitas',
  'Adeptus Mechanicus',
  'Astra militarum',
  'Black Legion',
  'Black templars',
  'Blood Angels',
  'Dark Angels',
  'Death Guard',
  'Genestealer Cults',
  'Orks',
  'Space Wolves',
  'Thousand Sons',
  'Ultramarines',
  'World Eaters',
];

/** Faction list for the crit weapon 25% variant. */
const CRIT_25_FACTIONS = [
  'Genestealer Cults',
  'Tyranids',
  'Astra militarum',
  'Aeldari',
  "T'au Empire",
  'Thousand Sons',
  'Adeptus Mechanicus',
  'World Eaters',
];

/** Faction list for the crit weapon 35% variant. */
const CRIT_35_FACTIONS = [
  'Adepta Sororitas',
  'Adeptus Mechanicus',
  'Astra militarum',
  'Black templars',
  'Blood Angels',
  'Dark Angels',
  'Space Wolves',
  'Ultramarines',
  'World Eaters',
  'Black Legion',
  'Death Guard',
  'Thousand Sons',
  'Necrons',
  'Orks',
  'Aeldari',
  "T'au Empire",
];

/** Broad faction list for crit-booster variant (slot 1 plug-in). */
const CRIT_BOOSTER_FACTIONS = [
  'Adepta Sororitas',
  'Adeptus Mechanicus',
  'Astra militarum',
  'Black templars',
  'Blood Angels',
  'Dark Angels',
  'Space Wolves',
  'Ultramarines',
  'Black Legion',
  'Death Guard',
  'Thousand Sons',
  'World Eaters',
  'Necrons',
  'Orks',
  'Aeldari',
  "T'au Empire",
  'Tyranids',
  'Genestealer Cults',
];

/** Faction list for block shield 30% variant. */
const BLOCK_30_FACTIONS = [
  'Adepta Sororitas',
  'Adeptus Mechanicus',
  'Astra militarum',
  'Black Legion',
  'Black templars',
  'Dark Angels',
  'Death Guard',
  'Genestealer Cults',
  'Orks',
  'Necrons',
  'Aeldari',
  "T'au Empire",
  'Thousand Sons',
  'Tyranids',
  'Ultramarines',
  'World Eaters',
  'Space Wolves',
];

/** Faction list for block-booster variant (slot 2 plug-in). */
const BLOCK_BOOSTER_FACTIONS = BLOCK_30_FACTIONS;

/** Faction list for defense slot items (both armour-only and hp+armour). */
const DEFENSE_FACTIONS = [
  'Black templars',
  'Blood Angels',
  'Dark Angels',
  'Space Wolves',
  'Ultramarines',
  'Adepta Sororitas',
  'Adeptus Mechanicus',
  'Astra militarum',
  'Aeldari',
  'Necrons',
  "T'au Empire",
  'Black Legion',
  'Death Guard',
  'Genestealer Cults',
  'Orks',
  'Thousand Sons',
  'World Eaters',
  'Tyranids',
];

type Interp = { l1: number; l10: number };

/** Linear interpolation between L1 and L10 endpoints. Rounds to integer. */
function interp(level: number, { l1, l10 }: Interp): number {
  if (level <= 1) return l1;
  if (level >= 10) return l10;
  const t = (level - 1) / 9;
  return Math.round(l1 + (l10 - l1) * t);
}

interface MythicSpec {
  idPrefix: string;
  slotId: 1 | 2 | 3;
  maxLevel: number;
  factions: string[];
  baseMods: Partial<Record<string, number>>;
  scaling: Record<string, Interp>;
}

/**
 * Mythic equipment specs. `idPrefix` gets `_L<n>` appended. `baseMods` supplies
 * flat values that don't scale with level (e.g. chance %). `scaling` names each
 * stat whose value depends on level and its L1/L10 anchors.
 */
const SPECS: MythicSpec[] = [
  // Crit weapon 20% (slot 1)
  {
    idPrefix: 'crit_20_mythic_crit-dmg',
    slotId: 1,
    maxLevel: 10,
    factions: CRIT_20_FACTIONS,
    baseMods: { critChance: 0.2 },
    scaling: { critDamage: { l1: 1835, l10: 2727 } },
  },
  // Crit weapon 25% (slot 1)
  {
    idPrefix: 'crit_25_mythic_crit-dmg',
    slotId: 1,
    maxLevel: 10,
    factions: CRIT_25_FACTIONS,
    baseMods: { critChance: 0.25 },
    scaling: { critDamage: { l1: 1470, l10: 2185 } },
  },
  // Crit weapon 35% (slot 1)
  {
    idPrefix: 'crit_35_mythic_crit-dmg',
    slotId: 1,
    maxLevel: 10,
    factions: CRIT_35_FACTIONS,
    baseMods: { critChance: 0.35 },
    scaling: { critDamage: { l1: 1050, l10: 1561 } },
  },
  // Crit booster 6% (slot 1 plug-in)
  {
    idPrefix: 'crit_booster_1_mythic_crit-dmg',
    slotId: 1,
    maxLevel: 10,
    factions: CRIT_BOOSTER_FACTIONS,
    baseMods: { critChance: 0.06 },
    scaling: { critDamage: { l1: 350, l10: 521 } },
  },
  // Block shield 30% (slot 2)
  {
    idPrefix: 'block_30_mythic_block',
    slotId: 2,
    maxLevel: 10,
    factions: BLOCK_30_FACTIONS,
    baseMods: { blockChance: 0.3 },
    scaling: { blockDamage: { l1: 1230, l10: 1828 } },
  },
  // Block booster 6% (slot 2 plug-in)
  {
    idPrefix: 'block_booster_1_mythic_block',
    slotId: 2,
    maxLevel: 10,
    factions: BLOCK_BOOSTER_FACTIONS,
    baseMods: { blockChance: 0.06 },
    scaling: { blockDamage: { l1: 350, l10: 521 } },
  },
  // Defense armour-only (slot 3)
  {
    idPrefix: 'defense_0_mythic_armour',
    slotId: 3,
    maxLevel: 10,
    factions: DEFENSE_FACTIONS,
    baseMods: {},
    scaling: { armorFlat: { l1: 440, l10: 654 } },
  },
  // Defense hp+armour hybrid (slot 3)
  {
    idPrefix: 'defense_0_mythic_health',
    slotId: 3,
    maxLevel: 10,
    factions: DEFENSE_FACTIONS,
    baseMods: {},
    scaling: {
      hpFlat: { l1: 725, l10: 1078 },
      armorFlat: { l1: 295, l10: 439 },
    },
  },
];

function buildEntries(spec: MythicSpec): EquipmentData[] {
  const out: EquipmentData[] = [];
  for (let lvl = 1; lvl <= spec.maxLevel; lvl++) {
    const mods: Record<string, number> = { ...spec.baseMods } as Record<
      string,
      number
    >;
    for (const [stat, pts] of Object.entries(spec.scaling)) {
      mods[stat] = interp(lvl, pts);
    }
    out.push({
      id: `${spec.idPrefix}_L${lvl}`,
      slotId: spec.slotId,
      rarity: 'mythic',
      level: lvl,
      mods,
      factions: spec.factions,
    });
  }
  return out;
}

function main(): void {
  const raw = readFileSync(EQUIP_JSON, 'utf-8');
  const existing: EquipmentData[] = EquipmentCatalogSchema.parse(
    JSON.parse(raw),
  );
  const seen = new Set(existing.map((e) => e.id));

  const additions: EquipmentData[] = [];
  for (const spec of SPECS) {
    for (const entry of buildEntries(spec)) {
      if (seen.has(entry.id)) continue;
      additions.push(entry);
    }
  }

  if (additions.length === 0) {
    console.log('No new mythic entries to add — catalog already up to date.');
    return;
  }

  const merged = [...existing, ...additions];
  // Re-validate before writing so a schema drift fails loudly here, not at
  // runtime in the browser.
  EquipmentCatalogSchema.parse(merged);

  writeFileSync(EQUIP_JSON, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  console.log(
    `Added ${additions.length} mythic equipment entries to equipment.json.`,
  );
  for (const a of additions) {
    console.log(`  + ${a.id}`);
  }
}

main();
