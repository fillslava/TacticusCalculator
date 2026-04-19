import { useMemo } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { listBosses, getBoss } from '../../data/catalog';
import { applyPrimeDebuffs } from '../../engine/bossDebuffs';

export function TargetEditor() {
  const { target, setTarget } = useApp();
  const t = useT();
  const bosses = useMemo(() => listBosses(), []);
  const boss = target.bossId ? getBoss(target.bossId) : undefined;
  const stages = boss?.stages ?? [];
  const stage = boss && stages[target.stageIndex];
  const primes = boss?.primes;
  const prime1Level = target.prime1Level ?? 0;
  const prime2Level = target.prime2Level ?? 0;

  const debuffed = boss && stage && (prime1Level > 0 || prime2Level > 0)
    ? applyPrimeDebuffs(
        { armor: stage.armor, hp: stage.hp },
        primes,
        [prime1Level, prime2Level],
      )
    : null;

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">{t('section.target')}</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">{t('label.boss')}</span>
          <select
            value={target.bossId ?? ''}
            onChange={(e) =>
              setTarget({
                bossId: e.target.value || null,
                stageIndex: 0,
                prime1Level: 0,
                prime2Level: 0,
              })
            }
            className="rounded bg-bg-base px-2 py-1 text-sm"
          >
            <option value="">{t('placeholder.customStats')}</option>
            {bosses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </select>
        </label>

        {stages.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">{t('label.stage')}</span>
            <select
              value={target.stageIndex}
              onChange={(e) => setTarget({ stageIndex: Number(e.target.value) })}
              className="rounded bg-bg-base px-2 py-1 text-sm"
            >
              {stages.map((s, i) => (
                <option key={i} value={i}>
                  {s.name} · {t('label.hp')} {s.hp.toLocaleString()} · {t('label.armor')} {s.armor}
                </option>
              ))}
            </select>
          </label>
        )}

        {!boss && (
          <>
            <NumberField
              label={t('label.armor')}
              value={target.customArmor ?? 0}
              onChange={(v) => setTarget({ customArmor: v })}
            />
            <NumberField
              label={t('label.hp')}
              value={target.customHp ?? 100000}
              onChange={(v) => setTarget({ customHp: v })}
            />
            <NumberField
              label={t('label.shield')}
              value={target.customShield ?? 0}
              onChange={(v) => setTarget({ customShield: v })}
            />
          </>
        )}
      </div>

      {primes && primes.length > 0 && (
        <div className="mt-3 rounded border border-bg-subtle/40 bg-bg-base p-2">
          <div className="text-[10px] uppercase text-slate-500">
            Prime kills · each kill stacks a debuff on the boss
          </div>
          <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2">
            {primes.map((prime, i) => {
              const lvl = i === 0 ? prime1Level : prime2Level;
              const setLvl = (v: number) =>
                setTarget(
                  i === 0 ? { prime1Level: v } : { prime2Level: v },
                );
              return (
                <label key={i} className="flex flex-col gap-1 text-xs">
                  <span className="text-slate-300">
                    Prime {i + 1}: {prime.name}
                  </span>
                  <select
                    value={lvl}
                    onChange={(e) => setLvl(Number(e.target.value))}
                    className="rounded bg-bg-elevated px-2 py-1"
                  >
                    <option value={0}>0 kills (full strength)</option>
                    {prime.steps.map((step, j) => (
                      <option key={j} value={j + 1}>
                        {j + 1} {j === 0 ? 'kill' : 'kills'} · {describeStep(step)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          {debuffed && stage && (
            <p className="mt-2 text-[11px] text-slate-400">
              Effective: Armor{' '}
              <span
                className={debuffed.armor < stage.armor ? 'text-emerald-400' : ''}
              >
                {Math.round(debuffed.armor)}
              </span>{' '}
              · HP{' '}
              <span className={debuffed.hp < stage.hp ? 'text-emerald-400' : ''}>
                {Math.round(debuffed.hp).toLocaleString()}
              </span>
            </p>
          )}
        </div>
      )}

      {stage && (
        <div className="mt-3 text-xs text-slate-400">
          traits: {stage.traits.join(', ') || '—'}
        </div>
      )}
    </section>
  );
}

function describeStep(step: {
  stat: 'armor' | 'damage' | 'hp' | 'critDamage' | null;
  mode?: 'pct' | 'flat';
  value?: number;
  rawId?: string;
}): string {
  if (step.stat === null) {
    const label = step.rawId?.replace(/^boss_debuff_/, '') ?? 'ability debuff';
    return `inert (${label})`;
  }
  const prefix = `${step.stat}`;
  if (step.mode === 'pct' && step.value !== undefined)
    return `−${Math.round(step.value * 100)}% ${prefix}`;
  if (step.mode === 'flat' && step.value !== undefined)
    return `−${step.value} ${prefix}`;
  return prefix;
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
