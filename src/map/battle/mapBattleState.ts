import type { Attacker } from '../../engine/types';
import type { BattleState } from '../../engine/team';
import type {
  HexCell,
  HexEffectDef,
  HexEffectId,
  MapDef,
  TerrainDef,
  TerrainId,
} from '../core/mapSchema';
import type { Hex } from '../core/hex';
import { hexKey } from '../core/hex';

/**
 * Layer 3 — map battle state.
 *
 * Wraps the engine's `BattleState` with hex/unit/effect bookkeeping. The
 * map layer NEVER edits the engine's rotation logic directly: it builds
 * one-turn `TeamRotation`s on demand and threads this `MapBattleState`'s
 * inner `battleState` through `resolveTeamRotation` via the optional
 * `preExistingBattleState` slot (Phase 2 engine addition).
 */

export type Side = 'player' | 'enemy';
export type UnitKind = 'hero' | 'mow' | 'boss' | 'summon';

/**
 * Runtime instance of a hex effect. Distinct from `HexEffectDef` — that
 * is the catalog shape. `AppliedHexEffect` tracks duration, owner, and
 * the hex (if positional) or unit (if personal) it's attached to.
 */
export interface AppliedHexEffect {
  effectId: HexEffectId;
  /**
   * Inclusive turn index through which this effect is live. When
   * `MapBattleState.turnIdx > expiresAtTurn` the effect is purged.
   * Set to `battle.turnIdx + effect.durationTurns - 1` at apply time.
   */
  expiresAtTurn: number;
  /** Side that originated the effect (used for `affects` filtering). */
  appliedBy: Side;
  /** Source hint for UI — ability id or terrain id that produced it. */
  sourceId?: string;
}

/**
 * A unit standing on a hex. `attacker` is the engine-shaped Attacker
 * used when this unit ATTACKS; when this unit IS ATTACKED, the map
 * layer's `targetAdapter.ts` converts it to a `Target`.
 *
 * MVP assumption: `attacker.source` is a `CatalogCharacter` regardless
 * of `kind`. Bosses are modelled as synthetic CatalogCharacter-shaped
 * heroes with boss-like stats — the synthesis lives in a later phase
 * (`bossToAttacker`, Phase 5).
 */
export interface Unit {
  id: string;
  side: Side;
  kind: UnitKind;
  position: Hex;
  attacker: Attacker;
  maxHp: number;
  maxShield: number;
  currentHp: number;
  currentShield: number;
  /**
   * Per-unit (non-positional) effects: contamination tied to the unit,
   * status DoTs, etc. Positional effects live in
   * `MapBattleState.hexEffectsAt` keyed by hex coordinate.
   */
  statusEffects: AppliedHexEffect[];
  /** For scripted bosses — points into a BossScript. */
  scriptPointer?: { scriptId: string; turnIdx: number };
}

export interface MapBattleState {
  map: MapDef;
  /** Catalog lookups resolved once at battle start. */
  terrainById: Record<TerrainId, TerrainDef>;
  hexEffectById: Record<HexEffectId, HexEffectDef>;
  /** Per-coordinate hex index, `${q},${r}` → cell. */
  hexAt: Record<string, HexCell>;
  /** Live units, keyed by unit id. Dead units are removed (Phase 5). */
  units: Record<string, Unit>;
  /** Positional hex effects, keyed by `${q},${r}`. */
  hexEffectsAt: Record<string, AppliedHexEffect[]>;
  /** 0-indexed turn counter — incremented every time BOTH sides act. */
  turnIdx: number;
  /** Side currently taking its turn. */
  activeSide: Side;
  /**
   * Engine battle-level state threaded across per-turn `resolveTeamRotation`
   * calls. The engine mutates this in place (Vitruvius marks, Helbrecht
   * Crusade windows) — we pass the SAME reference on every turn so the
   * accumulated state survives.
   */
  battleState: BattleState;
}

/**
 * Resolve a hex id into the Terrain catalog entry, or a safe default.
 * Lookups go through here rather than direct `terrainById[]` so that a
 * stale map referencing a removed terrain id degrades to 'normal' rather
 * than crashing.
 */
export function terrainAt(
  battle: MapBattleState,
  at: Hex,
): TerrainDef | undefined {
  const cell = battle.hexAt[hexKey(at)];
  if (!cell) return undefined;
  return battle.terrainById[cell.terrain];
}

/** All positional hex effects currently live on a given coord. */
export function hexEffectsAt(
  battle: MapBattleState,
  at: Hex,
): AppliedHexEffect[] {
  return battle.hexEffectsAt[hexKey(at)] ?? [];
}

/** Convenience: only the effects whose catalog `affects` matches `side`. */
export function hexEffectsAffecting(
  battle: MapBattleState,
  at: Hex,
  side: Side,
): { applied: AppliedHexEffect; def: HexEffectDef }[] {
  const out: { applied: AppliedHexEffect; def: HexEffectDef }[] = [];
  for (const a of hexEffectsAt(battle, at)) {
    const def = battle.hexEffectById[a.effectId];
    if (!def) continue;
    // Effects expire at the START of their expiresAtTurn+1 — purge old.
    if (battle.turnIdx > a.expiresAtTurn) continue;
    if (def.affects === 'any' || def.affects === side) out.push({ applied: a, def });
  }
  return out;
}

/**
 * Assemble a MapBattleState from a parsed map, its catalogs, and the
 * initial unit roster. Heavy-lifting at battle start so per-turn code
 * only does lookups, not parsing.
 *
 * The engine's `BattleState` is synthesized directly here rather than
 * via `initBattleState(rotation, target)` because the map layer
 * doesn't have a concrete rotation until a turn executes. Instead we
 * seed the engine state with:
 *   - `membersInRotation` = every player-side unit id (Trajann gate uses
 *     "is this member on the board"; we treat presence as equivalent).
 *   - `targetTraits` = the primary enemy's traits (callers mutate this
 *     field per-attack in later phases when targeting varies).
 *   - empty mark/crusade maps.
 */
export function initMapBattle(args: {
  map: MapDef;
  terrain: TerrainDef[];
  hexEffects: HexEffectDef[];
  playerUnits: Unit[];
  enemyUnits: Unit[];
}): MapBattleState {
  const { map, terrain, hexEffects, playerUnits, enemyUnits } = args;

  const terrainById: Record<TerrainId, TerrainDef> = {} as Record<
    TerrainId,
    TerrainDef
  >;
  for (const t of terrain) terrainById[t.id] = t;

  const hexEffectById: Record<HexEffectId, HexEffectDef> = {} as Record<
    HexEffectId,
    HexEffectDef
  >;
  for (const e of hexEffects) hexEffectById[e.id] = e;

  const hexAt: Record<string, HexCell> = {};
  for (const cell of map.hexes) hexAt[hexKey(cell)] = cell;

  const units: Record<string, Unit> = {};
  for (const u of [...playerUnits, ...enemyUnits]) units[u.id] = u;

  const membersInRotation = new Set<string>(playerUnits.map((u) => u.id));
  const primaryEnemy =
    enemyUnits.find((u) => u.kind === 'boss') ??
    enemyUnits.find((u) => u.kind === 'mow') ??
    enemyUnits[0];
  const targetTraits = primaryEnemy ? primaryEnemy.attacker.source.traits : [];

  const battleState: BattleState = {
    targetTraits: [...targetTraits],
    vitruviusMarkedSources: new Set(),
    membersInRotation,
    helbrechtCrusadeActiveUntil: {},
  };

  return {
    map,
    terrainById,
    hexEffectById,
    hexAt,
    units,
    hexEffectsAt: {},
    turnIdx: 0,
    activeSide: 'player',
    battleState,
  };
}

/**
 * Add a fresh hex effect to a coordinate, stamping the expiry turn.
 * Phase 2 helper — used by razor wire's onOccupy spawn and boss
 * abilities (Despoiled Ground etc.) in later phases.
 */
export function applyHexEffect(
  battle: MapBattleState,
  at: Hex,
  effectId: HexEffectId,
  appliedBy: Side,
  sourceId?: string,
): void {
  const def = battle.hexEffectById[effectId];
  if (!def) return;
  const applied: AppliedHexEffect = {
    effectId,
    expiresAtTurn: battle.turnIdx + Math.max(0, def.durationTurns - 1),
    appliedBy,
    sourceId,
  };
  const key = hexKey(at);
  const list = battle.hexEffectsAt[key] ?? (battle.hexEffectsAt[key] = []);
  list.push(applied);
}
