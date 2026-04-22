import { describe, expect, it } from 'vitest';
import '../../src/engine/traits';
import { resolveTeamRotation } from '../../src/engine/team';
import type {
  Attacker,
  AttackContext,
  CatalogCharacter,
  Rarity,
  TeamRotation,
} from '../../src/engine/types';
import type { Hex } from '../../src/map/core/hex';
import type {
  HexEffectDef,
  MapDef,
  TerrainDef,
} from '../../src/map/core/mapSchema';
import {
  initMapBattle,
  type Unit,
} from '../../src/map/battle/mapBattleState';
import { unitToTarget } from '../../src/map/battle/targetAdapter';
import {
  resolvePlayerTurn,
  type PlayerAction,
} from '../../src/map/battle/playerTurn';
import { hexDistance } from '../../src/map/core/hex';

/**
 * Phase 4 — "backbone parity test" per the plan (§11).
 *
 * The claim we must hold: a scripted move + attack through the map
 * pipeline (`resolvePlayerTurn`) reduces the enemy's HP by exactly the
 * same amount as `resolveTeamRotation` on an equivalent rotation would
 * have dealt. If these ever drift, the map layer has stopped being a
 * wrapper and started being a second damage engine — the direct cause of
 * every "why does map-mode say X but team-mode says Y" bug we'd want
 * to avoid.
 *
 * The fixture is deliberately narrow — single attacker, plain hero,
 * no aura carriers, no terrain modifiers — so the parity assertion
 * isolates HP-drain and rotation-synthesis correctness. Terrain/aura
 * interactions are already covered by `hexBuffs.test.ts` and the engine's
 * own team-buff tests; we don't re-prove them here.
 */

// ---------------------------------------------------------------------------
// Fixture builders (mirrors hexBuffs.test.ts style)
// ---------------------------------------------------------------------------

function plainChar(overrides: Partial<CatalogCharacter> = {}): CatalogCharacter {
  return {
    id: 'plain',
    displayName: 'Plain',
    faction: 'Space Marines',
    alliance: 'imperial',
    baseStats: {
      damage: 100,
      armor: 0,
      hp: 1000,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 2,
      rangedHits: 2,
    },
    melee: { label: 'Melee', damageType: 'power', hits: 2, kind: 'melee' },
    ranged: { label: 'Ranged', damageType: 'bolter', hits: 2, kind: 'ranged' },
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

function unit(
  id: string,
  side: 'player' | 'enemy',
  position: Hex,
  src?: CatalogCharacter,
  hp = 10_000,
): Unit {
  const cs = src ?? plainChar({ id, displayName: id });
  return {
    id,
    side,
    kind: side === 'player' ? 'hero' : 'boss',
    position,
    attacker: makeAttacker(cs),
    maxHp: hp,
    maxShield: 0,
    currentHp: hp,
    currentShield: 0,
    statusEffects: [],
  };
}

/** 8×4 uniform-terrain strip — big enough for a 3-hex move + attack. */
function makeMap(): MapDef {
  const hexes: MapDef['hexes'] = [];
  for (let q = 0; q < 8; q++) {
    for (let r = 0; r < 4; r++) {
      hexes.push({ q, r, terrain: 'normal' });
    }
  }
  return {
    id: 'parity',
    displayName: 'Parity',
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

const HEX_EFFECTS_CATALOG: HexEffectDef[] = [];

function makeBattle(attacker: Unit, victim: Unit) {
  return initMapBattle({
    map: makeMap(),
    terrain: TERRAIN_CATALOG,
    hexEffects: HEX_EFFECTS_CATALOG,
    playerUnits: [attacker],
    enemyUnits: [victim],
  });
}

function meleeCtx(): AttackContext {
  return {
    profile: { label: 'Melee', damageType: 'power', hits: 2, kind: 'melee' },
    rngMode: 'expected',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolvePlayerTurn — parity with resolveTeamRotation', () => {
  it('move + attack drains boss HP by exactly the engine-reported damage', () => {
    const attacker = unit('hero', 'player', { q: 0, r: 3 });
    const victim = unit('boss', 'enemy', { q: 4, r: 0 });
    const battle = makeBattle(attacker, victim);
    const hpBefore = victim.currentHp;

    const actions: PlayerAction[] = [
      { kind: 'move', unitId: 'hero', to: { q: 1, r: 3 } },
      { kind: 'attack', attackerId: 'hero', targetId: 'boss', attackKey: 'melee' },
    ];

    const result = resolvePlayerTurn(battle, actions);

    // Move should have succeeded — position updated, unit still on (1,3).
    const moveLog = result.log.find((l) => l.kind === 'move');
    expect(moveLog).toBeDefined();
    expect(battle.units['hero'].position).toEqual({ q: 1, r: 3 });

    // Attack should have produced exactly one log entry with a breakdown.
    const attackLog = result.log.find((l) => l.kind === 'attack');
    expect(attackLog).toBeDefined();
    if (attackLog?.kind !== 'attack') throw new Error('unreachable');
    expect(attackLog.perContext).toHaveLength(1);

    // Parity assertion #1 — HP delta on the victim unit equals the
    // engine-reported expected damage (clamped to HP, which shouldn't
    // fire at these magnitudes).
    const engineExpected = attackLog.totalExpected;
    expect(victim.currentHp).toBeCloseTo(hpBefore - engineExpected, 6);

    // Parity assertion #2 — running an equivalent single-member
    // `resolveTeamRotation` against an identical Target produces the
    // SAME expected damage. This is the "map pipeline is faithful"
    // invariant: no hidden multiplier, no lost buff, no ghost scaling.
    const reference = resolveTeamRotation(
      {
        members: [
          { id: 'hero', attacker: attacker.attacker, position: 0 },
        ],
        turns: [{ actions: [{ memberId: 'hero', attack: meleeCtx() }] }],
      } satisfies TeamRotation,
      unitToTarget(victim, battle),
    );
    const referenceExpected =
      reference.perMember['hero'].perAction[0].result.expected;
    expect(engineExpected).toBeCloseTo(referenceExpected, 6);
  });

  it('attack-only (no move) produces parity with resolveTeamRotation', () => {
    const attacker = unit('hero', 'player', { q: 3, r: 0 });
    const victim = unit('boss', 'enemy', { q: 5, r: 0 });
    const battle = makeBattle(attacker, victim);
    const hpBefore = victim.currentHp;

    const result = resolvePlayerTurn(battle, [
      { kind: 'attack', attackerId: 'hero', targetId: 'boss', attackKey: 'melee' },
    ]);
    const attackLog = result.log[0];
    if (attackLog.kind !== 'attack') throw new Error('unreachable');

    expect(victim.currentHp).toBeCloseTo(
      hpBefore - attackLog.totalExpected,
      6,
    );
    // Cross-check against direct engine call.
    const reference = resolveTeamRotation(
      {
        members: [{ id: 'hero', attacker: attacker.attacker, position: 0 }],
        turns: [{ actions: [{ memberId: 'hero', attack: meleeCtx() }] }],
      },
      unitToTarget(victim, battle),
    );
    expect(attackLog.totalExpected).toBeCloseTo(
      reference.perMember['hero'].perAction[0].result.expected,
      6,
    );
  });

  it('illegal move is skipped and the battle state is untouched', () => {
    const attacker = unit('hero', 'player', { q: 0, r: 3 });
    const victim = unit('boss', 'enemy', { q: 4, r: 0 });
    const battle = makeBattle(attacker, victim);

    // (4,0) is too far for DEFAULT_MOVEMENT=3 (hex distance from (0,3) is 4).
    expect(hexDistance({ q: 0, r: 3 }, { q: 4, r: 0 })).toBeGreaterThan(3);

    const result = resolvePlayerTurn(battle, [
      { kind: 'move', unitId: 'hero', to: { q: 4, r: 0 } },
    ]);

    expect(result.log[0].kind).toBe('skipped');
    expect(battle.units['hero'].position).toEqual({ q: 0, r: 3 });
  });

  it('skipped attacks leave the target untouched and produce a skip log row', () => {
    const attacker = unit('hero', 'player', { q: 0, r: 3 });
    const victim = unit('boss', 'enemy', { q: 4, r: 0 });
    const battle = makeBattle(attacker, victim);
    const hpBefore = victim.currentHp;

    const result = resolvePlayerTurn(battle, [
      { kind: 'attack', attackerId: 'ghost', targetId: 'boss', attackKey: 'melee' },
    ]);
    expect(result.log[0].kind).toBe('skipped');
    expect(victim.currentHp).toBe(hpBefore);
  });

  it('total damage across multiple actions accumulates in PlayerTurnResult.totalDamage', () => {
    const attacker = unit('hero', 'player', { q: 0, r: 0 });
    const victim = unit('boss', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle(attacker, victim);

    // Two consecutive attacks. Between them the attacker has no cooldown
    // pressure (pure melees with no ability), and the battleState is
    // threaded, so Vitruvius-style marks (none here) would persist.
    const result = resolvePlayerTurn(battle, [
      { kind: 'attack', attackerId: 'hero', targetId: 'boss', attackKey: 'melee' },
      { kind: 'attack', attackerId: 'hero', targetId: 'boss', attackKey: 'melee' },
    ]);

    const attackLogs = result.log.filter((l) => l.kind === 'attack');
    expect(attackLogs).toHaveLength(2);
    const logTotal = attackLogs.reduce(
      (s, l) => s + (l.kind === 'attack' ? l.damageApplied : 0),
      0,
    );
    expect(result.totalDamage).toBeCloseTo(logTotal, 6);
  });
});
