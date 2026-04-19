import { useMemo } from 'react';
import { useApp } from '../../state/store';
import { listBosses, getBoss } from '../../data/catalog';

export function TargetEditor() {
  const { target, setTarget } = useApp();
  const bosses = useMemo(() => listBosses(), []);
  const boss = target.bossId ? getBoss(target.bossId) : undefined;
  const stages = boss?.stages ?? [];

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">Target</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Boss</span>
          <select
            value={target.bossId ?? ''}
            onChange={(e) =>
              setTarget({ bossId: e.target.value || null, stageIndex: 0 })
            }
            className="rounded bg-bg-base px-2 py-1 text-sm"
          >
            <option value="">— custom stats —</option>
            {bosses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </select>
        </label>

        {stages.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">Stage</span>
            <select
              value={target.stageIndex}
              onChange={(e) => setTarget({ stageIndex: Number(e.target.value) })}
              className="rounded bg-bg-base px-2 py-1 text-sm"
            >
              {stages.map((s, i) => (
                <option key={i} value={i}>
                  {s.name} · HP {s.hp.toLocaleString()} · Armor {s.armor}
                </option>
              ))}
            </select>
          </label>
        )}

        {!boss && (
          <>
            <NumberField
              label="Armor"
              value={target.customArmor ?? 0}
              onChange={(v) => setTarget({ customArmor: v })}
            />
            <NumberField
              label="HP"
              value={target.customHp ?? 100000}
              onChange={(v) => setTarget({ customHp: v })}
            />
            <NumberField
              label="Shield"
              value={target.customShield ?? 0}
              onChange={(v) => setTarget({ customShield: v })}
            />
          </>
        )}
      </div>

      {boss && stages[target.stageIndex] && (
        <div className="mt-3 text-xs text-slate-400">
          traits: {stages[target.stageIndex].traits.join(', ') || '—'}
        </div>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded bg-bg-base px-2 py-1 font-mono text-sm"
      />
    </label>
  );
}
