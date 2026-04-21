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
 *  - `laviscusOutrage`: Laviscus aura-buffs adjacent allies' damage by
 *    `outragePct` (passive aura; always-on while adjacent). Laviscus
 *    himself gains `critDmgPerContributor` × N crit damage where N is
 *    the number of adjacent allies who have *already* acted this turn
 *    at the moment Laviscus attacks. Order-sensitive: if Laviscus goes
 *    first, he has no contributors. Actions process in schedule order.
 *
 *  - `trajannLegendaryCommander`: Trajann grants adjacent Shield Host
 *    allies `extraHitsAdjacentToSelf` extra normal-attack hits (passive
 *    aura). Additionally, if any Shield Host ally has used an active
 *    earlier this turn, every attack this turn — from any member — gets
 *    `flatDamage` added. Shield Host is gated on a `shieldHost` trait
 *    the beneficiary carries; if the catalog hasn't tagged anyone with
 *    that trait yet, the effect stays dormant (correct by-design
 *    degradation).
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
  CatalogAbility,
  CatalogCharacter,
  MemberBreakdown,
  TeamBuffApplication,
  TeamMember,
  TeamPosition,
  TeamRotation,
  TeamRotationBreakdown,
  Target,
  TraitId,
  TurnBuff,
} from './types';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isAdjacent(a: TeamPosition, b: TeamPosition): boolean {
  return Math.abs(a - b) === 1;
}

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

function memberHasTrait(member: TeamMember, trait: TraitId): boolean {
  return (member.attacker.source.traits ?? []).includes(trait);
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
   * For each Laviscus member (by memberId), the running count of adjacent
   * allies who have acted during this turn. Laviscus's buff reads this at
   * the moment he attacks.
   */
  outrageContributors: Record<string, number>;
  /**
   * True once any Shield Host ally has fired an `active` ability during
   * this turn. Gates Trajann's flat-damage component.
   */
  shieldHostUsedActiveThisTurn: boolean;
  /**
   * True once a Biovore Spore-Mine ability has damaged the target this
   * turn. Gates biovoreMythicAcid for Mythic allies that act afterward.
   */
  sporeMineDamagedTarget: boolean;
}

function initTurnState(): TurnState {
  return {
    outrageContributors: {},
    shieldHostUsedActiveThisTurn: false,
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
  turn: TurnState,
  turnIdx: number,
  appsSink: TeamBuffApplication[],
): TurnBuff[] {
  const buffs: TurnBuff[] = [];

  // ------ 1) Laviscus Outrage aura: damage buff from adjacent Laviscus ----
  for (const other of team) {
    if (other.id === member.id) continue;
    if (!isAdjacent(other.position, member.position)) continue;
    const outrage = teamBuffOf(other, 'laviscusOutrage');
    if (!outrage) continue;
    buffs.push({
      id: `outrage-aura:${other.id}`,
      name: 'Outrage',
      damageMultiplier: 1 + outrage.outragePct / 100,
    });
    appsSink.push({
      turnIdx,
      sourceMemberId: other.id,
      kind: 'laviscusOutrage',
      appliedToMemberId: member.id,
      effect: `+${outrage.outragePct}% damage (adjacent to ${other.attacker.source.displayName})`,
    });
  }

  // ------ 2) Laviscus self: crit-damage per adjacent ally who already acted
  const ownOutrage = teamBuffOf(member, 'laviscusOutrage');
  if (ownOutrage) {
    const contributors = turn.outrageContributors[member.id] ?? 0;
    if (contributors > 0) {
      const critDmg = contributors * ownOutrage.critDmgPerContributor;
      buffs.push({
        id: 'outrage-self',
        name: 'Outrage (contributors)',
        critDamage: critDmg,
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: member.id,
        kind: 'laviscusOutrage',
        appliedToMemberId: member.id,
        effect: `+${critDmg} crit dmg (${contributors} contributor${contributors === 1 ? '' : 's'})`,
      });
    }
  }

  // ------ 3) Trajann LegendaryCommander aura: extra normal-attack hits on
  //        adjacent Shield Host allies.
  for (const other of team) {
    if (other.id === member.id) continue;
    if (!isAdjacent(other.position, member.position)) continue;
    const cmdr = teamBuffOf(other, 'trajannLegendaryCommander');
    if (!cmdr) continue;
    if (!memberHasTrait(member, 'shieldHost')) continue; // trait gate
    if (cmdr.extraHitsAdjacentToSelf > 0) {
      buffs.push({
        id: `trajann-hits:${other.id}`,
        name: 'Legendary Commander (hits)',
        bonusHits: cmdr.extraHitsAdjacentToSelf,
        bonusHitsOn: 'normal',
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'trajannLegendaryCommander',
        appliedToMemberId: member.id,
        effect: `+${cmdr.extraHitsAdjacentToSelf} hits (Shield Host adjacent to ${other.attacker.source.displayName})`,
      });
    }
  }

  // ------ 4) Trajann flat damage: if a Shield Host ally used an active
  //        earlier this turn, every member gets a flat damage bonus.
  if (turn.shieldHostUsedActiveThisTurn) {
    // Apply once per Trajann-carrier present on the team (stacks if, say,
    // two Trajanns are somehow fielded — catalog doesn't restrict).
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
        effect: `+${cmdr.flatDamage} flat dmg (Shield Host active fired)`,
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
  team: TeamMember[],
  turn: TurnState,
): void {
  // Laviscus outrage: if this actor is adjacent to a Laviscus, they become
  // that Laviscus's contributor.
  for (const other of team) {
    if (other.id === actor.id) continue;
    if (!isAdjacent(other.position, actor.position)) continue;
    if (!teamBuffOf(other, 'laviscusOutrage')) continue;
    turn.outrageContributors[other.id] =
      (turn.outrageContributors[other.id] ?? 0) + 1;
  }

  // Trajann: Shield Host ally used an active?
  if (
    attack.profile.kind === 'ability' &&
    memberHasTrait(actor, 'shieldHost') &&
    isAbilityActive(actor.attacker, attack.profile.abilityId)
  ) {
    turn.shieldHostUsedActiveThisTurn = true;
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
 *     g. Update turn-local reactive flags (outrage contributors, spore-
 *        mine, shield-host-active).
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
      //    (outrage contributors, spore-mine-hit) don't apply to the
      //    triggering action itself.
      updateTurnStateAfterAction(member, action.attack, rotation.members, turnState);

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
