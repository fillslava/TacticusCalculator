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
