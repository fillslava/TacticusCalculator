import { describe, it, expect } from 'vitest';
import { resolveRotation } from '../../src/engine/rotation';
import {
  canFireAbility,
  initRotationState,
  scalingMultiplier,
  shouldTrigger,
  stampCooldown,
  tickCooldowns,
} from '../../src/engine/triggers';
import '../../src/engine/traits';
import type {
  Attacker,
  AttackContext,
  CatalogAbility,
  CatalogBoss,
  CatalogCharacter,
  Rotation,
  Target,
} from '../../src/engine/types';

/**
 * Shared test fixtures. Heroes carry their passives via `source.abilities`;
 * rotations schedule explicit melee / ranged / ability contexts; we inspect
 * the returned `perTurn`, `cooldownSkips`, and `triggeredFires` fields.
 */
const meleeProfile = {
  label: 'Melee',
  damageType: 'power' as const,
  hits: 2,
  kind: 'melee' as const,
};
const rangedProfile = {
  label: 'Ranged',
  damageType: 'bolter' as const,
  hits: 2,
  kind: 'ranged' as const,
};

function makeChar(abilities: CatalogAbility[] = []): CatalogCharacter {
  return {
    id: 'testHero',
    displayName: 'Test Hero',
    faction: 'Space Marines',
    alliance: 'Imperial',
    baseStats: {
      damage: 100,
      armor: 50,
      hp: 1000,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 2,
      rangedHits: 2,
    },
    melee: meleeProfile,
    ranged: rangedProfile,
    abilities,
    traits: [],
    maxRarity: 'legendary',
  };
}

const boss: CatalogBoss = {
  id: 'testBoss',
  displayName: 'Test Boss',
  stages: [
    { name: 'L1', hp: 10_000_000, armor: 80, traits: [] },
    { name: 'L1-big', hp: 10_000_000, armor: 80, traits: ['bigTarget'] },
  ],
};

function makeAttacker(abilities: CatalogAbility[] = []): Attacker {
  return {
    source: makeChar(abilities),
    progression: { stars: 0, rank: 0, xpLevel: 1, rarity: 'legendary' },
    equipment: [],
  };
}

function makeTarget(stageIndex = 0): Target {
  return { source: boss, stageIndex };
}

function melee(): AttackContext {
  return { profile: { ...meleeProfile }, rngMode: 'expected' };
}
function ability(abilityId: string, hits = 1, cooldown = 2): AttackContext {
  return {
    profile: {
      label: abilityId,
      damageType: 'power',
      hits,
      kind: 'ability',
      abilityId,
      cooldown,
    },
    rngMode: 'expected',
  };
}

// ---------------------------------------------------------------------------
// shouldTrigger — pure logic
// ---------------------------------------------------------------------------

describe('shouldTrigger', () => {
  const afterNormal: CatalogAbility = {
    id: 'p1',
    name: 'After Normal',
    kind: 'passive',
    profiles: [],
    trigger: { kind: 'afterOwnNormalAttack' },
  };
  const afterFirst: CatalogAbility = {
    id: 'p2',
    name: 'After First',
    kind: 'passive',
    profiles: [],
    trigger: { kind: 'afterOwnFirstAttackOfTurn' },
  };
  const afterFirstBig: CatalogAbility = {
    id: 'p3',
    name: 'After First (big target)',
    kind: 'passive',
    profiles: [],
    trigger: {
      kind: 'afterOwnFirstAttackOfTurn',
      requiresTargetTrait: 'bigTarget',
    },
  };

  it('afterOwnNormalAttack fires on melee', () => {
    const ctx = {
      profile: meleeProfile,
      isFirstAttackOfTurn: false,
      targetTraits: [],
    };
    expect(shouldTrigger(afterNormal, ctx)).toBe(true);
  });

  it('afterOwnNormalAttack fires on ranged', () => {
    const ctx = {
      profile: rangedProfile,
      isFirstAttackOfTurn: false,
      targetTraits: [],
    };
    expect(shouldTrigger(afterNormal, ctx)).toBe(true);
  });

  it('afterOwnNormalAttack does not fire on ability', () => {
    const ctx = {
      profile: {
        label: 'a',
        damageType: 'power' as const,
        hits: 1,
        kind: 'ability' as const,
        abilityId: 'x',
      },
      isFirstAttackOfTurn: true,
      targetTraits: [],
    };
    expect(shouldTrigger(afterNormal, ctx)).toBe(false);
  });

  it('afterOwnFirstAttackOfTurn only fires on first attack', () => {
    const first = {
      profile: meleeProfile,
      isFirstAttackOfTurn: true,
      targetTraits: [],
    };
    const later = { ...first, isFirstAttackOfTurn: false };
    expect(shouldTrigger(afterFirst, first)).toBe(true);
    expect(shouldTrigger(afterFirst, later)).toBe(false);
  });

  it('requiresTargetTrait gates on trait presence', () => {
    const withTrait = {
      profile: meleeProfile,
      isFirstAttackOfTurn: true,
      targetTraits: ['bigTarget'],
    };
    const withoutTrait = { ...withTrait, targetTraits: [] };
    expect(shouldTrigger(afterFirstBig, withTrait)).toBe(true);
    expect(shouldTrigger(afterFirstBig, withoutTrait)).toBe(false);
  });

  it('returns false for passives with no trigger', () => {
    const noTrigger: CatalogAbility = {
      id: 'p4',
      name: 'Untriggered',
      kind: 'passive',
      profiles: [],
    };
    expect(
      shouldTrigger(noTrigger, {
        profile: meleeProfile,
        isFirstAttackOfTurn: true,
        targetTraits: [],
      }),
    ).toBe(false);
  });

  it('returns false for actives even with a trigger-shaped field', () => {
    const active: CatalogAbility = {
      id: 'a1',
      name: 'Active w/ trigger',
      kind: 'active',
      profiles: [],
      trigger: { kind: 'afterOwnNormalAttack' },
    };
    expect(
      shouldTrigger(active, {
        profile: meleeProfile,
        isFirstAttackOfTurn: false,
        targetTraits: [],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cooldown primitives
// ---------------------------------------------------------------------------

describe('cooldown primitives', () => {
  it('canFireAbility is true for melee / ranged / no-id profiles', () => {
    const state = initRotationState();
    expect(canFireAbility(meleeProfile, state)).toBe(true);
    expect(canFireAbility(rangedProfile, state)).toBe(true);
    expect(
      canFireAbility(
        { label: 'noId', damageType: 'power', hits: 1, kind: 'ability' },
        state,
      ),
    ).toBe(true);
  });

  it('stampCooldown + canFireAbility block re-use until tick drains it', () => {
    const state = initRotationState();
    const attacker = makeAttacker([
      {
        id: 'bang',
        name: 'Bang',
        kind: 'active',
        profiles: [],
        cooldown: 2,
      },
    ]);
    const profile = ability('bang', 1, 2).profile;
    expect(canFireAbility(profile, state)).toBe(true);
    stampCooldown(attacker, profile, state);
    expect(canFireAbility(profile, state)).toBe(false);
    tickCooldowns(state); // 2 → 1
    expect(canFireAbility(profile, state)).toBe(false);
    tickCooldowns(state); // 1 → 0
    expect(canFireAbility(profile, state)).toBe(true);
  });

  it('cd=999 sentinel survives many ticks (once-per-battle)', () => {
    const state = initRotationState();
    const attacker = makeAttacker([
      {
        id: 'ult',
        name: 'Ult',
        kind: 'active',
        profiles: [],
        cooldown: 999,
      },
    ]);
    const profile = ability('ult', 1, 999).profile;
    stampCooldown(attacker, profile, state);
    for (let i = 0; i < 50; i++) tickCooldowns(state);
    expect(canFireAbility(profile, state)).toBe(false);
    expect(state.cooldowns['ult']).toBe(949);
  });

  it('stampCooldown is a no-op for non-ability profiles', () => {
    const state = initRotationState();
    const attacker = makeAttacker();
    stampCooldown(attacker, meleeProfile, state);
    expect(state.cooldowns).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// scalingMultiplier
// ---------------------------------------------------------------------------

describe('scalingMultiplier', () => {
  const kariyanLike: CatalogAbility = {
    id: 'MartialInspiration',
    name: 'MI',
    kind: 'active',
    profiles: [],
    cooldown: 2,
    scaling: { per: 'turnsAttackedThisBattle', pctPerStep: 33 },
  };

  it('returns 1 for abilities with no scaling', () => {
    const state = initRotationState();
    state.turnsAttackedThisBattle = 5;
    const plain: CatalogAbility = {
      id: 'plain',
      name: 'P',
      kind: 'active',
      profiles: [],
    };
    expect(scalingMultiplier(plain, state)).toBe(1);
  });

  it('returns 1 for undefined ability', () => {
    const state = initRotationState();
    state.turnsAttackedThisBattle = 3;
    expect(scalingMultiplier(undefined, state)).toBe(1);
  });

  it('scales 1 + (pct/100) × turnsAttackedThisBattle', () => {
    const state = initRotationState();
    state.turnsAttackedThisBattle = 0;
    expect(scalingMultiplier(kariyanLike, state)).toBe(1);
    state.turnsAttackedThisBattle = 1;
    expect(scalingMultiplier(kariyanLike, state)).toBeCloseTo(1.33, 5);
    state.turnsAttackedThisBattle = 3;
    expect(scalingMultiplier(kariyanLike, state)).toBeCloseTo(1.99, 5);
  });
});

// ---------------------------------------------------------------------------
// resolveRotation — integration
// ---------------------------------------------------------------------------

describe('resolveRotation — passive trigger auto-fire', () => {
  it('afterOwnNormalAttack passive fires after a melee attack', () => {
    const passive: CatalogAbility = {
      id: 'betrayerLike',
      name: 'Betrayer-like',
      kind: 'passive',
      profiles: [
        { label: 'Proc', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      trigger: { kind: 'afterOwnNormalAttack' },
    };
    const a = makeAttacker([passive]);
    const t = makeTarget();
    const rot: Rotation = { turns: [{ attacks: [melee()] }] };
    const r = resolveRotation(a, t, rot);
    // 1 scheduled + 1 triggered = 2 entries in perTurn.
    expect(r.perTurn).toHaveLength(2);
    expect(r.triggeredFires).toEqual([
      { turnIdx: 0, abilityId: 'betrayerLike', profileIdx: 0 },
    ]);
  });

  it('afterOwnNormalAttack does NOT fire after an ability', () => {
    const passive: CatalogAbility = {
      id: 'betrayerLike',
      name: 'Betrayer-like',
      kind: 'passive',
      profiles: [
        { label: 'Proc', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      trigger: { kind: 'afterOwnNormalAttack' },
    };
    const active: CatalogAbility = {
      id: 'boom',
      name: 'Boom',
      kind: 'active',
      profiles: [
        { label: 'Boom', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      cooldown: 2,
    };
    const a = makeAttacker([passive, active]);
    const t = makeTarget();
    const rot: Rotation = { turns: [{ attacks: [ability('boom', 1, 2)] }] };
    const r = resolveRotation(a, t, rot);
    // Just the scheduled ability; passive did NOT fire.
    expect(r.perTurn).toHaveLength(1);
    expect(r.triggeredFires).toEqual([]);
  });

  it('afterOwnFirstAttackOfTurn fires once per turn', () => {
    const passive: CatalogAbility = {
      id: 'loc',
      name: 'Legacy of Combat',
      kind: 'passive',
      profiles: [
        { label: 'LoC', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      trigger: { kind: 'afterOwnFirstAttackOfTurn' },
    };
    const a = makeAttacker([passive]);
    const t = makeTarget();
    // Turn with two melee attacks: passive fires once, off the first one.
    const rot: Rotation = { turns: [{ attacks: [melee(), melee()] }] };
    const r = resolveRotation(a, t, rot);
    // 2 scheduled + 1 triggered = 3 entries.
    expect(r.perTurn).toHaveLength(3);
    expect(r.triggeredFires).toHaveLength(1);
    expect(r.triggeredFires[0]).toEqual({
      turnIdx: 0,
      abilityId: 'loc',
      profileIdx: 0,
    });
  });

  it('requiresTargetTrait filters passive against the target', () => {
    const passive: CatalogAbility = {
      id: 'locBig',
      name: 'LoC (big target)',
      kind: 'passive',
      profiles: [
        { label: 'LoC-B', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      trigger: {
        kind: 'afterOwnFirstAttackOfTurn',
        requiresTargetTrait: 'bigTarget',
      },
    };
    const a = makeAttacker([passive]);
    const rot: Rotation = { turns: [{ attacks: [melee()] }] };

    // Stage 0 has no trait → passive blocked.
    const rNoTrait = resolveRotation(a, makeTarget(0), rot);
    expect(rNoTrait.triggeredFires).toEqual([]);
    expect(rNoTrait.perTurn).toHaveLength(1);

    // Stage 1 carries bigTarget → passive fires.
    const rBig = resolveRotation(a, makeTarget(1), rot);
    expect(rBig.triggeredFires).toHaveLength(1);
    expect(rBig.perTurn).toHaveLength(2);
  });

  it('multi-profile passive fires each profile (Kharn-style)', () => {
    const passive: CatalogAbility = {
      id: 'multi',
      name: 'Multi',
      kind: 'passive',
      profiles: [
        { label: 'A', damageType: 'power', hits: 1, kind: 'ability' },
        { label: 'B', damageType: 'piercing', hits: 1, kind: 'ability' },
        { label: 'C', damageType: 'plasma', hits: 1, kind: 'ability' },
      ],
      trigger: { kind: 'afterOwnNormalAttack' },
    };
    const a = makeAttacker([passive]);
    const rot: Rotation = { turns: [{ attacks: [melee()] }] };
    const r = resolveRotation(a, makeTarget(), rot);
    // 1 scheduled + 3 triggered.
    expect(r.perTurn).toHaveLength(4);
    expect(r.triggeredFires.map((f) => f.profileIdx)).toEqual([0, 1, 2]);
  });

  // Wiki STMA rule: for a multi-profile triggered passive (e.g. Volk
  // Fleshmetal Guns), a bonus-hit buff must only add hits to the FIRST
  // profile. See https://tacticus.wiki.gg/wiki/HDTW_AddHits.
  it('STMA: multi-profile triggered passive receives bonus hits only on first profile', () => {
    const passive: CatalogAbility = {
      id: 'volkLike',
      name: 'Volk-like Multi',
      kind: 'passive',
      profiles: [
        { label: 'A', damageType: 'power', hits: 1, kind: 'ability' },
        { label: 'B', damageType: 'piercing', hits: 1, kind: 'ability' },
        { label: 'C', damageType: 'plasma', hits: 1, kind: 'ability' },
      ],
      trigger: { kind: 'afterOwnNormalAttack' },
    };
    const a = makeAttacker([passive]);
    const rot: Rotation = {
      turns: [
        {
          attacks: [melee()],
          // 'all'-trigger buff would apply to every profile without the STMA
          // gate; the engine must restrict it to profileIdx === 0.
          buffs: [
            { id: 'vitruviusLike', name: 'Mark', bonusHits: 1, bonusHitsOn: 'all' },
          ],
        },
      ],
    };
    const r = resolveRotation(a, makeTarget(), rot);
    // 1 scheduled melee + 3 triggered passive profiles = 4 entries.
    expect(r.perTurn).toHaveLength(4);
    // Scheduled melee (hits=2) + 'all' bonus (+1) = 3 per-hit rows.
    expect(r.perTurn[0].perHit).toHaveLength(3);
    // First passive profile: 1 base + 1 bonus = 2 rows.
    expect(r.perTurn[1].perHit).toHaveLength(2);
    // Subsequent passive profiles: STMA — 1 base + 0 bonus = 1 row each.
    expect(r.perTurn[2].perHit).toHaveLength(1);
    expect(r.perTurn[3].perHit).toHaveLength(1);
  });

  // Kharn-style: UI fans "Kill! Maim! Burn!" out into 3 scheduled contexts
  // (Piercing, Eviscerating, Plasma), stamping abilityProfileIdx on each.
  // The engine's scheduled-action path must honour the STMA rule, so a
  // +1 Vitruvius-style buff lands only on the first.
  it('STMA: multi-profile scheduled ability receives bonus hits only on first profile', () => {
    const a = makeAttacker();
    const mkCtx = (
      label: string,
      hits: number,
      idx: number,
    ): AttackContext => ({
      profile: {
        label,
        damageType: 'power',
        hits,
        kind: 'ability',
        abilityId: 'kmb',
        abilityProfileIdx: idx,
      },
      rngMode: 'expected',
    });
    const rot: Rotation = {
      turns: [
        {
          attacks: [mkCtx('Piercing', 1, 0), mkCtx('Eviscerating', 6, 1), mkCtx('Plasma', 1, 2)],
          buffs: [
            { id: 'mark', name: 'Mark', bonusHits: 1, bonusHitsOn: 'all' },
          ],
        },
      ],
    };
    const r = resolveRotation(a, makeTarget(), rot);
    expect(r.perTurn).toHaveLength(3);
    // Profile 0: 1 base + 1 bonus = 2.
    expect(r.perTurn[0].perHit).toHaveLength(2);
    // Profiles 1, 2: STMA → no bonus.
    expect(r.perTurn[1].perHit).toHaveLength(6);
    expect(r.perTurn[2].perHit).toHaveLength(1);
  });

  it('STMA: single-profile triggered passive still receives bonus hits (regression)', () => {
    const passive: CatalogAbility = {
      id: 'singleLike',
      name: 'Single-profile passive',
      kind: 'passive',
      profiles: [
        { label: 'A', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      trigger: { kind: 'afterOwnNormalAttack' },
    };
    const a = makeAttacker([passive]);
    const rot: Rotation = {
      turns: [
        {
          attacks: [melee()],
          buffs: [
            { id: 'all', name: 'All', bonusHits: 1, bonusHitsOn: 'all' },
          ],
        },
      ],
    };
    const r = resolveRotation(a, makeTarget(), rot);
    // 1 scheduled + 1 triggered = 2 entries.
    expect(r.perTurn).toHaveLength(2);
    // Single-profile passive still gets the bonus hit.
    expect(r.perTurn[1].perHit).toHaveLength(2);
  });
});

describe('resolveRotation — cooldowns', () => {
  it('records a cooldownSkip when ability is on cooldown', () => {
    const active: CatalogAbility = {
      id: 'boom',
      name: 'Boom',
      kind: 'active',
      profiles: [
        { label: 'Boom', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      cooldown: 2,
    };
    const a = makeAttacker([active]);
    const t = makeTarget();
    const rot: Rotation = {
      turns: [
        { attacks: [ability('boom', 1, 2)] }, // fires
        { attacks: [ability('boom', 1, 2)] }, // SKIPPED (cd still 1)
        { attacks: [ability('boom', 1, 2)] }, // fires again
      ],
    };
    const r = resolveRotation(a, t, rot);
    expect(r.cooldownSkips).toEqual([{ turnIdx: 1, abilityId: 'boom' }]);
    // perTurn gets 2 entries (1 fire + 0 + 1 fire). turn-2 is empty.
    expect(r.perTurn).toHaveLength(2);
  });

  it('once-per-battle (cd=999) fires on turn 1 and never again', () => {
    const active: CatalogAbility = {
      id: 'ult',
      name: 'Ult',
      kind: 'active',
      profiles: [
        { label: 'Ult', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      cooldown: 999,
    };
    const a = makeAttacker([active]);
    const rot: Rotation = {
      turns: [
        { attacks: [ability('ult', 1, 999)] },
        { attacks: [ability('ult', 1, 999)] },
        { attacks: [ability('ult', 1, 999)] },
      ],
    };
    const r = resolveRotation(a, makeTarget(), rot);
    expect(r.cooldownSkips).toEqual([
      { turnIdx: 1, abilityId: 'ult' },
      { turnIdx: 2, abilityId: 'ult' },
    ]);
    expect(r.perTurn).toHaveLength(1);
  });

  it('ability with no cooldown declared can fire repeatedly', () => {
    const active: CatalogAbility = {
      id: 'noCd',
      name: 'No CD',
      kind: 'active',
      profiles: [
        { label: 'NC', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      // cooldown deliberately undefined
    };
    const a = makeAttacker([active]);
    // Also zero out the profile's own `cooldown` — rotation tests the *ability*,
    // not a profile-level override.
    const attack = (): AttackContext => ({
      profile: {
        label: 'noCd',
        damageType: 'power',
        hits: 1,
        kind: 'ability',
        abilityId: 'noCd',
      },
      rngMode: 'expected',
    });
    const rot: Rotation = {
      turns: [{ attacks: [attack()] }, { attacks: [attack()] }],
    };
    const r = resolveRotation(a, makeTarget(), rot);
    expect(r.cooldownSkips).toEqual([]);
    expect(r.perTurn).toHaveLength(2);
  });
});

describe('resolveRotation — Kariyan-style scaling', () => {
  // Zero-armor target so damage scales purely multiplicatively — armor
  // subtraction is non-linear and would break expected-ratio checks.
  const nakedBoss: CatalogBoss = {
    id: 'naked',
    displayName: 'Naked',
    stages: [{ name: 'only', hp: 10_000_000, armor: 0, traits: [] }],
  };
  const nakedTarget: Target = { source: nakedBoss, stageIndex: 0 };

  it('scaled damage grows turn-over-turn', () => {
    const active: CatalogAbility = {
      id: 'MartialInspiration',
      name: 'MI',
      kind: 'active',
      profiles: [
        { label: 'MI', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      cooldown: 0, // re-fireable every turn for clean comparison
      scaling: { per: 'turnsAttackedThisBattle', pctPerStep: 33 },
    };
    const a = makeAttacker([active]);
    const miCtx = (): AttackContext => ({
      profile: {
        label: 'MI',
        damageType: 'power',
        hits: 1,
        kind: 'ability',
        abilityId: 'MartialInspiration',
        cooldown: 0,
      },
      rngMode: 'expected',
    });
    const rot: Rotation = {
      turns: [
        { attacks: [miCtx()] }, // turnsAttacked=0 → ×1
        { attacks: [miCtx()] }, // turnsAttacked=1 → ×1.33
        { attacks: [miCtx()] }, // turnsAttacked=2 → ×1.66
      ],
    };
    const r = resolveRotation(a, nakedTarget, rot);
    expect(r.perTurn).toHaveLength(3);
    const [t0, t1, t2] = r.perTurn;
    expect(t0.expected).toBeGreaterThan(0);
    // Ratios should track the scaling multiplier (1, 1.33, 1.66).
    expect(t1.expected / t0.expected).toBeCloseTo(1.33, 2);
    expect(t2.expected / t0.expected).toBeCloseTo(1.66, 2);
  });

  it('non-scaling ability does NOT grow across turns', () => {
    const active: CatalogAbility = {
      id: 'flat',
      name: 'Flat',
      kind: 'active',
      profiles: [
        { label: 'F', damageType: 'power', hits: 1, kind: 'ability' },
      ],
      cooldown: 0,
    };
    const a = makeAttacker([active]);
    const ctxFlat = (): AttackContext => ({
      profile: {
        label: 'flat',
        damageType: 'power',
        hits: 1,
        kind: 'ability',
        abilityId: 'flat',
        cooldown: 0,
      },
      rngMode: 'expected',
    });
    const rot: Rotation = {
      turns: [
        { attacks: [ctxFlat()] },
        { attacks: [ctxFlat()] },
        { attacks: [ctxFlat()] },
      ],
    };
    const r = resolveRotation(a, makeTarget(), rot);
    const [t0, t1, t2] = r.perTurn;
    expect(t1.expected).toBeCloseTo(t0.expected, 3);
    expect(t2.expected).toBeCloseTo(t0.expected, 3);
  });
});

describe('resolveRotation — state bookkeeping', () => {
  it('cumulativeExpected monotonically increases', () => {
    const a = makeAttacker();
    const rot: Rotation = {
      turns: [
        { attacks: [melee()] },
        { attacks: [melee()] },
        { attacks: [melee()] },
      ],
    };
    const r = resolveRotation(a, makeTarget(), rot);
    expect(r.cumulativeExpected).toHaveLength(3);
    expect(r.cumulativeExpected[1]).toBeGreaterThan(r.cumulativeExpected[0]);
    expect(r.cumulativeExpected[2]).toBeGreaterThan(r.cumulativeExpected[1]);
  });

  it('turnsToKill fires the turn HP hits 0, not before', () => {
    const a = makeAttacker();
    // Tiny target so melee kills it quickly.
    const tinyBoss: CatalogBoss = {
      id: 'tiny',
      displayName: 'Tiny',
      stages: [{ name: 'only', hp: 10, armor: 0, traits: [] }],
    };
    const tiny: Target = { source: tinyBoss, stageIndex: 0 };
    const rot: Rotation = {
      turns: [
        { attacks: [melee()] },
        { attacks: [melee()] },
        { attacks: [melee()] },
      ],
    };
    const r = resolveRotation(a, tiny, rot);
    expect(r.turnsToKill).toBe(1);
  });

  it('turnsToKill = "unreachable" when damage never finishes HP', () => {
    const a = makeAttacker();
    const rot: Rotation = { turns: [{ attacks: [melee()] }] };
    const r = resolveRotation(a, makeTarget(), rot); // 10M HP, 1 melee only
    expect(r.turnsToKill).toBe('unreachable');
  });
});
