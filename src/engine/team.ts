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
 *  - `biovoreMythicAcid`: once a Biovore-teamBuff carrier fires an ability
 *    that damages the target this turn, subsequent attacks that turn from
 *    Mythic-tier allies get `+pctByStar[pos]%` damage where `pos` is
 *    Biovore's position within the Mythic rarity (`progressionPositionInRarity`
 *    → 0..3 for Mythic 1★..4★). Biovore HIMSELF must be Mythic for the
 *    passive to activate — lower-rarity Biovores produce no bonus even
 *    though they carry the teamBuff. The effect is detected by teamBuff
 *    presence on the actor, not by specific ability id, so both
 *    `biovore_spore_mines_launcher` and `biovore_bio_minefield` trigger it.
 *    Biovore does not buff himself. Ordering-sensitive: Biovore's damaging
 *    action must resolve before the Mythic ally attacks.
 *
 *  - `vitruviusMasterAnnihilator`: when a Vitruvius-teamBuff carrier performs
 *    a normal (melee/ranged) attack that damages the target, the target is
 *    MARKED for the rest of the battle. Subsequent friendly non-psychic
 *    attacks against the marked target score +1 additional hit, capped at
 *    `capByLevel[level-1]` damage each (pre- and post-armor bands both
 *    clamped so shield and HP each respect the cap). The mark persists
 *    across turns — state lives at battle level, not turn level. In the
 *    single-boss MVP the "attacks a different unit" clause that would clear
 *    the mark never fires. Multiple Vitruviuses on the same team each
 *    contribute one +1 hit; the tightest cap is kept (see
 *    `rotation.ts::applyBonusHits`).
 *
 * Intentionally NOT modelled yet: aura persistence across turns for
 * Laviscus/Trajann (Vitruvius now persists; others still recompute per-turn),
 * multi-target spore mines, non-adjacency aura shapes, conditional-on-
 * stance/traits buffs. Those land when hand-authoring surfaces the need.
 */
import { resolveAttack } from './attack';
import { progressionPositionInRarity } from './progression';
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
  /**
   * Per-Biovore: which of their `pctByStar` bonuses applies this turn,
   * resolved from their own Mythic star position when the spore mine hits.
   * Indexed by Biovore's memberId. Read by `deriveTeamBuffs` when
   * sporeMineDamagedTarget is true.
   */
  biovoreAcidPct: Record<string, number>;
}

/**
 * Battle-level state — threaded across turns. Currently only holds
 * Vitruvius's mark (persists once set because the single-boss MVP never
 * sees him attack a different target). Cleanly separate from TurnState so
 * turn-local flags (Laviscus, Trajann, Biovore) still reset cleanly each
 * turn loop.
 */
interface BattleState {
  /** Memberids of Vitruvius-teamBuff carriers whose mark is active. */
  vitruviusMarkedSources: Set<string>;
}

function initTurnState(): TurnState {
  return {
    outrageContributions: {},
    laviscusOutrageResetThisTurn: {},
    friendlyActiveFiredThisTurn: false,
    memberNonNormalAttackHappened: {},
    sporeMineDamagedTarget: false,
    biovoreAcidPct: {},
  };
}

function initBattleState(): BattleState {
  return { vitruviusMarkedSources: new Set() };
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
  battle: BattleState,
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

  // ------ 5) Biovore Mythic Acid: once Biovore's ability has damaged the
  //        target this turn, Mythic-tier allies get a star-scaled damage %
  //        bonus. Biovore himself must be Mythic for the passive to have
  //        activated in the first place — the `biovoreAcidPct` ledger is
  //        populated only when the carrier is Mythic (see
  //        updateTurnStateAfterAction). Biovore does not self-buff.
  if (turn.sporeMineDamagedTarget && member.attacker.progression.rarity === 'mythic') {
    for (const other of team) {
      if (other.id === member.id) continue;
      const bio = teamBuffOf(other, 'biovoreMythicAcid');
      if (!bio) continue;
      const pct = turn.biovoreAcidPct[other.id];
      if (pct === undefined || pct <= 0) continue;
      buffs.push({
        id: `mythic-acid:${other.id}`,
        name: 'Mythic Acid',
        damageMultiplier: 1 + pct / 100,
      });
      const starPos = progressionPositionInRarity(other.attacker.progression.stars);
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'biovoreMythicAcid',
        appliedToMemberId: member.id,
        effect: `+${pct}% damage (Biovore Mythic ${starPos + 1}★ hit target)`,
      });
    }
  }

  // ------ 6) Vitruvius Master Annihilator: once Vitruvius has marked the
  //        target with a normal attack (this turn or an earlier one), every
  //        friendly non-psychic attack against the target scores +1 hit,
  //        capped at `capByLevel[passiveLevel-1]` damage. Multiple
  //        Vitruviuses stack to +N hits; the tightest cap wins (see
  //        applyBonusHits). Psychic attacks are excluded by the damage-type
  //        check here — they still attack normally, they just don't add a
  //        hit. Vitruvius HIMSELF qualifies as a friendly unit, so his
  //        subsequent attacks after the marking attack also get the bonus.
  if (
    battle.vitruviusMarkedSources.size > 0 &&
    currentProfile.damageType !== 'psychic'
  ) {
    for (const other of team) {
      if (!battle.vitruviusMarkedSources.has(other.id)) continue;
      const anni = teamBuffOf(other, 'vitruviusMasterAnnihilator');
      if (!anni) continue;
      // Resolve cap from the passive's ability-level entry; fall back to
      // level 1 when the attacker has no explicit ability-level data.
      const passiveAbility = findAbilityWithTeamBuff(
        other.attacker.source,
        'vitruviusMasterAnnihilator',
      );
      const passiveId = passiveAbility?.id;
      const lvlEntry = passiveId
        ? other.attacker.abilityLevels?.find((a) => a.id === passiveId)
        : undefined;
      const level = Math.max(1, lvlEntry?.level ?? 1);
      const cap = anni.capByLevel[
        Math.min(level - 1, anni.capByLevel.length - 1)
      ];
      buffs.push({
        id: `master-annihilator:${other.id}`,
        name: 'Master Annihilator',
        bonusHits: 1,
        bonusHitsOn: 'all',
        bonusHitCap: cap,
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'vitruviusMasterAnnihilator',
        appliedToMemberId: member.id,
        effect: `+1 hit capped at ${cap} (Vitruvius marked, L${level})`,
      });
    }
  }

  return buffs;
}

// ---------------------------------------------------------------------------
// Reactive state updates (post-action)
// ---------------------------------------------------------------------------

/** After an action resolves, update the turn-local AND battle-level
 *  reactive flags. */
function updateTurnStateAfterAction(
  actor: TeamMember,
  attack: AttackContext,
  result: DamageBreakdown,
  team: TeamMember[],
  turn: TurnState,
  battle: BattleState,
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

  // Biovore Mythic Acid: the teamBuff lives on a passive in the catalog
  // (no profiles of its own), so matching by `abilityId` — as an older
  // version did — never fires. Instead: the carrier is the actor, the
  // action is any ability that actually damaged the target, AND the
  // carrier must be Mythic themselves. Biovore's own star position within
  // Mythic (0..3) chooses which `pctByStar` entry applies this turn.
  const bio = teamBuffOf(actor, 'biovoreMythicAcid');
  if (
    bio &&
    actor.attacker.progression.rarity === 'mythic' &&
    attack.profile.kind === 'ability' &&
    result.expected > 0
  ) {
    const pos = Math.max(
      0,
      Math.min(bio.pctByStar.length - 1, progressionPositionInRarity(actor.attacker.progression.stars)),
    );
    const pct = bio.pctByStar[pos];
    turn.sporeMineDamagedTarget = true;
    turn.biovoreAcidPct[actor.id] = pct;
  }

  // Vitruvius Master Annihilator: a normal (melee/ranged) attack by the
  // carrier that actually damages the target MARKS that target. In the
  // single-boss MVP the mark persists for the rest of the battle — the
  // "attacks a different unit" clause that clears it never fires here.
  const anni = teamBuffOf(actor, 'vitruviusMasterAnnihilator');
  if (
    anni &&
    (attack.profile.kind === 'melee' || attack.profile.kind === 'ranged') &&
    result.expected > 0
  ) {
    battle.vitruviusMarkedSources.add(actor.id);
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
  const battleState = initBattleState();
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
        battleState,
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
      updateTurnStateAfterAction(
        member,
        action.attack,
        result,
        rotation.members,
        turnState,
        battleState,
      );

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
