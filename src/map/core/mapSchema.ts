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

/**
 * How `q,r` on each cell are encoded in the source JSON.
 *
 * - `'axial'` (default): the coords are already axial (Red-Blob Games
 *   convention) — the renderer can use them directly. Rectangular
 *   enumerations of axial coords render as a rhombus.
 * - `'offsetOddR'`: the coords are odd-r offset — rows are 0..R,
 *   columns are 0..C, with row `r` shifted half a hex right when
 *   `r` is odd. This matches the "brick wall" rectangular layout
 *   Tacticus ships. The catalog loader converts to axial on load so
 *   downstream engine/renderer code keeps using axial throughout.
 *
 * Transform used for odd-r offset:
 *   q_axial = q_offset - floor(r_offset / 2)
 *   r_axial = r_offset
 */
export const MapCoordsSchema = z.enum(['axial', 'offsetOddR']);
export type MapCoords = z.infer<typeof MapCoordsSchema>;

export const HexCellSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  terrain: TerrainIdSchema,
  elevation: z.number().int().optional(),
  blocksLoS: z.boolean().optional(),
  /**
   * Which side/slot may spawn here at battle start.
   * - `player`  — one of the five hero slots.
   * - `mow`     — the dedicated Machine-of-War slot. In Tacticus the MoW
   *               sits off to the side of the actual board, doesn't move,
   *               and only fires its active ability (plus any passives).
   *               Placing the MoW spawn off-map mirrors that UX so the
   *               hero row on the board still reads as five hexes wide.
   * - `enemy`   — a non-boss enemy (trash / adds).
   * - `boss`    — the primary target unit.
   */
  spawn: z.enum(['player', 'enemy', 'boss', 'mow']).optional(),
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
  /**
   * Coordinate system used in this file's `hexes[]`. Omit (or leave
   * as the default `'axial'`) for back-compat with Phase 1-7 data —
   * real maps use `'offsetOddR'` because the authors think in
   * column/row rectangles, not axial parallelograms. The loader
   * normalises everything to axial before downstream code sees it,
   * so `hexToPixel`, `hexDistance`, `hexNeighbours` never have to
   * branch on this field.
   */
  coordsIn: MapCoordsSchema.optional(),
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

/**
 * Shape of the inline AttackProfile map carried by a BossScript. We
 * redeclare the fields rather than importing `AttackProfileSchema` from
 * `src/data/schema.ts` to avoid a circular-ish dep (map → data → map)
 * and because the boss script only needs the narrow subset of profile
 * fields the resolver actually reads for an incoming attack. Keep in sync
 * with `AttackProfile` in `src/engine/types.ts`.
 */
export const BossAbilityProfileSchema = z.object({
  label: z.string(),
  damageType: DamageTypeSchema,
  hits: z.number().int().positive(),
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
export type BossAbilityProfile = z.infer<typeof BossAbilityProfileSchema>;

/**
 * Optional stat block the synthetic boss Unit absorbs at hydration time
 * (`buildBossUnit`). Only fields that affect outgoing-damage math are
 * listed — hp/armor/shield already come from the matching CatalogBoss
 * stage, and defensive stats (block, etc.) follow from traits.
 */
export const BossScriptStatsSchema = z.object({
  damage: z.number().nonnegative().default(0),
  critChance: z.number().optional(),
  critDamage: z.number().optional(),
  meleeHits: z.number().int().positive().optional(),
  rangedHits: z.number().int().positive().optional(),
});
export type BossScriptStats = z.infer<typeof BossScriptStatsSchema>;

export const BossScriptSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  targetPolicy: TargetPolicyIdSchema,
  turns: z.array(BossScriptTurnSchema).min(1),
  /** Loop index to repeat back to after the last turn. Omit to stop. */
  repeatsFrom: z.number().int().nonnegative().optional(),
  /**
   * Stat block copied into the synthetic boss `CatalogCharacter.baseStats`
   * at hydration time. Missing script → boss has no damage stat → attacks
   * land for 0 (Phase 4 behaviour preserved for older calibration data).
   */
  stats: BossScriptStatsSchema.optional(),
  /**
   * Inline attack profiles keyed by the same `abilityId` used in
   * `turns[i].abilityId`. Kept here (not in `bosses.json`) because:
   *  (a) scripts are per-fight, so Avatar Wave 2 can override Wave 1's
   *      damageFactor without touching the boss catalog.
   *  (b) adding inline profiles to each CatalogBoss pollutes the
   *      single-boss (Team mode) target editor with irrelevant fields.
   */
  abilities: z.record(z.string(), BossAbilityProfileSchema).optional(),
});
export type BossScript = z.infer<typeof BossScriptSchema>;

// ────────────────────────────────────────────────────────────────────
// Catalog-level array schemas — what `catalog.ts` parses at load.
// ────────────────────────────────────────────────────────────────────

export const TerrainCatalogSchema = z.array(TerrainDefSchema);
export const HexEffectCatalogSchema = z.array(HexEffectDefSchema);
export const MapCatalogSchema = z.array(MapDefSchema);
export const BossScriptCatalogSchema = z.array(BossScriptSchema);
