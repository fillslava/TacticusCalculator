import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { getCharacter } from '../../data/catalog';
import {
  BUFF_PRESETS,
  type BuffPreset,
  computeBuffDamage,
  findPresetByName,
  presetToBuff,
  recomputeBuffFromTables,
} from '../../engine/buffPresets';
import { progressionToRarity } from '../../engine/progression';
import { RARITY_ORDER } from '../../engine/types';
import type { BonusHitTrigger, Rarity, TurnBuff } from '../../engine/types';

const MAX_BUFFS_PER_TURN = 4;

export function RotationEditor() {
  const { build, rotation, setRotation, addTurn, removeTurn, unitBuilds } =
    useApp();
  const t = useT();
  const char = build.characterId ? getCharacter(build.characterId) : undefined;

  const options: { key: string; label: string }[] = [{ key: 'melee', label: t('label.melee') }];
  if (char?.ranged) options.push({ key: 'ranged', label: t('label.ranged') });
  // Only active abilities are user-selectable. Passives (Kharn's Betrayer,
  // Kariyan's Legacy of Combat, Gulgortz's Light 'Im Up, …) auto-trigger off
  // normal attacks in Phase 2 — picking them as a standalone turn action
  // would double-count their damage.
  for (const ab of char?.abilities ?? []) {
    if (ab.kind !== 'active') continue;
    options.push({ key: `ability:${ab.id}`, label: ab.name });
  }

  function updateTurn(i: number, patch: Partial<(typeof rotation)[number]>) {
    const next = [...rotation];
    next[i] = { ...next[i], ...patch };
    setRotation(next);
  }

  /**
   * Pick the buffer's own xpLevel & rarity when known. Falls back to the
   * attacker's build (what the player last viewed) when the buffer is unowned
   * or no charId is attached.
   */
  function resolveBuffOverrides(preset: BuffPreset): {
    level: number;
    rarity: Rarity;
  } {
    const memo = preset.charId ? unitBuilds[preset.charId] : undefined;
    if (memo) {
      return {
        level: memo.xpLevel,
        rarity: progressionToRarity(memo.progression),
      };
    }
    return {
      level: build.xpLevel,
      rarity: progressionToRarity(build.progression),
    };
  }

  function addBuff(turnIdx: number, preset: BuffPreset) {
    const turn = rotation[turnIdx];
    if (turn.buffs.length >= MAX_BUFFS_PER_TURN) return;
    const overrides = resolveBuffOverrides(preset);
    updateTurn(turnIdx, {
      buffs: [...turn.buffs, presetToBuff(preset, overrides)],
    });
  }

  function updateBuff(turnIdx: number, buffIdx: number, patch: Partial<TurnBuff>) {
    const turn = rotation[turnIdx];
    const buffs = [...turn.buffs];
    const merged = { ...buffs[buffIdx], ...patch };
    if (patch.level !== undefined || patch.rarity !== undefined) {
      const userEditedDamage = patch.damageFlat !== undefined;
      const userEditedCrit =
        patch.critChance !== undefined || patch.critDamage !== undefined;
      const recomputed = recomputeBuffFromTables(merged);
      if (recomputed) {
        if (recomputed.damageFlat !== undefined && !userEditedDamage) {
          merged.damageFlat = recomputed.damageFlat;
        }
        if (recomputed.critChance !== undefined && !userEditedCrit) {
          merged.critChance = recomputed.critChance;
        }
        if (recomputed.critDamage !== undefined && !userEditedCrit) {
          merged.critDamage = recomputed.critDamage;
        }
      } else if (merged.baseDamageCoef && !userEditedDamage) {
        merged.damageFlat = computeBuffDamage(
          merged.baseDamageCoef,
          merged.level ?? 50,
          merged.rarity ?? 'legendary',
        );
      }
    }
    buffs[buffIdx] = merged;
    updateTurn(turnIdx, { buffs });
  }

  function removeBuff(turnIdx: number, buffIdx: number) {
    const turn = rotation[turnIdx];
    updateTurn(turnIdx, { buffs: turn.buffs.filter((_, i) => i !== buffIdx) });
  }

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">{t('section.rotation')}</h2>
      <p className="mt-1 text-xs text-slate-400">
        {t('rotation.description', { n: MAX_BUFFS_PER_TURN })}
      </p>

      <ul className="mt-3 flex flex-col gap-3">
        {rotation.map((turn, i) => (
          <li key={i} className="rounded border border-bg-subtle bg-bg-base p-2">
            <div className="flex items-center gap-2">
              <span className="w-10 text-right font-mono text-xs text-slate-500">
                T{i + 1}
              </span>
              <select
                value={turn.attackKey}
                onChange={(e) => updateTurn(i, { attackKey: e.target.value })}
                className="flex-1 rounded bg-bg-elevated px-2 py-1 text-sm"
              >
                {options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => removeTurn(i)}
                disabled={rotation.length <= 1}
                className="rounded bg-bg-subtle px-2 py-1 text-xs disabled:opacity-30"
                title="remove turn"
              >
                ×
              </button>
            </div>

            <div className="mt-2 pl-12">
              {turn.buffs.length > 0 && (
                <ul className="mb-2 flex flex-col gap-2">
                  {turn.buffs.map((b, bi) => (
                    <BuffRow
                      key={b.id}
                      buff={b}
                      onChange={(patch) => updateBuff(i, bi, patch)}
                      onRemove={() => removeBuff(i, bi)}
                    />
                  ))}
                </ul>
              )}

              {turn.buffs.length < MAX_BUFFS_PER_TURN && (
                <select
                  value=""
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    if (!Number.isNaN(idx)) addBuff(i, BUFF_PRESETS[idx]);
                    e.target.value = '';
                  }}
                  className="rounded bg-bg-elevated px-2 py-0.5 text-xs text-slate-300"
                >
                  <option value="">{t('button.addBuff')}</option>
                  {BUFF_PRESETS.map((p, idx) => (
                    <option key={p.name} value={idx}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={() => addTurn(options[0].key)}
        className="mt-3 rounded bg-bg-subtle px-3 py-1.5 text-sm"
      >
        {t('button.addTurn')}
      </button>
    </section>
  );
}

function BuffRow({
  buff,
  onChange,
  onRemove,
}: {
  buff: TurnBuff;
  onChange: (patch: Partial<TurnBuff>) => void;
  onRemove: () => void;
}) {
  const preset = findPresetByName(buff.name);
  const charId = buff.charId ?? preset?.charId;
  const buffer = charId ? getCharacter(charId) : undefined;
  return (
    <li className="flex flex-col gap-1 rounded border border-bg-subtle/50 bg-bg-elevated p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={buff.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-44 rounded bg-bg-base px-1.5 py-0.5"
        />
        {buffer && (
          <span
            title={`Buff scales with ${buffer.displayName}'s own level & rarity`}
            className="rounded bg-bg-base px-1.5 py-0.5 text-[10px] text-slate-400"
          >
            from {buffer.displayName}
          </span>
        )}
        <NumField
          label="lvl"
          value={buff.level ?? 50}
          min={1}
          max={60}
          onChange={(v) => onChange({ level: v })}
        />
        <label className="flex items-center gap-1">
          <span className="text-[10px] uppercase text-slate-500">rarity</span>
          <select
            value={buff.rarity ?? 'legendary'}
            onChange={(e) => onChange({ rarity: e.target.value as Rarity })}
            className="rounded bg-bg-base px-1 py-0.5 text-[11px]"
          >
            {RARITY_ORDER.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={onRemove}
          className="ml-auto rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-slate-400"
        >
          remove
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <NumField
          label="+dmg"
          value={buff.damageFlat ?? 0}
          onChange={(v) => onChange({ damageFlat: v })}
        />
        <NumField
          label="×dmg"
          value={buff.damageMultiplier ?? 1}
          step={0.05}
          onChange={(v) => onChange({ damageMultiplier: v })}
        />
        <NumField
          label="+crit%"
          value={(buff.critChance ?? 0) * 100}
          onChange={(v) => onChange({ critChance: v / 100 })}
        />
        <NumField
          label="+critDmg"
          value={buff.critDamage ?? 0}
          onChange={(v) => onChange({ critDamage: v })}
        />
        <NumField
          label="+hits"
          value={buff.bonusHits ?? 0}
          min={0}
          max={5}
          onChange={(v) => onChange({ bonusHits: v })}
        />
        <label className="flex items-center gap-1">
          <span className="text-[10px] uppercase text-slate-500">on</span>
          <select
            value={buff.bonusHitsOn ?? 'all'}
            onChange={(e) =>
              onChange({ bonusHitsOn: e.target.value as BonusHitTrigger })
            }
            className="rounded bg-bg-base px-1 py-0.5 text-[11px]"
            disabled={!buff.bonusHits}
          >
            <option value="all">all</option>
            <option value="first">first turn</option>
            <option value="normal">normal</option>
            <option value="ability">ability</option>
          </select>
        </label>
      </div>
      {preset?.description && (
        <p className="text-[11px] italic leading-snug text-slate-400">
          {preset.description}
        </p>
      )}
    </li>
  );
}

function NumField({
  label,
  value,
  step = 1,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[10px] uppercase text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 rounded bg-bg-base px-1 py-0.5 text-right font-mono"
      />
    </label>
  );
}
