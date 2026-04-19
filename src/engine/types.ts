import type { DamageType } from './dmgTypes';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const RARITY_ORDER: Rarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
];

export interface BaseStats {
  damage: number;
  armor: number;
  hp: number;
  critChance: number;
  critDamage: number;
  blockChance: number;
  blockDamage: number;
  meleeHits: number;
  rangedHits: number;
}

export interface AttackProfile {
  label: string;
  damageType: DamageType;
  hits: number;
  pierceOverride?: number;
  damageFactor?: number;
  preArmorAddFlat?: number;
  preArmorMultiplier?: number;
  capAt?: 'base' | 'preArmor' | 'finalHit';
  cap?: number;
  kind?: 'melee' | 'ranged' | 'ability';
  abilityId?: string;
  cooldown?: number;
  ignoresCrit?: boolean;
}

export interface ItemStatMods {
  damageFlat?: number;
  damagePct?: number;
  armorFlat?: number;
  armorPct?: number;
  hpFlat?: number;
  hpPct?: number;
  critChance?: number;
  critDamage?: number;
  blockChance?: number;
  blockDamage?: number;
  critResist?: number;
  blockResist?: number;
  accuracy?: number;
  dodge?: number;
  meleeDamagePct?: number;
  rangedDamagePct?: number;
  piercing?: number;
}

export const ITEM_STAT_KEYS: (keyof ItemStatMods)[] = [
  'damageFlat',
  'damagePct',
  'armorFlat',
  'armorPct',
  'hpFlat',
  'hpPct',
  'critChance',
  'critDamage',
  'blockChance',
  'blockDamage',
  'critResist',
  'blockResist',
  'accuracy',
  'dodge',
  'meleeDamagePct',
  'rangedDamagePct',
  'piercing',
];

export type TraitId = string;

export interface CatalogAbility {
  id: string;
  name: string;
  kind: 'active' | 'passive';
  curveId?: string;
  profile?: AttackProfile;
  cooldown?: number;
}

export interface CatalogCharacter {
  id: string;
  displayName: string;
  faction: string;
  alliance: string;
  baseStats: BaseStats;
  melee: AttackProfile;
  ranged?: AttackProfile;
  abilities: CatalogAbility[];
  traits: TraitId[];
  maxRarity: Rarity;
}

export interface CatalogEquipmentSlot {
  slotId: 1 | 2 | 3;
  id: string;
  rarity: Rarity;
  level: number;
  mods: ItemStatMods;
  relic?: boolean;
  displayName?: string;
}

export interface BossStage {
  name: string;
  hp: number;
  armor: number;
  shield?: number;
  traits: TraitId[];
  damageCapsByStage?: { base?: number; preArmor?: number; finalHit?: number };
}

export interface CatalogBoss {
  id: string;
  displayName: string;
  stages: BossStage[];
}

export interface ModifierStack {
  traits?: TraitId[];
  damageMultipliers?: number[];
  damageFlat?: number;
  critChance?: number;
  critDamage?: number;
}

export type BonusHitTrigger = 'first' | 'normal' | 'ability' | 'all';

export interface TurnBuff {
  id: string;
  name: string;
  level?: number;
  rarity?: Rarity;
  damageFlat?: number;
  damageMultiplier?: number;
  critChance?: number;
  critDamage?: number;
  traits?: TraitId[];
  bonusHits?: number;
  bonusHitsOn?: BonusHitTrigger;
}

export interface AbilityLevel {
  id: string;
  level: number;
  rarity?: Rarity;
  kind?: 'active' | 'passive';
}

export interface Attacker {
  source: CatalogCharacter;
  progression: { stars: number; rank: number; xpLevel: number; rarity: Rarity };
  equipment: CatalogEquipmentSlot[];
  activeBuffs?: ModifierStack;
  abilityLevels?: AbilityLevel[];
}

export interface Target {
  source: CatalogBoss | CatalogCharacter;
  stageIndex?: number;
  currentShield?: number;
  currentHp?: number;
  activeDebuffs?: ModifierStack;
}

export type RngMode = 'expected' | 'minmax' | 'distribution';

export interface AttackContext {
  profile: AttackProfile;
  rngMode: RngMode;
}

export interface PerHitBreakdown {
  hitIndex: number;
  pCrit: number;
  expected: number;
  min: number;
  max: number;
}

export interface TraceStep {
  phase: string;
  description: string;
  before?: number;
  after?: number;
  detail?: Record<string, number | string | boolean>;
}

export interface DamageBreakdown {
  expected: number;
  min: number;
  max: number;
  critProbability: number;
  distribution?: { value: number; probability: number }[];
  perHit: PerHitBreakdown[];
  postShieldExpected: number;
  postHpExpected: number;
  overkill: boolean;
  cappedBy?: 'base' | 'preArmor' | 'finalHit';
  trace: TraceStep[];
}

export interface Rotation {
  turns: { attacks: AttackContext[]; buffs?: TurnBuff[] }[];
}

export interface RotationBreakdown {
  perTurn: DamageBreakdown[];
  cumulativeExpected: number[];
  turnsToKill: number | 'unreachable';
}

export interface TargetResolvedStats {
  armor: number;
  hp: number;
  shield: number;
  traits: TraitId[];
  damageCaps?: { base?: number; preArmor?: number; finalHit?: number };
}

export interface AttackerResolvedStats extends BaseStats {
  traits: TraitId[];
}

export interface Frame {
  attacker: AttackerResolvedStats;
  target: TargetResolvedStats;
  profile: AttackProfile;
  pierce: number;
  armorPasses: number;
  armorPassesOnCrit: number;
  preArmorFlat: number;
  preArmorMultiplier: number;
  postArmorMultiplier: number;
  critChance: number;
  critDamage: number;
  damageFactor: number;
  cappedBy?: 'base' | 'preArmor' | 'finalHit';
  cap?: number;
  trace: TraceStep[];
}
