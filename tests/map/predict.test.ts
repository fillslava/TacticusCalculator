import { describe, expect, it } from 'vitest';
import '../../src/engine/traits';
import type {
  Attacker,
  CatalogCharacter,
  Rarity,
} from '../../src/engine/types';
import type { Hex } from '../../src/map/core/hex';
import type {
  HexEffectDef,
  MapDef,
  TerrainDef,
} from '../../src/map/core/mapSchema';
import {
  initMapBattle,
  type MapBattleState,
  type Unit,
} from '../../src/map/battle/mapBattleState';
import {
  HEURISTIC_POLICY,
  suggestAction,
} from '../../src/map/ai/predict';
import { spawnSporeMine, __resetSporeMineSeq } from '../../src/map/battle/summons';
import {
  assembleTrace,
  battleToJsonl,
  exportBattleTrace,
  traceTurnFromEnemyResult,
  traceTurnFromPlayerResult,
} from '../../src/map/battle/trace';
import { runEnemyTurn } from '../../src/map/ai/bossAi';

/**
 * Phase 6 — predict mode + trace export.
 *
 * Two separate concerns sharing one test file because both are small:
 *
 *   1. `suggestAction` produces a sensible ranking — specifically, it
 *      prefers a 1-shot kill on a spore mine over a bigger-damage hit
 *      that doesn't kill. This is the same "summons-first" intuition
 *      the scripted enemy uses, but expressed through the heuristic
 *      scoring formula rather than a hard policy.
 *
 *   2. Trace export — `battleToJsonl` produces parseable JSONL with a
 *      header row + one row per turn, round-tripping through
 *      `JSON.parse` without error.
 */

// ────────────────────────────────────────────────────────────────────
// Fixture
// ────────────────────────────────────────────────────────────────────

function plainChar(overrides: Partial<CatalogCharacter> = {}): CatalogCharacter {
  return {
    id: 'plain',
    displayName: 'Plain',
    faction: 'Space Marines',
    alliance: 'imperial',
    baseStats: {
      damage: 1000,
      armor: 0,
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

function makeAttacker(src: CatalogCharacter, rarity: Rarity = 'legendary'): Attacker {
  return {
    source: src,
    progression: { stars: 0, rank: 0, xpLevel: 1, rarity },
    equipment: [],
  };
}

function unit(
  id: string,
  side: 'player' | 'enemy',
  position: Hex,
  src?: CatalogCharacter,
  hp = 10_000,
  kind: Unit['kind'] = side === 'player' ? 'hero' : 'boss',
): Unit {
  const cs = src ?? plainChar({ id, displayName: id });
  return {
    id,
    side,
    kind,
    position,
    attacker: makeAttacker(cs),
    maxHp: hp,
    maxShield: 0,
    currentHp: hp,
    currentShield: 0,
    statusEffects: [],
  };
}

function makeMap(): MapDef {
  const hexes: MapDef['hexes'] = [];
  for (let q = 0; q < 8; q++) {
    for (let r = 0; r < 8; r++) {
      hexes.push({ q, r, terrain: 'normal' });
    }
  }
  return {
    id: 'predict_test',
    displayName: 'Predict Test',
    image: { href: '#', width: 1, height: 1 },
    origin: { xPx: 0, yPx: 0 },
    hexSizePx: 30,
    orientation: 'pointy',
    hexes,
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

const HEX_EFFECTS_CATALOG: HexEffectDef[] = [
  {
    id: 'sporeMine',
    displayName: 'Spore Mine',
    durationTurns: 99,
    modifier: { kind: 'flatDamageOnEnter', damage: 1500, damageType: 'bio', oneShot: true },
    affects: 'enemy',
    source: 'ability',
  },
];

function makeBattle(units: Unit[]): MapBattleState {
  const player = units.filter((u) => u.side === 'player');
  const enemy = units.filter((u) => u.side === 'enemy');
  return initMapBattle({
    map: makeMap(),
    terrain: TERRAIN_CATALOG,
    hexEffects: HEX_EFFECTS_CATALOG,
    playerUnits: player,
    enemyUnits: enemy,
  });
}

// ────────────────────────────────────────────────────────────────────
// Predict tests
// ────────────────────────────────────────────────────────────────────

describe('suggestAction — heuristic predict', () => {
  it('returns empty for a dead attacker', () => {
    const hero = unit('hero', 'player', { q: 0, r: 0 });
    hero.currentHp = 0;
    const boss = unit('boss', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle([hero, boss]);
    expect(suggestAction(hero, battle)).toEqual([]);
  });

  it('returns empty when no enemies are alive', () => {
    const hero = unit('hero', 'player', { q: 0, r: 0 });
    const boss = unit('boss', 'enemy', { q: 2, r: 0 });
    boss.currentHp = 0;
    const battle = makeBattle([hero, boss]);
    expect(suggestAction(hero, battle)).toEqual([]);
  });

  it('orders suggestions by score (1-shot kill on summon beats non-kill on boss)', () => {
    // Hero that hits for ~1000 damage per melee.
    const hero = unit('hero', 'player', { q: 0, r: 0 });
    // Boss with 10M HP — far more than one hero hit.
    const boss = unit('boss', 'enemy', { q: 2, r: 0 }, undefined, 10_000_000);
    const battle = makeBattle([hero, boss]);
    // Spawn an ENEMY spore mine by overriding side — the scenario is
    // "predict sees a fragile enemy target and prefers to kill it".
    __resetSporeMineSeq();
    const mine = spawnSporeMine(battle, { q: 3, r: 0 }, { hp: 1 });
    // Flip it to enemy side so the heuristic picks it up as a candidate.
    battle.units[mine.id].side = 'enemy';

    const suggestions = suggestAction(hero, battle, { limit: 5 });
    expect(suggestions.length).toBeGreaterThan(0);

    const topTargets = suggestions.map((s) => s.targetId);
    const top = suggestions[0];
    // The mine is a guaranteed kill (1 HP vs ~1000 dmg hit) so its
    // killChance should be ~1 and its score should beat the boss's.
    expect(top.targetId).toBe(mine.id);
    expect(top.killChance).toBeCloseTo(1, 3);
    // And the boss suggestion should be present too (just ranked lower).
    expect(topTargets).toContain('boss');
  });

  it('HEURISTIC_POLICY.suggest returns the same ordering as suggestAction', () => {
    const hero = unit('hero', 'player', { q: 0, r: 0 });
    const boss = unit('boss', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle([hero, boss]);
    const direct = suggestAction(hero, battle);
    const viaPolicy = HEURISTIC_POLICY.suggest(hero, battle);
    expect(viaPolicy.map((s) => s.attackKey)).toEqual(
      direct.map((s) => s.attackKey),
    );
  });

  it('suggestion carries a breakdown and a valid rngMode-expected ctx', () => {
    const hero = unit('hero', 'player', { q: 0, r: 0 });
    const boss = unit('boss', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle([hero, boss]);
    const [top] = suggestAction(hero, battle, { limit: 1 });
    expect(top.breakdown).toBeDefined();
    expect(top.ctx.rngMode).toBe('expected');
  });
});

// ────────────────────────────────────────────────────────────────────
// Trace tests
// ────────────────────────────────────────────────────────────────────

describe('battleToJsonl — trace export', () => {
  it('produces one header line + one line per turn, all JSON.parseable', () => {
    const hero = unit('hero', 'player', { q: 0, r: 0 });
    const boss = unit(
      'boss',
      'enemy',
      { q: 2, r: 0 },
      plainChar({
        id: 'avatar',
        baseStats: { ...plainChar().baseStats, damage: 10_000 },
      }),
      500_000,
    );
    boss.scriptPointer = { scriptId: 'avatar_khaine_default', turnIdx: 0 };
    const battle = makeBattle([hero, boss]);

    const t1 = traceTurnFromPlayerResult(battle, [
      { kind: 'skipped', action: { kind: 'move', unitId: 'hero', to: { q: 1, r: 0 } }, reason: 'n/a' },
    ]);

    const enemy = runEnemyTurn(battle);
    const t2 = traceTurnFromEnemyResult(battle, enemy);

    const trace = assembleTrace({ battle, turns: [t1, t2], outcome: 'timeout' });
    const jsonl = battleToJsonl(trace);
    const lines = jsonl.trim().split('\n');

    // 1 header + 2 turns = 3 lines.
    expect(lines.length).toBe(3);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].kind).toBe('trace_header');
    expect(parsed[0].mapId).toBe('predict_test');
    expect(parsed[0].outcome).toBe('timeout');
    // One team entry — the hero that appeared in at least one snapshot.
    expect(parsed[0].team).toEqual([{ unitId: 'hero', catalogId: 'hero' }]);
    expect(parsed[1].kind).toBe('trace_turn');
    expect(parsed[1].side).toBe('player');
    expect(parsed[2].kind).toBe('trace_turn');
    expect(parsed[2].side).toBe('enemy');
  });

  it('exportBattleTrace convenience round-trips without outcome', () => {
    const hero = unit('hero', 'player', { q: 0, r: 0 });
    const boss = unit('boss', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle([hero, boss]);
    const snap = traceTurnFromPlayerResult(battle, []);
    const jsonl = exportBattleTrace({ battle, turns: [snap] });
    expect(() => JSON.parse(jsonl.trim().split('\n')[0])).not.toThrow();
  });
});
