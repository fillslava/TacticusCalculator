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
  bonusHitCount: z.number().int().optional(),
  bonusHitCap: z.number().optional(),
});

export const AbilityTriggerSchema = z.union([
  z.object({ kind: z.literal('afterOwnNormalAttack') }),
  z.object({
    kind: z.literal('afterOwnFirstAttackOfTurn'),
    requiresTargetTrait: z.string().optional(),
  }),
]);

export const AbilityScalingSchema = z.object({
  per: z.enum(['turnsAttackedThisBattle']),
  pctPerStep: z.number(),
});

export const AbilityTeamBuffSchema = z.union([
  z.object({
    kind: z.literal('laviscusOutrage'),
    outragePctOfOutrage: z.number(),
    critDmgPerChaosContributor: z.number(),
  }),
  z.object({
    kind: z.literal('trajannLegendaryCommander'),
    /** Per-level flat damage (X). Indexed by (level-1). Levels past the
     *  array length clamp to the last entry. Wiki anchors:
     *    L8=27, L17=60, L26=148, L35=314, L50=1096, L60=1436. */
    flatDamageByLevel: z.array(z.number()).min(1),
    /** Per-level extra hits (Y) on the first not-normal attack against an
     *  enemy adjacent to Trajann. Wiki anchors:
     *    L1..L26 = 1, L27+ = 2 (matches the Epic-rarity jump on the wiki's
     *    interactive scaler, with the documented top-of-rarity values
     *    Epic L35=2, Legendary L50=2, Mythic L60=2). */
    extraHitsByLevel: z.array(z.number().int()).min(1),
  }),
  z.object({
    kind: z.literal('biovoreMythicAcid'),
    pctByStar: z.array(z.number()).min(1),
  }),
  z.object({
    kind: z.literal('vitruviusMasterAnnihilator'),
    capByLevel: z.array(z.number()).min(1),
  }),
]);

/**
 * Raw ability shape as it appears in catalog JSON. Accepts both the legacy
 * singleton `profile` and the new `profiles` array so older scraper output
 * and hand-authored entries both load. The loader coerces to `profiles`
 * (see catalog.ts::normalizeAbility).
 */
export const AbilitySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['active', 'passive']),
  curveId: z.string().optional(),
  profile: AttackProfileSchema.optional(),
  profiles: z.array(AttackProfileSchema).optional(),
  cooldown: z.number().int().optional(),
  trigger: AbilityTriggerSchema.optional(),
  scaling: AbilityScalingSchema.optional(),
  teamBuff: AbilityTeamBuffSchema.optional(),
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

/**
 * A single debuff step applied to the boss when a prime is killed.
 *
 * - `stat` is one of the boss's own stats; only stat-affecting debuffs are
 *   modelled here (ability-specific debuffs like `ArchContaminator_hits`
 *   don't change the damage calc).
 * - `mode='pct'` means a percent reduction of the base stat (value is 0..1);
 *   `mode='flat'` means a flat numeric subtraction.
 */
export const BossDebuffStepSchema = z.object({
  stat: z.enum(['armor', 'damage', 'hp', 'critDamage']),
  mode: z.enum(['pct', 'flat']),
  value: z.number(),
  rawId: z.string().optional(),
});

export const BossPrimeSchema = z.object({
  name: z.string(),
  /**
   * Ordered debuff chain. After killing the prime N times, the first N steps
   * are applied cumulatively. `stat` null entries (ability-specific debuffs)
   * count as an "inert" step — still consumes a kill tier but doesn't change
   * stats.
   */
  steps: z.array(BossDebuffStepSchema.or(z.object({ stat: z.null(), rawId: z.string() }))),
});

export const BossSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  stages: z.array(BossStageSchema),
  primes: z.array(BossPrimeSchema).optional(),
});

export const ItemStatModsSchema = z.object({
  damageFlat: z.number().optional(),
  damagePct: z.number().optional(),
  armorFlat: z.number().optional(),
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
  rarityAbilityStep: z.number().default(0.1),
  gearRanks: z.array(z.tuple([z.string(), z.number()])),
});

export const CharactersCatalogSchema = z.array(CharacterSchema);
export const BossesCatalogSchema = z.array(BossSchema);
export const EquipmentCatalogSchema = z.array(EquipmentSchema);

export type CharacterData = z.infer<typeof CharacterSchema>;
export type BossData = z.infer<typeof BossSchema>;
export type EquipmentData = z.infer<typeof EquipmentSchema>;
export type CurvesData = z.infer<typeof CurvesSchema>;
