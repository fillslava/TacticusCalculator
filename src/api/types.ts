import { z } from 'zod';

export const ApiRaritySchema = z.union([
  z.literal('Common'),
  z.literal('Uncommon'),
  z.literal('Rare'),
  z.literal('Epic'),
  z.literal('Legendary'),
  z.literal('Mythic'),
  z.literal('Legendary+'),
]);

export const ApiUnitItemSchema = z
  .object({
    slotId: z.string(),
    level: z.number(),
    id: z.string(),
    name: z.string().optional(),
    rarity: ApiRaritySchema.optional(),
    relic: z.boolean().optional(),
  })
  .passthrough();

export const ApiUnitAbilitySchema = z
  .object({
    id: z.string().optional(),
    abilityId: z.string().optional(),
    name: z.string().optional(),
    level: z.number().optional(),
    abilityLevel: z.number().optional(),
    xpLevel: z.number().optional(),
    rarity: ApiRaritySchema.optional(),
    kind: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

export const ApiUnitSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    faction: z.string().optional(),
    grandAlliance: z.string().optional(),
    progressionIndex: z.number().default(0),
    xp: z.number().default(0),
    xpLevel: z.number().default(1),
    rank: z.number().default(0),
    rarity: ApiRaritySchema.optional(),
    items: z.array(ApiUnitItemSchema).default([]),
    upgrades: z.array(z.any()).default([]),
    shards: z.number().default(0),
    abilities: z.array(ApiUnitAbilitySchema).default([]),
  })
  .passthrough();

export const ApiPlayerDetailsSchema = z.object({
  name: z.string(),
  powerLevel: z.number().optional(),
});

export const ApiPlayerSchema = z.object({
  details: ApiPlayerDetailsSchema,
  units: z.array(ApiUnitSchema).default([]),
  inventory: z.record(z.any()).optional(),
  progress: z.record(z.any()).optional(),
});

export const ApiPlayerResponseSchema = z.object({
  player: ApiPlayerSchema,
});

export type ApiUnit = z.infer<typeof ApiUnitSchema>;
export type ApiUnitAbility = z.infer<typeof ApiUnitAbilitySchema>;
export type ApiUnitItem = z.infer<typeof ApiUnitItemSchema>;
export type ApiPlayer = z.infer<typeof ApiPlayerSchema>;
export type ApiPlayerResponse = z.infer<typeof ApiPlayerResponseSchema>;
