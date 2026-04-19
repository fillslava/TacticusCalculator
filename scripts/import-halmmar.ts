import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CharactersCatalogSchema,
  BossesCatalogSchema,
  EquipmentCatalogSchema,
  CurvesSchema,
  type CharacterData,
  type BossData,
  type EquipmentData,
  DamageTypeSchema,
} from '../src/data/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const HALMMAR_JSON = join(ROOT, '..', 'tacticus-web-tool', 'tacticus.json');
const OUT_DIR = join(ROOT, 'src', 'data');

type HalmmarAttack = { hits: number; pierce: number; type: string };
type HalmmarChar = {
  active?: number[];
  passive?: number[];
  alliance: string;
  armour: number;
  damage: number;
  health: number;
  equipment?: Record<string, number>;
  faction: string;
  melee: HalmmarAttack;
  ranged?: HalmmarAttack;
  traits?: string[];
};
type HalmmarBoss = {
  armour: (number | null)[];
  checkbox?: number;
  traits?: string[];
};

function toCamelId(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

const TYPE_MAP: Record<string, string> = {
  power: 'power',
  bolter: 'bolter',
  chain: 'chain',
  las: 'las',
  melta: 'melta',
  plasma: 'plasma',
  flame: 'flame',
  psychic: 'psychic',
  direct: 'direct',
  physical: 'physical',
  piercing: 'piercing',
  energy: 'energy',
  particle: 'particle',
  projectile: 'projectile',
  pulse: 'pulse',
  toxic: 'toxic',
  bio: 'bio',
  blast: 'blast',
  eviscerating: 'eviscerating',
  molecular: 'molecular',
  gauss: 'gauss',
  heavy: 'heavyRound',
  heavyround: 'heavyRound',
  'heavy_round': 'heavyRound',
};

function mapDamageType(t: string): string {
  const k = t.toLowerCase().replace(/\s+/g, '');
  const m = TYPE_MAP[k];
  if (!m) throw new Error(`Unknown damage type "${t}" (normalized "${k}")`);
  return m;
}

function convertCharacter(name: string, h: HalmmarChar): CharacterData {
  const meleeType = mapDamageType(h.melee.type);
  const id = toCamelId(name);
  const char: CharacterData = {
    id,
    displayName: name,
    faction: h.faction,
    alliance: h.alliance,
    baseStats: {
      damage: h.damage,
      armor: h.armour,
      hp: h.health,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: h.melee.hits,
      rangedHits: h.ranged?.hits ?? 0,
    },
    melee: {
      label: 'Melee',
      damageType: DamageTypeSchema.parse(meleeType),
      hits: h.melee.hits,
      pierceOverride: h.melee.pierce,
      kind: 'melee',
    },
    ranged: h.ranged
      ? {
          label: 'Ranged',
          damageType: DamageTypeSchema.parse(mapDamageType(h.ranged.type)),
          hits: h.ranged.hits,
          pierceOverride: h.ranged.pierce,
          kind: 'ranged',
        }
      : undefined,
    abilities: (h.active ?? []).map((factor, i) => ({
      id: `${id}_active_${i + 1}`,
      name: `Active ${i + 1}`,
      kind: 'active' as const,
      curveId: 'abilityFactor',
      profile: {
        label: `Active ${i + 1}`,
        damageType: DamageTypeSchema.parse(meleeType),
        hits: 1,
        damageFactor: factor,
        kind: 'ability' as const,
        abilityId: `${id}_active_${i + 1}`,
      },
    })),
    traits: h.traits ?? [],
    maxRarity: 'legendary',
  };
  return char;
}

function convertBoss(name: string, h: HalmmarBoss): BossData {
  const id = toCamelId(name);
  const stages = h.armour
    .map((armor, i) => {
      if (armor === null) return null;
      return {
        name: `L${i}`,
        hp: 25_000_000,
        armor,
        traits: h.traits ?? [],
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  return {
    id,
    displayName: name,
    stages,
  };
}

function convertEquipment(halmmar: any): EquipmentData[] {
  const out: EquipmentData[] = [];
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
  for (const [category, byStatStr] of Object.entries<Record<string, any>>(halmmar)) {
    const isBooster = category.endsWith('_booster');
    const baseCat = isBooster ? category.slice(0, -'_booster'.length) : category;
    const slotId: 1 | 2 | 3 =
      baseCat === 'crit'
        ? 1
        : baseCat === 'block' || baseCat === 'armour' || baseCat === 'armor'
          ? 2
          : 3;
    for (const [statKey, rows] of Object.entries<Record<string, any>>(byStatStr)) {
      const statNum = Number(statKey);
      for (const rarity of rarities) {
        const entry = (rows as any)[rarity];
        if (!entry) continue;
        for (const [modField, values] of Object.entries<number[]>(entry)) {
          values.forEach((v, level) => {
            const id = `${category}_${statKey}_${rarity}_${modField}_L${level + 1}`;
            const mods: Record<string, number> = {};
            if (modField === 'crit' || modField === 'crit-dmg') {
              if (!isBooster && Number.isFinite(statNum) && statNum > 0) {
                mods.critChance = statNum / 100;
              }
              mods.critDamage = v;
            } else if (modField === 'block' || modField === 'block-dmg') {
              if (!isBooster && Number.isFinite(statNum) && statNum > 0) {
                mods.blockChance = statNum / 100;
              }
              mods.blockDamage = v;
            } else if (modField === 'damage') {
              mods.damageFlat = v;
            } else if (modField === 'armour' || modField === 'armor') {
              mods.armorFlat = v;
            } else if (modField === 'health') {
              mods.hpFlat = v;
            }
            out.push({
              id,
              slotId,
              rarity,
              level: level + 1,
              mods,
              factions: (rows as any).factions,
            });
          });
        }
      }
    }
  }
  return out;
}

function main(): void {
  const raw = JSON.parse(readFileSync(HALMMAR_JSON, 'utf8'));

  const characters: CharacterData[] = [];
  for (const [name, h] of Object.entries<HalmmarChar>(raw.characters ?? {})) {
    try {
      characters.push(convertCharacter(name, h));
    } catch (e) {
      console.warn(`skip character ${name}:`, (e as Error).message);
    }
  }

  const bosses: BossData[] = [];
  for (const [name, h] of Object.entries<HalmmarBoss>(raw.bosses ?? {})) {
    bosses.push(convertBoss(name, h));
  }

  const equipment: EquipmentData[] = convertEquipment(raw.equipment ?? {});

  const curves = {
    abilityFactor: raw.abilities_factor ?? [1.0],
    starMultiplierPerStar: 0.1,
    rarityAbilityStep: 0.2,
    gearRanks: (raw.gear ?? []).map((g: [string, number]) => [g[0], g[1]]),
  };

  CharactersCatalogSchema.parse(characters);
  BossesCatalogSchema.parse(bosses);
  EquipmentCatalogSchema.parse(equipment);
  CurvesSchema.parse(curves);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'characters.json'), JSON.stringify(characters, null, 2));
  writeFileSync(join(OUT_DIR, 'bosses.json'), JSON.stringify(bosses, null, 2));
  writeFileSync(join(OUT_DIR, 'equipment.json'), JSON.stringify(equipment, null, 2));
  writeFileSync(join(OUT_DIR, 'curves.json'), JSON.stringify(curves, null, 2));

  console.log(
    `imported: ${characters.length} characters, ${bosses.length} bosses, ${equipment.length} equipment entries`,
  );
}

main();
