import type {
  MapBattleState,
  Unit,
} from '../../../map/battle/mapBattleState';
import type { Suggestion } from '../../../map/ai/policy';
import { HEURISTIC_POLICY } from '../../../map/ai/predict';

/**
 * Phase 6 — predict-mode side panel.
 *
 * Shown instead of (or alongside) {@link ActionPanel} when the user
 * flips the "predict" toggle on the map toolbar. For the currently-
 * selected player unit we surface the top 3 suggestions from the
 * reference heuristic policy (`HEURISTIC_POLICY`), including:
 *   - target label (display name + id tail for disambiguation),
 *   - expected damage,
 *   - kill probability (0-100%),
 *   - composite score.
 *
 * The `onPick` callback lets the parent page commit a suggestion into
 * the action queue with a single click — the same idiom as the manual
 * attack-key buttons in ActionPanel. When `onPick` is omitted the
 * panel is read-only (useful for scenario-debugging views).
 *
 * Implementation notes:
 *   - We call `HEURISTIC_POLICY.suggest` inside the component so the
 *     list always reflects the latest board; the heuristic is pure and
 *     cheap (≤ a few dozen `resolveAttack` calls per click).
 *   - A future ML-backed `Policy` can be swapped in by the parent by
 *     passing a `policy` prop — left out for now since only one
 *     implementation ships.
 */
interface Props {
  battle: MapBattleState;
  active: Unit | null;
  /** Click handler — commit the suggested attack into the queue. */
  onPick?: (s: Suggestion) => void;
  /** Cap the visible list. Defaults to 3. */
  limit?: number;
}

export function PredictSuggestions({
  battle,
  active,
  onPick,
  limit = 3,
}: Props) {
  if (!active) {
    return (
      <section className="rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
        <h3 className="text-base font-semibold">Predict</h3>
        <p className="mt-1 text-xs text-slate-400">
          Select a player unit to see ranked suggestions.
        </p>
      </section>
    );
  }
  if (active.currentHp <= 0) {
    return (
      <section className="rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
        <h3 className="text-base font-semibold">Predict</h3>
        <p className="mt-1 text-xs text-slate-400">
          {active.attacker.source.displayName} is down — nothing to suggest.
        </p>
      </section>
    );
  }

  const all = HEURISTIC_POLICY.suggest(active, battle);
  const top = all.slice(0, limit);

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
      <header className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold">Predict</h3>
        <span className="text-[11px] text-slate-500">
          {all.length} candidate{all.length === 1 ? '' : 's'}
        </span>
      </header>
      <p className="mt-0.5 text-xs text-slate-400">
        for {active.attacker.source.displayName}
      </p>
      {top.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No valid targets.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {top.map((s, i) => {
            const target = battle.units[s.targetId];
            const targetName =
              target?.attacker.source.displayName ?? s.targetId;
            return (
              <li
                key={`${s.targetId}:${s.attackKey}`}
                className="flex items-center justify-between gap-2 rounded border border-bg-subtle bg-bg-base px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-100">
                    {i + 1}. {s.profileLabel} → {targetName}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {Math.round(s.expectedDamage).toLocaleString()} dmg
                    {' • '}
                    {(s.killChance * 100).toFixed(1)}% kill
                    {' • '}
                    score {Math.round(s.score).toLocaleString()}
                  </div>
                </div>
                {onPick ? (
                  <button
                    type="button"
                    onClick={() => onPick(s)}
                    className="shrink-0 rounded border border-bg-subtle bg-bg-elevated px-2 py-1 text-[11px] hover:border-accent hover:text-accent"
                  >
                    Queue
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
