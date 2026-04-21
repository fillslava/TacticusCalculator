/**
 * Phase 3 — Guild Raid team rotation engine.
 *
 * resolveTeamRotation threads per-member RotationState across turns like
 * resolveRotation does for a single attacker, but adds a layer on top:
 * position-aware team buffs derived from catalog `AbilityTeamBuff` data.
 *
 * Three currently-modelled buff kinds (matching the catalog's `teamBuff`
 * union):
 *
 *  - `laviscusOutrage`: Laviscus has a per-turn Outrage stat. Every time
 *    a friendly character attacks an enemy adjacent to Laviscus with a
 *    non-psychic hit, that contributor's *maximum* non-psychic hit this
 *    turn is tracked against Laviscus. Outrage = sum of each contributor's
 *    max hit. In single-boss Guild Raid we treat the boss as always-
 *    adjacent to Laviscus when he's on the team. Effects, applied to
 *    Laviscus's own attacks while his Outrage > 0:
 *      (i) +`outragePctOfOutrage`% of Outrage as flat damage on every
 *          attack.
 *      (ii) +`critDmgPerChaosContributor` × (# Chaos contributors) crit
 *           damage — but ONLY on Laviscus's normal (melee/ranged)
 *           attacks. Abilities do not get the crit bonus.
 *    Reset: Outrage clears at end of turn automatically AND mid-turn
 *    after Laviscus resolves a normal attack. Laviscus never contributes
 *    to his own Outrage. Order-sensitive — allies who act after Laviscus
 *    don't count.
 *
 *  - `trajannLegendaryCommander`: enemies receive +`flatDamage` from any
 *    attack while they are adjacent to a friendly that has used an
 *    active ability earlier this turn. For single-boss Guild Raid we
 *    treat the boss as always-adjacent to every team member, so the
 *    gate collapses to "any friendly fired an active earlier this
 *    turn". Additionally, if the affected enemy is also adjacent to
 *    Trajann (again: always true in single-boss MVP if Trajann is on
 *    the team), friendly Characters score +`extraHitsAdjacentToSelf`
 *    additional hits on their FIRST attack that is not a normal
 *    attack (i.e. first ability attack) against that enemy this turn.
 *    Per-member: each friendly gets the bonus exactly once, on their
 *    first non-normal attack after the trigger has fired.
 *
 *  - `biovoreMythicAcid`: once Biovore's Spore-Mine ability damages the
 *    target during a turn, subsequent attacks that turn from Mythic-tier
 *    allies get `+pct%` damage. Ability identified by `teamBuff.kind` on
 *    the profile's ability — no hard-coded id matching. Ordering-
 *    sensitive: spore mine must fire before the Mythic ally attacks.
 *
 * Intentionally NOT modelled yet: aura persistence across turns (we
 * recompute per-turn), multi-target spore mines, non-adjacency aura
 * shapes, conditional-on-stance/traits buffs. Those land when Phase 3
 * hand-authoring surfaces the need.
 */
import { resolveAttack } from './attack';
import { applyBonusHits, applyTurnBuffs } from './rotation';
import {
  abilityFor,
  applyScaling,
  canFireAbility,
  initRotationState,
  RotationState,
  scalingMultiplier,
  shouldTrigger,
  stampCooldown,
  tickCooldowns,
} from './triggers';
import type {
  AbilityTeamBuff,
  Attacker,
  AttackContext,
  AttackProfile,
  CatalogAbility,
  CatalogCharacter,
  DamageBreakdown,
  MemberBreakdown,
  TeamBuffApplication,
  TeamMember,
  TeamRotation,
  TeamRotationBreakdown,
  Target,
  TraitId,
  TurnBuff,
} from './types';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function resolveBaseHp(target: Target): number {
  if (target.statOverrides?.hp !== undefined) return target.statOverrides.hp;
  if ('stages' in target.source) {
    const idx = target.stageIndex ?? 0;
    return target.source.stages[Math.min(idx, target.source.stages.length - 1)].hp;
  }
  return target.source.baseStats.hp;
}

function collectTargetTraits(target: Target): TraitId[] {
  const debuffTraits = target.activeDebuffs?.traits ?? [];
  if ('stages' in target.source) {
    const idx = target.stageIndex ?? 0;
    const stage = target.source.stages[Math.min(idx, target.source.stages.length - 1)];
    return [...stage.traits, ...debuffTraits];
  }
  return [...target.source.traits, ...debuffTraits];
}

/** Find a teamBuff of the given kind on any of the member's abilities. */
function teamBuffOf<K extends AbilityTeamBuff['kind']>(
  member: TeamMember,
  kind: K,
): (AbilityTeamBuff & { kind: K }) | undefined {
  for (const a of member.attacker.source.abilities ?? []) {
    if (a.teamBuff?.kind === kind) {
      return a.teamBuff as AbilityTeamBuff & { kind: K };
    }
  }
  return undefined;
}

/** Find an ability carrying a specific teamBuff kind on a catalog character. */
function findAbilityWithTeamBuff(
  src: CatalogCharacter,
  kind: AbilityTeamBuff['kind'],
): CatalogAbility | undefined {
  return (src.abilities ?? []).find((a) => a.teamBuff?.kind === kind);
}

// ---------------------------------------------------------------------------
// Turn-local state
// ---------------------------------------------------------------------------

interface TurnState {
  /**
   * Per-Laviscus running Outrage ledger.
   *   outer key: Laviscus's memberId
   *   inner key: contributing friendly's memberId
   *   value:     that contributor's MAX non-psychic hit so far this turn
   * Outrage = sum over inner values. Updated in `updateTurnStateAfterAction`
   * after each friendly's attack resolves.
   */
  outrageContributions: Record<string, Record<string, number>>;
  /**
   * Per-Laviscus flag: once Laviscus performs a normal (melee/ranged)
   * attack, Outrage resets AND further contributions this turn are
   * ignored for this Laviscus. (Per mechanic: "Outrage resets after
   * Laviscus performs a Normal Attack.")
   */
  laviscusOutrageResetThisTurn: Record<string, boolean>;
  /**
   * True once ANY friendly has fired an `active` ability during this
   * turn. Gates Trajann's flat-damage component and extra-hits component.
   * (In original mechanic this is "enemies adjacent to that specific
   * active-user take +X"; single-boss MVP treats the boss as always in
   * range so the filter collapses to a team-wide boolean.)
   */
  friendlyActiveFiredThisTurn: boolean;
  /**
   * Per-member: has this member already performed a non-normal (ability)
   * attack during this turn? Gates Trajann's "first attack that is not a
   * normal attack" per-member once-per-turn bonus.
   */
  memberNonNormalAttackHappened: Record<string, boolean>;
  /**
   * True once a Biovore Spore-Mine ability has damaged the target this
   * turn. Gates biovoreMythicAcid for Mythic allies that act afterward.
   */
  sporeMineDamagedTarget: boolean;
}

function initTurnState(): TurnState {
  return {
    outrageContributions: {},
    laviscusOutrageResetThisTurn: {},
    friendlyActiveFiredThisTurn: false,
    memberNonNormalAttackHappened: {},
    sporeMineDamagedTarget: false,
  };
}

// ---------------------------------------------------------------------------
// Team-buff derivation
// ---------------------------------------------------------------------------

/**
 * Compute every TurnBuff a member should receive for a given action, given
 * the team composition and the current turn-local state. Also records the
 * applications into `appsSink` for UI transparency.
 *
 * Buffs are derived from auras (position-based, always-on) and reactive
 * state (turn-local flags like "spore mine already hit").
 */
function deriveTeamBuffs(
  member: TeamMember,
  team: TeamMember[],
  currentProfile: AttackProfile,
  turn: TurnState,
  turnIdx: number,
  appsSink: TeamBuffApplication[],
): TurnBuff[] {
  const buffs: TurnBuff[] = [];

  // ------ 1) Laviscus self-buffs from his Outrage stat.
  //
  //        The passive ONLY buffs Laviscus himself — it does NOT grant
  //        adjacent allies a damage aura. Two components:
  //          (i)  +outragePctOfOutrage% × Outrage as flat damage, on
  //               every attack he makes (while Outrage > 0).
  //          (ii) +critDmgPerChaosContributor × (# Chaos contributors)
  //               crit damage, on his NORMAL attacks only.
  //        Once Laviscus performs a normal attack, Outrage resets mid-
  //        turn and neither component applies to further attacks.
  const ownOutrage = teamBuffOf(member, 'laviscusOutrage');
  if (ownOutrage && !turn.laviscusOutrageResetThisTurn[member.id]) {
    const contribs = turn.outrageContributions[member.id] ?? {};
    const contribIds = Object.keys(contribs);
    const accumulated = contribIds.reduce((s, id) => s + contribs[id], 0);

    // (i) Flat damage from % of accumulated Outrage.
    if (accumulated > 0) {
      const flat = Math.floor((ownOutrage.outragePctOfOutrage / 100) * accumulated);
      buffs.push({
        id: 'outrage-self-flat',
        name: 'Outrage (stat)',
        damageFlat: flat,
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: member.id,
        kind: 'laviscusOutrage',
        appliedToMemberId: member.id,
        effect: `+${flat} flat dmg (${ownOutrage.outragePctOfOutrage}% of ${accumulated} Outrage)`,
      });
    }

    // (ii) Crit damage per Chaos contributor — NORMAL attacks only.
    const isNormal =
      currentProfile.kind === 'melee' || currentProfile.kind === 'ranged';
    if (isNormal) {
      const chaosCount = contribIds.filter((id) => {
        const m = team.find((t) => t.id === id);
        return m?.attacker.source.alliance === 'Chaos';
      }).length;
      if (chaosCount > 0) {
        const critDmg = chaosCount * ownOutrage.critDmgPerChaosContributor;
        buffs.push({
          id: 'outrage-self-crit',
          name: 'Outrage (Chaos crit)',
          critDamage: critDmg,
        });
        appsSink.push({
          turnIdx,
          sourceMemberId: member.id,
          kind: 'laviscusOutrage',
          appliedToMemberId: member.id,
          effect: `+${critDmg} crit dmg (${chaosCount} Chaos contributor${chaosCount === 1 ? '' : 's'})`,
        });
      }
    }
  }

  // ------ 3) Trajann LegendaryCommander: flat damage to the target when a
  //        friendly has already fired an active this turn. Applies to EVERY
  //        team member's attacks against the enemy (not just the Shield
  //        Host ally that fired the active).
  if (turn.friendlyActiveFiredThisTurn) {
    for (const other of team) {
      const cmdr = teamBuffOf(other, 'trajannLegendaryCommander');
      if (!cmdr) continue;
      buffs.push({
        id: `trajann-flat:${other.id}`,
        name: 'Legendary Commander (flat)',
        damageFlat: cmdr.flatDamage,
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'trajannLegendaryCommander',
        appliedToMemberId: member.id,
        effect: `+${cmdr.flatDamage} flat dmg (friendly active fired)`,
      });
    }
  }

  // ------ 4) Trajann LegendaryCommander: extra hits on the attacker's
  //        FIRST non-normal (ability) attack this turn, once the flat-
  //        damage trigger has fired AND Trajann is on the team. Gated on:
  //          - a friendly fired an active earlier this turn (trigger)
  //          - current action is an ability (first non-normal attack)
  //          - this member hasn't yet resolved a non-normal attack this turn
  //        The per-member `memberNonNormalAttackHappened` flag is set in
  //        `updateTurnStateAfterAction` AFTER this action resolves, so the
  //        first ability gets the bonus and later abilities do not.
  if (
    turn.friendlyActiveFiredThisTurn &&
    currentProfile.kind === 'ability' &&
    !turn.memberNonNormalAttackHappened[member.id]
  ) {
    for (const other of team) {
      const cmdr = teamBuffOf(other, 'trajannLegendaryCommander');
      if (!cmdr) continue;
      if (cmdr.extraHitsAdjacentToSelf <= 0) continue;
      buffs.push({
        id: `trajann-hits:${other.id}`,
        name: 'Legendary Commander (hits)',
        bonusHits: cmdr.extraHitsAdjacentToSelf,
        bonusHitsOn: 'ability',
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'trajannLegendaryCommander',
        appliedToMemberId: member.id,
        effect: `+${cmdr.extraHitsAdjacentToSelf} hits on first ability (Trajann)`,
      });
    }
  }

  // ------ 5) Biovore Mythic Acid: once Spore Mine has hit the target,
  //        Mythic-tier allies get +pct% damage.
  if (turn.sporeMineDamagedTarget && member.attacker.progression.rarity === 'mythic') {
    for (const other of team) {
      if (other.id === member.id) continue;
      const bio = teamBuffOf(other, 'biovoreMythicAcid');
      if (!bio) continue;
      buffs.push({
        id: `mythic-acid:${other.id}`,
        name: 'Mythic Acid',
        damageMultiplier: 1 + bio.pct / 100,
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'biovoreMythicAcid',
        appliedToMemberId: member.id,
        effect: `+${bio.pct}% damage (Spore Mine hit target)`,
      });
    }
  }

  return buffs;
}

// ---------------------------------------------------------------------------
// Reactive state updates (post-action)
// ---------------------------------------------------------------------------

/** After an action resolves, update the turn-local reactive flags. */
function updateTurnStateAfterAction(
  actor: TeamMember,
  attack: AttackContext,
  result: DamageBreakdown,
  team: TeamMember[],
  turn: TurnState,
): void {
  // Laviscus outrage contributions: any friendly that ISN'T Laviscus,
  // whose attack is non-psychic, contributes their MAX per-hit value to
  // each Laviscus's Outrage ledger. Per-contributor we keep the maximum
  // across their attacks this turn (not the sum). Single-boss MVP treats
  // the boss as always-adjacent to Laviscus, so every friendly
  // attacking the boss qualifies.
  const actorCarriesOutrage = !!teamBuffOf(actor, 'laviscusOutrage');
  if (!actorCarriesOutrage && attack.profile.damageType !== 'psychic') {
    const perHits = result.perHit;
    if (perHits && perHits.length > 0) {
      const bestHit = Math.max(...perHits.map((h) => h.expected));
      if (bestHit > 0) {
        for (const other of team) {
          if (!teamBuffOf(other, 'laviscusOutrage')) continue;
          if (turn.laviscusOutrageResetThisTurn[other.id]) continue;
          const ledger = turn.outrageContributions[other.id] ?? {};
          const prev = ledger[actor.id] ?? 0;
          if (bestHit > prev) ledger[actor.id] = bestHit;
          turn.outrageContributions[other.id] = ledger;
        }
      }
    }
  }

  // Laviscus reset: if THIS actor is a Laviscus and he just performed a
  // normal (melee/ranged) attack, clear his Outrage ledger AND mark the
  // reset flag so later contributors this turn don't accumulate against
  // him again.
  if (actorCarriesOutrage) {
    const isNormal =
      attack.profile.kind === 'melee' || attack.profile.kind === 'ranged';
    if (isNormal) {
      turn.outrageContributions[actor.id] = {};
      turn.laviscusOutrageResetThisTurn[actor.id] = true;
    }
  }

  // Trajann flat-damage trigger: ANY friendly firing an active ability
  // this turn arms the flag (no Shield Host gate — in original mechanic
  // the filter is target-adjacency, which single-boss MVP treats as
  // always true).
  if (
    attack.profile.kind === 'ability' &&
    isAbilityActive(actor.attacker, attack.profile.abilityId)
  ) {
    turn.friendlyActiveFiredThisTurn = true;
  }

  // Trajann extra-hits gate: record this member as having performed a
  // non-normal (ability) attack this turn, so a later ability this turn
  // from the same member doesn't re-consume the "first ability" bonus.
  if (attack.profile.kind === 'ability') {
    turn.memberNonNormalAttackHappened[actor.id] = true;
  }

  // Biovore: did this action fire the Mythic-Acid-carrier ability?
  if (attack.profile.kind === 'ability' && attack.profile.abilityId) {
    const bioAbility = findAbilityWithTeamBuff(actor.attacker.source, 'biovoreMythicAcid');
    if (bioAbility && bioAbility.id === attack.profile.abilityId) {
      turn.sporeMineDamagedTarget = true;
    }
  }
}

function isAbilityActive(attacker: Attacker, abilityId: string | undefined): boolean {
  if (!abilityId) return false;
  const ability = attacker.source.abilities.find((a) => a.id === abilityId);
  return ability?.kind === 'active';
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Resolve a Guild Raid team rotation against a single target. Returns
 * per-member damage breakdowns plus team-wide totals and every team-buff
 * application for UI inspection.
 *
 * Turn loop:
 *  1. For each scheduled action (in order):
 *     a. Gate on the actor's per-member cooldown — skip and record if on
 *        cooldown. (Skips also go into the team-wide `cooldownSkips`.)
 *     b. Compute team-buffs for this actor from composition + turn state.
 *     c. Apply scaling + bonus hits (same as single-attacker rotation).
 *     d. Resolve attack, drain shield/HP, record per-member entry.
 *     e. Stamp cooldown on the actor's state.
 *     f. Fire matching passives on the actor — each profile consumes the
 *        same shield/HP pool.
 *     g. Update turn-local reactive flags (outrage contributors,
 *        friendly-active-fired, member-non-normal-happened, spore-mine).
 *  2. End of turn: tick each member's cooldowns; advance turnsAttacked.
 *  3. Record cumulative team total.
 */
export function resolveTeamRotation(
  rotation: TeamRotation,
  target: Target,
): TeamRotationBreakdown {
  const memberById: Record<string, TeamMember> = {};
  const perMember: Record<string, MemberBreakdown> = {};
  const states: Record<string, RotationState> = {};
  for (const m of rotation.members) {
    memberById[m.id] = m;
    perMember[m.id] = {
      memberId: m.id,
      perAction: [],
      cooldownSkips: [],
      triggeredFires: [],
    };
    states[m.id] = initRotationState();
  }

  const teamBuffApplications: TeamBuffApplication[] = [];
  const teamCooldownSkips: { turnIdx: number; memberId: string; abilityId: string }[] = [];
  const cumulativeTeamExpected: number[] = [];
  let cumulative = 0;
  let remainingShield = target.currentShield ?? 0;
  let remainingHp = target.currentHp ?? resolveBaseHp(target);
  let turnsToKill: number | 'unreachable' = 'unreachable';

  rotation.turns.forEach((turn, turnIdx) => {
    const turnState = initTurnState();
    const isFirstAttackOfTurn: Record<string, boolean> = {};
    for (const m of rotation.members) isFirstAttackOfTurn[m.id] = true;
    let turnTotal = 0;

    turn.actions.forEach((action, actionIdx) => {
      const member = memberById[action.memberId];
      if (!member) return;
      const state = states[action.memberId];

      // 1. Cooldown gate — per-member.
      if (!canFireAbility(action.attack.profile, state)) {
        const abilityId = action.attack.profile.abilityId ?? '<unknown>';
        perMember[action.memberId].cooldownSkips.push({ turnIdx, abilityId });
        teamCooldownSkips.push({ turnIdx, memberId: action.memberId, abilityId });
        return;
      }

      // 2. Compute team-derived buffs + merge with the user's action buffs.
      const teamBuffs = deriveTeamBuffs(
        member,
        rotation.members,
        action.attack.profile,
        turnState,
        turnIdx,
        teamBuffApplications,
      );
      const combinedBuffs: TurnBuff[] = [...(action.buffs ?? []), ...teamBuffs];
      const buffedAttacker = applyTurnBuffs(member.attacker, combinedBuffs);

      // 3. Scaling (Kariyan-style) per that member's state.
      const matchedAbility = abilityFor(buffedAttacker, action.attack.profile);
      const scaleMul = scalingMultiplier(matchedAbility, state);
      const scaledProfile = applyScaling(action.attack.profile, scaleMul);

      // 4. Bonus hits (per-turn buffs) — applied after scaling so extra
      //    hits resolve with the scaled profile.
      const adjustedProfile = applyBonusHits(scaledProfile, combinedBuffs, turnIdx === 0);
      const adjustedCtx: AttackContext = { ...action.attack, profile: adjustedProfile };

      // 5. Resolve attack; drain shield/HP.
      const runAttack = (ctx: AttackContext) => {
        const stepTarget: Target = {
          ...target,
          currentShield: remainingShield,
          currentHp: remainingHp,
        };
        const result = resolveAttack(buffedAttacker, stepTarget, ctx);
        let dmgLeft = result.expected;
        if (remainingShield > 0) {
          const absorbed = Math.min(remainingShield, dmgLeft);
          remainingShield -= absorbed;
          dmgLeft -= absorbed;
        }
        remainingHp = Math.max(0, remainingHp - dmgLeft);
        turnTotal += result.expected;
        return result;
      };

      const result = runAttack(adjustedCtx);
      perMember[action.memberId].perAction.push({
        turnIdx,
        actionIdx,
        result,
      });

      // 6. Stamp cooldown on the actor.
      stampCooldown(buffedAttacker, action.attack.profile, state);

      // 7. Passive triggers on the actor.
      for (const passive of buffedAttacker.source.abilities) {
        const fire = shouldTrigger(passive, {
          profile: action.attack.profile,
          isFirstAttackOfTurn: isFirstAttackOfTurn[action.memberId],
          targetTraits: collectTargetTraits(target),
        });
        if (!fire) continue;
        passive.profiles.forEach((p, profileIdx) => {
          const passiveCtx: AttackContext = {
            profile: applyBonusHits(p, combinedBuffs, turnIdx === 0),
            rngMode: action.attack.rngMode,
          };
          const passiveResult = runAttack(passiveCtx);
          perMember[action.memberId].perAction.push({
            turnIdx,
            actionIdx,
            result: passiveResult,
          });
          perMember[action.memberId].triggeredFires.push({
            turnIdx,
            abilityId: passive.id,
            profileIdx,
          });
        });
      }

      // 8. Update reactive flags AFTER resolving, so order-sensitive buffs
      //    (outrage contributions, spore-mine-hit) don't apply to the
      //    triggering action itself. The resolved scheduled-attack result
      //    feeds per-hit data to Laviscus's Outrage ledger; triggered
      //    passives don't feed Outrage (they're not "friendly attacks"
      //    in the normal sense).
      updateTurnStateAfterAction(member, action.attack, result, rotation.members, turnState);

      isFirstAttackOfTurn[action.memberId] = false;
    });

    // End-of-turn per-member ticks.
    for (const m of rotation.members) {
      tickCooldowns(states[m.id]);
      states[m.id].turnsAttackedThisBattle++;
    }

    cumulative += turnTotal;
    cumulativeTeamExpected.push(cumulative);
    if (remainingHp <= 0 && turnsToKill === 'unreachable') {
      turnsToKill = turnIdx + 1;
    }
  });

  return {
    perMember,
    cumulativeTeamExpected,
    turnsToKill,
    teamBuffApplications,
    cooldownSkips: teamCooldownSkips,
  };
}
