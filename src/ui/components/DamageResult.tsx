import { useState } from 'react';
import { useDamage } from '../hooks/useDamage';

export function DamageResult() {
  const data = useDamage();
  const [showTrace, setShowTrace] = useState(false);

  if (!data) {
    return (
      <section className="rounded border border-bg-subtle bg-bg-elevated p-4 text-slate-400">
        Pick a character and target to see damage.
      </section>
    );
  }

  const { result } = data;
  const first = result.perTurn[0];
  const totalExpected = result.cumulativeExpected.at(-1) ?? 0;

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">Damage</h2>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium text-slate-400">First turn</h3>
          <div className="mt-1 text-4xl font-semibold text-accent">
            {Math.round(first.expected).toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            range {Math.round(first.min).toLocaleString()} –{' '}
            {Math.round(first.max).toLocaleString()} · crit{' '}
            {(first.critProbability * 100).toFixed(0)}%
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-slate-400">Rotation total</h3>
          <div className="mt-1 text-4xl font-semibold">
            {Math.round(totalExpected).toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            turns to kill:{' '}
            <span className="font-semibold text-slate-200">
              {result.turnsToKill === 'unreachable' ? '∞' : result.turnsToKill}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-medium text-slate-400">Per turn</h3>
        <ol className="mt-1 grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
          {result.perTurn.map((t, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded bg-bg-base px-2 py-1 font-mono"
            >
              <span className="text-slate-500">T{i + 1}</span>
              <span>{Math.round(t.expected).toLocaleString()}</span>
              <span className="text-xs text-slate-500">
                min {Math.round(t.min).toLocaleString()} / max{' '}
                {Math.round(t.max).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <button
        onClick={() => setShowTrace((s) => !s)}
        className="mt-3 text-xs text-slate-400 underline decoration-dotted"
      >
        {showTrace ? 'hide trace' : 'show trace'}
      </button>
      {showTrace && (
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-bg-base p-2 text-xs text-slate-300">
          {first.trace.map((t, i) => `${i}. [${t.phase}] ${t.description}`).join('\n')}
        </pre>
      )}
    </section>
  );
}
