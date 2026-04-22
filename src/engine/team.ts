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
 *  - `trajannLegendaryCommander`: enemies receive +X damage (per-level
 *    `flatDamageByLevel`) from any attack while they are adjacent to a
 *    friendly that has used an active ability earlier this turn. Per the
 *    wiki, the trigger is explicitly "a Character uses an active" — MoWs
 *    firing actives do NOT arm it (gated by `isMachineOfWar`). For single-
 *    boss Guild Raid we treat the boss as always-adjacent to every team
 *    member, so the position filter collapses to "a friendly Character
 *    fired an active earlier this turn". Additionally, if the affected
 *    enemy is also adjacent to Trajann (again: always true in single-boss
 *    MVP if Trajann is on the team), friendly Characters score +Y
 *    additional hits (per-level `extraHitsByLevel`) on their FIRST attack
 *    that is not a normal attack (i.e. first ability attack OR first
 *    triggered-passive ability profile) against that enemy this turn.
 *    Per-member: each friendly Character gets the bonus exactly once, on
 *    their first non-normal attack after the trigger has fired. MoW allies
 *    do NOT receive the +Y hits (recipient gate on `isMachineOfWar`).
 *    Trajann himself must also be scheduled somewhere in the rotation
 *    (`membersInRotation` gate — any turn, any action) or no buff applies;
 *    that captures "Trajann is dead / not on the board". Crucially the
 *    gate is NOT order-dependent within a turn: once Trajann is in the
 *    rotation, his aura applies whenever the in-turn trigger fires,
 *    regardless of whether his action comes before or after the attack
 *    receiving the buff. The per-level tables are indexed via the Trajann
 *    Legendary Commander passive's level (abilityLevels entry → xpLevel →
 *    1 fallback).
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
 *  - `aesothStandVigil`: a positional aura that grants +Y% damage on
 *    non-normal attacks (abilities, including triggered-passive ability
 *    profiles) to friendly units within 1 hex of an Aesoth-teamBuff
 *    carrier. When any friendly Adeptus Custodes resolves an `active`
 *    ability this turn, the aura extends to `extendedRangeHexes` hexes
 *    for the rest of the turn (wiki: "for 1 round"). Aesoth herself is
 *    excluded — "friendly surrounding units" means other friendlies, not
 *    the source. MoW recipients ARE eligible (wiki says "units", not
 *    "Characters"). The passive also grants +X Armour to affected allies,
 *    but armor is a defensive stat and the calculator models outgoing
 *    damage only — the armor component is surfaced in the applications
 *    sink for UI transparency and nothing more.
 *
 *  - `helbrechtCrusadeOfWrath`: an active ability that arms a positional
 *    damage + pierce aura on every MELEE attack from friendlies within
 *    `rangeHexes` (2 per wiki) of Helbrecht — self-included (distance 0
 *    satisfies "within 2 hexes"). Once Helbrecht's active resolves on
 *    turn N, the aura persists through turn N + `durationTurns` - 1
 *    (durationTurns=2 maps to "for this round and the next"). State
 *    lives at battle level (`helbrechtCrusadeActiveUntil` keyed by
 *    Helbrecht memberId). Order-sensitive within turn N: friendlies that
 *    attacked BEFORE Helbrecht's active don't get the buff; on turn N+1
 *    the buff is unconditional. The wiki's "regardless of damage type"
 *    clause is irrelevant here — we gate on kind=melee, which already
 *    covers both power and bolter melee profiles.
 *
 *  - `helbrechtDestroyTheWitch`: a pure positional passive. Helbrecht and
 *    friendlies within `rangeHexes` (1 per wiki: self + adjacent) gain
 *    +flat damage on MELEE attacks when the target carries the
 *    `requiresTargetTrait` trait ('psyker'). No activation required; the
 *    aura is always-on. The +1 Movement component of the passive is
 *    irrelevant to the damage calculator and is omitted.
 *
 * Positional auras (Helbrecht, Aesoth) intentionally filter by hex
 * distance rather than buffing the entire team. This maps the in-game
 * adjacency model — a linear 5-slot formation where `|Δposition|` is the
 * hex distance — and naturally limits "range" effects to 2-3 teammates
 * instead of all five.
 *
 * Intentionally NOT modelled yet: aura persistence across turns for
 * Laviscus/Trajann (Vitruvius now persists; others still recompute per-turn),
 * multi-target spore mines, non-adjacency aura shapes (other than
 * Stand Vigil's 1-hex/2-hex positional aura), conditional-on-stance/traits
 * buffs. Those land when hand-authoring surfaces the need.
 */
import { resolveAttack } from './attack';
import { progressionPositionFromStarLevel } from './progression';
import { applyBonusHits, applyPierceBuffs, applyTurnBuffs } from './rotation';
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

/**
 * Machine-of-War detection. The catalog tags MoW units (Biovore, Exorcist,
 * Galatian, Forgefiend, Plagueburst Crawler, Malleus, Rukkatrukk, Tson'ji,
 * Z'Kar, …) with the lowercase trait `machine of war`. TeamComposer uses
 * this same rule to keep MoW entries out of hero slots; the engine uses it
 * to gate mechanics that explicitly target "Characters" (heroes) only —
 * e.g. Trajann's Legendary Commander is armed by a Character's active, not
 * a MoW's; and only Character recipients gain the +Y extra-hits clause.
 */
function isMachineOfWar(src: CatalogCharacter): boolean {
  return (src.traits ?? []).some(
    (trait) => trait.toLowerCase() === 'machine of war',
  );
}

/**
 * Resolve the level that drives a team-buff carrier's per-level table.
 * Priority: explicit `abilityLevels` entry for the given passive id →
 * fallback to `progression.xpLevel` → final fallback 1. This mirrors the
 * Vitruvius Master Annihilator resolution (which handles unowned-hero
 * catalog entries where per-ability levels aren't populated).
 */
function resolveTeamBuffLevel(
  member: TeamMember,
  buffKind: AbilityTeamBuff['kind'],
): number {
  const ability = findAbilityWithTeamBuff(member.attacker.source, buffKind);
  const passiveId = ability?.id;
  const lvlEntry = passiveId
    ? member.attacker.abilityLevels?.find((a) => a.id === passiveId)
    : undefined;
  return Math.max(
    1,
    lvlEntry?.level ?? member.attacker.progression.xpLevel ?? 1,
  );
}

/** Pick the level-indexed value from a per-level array, clamping to its
 *  last entry for levels past the end. */
function atLevel<T>(arr: readonly T[], level: number): T {
  const idx = Math.max(0, Math.min(arr.length - 1, level - 1));
  return arr[idx];
}

/** Resolve Trajann's per-level flat damage (X) and the level used to pick
 *  it. Split out so both the buffs-array push and the applications-sink
 *  label read the same numbers. */
function trajannFlat(
  other: TeamMember,
  cmdr: AbilityTeamBuff & { kind: 'trajannLegendaryCommander' },
): { flat: number; level: number } {
  const level = resolveTeamBuffLevel(other, 'trajannLegendaryCommander');
  return { flat: atLevel(cmdr.flatDamageByLevel, level), level };
}

/** Resolve Trajann's per-level extra hits (Y) and the level used to pick
 *  it. Returns 0 hits when the table is empty (no-op). */
function trajannHits(
  other: TeamMember,
  cmdr: AbilityTeamBuff & { kind: 'trajannLegendaryCommander' },
): { hits: number; level: number } {
  const level = resolveTeamBuffLevel(other, 'trajannLegendaryCommander');
  return { hits: atLevel(cmdr.extraHitsByLevel, level), level };
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
  /**
   * True once any friendly Adeptus Custodes has resolved an `active`
   * ability this turn. Arms the extended (2-hex) range of Aesoth's
   * Stand Vigil aura for the rest of the turn (wiki: "for 1 round").
   * Resets each turn loop. Order-sensitive within a turn — allies that
   * acted BEFORE the Custodes active still see only the 1-hex base aura.
   */
  custodesActiveFiredThisTurn: boolean;
}

/**
 * Battle-level state — threaded across turns. Currently only holds
 * Vitruvius's mark (persists once set because the single-boss MVP never
 * sees him attack a different target). Cleanly separate from TurnState so
 * turn-local flags (Laviscus, Trajann, Biovore) still reset cleanly each
 * turn loop.
 */
interface BattleState {
  /**
   * Target trait list resolved once at battle start. Cached here so
   * positional team buffs with trait gates (Helbrecht's Destroy the Witch
   * requires the target to carry 'psyker') don't re-resolve stage traits
   * for every derivation call. The single-boss MVP keeps target traits
   * static across the battle, so caching is safe.
   */
  targetTraits: TraitId[];
  /** Memberids of Vitruvius-teamBuff carriers whose mark is active. */
  vitruviusMarkedSources: Set<string>;
  /**
   * Memberids of every team member that the rotation schedules for at
   * least one action anywhere (any turn, any action kind). Populated
   * once at battle start from the rotation definition — NOT accumulated
   * turn-by-turn. Gates team buffs whose carrier must be present on the
   * battlefield for the buff to apply — e.g. Trajann's Legendary
   * Commander stops granting +flat / +hits when Trajann is on the
   * roster but never scheduled (stand-in for "Trajann is dead / not on
   * the board yet"). Intentionally order-independent within a turn:
   * Trajann's mere presence in the rotation is what matters, not
   * whether his action resolved before the attack being buffed.
   */
  membersInRotation: Set<string>;
  /**
   * Per-Helbrecht: the last turn index (inclusive) through which his
   * Crusade of Wrath aura applies, once his active has fired. Map key is
   * Helbrecht's memberId. Absent key means "Crusade has not fired yet" —
   * no aura. When Helbrecht fires Crusade on turn N, we set the entry to
   * `N + durationTurns - 1` so the aura covers turn N and N+1 by default
   * ("this round and the next"). Subsequent firings extend the window if
   * they land later (cooldown permitting).
   *
   * Order-sensitive within turn N (the aura arms AFTER Helbrecht's active
   * resolves), unconditionally present on all of turn N+1.
   */
  helbrechtCrusadeActiveUntil: Record<string, number>;
}

function initTurnState(): TurnState {
  return {
    outrageContributions: {},
    laviscusOutrageResetThisTurn: {},
    friendlyActiveFiredThisTurn: false,
    memberNonNormalAttackHappened: {},
    sporeMineDamagedTarget: false,
    biovoreAcidPct: {},
    custodesActiveFiredThisTurn: false,
  };
}

function initBattleState(rotation: TeamRotation, target: Target): BattleState {
  // `membersInRotation` captures every member that the rotation schedules
  // for at least one action anywhere. Computed once up front (not
  // turn-by-turn) so Trajann's buff does NOT depend on whether his action
  // has resolved before the attack being buffed — only on whether he's
  // scheduled somewhere in the rotation.
  const membersInRotation = new Set<string>();
  for (const turn of rotation.turns) {
    for (const action of turn.actions) {
      membersInRotation.add(action.memberId);
    }
  }
  return {
    targetTraits: collectTargetTraits(target),
    vitruviusMarkedSources: new Set(),
    membersInRotation,
    helbrechtCrusadeActiveUntil: {},
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
  //        friendly Character has fired an active earlier this turn. Applies
  //        to EVERY team member's attacks against the enemy (Characters and
  //        MoWs alike — the flat-damage clause is not restricted to
  //        Characters, only the trigger and the extra-hits clause are).
  //        Additionally: Trajann must be present on the battlefield,
  //        modelled as "scheduled somewhere in the rotation"
  //        (`membersInRotation` gate) — if he's on the roster but the
  //        rotation never schedules him, he doesn't grant the buff.
  //        Crucially this gate is NOT order-sensitive within a turn:
  //        Trajann scheduled LAST still buffs attacks from #1, #2, #3.
  if (turn.friendlyActiveFiredThisTurn) {
    for (const other of team) {
      const cmdr = teamBuffOf(other, 'trajannLegendaryCommander');
      if (!cmdr) continue;
      if (!battle.membersInRotation.has(other.id)) continue;
      const { flat, level } = trajannFlat(other, cmdr);
      buffs.push({
        id: `trajann-flat:${other.id}`,
        name: 'Legendary Commander (flat)',
        damageFlat: flat,
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'trajannLegendaryCommander',
        appliedToMemberId: member.id,
        effect: `+${flat} flat dmg (L${level}, friendly active fired)`,
      });
    }
  }

  // ------ 4) Trajann LegendaryCommander: extra hits on a friendly
  //        Character's FIRST non-normal attack this turn, once the flat-
  //        damage trigger has fired AND Trajann is present in the rotation.
  //        Gated on:
  //          - a friendly Character fired an active earlier this turn
  //            (arms `friendlyActiveFiredThisTurn`, MoW actives don't arm)
  //          - current action/passive-profile is an ability (a "not normal
  //            attack" in wiki terms)
  //          - this member hasn't yet resolved a non-normal attack this
  //            turn (per-member `memberNonNormalAttackHappened` ledger)
  //          - THIS MEMBER is itself a Character (MoWs don't receive the
  //            extra hits — wiki specifies "friendly Characters score Y")
  //          - Trajann is scheduled somewhere in the rotation
  //            (`membersInRotation` — order-independent within a turn)
  //        The ledger is updated right before passive triggers run (so
  //        passives re-deriving buffs don't double-dip), and also in
  //        `updateTurnStateAfterAction` as a belt-and-suspenders for the
  //        scheduled-action path.
  if (
    turn.friendlyActiveFiredThisTurn &&
    currentProfile.kind === 'ability' &&
    !turn.memberNonNormalAttackHappened[member.id] &&
    !isMachineOfWar(member.attacker.source)
  ) {
    for (const other of team) {
      const cmdr = teamBuffOf(other, 'trajannLegendaryCommander');
      if (!cmdr) continue;
      if (!battle.membersInRotation.has(other.id)) continue;
      const { hits, level } = trajannHits(other, cmdr);
      if (hits <= 0) continue;
      buffs.push({
        id: `trajann-hits:${other.id}`,
        name: 'Legendary Commander (hits)',
        bonusHits: hits,
        bonusHitsOn: 'ability',
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'trajannLegendaryCommander',
        appliedToMemberId: member.id,
        effect: `+${hits} hits on first ability (L${level}, Trajann)`,
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
      const starPos = progressionPositionFromStarLevel(
        other.attacker.progression.stars,
        other.attacker.progression.rarity,
      );
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
      // xpLevel when no explicit per-ability entry exists (matches
      // BuildEditor's `defaultLevel={build.xpLevel}` convention). Final
      // fallback is 1. Unowned heroes never have abilityLevels populated,
      // so xpLevel is the best available proxy.
      const level = resolveTeamBuffLevel(other, 'vitruviusMasterAnnihilator');
      const cap = atLevel(anni.capByLevel, level);
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

  // ------ 7) Aesoth Stand Vigil: +Y% damage on non-normal attacks from
  //        friendly units within 1 hex of Aesoth (or within
  //        `extendedRangeHexes` when a friendly Custodes has resolved an
  //        active earlier this turn). Self-excluded — "friendly surrounding
  //        units" means other friendlies, not Aesoth herself. MoW recipients
  //        are eligible (wiki says "friendly units", not "friendly
  //        Characters"). Armor component of the aura (+X Armour) is
  //        surfaced in the applications sink as metadata only: the
  //        calculator models outgoing damage, so a recipient's armor bonus
  //        has no effect on the numbers we compute here.
  if (currentProfile.kind === 'ability') {
    for (const other of team) {
      if (other.id === member.id) continue;
      const sv = teamBuffOf(other, 'aesothStandVigil');
      if (!sv) continue;
      if (!battle.membersInRotation.has(other.id)) continue;
      const range = turn.custodesActiveFiredThisTurn ? sv.extendedRangeHexes : 1;
      const dist = Math.abs(member.position - other.position);
      if (dist > range) continue;
      const level = resolveTeamBuffLevel(other, 'aesothStandVigil');
      const pct = atLevel(sv.extraDmgPctByLevel, level);
      const armor = atLevel(sv.extraArmorByLevel, level);
      if (pct > 0) {
        buffs.push({
          id: `stand-vigil:${other.id}`,
          name: 'Stand Vigil',
          damageMultiplier: 1 + pct / 100,
        });
      }
      const extendedNote = turn.custodesActiveFiredThisTurn ? ', Custodes extended' : '';
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'aesothStandVigil',
        appliedToMemberId: member.id,
        effect: `+${pct}% dmg on non-normal (+${armor} armour, L${level}, ${dist}-hex${extendedNote})`,
      });
    }
  }

  // ------ 8) Helbrecht Crusade of Wrath: +flat damage and +% pierce on
  //        MELEE attacks for friendlies within `rangeHexes` of Helbrecht,
  //        active for `durationTurns` turns starting when Helbrecht fires
  //        the active. Self-included (distance 0 ≤ 2 satisfies "within 2
  //        hexes"). Gated by `battle.helbrechtCrusadeActiveUntil[helbId] >=
  //        turnIdx` — the map is populated only after Helbrecht's active
  //        resolves (see updateTurnStateAfterAction), so turn-N attacks
  //        before his active don't benefit.
  if (currentProfile.kind === 'melee') {
    for (const other of team) {
      const cow = teamBuffOf(other, 'helbrechtCrusadeOfWrath');
      if (!cow) continue;
      const activeUntil = battle.helbrechtCrusadeActiveUntil[other.id];
      if (activeUntil === undefined || activeUntil < turnIdx) continue;
      if (Math.abs(member.position - other.position) > cow.rangeHexes) continue;
      const level = resolveTeamBuffLevel(other, 'helbrechtCrusadeOfWrath');
      const flat = atLevel(cow.damageFlatByLevel, level);
      const piercePct = atLevel(cow.piercePctByLevel, level);
      if (flat > 0) {
        buffs.push({
          id: `crusade-flat:${other.id}`,
          name: 'Crusade of Wrath (flat)',
          damageFlat: flat,
        });
      }
      if (piercePct > 0) {
        buffs.push({
          id: `crusade-pierce:${other.id}`,
          name: 'Crusade of Wrath (pierce)',
          pierceAdd: piercePct / 100,
        });
      }
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'helbrechtCrusadeOfWrath',
        appliedToMemberId: member.id,
        effect: `+${flat} flat, +${piercePct}% pierce on melee (L${level}, |Δpos|=${Math.abs(member.position - other.position)}, until T${activeUntil + 1})`,
      });
    }
  }

  // ------ 9) Helbrecht Destroy the Witch: +flat damage on MELEE attacks
  //        for Helbrecht + friendlies within `rangeHexes` (1 = self +
  //        adjacent) when the target has the configured trait ('psyker').
  //        Pure positional passive — no trigger required, no turn-state
  //        dependence. Self-included (distance 0 ≤ 1 satisfies "within 1
  //        hex" and the wiki explicitly says "This unit and friendly
  //        adjacent units").
  if (currentProfile.kind === 'melee') {
    const targetTraits = battle.targetTraits;
    for (const other of team) {
      const dtw = teamBuffOf(other, 'helbrechtDestroyTheWitch');
      if (!dtw) continue;
      if (Math.abs(member.position - other.position) > dtw.rangeHexes) continue;
      const hasTrait = targetTraits.some(
        (t) => t.toLowerCase() === dtw.requiresTargetTrait.toLowerCase(),
      );
      if (!hasTrait) continue;
      const level = resolveTeamBuffLevel(other, 'helbrechtDestroyTheWitch');
      const flat = atLevel(dtw.damageFlatByLevel, level);
      if (flat <= 0) continue;
      buffs.push({
        id: `destroy-witch:${other.id}`,
        name: 'Destroy the Witch',
        damageFlat: flat,
      });
      appsSink.push({
        turnIdx,
        sourceMemberId: other.id,
        kind: 'helbrechtDestroyTheWitch',
        appliedToMemberId: member.id,
        effect: `+${flat} flat melee vs ${dtw.requiresTargetTrait} (L${level}, |Δpos|=${Math.abs(member.position - other.position)})`,
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
  turnIdx: number,
): void {
  // Note: battle-level presence (`membersInRotation`) is populated once
  // in `initBattleState` from the rotation's scheduled actions. It is
  // intentionally not updated here — Trajann's aura must not depend on
  // action ordering within a turn.

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

  // Trajann flat-damage trigger: a friendly CHARACTER firing an active
  // ability this turn arms the flag. Trajann's passive description
  // specifically says "after a Character uses an active" — MoWs firing
  // actives (Biovore's Spore Mines, Exorcist's Salvo, etc.) do NOT arm
  // the trigger, even though they are technically active abilities. The
  // target-adjacency filter is still collapsed to a team-wide boolean in
  // the single-boss MVP (no Shield Host gate).
  if (
    attack.profile.kind === 'ability' &&
    isAbilityActive(actor.attacker, attack.profile.abilityId) &&
    !isMachineOfWar(actor.attacker.source)
  ) {
    turn.friendlyActiveFiredThisTurn = true;
  }

  // Aesoth Stand Vigil extended-range trigger: a friendly ADEPTUS CUSTODES
  // firing an active ability extends the Stand Vigil aura from 1 hex to
  // `extendedRangeHexes` (2 per wiki) for the rest of the turn. Wiki:
  // "If a friendly Adeptus Custodes uses an Active Ability, Stand Vigil
  // affects all other friendly units within 2 hexes for 1 round." Other
  // factions' actives do NOT arm this extension. No MoW gate needed — no
  // Adeptus-Custodes-faction MoWs exist, and a Custodes MoW active would
  // presumably arm the trigger anyway (wiki says nothing narrower than
  // "Adeptus Custodes"), so the check is just the faction match.
  if (
    attack.profile.kind === 'ability' &&
    isAbilityActive(actor.attacker, attack.profile.abilityId) &&
    actor.attacker.source.faction === 'Adeptus Custodes'
  ) {
    turn.custodesActiveFiredThisTurn = true;
  }

  // Helbrecht Crusade of Wrath arming: when THIS actor is a Helbrecht and
  // he just fired his Crusade active, set the aura's "active until" turn
  // to `turnIdx + durationTurns - 1`. This covers turn N (rest-of-turn,
  // since we write the state AFTER Helbrecht's action resolves) and all
  // of turn N+1 for the default `durationTurns: 2`. Re-firing later
  // (cooldown permitting) extends the window rather than truncating.
  const cow = teamBuffOf(actor, 'helbrechtCrusadeOfWrath');
  if (
    cow &&
    attack.profile.kind === 'ability' &&
    attack.profile.abilityId &&
    findAbilityWithTeamBuff(actor.attacker.source, 'helbrechtCrusadeOfWrath')
      ?.id === attack.profile.abilityId
  ) {
    const until = turnIdx + Math.max(1, cow.durationTurns) - 1;
    const prev = battle.helbrechtCrusadeActiveUntil[actor.id];
    battle.helbrechtCrusadeActiveUntil[actor.id] =
      prev !== undefined && prev > until ? prev : until;
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
      Math.min(
        bio.pctByStar.length - 1,
        progressionPositionFromStarLevel(
          actor.attacker.progression.stars,
          actor.attacker.progression.rarity,
        ),
      ),
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
 *     f. Update turn-local reactive flags (outrage contributors,
 *        friendly-active-fired, member-non-normal-happened, spore-mine).
 *        This happens BEFORE triggered passives fire so they see the
 *        scheduled action's effects in turnState (e.g. Trajann's trigger
 *        armed by the scheduled active, applying to its triggered
 *        passives on the same action).
 *     g. Fire matching passives on the actor — each profile re-derives
 *        team buffs against the updated turnState and consumes the same
 *        shield/HP pool. Passive profiles update the per-member
 *        first-non-normal ledger inline so later profiles within the
 *        same trigger don't double-dip Trajann's once-per-turn +Y hits.
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
  const battleState = initBattleState(rotation, target);
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
      //    hits resolve with the scaled profile. Pierce buffs (Helbrecht
      //    Crusade of Wrath) fold into the profile's pierceOverride via a
      //    separate pass so stacking across multiple buffs is additive.
      const withBonusHits = applyBonusHits(scaledProfile, combinedBuffs, turnIdx === 0);
      const adjustedProfile = applyPierceBuffs(withBonusHits, combinedBuffs);
      const adjustedCtx: AttackContext = { ...action.attack, profile: adjustedProfile };

      // 5. Resolve attack; drain shield/HP. `runAttack` takes the attacker
      //    as a parameter so step 8 (passive triggers) can resolve passive
      //    profiles against a freshly-buffed attacker per profile — which
      //    matters when Trajann's +Y hits (or other re-derived team buffs)
      //    should land on a triggered passive even though the scheduled
      //    action's buffs didn't include them.
      const runAttack = (atk: Attacker, ctx: AttackContext) => {
        const stepTarget: Target = {
          ...target,
          currentShield: remainingShield,
          currentHp: remainingHp,
        };
        const result = resolveAttack(atk, stepTarget, ctx);
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

      const result = runAttack(buffedAttacker, adjustedCtx);
      perMember[action.memberId].perAction.push({
        turnIdx,
        actionIdx,
        result,
      });

      // 6. Stamp cooldown on the actor.
      stampCooldown(buffedAttacker, action.attack.profile, state);

      // 7. Update reactive flags for the scheduled action BEFORE triggered
      //    passives fire. Ordering rationale:
      //      - A Character-active arms Trajann's trigger via
      //        `friendlyActiveFiredThisTurn`. Triggered passives on the SAME
      //        turn must see the trigger armed so they can claim +X flat /
      //        +Y hits (the user's explicit report: "When second hit from
      //        passive of Kariyan, Ghulgortz, Kharn or even Abbadon is on i
      //        dont see feedback that they get buff of extra 2 (Y) hits").
      //      - A non-normal scheduled action consumes this member's
      //        first-non-normal slot; a triggered ability-kind passive
      //        profile in the same action should NOT re-claim +Y hits.
      //      - Laviscus's Outrage ledger reflects the scheduled attack's
      //        max hit; triggered passives on the same actor still don't
      //        feed Outrage (they're the SAME actor).
      //    The scheduled action itself resolved at step 5 with the buffs
      //    derived at step 2 (pre-update), so moving this update up does
      //    NOT retroactively buff the scheduled attack.
      updateTurnStateAfterAction(
        member,
        action.attack,
        result,
        rotation.members,
        turnState,
        battleState,
        turnIdx,
      );

      // 8. Passive triggers on the actor. Each passive profile RE-DERIVES
      //    its own team buffs — the scheduled action's `combinedBuffs` may
      //    not include Trajann's +Y hits (the scheduled was a normal
      //    attack, so its derive saw `currentProfile.kind === 'melee'` and
      //    skipped the +Y buff) while the triggered passive IS an ability
      //    and should pick up +Y hits as the member's first non-normal.
      //    Re-derivation also handles the +X flat clause newly armed by
      //    the scheduled action (the scheduled action itself doesn't get
      //    +X, per wiki wording "has used", but the triggered passive
      //    fires after `friendlyActiveFiredThisTurn` is set at step 7).
      for (const passive of buffedAttacker.source.abilities) {
        const fire = shouldTrigger(passive, {
          profile: action.attack.profile,
          isFirstAttackOfTurn: isFirstAttackOfTurn[action.memberId],
          targetTraits: collectTargetTraits(target),
        });
        if (!fire) continue;
        // Stamp `abilityProfileIdx` on multi-profile triggered passives
        // (e.g. Volk Fleshmetal Guns) so applyBonusHits enforces the
        // wiki STMA rule: bonus hits only on the first profile to hit
        // the target. Single-profile passives stay untagged
        // (undefined ≡ 0 ≡ "first profile").
        const isMultiProfile = passive.profiles.length > 1;
        passive.profiles.forEach((p, profileIdx) => {
          const taggedProfile = isMultiProfile
            ? { ...p, abilityProfileIdx: profileIdx }
            : p;
          // Re-derive team buffs AS IF this passive profile were the
          // currently-resolving attack. Picks up Trajann +Y hits on first
          // non-normal per member, Vitruvius marked-target cap, Biovore
          // Mythic Acid if this passive's actor is Mythic, etc.
          const passiveTeamBuffs = deriveTeamBuffs(
            member,
            rotation.members,
            taggedProfile,
            turnState,
            battleState,
            turnIdx,
            teamBuffApplications,
          );
          const passiveCombinedBuffs: TurnBuff[] = [
            ...(action.buffs ?? []),
            ...passiveTeamBuffs,
          ];
          const passiveBuffedAttacker = applyTurnBuffs(
            member.attacker,
            passiveCombinedBuffs,
          );
          const passiveProfileHits = applyBonusHits(
            taggedProfile,
            passiveCombinedBuffs,
            turnIdx === 0,
          );
          const passiveProfile = applyPierceBuffs(
            passiveProfileHits,
            passiveCombinedBuffs,
          );
          const passiveCtx: AttackContext = {
            profile: passiveProfile,
            rngMode: action.attack.rngMode,
          };
          const passiveResult = runAttack(passiveBuffedAttacker, passiveCtx);
          // Mark the per-member "first non-normal of turn" ledger so any
          // subsequent passive profile (same passive's later profiles or a
          // later-iterated passive) doesn't re-claim Trajann's +Y hits.
          // Mirrors what updateTurnStateAfterAction does for scheduled
          // abilities; here we update inline because the passive-profile
          // loop happens AFTER the outer update call.
          if (p.kind === 'ability') {
            turnState.memberNonNormalAttackHappened[action.memberId] = true;
          }
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
