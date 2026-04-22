import { z } from 'zod';
import { DamageTypeSchema } from '../../data/schema';

/**
 * Zod schemas for the map-mode data catalogs. Four files load through
 * these:
 *   - `src/data/terrain.json`    → TerrainDef[]
 *   - `src/data/hexEffects.json` → HexEffectDef[]
 *   - `src/data/maps.json`       → MapDef[]
 *   - `src/data/bossScripts.json`→ BossScript[]
 *
 * Following the same conventions as `src/data/schema.ts`:
 *   - Every JSON is Zod-parsed on load so bad data fails loudly.
 *   - Inferred TypeScript types are exported alongside the schemas.
 *   - Discriminated unions gate on a literal `kind` field so TypeScript
 *     narrows cleanly inside switch statements.
 *
 * Design note — terrain refers to hex effects by **id**, not by
 * embedding a `HexEffectDef`. This decouples the two catalogs: adding a
 * new terrain that triggers Fire doesn't require duplicating the Fire
 * definition. Validation cross-checks (terrain → effect must resolve)
 * live in the catalog loader, not the schema.
 */

// ────────────────────────────────────────────────────────────────────
// Closed string enums — changes require an explicit catalog bump.
// ────────────────────────────────────────────────────────────────────

export const TerrainIdSchema = z.enum([
  'normal',
  'highGround',
  'lowGround',
  'razorWire',
  'tallGrass',
  'trenches',
  'ice',
  'brokenIce',
  'bridge',
  'impassable',
]);
export type TerrainId = z.infer<typeof TerrainIdSchema>;

export const HexEffectIdSchema = z.enum([
  'contamination',
  'despoiledGround',
  'fire',
  'ice',
  'sporeMine',
]);
export type HexEffectId = z.infer<typeof HexEffectIdSchema>;

export const TargetPolicyIdSchema = z.enum([
  'weakest',
  'nearest',
  'preferSummonsThenWeakest',
]);
export type TargetPolicyId = z.infer<typeof TargetPolicyIdSchema>;

// ────────────────────────────────────────────────────────────────────
// Hex-effect modifier variants — discriminated by `kind`.
// ────────────────────────────────────────────────────────────────────

export const HexEffectModifierSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('armorDelta'),
    /** Percent change to armor, e.g. -0.3 for contamination (armor -30%). */
    pct: z.number(),
  }),
  z.object({
    kind: z.literal('dotOfMaxHpPct'),
    /** DoT per turn as % of max hp; e.g. 0.2 = 20% max hp per turn for Fire. */
    pct: z.number(),
    damageType: DamageTypeSchema,
  }),
  z.object({
    kind: z.literal('critDamageDelta'),
    /** Crit-damage-taken delta, e.g. +0.25 for Ice. */
    pct: z.number(),
  }),
  z.object({
    kind: z.literal('factionDamageDelta'),
    /** Alliance-scoped damage-taken delta (Despoiled Ground). */
    alliance: z.string(),
    pct: z.number(),
  }),
  z.object({
    kind: z.literal('blocksMove'),
    /** Traits that can enter anyway — e.g. ['flying'] for Fire. */
    exemptTraits: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal('flatDamageOnEnter'),
    /** Flat damage when an enemy enters — Biovore spore mine, etc. */
    damage: z.number(),
    damageType: DamageTypeSchema,
    /** Consumes the effect when it triggers. */
    oneShot: z.boolean().default(true),
  }),
]);
export type HexEffectModifier = z.infer<typeof HexEffectModifierSchema>;

export const HexEffectDefSchema = z.object({
  id: HexEffectIdSchema,
  displayName: z.string(),
  durationTurns: z.number().int().nonnegative(),
  modifier: HexEffectModifierSchema,
  /** Who this effect damages: friendly=only allies, enemy=only enemies,
   *  any=both (default). Spore mines are enemy-only. */
  affects: z.enum(['friendly', 'enemy', 'any']).default('any'),
  source: z.enum(['terrain', 'ability']).default('ability'),
});
export type HexEffectDef = z.infer<typeof HexEffectDefSchema>;

// ────────────────────────────────────────────────────────────────────
// Terrain
// ────────────────────────────────────────────────────────────────────

export const TerrainDefSchema = z.object({
  id: TerrainIdSchema,
  displayName: z.string(),
  /** Blocks standard movement — e.g. `impassable`. */
  blocksMove: z.boolean().default(false),
  /** Movement is allowed only for units with one of these traits. */
  blocksMoveUnlessTrait: z.array(z.string()).default([]),
  /** Line of sight is broken by this hex. */
  blocksLoS: z.boolean().default(false),
  /** Dropped onto the hex when a unit ends its turn there (e.g. ice slide). */
  onOccupyEffect: HexEffectIdSchema.optional(),
  /** Damage multiplier applied to attacks originating FROM this hex. */
  onAttackFromDamageMultiplier: z.number().optional(),
  /** Defender-side multiplier when an attack crosses a trench border. */
  crossingBorderDefenseMultiplier: z.number().optional(),
  /** Additive delta to ranged-hit count — tall grass = -2. */
  rangedHitsDelta: z.number().int().optional(),
});
export type TerrainDef = z.infer<typeof TerrainDefSchema>;

// ────────────────────────────────────────────────────────────────────
// Map definition
// ────────────────────────────────────────────────────────────────────

export const MapOrientationSchema = z.enum(['pointy', 'flat']);
export type MapOrientation = z.infer<typeof MapOrientationSchema>;

export const HexCellSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  terrain: TerrainIdSchema,
  elevation: z.number().int().optional(),
  blocksLoS: z.boolean().optional(),
  /** Which side may spawn here at battle start. */
  spawn: z.enum(['player', 'enemy', 'boss']).optional(),
});
export type HexCell = z.infer<typeof HexCellSchema>;

export const MapDefSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.object({
    href: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  /** Pixel coordinate of hex (0,0) centre in the source image. */
  origin: z.object({
    xPx: z.number(),
    yPx: z.number(),
  }),
  /** Outer radius of a hex in source-image pixels. */
  hexSizePx: z.number().positive(),
  orientation: MapOrientationSchema,
  hexes: z.array(HexCellSchema),
  bossScriptId: z.string().optional(),
});
export type MapDef = z.infer<typeof MapDefSchema>;

// ────────────────────────────────────────────────────────────────────
// Boss scripts
// ────────────────────────────────────────────────────────────────────

export const BossScriptTurnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ability'), abilityId: z.string() }),
  z.object({ kind: z.literal('normal') }),
  z.object({ kind: z.literal('none') }),
]);
export type BossScriptTurn = z.infer<typeof BossScriptTurnSchema>;

export const BossScriptSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  targetPolicy: TargetPolicyIdSchema,
  turns: z.array(BossScriptTurnSchema).min(1),
  /** Loop index to repeat back to after the last turn. Omit to stop. */
  repeatsFrom: z.number().int().nonnegative().optional(),
});
export type BossScript = z.infer<typeof BossScriptSchema>;

// ────────────────────────────────────────────────────────────────────
// Catalog-level array schemas — what `catalog.ts` parses at load.
// ────────────────────────────────────────────────────────────────────

export const TerrainCatalogSchema = z.array(TerrainDefSchema);
export const HexEffectCatalogSchema = z.array(HexEffectDefSchema);
export const MapCatalogSchema = z.array(MapDefSchema);
export const BossScriptCatalogSchema = z.array(BossScriptSchema);
