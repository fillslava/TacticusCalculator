import { describe, expect, it } from 'vitest';
import { listCharacters } from '../../src/data/catalog';
import { buildMapBattleFromTeam } from '../../src/map/battle/hydration';
import { loadMapCatalog } from '../../src/map/core/catalog';
import { hexKey } from '../../src/map/core/hex';
import type {
  BuildOverrides,
  MapTeamSlot,
  TeamMemberState,
  UnitBuildMemo,
} from '../../src/state/store';
import type { TargetState } from '../../src/state/store';

/**
 * Regression coverage for the per-map team override added alongside
 * the MapTeamPicker UI. Two contracts:
 *
 *   1. Without an override, hydration uses the sequential-fill path —
 *      identical to what the Phase 4 flow shipped. Pins the legacy
 *      ordering so a future refactor can't quietly rewire it.
 *
 *   2. With an override, each pinned character lands on its declared
 *      spawn hex regardless of team-member array order, and characters
 *      not pinned never appear twice on the board.
 */

// ────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────

const FALLBACK: BuildOverrides = {
  characterId: null,
  progression: 30,
  rank: 5,
  xpLevel: 20,
  equipmentIds: [null, null, null],
};

const TARGET: TargetState = {
  bossId: null,
  stageIndex: 0,
};

/** Pick 3 distinct characters that definitely exist in the catalog so
 *  the test is stable across content edits. */
function pickThreeChars(): [string, string, string] {
  const all = listCharacters();
  expect(all.length).toBeGreaterThanOrEqual(3);
  return [all[0].id, all[1].id, all[2].id];
}

function memberRow(slotId: string, characterId: string | null): TeamMemberState {
  return { slotId, position: 0, characterId, kind: 'hero' };
}

function emptyBuilds(): Record<string, UnitBuildMemo> {
  return {};
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('buildMapBattleFromTeam — per-map override', () => {
  it('without override: sequential fill (legacy Phase 4 behaviour)', () => {
    const catalog = loadMapCatalog();
    const map = catalog.mapById['avatar_khaine_aethana'];
    expect(map).toBeDefined();

    const [a, b, c] = pickThreeChars();
    const teamMembers: TeamMemberState[] = [
      memberRow('m0', a),
      memberRow('m1', b),
      memberRow('m2', c),
      memberRow('m3', null),
      memberRow('m4', null),
    ];
    const battle = buildMapBattleFromTeam({
      map,
      teamMembers,
      unitBuilds: emptyBuilds(),
      teamMemberOverrides: {},
      fallback: FALLBACK,
      target: { ...TARGET, customHp: 100_000 },
    });
    expect(battle).not.toBeNull();

    const playerSpawns = map.hexes.filter((c) => c.spawn === 'player');
    // Filled slots land on the first N spawn hexes in hex-array order.
    const firstSpawn = playerSpawns[0];
    const firstPlayer = Object.values(battle!.units).find(
      (u) =>
        u.side === 'player' &&
        u.position.q === firstSpawn.q &&
        u.position.r === firstSpawn.r,
    );
    expect(firstPlayer?.attacker.source.id).toBe(a);
    // Second populated team slot maps to the second player spawn.
    const secondSpawn = playerSpawns[1];
    const secondPlayer = Object.values(battle!.units).find(
      (u) =>
        u.side === 'player' &&
        u.position.q === secondSpawn.q &&
        u.position.r === secondSpawn.r,
    );
    expect(secondPlayer?.attacker.source.id).toBe(b);
  });

  it('with override: pinned character lands on its declared spawn hex', () => {
    const catalog = loadMapCatalog();
    const map = catalog.mapById['avatar_khaine_aethana'];
    const playerSpawns = map.hexes.filter((c) => c.spawn === 'player');
    expect(playerSpawns.length).toBeGreaterThanOrEqual(3);

    const [a, b, c] = pickThreeChars();
    // Team tab roster orders as [a, b, c]. Override pins `c` to spawn 0.
    const teamMembers: TeamMemberState[] = [
      memberRow('m0', a),
      memberRow('m1', b),
      memberRow('m2', c),
    ];
    const pinnedHex = playerSpawns[0];
    const mapTeamOverride: MapTeamSlot[] = [
      { spawnHexKey: hexKey({ q: pinnedHex.q, r: pinnedHex.r }), characterId: c },
    ];
    const battle = buildMapBattleFromTeam({
      map,
      teamMembers,
      unitBuilds: emptyBuilds(),
      teamMemberOverrides: {},
      fallback: FALLBACK,
      target: { ...TARGET, customHp: 100_000 },
      mapTeamOverride,
    });
    expect(battle).not.toBeNull();

    // Spawn 0 holds `c` (the pinned one), spawn 1 holds `a` (first
    // non-pinned team slot), spawn 2 holds `b`. Critically, `c` does
    // NOT also appear on spawn 2 via the sequential walk — that would
    // be a double-placement bug.
    const occupant = (hex: { q: number; r: number }) =>
      Object.values(battle!.units).find(
        (u) =>
          u.side === 'player' &&
          u.position.q === hex.q &&
          u.position.r === hex.r,
      );
    expect(occupant(playerSpawns[0])?.attacker.source.id).toBe(c);
    expect(occupant(playerSpawns[1])?.attacker.source.id).toBe(a);
    expect(occupant(playerSpawns[2])?.attacker.source.id).toBe(b);

    const appearances = Object.values(battle!.units).filter(
      (u) => u.side === 'player' && u.attacker.source.id === c,
    );
    expect(appearances).toHaveLength(1);
  });

  it('override with null characterId falls through to team-tab roster', () => {
    const catalog = loadMapCatalog();
    const map = catalog.mapById['avatar_khaine_aethana'];
    const playerSpawns = map.hexes.filter((c) => c.spawn === 'player');

    const [a, b] = pickThreeChars();
    const teamMembers: TeamMemberState[] = [
      memberRow('m0', a),
      memberRow('m1', b),
    ];
    // Explicit null override — same outcome as "no override".
    const mapTeamOverride: MapTeamSlot[] = [
      {
        spawnHexKey: hexKey({ q: playerSpawns[0].q, r: playerSpawns[0].r }),
        characterId: null,
      },
    ];
    const battle = buildMapBattleFromTeam({
      map,
      teamMembers,
      unitBuilds: emptyBuilds(),
      teamMemberOverrides: {},
      fallback: FALLBACK,
      target: { ...TARGET, customHp: 100_000 },
      mapTeamOverride,
    });
    expect(battle).not.toBeNull();

    const firstPlayer = Object.values(battle!.units).find(
      (u) =>
        u.side === 'player' &&
        u.position.q === playerSpawns[0].q &&
        u.position.r === playerSpawns[0].r,
    );
    expect(firstPlayer?.attacker.source.id).toBe(a);
  });
});
