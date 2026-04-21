import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { listCharacters, getEquipment, loadCatalog } from '../../data/catalog';
import { applyStarAndRank, applyEquipmentMods } from '../../engine/scaling';
import {
  MAX_PROGRESSION,
  progressionLabel,
  progressionToRarity,
  progressionToStarLevel,
  clampProgression,
} from '../../engine/progression';
import type {
  AbilityLevel,
  CatalogAbility,
  ItemStatMods,
} from '../../engine/types';
import { ITEM_STAT_KEYS } from '../../engine/types';

const MAX_XP_LEVEL = 60;

const STAT_LABEL: Record<keyof ItemStatMods, string> = {
  damageFlat: '+dmg',
  damagePct: '×dmg',
  armorFlat: '+armor',
  hpFlat: '+hp',
  hpPct: '×hp',
  critChance: 'crit%',
  critDamage: '+critDmg',
  blockChance: 'block%',
  blockDamage: '+blockDmg',
  critResist: 'critResist',
  blockResist: 'blockResist',
  accuracy: 'accuracy',
  dodge: 'dodge',
  meleeDamagePct: '×melee',
  rangedDamagePct: '×ranged',
  piercing: 'piercing',
};

const PCT_STAT_KEYS = new Set<keyof ItemStatMods>([
  'critChance',
  'blockChance',
  'critResist',
  'blockResist',
  'accuracy',
  'dodge',
  'damagePct',
  'hpPct',
  'meleeDamagePct',
  'rangedDamagePct',
  'piercing',
]);

export function BuildEditor() {
  const {
    build,
    setBuild,
    selectCharacter,
    ownedCatalogIds,
    player,
  } = useApp();
  const t = useT();
  const characters = useMemo(() => listCharacters(), []);
  const allEquipment = useMemo(
    () => Array.from(loadCatalog().equipment.values()),
    [],
  );
  const gearRanks = useMemo(() => loadCatalog().curves.gearRanks, []);
  const maxRank = gearRanks.length - 1;

  const [factionFilter, setFactionFilter] = useState<string>('all');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [search, setSearch] = useState('');

  const factions = useMemo(() => {
    const s = new Set<string>();
    for (const c of characters) s.add(c.faction);
    return Array.from(s).sort();
  }, [characters]);

  const ownedSet = useMemo(() => new Set(ownedCatalogIds), [ownedCatalogIds]);
  const filteredCharacters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return characters.filter((c) => {
      if (ownedOnly && !ownedSet.has(c.id)) return false;
      if (factionFilter !== 'all' && c.faction !== factionFilter) return false;
      if (
        q &&
        !c.displayName.toLowerCase().includes(q) &&
        !c.id.toLowerCase().includes(q) &&
        !c.faction.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [characters, factionFilter, ownedOnly, ownedSet, search]);

  const selected = build.characterId
    ? characters.find((c) => c.id === build.characterId)
    : undefined;

  const progression = clampProgression(build.progression);
  const stars = progressionToStarLevel(progression);
  const rarity = progressionToRarity(progression);
  const rankLabel =
    gearRanks[Math.min(build.rank, maxRank)]?.[0] ?? String(build.rank);

  const equipmentSlots = useMemo(() => {
    return [1, 2, 3].map((slotId) =>
      allEquipment
        .filter((e) => e.slotId === slotId)
        .filter(
          (e) =>
            !selected?.faction ||
            !e.factions ||
            e.factions.length === 0 ||
            e.factions.includes(selected.faction),
        ),
    );
  }, [allEquipment, selected]);

  const extraSlot: ItemStatMods | undefined = build.extraStats;
  const appliedEquipmentMods: ItemStatMods[] = build.equipmentIds
    .map((id) => (id ? getEquipment(id)?.mods : undefined))
    .filter((m): m is ItemStatMods => Boolean(m));
  if (extraSlot) appliedEquipmentMods.push(extraSlot);

  const derived = selected
    ? applyEquipmentMods(
        applyStarAndRank(selected.baseStats, stars, build.rank),
        appliedEquipmentMods,
      )
    : null;

  const ownedCount = ownedCatalogIds.length;

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('section.character')}</h2>
        <span className="text-xs text-slate-400">
          {player
            ? `${player.details.name} · ${ownedCount} owned`
            : 'no API data loaded'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex flex-1 min-w-[12rem] items-center gap-1">
          <span className="uppercase text-slate-400">{t('label.search')}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('placeholder.search')}
            className="flex-1 rounded bg-bg-base px-2 py-1"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded px-1 text-slate-500 hover:bg-bg-base hover:text-slate-300"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </label>
        <label className="flex items-center gap-1">
          <span className="uppercase text-slate-400">{t('label.faction')}</span>
          <select
            value={factionFilter}
            onChange={(e) => setFactionFilter(e.target.value)}
            className="rounded bg-bg-base px-2 py-1"
          >
            <option value="all">all</option>
            {factions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={ownedOnly}
            onChange={(e) => setOwnedOnly(e.target.checked)}
            disabled={ownedCount === 0}
          />
          <span className="uppercase text-slate-400">{t('label.ownedOnly')}</span>
          <span className="text-slate-600">({ownedCount})</span>
        </label>
        <span className="text-slate-500">
          {filteredCharacters.length}/{characters.length}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {t('label.character')}
          </span>
          <select
            value={build.characterId ?? ''}
            onChange={(e) => selectCharacter(e.target.value || null)}
            className="rounded bg-bg-base px-2 py-1 text-sm"
          >
            <option value="">{t('placeholder.pick')}</option>
            {filteredCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {ownedSet.has(c.id) ? '★ ' : '  '}
                {c.displayName} ({c.faction})
              </option>
            ))}
          </select>
        </label>

        <Slider
          label={`${t('label.rarityStars')}: ${progressionLabel(progression)}`}
          min={0}
          max={MAX_PROGRESSION}
          value={progression}
          onChange={(v) => setBuild({ progression: v })}
        />
        <Slider
          label={`${t('label.rank')}: ${rankLabel}`}
          min={0}
          max={maxRank}
          value={Math.min(build.rank, maxRank)}
          onChange={(v) => setBuild({ rank: v })}
        />
        <Slider
          label={`${t('label.xpLevel')}: ${build.xpLevel}`}
          min={1}
          max={MAX_XP_LEVEL}
          value={Math.min(build.xpLevel, MAX_XP_LEVEL)}
          onChange={(v) => setBuild({ xpLevel: v })}
        />
        <div className="flex flex-col gap-1 text-xs text-slate-500">
          <span className="uppercase tracking-wide text-slate-400">{t('label.derived')}</span>
          <span>
            rarity <span className="text-slate-200">{rarity}</span> · starLevel{' '}
            <span className="text-slate-200">{stars}</span>
          </span>
          <span className="text-slate-600">
            slider index {progression} of {MAX_PROGRESSION}
          </span>
        </div>
      </div>

      {selected && selected.traits.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          <span className="text-[10px] uppercase text-slate-500">traits:</span>
          {selected.traits.map((t) => (
            <span
              key={t}
              className="rounded bg-bg-base px-1.5 py-0.5 text-[11px] text-slate-300"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {selected && selected.abilities.length > 0 && (
        <AbilityAssumptionsNote abilities={selected.abilities} />
      )}

      {selected && selected.abilities.length > 0 && (
        <AbilityLevels
          abilities={selected.abilities}
          levels={build.abilityLevels ?? []}
          defaultLevel={build.xpLevel}
          onChange={(next) => setBuild({ abilityLevels: next })}
        />
      )}

      {selected && (
        <div className="mt-3">
          <div className="text-xs uppercase text-slate-400">{t('label.equipment')}</div>
          <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-3">
            {equipmentSlots.map((slotItems, slotIdx) => {
              const relic = build.relicSlots?.[slotIdx] ?? null;
              const equippedId = build.equipmentIds[slotIdx] ?? '';
              const hasCanonical = Boolean(
                equippedId && slotItems.some((it) => it.id === equippedId),
              );
              const unknownRelic = relic && !hasCanonical;
              return (
                <label key={slotIdx} className="flex flex-col gap-1 text-xs">
                  <span className="flex items-center justify-between text-[10px] uppercase text-slate-500">
                    <span>Slot {slotIdx + 1}</span>
                    {relic && (
                      <span className="rounded bg-amber-900/40 px-1 text-amber-300">
                        relic
                      </span>
                    )}
                  </span>
                  {unknownRelic ? (
                    <div className="rounded bg-bg-base px-2 py-1 font-mono text-[11px] text-slate-300">
                      {relic!.id}
                      <div className="text-[10px] text-slate-500">
                        L{relic!.level} · {String(relic!.rarity).toLowerCase()} ·
                        mods unknown — add via manual stat bonuses
                      </div>
                    </div>
                  ) : (
                    <>
                      <select
                        value={equippedId}
                        onChange={(e) => {
                          const next = [...build.equipmentIds];
                          next[slotIdx] = e.target.value || null;
                          setBuild({ equipmentIds: next });
                        }}
                        className="rounded bg-bg-base px-2 py-1 text-xs"
                      >
                        <option value="">— empty —</option>
                        {groupByRarity(slotItems).map(([rarityKey, items]) => (
                          <optgroup key={rarityKey} label={rarityKey}>
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>
                                L{it.level} — {formatMods(it.mods)}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {relic && (
                        <span className="text-[10px] italic text-amber-300/80">
                          {relic.id} ({String(relic.rarity).toLowerCase()}
                          {String(relic.rarity).toLowerCase() === 'mythic'
                            ? ' — using legendary-approx stats (mythic gear not yet scraped)'
                            : ''}
                          )
                        </span>
                      )}
                    </>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <div className="mt-3">
          <button
            onClick={() => setShowExtra((v) => !v)}
            className="text-xs text-slate-400 underline decoration-dotted"
          >
            {showExtra ? '− hide' : '+ manual stat bonuses'}
          </button>
          {showExtra && (
            <ExtraStatsEditor
              value={build.extraStats ?? {}}
              onChange={(patch) =>
                setBuild({ extraStats: { ...(build.extraStats ?? {}), ...patch } })
              }
            />
          )}
        </div>
      )}

      {derived && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <Stat label={t('label.damage')} value={derived.damage.toFixed(0)} />
          <Stat label={t('label.armor')} value={derived.armor.toFixed(0)} />
          <Stat label={t('label.hp')} value={derived.hp.toFixed(0)} />
          <Stat label={t('label.critPct')} value={`${(derived.critChance * 100).toFixed(0)}%`} />
          <Stat label={t('label.critDmg')} value={derived.critDamage.toFixed(0)} />
          <Stat label={t('label.blockPct')} value={`${(derived.blockChance * 100).toFixed(0)}%`} />
          <Stat label={t('label.blockDmg')} value={derived.blockDamage.toFixed(0)} />
          <Stat label={t('label.meleeHits')} value={String(derived.meleeHits)} />
        </div>
      )}

      {derived && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-slate-400">
            compare vs in-game values…
          </summary>
          <InGameCompare derived={derived} />
        </details>
      )}
    </section>
  );
}

function InGameCompare({
  derived,
}: {
  derived: { damage: number; armor: number; hp: number };
}) {
  const [dmg, setDmg] = useState('');
  const [armor, setArmor] = useState('');
  const [hp, setHp] = useState('');
  function ratio(actualStr: string, predicted: number): string {
    const actual = Number(actualStr);
    if (!Number.isFinite(actual) || actual === 0) return '—';
    const r = predicted / actual;
    return `${r.toFixed(3)}× ${r > 1.05 ? '(over)' : r < 0.95 ? '(under)' : '(ok)'}`;
  }
  return (
    <div className="mt-2 grid grid-cols-1 gap-1 rounded bg-bg-base p-2 md:grid-cols-3">
      <CompareRow
        label="Damage"
        predicted={derived.damage}
        value={dmg}
        onChange={setDmg}
        ratio={ratio(dmg, derived.damage)}
      />
      <CompareRow
        label="Armor"
        predicted={derived.armor}
        value={armor}
        onChange={setArmor}
        ratio={ratio(armor, derived.armor)}
      />
      <CompareRow
        label="HP"
        predicted={derived.hp}
        value={hp}
        onChange={setHp}
        ratio={ratio(hp, derived.hp)}
      />
      <p className="col-span-full text-[11px] italic text-slate-500">
        Enter the value from the in-game character sheet. A ratio of 1.00× means
        the model matches. Large drift points to wrong base stats or scaling —
        tune via manual stat bonuses or report the mismatch.
      </p>
    </div>
  );
}

function CompareRow({
  label,
  predicted,
  value,
  onChange,
  ratio,
}: {
  label: string;
  predicted: number;
  value: string;
  onChange: (v: string) => void;
  ratio: string;
}) {
  return (
    <label className="flex items-center gap-2 rounded bg-bg-elevated px-2 py-1">
      <span className="w-14 text-[10px] uppercase text-slate-400">{label}</span>
      <span className="w-16 text-right font-mono text-slate-500">
        {predicted.toFixed(0)}
      </span>
      <span className="text-slate-600">vs</span>
      <input
        type="number"
        value={value}
        placeholder="in-game"
        onChange={(e) => onChange(e.target.value)}
        className="w-16 rounded bg-bg-base px-1 py-0.5 text-right font-mono"
      />
      <span className="ml-auto font-mono text-[11px] text-slate-400">
        {ratio}
      </span>
    </label>
  );
}

function groupByRarity<T extends { rarity: string }>(items: T[]): [string, T[]][] {
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = it.rarity;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return order
    .filter((r) => map.has(r))
    .map((r) => [r, map.get(r)!] as [string, T[]]);
}

function formatMods(m: ItemStatMods): string {
  const parts: string[] = [];
  for (const k of ITEM_STAT_KEYS) {
    const v = m[k];
    if (typeof v !== 'number' || v === 0) continue;
    if (PCT_STAT_KEYS.has(k)) parts.push(`${STAT_LABEL[k]} ${Math.round(v * 100)}%`);
    else parts.push(`${STAT_LABEL[k]} ${Math.round(v)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '(no mods)';
}

function ExtraStatsEditor({
  value,
  onChange,
}: {
  value: ItemStatMods;
  onChange: (patch: Partial<ItemStatMods>) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-1 rounded bg-bg-base p-2 text-xs md:grid-cols-4">
      {ITEM_STAT_KEYS.map((k) => {
        const isPct = PCT_STAT_KEYS.has(k);
        const raw = value[k] ?? 0;
        const display = isPct ? raw * 100 : raw;
        return (
          <label key={k} className="flex items-center justify-between gap-1">
            <span className="text-[10px] uppercase text-slate-500">
              {STAT_LABEL[k]}
              {isPct ? '%' : ''}
            </span>
            <input
              type="number"
              step={isPct ? 1 : 1}
              value={display}
              onChange={(e) => {
                const n = Number(e.target.value);
                const v = isPct ? n / 100 : n;
                onChange({ [k]: v } as Partial<ItemStatMods>);
              }}
              className="w-16 rounded bg-bg-elevated px-1 py-0.5 text-right font-mono"
            />
          </label>
        );
      })}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-accent"
      />
    </label>
  );
}

function AbilityLevels({
  abilities,
  levels,
  defaultLevel,
  onChange,
}: {
  abilities: { id: string; name: string; kind: 'active' | 'passive' }[];
  levels: AbilityLevel[];
  defaultLevel: number;
  onChange: (next: AbilityLevel[]) => void;
}) {
  const t = useT();
  function levelFor(id: string): number {
    return levels.find((l) => l.id === id)?.level ?? defaultLevel;
  }
  function setLevel(id: string, kind: 'active' | 'passive', v: number) {
    const rest = levels.filter((l) => l.id !== id);
    onChange([...rest, { id, level: v, kind }]);
  }
  return (
    <div className="mt-3">
      <div className="text-xs uppercase text-slate-400">{t('label.abilityLevels')}</div>
      <div className="mt-1 grid grid-cols-1 gap-1 md:grid-cols-2">
        {abilities.map((ab) => (
          <label
            key={ab.id}
            className="flex items-center justify-between gap-2 rounded bg-bg-base px-2 py-1 text-xs"
          >
            <span className="flex-1 truncate">
              <span className="text-[10px] uppercase text-slate-500">
                {ab.kind}
              </span>{' '}
              <span className="text-slate-200">{ab.name}</span>
            </span>
            <input
              type="number"
              min={1}
              max={60}
              value={levelFor(ab.id)}
              onChange={(e) => setLevel(ab.id, ab.kind, Number(e.target.value))}
              className="w-14 rounded bg-bg-elevated px-1 py-0.5 text-right font-mono"
            />
          </label>
        ))}
      </div>
      <p className="mt-1 text-[11px] italic leading-snug text-slate-500">
        Active &amp; passive abilities level independently (1–60). API-synced
        values override manual ones.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-bg-base px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

/**
 * Renders a compact, collapsible note listing the modeling assumptions for any
 * ability on the selected character that uses one of the recently-added
 * mechanics (multi-component profiles, triggered passives, scaling, or team
 * buffs). Invisible if nothing about the character is "interesting", so regular
 * characters don't see extra chrome.
 *
 * Purpose: knowledgeable players can cross-check the model against the in-game
 * damage preview and report discrepancies. Every tagged ability exposes its
 * assumed cooldown, damage-type × hit count, and trigger/scaling/team-buff
 * metadata — the same inputs the engine consumes.
 */
function AbilityAssumptionsNote({ abilities }: { abilities: CatalogAbility[] }) {
  const t = useT();
  const interesting = abilities.filter(
    (a) =>
      a.profiles.length >= 2 ||
      Boolean(a.trigger) ||
      Boolean(a.teamBuff) ||
      Boolean(a.scaling),
  );
  if (interesting.length === 0) return null;
  return (
    <details className="mt-3 rounded border border-amber-900/40 bg-amber-950/20 p-2 text-xs open:pb-3">
      <summary className="cursor-pointer font-semibold text-amber-300">
        {t('note.assumptions.title')}{' '}
        <span className="text-[10px] font-normal text-amber-300/60">
          ({interesting.length})
        </span>
      </summary>
      <p className="mt-1 text-slate-300">{t('note.assumptions.intro')}</p>
      <ul className="mt-2 space-y-2">
        {interesting.map((ab) => (
          <AbilityAssumptionRow key={ab.id} ability={ab} />
        ))}
      </ul>
      <p className="mt-2 text-[11px] italic text-slate-500">
        {t('note.assumptions.verify')}
      </p>
    </details>
  );
}

function AbilityAssumptionRow({ ability }: { ability: CatalogAbility }) {
  const t = useT();
  return (
    <li className="rounded bg-bg-base/60 p-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] uppercase text-slate-500">
          {ability.kind}
        </span>
        <span className="text-slate-100">{ability.name}</span>
        {ability.cooldown !== undefined && (
          <span className="rounded bg-bg-elevated px-1 text-[10px] text-slate-400">
            {ability.cooldown >= 999
              ? t('note.assumptions.oncePerBattle')
              : `${t('note.assumptions.cooldown')} ${ability.cooldown}`}
          </span>
        )}
        {ability.profiles.length >= 2 && (
          <AssumptionTag color="cyan">
            {t('note.assumptions.multiComponent')}
          </AssumptionTag>
        )}
        {ability.trigger && (
          <AssumptionTag color="violet">
            {t('note.assumptions.triggered')}
          </AssumptionTag>
        )}
        {ability.teamBuff && (
          <AssumptionTag color="amber">
            {t('note.assumptions.teamBuff')}
          </AssumptionTag>
        )}
        {ability.scaling && (
          <AssumptionTag color="rose">
            {t('note.assumptions.scaling')}
          </AssumptionTag>
        )}
      </div>
      {ability.profiles.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-slate-400">
          {ability.profiles.map((p, i) => (
            <span key={i} className="rounded bg-bg-elevated px-1 py-0.5">
              {p.hits}× {p.damageType}
              {p.damageFactor !== undefined && p.damageFactor !== 1
                ? ` · ×${p.damageFactor}`
                : ''}
              {p.preArmorAddFlat ? ` · +${p.preArmorAddFlat}` : ''}
            </span>
          ))}
        </div>
      )}
      {ability.trigger && (
        <div className="mt-1 text-[10px] text-slate-500">
          →{' '}
          {ability.trigger.kind === 'afterOwnNormalAttack'
            ? t('note.assumptions.trigger.afterNormal')
            : t('note.assumptions.trigger.firstAttackOfTurn')}
          {ability.trigger.kind === 'afterOwnFirstAttackOfTurn' &&
            ability.trigger.requiresTargetTrait && (
              <>
                {' · '}
                {t('note.assumptions.trigger.targetTrait')}:{' '}
                <span className="text-slate-400">
                  {ability.trigger.requiresTargetTrait}
                </span>
              </>
            )}
        </div>
      )}
      {ability.scaling && (
        <div className="mt-1 text-[10px] text-slate-500">
          → +{ability.scaling.pctPerStep}% {t('note.assumptions.scaling.per')}{' '}
          <span className="text-slate-400">{ability.scaling.per}</span>
        </div>
      )}
      {ability.teamBuff && (
        <div className="mt-1 text-[10px] text-slate-500">
          → <span className="text-slate-400">{ability.teamBuff.kind}</span>
          {' · '}
          <span className="italic">{t('note.assumptions.guildRaidOnly')}</span>
        </div>
      )}
    </li>
  );
}

function AssumptionTag({
  color,
  children,
}: {
  color: 'cyan' | 'violet' | 'amber' | 'rose';
  children: ReactNode;
}) {
  const cls = {
    cyan: 'bg-cyan-950/60 text-cyan-300',
    violet: 'bg-violet-950/60 text-violet-300',
    amber: 'bg-amber-950/60 text-amber-300',
    rose: 'bg-rose-950/60 text-rose-300',
  }[color];
  return <span className={`rounded px-1 text-[10px] ${cls}`}>{children}</span>;
}
