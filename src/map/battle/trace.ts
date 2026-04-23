import type { MapBattleState } from './mapBattleState';
import type { PlayerActionLog } from './playerTurn';
import type { EnemyTurnResult } from '../ai/bossAi';

/**
 * Phase 6 — battle trace export.
 *
 * Produces a stream of per-turn state snapshots + action records that a
 * future trainer (ML policy / human analysis tool) can ingest. The
 * format is deliberately stable JSONL so new fields can be added
 * additively without breaking older trainer scripts.
 *
 * Scope of the shipped format:
 *   - ONE trace line per turn (side-agnostic). A turn entry contains
 *     both the pre-turn snapshot and the actions that resolved.
 *   - State snapshot includes every alive unit's (id, side, kind,
 *     position, currentHp, currentShield, maxHp, maxShield) — enough to
 *     recompute damage and rankings, but not the full `CatalogCharacter`
 *     (the trainer rebuilds that from `unit.id` via its own catalog).
 *   - Actions mirror what the UI already renders: for the player side,
 *     the `PlayerActionLog[]` slice for that turn; for the enemy side,
 *     an `EnemyTurnResult.actions[]` slice.
 *
 * Not in scope (future):
 *   - Derived features (hex distances, remaining cooldowns) — trainers
 *     can compute these from the raw state.
 *   - Reward labels. We deliberately leave this for later because
 *     "what counts as good" is unsettled; early traces can be relabeled
 *     in a side file.
 *
 * `battleToJsonl` handles the canonical serialization. The UI wires it
 * behind a download button; tests can call it directly.
 */

export interface TraceUnitSnapshot {
  id: string;
  side: 'player' | 'enemy';
  kind: string;
  position: { q: number; r: number };
  currentHp: number;
  currentShield: number;
  maxHp: number;
  maxShield: number;
}

export type TraceActionEntry =
  | { side: 'player'; log: PlayerActionLog[] }
  | { side: 'enemy'; result: EnemyTurnResult };

export interface TraceTurn {
  /** 0-indexed map turn at the moment the snapshot was captured. */
  turnIdx: number;
  /** 'player' or 'enemy' — which side's turn this record represents. */
  side: 'player' | 'enemy';
  /** Snapshot of every alive unit BEFORE the turn's actions resolved. */
  unitsBefore: TraceUnitSnapshot[];
  /** The resolved actions (shape varies by side). */
  actions: TraceActionEntry;
}

export interface BattleTrace {
  mapId: string;
  bossScriptId?: string;
  /** Player team composition — `{ unitId, catalogId }` pairs. */
  team: Array<{ unitId: string; catalogId: string }>;
  /** Every committed turn in chronological order. */
  turns: TraceTurn[];
  /** Summary tag set once the battle resolves. */
  outcome?: 'win' | 'loss' | 'timeout';
  /** Timestamp (ms since epoch) of when the trace was produced. */
  exportedAt: number;
}

// ────────────────────────────────────────────────────────────────────
// Snapshot helpers
// ────────────────────────────────────────────────────────────────────

export function snapshotUnits(battle: MapBattleState): TraceUnitSnapshot[] {
  const out: TraceUnitSnapshot[] = [];
  for (const u of Object.values(battle.units)) {
    out.push({
      id: u.id,
      side: u.side,
      kind: u.kind,
      position: { q: u.position.q, r: u.position.r },
      currentHp: u.currentHp,
      currentShield: u.currentShield,
      maxHp: u.maxHp,
      maxShield: u.maxShield,
    });
  }
  return out;
}

export function traceTurnFromPlayerResult(
  battle: MapBattleState,
  log: PlayerActionLog[],
): TraceTurn {
  return {
    turnIdx: battle.turnIdx,
    side: 'player',
    unitsBefore: snapshotUnits(battle),
    actions: { side: 'player', log },
  };
}

export function traceTurnFromEnemyResult(
  battle: MapBattleState,
  result: EnemyTurnResult,
): TraceTurn {
  return {
    turnIdx: battle.turnIdx,
    side: 'enemy',
    unitsBefore: snapshotUnits(battle),
    actions: { side: 'enemy', result },
  };
}

// ────────────────────────────────────────────────────────────────────
// Assembly
// ────────────────────────────────────────────────────────────────────

export interface TraceBuilderInput {
  battle: MapBattleState;
  turns: TraceTurn[];
  outcome?: BattleTrace['outcome'];
}

export function assembleTrace(input: TraceBuilderInput): BattleTrace {
  const { battle, turns, outcome } = input;
  const team: BattleTrace['team'] = [];
  for (const t of turns) {
    for (const snap of t.unitsBefore) {
      if (snap.side !== 'player') continue;
      if (team.find((x) => x.unitId === snap.id)) continue;
      const catalogId =
        battle.units[snap.id]?.attacker.source.id ?? snap.id;
      team.push({ unitId: snap.id, catalogId });
    }
  }
  return {
    mapId: battle.map.id,
    bossScriptId: battle.map.bossScriptId,
    team,
    turns,
    outcome,
    exportedAt: Date.now(),
  };
}

// ────────────────────────────────────────────────────────────────────
// Serialization
// ────────────────────────────────────────────────────────────────────

/**
 * Serialize a BattleTrace to JSONL. Header line is the trace metadata
 * (map id, team, outcome, exportedAt); subsequent lines are one
 * `TraceTurn` JSON object each. JSONL (rather than a single JSON array)
 * is chosen for streaming trainers that want to ingest one turn at a
 * time — trivially appendable, trivially concatenable across battles.
 */
export function battleToJsonl(trace: BattleTrace): string {
  const header = {
    kind: 'trace_header',
    mapId: trace.mapId,
    bossScriptId: trace.bossScriptId,
    team: trace.team,
    outcome: trace.outcome,
    exportedAt: trace.exportedAt,
  };
  const lines: string[] = [JSON.stringify(header)];
  for (const t of trace.turns) {
    lines.push(JSON.stringify({ kind: 'trace_turn', ...t }));
  }
  return lines.join('\n') + '\n';
}

/**
 * Build + serialize in one shot. Used by the UI's "Export trace" button
 * and by the tests. Kept as a thin wrapper so trainer scripts can call
 * `assembleTrace` / `battleToJsonl` separately when they need to inject
 * custom outcome labels.
 */
export function exportBattleTrace(input: TraceBuilderInput): string {
  return battleToJsonl(assembleTrace(input));
}
