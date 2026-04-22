import { describe, expect, it } from 'vitest';
import type {
  Attacker,
  AttackProfile,
  CatalogCharacter,
  Rarity,
} from '../../src/engine/types';
import type { Hex } from '../../src/map/core/hex';
import type {
  HexEffectDef,
  MapDef,
  TerrainDef,
} from '../../src/map/core/mapSchema';
import { deriveHexBuffs } from '../../src/map/battle/hexBuffs';
import {
  applyHexEffect,
  initMapBattle,
  type Unit,
} from '../../src/map/battle/mapBattleState';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function plainChar(overrides: Partial<CatalogCharacter> = {}): CatalogCharacter {
  return {
    id: 'plain',
    displayName: 'Plain',
    faction: 'Space Marines',
    alliance: 'imperial',
    baseStats: {
      damage: 100,
      armor: 100,
      hp: 1000,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 2,
      rangedHits: 2,
    },
    melee: { label: 'Melee', damageType: 'power', hits: 2, kind: 'melee' },
    ranged: { label: 'Ranged', damageType: 'bolter', hits: 4, kind: 'ranged' },
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
): Unit {
  const cs = src ?? plainChar({ id, displayName: id });
  return {
    id,
    side,
    kind: side === 'player' ? 'hero' : 'boss',
    position,
    attacker: makeAttacker(cs),
    maxHp: 1000,
    maxShield: 0,
    currentHp: 1000,
    currentShield: 0,
    statusEffects: [],
  };
}

/** 3-row strip of hexes with fully-configurable terrain. */
function makeMap(hexTerrainAt: Record<string, string>): MapDef {
  // q in 0..3, r in 0..2 → 12 cells.
  const hexes: MapDef['hexes'] = [];
  for (let q = 0; q <= 3; q++) {
    for (let r = 0; r <= 2; r++) {
      const key = `${q},${r}`;
      hexes.push({ q, r, terrain: (hexTerrainAt[key] ?? 'normal') as any });
    }
  }
  return {
    id: 'test',
    displayName: 'Test',
    image: { href: '#', width: 1, height: 1 },
    origin: { xPx: 0, yPx: 0 },
    hexSizePx: 30,
    orientation: 'pointy',
    hexes,
  };
}

const TERRAIN_CATALOG: TerrainDef[] = [
  { id: 'normal', displayName: 'Normal', blocksMove: false, blocksMoveUnlessTrait: [], blocksLoS: false },
  {
    id: 'highGround',
    displayName: 'High Ground',
    blocksMove: false,
    blocksMoveUnlessTrait: [],
    blocksLoS: false,
    onAttackFromDamageMultiplier: 1.5,
  },
  {
    id: 'tallGrass',
    displayName: 'Tall Grass',
    blocksMove: false,
    blocksMoveUnlessTrait: [],
    blocksLoS: true,
    rangedHitsDelta: -2,
  },
  {
    id: 'trenches',
    displayName: 'Trenches',
    blocksMove: false,
    blocksMoveUnlessTrait: [],
    blocksLoS: false,
    crossingBorderDefenseMultiplier: 0.5,
  },
  {
    id: 'ice',
    displayName: 'Ice',
    blocksMove: false,
    blocksMoveUnlessTrait: [],
    blocksLoS: false,
    onOccupyEffect: 'ice',
  },
];

const HEX_EFFECTS_CATALOG: HexEffectDef[] = [
  {
    id: 'ice',
    displayName: 'Ice',
    durationTurns: 2,
    affects: 'any',
    source: 'terrain',
    modifier: { kind: 'critDamageDelta', pct: 0.25 },
  },
  {
    id: 'despoiledGround',
    displayName: 'Despoiled Ground',
    durationTurns: 2,
    affects: 'any',
    source: 'ability',
    modifier: { kind: 'factionDamageDelta', alliance: 'imperial', pct: 0.2 },
  },
  {
    id: 'contamination',
    displayName: 'Contamination',
    durationTurns: 2,
    affects: 'any',
    source: 'ability',
    modifier: { kind: 'armorDelta', pct: -0.3 },
  },
  {
    id: 'fire',
    displayName: 'Fire',
    durationTurns: 2,
    affects: 'any',
    source: 'terrain',
    modifier: { kind: 'dotOfMaxHpPct', pct: 0.2, damageType: 'flame' },
  },
  {
    id: 'sporeMine',
    displayName: 'Spore Mine',
    durationTurns: 3,
    affects: 'enemy',
    source: 'ability',
    modifier: { kind: 'flatDamageOnEnter', damage: 150, damageType: 'bio', oneShot: true },
  },
];

function meleeProfile(): AttackProfile {
  return { label: 'Melee', damageType: 'power', hits: 2, kind: 'melee' };
}
function rangedProfile(): AttackProfile {
  return { label: 'Ranged', damageType: 'bolter', hits: 4, kind: 'ranged' };
}

function makeBattle(
  terrainMap: Record<string, string>,
  attacker: Unit,
  target: Unit,
) {
  return initMapBattle({
    map: makeMap(terrainMap),
    terrain: TERRAIN_CATALOG,
    hexEffects: HEX_EFFECTS_CATALOG,
    playerUnits: [attacker],
    enemyUnits: [target],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveHexBuffs', () => {
  it('returns no buffs on all-normal terrain', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({}, a, t);
    expect(deriveHexBuffs(a, t, battle, meleeProfile())).toEqual([]);
  });

  it('emits +50% damage multiplier when the attacker is on High Ground', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({ '0,0': 'highGround' }, a, t);
    const buffs = deriveHexBuffs(a, t, battle, meleeProfile());
    expect(buffs).toHaveLength(1);
    expect(buffs[0].damageMultiplier).toBe(1.5);
  });

  it('does not emit a High Ground buff when the DEFENDER is the one on High Ground', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({ '2,0': 'highGround' }, a, t);
    expect(deriveHexBuffs(a, t, battle, meleeProfile())).toEqual([]);
  });

  it('emits 0.5 damage multiplier when the defender is on Trenches', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({ '2,0': 'trenches' }, a, t);
    const buffs = deriveHexBuffs(a, t, battle, meleeProfile());
    expect(buffs).toHaveLength(1);
    expect(buffs[0].damageMultiplier).toBe(0.5);
  });

  it('emits -2 hitsDelta only for ranged profiles when defender is in Tall Grass', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({ '2,0': 'tallGrass' }, a, t);
    const ranged = deriveHexBuffs(a, t, battle, rangedProfile());
    const rangedHit = ranged.find((b) => b.hitsDelta !== undefined);
    expect(rangedHit).toBeDefined();
    expect(rangedHit?.hitsDelta).toBe(-2);
    expect(rangedHit?.hitsDeltaOn).toBe('normal');
    // Melee against a tall-grass target should NOT emit the penalty.
    const melee = deriveHexBuffs(a, t, battle, meleeProfile());
    expect(melee.find((b) => b.hitsDelta !== undefined)).toBeUndefined();
  });

  it('emits +25% critDamage when an Ice hex effect is on the defender', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({}, a, t);
    applyHexEffect(battle, t.position, 'ice', 'enemy');
    const buffs = deriveHexBuffs(a, t, battle, meleeProfile());
    const iceBuff = buffs.find((b) => b.critDamage !== undefined);
    expect(iceBuff?.critDamage).toBe(0.25);
  });

  it('emits faction damage delta only when the attacker\'s alliance matches', () => {
    const a = unit('a', 'player', { q: 0, r: 0 }); // default alliance=imperial
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({}, a, t);
    applyHexEffect(battle, t.position, 'despoiledGround', 'enemy');
    const imperial = deriveHexBuffs(a, t, battle, meleeProfile());
    const dBuff = imperial.find((b) => b.id.includes('despoiledGround'));
    expect(dBuff?.damageMultiplier).toBeCloseTo(1.2);

    // Chaos attacker → no match, buff should not appear.
    const chaosAttacker = unit(
      'a',
      'player',
      { q: 0, r: 0 },
      plainChar({ alliance: 'chaos' }),
    );
    const chaos = deriveHexBuffs(chaosAttacker, t, battle, meleeProfile());
    expect(chaos.find((b) => b.id.includes('despoiledGround'))).toBeUndefined();
  });

  it('does not emit buffs for defensive-only effects (contamination lives on the Target)', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({}, a, t);
    applyHexEffect(battle, t.position, 'contamination', 'player');
    // Contamination reduces armor — it's handled in unitToTarget, NOT here.
    expect(deriveHexBuffs(a, t, battle, meleeProfile())).toEqual([]);
  });

  it('ignores on-enter and DoT effects (movement-time / tick-time concerns)', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({}, a, t);
    applyHexEffect(battle, t.position, 'sporeMine', 'player');
    applyHexEffect(battle, t.position, 'fire', 'player');
    expect(deriveHexBuffs(a, t, battle, meleeProfile())).toEqual([]);
  });

  it('skips an expired positional effect past its expiresAtTurn', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle({}, a, t);
    applyHexEffect(battle, t.position, 'ice', 'enemy');
    // Ice has durationTurns=2; applied at turnIdx=0 → expires after turn 1.
    // Fast-forward past expiry.
    battle.turnIdx = 5;
    expect(deriveHexBuffs(a, t, battle, meleeProfile())).toEqual([]);
  });

  it('stacks multiple terrain + hex-effect contributions in the same call', () => {
    const a = unit('a', 'player', { q: 0, r: 0 });
    const t = unit('t', 'enemy', { q: 2, r: 0 });
    const battle = makeBattle(
      { '0,0': 'highGround', '2,0': 'trenches' },
      a,
      t,
    );
    applyHexEffect(battle, t.position, 'ice', 'enemy');
    const buffs = deriveHexBuffs(a, t, battle, meleeProfile());
    // Expect: high ground attacker + trenches defender + ice crit.
    expect(buffs.length).toBe(3);
    expect(buffs.find((b) => b.damageMultiplier === 1.5)).toBeDefined();
    expect(buffs.find((b) => b.damageMultiplier === 0.5)).toBeDefined();
    expect(buffs.find((b) => b.critDamage === 0.25)).toBeDefined();
  });
});
