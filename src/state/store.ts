import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from '../lib/i18n';
import type {
  AbilityLevel,
  Attacker,
  AttackContext,
  CatalogEquipmentSlot,
  ItemStatMods,
  Target,
  TeamPosition,
  TurnBuff,
} from '../engine/types';
import type { ApiPlayer, ApiUnit } from '../api/types';
import {
  clampProgression,
  rarityToMinProgression,
} from '../engine/progression';
import {
  apiUnitRarity,
  matchCatalogCharacter,
  parseUnitAbilities,
  resolveEquipment,
} from '../api/merge';
import { loadCatalog } from '../data/catalog';

export interface RelicEquipmentMemo {
  id: string;
  slotId: number;
  rarity: string;
  level: number;
  relic: true;
}

export interface UnitBuildMemo {
  progression: number;
  rank: number;
  xpLevel: number;
  equipmentIds: (string | null)[];
  extraStats?: ItemStatMods;
  abilityLevels?: AbilityLevel[];
  relicSlots?: (RelicEquipmentMemo | null)[];
}

export interface SyncReport {
  matched: string[];
  unmatched: { apiId: string; apiName?: string; faction?: string }[];
  totalApiUnits: number;
  unknownItems: string[];
}

export interface BuildOverrides extends UnitBuildMemo {
  characterId: string | null;
}

export interface TargetState {
  bossId: string | null;
  stageIndex: number;
  customArmor?: number;
  customHp?: number;
  customShield?: number;
  customTraits?: string[];
  /**
   * Cumulative kill counts of each of the boss's two primes. After killing
   * prime-N `k` times, the first `k` debuff steps from that prime's chain
   * are applied to the boss's stats. 0 = no debuffs.
   */
  prime1Level?: number;
  prime2Level?: number;
}

export interface RotationTurn {
  attackKey: string;
  buffs: TurnBuff[];
}

/** Which top-level view is visible: the single-attacker calculator or the
 *  five-member Guild-Raid team calculator. Persisted so a reload keeps the
 *  user on the same page. */
export type AppPage = 'single' | 'team';

/** Role the slot plays in the Guild-Raid formation. `hero` = one of the
 *  five character slots; `mow` = the single Machine-of-War slot. The
 *  TeamComposer filters dropdowns by this field so MoW-trait catalog entries
 *  only show up in the MoW slot (and hero-trait catalog entries only show
 *  up in hero slots). The engine itself treats both uniformly — `kind` is
 *  purely store/UI metadata. */
export type TeamMemberKind = 'hero' | 'mow';

/** A slot in the linear Guild-Raid formation. `characterId=null` means the
 *  slot is empty and will be skipped when building the engine rotation.
 *  Positions 0..4 are the five hero slots; position 5 is the MoW slot. */
export interface TeamMemberState {
  slotId: string;
  position: TeamPosition;
  characterId: string | null;
  kind: TeamMemberKind;
}

/** One scheduled action within a team turn. `memberSlotId` references a
 *  `TeamMemberState.slotId`; if the slot is empty when the engine runs,
 *  the action is silently skipped. `attackKey` follows the same
 *  `melee` / `ranged` / `ability:<id>` convention as single-attacker
 *  rotations. */
export interface TeamActionState {
  memberSlotId: string;
  attackKey: string;
}

export interface TeamTurnState {
  actions: TeamActionState[];
}

export interface TeamState {
  members: TeamMemberState[];
  turns: TeamTurnState[];
}

export interface Credentials {
  apiKey: string;
  snowprintId: string;
  userId: string;
  principal: string;
}

export interface AppState {
  credentials: Credentials;
  setCredentials: (c: Partial<Credentials>) => void;

  player: ApiPlayer | null;
  setPlayer: (p: ApiPlayer | null) => void;

  ownedCatalogIds: string[];
  syncReport: SyncReport | null;

  unitBuilds: Record<string, UnitBuildMemo>;
  setUnitBuild: (id: string, memo: UnitBuildMemo) => void;

  build: BuildOverrides;
  setBuild: (patch: Partial<BuildOverrides>) => void;
  selectCharacter: (id: string | null) => void;

  target: TargetState;
  setTarget: (patch: Partial<TargetState>) => void;

  rotation: RotationTurn[];
  setRotation: (turns: RotationTurn[]) => void;
  addTurn: (attackKey: string) => void;
  removeTurn: (index: number) => void;

  page: AppPage;
  setPage: (page: AppPage) => void;

  team: TeamState;
  setTeamMember: (slotId: string, characterId: string | null) => void;
  setTeamRotation: (turns: TeamTurnState[]) => void;
  addTeamTurn: () => void;
  removeTeamTurn: (index: number) => void;
  addTeamAction: (turnIdx: number, memberSlotId: string, attackKey: string) => void;
  updateTeamAction: (
    turnIdx: number,
    actionIdx: number,
    patch: Partial<TeamActionState>,
  ) => void;
  removeTeamAction: (turnIdx: number, actionIdx: number) => void;

  importError: string | null;
  setImportError: (e: string | null) => void;

  language: Lang;
  setLanguage: (lang: Lang) => void;
}

const initialBuild: BuildOverrides = {
  characterId: null,
  progression: rarityToMinProgression('legendary') + 2,
  rank: 5,
  xpLevel: 20,
  equipmentIds: [null, null, null],
};

function detectDefaultLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  const raw = (navigator.language || 'en').toLowerCase();
  if (raw.startsWith('ru')) return 'ru';
  if (raw.startsWith('de')) return 'de';
  if (raw.startsWith('fr')) return 'fr';
  if (raw.startsWith('nl')) return 'nl';
  return 'en';
}

const initialTarget: TargetState = {
  bossId: null,
  stageIndex: 0,
};

/** Canonical slotId for the MoW slot — referenced by the migration so an
 *  older persisted team (5 heroes) can gain the MoW slot deterministically. */
export const MOW_SLOT_ID = 'mow';

function initialTeam(): TeamState {
  const heroes: TeamMemberState[] = [0, 1, 2, 3, 4].map((i) => ({
    slotId: `m${i}`,
    position: i as TeamPosition,
    characterId: null,
    kind: 'hero',
  }));
  const mow: TeamMemberState = {
    slotId: MOW_SLOT_ID,
    position: 5,
    characterId: null,
    kind: 'mow',
  };
  return { members: [...heroes, mow], turns: [{ actions: [] }] };
}

function slotIndex(slotId: string): number {
  if (slotId === 'Slot1') return 0;
  if (slotId === 'Slot2') return 1;
  if (slotId === 'Slot3') return 2;
  const n = Number(slotId);
  return n === 1 ? 0 : n === 2 ? 1 : n === 3 ? 2 : -1;
}

function apiUnitToMemo(
  unit: ApiUnit,
  catalog = loadCatalog(),
  unknownItems?: Set<string>,
): UnitBuildMemo {
  const rarity = apiUnitRarity(unit);
  const rarityMin = rarityToMinProgression(rarity);
  const progression = clampProgression(
    typeof unit.progressionIndex === 'number' && unit.progressionIndex > 0
      ? unit.progressionIndex
      : rarityMin,
  );
  const slotIds = [null, null, null] as (string | null)[];
  const relicSlots = [null, null, null] as (RelicEquipmentMemo | null)[];
  for (const it of unit.items) {
    const slot = slotIndex(it.slotId);
    if (slot < 0) continue;
    const catItem = resolveEquipment(it.id, it.level, catalog);
    if (catItem) {
      slotIds[slot] = catItem.id;
      if (catItem.relic) {
        relicSlots[slot] = {
          id: it.id,
          slotId: slot + 1,
          rarity: it.rarity ?? catItem.rarity ?? 'Legendary',
          level: it.level,
          relic: true,
        };
      }
    } else {
      if (unknownItems) unknownItems.add(it.id);
      relicSlots[slot] = {
        id: it.id,
        slotId: slot + 1,
        rarity: it.rarity ?? 'Legendary',
        level: it.level,
        relic: true,
      };
    }
  }
  return {
    progression,
    rank: Math.max(0, unit.rank ?? 0),
    xpLevel: Math.max(1, unit.xpLevel ?? 1),
    equipmentIds: slotIds,
    abilityLevels: parseUnitAbilities(unit),
    relicSlots: relicSlots.some((r) => r) ? relicSlots : undefined,
  };
}

function memoFromStateForCharacter(
  s: Pick<AppState, 'unitBuilds' | 'player' | 'build'>,
  charId: string,
): UnitBuildMemo {
  const memo = s.unitBuilds[charId];
  if (memo) return memo;
  const catalog = loadCatalog();
  const apiUnit = s.player?.units.find((u) => {
    const match = matchCatalogCharacter(u.id, catalog, u.name);
    return match?.id === charId;
  });
  if (apiUnit) return apiUnitToMemo(apiUnit);
  return {
    progression: s.build.progression,
    rank: s.build.rank,
    xpLevel: s.build.xpLevel,
    equipmentIds: [null, null, null],
  };
}

function syncUnitBuildsFromPlayer(
  existing: Record<string, UnitBuildMemo>,
  player: ApiPlayer | null,
): {
  memos: Record<string, UnitBuildMemo>;
  ownedIds: string[];
  report: SyncReport | null;
} {
  const memos = { ...existing };
  const ownedIds: string[] = [];
  if (!player) return { memos, ownedIds, report: null };
  const catalog = loadCatalog();
  const matched: string[] = [];
  const unmatched: SyncReport['unmatched'] = [];
  const unknownItemSet = new Set<string>();
  for (const u of player.units) {
    const match = matchCatalogCharacter(u.id, catalog, u.name);
    if (!match) {
      unmatched.push({ apiId: u.id, apiName: u.name, faction: u.faction });
      continue;
    }
    matched.push(match.id);
    ownedIds.push(match.id);
    memos[match.id] = apiUnitToMemo(u, catalog, unknownItemSet);
  }
  const report: SyncReport = {
    matched,
    unmatched,
    totalApiUnits: player.units.length,
    unknownItems: Array.from(unknownItemSet).sort(),
  };
  return { memos, ownedIds, report };
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      credentials: {
        apiKey: import.meta.env.VITE_TACTICUS_API_KEY ?? '',
        snowprintId: import.meta.env.VITE_SNOWPRINT_ID ?? '',
        userId: import.meta.env.VITE_USER_ID ?? '',
        principal: import.meta.env.VITE_PRINCIPAL ?? '',
      },
      setCredentials: (c) =>
        set((s) => ({ credentials: { ...s.credentials, ...c } })),

      player: null,
      ownedCatalogIds: [],
      syncReport: null,
      setPlayer: (p) =>
        set((s) => {
          const { memos, ownedIds, report } = syncUnitBuildsFromPlayer(
            s.unitBuilds,
            p,
          );
          let build = s.build;
          if (build.characterId && memos[build.characterId]) {
            build = { ...memos[build.characterId], characterId: build.characterId };
          } else if (!build.characterId && ownedIds.length > 0) {
            const firstId = ownedIds[0];
            build = { ...memos[firstId], characterId: firstId };
          }
          return {
            player: p,
            unitBuilds: memos,
            ownedCatalogIds: ownedIds,
            syncReport: report,
            build,
          };
        }),

      unitBuilds: {},
      setUnitBuild: (id, memo) =>
        set((s) => ({ unitBuilds: { ...s.unitBuilds, [id]: memo } })),

      build: initialBuild,
      setBuild: (patch) =>
        set((s) => {
          const next: BuildOverrides = { ...s.build, ...patch };
          if (next.characterId) {
            const memo: UnitBuildMemo = {
              progression: next.progression,
              rank: next.rank,
              xpLevel: next.xpLevel,
              equipmentIds: next.equipmentIds,
              extraStats: next.extraStats,
              abilityLevels: next.abilityLevels,
              relicSlots: next.relicSlots,
            };
            return { build: next, unitBuilds: { ...s.unitBuilds, [next.characterId]: memo } };
          }
          return { build: next };
        }),
      selectCharacter: (id) =>
        set((s) => {
          if (!id) return { build: { ...s.build, characterId: null } };
          const memo = memoFromStateForCharacter(s, id);
          return { build: { ...memo, characterId: id } };
        }),

      target: initialTarget,
      setTarget: (patch) => set((s) => ({ target: { ...s.target, ...patch } })),

      rotation: [{ attackKey: 'melee', buffs: [] }],
      setRotation: (turns) => set({ rotation: turns }),
      addTurn: (attackKey) =>
        set((s) => ({ rotation: [...s.rotation, { attackKey, buffs: [] }] })),
      removeTurn: (index) =>
        set((s) => ({ rotation: s.rotation.filter((_, i) => i !== index) })),

      page: 'single',
      setPage: (page) => set({ page }),

      team: initialTeam(),
      setTeamMember: (slotId, characterId) =>
        set((s) => ({
          team: {
            ...s.team,
            members: s.team.members.map((m) =>
              m.slotId === slotId ? { ...m, characterId } : m,
            ),
          },
        })),
      setTeamRotation: (turns) =>
        set((s) => ({ team: { ...s.team, turns } })),
      addTeamTurn: () =>
        set((s) => ({
          team: { ...s.team, turns: [...s.team.turns, { actions: [] }] },
        })),
      removeTeamTurn: (index) =>
        set((s) => ({
          team: {
            ...s.team,
            turns: s.team.turns.filter((_, i) => i !== index),
          },
        })),
      addTeamAction: (turnIdx, memberSlotId, attackKey) =>
        set((s) => {
          const turns = s.team.turns.map((t, i) =>
            i === turnIdx
              ? { ...t, actions: [...t.actions, { memberSlotId, attackKey }] }
              : t,
          );
          return { team: { ...s.team, turns } };
        }),
      updateTeamAction: (turnIdx, actionIdx, patch) =>
        set((s) => {
          const turns = s.team.turns.map((t, i) => {
            if (i !== turnIdx) return t;
            return {
              ...t,
              actions: t.actions.map((a, j) =>
                j === actionIdx ? { ...a, ...patch } : a,
              ),
            };
          });
          return { team: { ...s.team, turns } };
        }),
      removeTeamAction: (turnIdx, actionIdx) =>
        set((s) => {
          const turns = s.team.turns.map((t, i) => {
            if (i !== turnIdx) return t;
            return {
              ...t,
              actions: t.actions.filter((_, j) => j !== actionIdx),
            };
          });
          return { team: { ...s.team, turns } };
        }),

      importError: null,
      setImportError: (e) => set({ importError: e }),

      language: detectDefaultLang(),
      setLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: 'tacticus-calc-state',
      version: 13,
      partialize: (s) => ({
        credentials: s.credentials,
        build: s.build,
        target: s.target,
        rotation: s.rotation,
        player: s.player,
        unitBuilds: s.unitBuilds,
        ownedCatalogIds: s.ownedCatalogIds,
        syncReport: s.syncReport,
        language: s.language,
        page: s.page,
        team: s.team,
      }),
      migrate: (persisted: any, fromVersion: number) => {
        if (!persisted) return persisted;
        if (fromVersion < 2 && Array.isArray(persisted.rotation)) {
          persisted.rotation = persisted.rotation.map((t: any) => ({
            attackKey: t?.attackKey ?? 'melee',
            buffs: Array.isArray(t?.buffs) ? t.buffs : [],
          }));
        }
        if (fromVersion < 3 && persisted.build) {
          const b = persisted.build;
          if (typeof b.progression !== 'number') {
            const rarity = typeof b.rarity === 'string' ? b.rarity : 'legendary';
            const base = rarityToMinProgression(rarity as any);
            const stars = typeof b.stars === 'number' ? b.stars : 0;
            b.progression = base + Math.max(0, Math.min(2, stars));
          }
          delete b.stars;
          delete b.rarity;
        }
        if (fromVersion < 4) {
          persisted.unitBuilds = persisted.unitBuilds ?? {};
          persisted.ownedCatalogIds = persisted.ownedCatalogIds ?? [];
        }
        if (fromVersion < 5) {
          // v5 adds syncReport, abilityLevels, relicSlots; clear stale player
          // data so matchCatalogCharacter runs again with new aliases +
          // relic detection.
          persisted.syncReport = null;
          persisted.ownedCatalogIds = [];
          persisted.unitBuilds = {};
          persisted.player = null;
        }
        if (fromVersion < 6) {
          // v6 changes STEPS_PER_RARITY.common from 2 to 3, shifting
          // progression indices. Safest to resync from API.
          persisted.syncReport = null;
          persisted.ownedCatalogIds = [];
          persisted.unitBuilds = {};
          persisted.player = null;
          if (persisted.build) {
            persisted.build.progression = rarityToMinProgression('legendary') + 2;
          }
        }
        if (fromVersion < 7) {
          // v7 subtracts 1 from API rank (was 1-indexed, treated as 0-indexed).
          // Clear cached unitBuilds so resync applies the offset.
          persisted.syncReport = null;
          persisted.ownedCatalogIds = [];
          persisted.unitBuilds = {};
          persisted.player = null;
        }
        if (fromVersion < 8) {
          // v8 adds API item id mapping (I_Crit_Lxxx → canonical catalog id).
          // Force resync so equipment resolves to real stat-contributing items.
          persisted.syncReport = null;
          persisted.ownedCatalogIds = [];
          persisted.unitBuilds = {};
          persisted.player = null;
        }
        if (fromVersion < 9) {
          // v9 rewires buff presets to gameinfo damage tables and fixes the
          // rarity ability multiplier step (0.2 → 0.1, so mythic = 1.5x not
          // 2.0x). Old persisted buffs still hold pre-computed damageFlat
          // values. Clear rotation buffs so re-adding presets pulls the
          // corrected numbers.
          if (Array.isArray(persisted.rotation)) {
            persisted.rotation = persisted.rotation.map((t: any) => ({
              ...t,
              buffs: [],
            }));
          }
        }
        if (fromVersion < 10) {
          // v10 removes the (apiRank - 1) offset (API rank is 0-indexed
          // directly: rank 18 = Mythic I, rank 19 = Mythic II) and derives
          // rarity from progressionIndex since /player doesn't return a
          // rarity field. Clear unit caches so they re-merge with the fixed
          // conversion.
          persisted.syncReport = null;
          persisted.ownedCatalogIds = [];
          persisted.unitBuilds = {};
          persisted.player = null;
        }
        if (fromVersion < 11) {
          // v11 adds `language` — initialize from browser if absent.
          if (!persisted.language) persisted.language = detectDefaultLang();
        }
        if (fromVersion < 12) {
          // v12 adds `page` + `team` for the Guild-Raid team calculator.
          // Default to 'single' so existing users land on their familiar
          // calculator view, and seed an empty 5-slot team.
          if (!persisted.page) persisted.page = 'single';
          if (!persisted.team) persisted.team = initialTeam();
        }
        if (fromVersion < 13) {
          // v13 adds the MoW (Machine of War) 6th slot and the `kind` tag on
          // every member so the composer can filter dropdowns by role. Mutate
          // the existing team in place to preserve whatever the user already
          // picked in hero slots 0..4.
          if (persisted.team && Array.isArray(persisted.team.members)) {
            const members = persisted.team.members as Array<
              Record<string, unknown>
            >;
            for (const m of members) {
              if (!m.kind) m.kind = 'hero';
            }
            if (!members.some((m) => m.kind === 'mow')) {
              members.push({
                slotId: MOW_SLOT_ID,
                position: 5,
                characterId: null,
                kind: 'mow',
              });
            }
          } else {
            persisted.team = initialTeam();
          }
        }
        return persisted;
      },
    },
  ),
);

export function apiUnitFromPlayer(
  player: ApiPlayer | null,
  id: string,
): ApiUnit | undefined {
  return player?.units.find((u) => u.id === id);
}

export function equipmentFromIds(
  ids: (string | null)[],
  lookup: (id: string) => CatalogEquipmentSlot | undefined,
): CatalogEquipmentSlot[] {
  const out: CatalogEquipmentSlot[] = [];
  for (const id of ids) {
    if (!id) continue;
    const item = lookup(id);
    if (item) out.push(item);
  }
  return out;
}

export function emptyAttacker(): Attacker | null {
  return null;
}

export function emptyTarget(): Target | null {
  return null;
}

export function emptyContext(attackKey: string): AttackContext {
  return {
    profile: { label: attackKey, damageType: 'power', hits: 1, kind: 'melee' },
    rngMode: 'expected',
  };
}
