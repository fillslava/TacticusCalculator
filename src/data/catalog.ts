import {
  CharactersCatalogSchema,
  BossesCatalogSchema,
  EquipmentCatalogSchema,
  CurvesSchema,
  type CharacterData,
  type BossData,
  type EquipmentData,
  type CurvesData,
} from './schema';
import charactersRaw from './characters.json';
import bossesRaw from './bosses.json';
import equipmentRaw from './equipment.json';
import curvesRaw from './curves.json';
import type { CatalogAbility, CatalogCharacter } from '../engine/types';

export interface Catalog {
  characters: Map<string, CatalogCharacter>;
  bosses: Map<string, BossData>;
  equipment: Map<string, EquipmentData>;
  curves: CurvesData;
}

let cached: Catalog | null = null;

/**
 * Normalizes a raw ability record to the canonical engine form. Accepts the
 * legacy singleton `profile` or the new `profiles` array; always returns
 * `profiles` populated (possibly empty for pure-buff passives).
 */
function normalizeAbility(raw: CharacterData['abilities'][number]): CatalogAbility {
  const profiles =
    raw.profiles && raw.profiles.length > 0
      ? raw.profiles
      : raw.profile
        ? [raw.profile]
        : [];
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    curveId: raw.curveId,
    profiles,
    cooldown: raw.cooldown,
    trigger: raw.trigger,
    scaling: raw.scaling,
    teamBuff: raw.teamBuff,
  };
}

function normalizeCharacter(raw: CharacterData): CatalogCharacter {
  return {
    id: raw.id,
    displayName: raw.displayName,
    faction: raw.faction,
    alliance: raw.alliance,
    baseStats: raw.baseStats,
    melee: raw.melee,
    ranged: raw.ranged,
    abilities: raw.abilities.map(normalizeAbility),
    traits: raw.traits,
    maxRarity: raw.maxRarity,
  };
}

export function loadCatalog(): Catalog {
  if (cached) return cached;
  const characters = CharactersCatalogSchema.parse(charactersRaw).map(
    normalizeCharacter,
  );
  const bosses = BossesCatalogSchema.parse(bossesRaw);
  const equipment = EquipmentCatalogSchema.parse(equipmentRaw);
  const curves = CurvesSchema.parse(curvesRaw);
  cached = {
    characters: new Map(characters.map((c) => [c.id, c])),
    bosses: new Map(bosses.map((b) => [b.id, b])),
    equipment: new Map(equipment.map((e) => [e.id, e])),
    curves,
  };
  return cached;
}

export function listCharacters(): CatalogCharacter[] {
  return Array.from(loadCatalog().characters.values());
}

export function listBosses(): BossData[] {
  return Array.from(loadCatalog().bosses.values());
}

export function getCharacter(id: string): CatalogCharacter | undefined {
  return loadCatalog().characters.get(id);
}

export function getBoss(id: string): BossData | undefined {
  return loadCatalog().bosses.get(id);
}

export function getEquipment(id: string): EquipmentData | undefined {
  return loadCatalog().equipment.get(id);
}
