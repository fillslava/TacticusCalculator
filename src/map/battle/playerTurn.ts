import {
  resolveTeamRotation,
  type BattleState,
} from '../../engine/team';
import type {
  AttackContext,
  AttackProfile,
  CatalogCharacter,
  DamageBreakdown,
  TeamAction,
  TeamMember,
  TeamRotation,
  TeamRotationBreakdown,
  TurnBuff,
} from '../../engine/types';
import { hexEquals, hexKey } from '../core/hex';
import type { Hex } from '../core/hex';
import { deriveHexBuffs } from './hexBuffs';
import type { AppliedHexEffect, MapBattleState, Unit } from './mapBattleState';
import { applyHexEffect } from './mapBattleState';
import { isMoveLegal } from './movement';
import { unitToTarget } from './targetAdapter';

/**
 * Phase 4 — player-side turn orchestrator.
 *
 * Takes the queue of `PlayerAction`s accumulated by the UI (click-to-move,
 * click-to-attack) and commits them against the live `MapBattleState`.
 * The design principle is **thread, don't bypass** — movement effects and
 * attack damage resolve through the existing engine via
 * `resolveTeamRotation`, with `battleState` threaded across calls so
 * Vitruvius marks / Helbrecht Crusade windows persist across map turns.
 *
 * Scope deliberately kept tight for Phase 4:
 *   - Single attacker per player turn (multi-hero assists Phase 5+).
 *   - Movement budget is a flat `DEFAULT_MOVEMENT` from `movement.ts`.
 *   - `TeamPosition` assigned sequentially (0..4) from alive player-unit
 *     ids — LOSSY for positional auras (Helbrecht/Aesoth distance
 *     checks). For Phase 4's parity test (single attacker, no aura
 *     carriers) the lossy mapping is irrelevant; a richer hex→position
 *     map is a Phase 5 concern.
 *
 * Every mutation happens in `applyAction` — `resolvePlayerTurn` is a
 * simple fold that records each action's effect to a log. The log is the
 * surface the UI reads to populate the turn breakdown panel.
 */

export type PlayerActionKind = 'move' | 'attack';

/** A single scheduled atom the UI queues. Processed in order. */
export type PlayerAction =
  | { kind: 'move'; unitId: string; to: Hex }
  | {
      kind: 'attack';
      attackerId: string;
      targetId: string;
      /** 'melee' | 'ranged' | 'ability:<id>' — same vocabulary as rotation editor. */
      attackKey: AttackKey;
    };

/** Attack keys are interchangeable with the rotation editor's vocabulary. */
export type AttackKey = 'melee' | 'ranged' | `ability:${string}`;

/** Per-action log — what the UI renders in the turn breakdown panel. */
export type PlayerActionLog =
  | {
      kind: 'move';
      unitId: string;
      from: Hex;
      to: Hex;
      /** Flat-damage hex effects (spore mine) that triggered on entry. */
      enterDamage?: number;
      /** Effects applied to the destination hex via `terrain.onOccupyEffect`. */
      appliedEffectIds: string[];
    }
  | {
      kind: 'attack';
      attackerId: string;
      targetId: string;
      attackKey: AttackKey;
      /** Per-AttackContext breakdown — multi-profile abilities produce >1. */
      perContext: DamageBreakdown[];
      /** Total expected damage summed across contexts. */
      totalExpected: number;
      /** Damage actually drained from target (after clamping to HP). */
      damageApplied: number;
      /** Engine-reported team-buff applications for this attack. */
      teamBuffApplications: TeamRotationBreakdown['teamBuffApplications'];
    }
  | {
      kind: 'skipped';
      action: PlayerAction;
      reason: string;
    };

export interface PlayerTurnResult {
  /** Per-action records in the order the actions were processed. */
  log: PlayerActionLog[];
  /** Total expected damage inflicted this turn (sum over attacks). */
  totalDamage: number;
}

/**
 * Fold `actions` against `battle`, mutating the battle state in place.
 * The function is deliberately side-effectful — the engine's `BattleState`
 * is mutable by design (Vitruvius marks etc.), and the map layer mirrors
 * that pattern for HP drain / position update. Callers that need
 * immutability should clone `battle` upfront.
 */
export function resolvePlayerTurn(
  battle: MapBattleState,
  actions: PlayerAction[],
): PlayerTurnResult {
  const log: PlayerActionLog[] = [];
  let totalDamage = 0;

  for (const action of actions) {
    const entry = applyAction(battle, action);
    if (entry) log.push(entry);
    if (entry?.kind === 'attack') totalDamage += entry.damageApplied;
  }

  return { log, totalDamage };
}

/**
 * Commit one action to the battle and return its log row. Returns
 * `undefined` only in the no-op defensive branches (unit gone mid-turn,
 * etc.) — normal action outcomes always produce a log entry.
 */
export function applyAction(
  battle: MapBattleState,
  action: PlayerAction,
): PlayerActionLog | undefined {
  switch (action.kind) {
    case 'move':
      return applyMoveAction(battle, action);
    case 'attack':
      return applyAttackAction(battle, action);
  }
}

// ────────────────────────────────────────────────────────────────────
// Movement
// ────────────────────────────────────────────────────────────────────

function applyMoveAction(
  battle: MapBattleState,
  action: Extract<PlayerAction, { kind: 'move' }>,
): PlayerActionLog {
  const unit = battle.units[action.unitId];
  if (!unit) {
    return { kind: 'skipped', action, reason: 'unit not found' };
  }
  if (unit.currentHp <= 0) {
    return { kind: 'skipped', action, reason: 'unit is dead' };
  }
  if (!isMoveLegal(unit, action.to, battle)) {
    return { kind: 'skipped', action, reason: 'destination not reachable' };
  }

  const from = unit.position;
  unit.position = { q: action.to.q, r: action.to.r };

  // Enter-time flat damage (spore mine). Consume one-shot effects.
  const enterDamage = resolveOnEnterDamage(battle, unit);

  // Apply terrain.onOccupyEffect if the destination terrain declares one.
  const appliedEffectIds: string[] = [];
  const destCell = battle.hexAt[hexKey(unit.position)];
  const destTerrain = destCell
    ? battle.terrainById[destCell.terrain]
    : undefined;
  if (destTerrain?.onOccupyEffect) {
    applyHexEffect(
      battle,
      unit.position,
      destTerrain.onOccupyEffect,
      unit.side,
      `terrain:${destTerrain.id}`,
    );
    appliedEffectIds.push(destTerrain.onOccupyEffect);
  }

  return {
    kind: 'move',
    unitId: unit.id,
    from,
    to: { ...unit.position },
    enterDamage: enterDamage > 0 ? enterDamage : undefined,
    appliedEffectIds,
  };
}

/**
 * Walk the effects on the unit's current hex, fire every
 * `flatDamageOnEnter` that affects this unit's side, drain HP, and
 * consume one-shot effects. Returns the total damage dealt.
 */
function resolveOnEnterDamage(battle: MapBattleState, unit: Unit): number {
  const key = hexKey(unit.position);
  const list = battle.hexEffectsAt[key];
  if (!list || list.length === 0) return 0;

  let total = 0;
  const kept: AppliedHexEffect[] = [];
  for (const applied of list) {
    if (battle.turnIdx > applied.expiresAtTurn) continue;
    const def = battle.hexEffectById[applied.effectId];
    if (!def) {
      kept.push(applied);
      continue;
    }
    const affectsThisUnit =
      def.affects === 'any' || def.affects === unit.side;
    if (def.modifier.kind !== 'flatDamageOnEnter' || !affectsThisUnit) {
      kept.push(applied);
      continue;
    }
    total += def.modifier.damage;
    // Consume the effect if it's one-shot; otherwise keep it.
    if (!def.modifier.oneShot) kept.push(applied);
  }

  if (total > 0) {
    unit.currentHp = Math.max(0, unit.currentHp - total);
  }
  battle.hexEffectsAt[key] = kept;
  return total;
}

// ────────────────────────────────────────────────────────────────────
// Attack
// ────────────────────────────────────────────────────────────────────

function applyAttackAction(
  battle: MapBattleState,
  action: Extract<PlayerAction, { kind: 'attack' }>,
): PlayerActionLog {
  const attacker = battle.units[action.attackerId];
  const victim = battle.units[action.targetId];
  if (!attacker) {
    return { kind: 'skipped', action, reason: 'attacker not found' };
  }
  if (!victim) {
    return { kind: 'skipped', action, reason: 'target not found' };
  }
  if (attacker.currentHp <= 0) {
    return { kind: 'skipped', action, reason: 'attacker is dead' };
  }
  if (victim.currentHp <= 0) {
    return { kind: 'skipped', action, reason: 'target already dead' };
  }

  // Build engine-shaped inputs: AttackContexts for the chosen key, with
  // hex-buffs attached as action.buffs (per-context because hex-buffs
  // depend on profile.kind).
  const contexts = attackContextsFor(attacker.attacker.source, action.attackKey);
  if (contexts.length === 0) {
    return {
      kind: 'skipped',
      action,
      reason: `no profiles for ${action.attackKey}`,
    };
  }

  // All alive player units become members of the rotation (so team-buff
  // carriers on the team apply their auras). Only `attacker` gets
  // scheduled actions — this keeps the parity math straightforward.
  const members = buildMembersForRotation(battle, attacker);

  const turnActions: TeamAction[] = contexts.map((ctx) => ({
    memberId: attacker.id,
    attack: ctx,
    buffs: deriveHexBuffs(attacker, victim, battle, ctx.profile),
  }));

  const rotation: TeamRotation = {
    members,
    turns: [{ actions: turnActions }],
  };

  const target = unitToTarget(victim, battle);
  // Engine state threading — the same `BattleState` reference flows
  // across every map turn so cross-turn marks (Vitruvius) survive.
  const preExisting = prepareBattleStateForCall(battle.battleState, target);
  const breakdown = resolveTeamRotation(rotation, target, preExisting);

  // Drain the victim by the sum of expected damage across per-context
  // breakdowns. The engine internally respected the ordering (shield
  // first, then HP), but its mutation happens against a LOCAL copy — we
  // mirror the drain onto the map Unit here.
  const perContext: DamageBreakdown[] = [];
  let totalExpected = 0;
  const actionsForMember = breakdown.perMember[attacker.id]?.perAction ?? [];
  for (const entry of actionsForMember) {
    perContext.push(entry.result);
    totalExpected += entry.result.expected;
  }

  const damageApplied = drainUnit(victim, totalExpected);

  return {
    kind: 'attack',
    attackerId: attacker.id,
    targetId: victim.id,
    attackKey: action.attackKey,
    perContext,
    totalExpected,
    damageApplied,
    teamBuffApplications: breakdown.teamBuffApplications,
  };
}

/**
 * Resolve an attack key to a list of `AttackContext`s using the same
 * rules the rotation editor follows (`useDamage.ts::attackContextsFor`).
 * Kept in a private helper rather than imported so the map layer has zero
 * cross-dependency on the UI hooks directory.
 */
function attackContextsFor(
  char: CatalogCharacter,
  key: AttackKey,
): AttackContext[] {
  if (key === 'melee' && char.melee) {
    return [{ profile: char.melee, rngMode: 'expected' }];
  }
  if (key === 'ranged' && char.ranged) {
    return [{ profile: char.ranged, rngMode: 'expected' }];
  }
  if (key.startsWith('ability:')) {
    const id = key.slice('ability:'.length);
    const ability = char.abilities.find((a) => a.id === id);
    if (!ability) return [];
    const isMulti = ability.profiles.length > 1;
    return ability.profiles.map<AttackContext>((profile, idx) => ({
      profile: isMulti ? { ...profile, abilityProfileIdx: idx } : profile,
      rngMode: 'expected',
    }));
  }
  return [];
}

/**
 * Build the member list handed to the engine. We include every alive
 * player-side unit so aura carriers can emit their passives, and we
 * include `attacker` even if, in some future scenario, they'd been
 * marked dead but the caller still attempts to attack (defensive).
 *
 * TeamPositions are assigned sequentially by sorted unit id. This is
 * a deterministic lossy mapping from hex coords to 0..5 — documented
 * in the module header. The attacker always gets position 0 so
 * single-carrier auras (Helbrecht self-inclusive aura) never surprise.
 */
function buildMembersForRotation(
  battle: MapBattleState,
  attacker: Unit,
): TeamMember[] {
  const alivePlayers: Unit[] = Object.values(battle.units)
    .filter((u) => u.side === 'player' && u.currentHp > 0)
    .filter((u) => u.id !== attacker.id);
  // Sort to keep TeamPosition assignment deterministic run-to-run.
  alivePlayers.sort((a, b) => a.id.localeCompare(b.id));

  const ordered = [attacker, ...alivePlayers];
  // Clamp to 6 — the max TeamPosition is 5 (MoW slot). In-practice the
  // map layer will never carry more than 5 player units + 1 MoW, but a
  // defensive slice makes the assignment total.
  const slice = ordered.slice(0, 6);

  const members: TeamMember[] = slice.map((u, idx) => ({
    id: u.id,
    attacker: u.attacker,
    position: idx as TeamMember['position'],
  }));
  return members;
}

/**
 * The engine's `deriveTeamBuffs` reads `battleState.targetTraits` for
 * trait-gated auras (Helbrecht's Destroy the Witch 'psyker' gate).
 * `initMapBattle` already seeded this from the primary enemy at battle
 * start, but if the player's attack now targets a different unit
 * (summon with different traits), we refresh the trait cache so the
 * engine sees the correct list. Returns the same reference mutated in
 * place — callers receive an already-threaded state.
 */
function prepareBattleStateForCall(
  battleState: BattleState,
  target: ReturnType<typeof unitToTarget>,
): BattleState {
  battleState.targetTraits = collectTargetTraits(target);
  return battleState;
}

/**
 * Mirror of the engine's internal trait collector (`team.ts`) — kept
 * private so we don't grow the engine's exported surface. Hero-as-
 * target traits live on `source.traits`; boss-as-target traits come
 * from the active stage. Active-debuff traits layer on top in both
 * paths, matching the engine's semantics exactly.
 */
function collectTargetTraits(
  target: ReturnType<typeof unitToTarget>,
): string[] {
  const debuffTraits = target.activeDebuffs?.traits ?? [];
  const src = target.source;
  if ('stages' in src) {
    const idx = target.stageIndex ?? 0;
    const stage = src.stages[Math.min(idx, src.stages.length - 1)];
    return [...stage.traits, ...debuffTraits];
  }
  return [...src.traits, ...debuffTraits];
}

/**
 * Subtract `damage` from the unit's shield-then-HP pool. Returns the
 * amount actually removed (clamped to maxHp + maxShield remaining).
 */
export function drainUnit(unit: Unit, damage: number): number {
  if (damage <= 0) return 0;
  let left = damage;
  const before = unit.currentShield + unit.currentHp;
  if (unit.currentShield > 0) {
    const absorbed = Math.min(unit.currentShield, left);
    unit.currentShield -= absorbed;
    left -= absorbed;
  }
  if (left > 0) {
    unit.currentHp = Math.max(0, unit.currentHp - left);
  }
  const after = unit.currentShield + unit.currentHp;
  return before - after;
}

// ────────────────────────────────────────────────────────────────────
// Misc utilities used by the UI layer — exported for HighlightLayer so
// it can validate which enemies a selected attacker can currently hit
// without duplicating range logic.
// ────────────────────────────────────────────────────────────────────

/**
 * True when `attacker` could legally fire `profile` against `victim`
 * right now — positional range check only. For MVP we treat every
 * profile as hittable if the attacker is alive and the victim is on a
 * known hex; future phases will gate by `rangeHexes` / line-of-sight /
 * cooldown. The function returns the `hexDistance` between attacker
 * and victim as a side value so UI tooltips can show "1 hex away".
 */
export function attackRangeInfo(
  attacker: Unit,
  victim: Unit,
): { inRange: boolean; distance: number } {
  // Same-hex targeting is disallowed by convention.
  if (hexEquals(attacker.position, victim.position)) {
    return { inRange: false, distance: 0 };
  }
  // Placeholder: every alive-vs-alive pairing is in range.
  const dq = attacker.position.q - victim.position.q;
  const dr = attacker.position.r - victim.position.r;
  const distance =
    (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  return { inRange: true, distance };
}

// Re-export the buff-merging helper in case a future predict-mode caller
// wants the same hex-buff list without constructing a rotation.
export function hexBuffsForAttack(
  attacker: Unit,
  victim: Unit,
  profile: AttackProfile,
  battle: MapBattleState,
): TurnBuff[] {
  return deriveHexBuffs(attacker, victim, battle, profile);
}
