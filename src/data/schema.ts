import { z } from 'zod';

export const DamageTypeSchema = z.enum([
  'bio',
  'blast',
  'bolter',
  'chain',
  'direct',
  'energy',
  'eviscerating',
  'flame',
  'gauss',
  'heavyRound',
  'las',
  'melta',
  'molecular',
  'particle',
  'physical',
  'piercing',
  'plasma',
  'power',
  'projectile',
  'psychic',
  'pulse',
  'toxic',
]);

export const RaritySchema = z.enum([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
]);

export const BaseStatsSchema = z.object({
  damage: z.number(),
  armor: z.number(),
  hp: z.number(),
  critChance: z.number().default(0),
  critDamage: z.number().default(0),
  blockChance: z.number().default(0),
  blockDamage: z.number().default(0),
  meleeHits: z.number().int().default(1),
  rangedHits: z.number().int().default(1),
});

export const AttackProfileSchema = z.object({
  label: z.string(),
  damageType: DamageTypeSchema,
  hits: z.number().int(),
  pierceOverride: z.number().optional(),
  damageFactor: z.number().optional(),
  preArmorAddFlat: z.number().optional(),
  preArmorMultiplier: z.number().optional(),
  capAt: z.enum(['base', 'preArmor', 'finalHit']).optional(),
  cap: z.number().optional(),
  kind: z.enum(['melee', 'ranged', 'ability']).optional(),
  abilityId: z.string().optional(),
  cooldown: z.number().int().optional(),
  ignoresCrit: z.boolean().optional(),
});

export const AbilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['active', 'passive']),
  curveId: z.string().optional(),
  profile: AttackProfileSchema.optional(),
  cooldown: z.number().int().optional(),
});

export const CharacterSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  faction: z.string(),
  alliance: z.string(),
  baseStats: BaseStatsSchema,
  melee: AttackProfileSchema,
  ranged: AttackProfileSchema.optional(),
  abilities: z.array(AbilitySchema).default([]),
  traits: z.array(z.string()).default([]),
  maxRarity: RaritySchema.default('legendary'),
});

export const BossStageSchema = z.object({
  name: z.string(),
  hp: z.number(),
  armor: z.number(),
  shield: z.number().optional(),
  traits: z.array(z.string()).default([]),
  damageCapsByStage: z
    .object({
      base: z.number().optional(),
      preArmor: z.number().optional(),
      finalHit: z.number().optional(),
    })
    .optional(),
});

export const BossSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  stages: z.array(BossStageSchema),
});

export const ItemStatModsSchema = z.object({
  damageFlat: z.number().optional(),
  damagePct: z.number().optional(),
  armorFlat: z.number().optional(),
  armorPct: z.number().optional(),
  hpFlat: z.number().optional(),
  hpPct: z.number().optional(),
  critChance: z.number().optional(),
  critDamage: z.number().optional(),
  blockChance: z.number().optional(),
  blockDamage: z.number().optional(),
  critResist: z.number().optional(),
  blockResist: z.number().optional(),
  accuracy: z.number().optional(),
  dodge: z.number().optional(),
  meleeDamagePct: z.number().optional(),
  rangedDamagePct: z.number().optional(),
  piercing: z.number().optional(),
});

export const EquipmentSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  slotId: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  rarity: RaritySchema,
  level: z.number().int(),
  mods: ItemStatModsSchema,
  factions: z.array(z.string()).optional(),
  relic: z.boolean().optional(),
});

export const CurvesSchema = z.object({
  abilityFactor: z.array(z.number()),
  starMultiplierPerStar: z.number().default(0.1),
  rarityAbilityStep: z.number().default(0.2),
  gearRanks: z.array(z.tuple([z.string(), z.number()])),
});

export const CharactersCatalogSchema = z.array(CharacterSchema);
export const BossesCatalogSchema = z.array(BossSchema);
export const EquipmentCatalogSchema = z.array(EquipmentSchema);

export type CharacterData = z.infer<typeof CharacterSchema>;
export type BossData = z.infer<typeof BossSchema>;
export type EquipmentData = z.infer<typeof EquipmentSchema>;
export type CurvesData = z.infer<typeof CurvesSchema>;
