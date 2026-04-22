import { useMemo } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { listCharacters } from '../../data/catalog';
import {
  progressionToRarity,
  progressionToStarLevel,
} from '../../engine/progression';
import type { CatalogCharacter } from '../../engine/types';

/** Catalog characters whose traits include "machine of war" are MoW units —
 *  Biovore, Exorcist, Galatian, Forgefiend, Plagueburst Crawler, Malleus,
 *  Rukkatrukk, Tson'ji, Z'Kar. The 6th Guild-Raid slot accepts only these;
 *  the five hero slots accept every *other* catalog entry. Tacticus'
 *  in-game team-builder enforces the same rule. */
function isMachineOfWar(char: CatalogCharacter): boolean {
  return (char.traits ?? []).some(
    (trait) => trait.toLowerCase() === 'machine of war',
  );
}

/**
 * Guild-Raid team composer — picks up to five catalog heroes for slots
 * m0..m4 and one Machine of War for slot `mow` (position 5). Adjacency in
 * the engine is position-based (|Δposition|=1); in the single-boss MVP the
 * boss is treated as always adjacent to every team member, so the visible
 * slot order is mostly cosmetic — but we keep it stable so teamBuff ordering
 * stays predictable.
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

  /** Dropdown options partitioned by MoW-trait so hero slots can't pick a
   *  MoW and the MoW slot can't pick a hero. Owned-first ordering preserved
   *  inside each partition. */
  const heroOptions = useMemo(
    () =>
      [...characters]
        .filter((c) => !isMachineOfWar(c))
        .sort((a, b) => {
          const aOwned = ownedSet.has(a.id);
          const bOwned = ownedSet.has(b.id);
          if (aOwned !== bOwned) return aOwned ? -1 : 1;
          return a.displayName.localeCompare(b.displayName);
        }),
    [characters, ownedSet],
  );
  const mowOptions = useMemo(
    () =>
      [...characters]
        .filter(isMachineOfWar)
        .sort((a, b) => {
          const aOwned = ownedSet.has(a.id);
          const bOwned = ownedSet.has(b.id);
          if (aOwned !== bOwned) return aOwned ? -1 : 1;
          return a.displayName.localeCompare(b.displayName);
        }),
    [characters, ownedSet],
  );

  const heroMembers = team.members.filter((m) => m.kind === 'hero');
  const mowMembers = team.members.filter((m) => m.kind === 'mow');

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">{t('team.composer.title')}</h2>
      <p className="mt-1 text-xs text-slate-400">
        {t('team.composer.description')}
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {heroMembers.map((m) => (
          <SlotRow
            key={m.slotId}
            slotId={m.slotId}
            characterId={m.characterId}
            label={`${t('team.composer.slot')} ${m.position + 1}`}
            options={heroOptions}
            placeholder={t('team.composer.pickHero')}
            unitBuilds={unitBuilds}
            ownedSet={ownedSet}
            onChange={(id) => setTeamMember(m.slotId, id)}
            t={t}
          />
        ))}
      </ul>

      <h3 className="mt-4 text-xs uppercase tracking-wide text-slate-500">
        {t('team.composer.mowSectionTitle')}
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {mowMembers.map((m) => (
          <SlotRow
            key={m.slotId}
            slotId={m.slotId}
            characterId={m.characterId}
            label={t('team.composer.mow')}
            options={mowOptions}
            placeholder={t('team.composer.pickMow')}
            unitBuilds={unitBuilds}
            ownedSet={ownedSet}
            onChange={(id) => setTeamMember(m.slotId, id)}
            t={t}
            accent
          />
        ))}
      </ul>
    </section>
  );
}

interface SlotRowProps {
  slotId: string;
  characterId: string | null;
  label: string;
  options: CatalogCharacter[];
  placeholder: string;
  unitBuilds: Record<string, { progression: number; xpLevel: number }>;
  ownedSet: Set<string>;
  onChange: (id: string | null) => void;
  t: (key: string) => string;
  accent?: boolean;
}

/** Single slot row shared by heroes and the MoW slot. Kept flat + stateless
 *  so the two lists can diverge on label / options / placeholder without
 *  duplicating the `<option>` markup or the memo-preview column. */
function SlotRow({
  slotId: _slotId,
  characterId,
  label,
  options,
  placeholder,
  unitBuilds,
  ownedSet,
  onChange,
  t,
  accent,
}: SlotRowProps) {
  const char = characterId
    ? options.find((c) => c.id === characterId)
    : undefined;
  const memo = characterId ? unitBuilds[characterId] : undefined;
  const rarity = memo ? progressionToRarity(memo.progression) : undefined;
  const stars = memo ? progressionToStarLevel(memo.progression) : undefined;
  const owned = characterId ? ownedSet.has(characterId) : false;
  const liCls = accent
    ? 'flex flex-col gap-1 rounded border border-amber-800/40 bg-amber-950/10 p-2 text-xs md:flex-row md:items-center'
    : 'flex flex-col gap-1 rounded border border-bg-subtle/50 bg-bg-base p-2 text-xs md:flex-row md:items-center';
  return (
    <li className={liCls}>
      <span className="w-16 font-mono text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select
        value={characterId ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="flex-1 rounded bg-bg-elevated px-2 py-1 text-sm"
      >
        <option value="">{placeholder}</option>
        {options.map((c) => (
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
}
