import { describe, expect, it, beforeEach } from 'vitest';
import '../../src/engine/traits';
import type {
  Attacker,
  CatalogCharacter,
  Rarity,
} from '../../src/engine/types';
import type { Hex } from '../../src/map/core/hex';
import type {
  BossScript,
  HexEffectDef,
  MapDef,
  TerrainDef,
} from '../../src/map/core/mapSchema';
import {
  initMapBattle,
  type MapBattleState,
  type Unit,
} from '../../src/map/battle/mapBattleState';
import { runEnemyTurn } from '../../src/map/ai/bossAi';
import { __resetSporeMineSeq } from '../../src/map/battle/summons';
import { loadMapCatalog } from '../../src/map/core/catalog';

/**
 * Phase 7 — regression coverage for the two additional bosses + maps
 * (Belisarius Cawl, Szarekh). The Avatar scenario lives in its own
 * file (scenario_avatar.test.ts) because it's the north-star test and
 * carries a lot of summon-related assertions that don't apply here.
 *
 * Each boss gets:
 *   1. A "script plays through to completion and loops" check against
 *      `runEnemyTurn`, so tuning the stats file in future doesn't
 *      silently reorder turns.
 *   2. A "boss deals non-zero damage" check, which catches regressions
 *      where a stat hook (damage, critChance, damageFactor) gets
 *      dropped by a future refactor.
 *   3. A catalog parse check — the new map + script files validate
 *      against the Zod schema.
 *
 * The maps tested here ARE the shipped JSON entries (loaded via
 * `loadMapCatalog`), not synthetic fixtures. The point of Phase 7 is
 * that real content drops in without code changes.
 */

// ────────────────────────────────────────────────────────────────────
// Shared fixture helpers — small duplicate of the Avatar test to keep
// Phase 7 self-contained. Any future refactor that consolidates these
// into tests/map/_fixtures.ts would tidy both files together.
// ────────────────────────────────────────────────────────────────────

function plainChar(
  overrides: Partial<CatalogCharacter> = {},
): CatalogCharacter {
  return {
    id: 'plain',
    displayName: 'Plain',
    faction: 'Space Marines',
    alliance: 'imperial',
    baseStats: {
      damage: 100,
      armor: 50,
      hp: 10_000,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 1,
      rangedHits: 1,
    },
    melee: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
    abilities: [],
    traits: [],
    maxRarity: 'legendary',
    ...overrides,
  };
}

function makeAttacker(
  src: CatalogCharacter,
  rarity: Rarity = 'legendary',
): Attacker {
  return {
    source: src,
    progression: { stars: 0, rank: 0, xpLevel: 1, rarity },
    equipment: [],
  };
}

function hero(id: string, position: Hex, hp: number): Unit {
  const src = plainChar({
    id,
    displayName: id,
    baseStats: { ...plainChar().baseStats, hp },
  });
  return {
    id,
    side: 'player',
    kind: 'hero',
    position,
    attacker: makeAttacker(src),
    maxHp: hp,
    maxShield: 0,
    currentHp: hp,
    currentShield: 0,
    statusEffects: [],
  };
}

function bossUnit(
  id: string,
  scriptId: string,
  position: Hex,
  hp: number,
  damage: number,
): Unit {
  const src = plainChar({
    id,
    displayName: id,
    baseStats: {
      ...plainChar().baseStats,
      damage,
      armor: 500,
      hp,
      critChance: 0.2,
      critDamage: 0.5,
    },
    traits: ['boss', 'immune', 'big'],
    melee: { label: 'Strike', damageType: 'power', hits: 1, kind: 'melee' },
  });
  return {
    id,
    side: 'enemy',
    kind: 'boss',
    position,
    attacker: makeAttacker(src),
    maxHp: hp,
    maxShield: 0,
    currentHp: hp,
    currentShield: 0,
    statusEffects: [],
    scriptPointer: { scriptId, turnIdx: 0 },
  };
}

function makeGridMap(id: string, bossScriptId: string): MapDef {
  const hexes: MapDef['hexes'] = [];
  for (let q = 0; q < 8; q++) {
    for (let r = 0; r < 8; r++) {
      hexes.push({ q, r, terrain: 'normal' });
    }
  }
  return {
    id,
    displayName: id,
    image: { href: '#', width: 1, height: 1 },
    origin: { xPx: 0, yPx: 0 },
    hexSizePx: 30,
    orientation: 'pointy',
    hexes,
    bossScriptId,
  };
}

const TERRAIN_CATALOG: TerrainDef[] = [
  {
    id: 'normal',
    displayName: 'Normal',
    blocksMove: false,
    blocksMoveUnlessTrait: [],
    blocksLoS: false,
  },
];

const HEX_EFFECTS_CATALOG: HexEffectDef[] = [];

function makeBattle(scenarioId: string, scriptId: string): MapBattleState {
  const heroes: Unit[] = [
    hero('h_a', { q: 1, r: 6 }, 1_000_000),
    hero('h_b', { q: 2, r: 6 }, 1_000_000),
    hero('h_c', { q: 3, r: 6 }, 1_000_000),
    hero('h_d', { q: 4, r: 6 }, 1_000_000),
    hero('h_e', { q: 5, r: 6 }, 1_000_000),
  ];
  const boss = bossUnit('boss', scriptId, { q: 3, r: 1 }, 3_000_000, 25_000);
  return initMapBattle({
    map: makeGridMap(scenarioId, scriptId),
    terrain: TERRAIN_CATALOG,
    hexEffects: HEX_EFFECTS_CATALOG,
    playerUnits: heroes,
    enemyUnits: [boss],
  });
}

// ────────────────────────────────────────────────────────────────────
// Belisarius Cawl
// ────────────────────────────────────────────────────────────────────

describe('Belisarius Cawl — scripted scenario', () => {
  beforeEach(() => __resetSporeMineSeq());

  it('plays turns in order (barrage → atomiser → normal) and loops', () => {
    const battle = makeBattle('cawl_scenario', 'belisarius_cawl_default');

    const expected = [
      { stepKind: 'ability', abilityId: 'mechadendrite_barrage' },
      { stepKind: 'ability', abilityId: 'solar_atomiser' },
      { stepKind: 'normal', abilityId: undefined },
      // repeatsFrom=0 → loops back:
      { stepKind: 'ability', abilityId: 'mechadendrite_barrage' },
    ];
    for (let i = 0; i < expected.length; i++) {
      const res = runEnemyTurn(battle);
      expect(res.actions).toHaveLength(1);
      const a = res.actions[0];
      expect(a.kind).toBe('attack');
      expect(a.stepKind).toBe(expected[i].stepKind);
      if (expected[i].abilityId !== undefined) {
        expect(a.abilityId).toBe(expected[i].abilityId);
      }
    }
  });

  it('deals non-zero damage (script stats flow through hydration)', () => {
    const battle = makeBattle('cawl_scenario', 'belisarius_cawl_default');
    const totalBefore = totalPlayerHp(battle);
    runEnemyTurn(battle);
    expect(totalPlayerHp(battle)).toBeLessThan(totalBefore);
  });

  it('script loaded from disk carries the expected three turn steps', () => {
    const catalog = loadMapCatalog();
    const script: BossScript = catalog.bossScriptById['belisarius_cawl_default'];
    expect(script).toBeDefined();
    expect(script.turns.map((t) => t.kind)).toEqual([
      'ability',
      'ability',
      'normal',
    ]);
    expect(script.targetPolicy).toBe('weakest');
    expect(script.repeatsFrom).toBe(0);
  });

  it('map catalog exposes the Belisarius Cawl map with boss + player spawns', () => {
    const catalog = loadMapCatalog();
    const map = catalog.mapById['belisarius_cawl_w1'];
    expect(map).toBeDefined();
    expect(map.bossScriptId).toBe('belisarius_cawl_default');
    expect(map.hexes.some((c) => c.spawn === 'boss')).toBe(true);
    expect(map.hexes.filter((c) => c.spawn === 'player').length).toBeGreaterThan(
      0,
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// Szarekh the Silent King
// ────────────────────────────────────────────────────────────────────

describe('Szarekh — scripted scenario', () => {
  beforeEach(() => __resetSporeMineSeq());

  it('plays turns in order (cannon → will → normal → warp) and loops', () => {
    const battle = makeBattle('szarekh_scenario', 'szarekh_default');

    const expected = [
      { stepKind: 'ability', abilityId: 'gauss_entropy_cannon' },
      { stepKind: 'ability', abilityId: 'transcendent_will' },
      { stepKind: 'normal', abilityId: undefined },
      { stepKind: 'ability', abilityId: 'reality_warp' },
      // repeatsFrom=0 → loops back:
      { stepKind: 'ability', abilityId: 'gauss_entropy_cannon' },
    ];
    for (let i = 0; i < expected.length; i++) {
      const res = runEnemyTurn(battle);
      expect(res.actions).toHaveLength(1);
      const a = res.actions[0];
      expect(a.kind).toBe('attack');
      expect(a.stepKind).toBe(expected[i].stepKind);
      if (expected[i].abilityId !== undefined) {
        expect(a.abilityId).toBe(expected[i].abilityId);
      }
    }
  });

  it('deals non-zero damage on its highest-impact turn (transcendent_will)', () => {
    const battle = makeBattle('szarekh_scenario', 'szarekh_default');
    // Burn the first cannon turn to advance the pointer.
    runEnemyTurn(battle);
    const totalBefore = totalPlayerHp(battle);
    const res = runEnemyTurn(battle);
    expect(res.actions[0].abilityId).toBe('transcendent_will');
    expect(totalPlayerHp(battle)).toBeLessThan(totalBefore);
  });

  it('script loaded from disk carries the expected four turn steps', () => {
    const catalog = loadMapCatalog();
    const script: BossScript = catalog.bossScriptById['szarekh_default'];
    expect(script).toBeDefined();
    expect(script.turns.map((t) => t.kind)).toEqual([
      'ability',
      'ability',
      'normal',
      'ability',
    ]);
    expect(script.targetPolicy).toBe('preferSummonsThenWeakest');
    expect(script.repeatsFrom).toBe(0);
  });

  it('map catalog exposes the Szarekh map with enemy + player spawns', () => {
    const catalog = loadMapCatalog();
    const map = catalog.mapById['szarekh_w1'];
    expect(map).toBeDefined();
    expect(map.bossScriptId).toBe('szarekh_default');
    expect(map.hexes.some((c) => c.spawn === 'boss')).toBe(true);
    // The shipped Szarekh map includes two adjacent enemy escorts.
    expect(map.hexes.filter((c) => c.spawn === 'enemy').length).toBeGreaterThan(
      0,
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// Cross-catalog sanity: every map's bossScriptId resolves.
// ────────────────────────────────────────────────────────────────────

describe('catalog integrity', () => {
  it('every map with a bossScriptId points at a real script', () => {
    const catalog = loadMapCatalog();
    for (const map of catalog.maps) {
      if (!map.bossScriptId) continue;
      const script = catalog.bossScriptById[map.bossScriptId];
      expect(
        script,
        `${map.id} references unknown boss script ${map.bossScriptId}`,
      ).toBeDefined();
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function totalPlayerHp(battle: MapBattleState): number {
  return Object.values(battle.units)
    .filter((u) => u.side === 'player')
    .reduce((sum, u) => sum + u.currentHp, 0);
}
