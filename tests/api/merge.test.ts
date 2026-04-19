import { describe, it, expect } from 'vitest';
import {
  matchCatalogCharacter,
  mergePlayerUnitWithCatalog,
  resolveEquipment,
} from '../../src/api/merge';
import { ApiPlayerResponseSchema } from '../../src/api/types';
import type { Catalog } from '../../src/data/catalog';
import type { CatalogCharacter, CatalogEquipmentSlot } from '../../src/engine/types';
import sample from '../../src/api/mocks/player.sample.json';

function makeMinimalCatalog(): Catalog {
  const calgar: CatalogCharacter = {
    id: 'calgar',
    displayName: 'Calgar',
    faction: 'Ultramarines',
    alliance: 'Imperial',
    baseStats: {
      damage: 50,
      armor: 25,
      hp: 600,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 4,
      rangedHits: 1,
    },
    melee: { label: 'Melee', damageType: 'power', hits: 4, kind: 'melee' },
    abilities: [],
    traits: [],
    maxRarity: 'legendary',
  };
  const eq: CatalogEquipmentSlot = {
    slotId: 1,
    id: 'crit_15_legendary_crit_L1',
    rarity: 'legendary',
    level: 1,
    mods: { critChance: 0.15, critDamage: 600 },
  };
  return {
    characters: new Map([['calgar', calgar]]),
    bosses: new Map(),
    equipment: new Map([[eq.id, eq]]),
    curves: {
      abilityFactor: [1],
      starMultiplierPerStar: 0.1,
      rarityAbilityStep: 0.2,
      gearRanks: [],
    },
  };
}

describe('ApiPlayerResponseSchema', () => {
  it('parses the sample player json', () => {
    const parsed = ApiPlayerResponseSchema.parse(sample);
    expect(parsed.player.units).toHaveLength(2);
    expect(parsed.player.units[0].id).toBe('calgar');
  });
});

describe('mergePlayerUnitWithCatalog', () => {
  it('produces an Attacker with API progression and equipment', () => {
    const parsed = ApiPlayerResponseSchema.parse(sample);
    const calgarUnit = parsed.player.units[0];
    const catalog = makeMinimalCatalog();
    const { attacker, warning } = mergePlayerUnitWithCatalog(calgarUnit, catalog);
    expect(warning).toBeUndefined();
    expect(attacker).toBeDefined();
    expect(attacker!.source.id).toBe('calgar');
    expect(attacker!.progression.stars).toBe(11);
    // API rank is already 0-indexed (0..19). We pass it through unchanged.
    expect(attacker!.progression.rank).toBe(15);
    expect(attacker!.progression.rarity).toBe('legendary');
    expect(attacker!.equipment).toHaveLength(2);
    expect(attacker!.equipment[0].mods.critChance).toBe(0.15);
    expect(attacker!.equipment[0].relic).toBeUndefined();
    expect(attacker!.equipment[1].relic).toBe(true);
    expect(attacker!.equipment[1].id).toBe('block_20_legendary_block_L1');
  });

  it('warns for unknown unit ids, does not throw', () => {
    const catalog = makeMinimalCatalog();
    const { attacker, warning } = mergePlayerUnitWithCatalog(
      {
        id: 'nonexistentHero',
        progressionIndex: 0,
        xp: 0,
        xpLevel: 1,
        rank: 0,
        items: [],
        upgrades: [],
        shards: 0,
        abilities: [],
      },
      catalog,
    );
    expect(attacker).toBeUndefined();
    expect(warning).toMatch(/Unknown unit id/);
  });
});

describe('resolveEquipment API id mapping', () => {
  function catalogWithItems(ids: string[]): Catalog {
    const c = makeMinimalCatalog();
    for (const id of ids) {
      c.equipment.set(id, {
        slotId: 1,
        id,
        rarity: 'legendary',
        level: 1,
        mods: {},
      });
    }
    return c;
  }

  it('maps I_Crit_Lxxx to canonical legendary crit entry at given level', () => {
    const cat = catalogWithItems(['crit_20_legendary_crit-dmg_L6']);
    const hit = resolveEquipment('I_Crit_L008', 6, cat);
    expect(hit?.id).toBe('crit_20_legendary_crit-dmg_L6');
  });

  it('maps I_Block_Lxxx to canonical legendary block entry', () => {
    const cat = catalogWithItems(['block_20_legendary_block_L1']);
    const hit = resolveEquipment('I_Block_L003', 1, cat);
    expect(hit?.id).toBe('block_20_legendary_block_L1');
  });

  it('maps I_Booster_Block_Lxxx to canonical block booster', () => {
    const cat = catalogWithItems(['block_booster_1_legendary_block_L2']);
    const hit = resolveEquipment('I_Booster_Block_L002', 2, cat);
    expect(hit?.id).toBe('block_booster_1_legendary_block_L2');
  });

  it('falls back to legendary variant for mythic api ids', () => {
    const cat = catalogWithItems(['crit_20_legendary_crit-dmg_L2']);
    const hit = resolveEquipment('I_Crit_M006', 2, cat);
    expect(hit?.id).toBe('crit_20_legendary_crit-dmg_L2');
  });

  it('maps R_<family>_<name> relics to approximate legendary equivalents', () => {
    const cat = catalogWithItems(['crit_20_legendary_crit-dmg_L11']);
    const hit = resolveEquipment('R_Crit_TalonOfHorus', 1, cat);
    expect(hit).not.toBeNull();
    expect(hit?.relic).toBe(true);
    expect(hit?.id).toBe('crit_20_legendary_crit-dmg_L11');
  });

  it('returns null for truly unrecognized ids', () => {
    const cat = catalogWithItems([]);
    expect(resolveEquipment('Z_Unknown_Foobar', 1, cat)).toBeNull();
  });
});

describe('matchCatalogCharacter fuzzy matching', () => {
  const catalog = makeMinimalCatalog();

  it('matches exact id', () => {
    expect(matchCatalogCharacter('calgar', catalog)?.id).toBe('calgar');
  });

  it('matches case-insensitive', () => {
    expect(matchCatalogCharacter('CALGAR', catalog)?.id).toBe('calgar');
  });

  it('matches when API sends long form that starts with catalog id', () => {
    expect(matchCatalogCharacter('calgarLordOfMacragge', catalog)?.id).toBe(
      'calgar',
    );
  });

  it('matches by display-name substring when id differs', () => {
    expect(matchCatalogCharacter('calgar_ultramarines', catalog)?.id).toBe(
      'calgar',
    );
  });

  it('returns undefined for short or unrelated strings', () => {
    expect(matchCatalogCharacter('zz', catalog)).toBeUndefined();
    expect(matchCatalogCharacter('xenomorph', catalog)).toBeUndefined();
  });
});
