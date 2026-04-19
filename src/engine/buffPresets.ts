import type { TurnBuff } from './types';

export interface BuffPreset extends Omit<TurnBuff, 'id'> {
  description?: string;
}

const DEFAULT_BUFF_LEVEL = 50;

/**
 * Preset placeholders for buffer abilities. The `+dmg` numbers here are
 * scaffolding — they do NOT come from in-game data (the calculator doesn't
 * scrape ability tables yet). Read the preset's in-game tooltip for your
 * ability level and rarity, then edit the +dmg value in the Rotation editor.
 *
 * The descriptions document the buff's in-game effect so you can pick the
 * right preset and enter the right number.
 */
export const BUFF_PRESETS: BuffPreset[] = [
  {
    name: 'Eldryon — Aeldari damage',
    description:
      'Aeldari allies gain flat bonus damage. Amplified vs Aeldari targets. Enter Eldryon\'s listed ability damage bonus (tooltip) for your level/rarity.',
    damageFlat: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
  },
  {
    name: 'Calgar — Imperial damage',
    description:
      'Imperial allies gain damage; higher bonus vs Imperial targets. Enter Calgar\'s listed active ability damage bonus from the in-game tooltip.',
    damageFlat: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
  },
  {
    name: 'Abaddon — Chaos command',
    description:
      'All Chaos allies gain damage plus a team crit bonus. Enter the damage bonus portion here; the crit portion is separate.',
    damageFlat: 0,
    critChance: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
  },
  {
    name: 'Shadowsun — T\'au targeting',
    description: 'T\'au allies gain ranged damage. Applies mainly to ranged profiles. Enter the tooltip value.',
    damageFlat: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
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
    name: 'Aethana — Crit chance',
    description: 'Targeted ally gains flat damage and elevated crit chance. Enter the tooltip values.',
    damageFlat: 0,
    critChance: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
  },
  {
    name: 'Ragnar — Savage blow',
    description:
      'Targeted ally gains damage, crit chance, and +1 hit on their next normal attack. Enter tooltip values.',
    damageFlat: 0,
    critChance: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
    bonusHits: 1,
    bonusHitsOn: 'normal',
  },
  {
    name: 'Darkstrider — Marked target',
    description: 'Marked enemy takes extra damage from all attackers. Enter tooltip damage bonus.',
    damageFlat: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
  },
  {
    name: 'Helbrecht — Righteous fury',
    description: 'Space Marines of the Emperor gain damage, amplified vs psykers. Enter tooltip value.',
    damageFlat: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
  },
  {
    name: 'Gulgortz — Ork fury',
    description: 'Ork allies gain damage; stacks with other ork buffers in-faction. Enter tooltip value.',
    damageFlat: 0,
    level: DEFAULT_BUFF_LEVEL,
    rarity: 'legendary',
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

export function presetToBuff(preset: BuffPreset): TurnBuff {
  const { description: _description, ...rest } = preset;
  return {
    id: `buff_${Math.random().toString(36).slice(2, 9)}`,
    ...rest,
  };
}

export function findPresetByName(name: string): BuffPreset | undefined {
  return BUFF_PRESETS.find((p) => p.name === name);
}
