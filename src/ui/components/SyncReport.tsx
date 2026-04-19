import { useState } from 'react';
import { useApp } from '../../state/store';

export function SyncReport() {
  const { syncReport } = useApp();
  const [expanded, setExpanded] = useState(false);

  if (!syncReport) return null;

  const matched = syncReport.matched.length;
  const unmatched = syncReport.unmatched.length;
  const total = syncReport.totalApiUnits;
  const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
  const unknownItems = syncReport.unknownItems.length;

  const tone =
    pct === 100 ? 'text-emerald-300' : pct >= 80 ? 'text-amber-300' : 'text-red-300';

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold">Sync Report</h3>
        <span className={tone}>
          {matched}/{total} units matched ({pct}%)
        </span>
        {unknownItems > 0 && (
          <span className="text-amber-300">{unknownItems} unknown items (likely relics)</span>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto rounded bg-bg-subtle px-2 py-0.5 text-xs"
        >
          {expanded ? 'hide details' : 'details'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <div className="text-xs uppercase text-slate-400">
              Unmatched API ids ({unmatched})
            </div>
            {unmatched === 0 ? (
              <div className="mt-1 text-xs text-slate-500">none</div>
            ) : (
              <ul className="mt-1 max-h-64 overflow-auto rounded bg-bg-base p-2 text-xs">
                {syncReport.unmatched.map((u) => (
                  <li key={u.apiId} className="font-mono text-slate-300">
                    {u.apiId}
                    {u.apiName && (
                      <span className="text-slate-500"> — {u.apiName}</span>
                    )}
                    {u.faction && (
                      <span className="ml-1 text-slate-600">[{u.faction}]</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] italic leading-snug text-slate-500">
              These api ids aren't in the local catalog. Add them to{' '}
              <code>src/api/aliases.ts</code> or re-scrape the wiki for missing
              characters.
            </p>
          </div>

          <div>
            <div className="text-xs uppercase text-slate-400">
              Unknown item ids ({unknownItems})
            </div>
            {unknownItems === 0 ? (
              <div className="mt-1 text-xs text-slate-500">none</div>
            ) : (
              <ul className="mt-1 max-h-64 overflow-auto rounded bg-bg-base p-2 text-xs">
                {syncReport.unknownItems.map((id) => (
                  <li key={id} className="font-mono text-slate-300">
                    {id}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] italic leading-snug text-slate-500">
              Items not in catalog are treated as relics (character-specific)
              with no stat mods. Enter mods manually in the Build editor's
              "manual stat bonuses" panel.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
