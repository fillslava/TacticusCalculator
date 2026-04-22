import type {
  MapBattleState,
  Unit,
} from '../../../map/battle/mapBattleState';
import type {
  AttackKey,
  PlayerAction,
  PlayerActionLog,
} from '../../../map/battle/playerTurn';

/**
 * Phase 4 — side panel. Three stacked sections:
 *
 *   1. **Active unit** — name + HP/shield of the currently-selected
 *      player unit, plus the list of attack profiles they can fire
 *      (melee, ranged, each active ability).
 *   2. **Queued actions** — chronological list of the user's queued
 *      `PlayerAction`s for this turn, with a "clear" button and an
 *      "end turn" button.
 *   3. **Last turn log** — damage + move breakdowns from the most
 *      recently resolved turn.
 *
 * The panel is a pure-presentational component — MapPage owns the
 * wiring (store hooks, event handlers). That keeps the component
 * tree tidy and lets the e2e harness (future) drive it without a
 * mock store.
 */
interface Props {
  battle: MapBattleState;
  active: Unit | null;
  queuedActions: PlayerAction[];
  lastTurnLog: PlayerActionLog[];
  onPickAttack: (key: AttackKey) => void;
  onClearQueue: () => void;
  onEndTurn: () => void;
}

export function ActionPanel({
  battle,
  active,
  queuedActions,
  lastTurnLog,
  onPickAttack,
  onClearQueue,
  onEndTurn,
}: Props) {
  return (
    <aside className="flex flex-col gap-3 rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
      <ActiveUnitSection active={active} onPickAttack={onPickAttack} />
      <QueueSection
        battle={battle}
        actions={queuedActions}
        onClear={onClearQueue}
        onEndTurn={onEndTurn}
      />
      <LogSection log={lastTurnLog} battle={battle} />
    </aside>
  );
}

// ────────────────────────────────────────────────────────────────────
// Active unit
// ────────────────────────────────────────────────────────────────────

function ActiveUnitSection({
  active,
  onPickAttack,
}: {
  active: Unit | null;
  onPickAttack: (key: AttackKey) => void;
}) {
  if (!active) {
    return (
      <section>
        <h3 className="text-base font-semibold">No unit selected</h3>
        <p className="text-xs text-slate-400">
          Click a player token to select it.
        </p>
      </section>
    );
  }
  const keys: AttackKey[] = [];
  if (active.attacker.source.melee) keys.push('melee');
  if (active.attacker.source.ranged) keys.push('ranged');
  for (const a of active.attacker.source.abilities) {
    if (a.kind === 'active' && a.profiles.length > 0) {
      keys.push(`ability:${a.id}`);
    }
  }
  return (
    <section>
      <h3 className="text-base font-semibold">
        {active.attacker.source.displayName}
      </h3>
      <p className="text-xs text-slate-400">
        HP {active.currentHp}/{active.maxHp}
        {active.maxShield > 0
          ? ` • Shield ${active.currentShield}/${active.maxShield}`
          : ''}
        {' • '}at ({active.position.q},{active.position.r})
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onPickAttack(k)}
            className="rounded border border-bg-subtle bg-bg-base px-2 py-1 text-xs hover:border-accent hover:text-accent"
          >
            {attackKeyLabel(k, active)}
          </button>
        ))}
      </div>
    </section>
  );
}

function attackKeyLabel(key: AttackKey, unit: Unit): string {
  if (key === 'melee') return unit.attacker.source.melee?.label ?? 'Melee';
  if (key === 'ranged') return unit.attacker.source.ranged?.label ?? 'Ranged';
  if (key.startsWith('ability:')) {
    const id = key.slice('ability:'.length);
    return (
      unit.attacker.source.abilities.find((a) => a.id === id)?.name ?? id
    );
  }
  return key;
}

// ────────────────────────────────────────────────────────────────────
// Queue
// ────────────────────────────────────────────────────────────────────

function QueueSection({
  battle,
  actions,
  onClear,
  onEndTurn,
}: {
  battle: MapBattleState;
  actions: PlayerAction[];
  onClear: () => void;
  onEndTurn: () => void;
}) {
  return (
    <section className="border-t border-bg-subtle pt-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs uppercase tracking-wide text-slate-400">
          Queue ({actions.length})
        </h4>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onClear}
            disabled={actions.length === 0}
            className="rounded border border-bg-subtle bg-bg-base px-2 py-0.5 text-[11px] disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onEndTurn}
            disabled={actions.length === 0}
            className="rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-black disabled:opacity-40"
          >
            End turn
          </button>
        </div>
      </div>
      {actions.length === 0 ? (
        <p className="mt-1 text-[11px] text-slate-500">No actions queued.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-[11px] text-slate-200">
          {actions.map((a, i) => (
            <li key={i}>
              {i + 1}. {describeAction(a, battle)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function describeAction(action: PlayerAction, battle: MapBattleState): string {
  if (action.kind === 'move') {
    const u = battle.units[action.unitId];
    return `Move ${u?.attacker.source.displayName ?? action.unitId} → (${action.to.q},${action.to.r})`;
  }
  const attacker = battle.units[action.attackerId];
  const victim = battle.units[action.targetId];
  return `${attacker?.attacker.source.displayName ?? action.attackerId} → ${victim?.attacker.source.displayName ?? action.targetId} (${action.attackKey})`;
}

// ────────────────────────────────────────────────────────────────────
// Log
// ────────────────────────────────────────────────────────────────────

function LogSection({
  log,
  battle,
}: {
  log: PlayerActionLog[];
  battle: MapBattleState;
}) {
  if (log.length === 0) return null;
  return (
    <section className="border-t border-bg-subtle pt-2">
      <h4 className="mb-1 text-xs uppercase tracking-wide text-slate-400">
        Last turn
      </h4>
      <ul className="space-y-1 text-[11px] text-slate-200">
        {log.map((entry, i) => (
          <li key={i}>{describeLog(entry, battle)}</li>
        ))}
      </ul>
    </section>
  );
}

function describeLog(entry: PlayerActionLog, battle: MapBattleState): string {
  if (entry.kind === 'skipped') {
    return `skipped: ${entry.reason}`;
  }
  if (entry.kind === 'move') {
    const u = battle.units[entry.unitId];
    const prefix = `${u?.attacker.source.displayName ?? entry.unitId} moved (${entry.from.q},${entry.from.r}) → (${entry.to.q},${entry.to.r})`;
    const suffix = entry.enterDamage
      ? ` — took ${Math.round(entry.enterDamage)} enter damage`
      : '';
    return prefix + suffix;
  }
  const a = battle.units[entry.attackerId];
  const v = battle.units[entry.targetId];
  return `${a?.attacker.source.displayName ?? entry.attackerId} → ${v?.attacker.source.displayName ?? entry.targetId}: ${Math.round(entry.totalExpected)} damage (${entry.attackKey})`;
}
