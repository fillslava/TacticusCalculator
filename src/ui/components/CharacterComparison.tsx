import { useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { getBoss, listCharacters } from '../../data/catalog';
import { resolveRotation } from '../../engine/rotation';
import { applyPrimeDebuffs } from '../../engine/bossDebuffs';
import {
  progressionLabel,
  progressionToRarity,
  progressionToStarLevel,
} from '../../engine/progression';
import type {
  Attacker,
  AttackContext,
  AttackProfile,
  CatalogBoss,
  CatalogCharacter,
  Target,
} from '../../engine/types';

type Attack = 'melee' | 'ranged' | 'ability1' | 'ability2' | 'ability3';

/**
 * Returns one or more profiles for the selected attack. Multi-component
 * abilities (e.g. Kharn's "Kill! Maim! Burn!") return one profile per
 * component; the caller sums the resulting damage values.
 */
function pickProfiles(char: CatalogCharacter, attack: Attack): AttackProfile[] {
  if (attack === 'melee') return char.melee ? [char.melee] : [];
  if (attack === 'ranged') return char.ranged ? [char.ranged] : [];
  // Index into ACTIVE abilities only — passives auto-trigger off normals in
  // Phase 2, they're not standalone actions a player picks in a turn.
  const actives = char.abilities.filter((a) => a.kind === 'active');
  const abIdx = attack === 'ability1' ? 0 : attack === 'ability2' ? 1 : 2;
  return actives[abIdx]?.profiles ?? [];
}

function customBoss(armor: number, hp: number, shield: number, traits: string[]): CatalogBoss {
  return {
    id: 'custom',
    displayName: 'Custom',
    stages: [{ name: 'custom', armor, hp, shield, traits }],
  };
}

export function CharacterComparison() {
  const { build, target, rotation } = useApp();
  const t = useT();
  const [attack, setAttack] = useState<Attack>('melee');
  const [factionFilter, setFactionFilter] = useState<string>('all');
  const [limit, setLimit] = useState(25);

  const allChars = useMemo(() => listCharacters(), []);
  const factions = useMemo(() => {
    const s = new Set<string>();
    for (const c of allChars) s.add(c.faction);
    return Array.from(s).sort();
  }, [allChars]);

  const rows = useMemo(() => {
    const boss = target.bossId
      ? getBoss(target.bossId)
      : customBoss(
          target.customArmor ?? 0,
          target.customHp ?? 100_000,
          target.customShield ?? 0,
          target.customTraits ?? [],
        );
    if (!boss) return [];
    const stageIdx = Math.min(
      target.stageIndex,
      Math.max(0, boss.stages.length - 1),
    );
    const stage = boss.stages[stageIdx];
    const primeLevels = [target.prime1Level ?? 0, target.prime2Level ?? 0];
    const hasAnyPrime = primeLevels.some((l) => l > 0);
    const debuffed = hasAnyPrime
      ? applyPrimeDebuffs(
          { armor: stage.armor, hp: stage.hp },
          boss.primes,
          primeLevels,
        )
      : null;
    const t: Target = {
      source: boss,
      stageIndex: target.stageIndex,
      ...(debuffed
        ? { statOverrides: { armor: debuffed.armor, hp: debuffed.hp } }
        : {}),
    };
    const turnBuffs = rotation[0]?.buffs ?? [];

    const out: Array<{
      id: string;
      name: string;
      faction: string;
      alliance: string;
      firstTurn: number;
      perHit: number;
      crit: number;
      skipped?: string;
    }> = [];

    for (const char of allChars) {
      if (factionFilter !== 'all' && char.faction !== factionFilter) continue;
      const profiles = pickProfiles(char, attack);
      if (profiles.length === 0) {
        out.push({
          id: char.id,
          name: char.displayName,
          faction: char.faction,
          alliance: char.alliance,
          firstTurn: 0,
          perHit: 0,
          crit: 0,
          skipped: `no ${attack}`,
        });
        continue;
      }
      const attacker: Attacker = {
        source: char,
        progression: {
          stars: progressionToStarLevel(build.progression),
          rank: build.rank,
          xpLevel: build.xpLevel,
          rarity: progressionToRarity(build.progression),
        },
        equipment: [],
      };
      const ctxs: AttackContext[] = profiles.map((profile) => ({
        profile,
        rngMode: 'expected',
      }));
      const r = resolveRotation(attacker, t, { turns: [{ attacks: ctxs, buffs: turnBuffs }] });
      // Sum across all components resolved for this turn (one per profile)
      const firstTurnPerTurn = r.perTurn.slice(0, ctxs.length);
      const totalHits = profiles.reduce((n, p) => n + Math.max(1, p.hits), 0);
      const firstTurnTotal = firstTurnPerTurn.reduce((s, d) => s + d.expected, 0);
      const avgCrit =
        firstTurnPerTurn.length > 0
          ? firstTurnPerTurn.reduce((s, d) => s + d.critProbability, 0) /
            firstTurnPerTurn.length
          : 0;
      out.push({
        id: char.id,
        name: char.displayName,
        faction: char.faction,
        alliance: char.alliance,
        firstTurn: firstTurnTotal,
        perHit: firstTurnTotal / Math.max(1, totalHits),
        crit: avgCrit,
      });
    }

    out.sort((a, b) => b.firstTurn - a.firstTurn);
    return out;
  }, [allChars, target, build, rotation, attack, factionFilter]);

  const buffSummary = useMemo(() => {
    const b = rotation[0]?.buffs ?? [];
    if (b.length === 0) return 'no buffs';
    return b.map((x) => x.name).join(' + ');
  }, [rotation]);

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('section.comparison')}</h2>
        <span className="text-xs text-slate-500">
          {progressionLabel(build.progression)} · rank {build.rank} · xp {build.xpLevel} · {t('comparison.t1Buffs')}: {buffSummary}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs uppercase text-slate-400">{t('label.attack')}</span>
          <select
            value={attack}
            onChange={(e) => setAttack(e.target.value as Attack)}
            className="rounded bg-bg-base px-2 py-1"
          >
            <option value="melee">{t('label.melee')}</option>
            <option value="ranged">{t('label.ranged')}</option>
            <option value="ability1">Ability 1</option>
            <option value="ability2">Ability 2</option>
            <option value="ability3">Ability 3</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs uppercase text-slate-400">{t('label.faction')}</span>
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
        <label className="flex items-center gap-2">
          <span className="text-xs uppercase text-slate-400">{t('label.showTop')}</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded bg-bg-base px-2 py-1"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={999}>all</option>
          </select>
        </label>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bg-subtle text-left text-xs uppercase text-slate-400">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">{t('label.character')}</th>
              <th className="py-1 pr-2">{t('label.faction')}</th>
              <th className="py-1 pr-2 text-right">{t('comparison.turn1')}</th>
              <th className="py-1 pr-2 text-right">{t('label.perHit')}</th>
              <th className="py-1 pr-2 text-right">{t('label.critPct')}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.slice(0, limit).map((r, i) => (
              <tr
                key={r.id}
                className={
                  r.skipped
                    ? 'text-slate-600'
                    : i === 0
                      ? 'text-accent'
                      : 'border-b border-bg-subtle/40 text-slate-200'
                }
              >
                <td className="py-1 pr-2 text-slate-500">{i + 1}</td>
                <td className="py-1 pr-2">{r.name}</td>
                <td className="py-1 pr-2 text-xs text-slate-400">{r.faction}</td>
                <td className="py-1 pr-2 text-right">
                  {r.skipped ? r.skipped : Math.round(r.firstTurn).toLocaleString()}
                </td>
                <td className="py-1 pr-2 text-right">
                  {r.skipped ? '' : Math.round(r.perHit).toLocaleString()}
                </td>
                <td className="py-1 pr-2 text-right">
                  {r.skipped ? '' : `${(r.crit * 100).toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
