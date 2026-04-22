import { useMemo, useState } from 'react';
import { useTeamDamage } from '../hooks/useTeamDamage';
import { useT } from '../../lib/i18n';

/**
 * Team damage panel — mirrors {@link DamageResult} for single-attacker but
 * surfaces per-member totals, the full team-buff application log, and
 * cooldown skips. Team-buff applications are the most interesting new
 * information: they prove (or disprove) that a Laviscus / Trajann / Biovore
 * synergy actually fired.
 */
export function TeamDamageResult() {
  const data = useTeamDamage();
  const t = useT();
  const [showBuffs, setShowBuffs] = useState(true);
  const [showSkips, setShowSkips] = useState(false);

  if (!data) {
    return (
      <section className="rounded border border-bg-subtle bg-bg-elevated p-4 text-slate-400">
        {t('team.result.noRotation')}
      </section>
    );
  }

  const { result, charById, rotation } = data;
  const totalExpected = result.cumulativeTeamExpected.at(-1) ?? 0;
  const turnCount = rotation.turns.length;

  const perMemberTotals = useMemo(() => {
    const rows = rotation.members.map((m) => {
      const breakdown = result.perMember[m.id];
      const total = breakdown?.perAction.reduce(
        (s, a) => s + a.result.expected,
        0,
      ) ?? 0;
      const firedCount = breakdown?.perAction.length ?? 0;
      const triggered = breakdown?.triggeredFires.length ?? 0;
      const skipped = breakdown?.cooldownSkips.length ?? 0;
      return {
        memberId: m.id,
        position: m.position,
        displayName: charById[m.id]?.displayName ?? m.id,
        total,
        firedCount,
        triggered,
        skipped,
      };
    });
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [result, rotation, charById]);

  const perTurnExpected = useMemo(() => {
    const arr: number[] = [];
    let prev = 0;
    for (const cum of result.cumulativeTeamExpected) {
      arr.push(cum - prev);
      prev = cum;
    }
    return arr;
  }, [result]);

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">{t('team.result.title')}</h2>

      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium text-slate-400">
            {t('team.result.teamTotal')}
          </h3>
          <div className="mt-1 text-4xl font-semibold text-accent">
            {Math.round(totalExpected).toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {t('team.result.turnsToKill')}:{' '}
            <span className="font-semibold text-slate-200">
              {result.turnsToKill === 'unreachable'
                ? t('team.result.unreachable')
                : result.turnsToKill}
            </span>{' '}
            <span className="text-slate-600">/ {turnCount}</span>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-slate-400">
            {t('team.result.perTurnTeam')}
          </h3>
          <ol className="mt-1 grid grid-cols-1 gap-1 text-sm">
            {perTurnExpected.map((dmg, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded bg-bg-base px-2 py-1 font-mono text-xs"
              >
                <span className="text-slate-500">
                  {t('team.result.turn')} {i + 1}
                </span>
                <span>{Math.round(dmg).toLocaleString()}</span>
                <span className="text-slate-500">
                  ∑ {Math.round(result.cumulativeTeamExpected[i]).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-medium text-slate-400">
          {t('team.result.perMember')}
        </h3>
        <ul className="mt-1 flex flex-col gap-1">
          {perMemberTotals.map((row) => (
            <li
              key={row.memberId}
              className="flex items-center gap-2 rounded bg-bg-base px-2 py-1 text-sm"
            >
              <span className="w-8 font-mono text-xs text-slate-500">
                S{row.position + 1}
              </span>
              <span className="flex-1">{row.displayName}</span>
              <span className="font-mono">
                {Math.round(row.total).toLocaleString()}
              </span>
              <span className="w-28 text-right text-[11px] text-slate-500">
                {row.firedCount} fired
                {row.triggered > 0 ? ` · ${row.triggered} trig` : ''}
                {row.skipped > 0 ? ` · ${row.skipped} cd` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <button
          onClick={() => setShowBuffs((v) => !v)}
          className="text-xs text-slate-400 underline decoration-dotted"
        >
          {showBuffs ? '−' : '+'} {t('team.result.buffApplications')} (
          {result.teamBuffApplications.length})
        </button>
        {showBuffs && result.teamBuffApplications.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {result.teamBuffApplications.map((app, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-2 rounded bg-bg-base px-2 py-1"
              >
                <span className="font-mono text-[10px] text-slate-500">
                  T{app.turnIdx + 1}
                </span>
                <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-amber-300">
                  {app.kind}
                </span>
                <span className="text-slate-400">
                  {charById[app.sourceMemberId]?.displayName ??
                    app.sourceMemberId}
                </span>
                <span className="text-slate-600">→</span>
                <span className="text-slate-300">
                  {charById[app.appliedToMemberId]?.displayName ??
                    app.appliedToMemberId}
                </span>
                <span className="ml-auto font-mono text-[11px] text-slate-400">
                  {app.effect}
                </span>
              </li>
            ))}
          </ul>
        )}
        {showBuffs && result.teamBuffApplications.length === 0 && (
          <p className="mt-1 text-[11px] italic text-slate-500">
            (no team-buff triggers — add Laviscus, Trajann, or Biovore and
            schedule their enabling attacks)
          </p>
        )}
      </div>

      <div className="mt-3">
        <button
          onClick={() => setShowSkips((v) => !v)}
          className="text-xs text-slate-400 underline decoration-dotted"
        >
          {showSkips ? '−' : '+'} {t('team.result.cooldownSkips')} (
          {result.cooldownSkips.length})
        </button>
        {showSkips && result.cooldownSkips.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {result.cooldownSkips.map((s, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded bg-bg-base px-2 py-1"
              >
                <span className="font-mono text-[10px] text-slate-500">
                  T{s.turnIdx + 1}
                </span>
                <span>
                  {charById[s.memberId]?.displayName ?? s.memberId}
                </span>
                <span className="ml-auto font-mono text-[11px] text-slate-400">
                  {s.abilityId}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
