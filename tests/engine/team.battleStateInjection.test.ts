import { describe, expect, it } from 'vitest';
import { initBattleState, resolveTeamRotation } from '../../src/engine/team';
import '../../src/engine/traits';
import type {
  Attacker,
  AttackContext,
  CatalogAbility,
  CatalogBoss,
  CatalogCharacter,
  Rarity,
  Target,
  TeamMember,
  TeamPosition,
  TeamRotation,
} from '../../src/engine/types';

/**
 * Phase 2 regression — `resolveTeamRotation` gains an optional
 * `preExistingBattleState` third argument. Two things must hold:
 *
 *   1. Omitting the argument leaves the observable output bit-identical
 *      to the pre-Phase-2 signature (no hidden side effects on default
 *      call).
 *
 *   2. Supplying the argument lets a caller thread battle-level state
 *      (Vitruvius mark, Helbrecht Crusade window, membersInRotation)
 *      across multiple `resolveTeamRotation` invocations. The engine
 *      MUTATES the injected object — a second call reading the same
 *      reference sees the first call's accumulated state.
 */

const bigBoss: CatalogBoss = {
  id: 'bigBoss',
  displayName: 'Big Boss',
  stages: [{ name: 'only', hp: 10_000_000, armor: 0, traits: [] }],
};

function makeTarget(): Target {
  return { source: bigBoss, stageIndex: 0 };
}

function plainChar(overrides: Partial<CatalogCharacter> = {}): CatalogCharacter {
  return {
    id: 'plain',
    displayName: 'Plain',
    faction: 'Space Marines',
    alliance: 'Imperial',
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

function vitruviusLike(capByLevel: number[] = [500, 500, 500]): CatalogCharacter {
  const passive: CatalogAbility = {
    id: 'vitruvius_master_annihilator',
    name: 'Master Annihilator',
    kind: 'passive',
    profiles: [],
    teamBuff: { kind: 'vitruviusMasterAnnihilator', capByLevel },
  };
  return plainChar({
    id: 'vitruvius',
    displayName: 'Vitruvius',
    faction: 'Adeptus Custodes',
    alliance: 'Imperial',
    abilities: [passive],
  });
}

function makeAttacker(
  src: CatalogCharacter,
  rarity: Rarity = 'mythic',
): Attacker {
  return {
    source: src,
    progression: { stars: 0, rank: 0, xpLevel: 1, rarity },
    equipment: [],
  };
}

function member(
  id: string,
  src: CatalogCharacter,
  position: TeamPosition,
  rarity: Rarity = 'mythic',
): TeamMember {
  return { id, attacker: makeAttacker(src, rarity), position };
}

function meleeAttack(): AttackContext {
  return {
    profile: { label: 'Melee', damageType: 'power', hits: 2, kind: 'melee' },
    rngMode: 'expected',
  };
}

describe('resolveTeamRotation — preExistingBattleState (Phase 2)', () => {
  it('omitting the argument produces identical output to passing a fresh initBattleState', () => {
    const mVit = member('v', vitruviusLike(), 0);
    const mAlly = member('a', plainChar({ id: 'ally2' }), 1);
    const rot: TeamRotation = {
      members: [mVit, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'v', attack: meleeAttack() },
            { memberId: 'a', attack: meleeAttack() },
          ],
        },
      ],
    };
    const target = makeTarget();
    const defaultRun = resolveTeamRotation(rot, target);
    const explicitRun = resolveTeamRotation(rot, target, initBattleState(rot, target));
    expect(explicitRun.cumulativeTeamExpected).toEqual(
      defaultRun.cumulativeTeamExpected,
    );
    expect(explicitRun.perMember['a'].perAction[0].result.expected).toBe(
      defaultRun.perMember['a'].perAction[0].result.expected,
    );
  });

  it('two calls sharing a BattleState carry the Vitruvius mark across invocations', () => {
    const mVit = member('v', vitruviusLike(), 0);
    const mAlly = member('a', plainChar({ id: 'ally2' }), 1);

    // Build ONE battleState, reused by both calls.
    const target = makeTarget();
    const synthFullRoster: TeamRotation = {
      members: [mVit, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'v', attack: meleeAttack() },
            { memberId: 'a', attack: meleeAttack() },
          ],
        },
      ],
    };
    const battleState = initBattleState(synthFullRoster, target);

    // Call 1 — Vitruvius attacks first and marks the target.
    const rotOnlyVit: TeamRotation = {
      members: [mVit, mAlly],
      turns: [{ actions: [{ memberId: 'v', attack: meleeAttack() }] }],
    };
    resolveTeamRotation(rotOnlyVit, target, battleState);
    expect(battleState.vitruviusMarkedSources.has('v')).toBe(true);

    // Call 2 — on a different rotation (just the ally). Should see the mark
    // from Call 1 and apply the bonus hit. Compare to a control run where
    // we pass a FRESH battleState.
    const rotOnlyAlly: TeamRotation = {
      members: [mVit, mAlly],
      turns: [{ actions: [{ memberId: 'a', attack: meleeAttack() }] }],
    };
    const withMark = resolveTeamRotation(rotOnlyAlly, target, battleState);
    const withoutMark = resolveTeamRotation(
      rotOnlyAlly,
      target,
      initBattleState(rotOnlyAlly, target),
    );
    // With mark → bonus-hit buff application; without → none.
    const markedApps = withMark.teamBuffApplications.filter(
      (a) => a.kind === 'vitruviusMasterAnnihilator',
    );
    const unmarkedApps = withoutMark.teamBuffApplications.filter(
      (a) => a.kind === 'vitruviusMasterAnnihilator',
    );
    expect(markedApps.length).toBeGreaterThan(0);
    expect(unmarkedApps).toEqual([]);
    // With mark → ally does strictly more damage (extra hit).
    expect(withMark.perMember['a'].perAction[0].result.expected).toBeGreaterThan(
      withoutMark.perMember['a'].perAction[0].result.expected,
    );
  });

  it('initBattleState seeds membersInRotation from the supplied rotation', () => {
    const mA = member('a', plainChar({ id: 'p1' }), 0);
    const mB = member('b', plainChar({ id: 'p2' }), 1);
    const rot: TeamRotation = {
      members: [mA, mB],
      turns: [
        {
          actions: [
            { memberId: 'a', attack: meleeAttack() },
            { memberId: 'b', attack: meleeAttack() },
          ],
        },
      ],
    };
    const bs = initBattleState(rot, makeTarget());
    expect([...bs.membersInRotation].sort()).toEqual(['a', 'b']);
    expect(bs.vitruviusMarkedSources.size).toBe(0);
    expect(Object.keys(bs.helbrechtCrusadeActiveUntil).length).toBe(0);
  });

  it('exposed BattleState shape has the four fields callers depend on', () => {
    // Map mode constructs BattleState by hand (not via initBattleState) —
    // document the shape so future refactors notice if a field disappears.
    const bs = initBattleState(
      {
        members: [member('x', plainChar({ id: 'x' }), 0)],
        turns: [{ actions: [] }],
      },
      makeTarget(),
    );
    expect(bs).toHaveProperty('targetTraits');
    expect(bs).toHaveProperty('vitruviusMarkedSources');
    expect(bs).toHaveProperty('membersInRotation');
    expect(bs).toHaveProperty('helbrechtCrusadeActiveUntil');
  });
});
