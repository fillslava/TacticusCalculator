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
import { PREFER_SUMMONS_THEN_WEAKEST } from '../../src/map/ai/targetPolicy';
import { __resetSporeMineSeq, spawnSporeMine } from '../../src/map/battle/summons';
import { loadMapCatalog } from '../../src/map/core/catalog';

/**
 * Phase 5 — Avatar of Khaine scripted end-to-end.
 *
 * This is the "north-star" scenario test from the plan: a 4-turn
 * Avatar-of-Khaine fight that exercises every Phase 5 deliverable
 * together — target policy, scripted AI, incoming-damage drain, death
 * handling, summon spawn, spore-mine detonation.
 *
 * The map used here is a tiny synthetic 8×8 grid rather than the full
 * calibrated Avatar map — scenario tests should exercise the AI, not the
 * map calibration. Unit placement matches the plan's reference team
 * (5 heroes + 1 MoW-style unit) minus trait metadata that doesn't affect
 * incoming-damage math (the boss fires `damageFactor`-based abilities,
 * not trait-gated profiles).
 */

// ────────────────────────────────────────────────────────────────────
// Fixture helpers
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

function bossUnit(position: Hex, hp: number, damage: number): Unit {
  const src = plainChar({
    id: 'avatar',
    displayName: 'Avatar of Khaine',
    faction: 'Aeldari',
    alliance: 'chaos',
    baseStats: {
      damage,
      armor: 779,
      hp,
      critChance: 0.2,
      critDamage: 0.5,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 1,
      rangedHits: 1,
    },
    traits: ['boss', 'immune', 'big', 'daemon'],
    melee: { label: 'Strike', damageType: 'power', hits: 1, kind: 'melee' },
  });
  return {
    id: 'boss',
    side: 'enemy',
    kind: 'boss',
    position,
    attacker: makeAttacker(src),
    maxHp: hp,
    maxShield: 0,
    currentHp: hp,
    currentShield: 0,
    statusEffects: [],
    scriptPointer: { scriptId: 'avatar_khaine_default', turnIdx: 0 },
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
    id: 'avatar_scenario',
    displayName: 'Avatar Scenario',
    image: { href: '#', width: 1, height: 1 },
    origin: { xPx: 0, yPx: 0 },
    hexSizePx: 30,
    orientation: 'pointy',
    hexes,
    bossScriptId: 'avatar_khaine_default',
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

function makeBattle(): MapBattleState {
  // 5 heroes spread out so the boss has deterministic distances but
  // identical HP — WEAKEST/PREFER_SUMMONS_THEN_WEAKEST ties break by
  // sorted id, so the "weakest" is whichever id comes first
  // alphabetically among ties. We leverage that in the assertions.
  // HPs well above 4 turns' worth of boss damage so heroes survive the
  // full scripted rotation. Equal HPs mean WEAKEST ties break by id
  // (alphabetical), so h_aesoth is the first target on turn 1 — but
  // remains alive through turn 4 for the spore-mine assertion.
  const heroes: Unit[] = [
    hero('h_aesoth', { q: 1, r: 6 }, 1_000_000),
    hero('h_gulgortz', { q: 2, r: 6 }, 1_000_000),
    hero('h_kariyan', { q: 3, r: 6 }, 1_000_000),
    hero('h_laviscus', { q: 4, r: 6 }, 1_000_000),
    hero('h_trajann', { q: 5, r: 6 }, 1_000_000),
  ];
  const boss = bossUnit({ q: 3, r: 1 }, 4_165_000, 30_000);
  return initMapBattle({
    map: makeMap(),
    terrain: TERRAIN_CATALOG,
    hexEffects: HEX_EFFECTS_CATALOG,
    playerUnits: heroes,
    enemyUnits: [boss],
  });
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('Avatar of Khaine — scripted scenario', () => {
  beforeEach(() => __resetSporeMineSeq());

  it('fires the four scripted turns in order (1→2→3→4) and loops back via repeatsFrom', () => {
    const battle = makeBattle();

    const expectedSequence = [
      { abilityId: 'wailing_doom_strikes', stepKind: 'ability' },
      { abilityId: 'wailing_doom_sweeps', stepKind: 'ability' },
      { abilityId: 'wrath_of_khaine_unleashed', stepKind: 'ability' },
      { abilityId: undefined, stepKind: 'normal' },
      { abilityId: 'wailing_doom_strikes', stepKind: 'ability' }, // loops
    ];

    for (let i = 0; i < expectedSequence.length; i++) {
      const res = runEnemyTurn(battle);
      expect(res.turnStepIdx).toBe(i < 4 ? i : 0); // resolvedIdx wraps
      expect(res.actions).toHaveLength(1);
      const a = res.actions[0];
      expect(a.kind).toBe('attack');
      expect(a.stepKind).toBe(expectedSequence[i].stepKind);
      if (expectedSequence[i].abilityId !== undefined) {
        expect(a.abilityId).toBe(expectedSequence[i].abilityId);
      }
    }
  });

  it('the boss deals non-zero damage to a hero (script stats flow through hydration)', () => {
    const battle = makeBattle();
    const target = battle.units['h_aesoth'];
    const hpBefore = target.currentHp;

    runEnemyTurn(battle);

    // A script with stats.damage=30000 + ability damageFactor>0 must
    // have reduced the targeted hero's HP. If hydration failed to inject
    // the damage stat, `resolveIncomingAttack` would return 0 damage
    // (zero base damage in → zero out) and this assertion catches it.
    expect(battle.units['h_aesoth'] ?? { currentHp: 0 }).toBeTruthy();
    const after = (battle.units['h_aesoth'] ?? { currentHp: 0 }).currentHp;
    expect(after).toBeLessThan(hpBefore);
  });

  it('PREFER_SUMMONS_THEN_WEAKEST targets a spore mine over heroes on turn 4', () => {
    const battle = makeBattle();

    // Advance to turn 4 (the "normal attack" slot).
    runEnemyTurn(battle); // T1 strikes
    runEnemyTurn(battle); // T2 sweeps
    runEnemyTurn(battle); // T3 wrath

    // Find whichever hero is currently alive with the lowest HP — the
    // "weakest" that would have been targeted on T4 if no summon
    // spawned. We snapshot it HERE (before the spore mine goes down) so
    // the final assertion has a stable referent even if a different
    // hero survived than alphabetical order suggests.
    const aliveHeroes = Object.values(battle.units).filter(
      (u) => u.side === 'player' && u.kind === 'hero' && u.currentHp > 0,
    );
    expect(aliveHeroes.length).toBeGreaterThan(0);
    const weakestAlive = aliveHeroes.reduce((w, u) =>
      u.currentHp < w.currentHp ? u : w,
    );
    const weakestIdBefore = weakestAlive.id;
    const weakestHpBefore = weakestAlive.currentHp;

    // Biovore "detonates" — drop a spore mine adjacent to the boss.
    // Turn 4 slot is `{ kind: 'normal' }`, so the boss uses its melee
    // profile with base damage 30k, which will 1-shot a 1-HP mine.
    const mine = spawnSporeMine(battle, { q: 3, r: 2 }, { hp: 1 });
    expect(battle.units[mine.id]).toBeDefined();

    const turn4 = runEnemyTurn(battle);

    expect(turn4.actions).toHaveLength(1);
    const action = turn4.actions[0];
    expect(action.kind).toBe('attack');
    expect(action.stepKind).toBe('normal');
    expect(action.targetId).toBe(mine.id);

    // The mine should have been killed + removed.
    expect(battle.units[mine.id]).toBeUndefined();
    expect(action.killedTarget).toBe(true);

    // And the previously-weakest hero was NOT targeted (so still has
    // the HP they had before turn 4 resolved).
    expect(battle.units[weakestIdBefore]?.currentHp).toBe(weakestHpBefore);
  });

  it('WEAKEST tie-break via id keeps a dead hero off the target list after kill', () => {
    // Setup: two heroes, one with 1 HP so the boss kills it in one hit.
    const battle = makeBattle();
    battle.units['h_aesoth'].currentHp = 1;
    const victimId = 'h_aesoth';

    const r1 = runEnemyTurn(battle);
    expect(r1.actions[0].targetId).toBe(victimId);
    expect(r1.actions[0].killedTarget).toBe(true);
    expect(battle.units[victimId]).toBeUndefined();
    // Post-kill, the victim is gone from membersInRotation — a later
    // player-turn rotation that references 'h_aesoth' would then find
    // him absent, which is the intended bookkeeping.
    expect(battle.battleState.membersInRotation.has(victimId)).toBe(false);

    // Next turn the weakest pick must NOT be the dead hero.
    const r2 = runEnemyTurn(battle);
    expect(r2.actions[0].targetId).not.toBe(victimId);
    expect(r2.actions[0].targetId).toBeDefined();
  });

  it('the Avatar script loaded from disk carries the expected four turn steps', () => {
    const catalog = loadMapCatalog();
    const script: BossScript = catalog.bossScriptById['avatar_khaine_default'];
    expect(script).toBeDefined();
    expect(script.turns).toHaveLength(4);
    expect(script.turns.map((t) => t.kind)).toEqual([
      'ability',
      'ability',
      'ability',
      'normal',
    ]);
    expect(script.repeatsFrom).toBe(0);
    expect(script.targetPolicy).toBe('preferSummonsThenWeakest');
  });

  it('PREFER_SUMMONS_THEN_WEAKEST falls back to weakest when no summons are alive', () => {
    const battle = makeBattle();
    const weakest = 'h_aesoth';
    battle.units[weakest].currentHp = 5000; // lowest HP among the heroes
    const candidates = Object.values(battle.units).filter(
      (u) => u.side === 'player',
    );
    const picked = PREFER_SUMMONS_THEN_WEAKEST.pick(candidates, {
      attacker: battle.units['boss'],
      battle,
    });
    expect(picked?.id).toBe(weakest);
  });
});
