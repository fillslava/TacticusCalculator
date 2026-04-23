import { useMemo } from 'react';
import type { HexCell, MapDef } from '../../../map/core/mapSchema';
import { hexKey } from '../../../map/core/hex';
import { listCharacters } from '../../../data/catalog';
import type { CatalogCharacter } from '../../../engine/types';
import type { MapTeamSlot } from '../../../state/store';

/**
 * Pre-battle roster editor for the Map page.
 *
 * The UI is split into two sections that mirror Tacticus' own team
 * builder:
 *
 *   1. **Hero slots.** One row per `spawn: 'player'` hex. The dropdown
 *      is filtered to non-MoW catalog characters — same rule the
 *      Team-tab composer uses for its five hero slots.
 *   2. **Machine of War slot.** One row per `spawn: 'mow'` hex (maps
 *      declare at most one). The dropdown is filtered to MoW-tagged
 *      characters only. A map without a MoW spawn simply omits this
 *      section, keeping Phase 1–7 maps (and the stub) rendering clean.
 *
 * Picking the placeholder "auto — use Team tab roster" option clears
 * the override for that slot. `buildMapBattleFromTeam` then falls back
 * to sequential-fill from `team.members` for that spawn — hero slots
 * pull from the hero-kind team members, the MoW slot from the MoW-kind
 * one.
 *
 * Rules worth knowing:
 *   - A character pinned to one hex is hidden from the other dropdowns
 *     of the same kind so it can't be double-placed. (MoWs and heroes
 *     live in disjoint dropdown pools, so cross-kind conflict is
 *     impossible by construction.)
 *   - Unowned characters are still selectable (they hydrate through the
 *     fallback-memo path the same way the Team tab treats them) but are
 *     visually demoted below owned ones with a leading ★ marker.
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

/** Catalog characters tagged with the `'machine of war'` trait (case-
 *  insensitive). Mirrors `isMachineOfWar` in TeamComposer and in the
 *  engine so the three code paths stay in lock-step. */
function isMachineOfWar(char: CatalogCharacter): boolean {
  return (char.traits ?? []).some(
    (trait) => trait.toLowerCase() === 'machine of war',
  );
}

export function MapTeamPicker({
  map,
  mapTeam,
  ownedIds,
  onSlotChange,
}: Props) {
  const heroSpawns = useMemo(
    () => map.hexes.filter((c) => c.spawn === 'player'),
    [map],
  );
  const mowSpawns = useMemo(
    () => map.hexes.filter((c) => c.spawn === 'mow'),
    [map],
  );

  // Owned-first, then alphabetical. Split into hero vs MoW pools so
  // each dropdown only ever surfaces characters that are legal for
  // that kind of slot.
  const { heroOptions, mowOptions } = useMemo(() => {
    const byOwnedThenName = (a: CatalogCharacter, b: CatalogCharacter) => {
      const aOwned = ownedIds.has(a.id);
      const bOwned = ownedIds.has(b.id);
      if (aOwned !== bOwned) return aOwned ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    };
    const all = listCharacters();
    return {
      heroOptions: all.filter((c) => !isMachineOfWar(c)).sort(byOwnedThenName),
      mowOptions: all.filter(isMachineOfWar).sort(byOwnedThenName),
    };
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

  if (heroSpawns.length === 0 && mowSpawns.length === 0) {
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
    <aside className="flex flex-col gap-3 rounded border border-bg-subtle bg-bg-elevated p-3 text-sm">
      <header>
        <h3 className="text-base font-semibold">{map.displayName}</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Pick which characters spawn on each slot. "Auto" falls back to
          the Team tab's roster in slot order.
        </p>
      </header>

      {heroSpawns.length > 0 && (
        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Heroes
          </h4>
          <ol className="flex flex-col gap-1.5">
            {heroSpawns.map((cell, idx) => (
              <SlotRow
                key={hexKey({ q: cell.q, r: cell.r })}
                label={`Slot ${idx + 1}`}
                cell={cell}
                options={heroOptions}
                pinnedByHex={pinnedByHex}
                takenCharByHex={takenCharByHex}
                ownedIds={ownedIds}
                onSlotChange={onSlotChange}
              />
            ))}
          </ol>
        </section>
      )}

      {mowSpawns.length > 0 && (
        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Machine of War
          </h4>
          <p className="mb-1 text-[11px] leading-snug text-slate-500">
            Placed off-map. Doesn't move — only fires its active ability
            and applies passive buffs.
          </p>
          <ol className="flex flex-col gap-1.5">
            {mowSpawns.map((cell) => (
              <SlotRow
                key={hexKey({ q: cell.q, r: cell.r })}
                label="MoW"
                cell={cell}
                options={mowOptions}
                pinnedByHex={pinnedByHex}
                takenCharByHex={takenCharByHex}
                ownedIds={ownedIds}
                onSlotChange={onSlotChange}
              />
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}

/**
 * Single row in the picker — label + character dropdown. Extracted so
 * the hero and MoW sections share rendering without duplicating the
 * owned-star / conflict-suppression logic.
 */
function SlotRow({
  label,
  cell,
  options,
  pinnedByHex,
  takenCharByHex,
  ownedIds,
  onSlotChange,
}: {
  label: string;
  cell: HexCell;
  options: CatalogCharacter[];
  pinnedByHex: Map<string, string | null>;
  takenCharByHex: Map<string, string>;
  ownedIds: Set<string>;
  onSlotChange: (spawnHexKey: string, characterId: string | null) => void;
}) {
  const key = hexKey({ q: cell.q, r: cell.r });
  const pinned = pinnedByHex.get(key) ?? null;
  return (
    <li className="flex flex-col gap-1 rounded border border-bg-subtle/50 bg-bg-base p-2 text-xs md:flex-row md:items-center">
      <span className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-wide text-slate-500">
        {label} · ({cell.q},{cell.r})
      </span>
      <select
        value={pinned ?? ''}
        onChange={(e) => onSlotChange(key, e.target.value || null)}
        className="flex-1 rounded bg-bg-elevated px-2 py-1 text-sm"
      >
        <option value="">auto — use Team tab roster</option>
        {options.map((c) => {
          // Hide characters pinned to OTHER hexes so the user can't
          // accidentally place one character in two spawns. The char
          // currently pinned to THIS hex is still selectable (it's the
          // value shown).
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
}
