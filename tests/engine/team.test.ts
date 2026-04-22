import { describe, it, expect } from 'vitest';
import { getCharacter } from '../../src/data/catalog';
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
  stars = 0,
  abilityLevels?: { id: string; level: number }[],
): Attacker {
  return {
    source: src,
    progression: { stars, rank: 0, xpLevel: 1, rarity },
    equipment: [],
    abilityLevels,
  };
}

function member(
  id: string,
  src: CatalogCharacter,
  position: TeamPosition,
  rarity: Rarity = 'legendary',
  stars = 0,
  abilityLevels?: { id: string; level: number }[],
): TeamMember {
  return {
    id,
    attacker: makeAttacker(src, rarity, stars, abilityLevels),
    position,
  };
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

function laviscusLike(
  outragePctOfOutrage = 120,
  critDmgPerChaosContributor = 1000,
): CatalogCharacter {
  const passive: CatalogAbility = {
    id: 'laviscus_refusal',
    name: 'Refusal to Be Outdone',
    kind: 'passive',
    profiles: [],
    teamBuff: {
      kind: 'laviscusOutrage',
      outragePctOfOutrage,
      critDmgPerChaosContributor,
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

/**
 * Trajann-shaped fixture. Accepts either a scalar (uniform across all levels)
 * or a full per-level array. Scalars expand to a single-entry array so tests
 * that don't care about level scaling remain terse. Tests that exercise
 * level-scaling pass an explicit array and pair it with an `abilityLevels`
 * entry when constructing the member.
 */
function trajannLike(
  flatDamageByLevel: number | number[] = 1000,
  extraHitsByLevel: number | number[] = 2,
): CatalogCharacter {
  const flats = Array.isArray(flatDamageByLevel)
    ? flatDamageByLevel
    : [flatDamageByLevel];
  const hits = Array.isArray(extraHitsByLevel)
    ? extraHitsByLevel
    : [extraHitsByLevel];
  const passive: CatalogAbility = {
    id: 'trajann_lc',
    name: 'Legendary Commander',
    kind: 'passive',
    profiles: [],
    teamBuff: {
      kind: 'trajannLegendaryCommander',
      flatDamageByLevel: flats,
      extraHitsByLevel: hits,
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

/**
 * Default to a uniform pctByStar array so existing star-agnostic tests keep
 * working regardless of Biovore's progression ordinal. Explicit star-scaling
 * tests pass their own array.
 *
 * Real catalogs put the teamBuff on a PASSIVE with no profiles — the engine
 * must not match by abilityId. This fixture mirrors that shape to catch
 * future regressions. The Spore Mine attack is a separate active with no
 * teamBuff.
 */
function biovoreLike(pct: number | number[] = 20): CatalogCharacter {
  const pctByStar = Array.isArray(pct) ? pct : [pct, pct, pct, pct];
  const passive: CatalogAbility = {
    id: 'biovore_hyper_corrosive_acid',
    name: 'Hyper-Corrosive Acid',
    kind: 'passive',
    profiles: [],
    teamBuff: { kind: 'biovoreMythicAcid', pctByStar },
  };
  const active: CatalogAbility = {
    id: 'biovore_spore_mine',
    name: 'Spore Mine',
    kind: 'active',
    profiles: [
      { label: 'Spore', damageType: 'toxic', hits: 1, kind: 'ability' },
    ],
    cooldown: 2,
  };
  return plainChar({
    id: 'biovore',
    displayName: 'Biovore',
    faction: 'Tyranids',
    alliance: 'Xenos',
    maxRarity: 'mythic',
    abilities: [passive, active],
  });
}

/**
 * Vitruvius-shaped fixture for the Master Annihilator tests. Passive holds
 * the teamBuff; no profiles. `capByLevel` defaults to a flat 1000 so every
 * level resolves to the same cap in tests that don't exercise leveling.
 */
function vitruviusLike(capByLevel: number[] = [1000, 1000, 1000]): CatalogCharacter {
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
// Laviscus Outrage (self-buff powered by friendly non-psychic hits)
// ---------------------------------------------------------------------------

/** Imperial ally — still contributes to Outrage accumulation but is NOT
 *  Chaos, so no crit-damage bonus. */
function imperialAlly(id = 'imp'): CatalogCharacter {
  return plainChar({ id, alliance: 'Imperial' });
}

/** A plain Chaos ally (contributes to Outrage AND counts for Chaos crit). */
function chaosAlly(id = 'chaos'): CatalogCharacter {
  return plainChar({ id, alliance: 'Chaos' });
}

/** Laviscus as a melee attacker (he has a 1-hit melee profile). */
function lavMelee(): AttackContext {
  return {
    profile: {
      label: 'Lav melee',
      damageType: 'power',
      hits: 1,
      kind: 'melee',
    },
    rngMode: 'expected',
  };
}
/** Laviscus as an ability attacker. */
function lavAbility(abilityId = 'lav_ability'): AttackContext {
  return {
    profile: {
      label: 'Lav ability',
      damageType: 'power',
      hits: 1,
      kind: 'ability',
      abilityId,
      cooldown: 1,
    },
    rngMode: 'expected',
  };
}
/** A psychic attack context (for contribution-exclusion tests). */
function psychicAttack(): AttackContext {
  return {
    profile: { label: 'Mind', damageType: 'psychic', hits: 1, kind: 'ability', abilityId: 'mind', cooldown: 1 },
    rngMode: 'expected',
  };
}

describe('laviscusOutrage — self-buff from friendly non-psychic contributions', () => {
  // Laviscus doesn't carry a normal-attack ability on the simple fixture;
  // give him both a melee and a cheap ability via an attacker with matching
  // ability entries where needed. The `lavAbility` helper supplies the
  // active id.

  it('Chaos contributor → Laviscus gets +% Outrage flat dmg AND +crit on normal attack', () => {
    const mLav = member('lav', laviscusLike(120, 500), 1);
    const mContrib = member('c', chaosAlly('chaos1'), 0);
    const rot: TeamRotation = {
      members: [mContrib, mLav],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: meleeAttack() },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());

    // Flat-dmg buff recorded.
    const flatApp = r.teamBuffApplications.find(
      (a) =>
        a.sourceMemberId === 'lav' &&
        a.kind === 'laviscusOutrage' &&
        a.appliedToMemberId === 'lav' &&
        /flat dmg/.test(a.effect),
    );
    expect(flatApp).toBeDefined();
    expect(flatApp?.effect).toMatch(/120% of/);
    expect(flatApp?.effect).toMatch(/Outrage/);

    // Crit-dmg buff recorded (normal attack + Chaos contributor).
    const critApp = r.teamBuffApplications.find(
      (a) =>
        a.sourceMemberId === 'lav' &&
        a.kind === 'laviscusOutrage' &&
        a.appliedToMemberId === 'lav' &&
        /crit dmg/.test(a.effect),
    );
    expect(critApp).toBeDefined();
    expect(critApp?.effect).toMatch(/\+500 crit dmg/);
    expect(critApp?.effect).toMatch(/1 Chaos contributor/);
  });

  it('Non-Chaos contributor → flat dmg applies, but NO Chaos-crit bonus', () => {
    const mLav = member('lav', laviscusLike(120, 500), 1);
    const mImperial = member('i', imperialAlly('imp1'), 0);
    const rot: TeamRotation = {
      members: [mImperial, mLav],
      turns: [
        {
          actions: [
            { memberId: 'i', attack: meleeAttack() },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());

    // Flat-dmg buff yes.
    expect(
      r.teamBuffApplications.some(
        (a) =>
          a.kind === 'laviscusOutrage' &&
          a.appliedToMemberId === 'lav' &&
          /flat dmg/.test(a.effect),
      ),
    ).toBe(true);

    // Crit-dmg buff no (Imperial doesn't count as Chaos contributor).
    expect(
      r.teamBuffApplications.some(
        (a) =>
          a.kind === 'laviscusOutrage' &&
          a.appliedToMemberId === 'lav' &&
          /crit dmg/.test(a.effect),
      ),
    ).toBe(false);
  });

  it('Psychic hits do NOT contribute to Outrage (no flat-dmg buff)', () => {
    // Contributor fires a psychic ability before Laviscus attacks.
    const psychicSrc = plainChar({
      id: 'psy',
      alliance: 'Chaos',
      abilities: [
        {
          id: 'mind',
          name: 'Mind',
          kind: 'active',
          profiles: [
            { label: 'Mind', damageType: 'psychic', hits: 1, kind: 'ability', abilityId: 'mind' },
          ],
          cooldown: 1,
        },
      ],
    });
    const mLav = member('lav', laviscusLike(120, 500), 1);
    const mPsy = member('p', psychicSrc, 0);
    const rot: TeamRotation = {
      members: [mPsy, mLav],
      turns: [
        {
          actions: [
            { memberId: 'p', attack: psychicAttack() },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'laviscusOutrage' && a.appliedToMemberId === 'lav',
      ),
    ).toEqual([]);
  });

  it('Ability attack by Laviscus gets flat-dmg buff but NO crit buff (normal-only)', () => {
    // Give Laviscus a 1-hit ability so we can have him fire one.
    const lavSrc = laviscusLike(120, 500);
    lavSrc.abilities.push({
      id: 'lav_ability',
      name: 'Lav Ability',
      kind: 'active',
      profiles: [{ label: 'Lav A', damageType: 'power', hits: 1, kind: 'ability', abilityId: 'lav_ability' }],
      cooldown: 1,
    });
    const mLav = member('lav', lavSrc, 1);
    const mContrib = member('c', chaosAlly('chaos1'), 0);
    const rot: TeamRotation = {
      members: [mContrib, mLav],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: meleeAttack() },
            { memberId: 'lav', attack: lavAbility('lav_ability') },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Flat yes.
    expect(
      r.teamBuffApplications.some(
        (a) =>
          a.kind === 'laviscusOutrage' &&
          a.appliedToMemberId === 'lav' &&
          /flat dmg/.test(a.effect),
      ),
    ).toBe(true);
    // Crit no (ability, not normal).
    expect(
      r.teamBuffApplications.some(
        (a) =>
          a.kind === 'laviscusOutrage' &&
          a.appliedToMemberId === 'lav' &&
          /crit dmg/.test(a.effect),
      ),
    ).toBe(false);
  });

  it('Laviscus going FIRST gets no buffs (Outrage not yet accumulated)', () => {
    const mLav = member('lav', laviscusLike(120, 500), 1);
    const mContrib = member('c', chaosAlly('chaos1'), 0);
    const rot: TeamRotation = {
      members: [mContrib, mLav],
      turns: [
        {
          actions: [
            { memberId: 'lav', attack: lavMelee() },
            { memberId: 'c', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'laviscusOutrage' && a.appliedToMemberId === 'lav',
      ),
    ).toEqual([]);
  });

  it('Laviscus normal attack RESETS Outrage (no buff on second normal attack)', () => {
    // Three-action turn: Chaos attacks → Laviscus normal (gets buffs +
    // resets) → Chaos attacks again → Laviscus normal again should see
    // no Outrage because the reset flag blocks further contributions.
    const lavSrc = laviscusLike(120, 500);
    const mLav = member('lav', lavSrc, 1);
    const mContrib = member('c', chaosAlly('chaos1'), 0);
    const rot: TeamRotation = {
      members: [mContrib, mLav],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: meleeAttack() },
            { memberId: 'lav', attack: lavMelee() },
            { memberId: 'c', attack: meleeAttack() },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Laviscus has two actions resolved. First should have a flat-dmg
    // application, second should have ZERO outrage applications.
    const flatApps = r.teamBuffApplications.filter(
      (a) =>
        a.kind === 'laviscusOutrage' &&
        a.appliedToMemberId === 'lav' &&
        /flat dmg/.test(a.effect),
    );
    expect(flatApps).toHaveLength(1);
  });

  it('Laviscus ability does NOT reset Outrage (subsequent normal still buffed)', () => {
    const lavSrc = laviscusLike(120, 500);
    lavSrc.abilities.push({
      id: 'lav_ability',
      name: 'Lav Ability',
      kind: 'active',
      profiles: [{ label: 'Lav A', damageType: 'power', hits: 1, kind: 'ability', abilityId: 'lav_ability' }],
      cooldown: 0,
    });
    const mLav = member('lav', lavSrc, 1);
    const mContrib = member('c', chaosAlly('chaos1'), 0);
    // Chaos attacks → Laviscus ABILITY (no reset) → Laviscus NORMAL
    // should still see the Outrage.
    const rot: TeamRotation = {
      members: [mContrib, mLav],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: meleeAttack() },
            { memberId: 'lav', attack: lavAbility('lav_ability') },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Laviscus should have 2 flat-dmg applications (one for the ability,
    // one for the normal) — Outrage persists through his own ability.
    const flatApps = r.teamBuffApplications.filter(
      (a) =>
        a.kind === 'laviscusOutrage' &&
        a.appliedToMemberId === 'lav' &&
        /flat dmg/.test(a.effect),
    );
    expect(flatApps).toHaveLength(2);
    // Crit application only on the normal attack (Chaos contributor + normal).
    const critApps = r.teamBuffApplications.filter(
      (a) =>
        a.kind === 'laviscusOutrage' &&
        a.appliedToMemberId === 'lav' &&
        /crit dmg/.test(a.effect),
    );
    expect(critApps).toHaveLength(1);
  });

  it('Multiple contributors: Chaos count reflects only Chaos (not total contributors)', () => {
    const lavSrc = laviscusLike(0, 500); // flat=0 to isolate crit side
    const mLav = member('lav', lavSrc, 1);
    const mChaos = member('c', chaosAlly('chaos1'), 0);
    const mImp = member('i', imperialAlly('imp1'), 2);
    const rot: TeamRotation = {
      members: [mChaos, mLav, mImp],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: meleeAttack() },
            { memberId: 'i', attack: meleeAttack() },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const critApp = r.teamBuffApplications.find(
      (a) =>
        a.kind === 'laviscusOutrage' &&
        a.appliedToMemberId === 'lav' &&
        /crit dmg/.test(a.effect),
    );
    expect(critApp).toBeDefined();
    // 1 Chaos contributor × 500 = +500.
    expect(critApp?.effect).toMatch(/\+500 crit dmg/);
    expect(critApp?.effect).toMatch(/1 Chaos contributor/);
  });

  it('Per-contributor tracking is MAX, not SUM (two identical attacks = one attack)', () => {
    // If the ledger summed per-contributor attacks, attacking twice would
    // double Outrage. The mechanic says "equal to the highest damage" so
    // per-contributor we keep a running MAX.
    const lavSrc = laviscusLike(120, 0); // isolate flat side
    const mLav = member('lav', lavSrc, 1);
    const mContrib = member('c', chaosAlly('chaos1'), 0);
    const rotTwice: TeamRotation = {
      members: [mContrib, mLav],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: meleeAttack() },
            { memberId: 'c', attack: meleeAttack() }, // identical repeat
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const rotOnce: TeamRotation = {
      members: [mContrib, mLav],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: meleeAttack() },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const rTwice = resolveTeamRotation(rotTwice, makeTarget());
    const rOnce = resolveTeamRotation(rotOnce, makeTarget());
    const flatTwice = rTwice.teamBuffApplications.find(
      (a) =>
        a.kind === 'laviscusOutrage' &&
        a.appliedToMemberId === 'lav' &&
        /flat dmg/.test(a.effect),
    );
    const flatOnce = rOnce.teamBuffApplications.find(
      (a) =>
        a.kind === 'laviscusOutrage' &&
        a.appliedToMemberId === 'lav' &&
        /flat dmg/.test(a.effect),
    );
    // Max tracking → both runs yield the same Outrage and same flat buff.
    expect(flatTwice?.effect).toBe(flatOnce?.effect);
  });

  it('Outrage SUMS across multiple contributors (each contributes their own max)', () => {
    // Two different Chaos allies attack, each with their own melee. The
    // ledger keeps each's max and sums them. Compare against a single
    // contributor: two-contributor Outrage should be > one-contributor.
    const lavSrc = laviscusLike(120, 0);
    const mLav = member('lav', lavSrc, 2);
    const mC1 = member('c1', chaosAlly('ca1'), 0);
    const mC2 = member('c2', chaosAlly('ca2'), 1);
    const rotTwo: TeamRotation = {
      members: [mC1, mC2, mLav],
      turns: [
        {
          actions: [
            { memberId: 'c1', attack: meleeAttack() },
            { memberId: 'c2', attack: meleeAttack() },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const rotOne: TeamRotation = {
      members: [mC1, mLav],
      turns: [
        {
          actions: [
            { memberId: 'c1', attack: meleeAttack() },
            { memberId: 'lav', attack: lavMelee() },
          ],
        },
      ],
    };
    const rTwo = resolveTeamRotation(rotTwo, makeTarget());
    const rOne = resolveTeamRotation(rotOne, makeTarget());
    // Extract numeric Outrage from effect string: "120% of N Outrage".
    const outrageFrom = (effect: string | undefined): number => {
      const m = effect?.match(/of (\d+) Outrage/);
      return m ? Number(m[1]) : 0;
    };
    const outrageTwo = outrageFrom(
      rTwo.teamBuffApplications.find(
        (a) => a.appliedToMemberId === 'lav' && /flat dmg/.test(a.effect),
      )?.effect,
    );
    const outrageOne = outrageFrom(
      rOne.teamBuffApplications.find(
        (a) => a.appliedToMemberId === 'lav' && /flat dmg/.test(a.effect),
      )?.effect,
    );
    // Two contributors sum → roughly double one contributor's Outrage.
    expect(outrageTwo).toBeCloseTo(outrageOne * 2, 0);
  });

  it('Laviscus does NOT contribute to his own Outrage', () => {
    // Solo Laviscus attacks with his own melee → no Outrage application.
    const mLav = member('lav', laviscusLike(120, 500), 0);
    const rot: TeamRotation = {
      members: [mLav],
      turns: [{ actions: [{ memberId: 'lav', attack: lavMelee() }] }],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'laviscusOutrage' && a.appliedToMemberId === 'lav',
      ),
    ).toEqual([]);
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

    // Trajann is scheduled in the rotation so his presence gate
    // (membersInRotation) passes. Caster fires an active, then x melees and
    // receives +flatDamage. The presence gate is what prevents an absent
    // Trajann from granting buffs (see "Trajann on team but not scheduled"
    // regression test below); ordering within the turn no longer matters.
    const rot: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
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

    // Trajann is in the rotation so the presence gate passes, but the active
    // hasn't fired yet when x attacks → no flat buff on x. Isolates the
    // "active must fire first" ordering from the Trajann-present gate.
    const rot: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
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
    // Trajann is in the rotation so the presence gate (membersInRotation)
    // passes. Caster fires active (arming the trigger), then x fires an
    // ability — which should get +extraHits.
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
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: abilityAttack('x_active', 3) },
          ],
        },
      ],
    };

    const baseR = resolveTeamRotation(rotBase, makeTarget());
    const buffedR = resolveTeamRotation(rotBuffed, makeTarget());
    // x is the only action in rotBase; in rotBuffed Trajann melees first,
    // caster fires second, x fires third → x's entry is index 0 in its own
    // perAction list because per-member lists only track that member.
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

    // Trajann is in the rotation (presence gate passes), caster fires
    // active (trigger armed), x melees. The +hits should NOT apply because
    // the attack is a normal (melee), not an ability.
    const rot: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
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

    // Trajann is in the rotation (presence gate). Then x fires its own active
    // (arms friendlyActiveFiredThisTurn AFTER resolving), then a second
    // ability. Per updateTurnStateAfterAction ordering, the trigger is set
    // AFTER the first action, so the second ability sees
    // friendlyActiveFiredThisTurn = true AND is x's SECOND non-normal attack
    // → no +hits. (The first also doesn't get +hits because the trigger
    // hadn't fired yet — that's covered separately.)
    const rot: TeamRotation = {
      members: [mTra, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
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
    // Trajann is in the rotation (presence gate passes) but no friendly
    // active has fired yet when x fires his ability → trigger not armed →
    // no +hits. Isolates the "active must fire first" ordering from the
    // Trajann-present gate.
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
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'x', attack: abilityAttack('x_active', 3) },
          ],
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

  // -------- membersInRotation gate (presence) --------

  it('Trajann on team but NOT scheduled → NO flat-damage buff even after friendly active', () => {
    // Regression for user feedback: "trajan is not selected (maybe we want to
    // imitate that he is already dead), but his buff still added. His buff
    // should be counted once he has been added to the turn." Trajann is on
    // the roster but the rotation never schedules him → membersInRotation
    // never includes 'tra' → no flat buff on x even though c fires an active.
    const mTra = member('tra', trajannLike(1000, 0), 0);
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
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'trajannLegendaryCommander',
      ),
    ).toEqual([]);
  });

  it('Trajann on team but NOT scheduled → NO extra-hits buff on friendly ability', () => {
    // Same presence gate, different buff component: extra hits on first
    // ability also require Trajann to be scheduled somewhere in the rotation.
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
    const rot: TeamRotation = {
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
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'trajannLegendaryCommander',
      ),
    ).toEqual([]);
  });

  it('Trajann sits out turn 0 but is scheduled for turn 1 → buff applies on BOTH turns', () => {
    // Regression for user feedback: "When Trajann is selected in team
    // rotation, doesnt matter in which order. He gives buff to characters."
    // The presence gate (membersInRotation) is computed once from the whole
    // rotation, so scheduling Trajann anywhere — even on a later turn —
    // counts him as present on the battlefield for every turn. Two distinct
    // actives avoid the caster's cooldown blocking turn 1.
    const casterSrc = plainChar({
      id: 'two_active_caster',
      abilities: [
        {
          id: 'active_t0',
          name: 'T0',
          kind: 'active',
          profiles: [{ label: 'T0', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 2,
        },
        {
          id: 'active_t1',
          name: 'T1',
          kind: 'active',
          profiles: [{ label: 'T1', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 2,
        },
      ],
    });
    const mTra = member('tra', trajannLike(1000, 0), 0);
    const mCaster = member('c', casterSrc, 1);
    const mAttacker = member('x', plainChar({ id: 'x' }), 2);
    const rot: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: abilityAttack('active_t0', 2) },
            { memberId: 'x', attack: meleeAttack() },
          ],
        },
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'c', attack: abilityAttack('active_t1', 2) },
            { memberId: 'x', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'trajannLegendaryCommander' && /flat dmg/.test(a.effect),
    );
    // Both turns see the flat buff: turn 0 fires once (x after c), turn 1
    // fires once (x after c — Trajann melees first but is not a recipient
    // of his own buff on a normal melee).
    expect(apps).toHaveLength(2);
    expect(apps.map((a) => a.turnIdx).sort()).toEqual([0, 1]);
  });

  it('Trajann scheduled LAST in the turn → earlier friends still get his buff (order-independent)', () => {
    // Direct regression for the user's screenshot: with #1 MoW active, #2
    // Kharn melee, #3 Kariyan ability, #4 Trajann melee, the earlier
    // friends reported no Trajann buff because the old gate required
    // Trajann to have acted BEFORE the attack being buffed. New semantics:
    // Trajann merely being in the rotation is enough.
    //
    // Here: c fires an active first (arms trigger), then x melees (should
    // receive +flat), then Trajann melees at the END. Old code: no buff
    // (membersWhoActed lacks 'tra' when x attacks). New code: buff applies.
    const mCaster = member('c', allyWithActive('simple_active'), 0);
    const mAttacker = member('x', plainChar({ id: 'x' }), 1);
    const mTra = member('tra', trajannLike(1000, 0), 2);
    const rot: TeamRotation = {
      members: [mCaster, mAttacker, mTra],
      turns: [
        {
          actions: [
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: meleeAttack() },
            { memberId: 'tra', attack: meleeAttack() },
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

  // -------- Character-only active gate --------

  it('MoW firing an active does NOT arm Trajann\'s trigger (Characters only)', () => {
    // Trajann's passive text is "after a Character uses an active" — MoWs
    // fire "active" abilities too (Biovore's Spore Mines, Exorcist's Salvo,
    // etc.) but they don't count. Set up a MoW-only active-firing situation
    // where the only ally to use an ability is a MoW; x should get NO buff.
    const mowSrc = plainChar({
      id: 'mow_char',
      traits: ['machine of war'],
      abilities: [
        {
          id: 'mow_active',
          name: 'MoW Active',
          kind: 'active',
          profiles: [{ label: 'MA', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 2,
        },
      ],
    });
    const mTra = member('tra', trajannLike(1000, 2), 0);
    const mMow = member('mw', mowSrc, 5);
    const mAttacker = member('x', plainChar({ id: 'x' }), 1);

    const rot: TeamRotation = {
      members: [mTra, mMow, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'mw', attack: abilityAttack('mow_active', 2) },
            { memberId: 'x', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'trajannLegendaryCommander',
      ),
    ).toEqual([]);
  });

  it('Character active still arms the trigger even if a MoW also acts this turn', () => {
    // Regression guard for the MoW gate: a MoW firing alongside a Character
    // must not suppress the Character-active branch. Ordering: Trajann
    // melees → MoW fires active (no effect on trigger) → Character fires
    // active (arms trigger) → x melees → expect flat buff on x.
    const mowSrc = plainChar({
      id: 'mow_char',
      traits: ['machine of war'],
      abilities: [
        {
          id: 'mow_active',
          name: 'MoW Active',
          kind: 'active',
          profiles: [{ label: 'MA', damageType: 'power', hits: 1, kind: 'ability' }],
          cooldown: 2,
        },
      ],
    });
    const mTra = member('tra', trajannLike(1000, 0), 0);
    const mMow = member('mw', mowSrc, 5);
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mAttacker = member('x', plainChar({ id: 'x' }), 2);

    const rot: TeamRotation = {
      members: [mTra, mMow, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'mw', attack: abilityAttack('mow_active', 2) },
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const flatApp = r.teamBuffApplications.find(
      (a) =>
        a.kind === 'trajannLegendaryCommander' &&
        a.appliedToMemberId === 'x' &&
        /flat dmg/.test(a.effect),
    );
    expect(flatApp).toBeDefined();
    expect(flatApp?.effect).toMatch(/\+1000 flat dmg/);
  });

  // -------- Level scaling (flatDamageByLevel / extraHitsByLevel) --------

  it('flatDamageByLevel picks the per-level value from the passive\'s ability level', () => {
    // Trajann at L50 uses flatDamageByLevel[49] = 1096 (wiki anchor for
    // Legendary cap). Bumping the passive's abilityLevels entry to 60
    // clamps to flatDamageByLevel[59] = 1436 (Mythic cap).
    const flatCurve = [
      // Only the indices we care about need accurate values; fill the rest
      // so the array is long enough. 60 entries.
      ...Array.from({ length: 49 }, (_, i) => 100 + i * 10), // L1..L49 placeholders
      1096, // L50
      ...Array.from({ length: 9 }, (_, i) => 1100 + i * 10), // L51..L59
      1436, // L60
    ];
    expect(flatCurve).toHaveLength(60);
    expect(flatCurve[49]).toBe(1096);
    expect(flatCurve[59]).toBe(1436);

    const makeTra = (passiveLevel: number) =>
      member(
        'tra',
        trajannLike(flatCurve, [0]), // extraHits 0 to isolate flat-damage side
        0,
        'legendary',
        0,
        [{ id: 'trajann_lc', level: passiveLevel }],
      );
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mAttacker = member('x', plainChar({ id: 'x' }), 2);

    const runAt = (passiveLevel: number) => {
      const rot: TeamRotation = {
        members: [makeTra(passiveLevel), mCaster, mAttacker],
        turns: [
          {
            actions: [
              { memberId: 'tra', attack: meleeAttack() },
              { memberId: 'c', attack: abilityAttack('simple_active', 2) },
              { memberId: 'x', attack: meleeAttack() },
            ],
          },
        ],
      };
      return resolveTeamRotation(rot, makeTarget());
    };

    const r50 = runAt(50);
    const r60 = runAt(60);
    const flat50 = r50.teamBuffApplications.find(
      (a) => a.kind === 'trajannLegendaryCommander' && a.appliedToMemberId === 'x',
    );
    const flat60 = r60.teamBuffApplications.find(
      (a) => a.kind === 'trajannLegendaryCommander' && a.appliedToMemberId === 'x',
    );
    expect(flat50?.effect).toMatch(/\+1096 flat dmg/);
    expect(flat50?.effect).toContain('L50');
    expect(flat60?.effect).toMatch(/\+1436 flat dmg/);
    expect(flat60?.effect).toContain('L60');
  });

  it('extraHitsByLevel scales with level (L1 = 1 hit, L27 = 2 hits)', () => {
    // Real Trajann curve: L1..L26 grant +1 hit, L27+ grant +2 hits. Use a
    // synthetic curve that mirrors the rarity-tier jump exactly.
    const hitsCurve = [
      ...Array.from({ length: 26 }, () => 1), // L1..L26 = 1
      ...Array.from({ length: 34 }, () => 2), // L27..L60 = 2
    ];
    expect(hitsCurve[0]).toBe(1);
    expect(hitsCurve[25]).toBe(1);
    expect(hitsCurve[26]).toBe(2);
    expect(hitsCurve[59]).toBe(2);

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
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mAttacker = member('x', xSrc, 2);

    const runAt = (passiveLevel: number) => {
      const mTra = member(
        'tra',
        trajannLike([0], hitsCurve), // flat 0 to isolate hits side
        0,
        'legendary',
        0,
        [{ id: 'trajann_lc', level: passiveLevel }],
      );
      const rot: TeamRotation = {
        members: [mTra, mCaster, mAttacker],
        turns: [
          {
            actions: [
              { memberId: 'tra', attack: meleeAttack() },
              { memberId: 'c', attack: abilityAttack('simple_active', 2) },
              { memberId: 'x', attack: abilityAttack('x_active', 3) },
            ],
          },
        ],
      };
      return resolveTeamRotation(rot, makeTarget());
    };

    const rLow = runAt(1);   // +1 hit curve entry
    const rHigh = runAt(27); // +2 hit curve entry

    const hitsLow = rLow.teamBuffApplications.find(
      (a) =>
        a.kind === 'trajannLegendaryCommander' &&
        a.appliedToMemberId === 'x' &&
        /hits on first ability/.test(a.effect),
    );
    const hitsHigh = rHigh.teamBuffApplications.find(
      (a) =>
        a.kind === 'trajannLegendaryCommander' &&
        a.appliedToMemberId === 'x' &&
        /hits on first ability/.test(a.effect),
    );
    expect(hitsLow?.effect).toMatch(/\+1 hits on first ability/);
    expect(hitsLow?.effect).toContain('L1');
    expect(hitsHigh?.effect).toMatch(/\+2 hits on first ability/);
    expect(hitsHigh?.effect).toContain('L27');
  });

  it('falls back to xpLevel when trajann_lc abilityLevels entry is missing', () => {
    // Mirrors the Vitruvius Master Annihilator fallback: when an unowned
    // Trajann has no abilityLevels entry, the engine should fall back to
    // xpLevel. Matches the UI's `defaultLevel={build.xpLevel}` convention.
    const flatCurve = [100, 200, 300, 400, 500]; // L1..L5
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mAttacker = member('x', plainChar({ id: 'x' }), 2);
    // Build Trajann with xpLevel=3 but NO abilityLevels entry → engine
    // should land on flatCurve[2] = 300 and emit "L3" in the effect string.
    const mTra: TeamMember = {
      id: 'tra',
      position: 0,
      attacker: {
        source: trajannLike(flatCurve, [0]),
        progression: { stars: 0, rank: 0, xpLevel: 3, rarity: 'legendary' },
        equipment: [],
      },
    };

    const rot: TeamRotation = {
      members: [mTra, mCaster, mAttacker],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'x', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const flatApp = r.teamBuffApplications.find(
      (a) => a.kind === 'trajannLegendaryCommander' && a.appliedToMemberId === 'x',
    );
    expect(flatApp).toBeDefined();
    expect(flatApp?.effect).toMatch(/\+300 flat dmg/);
    expect(flatApp?.effect).toContain('L3');
  });

  // -------- MoW recipient gate for extra-hits --------

  it('MoW ally does NOT receive +Y extra hits (only friendly Characters do)', () => {
    // Wiki: "friendly Characters score Y additional hits". A MoW ally firing
    // an ability after the trigger is armed should NOT get +Y hits even
    // though the flat-damage clause still applies to them (flat-dmg has no
    // Character-only recipient gate — only the trigger-arming side does).
    const mowSrc = plainChar({
      id: 'mow_attacker',
      traits: ['machine of war'],
      abilities: [
        {
          id: 'mow_active_attacker',
          name: 'MoW Attacker Active',
          kind: 'active',
          profiles: [
            { label: 'MA', damageType: 'power', hits: 1, kind: 'ability' },
          ],
          cooldown: 3,
        },
      ],
    });
    const mTra = member('tra', trajannLike([1000], [2]), 0);
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mMow = member('mw', mowSrc, 5);

    // Trajann is in the rotation (presence gate passes), caster fires active
    // (trigger armed), MoW fires its active. MoW should NOT get +Y hits,
    // but SHOULD get the +X flat damage (the recipient gate only applies to
    // the hits clause).
    const rot: TeamRotation = {
      members: [mTra, mCaster, mMow],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'mw', attack: abilityAttack('mow_active_attacker', 3) },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Flat-damage buff IS recorded for MoW (no recipient gate on flat-dmg).
    const flatApp = r.teamBuffApplications.find(
      (a) =>
        a.kind === 'trajannLegendaryCommander' &&
        a.appliedToMemberId === 'mw' &&
        /flat dmg/.test(a.effect),
    );
    expect(flatApp).toBeDefined();
    // Extra-hits buff NOT recorded for MoW.
    expect(
      r.teamBuffApplications.filter(
        (a) =>
          a.kind === 'trajannLegendaryCommander' &&
          a.appliedToMemberId === 'mw' &&
          /hits on first ability/.test(a.effect),
      ),
    ).toEqual([]);
  });

  // -------- Triggered-passive re-derivation --------

  it('triggered passive ability profile receives +Y hits on its FIRST non-normal attack', () => {
    // Regression for user report: "When second hit from passive of Kariyan,
    // Ghulgortz, Kharn or even Abbadon is on i dont see feedback that they
    // get buff of extra 2 (Y) hits to their first not normal attack."
    //
    // Setup: Trajann present, ally fires active (trigger armed), Kariyan-
    // like attacker schedules a melee that triggers a passive with an
    // ability-kind profile. The triggered passive should pick up +Y hits
    // even though the scheduled melee (normal attack) didn't carry the
    // bonus — re-derivation per passive profile is what makes this work.
    const kariyanPassive: CatalogAbility = {
      id: 'kariyan_loc',
      name: 'Legacy of Combat',
      kind: 'passive',
      profiles: [
        {
          label: 'LoC',
          damageType: 'piercing',
          hits: 1,
          kind: 'ability',
          abilityId: 'kariyan_loc',
        },
      ],
      trigger: { kind: 'afterOwnFirstAttackOfTurn' },
    };
    const kariyanSrc = plainChar({
      id: 'kariyan',
      abilities: [kariyanPassive],
    });
    const mTra = member('tra', trajannLike([0], [2]), 0); // flat=0 isolates hits side
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mKar = member('k', kariyanSrc, 2);
    const rot: TeamRotation = {
      members: [mTra, mCaster, mKar],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'k', attack: meleeAttack() }, // triggers Kariyan's passive
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Application recorded against Kariyan for the triggered passive.
    const hitsApp = r.teamBuffApplications.find(
      (a) =>
        a.appliedToMemberId === 'k' &&
        a.kind === 'trajannLegendaryCommander' &&
        /hits on first ability/.test(a.effect),
    );
    expect(hitsApp).toBeDefined();
    expect(hitsApp?.effect).toMatch(/\+2 hits on first ability/);
    // The triggered-passive fire record lists the Kariyan Legacy of Combat
    // profile so the UI can cross-reference the application to the fire.
    expect(r.perMember['k'].triggeredFires).toEqual([
      { turnIdx: 0, abilityId: 'kariyan_loc', profileIdx: 0 },
    ]);
  });

  it('triggered passive with TWO ability profiles gets +Y hits only on the FIRST profile', () => {
    // Regression guard: the +Y hits bonus is per-member-per-turn, not per
    // profile. A passive with multiple ability profiles should see the
    // FIRST profile get +Y hits and subsequent profiles get 0 extra hits.
    const twoProfilePassive: CatalogAbility = {
      id: 'two_part_trigger',
      name: 'Two Part',
      kind: 'passive',
      profiles: [
        {
          label: 'P1',
          damageType: 'piercing',
          hits: 1,
          kind: 'ability',
          abilityId: 'two_part_trigger',
        },
        {
          label: 'P2',
          damageType: 'power',
          hits: 1,
          kind: 'ability',
          abilityId: 'two_part_trigger',
        },
      ],
      trigger: { kind: 'afterOwnFirstAttackOfTurn' },
    };
    const src = plainChar({ id: 'k2', abilities: [twoProfilePassive] });
    const mTra = member('tra', trajannLike([0], [2]), 0);
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mK = member('k', src, 2);
    const rot: TeamRotation = {
      members: [mTra, mCaster, mK],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'k', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Exactly one +Y hits application for k (on the first profile).
    const hitsApps = r.teamBuffApplications.filter(
      (a) =>
        a.appliedToMemberId === 'k' &&
        a.kind === 'trajannLegendaryCommander' &&
        /hits on first ability/.test(a.effect),
    );
    expect(hitsApps).toHaveLength(1);
  });

  it('triggered passive does NOT get +Y hits if the scheduled action (ability) already consumed it', () => {
    // If the scheduled action is an ability AND it's the first non-normal
    // for this member, it consumes the +Y hits bonus. A passive triggered
    // off the scheduled action should NOT re-claim the bonus.
    //
    // To reproduce: schedule an ability on 'k' that carries a passive which
    // triggers `afterOwnFirstAttackOfTurn`. The scheduled ability gets +Y
    // hits (first non-normal, armed earlier by caster); the passive fires
    // afterwards and must NOT get +Y hits too.
    const src = plainChar({
      id: 'k3',
      abilities: [
        {
          id: 'k3_active',
          name: 'K3 Active',
          kind: 'active',
          profiles: [
            { label: 'A', damageType: 'power', hits: 1, kind: 'ability' },
          ],
          cooldown: 3,
        },
        {
          id: 'k3_passive',
          name: 'K3 Passive',
          kind: 'passive',
          profiles: [
            {
              label: 'P',
              damageType: 'piercing',
              hits: 1,
              kind: 'ability',
              abilityId: 'k3_passive',
            },
          ],
          trigger: { kind: 'afterOwnFirstAttackOfTurn' },
        },
      ],
    });
    // Caster fires first (arms trigger), THEN k3 fires active (consumes +Y
    // on ability), then k3's passive triggers (should NOT re-claim +Y).
    const mTra = member('tra', trajannLike([0], [2]), 0);
    const mCaster = member('c', allyWithActive('simple_active'), 1);
    const mK = member('k', src, 2);
    const rot: TeamRotation = {
      members: [mTra, mCaster, mK],
      turns: [
        {
          actions: [
            { memberId: 'tra', attack: meleeAttack() },
            { memberId: 'c', attack: abilityAttack('simple_active', 2) },
            { memberId: 'k', attack: abilityAttack('k3_active', 3) },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // Exactly one +Y hits application for k — on the scheduled ability, NOT
    // on the triggered passive.
    const hitsApps = r.teamBuffApplications.filter(
      (a) =>
        a.appliedToMemberId === 'k' &&
        a.kind === 'trajannLegendaryCommander' &&
        /hits on first ability/.test(a.effect),
    );
    expect(hitsApps).toHaveLength(1);
  });

  // -------- Catalog alignment --------

  it('catalog Trajann flatDamageByLevel matches wiki anchors (L50=1096, L60=1436)', () => {
    // If this fails, the Trajann catalog drifted from the wiki spec. Anchors
    // from https://tacticus.wiki.gg/wiki/Trajann:
    //   L8=27 (Common cap), L17=60 (Uncommon cap), L26=148 (Rare cap),
    //   L35=314 (Epic cap), L50=1096 (Legendary cap), L60=1436 (Mythic cap).
    const tra = getCharacter('trajann');
    expect(tra).toBeDefined();
    const passive = tra!.abilities.find(
      (a) => a.teamBuff?.kind === 'trajannLegendaryCommander',
    );
    expect(passive).toBeDefined();
    const flats =
      passive!.teamBuff!.kind === 'trajannLegendaryCommander'
        ? passive!.teamBuff!.flatDamageByLevel
        : [];
    expect(flats[7]).toBe(27);
    expect(flats[16]).toBe(60);
    expect(flats[25]).toBe(148);
    expect(flats[34]).toBe(314);
    expect(flats[49]).toBe(1096);
    expect(flats[59]).toBe(1436);
  });

  it('catalog Trajann extraHitsByLevel jumps from 1 to 2 at L27 (Epic-rarity tier)', () => {
    // Wiki anchor: L1..L26 = +1 hit, L27+ = +2 hits. Matches the Epic-rarity
    // jump on the wiki's interactive scaler.
    const tra = getCharacter('trajann');
    const passive = tra!.abilities.find(
      (a) => a.teamBuff?.kind === 'trajannLegendaryCommander',
    );
    const hits =
      passive!.teamBuff!.kind === 'trajannLegendaryCommander'
        ? passive!.teamBuff!.extraHitsByLevel
        : [];
    expect(hits[0]).toBe(1);
    expect(hits[25]).toBe(1);
    expect(hits[26]).toBe(2);
    expect(hits[59]).toBe(2);
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

  it('Legendary Biovore does NOT activate Mythic Acid even though he carries the teamBuff', () => {
    // User spec: "If hero is Mythic then buff applies. Biovore needs to be
    // Mythic as well." A non-Mythic Biovore firing his ability is inert.
    const mBio = member('bio', biovoreLike(50), 0, 'legendary');
    const mMyth = member('m', plainChar({ id: 'myth', maxRarity: 'mythic' }), 1, 'mythic');
    const rot: TeamRotation = {
      members: [mBio, mMyth],
      turns: [
        {
          actions: [
            { memberId: 'bio', attack: abilityAttack('biovore_spore_mine', 99) },
            { memberId: 'm', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    expect(
      r.teamBuffApplications.filter(
        (a) => a.kind === 'biovoreMythicAcid' && a.appliedToMemberId === 'm',
      ),
    ).toEqual([]);
  });

  it('fires even when the teamBuff lives on a passive that has no own profiles', () => {
    // Regression guard: the real catalog shape puts the teamBuff on a
    // passive (profiles: []), and the ability the user fires is a separate
    // active whose id does NOT match the passive. The engine must detect
    // the teamBuff by actor identity + ability-kind, not by ability-id.
    const mBio = member('bio', biovoreLike(50), 0, 'mythic');
    const mMyth = member('m', plainChar({ id: 'myth', maxRarity: 'mythic' }), 1, 'mythic');
    const rot: TeamRotation = {
      members: [mBio, mMyth],
      turns: [
        {
          actions: [
            // Use an arbitrary active id unrelated to the teamBuff passive.
            { memberId: 'bio', attack: abilityAttack('biovore_spore_mine', 99) },
            { memberId: 'm', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'biovoreMythicAcid' && a.appliedToMemberId === 'm',
    );
    expect(apps.length).toBe(1);
  });

  it('star-scales: pctByStar[0]=10 at Mythic 1★ vs pctByStar[3]=20 at Mythic 4★', () => {
    // `progression.stars` is a cumulative starLevel across rarities, not a
    // progression ordinal. Mythic runs through starLevels 11..14 (visible
    // 12..15★), mapping to position 0..3 within Mythic via
    // `progressionPositionFromStarLevel`. So:
    //   Mythic 1★ = starLevel 11 → position 0 → pctByStar[0] = 10 → 1.10x
    //   Mythic 4★ = starLevel 14 → position 3 → pctByStar[3] = 20 → 1.20x
    const MYTHIC_1_STAR = 11;
    const MYTHIC_4_STAR = 14;
    const scaled = [10, 13, 17, 20];
    const ally = () => member('m', plainChar({ id: 'myth', maxRarity: 'mythic' }), 1, 'mythic');

    const mBioLow = member('bio', biovoreLike(scaled), 0, 'mythic', MYTHIC_1_STAR);
    const mBioHigh = member('bio', biovoreLike(scaled), 0, 'mythic', MYTHIC_4_STAR);

    const rot = (bio: TeamMember) => ({
      members: [bio, ally()],
      turns: [
        {
          actions: [
            { memberId: 'm', attack: meleeAttack() },
            { memberId: 'bio', attack: abilityAttack('biovore_spore_mine', 99) },
            { memberId: 'm', attack: meleeAttack() },
          ],
        },
      ],
    });

    const rLow = resolveTeamRotation(rot(mBioLow), makeTarget());
    const rHigh = resolveTeamRotation(rot(mBioHigh), makeTarget());
    const ratioLow = rLow.perMember['m'].perAction[1].result.expected /
      rLow.perMember['m'].perAction[0].result.expected;
    const ratioHigh = rHigh.perMember['m'].perAction[1].result.expected /
      rHigh.perMember['m'].perAction[0].result.expected;
    expect(ratioLow).toBeCloseTo(1.1, 2);
    expect(ratioHigh).toBeCloseTo(1.2, 2);
  });
});

// ---------------------------------------------------------------------------
// Vitruvius Master Annihilator
// ---------------------------------------------------------------------------

describe('vitruviusMasterAnnihilator — marking + capped bonus hit', () => {
  it('mark is set only after a normal attack; first ally attack BEFORE mark gets no bonus', () => {
    const mVit = member('v', vitruviusLike([500, 500, 500]), 0, 'mythic');
    const mAlly = member('a', plainChar({ id: 'ally2' }), 1, 'mythic');
    const rot: TeamRotation = {
      members: [mVit, mAlly],
      turns: [
        {
          actions: [
            // Ally attacks FIRST — no mark yet.
            { memberId: 'a', attack: meleeAttack() },
            // Vitruvius normal attack marks the boss.
            { memberId: 'v', attack: meleeAttack() },
            // Ally's second attack is after the mark — should gain +1 hit.
            { memberId: 'a', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const allyResults = r.perMember['a'].perAction;
    expect(allyResults).toHaveLength(2);
    // Pre-mark vs post-mark: post-mark should be strictly greater.
    expect(allyResults[1].result.expected).toBeGreaterThan(
      allyResults[0].result.expected,
    );
  });

  it('mark persists across turns (battle-level state, not turn-level)', () => {
    const mVit = member('v', vitruviusLike([500, 500, 500]), 0, 'mythic');
    const mAlly = member('a', plainChar({ id: 'ally2' }), 1, 'mythic');
    const rot: TeamRotation = {
      members: [mVit, mAlly],
      turns: [
        // Turn 1 — Vitruvius marks.
        { actions: [{ memberId: 'v', attack: meleeAttack() }] },
        // Turn 2 — ally should still benefit from the persistent mark.
        { actions: [{ memberId: 'a', attack: meleeAttack() }] },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'vitruviusMasterAnnihilator' && a.turnIdx === 1,
    );
    expect(apps.length).toBe(1);
    expect(apps[0].appliedToMemberId).toBe('a');
  });

  it('psychic attacks do NOT receive the bonus hit', () => {
    const mVit = member('v', vitruviusLike([500, 500, 500]), 0, 'mythic');
    const psychicAlly = plainChar({
      id: 'psyker',
      melee: { label: 'Mind', damageType: 'psychic', hits: 2, kind: 'melee' },
    });
    const mAlly = member('a', psychicAlly, 1, 'mythic');
    const psychicAttack: AttackContext = {
      profile: { label: 'Mind', damageType: 'psychic', hits: 2, kind: 'melee' },
      rngMode: 'expected',
    };
    const rot: TeamRotation = {
      members: [mVit, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'v', attack: meleeAttack() },
            { memberId: 'a', attack: psychicAttack },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'vitruviusMasterAnnihilator' && a.appliedToMemberId === 'a',
    );
    expect(apps).toEqual([]);
  });

  it('capByLevel clamps bonus-hit damage (level selects cap)', () => {
    // Use an ally whose damage is large enough to blow past a small cap.
    // Two Vitruvius levels produce two caps; we verify the damage delta
    // between capped and uncapped matches (cap_high - cap_low).
    const bigHitter = plainChar({
      id: 'big',
      baseStats: {
        damage: 100000,
        armor: 0,
        hp: 1000,
        critChance: 0,
        critDamage: 0,
        blockChance: 0,
        blockDamage: 0,
        meleeHits: 1,
        rangedHits: 1,
      },
      melee: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
    });
    const bigMelee: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    const vitCaps = [500, 2500];
    const passiveId = 'vitruvius_master_annihilator';

    const run = (level: number) => {
      const mVit = member(
        'v',
        vitruviusLike(vitCaps),
        0,
        'mythic',
        0,
        [{ id: passiveId, level }],
      );
      const mAlly = member('a', bigHitter, 1, 'mythic');
      const rot: TeamRotation = {
        members: [mVit, mAlly],
        turns: [
          {
            actions: [
              { memberId: 'v', attack: meleeAttack() },
              { memberId: 'a', attack: bigMelee },
            ],
          },
        ],
      };
      return resolveTeamRotation(rot, makeTarget());
    };

    const rLow = run(1); // cap 500
    const rHigh = run(2); // cap 2500

    const allyLow = rLow.perMember['a'].perAction[0].result.expected;
    const allyHigh = rHigh.perMember['a'].perAction[0].result.expected;
    // Cap difference should show up as a damage delta of (2500 - 500) = 2000.
    expect(allyHigh - allyLow).toBeCloseTo(2000, 0);
  });

  it('catalog Vitruvius capByLevel hits the wiki anchor values', () => {
    // Wiki anchors (top-of-rarity caps from https://tacticus.wiki.gg/wiki/Vitruvius):
    //   Common L8=187, Uncommon L17=410, Rare L26=1011, Epic L35=2139,
    //   Legendary L50=7477, Mythic L60=9788.
    // If this fails, the catalog value drifted from the wiki spec.
    const vit = getCharacter('vitruvius');
    expect(vit).toBeDefined();
    const passive = vit!.abilities.find(
      (a) => a.teamBuff?.kind === 'vitruviusMasterAnnihilator',
    );
    expect(passive).toBeDefined();
    const caps = passive!.teamBuff!.kind === 'vitruviusMasterAnnihilator'
      ? passive!.teamBuff!.capByLevel
      : [];
    expect(caps[7]).toBe(187);
    expect(caps[16]).toBe(410);
    expect(caps[25]).toBe(1011);
    expect(caps[34]).toBe(2139);
    expect(caps[49]).toBe(7477);
    expect(caps[59]).toBe(9788);
  });

  it('falls back to xpLevel when abilityLevels is missing (unowned heroes)', () => {
    // Regression: user reports "everybody is capped at 500" because the
    // engine was hard-coding level 1 for unowned Vitruvius. The UI default
    // for a missing per-ability entry is xpLevel, so the engine should
    // match. Here xpLevel implicitly stays at 1 (makeAttacker default) so
    // cap[0]=100; bumping xpLevel to the 3rd index should pick cap[2]=900.
    const caps = [100, 500, 900, 1500];
    const bigHitter = plainChar({
      id: 'big',
      baseStats: {
        damage: 100000, armor: 0, hp: 1000,
        critChance: 0, critDamage: 0, blockChance: 0, blockDamage: 0,
        meleeHits: 1, rangedHits: 1,
      },
      melee: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
    });
    const bigMelee: AttackContext = {
      profile: { label: 'Melee', damageType: 'power', hits: 1, kind: 'melee' },
      rngMode: 'expected',
    };
    // Build Vitruvius with xpLevel=3 but NO abilityLevels entry for the
    // passive — engine should read xpLevel and land on cap[2] = 900.
    const vit: TeamMember = {
      id: 'v',
      position: 0,
      attacker: {
        source: vitruviusLike(caps),
        progression: { stars: 0, rank: 0, xpLevel: 3, rarity: 'mythic' },
        equipment: [],
        // abilityLevels intentionally omitted
      },
    };
    const mAlly = member('a', bigHitter, 1, 'mythic');
    const rot: TeamRotation = {
      members: [vit, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'v', attack: meleeAttack() },
            { memberId: 'a', attack: bigMelee },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'vitruviusMasterAnnihilator' && a.appliedToMemberId === 'a',
    );
    expect(apps.length).toBe(1);
    // Effect string includes "L3" — meaning the engine picked xpLevel=3.
    expect(apps[0].effect).toContain('L3');
    expect(apps[0].effect).toContain('900');
  });
});

// ---------------------------------------------------------------------------
// Aesoth Stand Vigil — positional +Y% damage on non-normal attacks with
// Custodes-extended 2-hex range
// ---------------------------------------------------------------------------

/**
 * Aesoth-shaped fixture for Stand Vigil tests. Passive holds the teamBuff;
 * no profiles. Optional self-active so Aesoth herself can fire a Custodes
 * active in tests that exercise the extended-range flag via her own ability.
 * Scalar defaults keep star/level-agnostic tests terse; level-scaling tests
 * pass their own per-level arrays.
 */
function aesothLike(
  extraDmgPctByLevel: number | number[] = 20,
  extraArmorByLevel: number | number[] = 4,
  extendedRangeHexes = 2,
  withActive = true,
): CatalogCharacter {
  const pct = Array.isArray(extraDmgPctByLevel)
    ? extraDmgPctByLevel
    : [extraDmgPctByLevel];
  const armor = Array.isArray(extraArmorByLevel)
    ? extraArmorByLevel
    : [extraArmorByLevel];
  const passive: CatalogAbility = {
    id: 'aesoth_stand_vigil',
    name: 'Stand Vigil',
    kind: 'passive',
    profiles: [],
    teamBuff: {
      kind: 'aesothStandVigil',
      extraArmorByLevel: armor,
      extraDmgPctByLevel: pct,
      extendedRangeHexes,
    },
  };
  const abilities: CatalogAbility[] = [passive];
  if (withActive) {
    abilities.push({
      id: 'aesoth_vexilla_magnifica',
      name: 'Vexilla Magnifica',
      kind: 'active',
      profiles: [
        { label: 'Vexilla', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      cooldown: 2,
    });
  }
  return plainChar({
    id: 'aesoth',
    displayName: 'Aesoth',
    faction: 'Adeptus Custodes',
    alliance: 'Imperial',
    abilities,
  });
}

/** Plain ally carrying a single cheap active so it can fire an ability in
 *  Stand Vigil tests without pulling in unrelated team-buff plumbing. */
function activeAlly(id = 'ally', activeId = 'a_active'): CatalogCharacter {
  return plainChar({
    id,
    abilities: [
      {
        id: activeId,
        name: 'Active',
        kind: 'active',
        profiles: [
          { label: 'A', damageType: 'power', hits: 1, kind: 'ability' },
        ],
        cooldown: 2,
      },
    ],
  });
}

/** A Custodes-faction ally with an active — used to arm the extended-range
 *  flag without being Aesoth herself. */
function custodesActiveAlly(id = 'cust'): CatalogCharacter {
  return plainChar({
    id,
    faction: 'Adeptus Custodes',
    alliance: 'Imperial',
    abilities: [
      {
        id: 'cust_active',
        name: 'Custodes Active',
        kind: 'active',
        profiles: [
          { label: 'CA', damageType: 'power', hits: 1, kind: 'ability' },
        ],
        cooldown: 2,
      },
    ],
  });
}

/** A non-Custodes ally with an active — used to prove non-Custodes actives
 *  do NOT arm the extended-range flag. */
function nonCustodesActiveAlly(id = 'noncust'): CatalogCharacter {
  return plainChar({
    id,
    faction: 'Space Marines',
    alliance: 'Imperial',
    abilities: [
      {
        id: 'nc_active',
        name: 'Non-Custodes Active',
        kind: 'active',
        profiles: [
          { label: 'NC', damageType: 'power', hits: 1, kind: 'ability' },
        ],
        cooldown: 2,
      },
    ],
  });
}

describe('aesothStandVigil — positional +Y% damage on non-normal attacks', () => {
  it('teammate at 1 hex firing an ability gets the Stand Vigil buff', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 0);
    const mAlly = member('a', activeAlly('ally', 'a_active'), 1);
    const rot: TeamRotation = {
      members: [mAesoth, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
            // Aesoth melees to satisfy the `membersInRotation` presence gate.
            // Her normal attack doesn't arm the Custodes flag or fire Stand
            // Vigil derivation (handler gates on `kind === 'ability'`).
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil',
    );
    expect(apps).toHaveLength(1);
    expect(apps[0].sourceMemberId).toBe('aes');
    expect(apps[0].appliedToMemberId).toBe('a');
    expect(apps[0].effect).toContain('+20%');
    expect(apps[0].effect).toContain('1-hex');
    // Base range (no Custodes active fired) → no extended note.
    expect(apps[0].effect).not.toContain('Custodes extended');
  });

  it('teammate at 2 hexes WITHOUT a Custodes active receives no buff', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 0);
    const mAlly = member('a', activeAlly('ally', 'a_active'), 2);
    const rot: TeamRotation = {
      members: [mAesoth, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil',
    );
    expect(apps).toEqual([]);
  });

  it('teammate at 2 hexes WITH a Custodes active earlier this turn gets extended-range buff', () => {
    const mAesoth = member('aes', aesothLike(22, 10, 2, false), 0);
    const mCust = member('c', custodesActiveAlly('cust_src'), 1);
    const mAlly = member('a', activeAlly('ally', 'a_active'), 2);
    const rot: TeamRotation = {
      members: [mAesoth, mCust, mAlly],
      turns: [
        {
          actions: [
            // Custodes fires FIRST → arms extended-range flag.
            { memberId: 'c', attack: abilityAttack('cust_active', 2) },
            // Ally now at 2 hex but within extended 2-hex range.
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const allyApps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil' && a.appliedToMemberId === 'a',
    );
    expect(allyApps).toHaveLength(1);
    expect(allyApps[0].effect).toContain('+22%');
    expect(allyApps[0].effect).toContain('2-hex');
    expect(allyApps[0].effect).toContain('Custodes extended');
  });

  it('non-normal gate: ally melee attack does NOT receive the buff', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 0);
    const mAlly = member('a', plainChar({ id: 'ally' }), 1);
    const rot: TeamRotation = {
      members: [mAesoth, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'a', attack: meleeAttack() },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil',
    );
    expect(apps).toEqual([]);
  });

  it('non-normal gate: ally ranged attack does NOT receive the buff', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 0);
    const mAlly = member('a', plainChar({ id: 'ally' }), 1);
    const rangedAttack: AttackContext = {
      profile: {
        label: 'Ranged',
        damageType: 'bolter',
        hits: 2,
        kind: 'ranged',
      },
      rngMode: 'expected',
    };
    const rot: TeamRotation = {
      members: [mAesoth, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'a', attack: rangedAttack },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil',
    );
    expect(apps).toEqual([]);
  });

  it('Aesoth herself firing an ability does NOT receive her own buff (self-excluded)', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, true), 0);
    const rot: TeamRotation = {
      members: [mAesoth],
      turns: [
        {
          actions: [
            {
              memberId: 'aes',
              attack: abilityAttack('aesoth_vexilla_magnifica', 2),
            },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil',
    );
    expect(apps).toEqual([]);
  });

  it('MoW recipient at 1 hex IS eligible (wiki: "units", not "Characters")', () => {
    // Aesoth in slot 4, MoW in slot 5 → |Δposition|=1.
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 4);
    const mowSrc = plainChar({
      id: 'mow',
      traits: ['Machine of War'],
      abilities: [
        {
          id: 'mow_active',
          name: 'MoW Active',
          kind: 'active',
          profiles: [
            { label: 'M', damageType: 'blast', hits: 1, kind: 'ability' },
          ],
          cooldown: 2,
        },
      ],
    });
    const mMow = member('mow', mowSrc, 5);
    const rot: TeamRotation = {
      members: [mAesoth, mMow],
      turns: [
        {
          actions: [
            { memberId: 'mow', attack: abilityAttack('mow_active', 2) },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil',
    );
    expect(apps).toHaveLength(1);
    expect(apps[0].appliedToMemberId).toBe('mow');
  });

  it('non-Custodes active does NOT extend the range (stays 1 hex)', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 0);
    const mNc = member('nc', nonCustodesActiveAlly('nc_src'), 1);
    const mAlly = member('a', activeAlly('ally', 'a_active'), 2);
    const rot: TeamRotation = {
      members: [mAesoth, mNc, mAlly],
      turns: [
        {
          actions: [
            // Non-Custodes fires → flag must NOT arm.
            { memberId: 'nc', attack: abilityAttack('nc_active', 2) },
            // Ally still at 2 hex from Aesoth; base 1-hex range does not reach.
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const allyApps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil' && a.appliedToMemberId === 'a',
    );
    expect(allyApps).toEqual([]);
  });

  it('order-sensitive: ally acting BEFORE Custodes active uses base range (no extension yet)', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 0);
    // Custodes is far away (position 4) so Stand Vigil cannot self-apply to
    // the Custodes-active action; we only want it as a trigger source.
    const mCust = member('c', custodesActiveAlly('cust_src'), 4);
    const mAlly = member('a', activeAlly('ally', 'a_active'), 2);
    const rot: TeamRotation = {
      members: [mAesoth, mCust, mAlly],
      turns: [
        {
          actions: [
            // Ally acts FIRST at 2 hex — flag not yet armed.
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
            // Custodes active fires after — arms too late for ally.
            { memberId: 'c', attack: abilityAttack('cust_active', 2) },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const allyApps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil' && a.appliedToMemberId === 'a',
    );
    expect(allyApps).toEqual([]);
  });

  it('level scaling: higher passive level yields a higher % damage multiplier', () => {
    const pctByLevel = [20, 22, 25];
    const bigHitter = plainChar({
      id: 'ally',
      baseStats: {
        damage: 1000,
        armor: 0,
        hp: 1000,
        critChance: 0,
        critDamage: 0,
        blockChance: 0,
        blockDamage: 0,
        meleeHits: 1,
        rangedHits: 1,
      },
      abilities: [
        {
          id: 'a_active',
          name: 'Active',
          kind: 'active',
          profiles: [
            { label: 'A', damageType: 'power', hits: 1, kind: 'ability' },
          ],
          cooldown: 2,
        },
      ],
    });

    const run = (passiveLevel: number) => {
      const mAesoth = member(
        'aes',
        aesothLike(pctByLevel, 4, 2, false),
        0,
        'legendary',
        0,
        [{ id: 'aesoth_stand_vigil', level: passiveLevel }],
      );
      const mAlly = member('a', bigHitter, 1);
      const rot: TeamRotation = {
        members: [mAesoth, mAlly],
        turns: [
          {
            actions: [
              { memberId: 'a', attack: abilityAttack('a_active', 2) },
              { memberId: 'aes', attack: meleeAttack() },
            ],
          },
        ],
      };
      return resolveTeamRotation(rot, makeTarget());
    };

    const rLow = run(1); // pct=20
    const rHigh = run(3); // pct=25

    const allyLow = rLow.perMember['a'].perAction[0].result.expected;
    const allyHigh = rHigh.perMember['a'].perAction[0].result.expected;
    expect(allyHigh).toBeGreaterThan(allyLow);
    // The damage multiplier ratio should match the %-bump ratio (1.25 / 1.20).
    expect(allyHigh / allyLow).toBeCloseTo(1.25 / 1.2, 3);

    // Effect-string level suffix reflects the passive level.
    const appLow = rLow.teamBuffApplications.find(
      (a) => a.kind === 'aesothStandVigil',
    );
    const appHigh = rHigh.teamBuffApplications.find(
      (a) => a.kind === 'aesothStandVigil',
    );
    expect(appLow?.effect).toContain('+20%');
    expect(appLow?.effect).toContain('L1');
    expect(appHigh?.effect).toContain('+25%');
    expect(appHigh?.effect).toContain('L3');
  });

  it('Aesoth not scheduled anywhere in the rotation → no buff (membership gate)', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 0);
    const mAlly = member('a', activeAlly('ally', 'a_active'), 1);
    const rot: TeamRotation = {
      // Aesoth carries the teamBuff but is NOT in any scheduled action.
      members: [mAesoth, mAlly],
      turns: [
        {
          actions: [
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const apps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil',
    );
    expect(apps).toEqual([]);
  });

  it('Aesoth firing her OWN Custodes active arms the flag for later allies this turn', () => {
    // Aesoth's own active counts as a Custodes active → extends the aura for
    // subsequent allies. She herself is still self-excluded from the buff.
    const mAesoth = member('aes', aesothLike(20, 4, 2, true), 0);
    const mAlly = member('a', activeAlly('ally', 'a_active'), 2);
    const rot: TeamRotation = {
      members: [mAesoth, mAlly],
      turns: [
        {
          actions: [
            {
              memberId: 'aes',
              attack: abilityAttack('aesoth_vexilla_magnifica', 2),
            },
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const allyApps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil' && a.appliedToMemberId === 'a',
    );
    expect(allyApps).toHaveLength(1);
    expect(allyApps[0].effect).toContain('2-hex');
    expect(allyApps[0].effect).toContain('Custodes extended');
    // Aesoth herself never appears as a recipient.
    const selfApps = r.teamBuffApplications.filter(
      (a) => a.kind === 'aesothStandVigil' && a.appliedToMemberId === 'aes',
    );
    expect(selfApps).toEqual([]);
  });

  it('extended range does NOT carry across turns (turn-local "for 1 round")', () => {
    const mAesoth = member('aes', aesothLike(20, 4, 2, false), 0);
    const mCust = member('c', custodesActiveAlly('cust_src'), 4);
    const mAlly = member('a', activeAlly('ally', 'a_active'), 2);
    const rot: TeamRotation = {
      members: [mAesoth, mCust, mAlly],
      turns: [
        // Turn 0: Custodes arms the flag; Aesoth melees to seat presence.
        {
          actions: [
            { memberId: 'c', attack: abilityAttack('cust_active', 2) },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
        // Turn 1: ally at 2 hex fires without a new Custodes active. Flag
        // reset → base range only → no buff.
        {
          actions: [
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    const turn1Apps = r.teamBuffApplications.filter(
      (a) =>
        a.kind === 'aesothStandVigil' &&
        a.appliedToMemberId === 'a' &&
        a.turnIdx === 1,
    );
    expect(turn1Apps).toEqual([]);
  });

  it('damage multiplier is actually applied (expected damage grows by +Y%)', () => {
    // With pct=50 and an all-zero defense target, the ally's ability damage
    // under Stand Vigil must be 1.5× the damage without Stand Vigil.
    const pct = 50;
    const buildAlly = () =>
      plainChar({
        id: 'ally',
        baseStats: {
          damage: 1000,
          armor: 0,
          hp: 1000,
          critChance: 0,
          critDamage: 0,
          blockChance: 0,
          blockDamage: 0,
          meleeHits: 1,
          rangedHits: 1,
        },
        abilities: [
          {
            id: 'a_active',
            name: 'Active',
            kind: 'active',
            profiles: [
              {
                label: 'A',
                damageType: 'power',
                hits: 1,
                kind: 'ability',
              },
            ],
            cooldown: 2,
          },
        ],
      });

    // With Aesoth present (adjacent).
    const mAesoth = member('aes', aesothLike(pct, 4, 2, false), 0);
    const mAllyBuffed = member('a', buildAlly(), 1);
    const rotBuffed: TeamRotation = {
      members: [mAesoth, mAllyBuffed],
      turns: [
        {
          actions: [
            { memberId: 'a', attack: abilityAttack('a_active', 2) },
            { memberId: 'aes', attack: meleeAttack() },
          ],
        },
      ],
    };
    const rBuffed = resolveTeamRotation(rotBuffed, makeTarget());
    const buffedDmg = rBuffed.perMember['a'].perAction[0].result.expected;

    // Without Aesoth (solo).
    const mAllySolo = member('a', buildAlly(), 1);
    const rotSolo: TeamRotation = {
      members: [mAllySolo],
      turns: [
        { actions: [{ memberId: 'a', attack: abilityAttack('a_active', 2) }] },
      ],
    };
    const rSolo = resolveTeamRotation(rotSolo, makeTarget());
    const soloDmg = rSolo.perMember['a'].perAction[0].result.expected;

    expect(buffedDmg / soloDmg).toBeCloseTo(1 + pct / 100, 3);
  });

  it('catalog Aesoth Stand Vigil hits the wiki anchor values', () => {
    // Wiki anchors (https://tacticus.wiki.gg/wiki/Aesoth):
    //   extraArmourByLevel: L1=4, L50=222, L65=291
    //   extraDmgPctByLevel: L1=20, L36=25
    //   extendedRangeHexes: 2
    // If this fails, the catalog drifted from the wiki spec.
    const aes = getCharacter('aesoth');
    expect(aes).toBeDefined();
    const passive = aes!.abilities.find(
      (a) => a.teamBuff?.kind === 'aesothStandVigil',
    );
    expect(passive).toBeDefined();
    const buff = passive!.teamBuff;
    if (buff?.kind !== 'aesothStandVigil') throw new Error('wrong kind');
    expect(buff.extraArmorByLevel[0]).toBe(4);
    expect(buff.extraArmorByLevel[49]).toBe(222);
    expect(buff.extraArmorByLevel[64]).toBe(291);
    expect(buff.extraDmgPctByLevel[0]).toBe(20);
    expect(buff.extraDmgPctByLevel[35]).toBe(25);
    expect(buff.extendedRangeHexes).toBe(2);
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

// ---------------------------------------------------------------------------
// Godswyl — Champion of the Feast fires after his first normal attack each
// turn (wiki: "After moving, deals 1x X Power Damage ... If Sword Brother
// Godswyl does not move, then this ability triggers at the end of his turn").
// User-visible behaviour: a "second hit" always lands with every turn.
// ---------------------------------------------------------------------------

describe('godswyl — Champion of the Feast fires after first attack', () => {
  it('catalog entry has the afterOwnFirstAttackOfTurn trigger', () => {
    // Guards against an importer regression that would wipe the trigger
    // (see HAND_AUTHORED_ABILITY_IDS in scripts/import-gameinfo.ts).
    const gw = getCharacter('godswyl');
    expect(gw).toBeDefined();
    const passive = gw!.abilities.find(
      (a) => a.id === 'godswyl_champion_of_the_feast',
    );
    expect(passive).toBeDefined();
    expect(passive!.kind).toBe('passive');
    expect(passive!.trigger).toEqual({ kind: 'afterOwnFirstAttackOfTurn' });
  });

  it('passive fires after Godswyl\'s first melee attack of the turn', () => {
    const gw = getCharacter('godswyl');
    expect(gw).toBeDefined();
    const rot: TeamRotation = {
      members: [member('gw', gw!, 0)],
      turns: [{ actions: [{ memberId: 'gw', attack: meleeAttack() }] }],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // 1 scheduled melee + 1 triggered Champion of the Feast = 2 entries.
    expect(r.perMember['gw'].perAction).toHaveLength(2);
    expect(r.perMember['gw'].triggeredFires).toEqual([
      {
        turnIdx: 0,
        abilityId: 'godswyl_champion_of_the_feast',
        profileIdx: 0,
      },
    ]);
  });

  it('passive fires exactly once per turn even with multiple scheduled actions', () => {
    const gw = getCharacter('godswyl');
    expect(gw).toBeDefined();
    // Schedule two melees in one turn — only the first should trigger the
    // passive (it's afterOwnFirstAttackOfTurn, not afterOwnNormalAttack).
    const rot: TeamRotation = {
      members: [member('gw', gw!, 0)],
      turns: [
        {
          actions: [
            { memberId: 'gw', attack: meleeAttack() },
            { memberId: 'gw', attack: meleeAttack() },
          ],
        },
      ],
    };
    const r = resolveTeamRotation(rot, makeTarget());
    // 2 scheduled melees + 1 triggered passive = 3 entries.
    expect(r.perMember['gw'].perAction).toHaveLength(3);
    expect(r.perMember['gw'].triggeredFires).toHaveLength(1);
  });
});
