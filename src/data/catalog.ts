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

export interface Catalog {
  characters: Map<string, CharacterData>;
  bosses: Map<string, BossData>;
  equipment: Map<string, EquipmentData>;
  curves: CurvesData;
}

let cached: Catalog | null = null;

export function loadCatalog(): Catalog {
  if (cached) return cached;
  const characters = CharactersCatalogSchema.parse(charactersRaw);
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

export function listCharacters(): CharacterData[] {
  return Array.from(loadCatalog().characters.values());
}

export function listBosses(): BossData[] {
  return Array.from(loadCatalog().bosses.values());
}

export function getCharacter(id: string): CharacterData | undefined {
  return loadCatalog().characters.get(id);
}

export function getBoss(id: string): BossData | undefined {
  return loadCatalog().bosses.get(id);
}

export function getEquipment(id: string): EquipmentData | undefined {
  return loadCatalog().equipment.get(id);
}
