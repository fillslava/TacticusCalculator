import { useMemo } from 'react';
import type { MapDef } from '../../../map/core/mapSchema';
import { hexKey } from '../../../map/core/hex';
import { listCharacters } from '../../../data/catalog';
import type { CatalogCharacter } from '../../../engine/types';
import type { MapTeamSlot } from '../../../state/store';

/**
 * Pre-battle roster editor for the Map page.
 *
 * Lists every `spawn: 'player'` hex on the current map as a row and
 * lets the user pin which owned character lands on which hex. Unowned
 * characters are still selectable (they hydrate through the
 * fallback-memo path the same way the Team tab treats them) but are
 * visually demoted below owned ones.
 *
 * Picking the placeholder "auto — use Team tab roster" option clears
 * the override for that slot. `buildMapBattleFromTeam` then falls back
 * to sequential-fill from `team.members` for that spawn.
 *
 * Rules worth knowing:
 *   - MoW vs hero partitioning is NOT enforced here — the map-mode
 *     engine does not carry the MoW-slot constraint, so any owned
 *     character may go on any player spawn.
 *   - The same character cannot be pinned to two slots at once. Picking
 *     a character that's already pinned elsewhere silently unpins the
 *     old hex so the new selection wins. Keeps the invariant "every
 *     character appears at most once on the map" without the UI needing
 *     a conflict modal.
 */
interface Props {
  map: MapDef;
  /** Pinned-per-hex overrides for this map (from `mapTeams[map.id]`). */
  mapTeam: MapTeamSlot[];
  /** Set of characterIds the player actually owns — rendered first. */
  ownedIds: Set<string>;
  /** Commit a pin/unpin for a single hex. `null` clears the pin. */
  onSlotChange: (spawnHexKey: string, characterId: string | null) => void;
}

export function MapTeamPicker({
  map,
  mapTeam,
  ownedIds,
  onSlotChange,
}: Props) {
  const playerSpawns = useMemo(
    () => map.hexes.filter((c) => c.spawn === 'player'),
    [map],
  );

  const characters = useMemo<CatalogCharacter[]>(() => {
    // Owned-first, then alphabetical inside each partition — same
    // ordering the Team-tab composer uses for the dropdown.
    return [...listCharacters()].sort((a, b) => {
      const aOwned = ownedIds.has(a.id);
      const bOwned = ownedIds.has(b.id);
      if (aOwned !== bOwned) return aOwned ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [ownedIds]);

  const pinnedByHex = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const slot of mapTeam) out.set(slot.spawnHexKey, slot.characterId);
    return out;
  }, [mapTeam]);

  // Flattened list of hexKeys currently pinned, for conflict-suppression
  // — each dropdown hides characters already pinned elsewhere.
  const takenCharByHex = useMemo(() => {
    const out = new Map<string, string>(); // charId → hexKey
    for (const slot of mapTeam) {
      if (slot.characterId) out.set(slot.characterId, slot.spawnHexKey);
    }
    return out;
  }, [mapTeam]);

  if (playerSpawns.length === 0) {
    return (
      <aside className="rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
        <h3 className="text-base font-semibold">{map.displayName}</h3>
        <p className="mt-2 text-xs text-slate-400">
          This map has no player spawn points.
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col gap-2 rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
      <header>
        <h3 className="text-base font-semibold">{map.displayName}</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Pick which characters spawn on each player hex. "Auto" falls back
          to the Team tab's roster in slot order.
        </p>
      </header>
      <ol className="mt-1 flex flex-col gap-1.5">
        {playerSpawns.map((cell, idx) => {
          const key = hexKey({ q: cell.q, r: cell.r });
          const pinned = pinnedByHex.get(key) ?? null;
          return (
            <li
              key={key}
              className="flex flex-col gap-1 rounded border border-bg-subtle/50 bg-bg-base p-2 text-xs md:flex-row md:items-center"
            >
              <span className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-wide text-slate-500">
                Slot {idx + 1} · ({cell.q},{cell.r})
              </span>
              <select
                value={pinned ?? ''}
                onChange={(e) => onSlotChange(key, e.target.value || null)}
                className="flex-1 rounded bg-bg-elevated px-2 py-1 text-sm"
              >
                <option value="">auto — use Team tab roster</option>
                {characters.map((c) => {
                  // Hide characters pinned to OTHER hexes so the user can't
                  // accidentally place one character in two spawns. The
                  // char currently pinned to THIS hex is still selectable
                  // (it's the value shown).
                  const takenAt = takenCharByHex.get(c.id);
                  if (takenAt && takenAt !== key) return null;
                  return (
                    <option key={c.id} value={c.id}>
                      {ownedIds.has(c.id) ? '★ ' : '  '}
                      {c.displayName} ({c.faction})
                    </option>
                  );
                })}
              </select>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
