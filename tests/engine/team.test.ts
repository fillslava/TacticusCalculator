import { describe, it, expect } from 'vitest';
import { resolveTeamRotation } from '../../src/engine/team';
import '../../src/engine/traits';
import type {
  Attacker,
  AttackContext,
  CatalogAbility,
  CatalogBoss,
  CatalogCharacter,
  Rarity,
  TeamMember,
  TeamPosition,
  TeamRotation,
  Target,
} from '../../src/engine/types';

// ---------------------------------------------------------------------------
// Fixtures — zero-armor boss so multipliers stay linear and ratios are
// diagnostic. Deep-HP so `turnsToKill` stays 'unreachable' unless we test
// for it explicitly.
// ---------------------------------------------------------------------------

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

function member(
  id: string,
  src: CatalogCharacter,
  position: TeamPosition,
  rarity: Rarity = 'legendary',
): TeamMember {
  return { id, attacker: makeAttacker(src, rarity), position };
}

function meleeAttack(): AttackContext {
  return {
    profile: { label: 'Melee', damageType: 'power', hits: 2, kind: 'melee' },
    rngMode: 'expected',
  };
}

function abilityAttack(abilityId: string, cooldown = 2): AttackContext {
  return {
    profile: {
      label: abilityId,
      damageType: 'power',
      hits: 1,
      kind: 'ability',
      abilityId,
      cooldown,
    },
    rngMode: 'expected',
  };
}

// ---------------------------------------------------------------------------
// Team-buff-carrying character factories
// ---------------------------------------------------------------------------

function laviscusLike(outragePct = 120, critDmgPerContributor = 1000): CatalogCharacter {
  const passive: CatalogAbility = {
    id: 'laviscus_refusal',
    name: 'Refusal to Be Outdone',
    kind: 'passive',
    profiles: [],
    teamBuff: {
      kind: 'laviscusOutrage',
      outragePct,
      critDmgPerContributor,
    },
  };
  return plainChar({
    id: 'laviscus',
    displayName: 'Laviscus',
    faction: "Emperor's Children",
    alliance: 'Chaos',
    abilities: [passive],
  });
}

function trajannLike(
  flatDamage = 1000,
  extraHitsAdjacentToSelf = 2,
): CatalogCharacter {
  const passive: CatalogAbility = {
    id: 'trajann_lc',
    name: 'Legendary Commander',
    kind: 'passive',
    profiles: [],
    teamBuff: {
      kind: 'trajannLegendaryCommander',
      flatDamage,
      extraHitsAdjacentToSelf,
    },
  };
  return plainChar({
    id: 'trajann',
    displayName: 'Trajann',
    faction: 'Adeptus Custodes',
    alliance: 'Imperial',
    abilities: [passive],
  });
}

function biovoreLike(pct = 20): CatalogCharacter {
  const active: CatalogAbility = {
    id: 'biovore_spore_mine',
    name: 'Spore Mine',
    kind: 'active',
    profiles: [
      { label: 'Spore', damageType: 'toxic', hits: 1, kind: 'ability' },
    ],
    cooldown: 2,
    teamBuff: { kind: 'biovoreMythicAcid', pct },
  };
  return plainChar({
    id: 'biovore',
    displayName: 'Biovore',
    faction: 'Tyranids',
    alliance: 'Xenos',
    maxRarity: 'mythic',
    abilities: [active],
  });
}

/** A plain ally that carries a single simple active ability (used to fire
 *  Trajann's trigger without any irrelevant flavor). */
function allyWithActive(activeId = 'simple_active'): CatalogCharacter {
  const active: CatalogAbility = {
    id: activeId,
    name: 'Simple Active',
    kind: 'active',
    profiles: [{ label: 'A', damageType: 'power', hits: 1, kind: 'ability' }],
    cooldown: 2,
  };
  return plainChar({
    id: 'ally_active',
    displayName: 'Ally',
    abilities: [active],
  });
}

// ---------------------------------------------------------------------------
// Baseline — degenerate single-member case
// ---------------------------------------------------------------------------

describe('resolveTeamRotation — baseline', () => {
  it('single-member team produces same damage as single-attacker melee', () => {
    const m = member('a', plainChar(), 0);
    const rot: TeamRotation = {
      members: [m],
      turns: [{ actions: [{ memberId: 'a', attack: meleeAttack() }] }],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(r.perMember['a'].perAction).toHaveLength(1);
    expect(r.perMember['a'].perAction[0].result.expected).toBeGreaterThan(0);
    expect(r.cumulativeTeamExpected).toHaveLength(1);
    expect(r.cumulativeTeamExpected[0]).toBe(
      r.perMember['a'].perAction[0].result.expected,
    );
    expect(r.teamBuffApplications).toEqual([]);
    expect(r.cooldownSkips).toEqual([]);
  });

  it('cooldowns are per-member (one on CD does not block another)', () => {
    const src: CatalogCharacter = plainChar({
      abilities: [
        {
          id: 'boom',
          name: 'Boom',
          kind: 'active',
          profiles: [{ label: 'B', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 2,
        },
      ],
    });
    const m1 = member('a', src, 0);
    const m2 = member('b', src, 1);
    const rot: TeamRotation = {
      members: [m1, m2],
      turns: [
        {
          // Turn 0: both fire → both stamp cd=2.
          actions: [
            { memberId: 'a', attack: abilityAttack('boom', 2) },
            { memberId: 'b', attack: abilityAttack('boom', 2) },
          ],
        },
        {
          // Turn 1: both still on cd (tick once → 1).
          actions: [
            { memberId: 'a', attack: abilityAttack('boom', 2) },
            { memberId: 'b', attack: abilityAttack('boom', 2) },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(r.perMember['a'].perAction).toHaveLength(1);
    expect(r.perMember['b'].perAction).toHaveLength(1);
    expect(r.cooldownSkips).toEqual([
      { turnIdx: 1, memberId: 'a', abilityId: 'boom' },
      { turnIdx: 1, memberId: 'b', abilityId: 'boom' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Laviscus Outrage aura
// ---------------------------------------------------------------------------

describe('laviscusOutrage — damage aura to adjacent allies', () => {
  it('adjacent ally damage scales by 1 + outragePct/100', () => {
    const ally = plainChar({ id: 'ally' });
    const mLav = member('lav', laviscusLike(100, 0), 0);
    const mAdj = member('adj', ally, 1); // adjacent
    const rotBaseline: TeamRotation = {
      members: [member('solo', ally, 0)],
      turns: [{ actions: [{ memberId: 'solo', attack: meleeAttack() }] }],
    };
    const rotBuffed: TeamRotation = {
      members: [mLav, mAdj],
      turns: [{ actions: [{ memberId: 'adj', attack: meleeAttack() }] }],
    };
    const baseline = resolveTeamRotation(rotBaseline, makeTarget());
    const buffed = resolveTeamRotation(rotBuffed, makeTarget());
    const baseDmg = baseline.perMember['solo'].perAction[0].result.expected;
    const buffedDmg = buffed.perMember['adj'].perAction[0].result.expected;
    expect(buffedDmg / baseDmg).toBeCloseTo(2.0, 2); // 1 + 100/100 = 2.0x

    // Application recorded.
    expect(buffed.teamBuffApplications).toContainEqual(
      expect.objectContaining({
        turnIdx: 0,
        sourceMemberId: 'lav',
        kind: 'laviscusOutrage',
        appliedToMemberId: 'adj',
      }),
    );
  });

  it('non-adjacent ally gets NO outrage buff', () => {
    const ally = plainChar({ id: 'ally' });
    const mLav = member('lav', laviscusLike(100, 0), 0);
    const mFar = member('far', ally, 2); // position 2, not adjacent to 0

    const rotBaseline: TeamRotation = {
      members: [member('solo', ally, 0)],
      turns: [{ actions: [{ memberId: 'solo', attack: meleeAttack() }] }],
    };
    const rotTeamed: TeamRotation = {
      members: [mLav, mFar],
      turns: [{ actions: [{ memberId: 'far', attack: meleeAttack() }] }],
    };
    const base = resolveTeamRotation(rotBaseline, makeTarget());
    const teamed = resolveTeamRotation(rotTeamed, makeTarget());
    expect(teamed.perMember['far'].perAction[0].result.expected).toBeCloseTo(
      base.perMember['solo'].perAction[0].result.expected,
      5,
    );
    expect(
      teamed.teamBuffApplications.filter((a) => a.appliedToMemberId === 'far'),
    ).toEqual([]);
  });

  it('Laviscus himself gains +critDmg × contributors when attacking AFTER allies', () => {
    const ally = plainChar({ id: 'ally' });
    const mLav = member('lav', laviscusLike(0, 500), 1); // position 1
    const mLeft = member('l', ally, 0);
    const mRight = member('r', ally, 2);

    // Contributors attack FIRST, then Laviscus.
    const rot: TeamRotation = {
      members: [mLeft, mLav, mRight],
      turns: [
        {
          actions: [
            { memberId: 'l', attack: meleeAttack() },
            { memberId: 'r', attack: meleeAttack() },
            {
              memberId: 'lav',
              attack: {
                profile: {
                  label: 'Lav',
                  damageType: 'power',
                  hits: 1,
                  kind: 'melee',
                },
                rngMode: 'expected',
              },
            },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Laviscus's per-action entry should have a team-buff with +500×2=+1000 critDamage.
    const app = r.teamBuffApplications.find(
      (a) =>
        a.sourceMemberId === 'lav' &&
        a.appliedToMemberId === 'lav' &&
        a.kind === 'laviscusOutrage',
    );
    expect(app).toBeDefined();
    expect(app?.effect).toMatch(/\+1000 crit dmg/);
    expect(app?.effect).toMatch(/2 contributors/);
  });

  it('Laviscus does NOT get contributor bonus if he attacks FIRST', () => {
    const ally = plainChar({ id: 'ally' });
    const mLav = member('lav', laviscusLike(0, 500), 1);
    const mLeft = member('l', ally, 0);
    const mRight = member('r', ally, 2);

    // Laviscus FIRST.
    const rot: TeamRotation = {
      members: [mLeft, mLav, mRight],
      turns: [
        {
          actions: [
            {
              memberId: 'lav',
              attack: meleeAttack(),
            },
            { memberId: 'l', attack: meleeAttack() },
            { memberId: 'r', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // No self-outrage application because contributors == 0 at that moment.
    const app = r.teamBuffApplications.find(
      (a) =>
        a.sourceMemberId === 'lav' &&
        a.appliedToMemberId === 'lav' &&
        a.kind === 'laviscusOutrage',
    );
    expect(app).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Trajann LegendaryCommander
// ---------------------------------------------------------------------------

describe('trajannLegendaryCommander — conditional flat + per-member ability hits', () => {
  // -------- Flat-damage component --------

  it('flat-damage buff fires after ANY friendly uses an active (no faction gate)', () => {
    const mTra = member('tra', trajannLike(1000, 0), 0);
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mAttacker = member('x', plainChar({ id: 'x' }), 2);

    // Caster fires an active FIRST → x's subsequent melee gets +flatDamage.
    const rot: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const flatApp = r.teamBuffApplications.find(
      (a) =>
        a.sourceMemberId === 'tra' &&
        a.kind === 'trajannLegendaryCommander' &&
        a.appliedToMemberId === 'x' &&
        /flat dmg/.test(a.effect),
    );
    expect(flatApp).toBeDefined();
    expect(flatApp?.effect).toMatch(/\+1000 flat dmg/);
  });

  it('flat-damage buff does NOT fire before any friendly active', () => {
    const mTra = member('tra', trajannLike(1000, 0), 0);
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mAttacker = member('x', plainChar({ id: 'x' }), 2);

    // Order flipped: x attacks BEFORE the active fires → no flat buff on x.
    // (And the caster's own active attack also precedes any trigger.)
    const rot: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'x', attack: meleeAttack() },
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'trajannLegendaryCommander' && /flat dmg/.test(a.effect),
      ),
    ).toEqual([]);
  });

  it('no Trajann on team → no flat-damage buff even when actives fire', () => {
    const mCaster = member('c', allyWithActive('simple_active'), 0);
    const mAttacker = member('x', plainChar({ id: 'x' }), 1);
    const rot: TeamRotation = {
      members: [mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter((a) => a.kind === 'trajannLegendaryCommander'),
    ).toEqual([]);
  });

  // -------- Extra-hits component (first non-normal attack per member) --------

  it('extra hits apply on a member\'s FIRST ability attack after a friendly active', () => {
    // Trajann fires his own active (arming the trigger), then attacker fires
    // an ability — which should get +extraHits.
    const mTra = member('tra', trajannLike(0, 2), 0);
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const xSrc = plainChar({
      id: 'x',
      abilities: [
        {
          id: 'x_active',
          name: 'X Active',
          kind: 'active',
          profiles: [{ label: 'X', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 3,
        },
      ],
    });
    const mAttacker = member('x', xSrc, 2);

    // Baseline: same ability without Trajann present.
    const rotBase: TeamRotation = {
      members: [mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: abilityAttack('x_active', 3) },
          ],
        },
      ],
    };
    const rotBuffed: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: abilityAttack('x_active', 3) },
          ],
        },
      ],
    };

    const baseR = resolveTeamRotation(rotBase, makeTarget());
    const buffedR = resolveTeamRotation(rotBuffed, makeTarget());
    // Base ability has 1 hit; +2 extra hits → 3 hits → ~3× damage.
    const ratio =
      buffedR.perMember['x'].perAction[0].result.expected /
      baseR.perMember['x'].perAction[0].result.expected;
    expect(ratio).toBeCloseTo(3.0, 1);

    // Application recorded.
    expect(buffedR.teamBuffApplications).toContainEqual(
      expect.objectContaining({
        sourceMemberId: 'tra',
        kind: 'trajannLegendaryCommander',
        appliedToMemberId: 'x',
        effect: expect.stringMatching(/\+2 hits on first ability/),
      }),
    );
  });

  it('extra hits do NOT apply to a melee (normal) attack even after trigger', () => {
    const mTra = member('tra', trajannLike(0, 2), 0);
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mAttacker = member('x', plainChar({ id: 'x' }), 2);

    const rot: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // No "+X hits on first ability" application targeted at x.
    expect(
      r.teamBuffApplications.filter(
        (a) =>
          a.appliedToMemberId === 'x' &&
          a.kind === 'trajannLegendaryCommander' &&
          /hits on first ability/.test(a.effect),
      ),
    ).toEqual([]);
  });

  it('extra hits do NOT apply to a member\'s SECOND ability attack the same turn', () => {
    const mTra = member('tra', trajannLike(0, 2), 0);
    const xSrc = plainChar({
      id: 'x',
      abilities: [
        {
          id: 'x_a',
          name: 'A',
          kind: 'active',
          profiles: [{ label: 'A', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 0,
        },
        {
          id: 'x_b',
          name: 'B',
          kind: 'active',
          profiles: [{ label: 'B', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 0,
        },
      ],
    });
    const mAttacker = member('x', xSrc, 1);

    // x fires its own active first (arms friendlyActiveFiredThisTurn AFTER
    // resolving), then a second ability. Per updateTurnStateAfterAction
    // ordering, the trigger is set AFTER the first action, so the second
    // ability sees friendlyActiveFiredThisTurn = true AND is x's SECOND
    // non-normal attack → no +hits. (The first also doesn't get +hits
    // because the trigger hadn't fired yet — that's covered separately.)
    const rot: TeamRotation = {
      members: [mTra, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'x', attack: abilityAttack('x_a', 0) },
            { memberId: 'x', attack: abilityAttack('x_b', 0) },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Zero "+hits on first ability" applications targeted at x.
    expect(
      r.teamBuffApplications.filter(
        (a) =>
          a.appliedToMemberId === 'x' &&
          a.kind === 'trajannLegendaryCommander' &&
          /hits on first ability/.test(a.effect),
      ),
    ).toEqual([]);
  });

  it('extra hits do NOT apply before any friendly active fires', () => {
    // x fires an ability on turn 0 BEFORE anyone has fired an active →
    // trigger not yet armed → no +hits on x's ability.
    const mTra = member('tra', trajannLike(0, 2), 0);
    const xSrc = plainChar({
      id: 'x',
      abilities: [
        {
          id: 'x_active',
          name: 'X',
          kind: 'active',
          profiles: [{ label: 'X', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 3,
        },
      ],
    });
    const mAttacker = member('x', xSrc, 1);
    const rot: TeamRotation = {
      members: [mTra, mAttacker],
      turns: [
        {
          actions: [{ memberId: 'x', attack: abilityAttack('x_active', 3) }],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) =>
          a.appliedToMemberId === 'x' &&
          a.kind === 'trajannLegendaryCommander' &&
          /hits on first ability/.test(a.effect),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Biovore Mythic Acid
// ---------------------------------------------------------------------------

describe('biovoreMythicAcid — order-sensitive Mythic-tier bonus', () => {
  it('Mythic ally BEFORE spore mine gets NO bonus; AFTER gets +pct', () => {
    const mBio = member('bio', biovoreLike(50), 0, 'mythic');
    const mMyth = member('m', plainChar({ id: 'myth', maxRarity: 'mythic' }), 1, 'mythic');
    const rot: TeamRotation = {
      members: [mBio, mMyth],
      turns: [
        {
          // Mythic attacks FIRST (no spore mine yet), then Biovore, then
          // Mythic again (now spore mine has hit).
          actions: [
            { memberId: 'm', attack: meleeAttack() },
            { memberId: 'bio', attack: abilityAttack('biovore_spore_mine', 99) },
            { memberId: 'm', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const mythActions = r.perMember['m'].perAction;
    expect(mythActions).toHaveLength(2);
    // The second attack should be 1.5x the first (50% bonus).
    const ratio = mythActions[1].result.expected / mythActions[0].result.expected;
    expect(ratio).toBeCloseTo(1.5, 2);
  });

  it('non-Mythic ally gets NO bonus even after spore mine', () => {
    const mBio = member('bio', biovoreLike(50), 0, 'mythic');
    const legendary = member('leg', plainChar({ id: 'leg' }), 1, 'legendary');
    const rot: TeamRotation = {
      members: [mBio, legendary],
      turns: [
        {
          actions: [
            { memberId: 'bio', attack: abilityAttack('biovore_spore_mine', 99) },
            { memberId: 'leg', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'biovoreMythicAcid' && a.appliedToMemberId === 'leg',
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Team-level state bookkeeping
// ---------------------------------------------------------------------------

describe('resolveTeamRotation — bookkeeping', () => {
  it('cumulativeTeamExpected monotonically increases', () => {
    const rot: TeamRotation = {
      members: [member('a', plainChar(), 0)],
      turns: [
        { actions: [{ memberId: 'a', attack: meleeAttack() }] },
        { actions: [{ memberId: 'a', attack: meleeAttack() }] },
        { actions: [{ memberId: 'a', attack: meleeAttack() }] },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(r.cumulativeTeamExpected).toHaveLength(3);
    expect(r.cumulativeTeamExpected[1]).toBeGreaterThan(r.cumulativeTeamExpected[0]);
    expect(r.cumulativeTeamExpected[2]).toBeGreaterThan(r.cumulativeTeamExpected[1]);
  });

  it('turnsToKill is turn-index + 1 when HP reaches 0', () => {
    const tinyBoss: CatalogBoss = {
      id: 'tiny',
      displayName: 'Tiny',
      stages: [{ name: 'only', hp: 10, armor: 0, traits: [] }],
    };
    const tiny: Target = { source: tinyBoss, stageIndex: 0 };
    const rot: TeamRotation = {
      members: [member('a', plainChar(), 0)],
      turns: [
        { actions: [{ memberId: 'a', attack: meleeAttack() }] },
        { actions: [{ memberId: 'a', attack: meleeAttack() }] },
      ],
    };
    const r = resolveTeamRotation(rot, tiny);
    expect(r.turnsToKill).toBe(1);
  });

  it('unknown memberId in action is ignored, not crashed', () => {
    const rot: TeamRotation = {
      members: [member('a', plainChar(), 0)],
      turns: [
        {
          actions: [
            { memberId: 'missing', attack: meleeAttack() },
            { memberId: 'a', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(r.perMember['a'].perAction).toHaveLength(1);
  });

  it('triggered passives fire per-member and land in perAction + triggeredFires', () => {
    const passive: CatalogAbility = {
      id: 'proc',
      name: 'Proc',
      kind: 'passive',
      profiles: [{ label: 'P', damageType: 'power', hits: 1, kind: 'ability' }],
      trigger: { kind: 'afterOwnNormalAttack' },
    };
    const src = plainChar({ abilities: [passive] });
    const rot: TeamRotation = {
      members: [member('a', src, 0)],
      turns: [{ actions: [{ memberId: 'a', attack: meleeAttack() }] }],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // 1 scheduled + 1 triggered = 2 entries.
    expect(r.perMember['a'].perAction).toHaveLength(2);
    expect(r.perMember['a'].triggeredFires).toEqual([
      { turnIdx: 0, abilityId: 'proc', profileIdx: 0 },
    ]);
  });
});
