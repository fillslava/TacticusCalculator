import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AbilityLevel,
  Attacker,
  AttackContext,
  CatalogEquipmentSlot,
  ItemStatMods,
  Target,
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
}

export interface RotationTurn {
  attackKey: string;
  buffs: TurnBuff[];
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

  importError: string | null;
  setImportError: (e: string | null) => void;
}

const initialBuild: BuildOverrides = {
  characterId: null,
  progression: rarityToMinProgression('legendary') + 2,
  rank: 5,
  xpLevel: 20,
  equipmentIds: [null, null, null],
};

const initialTarget: TargetState = {
  bossId: null,
  stageIndex: 0,
};

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
    const match = matchCatalogCharacter(u.id, catalog);
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
    const match = matchCatalogCharacter(u.id, catalog);
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

      importError: null,
      setImportError: (e) => set({ importError: e }),
    }),
    {
      name: 'tacticus-calc-state',
      version: 5,
      partialize: (s) => ({
        credentials: s.credentials,
        build: s.build,
        target: s.target,
        rotation: s.rotation,
        player: s.player,
        unitBuilds: s.unitBuilds,
        ownedCatalogIds: s.ownedCatalogIds,
        syncReport: s.syncReport,
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
