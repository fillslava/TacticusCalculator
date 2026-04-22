import { useMemo } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../lib/i18n';
import { getCharacter } from '../../data/catalog';
import type { CatalogCharacter, TeamPosition } from '../../engine/types';

/**
 * Team rotation editor — ordered list of turns, each containing ordered
 * actions. Each action picks a team member (by slotId) and one of that
 * member's available attack keys (melee / ranged / ability:<id>). Order
 * inside a turn matters for reactive team-buffs (Laviscus Outrage,
 * Trajann active trigger, Biovore spore-mine gate) — the engine processes
 * actions in the same order they appear here.
 */
export function TeamRotationEditor() {
  const team = useApp((s) => s.team);
  const addTeamTurn = useApp((s) => s.addTeamTurn);
  const removeTeamTurn = useApp((s) => s.removeTeamTurn);
  const addTeamAction = useApp((s) => s.addTeamAction);
  const updateTeamAction = useApp((s) => s.updateTeamAction);
  const removeTeamAction = useApp((s) => s.removeTeamAction);
  const t = useT();

  /** Members with a resolvable catalog entry, in position order. The `kind`
   *  flag carries through so the UI can render the MoW slot as "MoW" rather
   *  than "S6". */
  const populatedMembers = useMemo(() => {
    return team.members
      .filter((m) => m.characterId)
      .map((m) => ({
        slotId: m.slotId,
        position: m.position,
        kind: m.kind,
        character: getCharacter(m.characterId!),
      }))
      .filter(
        (m): m is {
          slotId: string;
          position: TeamPosition;
          kind: 'hero' | 'mow';
          character: CatalogCharacter;
        } => Boolean(m.character),
      );
  }, [team.members]);

  /** Short label used in the action picker ("S1"..."S5" for heroes, "MoW"
   *  for the Machine-of-War slot). */
  function slotLabel(m: { position: TeamPosition; kind: 'hero' | 'mow' }): string {
    return m.kind === 'mow' ? 'MoW' : `S${m.position + 1}`;
  }

  /**
   * Expand a catalog character into selectable attack keys. Mirrors
   * `RotationEditor` conventions: melee always present, ranged conditional,
   * only `active` abilities are pickable (passives auto-trigger).
   */
  function optionsFor(char: CatalogCharacter): { key: string; label: string }[] {
    const opts: { key: string; label: string }[] = [];
    if (char.melee) opts.push({ key: 'melee', label: t('label.melee') });
    if (char.ranged) opts.push({ key: 'ranged', label: t('label.ranged') });
    for (const ab of char.abilities) {
      if (ab.kind !== 'active') continue;
      opts.push({ key: `ability:${ab.id}`, label: ab.name });
    }
    return opts;
  }

  function defaultAttackKeyFor(char: CatalogCharacter): string {
    if (char.melee) return 'melee';
    if (char.ranged) return 'ranged';
    const firstActive = char.abilities.find((a) => a.kind === 'active');
    return firstActive ? `ability:${firstActive.id}` : 'melee';
  }

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">{t('team.rotation.title')}</h2>
      <p className="mt-1 text-xs text-slate-400">
        {t('team.rotation.description')}
      </p>

      {populatedMembers.length === 0 && (
        <p className="mt-3 rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          {t('team.composer.pickHero')} —{' '}
          {t('team.rotation.pickMember')}
        </p>
      )}

      <ol className="mt-3 flex flex-col gap-3">
        {team.turns.map((turn, turnIdx) => (
          <li
            key={turnIdx}
            className="rounded border border-bg-subtle bg-bg-base p-2"
          >
            <div className="flex items-center gap-2">
              <span className="w-16 font-mono text-xs text-slate-500">
                {t('team.rotation.turn')} {turnIdx + 1}
              </span>
              <span className="text-[11px] text-slate-500">
                {turn.actions.length} action{turn.actions.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => removeTeamTurn(turnIdx)}
                disabled={team.turns.length <= 1}
                className="ml-auto rounded bg-bg-subtle px-2 py-1 text-xs disabled:opacity-30"
                title="remove turn"
              >
                ×
              </button>
            </div>

            {turn.actions.length === 0 ? (
              <p className="mt-2 pl-4 text-[11px] italic text-slate-500">
                {t('team.rotation.noActions')}
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1 pl-4">
                {turn.actions.map((action, actionIdx) => {
                  const member = populatedMembers.find(
                    (m) => m.slotId === action.memberSlotId,
                  );
                  const char = member?.character;
                  const opts = char ? optionsFor(char) : [];
                  const optionKeys = new Set(opts.map((o) => o.key));
                  return (
                    <li
                      key={actionIdx}
                      className="flex flex-wrap items-center gap-2 rounded border border-bg-subtle/40 bg-bg-elevated px-2 py-1 text-xs"
                    >
                      <span className="w-6 font-mono text-[10px] text-slate-500">
                        #{actionIdx + 1}
                      </span>
                      <select
                        value={action.memberSlotId}
                        onChange={(e) => {
                          const slotId = e.target.value;
                          const newMember = populatedMembers.find(
                            (m) => m.slotId === slotId,
                          );
                          const newKey = newMember
                            ? optionsFor(newMember.character)
                                .map((o) => o.key)
                                .includes(action.attackKey)
                              ? action.attackKey
                              : defaultAttackKeyFor(newMember.character)
                            : action.attackKey;
                          updateTeamAction(turnIdx, actionIdx, {
                            memberSlotId: slotId,
                            attackKey: newKey,
                          });
                        }}
                        className="rounded bg-bg-base px-1.5 py-0.5 text-[11px]"
                      >
                        {populatedMembers.map((m) => (
                          <option key={m.slotId} value={m.slotId}>
                            {slotLabel(m)} · {m.character.displayName}
                          </option>
                        ))}
                      </select>
                      <select
                        value={
                          optionKeys.has(action.attackKey)
                            ? action.attackKey
                            : (opts[0]?.key ?? '')
                        }
                        onChange={(e) =>
                          updateTeamAction(turnIdx, actionIdx, {
                            attackKey: e.target.value,
                          })
                        }
                        className="flex-1 rounded bg-bg-base px-1.5 py-0.5 text-[11px]"
                        disabled={opts.length === 0}
                      >
                        {opts.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeTeamAction(turnIdx, actionIdx)}
                        className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px]"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {populatedMembers.length > 0 && (
              <div className="mt-2 pl-4">
                <select
                  value=""
                  onChange={(e) => {
                    const slotId = e.target.value;
                    if (!slotId) return;
                    const member = populatedMembers.find(
                      (m) => m.slotId === slotId,
                    );
                    if (!member) return;
                    addTeamAction(
                      turnIdx,
                      slotId,
                      defaultAttackKeyFor(member.character),
                    );
                    e.target.value = '';
                  }}
                  className="rounded bg-bg-elevated px-2 py-0.5 text-xs text-slate-300"
                >
                  <option value="">{t('team.rotation.addAction')}</option>
                  {populatedMembers.map((m) => (
                    <option key={m.slotId} value={m.slotId}>
                      S{m.position + 1} · {m.character.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </li>
        ))}
      </ol>

      <button
        onClick={() => addTeamTurn()}
        className="mt-3 rounded bg-bg-subtle px-3 py-1.5 text-sm"
      >
        {t('team.rotation.addTurn')}
      </button>
    </section>
  );
}
