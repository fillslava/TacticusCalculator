import type { Rarity, TurnBuff } from './types';
import { loadCatalog } from '../data/catalog';
import { rarityAbilityMultiplier } from './scaling';
import abilityTables from '../data/abilityTables.json';

export interface BuffPreset extends Omit<TurnBuff, 'id'> {
  description?: string;
  /**
   * Ability-scaling coefficient. When set, `damageFlat` is computed as
   * `baseDamageCoef * abilityFactor[level-1] * rarityAbilityMultiplier(rarity)`.
   * Calibrated from known in-game tooltip values.
   */
  baseDamageCoef?: number;
  /**
   * Per-xpLevel damage table imported from gameinfo.json (one entry per level,
   * 65 entries). When set, `damageFlat` is computed as
   * `table[level-1] * rarityAbilityMultiplier(rarity)`. This matches the
   * in-game tooltip value exactly for the listed buffer at the displayed
   * level/rarity, because gameinfo stores the pre-rarity base and the game
   * multiplies by a rarity bonus (common=1.0, mythic=1.5).
   */
  damageTable?: number[];
  /**
   * Same shape as `damageTable` but for crit-chance buffs (values are 0-100
   * in gameinfo, converted to 0-1 fractions at apply time).
   */
  critChanceTable?: number[];
  /**
   * Same shape as `damageTable` but for crit-damage buffs (flat bonus).
   */
  critDamageTable?: number[];
}

const DEFAULT_BUFF_LEVEL = 50;
const DEFAULT_BUFF_RARITY: Rarity = 'legendary';

interface AbilityTableEntry {
  name: string;
  variablesAffectedByRarityBonus: string[] | null;
  constants: Record<string, string> | null;
  tables: Record<string, number[]>;
}

const TABLES = abilityTables as Record<string, AbilityTableEntry>;

function table(abilityId: string, varKey: string): number[] {
  const entry = TABLES[abilityId];
  if (!entry) throw new Error(`abilityTables.json missing "${abilityId}"`);
  const arr = entry.tables[varKey];
  if (!arr) throw new Error(`abilityTables.json["${abilityId}"] missing variable "${varKey}"`);
  return arr;
}

function lookup(arr: number[], level: number): number {
  const idx = Math.max(0, Math.min(level - 1, arr.length - 1));
  return arr[idx] ?? 0;
}

/**
 * Compute flat ability damage from a calibration coefficient. Mirrors the
 * ability scaling used for a unit's own abilities.
 */
export function computeBuffDamage(
  baseDamageCoef: number,
  level: number,
  rarity: Rarity,
): number {
  const curveTable = loadCatalog().curves.abilityFactor;
  const idx = Math.max(0, Math.min(level - 1, curveTable.length - 1));
  const factor = curveTable[idx] ?? 1;
  return Math.round(baseDamageCoef * factor * rarityAbilityMultiplier(rarity));
}

/**
 * Per-xpLevel damage tables (imported from gameinfo.json). Keyed by a stable
 * preset-local name so presets can reference them without embedding 65-entry
 * arrays inline.
 */
const DMG_DOOM_AELDARI = table('Doom', 'extraDmg_2');
const DMG_DOOM_OTHER = table('Doom', 'extraDmg');
const DMG_CALGAR_IMPERIAL = table('RitesOfBattle', 'extraDmg_2');
const DMG_ABADDON_CHAOS_BASE = table('FirstAmongTraitors', 'extraDmg');
const DMG_ABADDON_CHAOS_MAX = table('FirstAmongTraitors', 'maxDmg');
const DMG_TRAJANN = table('LegendaryCommander', 'extraDmg');
const DMG_AETHANA = table('PathOfCommand', 'extraDmg');
const DMG_AETHANA_AELDARI_BONUS = table('PathOfCommand', 'extraDmg_2');
const CC_AETHANA = table('PathOfCommand', 'extraCritChance');
const DMG_GULGORTZ = table('Waaagh', 'extraDmg');
const DMG_HELBRECHT_VS_PSYKER = table('DestroyTheWitch', 'extraDmg');
const DMG_DARKSTRIDER = table('StructuralAnalyser', 'extraDmg');
const DMG_THADDEUS = table('SpotterReworked', 'extraDmg_2');
const DMG_SHADOWSUN = table('DefenderOfTheGreaterGood', 'extraDmg');
const CRITDMG_RAGNAR = table('SagaOfTheWarriorBorn', 'extraCritDmg');

/**
 * Preset damage bonuses for buffer abilities. Every `damageTable` maps
 * directly to a gameinfo.json per-level array (index 0 = character xpLevel 1).
 * The final applied value is `table[level-1] * rarityAbilityMultiplier(rarity)`.
 */
export const BUFF_PRESETS: BuffPreset[] = [
  {
    name: 'Eldryon — Aeldari damage',
    description:
      'Passive Doom. Aeldari allies deal +extraDmg_2 damage to marked enemies. Other allies deal +extraDmg. This preset is the Aeldari (higher) variant.',
    damageTable: DMG_DOOM_AELDARI,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Eldryon — Non-Aeldari damage',
    description:
      'Passive Doom. Non-Aeldari allies deal +extraDmg damage to marked enemies. Use this when your attacker is not Aeldari.',
    damageTable: DMG_DOOM_OTHER,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Calgar — Imperial damage',
    description:
      'Passive Rites of Battle. Adjacent Imperial allies gain +extraDmg_2 damage (higher than the general adjacency buff).',
    damageTable: DMG_CALGAR_IMPERIAL,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Abaddon — Chaos damage (base)',
    description:
      'Passive First Among Traitors. Chaos allies within 2 hexes gain +extraDmg damage. Stacks per Abaddon attack (13 attacks for max).',
    damageTable: DMG_ABADDON_CHAOS_BASE,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Abaddon — Chaos damage (max stacks)',
    description:
      'Passive First Among Traitors at 13 stacks. Chaos allies gain +maxDmg damage. Use for rotation turns after Abaddon has attacked 13+ times.',
    damageTable: DMG_ABADDON_CHAOS_MAX,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Trajann — Legendary Commander',
    description:
      'Passive. Enemies adjacent to friendly units that used active abilities this turn take +extraDmg damage. Applies as a target debuff.',
    damageTable: DMG_TRAJANN,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Aethana — Path of Command',
    description:
      'Passive. Allies within 2 hexes gain +extraDmg damage and +extraCritChance crit chance. Aeldari allies gain additional +extraDmg_2 damage (both tables applied).',
    damageTable: DMG_AETHANA,
    critChanceTable: CC_AETHANA,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Aethana — Aeldari bonus (stack on top)',
    description:
      'Passive Path of Command. Aeldari-only additional +extraDmg_2 damage on top of the base buff.',
    damageTable: DMG_AETHANA_AELDARI_BONUS,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: "Gulgortz — Waaagh! (Ork damage)",
    description:
      'Active Waaagh. Adjacent Orks & adjacent friendlies gain +extraDmg melee damage and +1 hit on their normal melee attack this turn.',
    damageTable: DMG_GULGORTZ,
    bonusHits: 1,
    bonusHitsOn: 'normal',
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Helbrecht — Vs Psykers',
    description:
      'Passive Destroy the Witch. This unit and adjacent friendlies deal +extraDmg melee damage against Psykers.',
    damageTable: DMG_HELBRECHT_VS_PSYKER,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Darkstrider — Markerlight',
    description:
      'Passive Structural Analyser. Allies adjacent to Darkstrider (and Tau within 2 hexes) deal +extraDmg ranged damage to markerlit targets.',
    damageTable: DMG_DARKSTRIDER,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Thaddeus — Spotter (Heavy Weapon)',
    description:
      'Passive Spotter. Allies within 2 hexes with Heavy Weapon deal +extraDmg_2 ranged damage (non-heavy allies get the lower extraDmg bonus).',
    damageTable: DMG_THADDEUS,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Shadowsun — Tau ranged',
    description:
      'Passive Defender of the Greater Good. Adjacent allies (+Tau within 2 hexes) gain +extraDmg on ranged non-psychic attacks.',
    damageTable: DMG_SHADOWSUN,
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Ragnar — Saga of the Warrior Born (crit dmg)',
    description:
      'Passive. Charging attacks: +extraHits hits and +extraCritDmg crit damage. Applied here as +critDamage (flat) + bonusHits on charge.',
    critDamageTable: CRITDMG_RAGNAR,
    bonusHits: 1,
    bonusHitsOn: 'normal',
    level: DEFAULT_BUFF_LEVEL,
    rarity: DEFAULT_BUFF_RARITY,
  },
  {
    name: 'Thaddeus — Extra hit first turn',
    description:
      'First-turn ability grants Thaddeus and key allies an extra hit on their next attack. Modeled as +1 hit on turn 1. Damage bonus is separate.',
    damageFlat: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
    bonusHits: 1,
    bonusHitsOn: 'first',
  },
  {
    name: 'Heavy Weapon — Bonus ability hit',
    description:
      'Heavy weapon carriers can gain an extra hit on active abilities through various passives/items. No built-in damage bonus.',
    bonusHits: 1,
    bonusHitsOn: 'ability',
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
  },
  {
    name: 'Custom',
    description: 'Blank slate — enter whatever numeric effects you want.',
    damageFlat: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
  },
];

export function presetToBuff(
  preset: BuffPreset,
  overrides?: { level?: number; rarity?: Rarity },
): TurnBuff {
  const {
    description: _description,
    baseDamageCoef,
    damageTable,
    critChanceTable,
    critDamageTable,
    ...rest
  } = preset;
  const level = overrides?.level ?? rest.level ?? DEFAULT_BUFF_LEVEL;
  const rarity = overrides?.rarity ?? rest.rarity ?? DEFAULT_BUFF_RARITY;
  const rarityMul = rarityAbilityMultiplier(rarity);

  let damageFlat = rest.damageFlat ?? 0;
  if (damageTable) {
    damageFlat = Math.round(lookup(damageTable, level) * rarityMul);
  } else if (baseDamageCoef) {
    damageFlat = computeBuffDamage(baseDamageCoef, level, rarity);
  }

  let critChance = rest.critChance ?? 0;
  if (critChanceTable) {
    critChance = +(lookup(critChanceTable, level) * rarityMul / 100).toFixed(4);
  }

  let critDamage = rest.critDamage ?? 0;
  if (critDamageTable) {
    critDamage = Math.round(lookup(critDamageTable, level) * rarityMul);
  }

  const out: TurnBuff = {
    id: `buff_${Math.random().toString(36).slice(2, 9)}`,
    ...rest,
    level,
    rarity,
    damageFlat,
  };
  if (critChance) out.critChance = critChance;
  if (critDamage) out.critDamage = critDamage;
  if (baseDamageCoef) out.baseDamageCoef = baseDamageCoef;
  return out;
}

export function findPresetByName(name: string): BuffPreset | undefined {
  return BUFF_PRESETS.find((p) => p.name === name);
}

/**
 * Re-apply a preset's tables to a buff when its level/rarity changes (used by
 * the rotation editor). Returns the fields that should be patched, or `null`
 * if the buff has no calibration data.
 */
export function recomputeBuffFromTables(
  buff: Pick<
    TurnBuff,
    'name' | 'level' | 'rarity' | 'damageFlat' | 'critChance' | 'critDamage'
  >,
): Partial<Pick<TurnBuff, 'damageFlat' | 'critChance' | 'critDamage'>> | null {
  const preset = findPresetByName(buff.name);
  if (!preset) return null;
  const level = buff.level ?? DEFAULT_BUFF_LEVEL;
  const rarity = buff.rarity ?? DEFAULT_BUFF_RARITY;
  const rarityMul = rarityAbilityMultiplier(rarity);
  const patch: Partial<
    Pick<TurnBuff, 'damageFlat' | 'critChance' | 'critDamage'>
  > = {};
  if (preset.damageTable) {
    patch.damageFlat = Math.round(lookup(preset.damageTable, level) * rarityMul);
  } else if (preset.baseDamageCoef) {
    patch.damageFlat = computeBuffDamage(preset.baseDamageCoef, level, rarity);
  }
  if (preset.critChanceTable) {
    patch.critChance = +(
      (lookup(preset.critChanceTable, level) * rarityMul) /
      100
    ).toFixed(4);
  }
  if (preset.critDamageTable) {
    patch.critDamage = Math.round(
      lookup(preset.critDamageTable, level) * rarityMul,
    );
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
