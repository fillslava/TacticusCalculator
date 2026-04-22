import { useMemo } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { listCharacters } from '../../data/catalog';
import {
  progressionToRarity,
  progressionToStarLevel,
} from '../../engine/progression';

/**
 * Guild-Raid team composer — picks up to five catalog characters for the
 * linear formation slots m0..m4. Adjacency in the engine is position-based
 * (|Δposition|=1); in the single-boss MVP the boss is treated as always
 * adjacent to every team member, so the visible slot order is mostly
 * cosmetic — but we keep it stable so teamBuff ordering stays predictable.
 *
 * Build stats (progression / rank / xpLevel / equipment) are pulled per-slot
 * from `unitBuilds` (owned heroes) or fall back to the current `build`
 * overrides for unowned heroes. Per-slot build editing is intentionally
 * deferred — the single-attacker BuildEditor still owns the "edit one hero"
 * workflow.
 */
export function TeamComposer() {
  const team = useApp((s) => s.team);
  const setTeamMember = useApp((s) => s.setTeamMember);
  const unitBuilds = useApp((s) => s.unitBuilds);
  const ownedCatalogIds = useApp((s) => s.ownedCatalogIds);
  const t = useT();

  const characters = useMemo(() => listCharacters(), []);
  const ownedSet = useMemo(
    () => new Set(ownedCatalogIds),
    [ownedCatalogIds],
  );

  const sortedCharacters = useMemo(
    () =>
      [...characters].sort((a, b) => {
        const aOwned = ownedSet.has(a.id);
        const bOwned = ownedSet.has(b.id);
        if (aOwned !== bOwned) return aOwned ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      }),
    [characters, ownedSet],
  );

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">{t('team.composer.title')}</h2>
      <p className="mt-1 text-xs text-slate-400">
        {t('team.composer.description')}
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {team.members.map((m) => {
          const char = m.characterId
            ? characters.find((c) => c.id === m.characterId)
            : undefined;
          const memo = m.characterId ? unitBuilds[m.characterId] : undefined;
          const rarity = memo
            ? progressionToRarity(memo.progression)
            : undefined;
          const stars = memo
            ? progressionToStarLevel(memo.progression)
            : undefined;
          const owned = m.characterId ? ownedSet.has(m.characterId) : false;
          return (
            <li
              key={m.slotId}
              className="flex flex-col gap-1 rounded border border-bg-subtle/50 bg-bg-base p-2 text-xs md:flex-row md:items-center"
            >
              <span className="w-16 font-mono text-[11px] uppercase tracking-wide text-slate-500">
                {t('team.composer.slot')} {m.position + 1}
              </span>
              <select
                value={m.characterId ?? ''}
                onChange={(e) =>
                  setTeamMember(m.slotId, e.target.value || null)
                }
                className="flex-1 rounded bg-bg-elevated px-2 py-1 text-sm"
              >
                <option value="">{t('team.composer.pickHero')}</option>
                {sortedCharacters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {ownedSet.has(c.id) ? '★ ' : '  '}
                    {c.displayName} ({c.faction})
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                {char && (
                  <>
                    <span>
                      {t('team.composer.alliance')}:{' '}
                      <span className="text-slate-300">{char.alliance}</span>
                    </span>
                    <span>
                      {t('team.composer.faction')}:{' '}
                      <span className="text-slate-300">{char.faction}</span>
                    </span>
                  </>
                )}
                {memo && (
                  <span>
                    {t('team.composer.rarity')}:{' '}
                    <span className="text-slate-300">
                      {rarity} ·{stars !== undefined ? ` ${stars}★` : ''} · L
                      {memo.xpLevel}
                    </span>
                  </span>
                )}
                {char && !owned && (
                  <span className="italic text-amber-400/70">
                    {t('team.composer.unowned')}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
