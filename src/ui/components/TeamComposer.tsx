import { useMemo, useState } from 'react';
import {
  useApp,
  type TeamMemberOverride,
  type UnitBuildMemo,
} from '../../state/store';
import { useT } from '../../lib/i18n';
import { listCharacters, loadCatalog } from '../../data/catalog';
import {
  MAX_PROGRESSION,
  progressionLabel,
  progressionToRarity,
  progressionToStarLevel,
} from '../../engine/progression';
import type {
  AbilityLevel,
  CatalogAbility,
  CatalogCharacter,
} from '../../engine/types';

/** Max XP level accepted by the single-attacker BuildEditor — match it here
 *  so the training simulator's upper bound stays in sync. */
const MAX_XP_LEVEL = 60;

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
 * Each slot has two layers:
 *  1. A read-only baseline pulled from `unitBuilds` (owned heroes) or the
 *     single-attacker BuildOverrides (unowned heroes) — reflects the real
 *     current build, synced from the API.
 *  2. A per-slot "training simulator" override panel (collapsed by default)
 *     that lets the player dial in trained progression/rank/xp/ability
 *     levels. The override stacks on top of the baseline — any axis left
 *     untouched falls through. The damage result panel diffs trained vs.
 *     baseline and shows the uplift.
 */
export function TeamComposer() {
  const team = useApp((s) => s.team);
  const setTeamMember = useApp((s) => s.setTeamMember);
  const unitBuilds = useApp((s) => s.unitBuilds);
  const ownedCatalogIds = useApp((s) => s.ownedCatalogIds);
  const teamMemberOverrides = useApp((s) => s.teamMemberOverrides);
  const setTeamMemberOverride = useApp((s) => s.setTeamMemberOverride);
  const clearTeamMemberOverride = useApp((s) => s.clearTeamMemberOverride);
  const build = useApp((s) => s.build);
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

  /** Fallback baseline for unowned heroes — same shape as a synced memo
   *  but sourced from the single-attacker BuildOverrides so unowned heroes
   *  inherit the player's current "default" settings. */
  const fallbackMemo: UnitBuildMemo = useMemo(
    () => ({
      progression: build.progression,
      rank: build.rank,
      xpLevel: build.xpLevel,
      equipmentIds: [null, null, null],
      abilityLevels: build.abilityLevels,
    }),
    [build],
  );

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
            override={teamMemberOverrides[m.slotId]}
            setOverride={(patch) => setTeamMemberOverride(m.slotId, patch)}
            clearOverride={() => clearTeamMemberOverride(m.slotId)}
            fallbackMemo={fallbackMemo}
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
            override={teamMemberOverrides[m.slotId]}
            setOverride={(patch) => setTeamMemberOverride(m.slotId, patch)}
            clearOverride={() => clearTeamMemberOverride(m.slotId)}
            fallbackMemo={fallbackMemo}
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
  unitBuilds: Record<string, UnitBuildMemo>;
  ownedSet: Set<string>;
  override: TeamMemberOverride | undefined;
  setOverride: (patch: Partial<TeamMemberOverride>) => void;
  clearOverride: () => void;
  fallbackMemo: UnitBuildMemo;
  onChange: (id: string | null) => void;
  t: (key: string) => string;
  accent?: boolean;
}

/** Single slot row shared by heroes and the MoW slot. The visible picker +
 *  baseline summary stays flat; the training editor lives below in a
 *  collapsible panel so players who don't care about "what if I trained
 *  this member" never see additional chrome. */
function SlotRow({
  slotId: _slotId,
  characterId,
  label,
  options,
  placeholder,
  unitBuilds,
  ownedSet,
  override,
  setOverride,
  clearOverride,
  fallbackMemo,
  onChange,
  t,
  accent,
}: SlotRowProps) {
  const char = characterId
    ? options.find((c) => c.id === characterId)
    : undefined;
  const baselineMemo = characterId
    ? (unitBuilds[characterId] ?? fallbackMemo)
    : undefined;
  const baselineRarity = baselineMemo
    ? progressionToRarity(baselineMemo.progression)
    : undefined;
  const baselineStars = baselineMemo
    ? progressionToStarLevel(baselineMemo.progression)
    : undefined;
  const owned = characterId ? ownedSet.has(characterId) : false;
  const hasAnyOverride =
    override !== undefined &&
    ((override.progression !== undefined) ||
      (override.rank !== undefined) ||
      (override.xpLevel !== undefined) ||
      (override.abilityLevels !== undefined &&
        override.abilityLevels.length > 0));

  // Training editor is collapsed by default — preserve the expanded flag
  // locally so the reset button doesn't suddenly collapse the panel when
  // the user wipes overrides.
  const [expanded, setExpanded] = useState(false);

  const liCls = accent
    ? 'flex flex-col gap-1 rounded border border-amber-800/40 bg-amber-950/10 p-2 text-xs'
    : 'flex flex-col gap-1 rounded border border-bg-subtle/50 bg-bg-base p-2 text-xs';
  return (
    <li className={liCls}>
      <div className="flex flex-col gap-1 md:flex-row md:items-center">
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
          {baselineMemo && (
            <span>
              {t('team.composer.rarity')}:{' '}
              <span className="text-slate-300">
                {baselineRarity} ·
                {baselineStars !== undefined ? ` ${baselineStars}★` : ''} · L
                {baselineMemo.xpLevel}
              </span>
            </span>
          )}
          {char && !owned && (
            <span className="italic text-amber-400/70">
              {t('team.composer.unowned')}
            </span>
          )}
          {hasAnyOverride && (
            <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] text-emerald-300">
              {t('team.training.active')}
            </span>
          )}
        </div>
      </div>

      {char && baselineMemo && (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] text-slate-400 underline decoration-dotted hover:text-slate-200"
          >
            {expanded ? '−' : '+'} {t('team.training.toggle')}
          </button>
          {hasAnyOverride && (
            <button
              type="button"
              onClick={clearOverride}
              className="text-[11px] text-amber-400/80 underline decoration-dotted hover:text-amber-200"
            >
              {t('team.training.reset')}
            </button>
          )}
        </div>
      )}

      {expanded && char && baselineMemo && (
        <TrainingEditor
          char={char}
          baseline={baselineMemo}
          override={override}
          setOverride={setOverride}
          t={t}
        />
      )}
    </li>
  );
}

interface TrainingEditorProps {
  char: CatalogCharacter;
  baseline: UnitBuildMemo;
  override: TeamMemberOverride | undefined;
  setOverride: (patch: Partial<TeamMemberOverride>) => void;
  t: (key: string) => string;
}

/**
 * Per-slot editor for the training simulator. Sliders edit the EFFECTIVE
 * value (override if present, else baseline); as soon as the user moves
 * one, the override for that axis is populated. Resetting an axis
 * individually is not exposed — the "Reset to baseline" button at the row
 * level wipes everything at once, which keeps the UI focused on the
 * common case ("see full uplift for this trained version vs my current").
 */
function TrainingEditor({
  char,
  baseline,
  override,
  setOverride,
  t,
}: TrainingEditorProps) {
  const gearRanks = useMemo(() => loadCatalog().curves.gearRanks, []);
  const maxRank = gearRanks.length - 1;

  const effectiveProgression =
    override?.progression ?? baseline.progression;
  const effectiveRank = override?.rank ?? baseline.rank;
  const effectiveXpLevel = override?.xpLevel ?? baseline.xpLevel;
  const baselineAbilityLevels = baseline.abilityLevels ?? [];

  const rankLabel =
    gearRanks[Math.min(effectiveRank, maxRank)]?.[0] ?? String(effectiveRank);

  const visibleAbilities = char.abilities.filter((a) => a.profiles.length > 0);

  return (
    <div className="mt-2 flex flex-col gap-2 rounded bg-bg-elevated/50 p-2">
      <p className="text-[11px] italic text-slate-500">
        {t('team.training.description')}
      </p>
      <Slider
        label={`${t('team.training.progression')}: ${progressionLabel(effectiveProgression)}`}
        min={0}
        max={MAX_PROGRESSION}
        value={effectiveProgression}
        baselineValue={baseline.progression}
        onChange={(v) =>
          setOverride({ progression: v === baseline.progression ? undefined : v })
        }
      />
      <Slider
        label={`${t('team.training.rank')}: ${rankLabel}`}
        min={0}
        max={maxRank}
        value={Math.min(effectiveRank, maxRank)}
        baselineValue={baseline.rank}
        onChange={(v) =>
          setOverride({ rank: v === baseline.rank ? undefined : v })
        }
      />
      <Slider
        label={`${t('team.training.xpLevel')}: ${effectiveXpLevel}`}
        min={1}
        max={MAX_XP_LEVEL}
        value={Math.min(effectiveXpLevel, MAX_XP_LEVEL)}
        baselineValue={baseline.xpLevel}
        onChange={(v) =>
          setOverride({ xpLevel: v === baseline.xpLevel ? undefined : v })
        }
      />

      {visibleAbilities.length > 0 && (
        <AbilityLevelsEditor
          abilities={visibleAbilities}
          baselineLevels={baselineAbilityLevels}
          overrideLevels={override?.abilityLevels}
          defaultLevel={baseline.xpLevel}
          onChange={(next) => setOverride({ abilityLevels: next })}
          t={t}
        />
      )}
    </div>
  );
}

interface AbilityLevelsEditorProps {
  abilities: CatalogAbility[];
  baselineLevels: AbilityLevel[];
  overrideLevels: AbilityLevel[] | undefined;
  defaultLevel: number;
  onChange: (next: AbilityLevel[] | undefined) => void;
  t: (key: string) => string;
}

/** Per-ability level editor for the training simulator. Shows the BASELINE
 *  level next to each input so the player can see what they're deviating
 *  from. Writing `undefined` for the whole set drops the override so the
 *  ability-levels fall through to the baseline memo. */
function AbilityLevelsEditor({
  abilities,
  baselineLevels,
  overrideLevels,
  defaultLevel,
  onChange,
  t,
}: AbilityLevelsEditorProps) {
  function baselineLevelFor(id: string): number {
    return baselineLevels.find((l) => l.id === id)?.level ?? defaultLevel;
  }
  function effectiveLevelFor(ab: CatalogAbility): number {
    const ov = overrideLevels?.find((l) => l.id === ab.id);
    if (ov) return ov.level;
    return baselineLevelFor(ab.id);
  }
  function setLevel(ab: CatalogAbility, level: number) {
    const base = overrideLevels ?? [];
    const rest = base.filter((l) => l.id !== ab.id);
    const next: AbilityLevel[] = [
      ...rest,
      { id: ab.id, level, kind: ab.kind as 'active' | 'passive' },
    ];
    // If every entry equals its baseline, drop the override entirely so
    // "touched one, then dragged back" correctly falls through to the memo
    // without leaving an inert override in place.
    const allAtBaseline = next.every(
      (l) => l.level === baselineLevelFor(l.id),
    );
    onChange(allAtBaseline ? undefined : next);
  }
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {t('team.training.abilityLevels')}
      </div>
      <div className="mt-1 grid grid-cols-1 gap-1 md:grid-cols-2">
        {abilities.map((ab) => {
          const baseLvl = baselineLevelFor(ab.id);
          const curLvl = effectiveLevelFor(ab);
          const trained = curLvl !== baseLvl;
          return (
            <label
              key={ab.id}
              className="flex items-center justify-between gap-2 rounded bg-bg-base px-2 py-1 text-[11px]"
            >
              <span className="flex-1 truncate">
                <span className="text-[10px] uppercase text-slate-500">
                  {ab.kind}
                </span>{' '}
                <span className="text-slate-200">{ab.name}</span>
              </span>
              <span className="text-[10px] text-slate-500">
                {t('team.training.baselineTag')} {baseLvl}
              </span>
              <input
                type="number"
                min={1}
                max={60}
                value={curLvl}
                onChange={(e) => setLevel(ab, Number(e.target.value))}
                className={`w-12 rounded px-1 py-0.5 text-right font-mono ${
                  trained
                    ? 'bg-emerald-950/60 text-emerald-200'
                    : 'bg-bg-elevated'
                }`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  baselineValue,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  baselineValue: number;
  onChange: (v: number) => void;
}) {
  const trained = value !== baselineValue;
  return (
    <label className="flex flex-col gap-1">
      <span
        className={`text-[11px] uppercase tracking-wide ${
          trained ? 'text-emerald-300' : 'text-slate-400'
        }`}
      >
        {label}
        {trained && (
          <span className="ml-2 text-[10px] text-slate-500">
            (baseline {baselineValue})
          </span>
        )}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={trained ? 'accent-emerald-500' : 'accent-accent'}
      />
    </label>
  );
}
