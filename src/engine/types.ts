import type { DamageType } from './dmgTypes';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export const RARITY_ORDER: Rarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
];

export interface BaseStats {
  damage: number;
  armor: number;
  hp: number;
  critChance: number;
  critDamage: number;
  blockChance: number;
  blockDamage: number;
  meleeHits: number;
  rangedHits: number;
}

export interface AttackProfile {
  label: string;
  damageType: DamageType;
  hits: number;
  pierceOverride?: number;
  damageFactor?: number;
  preArmorAddFlat?: number;
  preArmorMultiplier?: number;
  capAt?: 'base' | 'preArmor' | 'finalHit';
  cap?: number;
  kind?: 'melee' | 'ranged' | 'ability';
  abilityId?: string;
  cooldown?: number;
  ignoresCrit?: boolean;
  /**
   * Per-hit cap applied to the trailing `bonusHitCount` hits of this profile.
   * Used by Vitruvius's Master Annihilator: the extra hit granted by a
   * marked target has its own max-damage ceiling, distinct from the
   * profile-wide `cap`. Capping happens on both the pre-armor and post-armor
   * bands so shield consumption and HP damage both respect it.
   *
   * Non-bonus hits (indices `1..hits - bonusHitCount`) are unaffected.
   */
  bonusHitCount?: number;
  bonusHitCap?: number;
  /**
   * Runtime tag (not a catalog field): zero-based index of this profile
   * within the parent multi-profile ability. Stamped when:
   *   - the UI fans a multi-profile active out into one AttackContext per
   *     profile (useDamage.ts / useTeamDamage.ts `attackContextsFor`);
   *   - the engine iterates `passive.profiles` inside a triggered-passive
   *     loop (rotation.ts and team.ts passive-trigger sections).
   * `applyBonusHits` reads this to enforce the wiki Single-Target
   * Multi-Attack (STMA) rule: extra hits (Vitruvius mark, Trajann +Y,
   * Astartes Banner, etc.) apply only to the FIRST profile that hits the
   * target. Undefined / 0 means "first profile or a plain single-profile
   * attack" and is treated identically. Values > 0 mean "subsequent profile
   * of the same multi-attack ability" and receive no bonus-hit additions.
   */
  abilityProfileIdx?: number;
}

export interface ItemStatMods {
  damageFlat?: number;
  damagePct?: number;
  armorFlat?: number;
  hpFlat?: number;
  hpPct?: number;
  critChance?: number;
  critDamage?: number;
  blockChance?: number;
  blockDamage?: number;
  critResist?: number;
  blockResist?: number;
  accuracy?: number;
  dodge?: number;
  meleeDamagePct?: number;
  rangedDamagePct?: number;
  piercing?: number;
}

export const ITEM_STAT_KEYS: (keyof ItemStatMods)[] = [
  'damageFlat',
  'damagePct',
  'armorFlat',
  'hpFlat',
  'hpPct',
  'critChance',
  'critDamage',
  'blockChance',
  'blockDamage',
  'critResist',
  'blockResist',
  'accuracy',
  'dodge',
  'meleeDamagePct',
  'rangedDamagePct',
  'piercing',
];

export type TraitId = string;

/**
 * Trigger for a passive that reacts to in-battle events. Populated on
 * catalog passives that fire their `profiles` automatically (Kharn's
 * Betrayer, Gulgortz's Light 'em Up, Kariyan's Legacy of Combat).
 */
export type AbilityTrigger =
  | { kind: 'afterOwnNormalAttack' }
  | {
      kind: 'afterOwnFirstAttackOfTurn';
      /** Restricts the passive to targets carrying this trait. */
      requiresTargetTrait?: TraitId;
    };

/**
 * Per-battle scaling — each step adds `pctPerStep` to the ability's final
 * damage. Used by Kariyan's Martial Inspiration (+33% damage per turn she
 * has attacked this battle).
 */
export interface AbilityScaling {
  per: 'turnsAttackedThisBattle';
  pctPerStep: number;
}

/**
 * Team-context buffs that only resolve in Guild Raid mode. The engine
 * ignores these outside the team rotation so single-attacker calculations
 * stay pure.
 */
export type AbilityTeamBuff =
  | {
      kind: 'laviscusOutrage';
      /**
       * Laviscus's Outrage stat = per-contributor max non-psychic hit,
       * summed across contributors this turn. This field is the % of
       * accumulated Outrage added to Laviscus's Damage stat as a flat
       * bonus on every attack he makes (before the outrage resets).
       * E.g. outragePctOfOutrage=120 + accumulated Outrage=10000 →
       * +12000 damageFlat.
       */
      outragePctOfOutrage: number;
      /**
       * +crit damage added to Laviscus's NORMAL attacks only (melee/
       * ranged — not abilities), per friendly Chaos character that
       * contributed to Outrage this turn.
       */
      critDmgPerChaosContributor: number;
    }
  | {
      kind: 'trajannLegendaryCommander';
      /**
       * Per-level flat damage bonus (X on the wiki). Enemies receive +X
       * damage from *any* attack while they are adjacent to a friendly
       * Character that has used an active ability earlier this turn. In
       * single-boss Guild Raid the boss is treated as always-adjacent to
       * every team member, so the gate reduces to "a friendly Character
       * fired an active earlier this turn AND Trajann has taken at
       * least one action". Indexed by (level - 1); levels past the array
       * length clamp to the last entry. The level that drives this is
       * Trajann's Legendary Commander passive level (with xpLevel fall-
       * back for unowned heroes, matching Vitruvius).
       */
      flatDamageByLevel: number[];
      /**
       * Per-level extra-hits bonus (Y on the wiki). If the affected enemy
       * is also adjacent to Trajann, friendly Characters score +Y
       * additional hits on their FIRST attack that is not a normal
       * attack (i.e. first ability attack OR first triggered-passive
       * ability profile) against that enemy this turn. In single-boss
       * Guild Raid, "adjacent to Trajann" is assumed whenever Trajann is
       * on the team. MoW allies do NOT receive this bonus — the passive
       * specifies "friendly Characters". Indexed identically to
       * `flatDamageByLevel`.
       */
      extraHitsByLevel: number[];
    }
  | {
      kind: 'biovoreMythicAcid';
      /**
       * % damage bonus granted to Mythic-tier allies after Biovore damages
       * the target this turn. Indexed by Biovore's position within the
       * Mythic rarity (`progressionPositionInRarity` → 0..3 for Mythic 1★..4★).
       * Biovore itself must be Mythic for the buff to fire at all; Legendary
       * or lower Biovore yields no team bonus regardless of this table.
       *
       * Typical curve: [10, 13, 17, 20] for Mythic 1★..4★ — calibration
       * pending against in-game fixtures.
       */
      pctByStar: number[];
    }
  | {
      kind: 'vitruviusMasterAnnihilator';
      /**
       * Per-passive-level cap on the bonus hit granted to friendly non-psychic
       * attacks against the enemy Vitruvius has marked. Indexed by the
       * `vitruvius_master_annihilator` passive's xpLevel (`abilityLevels`
       * entry), clamped to the array length.
       *
       * The mark lasts the entire battle in the single-boss MVP (there's only
       * one target, so the "attacks a different unit" reset clause never
       * fires). Wiki wording: "This additional hit can deal a maximum of X
       * Damage." Psychic attacks don't score the extra hit.
       *
       * Placeholder linear curve: 500 → 5000 over levels 1..50. Calibration
       * against in-game preview fixtures is a follow-up.
       */
      capByLevel: number[];
    }
  | {
      kind: 'aesothStandVigil';
      /**
       * Per-level extra Armour (X) applied to friendly units within range.
       * The calculator models outgoing damage, not incoming, so this field
       * is surfaced in TeamBuffApplication labels for UI transparency but
       * does NOT produce a TurnBuff modifier (armor only affects the
       * recipient's own defensive calc, which this tool doesn't simulate).
       * Indexed by (level - 1); clamps past end.
       */
      extraArmorByLevel: number[];
      /**
       * Per-level extra damage % (Y) on attacks that are NOT normal attacks
       * (i.e. abilities, including triggered-passive ability profiles). The
       * base aura reaches 1 hex; when any friendly Adeptus Custodes has fired
       * an active ability earlier this turn, the aura extends to
       * `extendedRangeHexes` for the rest of the turn (wiki: "for 1 round").
       * Indexed by (level - 1); clamps past end.
       */
      extraDmgPctByLevel: number[];
      /**
       * Hex range of the extended aura (2 per current wiki) — used only
       * after a friendly Custodes active arms the extended range.
       */
      extendedRangeHexes: number;
    }
  | {
      /**
       * High Marshal Helbrecht's Crusade of Wrath active. When the carrier
       * fires the active on turn N, every friendly unit within
       * `rangeHexes` (hex distance) — Helbrecht himself included, since
       * distance 0 ≤ 2 satisfies "within 2 hexes" — receives on melee
       * attacks:
       *   • +`damageFlatByLevel[level-1]` flat damage
       *   • +`piercePctByLevel[level-1]`% additive pierce ratio
       * for turns [N, N + `durationTurns` - 1]. The wiki wording "for this
       * round and the next" maps to `durationTurns = 2`.
       *
       * Order-sensitive within turn N (the buff arms only after Helbrecht's
       * active resolves); all of turn N+1 receives it unconditionally.
       * Indexed by (level - 1); clamps past end.
       */
      kind: 'helbrechtCrusadeOfWrath';
      damageFlatByLevel: number[];
      piercePctByLevel: number[];
      durationTurns: number;
      rangeHexes: number;
    }
  | {
      /**
       * High Marshal Helbrecht's Destroy the Witch passive. Pure positional
       * aura — no trigger required. Helbrecht himself and friendlies within
       * `rangeHexes` (1 hex: adjacent + self) gain
       * +`damageFlatByLevel[level-1]` flat damage on MELEE attacks when the
       * target carries the `requiresTargetTrait` trait ('psyker'). The
       * +1 Movement component of the passive is irrelevant to the damage
       * calculator and is omitted.
       */
      kind: 'helbrechtDestroyTheWitch';
      damageFlatByLevel: number[];
      rangeHexes: number;
      requiresTargetTrait: string;
    };

export interface CatalogAbility {
  id: string;
  name: string;
  kind: 'active' | 'passive';
  curveId?: string;
  /**
   * Ordered list of component attack profiles that resolve together when
   * the ability triggers. Most abilities have a single component; Kharn's
   * "Kill! Maim! Burn!" has three (Piercing, Eviscerating, Plasma).
   *
   * Purely buff/utility passives may have an empty list.
   */
  profiles: AttackProfile[];
  /**
   * Cooldown in rounds. `999` is the sentinel for "once per battle".
   * Undefined on passives.
   */
  cooldown?: number;
  /** Triggering event for passives that auto-fire. */
  trigger?: AbilityTrigger;
  /** Per-battle damage scaling. */
  scaling?: AbilityScaling;
  /** Team-level buff effect (Guild Raid only). */
  teamBuff?: AbilityTeamBuff;
}

export interface CatalogCharacter {
  id: string;
  displayName: string;
  faction: string;
  alliance: string;
  baseStats: BaseStats;
  melee: AttackProfile;
  ranged?: AttackProfile;
  abilities: CatalogAbility[];
  traits: TraitId[];
  maxRarity: Rarity;
}

export interface CatalogEquipmentSlot {
  slotId: 1 | 2 | 3;
  id: string;
  rarity: Rarity;
  level: number;
  mods: ItemStatMods;
  relic?: boolean;
  displayName?: string;
}

export interface BossStage {
  name: string;
  hp: number;
  armor: number;
  shield?: number;
  traits: TraitId[];
  damageCapsByStage?: { base?: number; preArmor?: number; finalHit?: number };
}

export type BossDebuffStep =
  | {
      stat: 'armor' | 'damage' | 'hp' | 'critDamage';
      mode: 'pct' | 'flat';
      value: number;
      rawId?: string;
    }
  | { stat: null; rawId: string };

export interface BossPrime {
  name: string;
  steps: BossDebuffStep[];
}

export interface CatalogBoss {
  id: string;
  displayName: string;
  stages: BossStage[];
  primes?: BossPrime[];
}

export interface ModifierStack {
  traits?: TraitId[];
  damageMultipliers?: number[];
  damageFlat?: number;
  critChance?: number;
  critDamage?: number;
}

export type BonusHitTrigger = 'first' | 'normal' | 'ability' | 'all';

export interface TurnBuff {
  id: string;
  name: string;
  level?: number;
  rarity?: Rarity;
  damageFlat?: number;
  damageMultiplier?: number;
  critChance?: number;
  critDamage?: number;
  traits?: TraitId[];
  bonusHits?: number;
  bonusHitsOn?: BonusHitTrigger;
  /**
   * If set, the extra hits added by this buff are capped at `bonusHitCap`
   * damage each (both pre- and post-armor bands are clamped). Used for
   * Vitruvius's Master Annihilator.
   */
  bonusHitCap?: number;
  /**
   * Additive pierce-ratio delta (e.g. 0.22 = +22% pierce). Stacks across
   * buffs by addition; the resulting pierce ratio clamps to `[0, 1]`.
   * Introduced for Helbrecht's Crusade of Wrath "+Y% pierce ratio in
   * melee" clause. Attack-kind gating (melee-only, ability-only, etc.) is
   * performed at derivation site — the buff is only emitted when the
   * current profile qualifies, mirroring how `damageFlat` / `damageMultiplier`
   * filtering is handled for Trajann and Aesoth.
   */
  pierceAdd?: number;
  /**
   * Additive delta to the profile's hit count. Unlike `bonusHits` (which
   * is STMA-gated — only the first profile of a multi-profile ability
   * claims the extra), `hitsDelta` applies to every profile it matches.
   * Designed for map-mode terrain that reduces hits regardless of STMA
   * (tall grass: -2 ranged hits, floored at 1). Positive values are
   * also permitted. Attack-kind gating honors `hitsDeltaOn` (default
   * 'all'). The final hit count after all deltas clamps to `>= 1`.
   */
  hitsDelta?: number;
  /** Which attack kinds the `hitsDelta` targets. Defaults to 'all'. */
  hitsDeltaOn?: BonusHitTrigger;
  /**
   * Calibration coefficient from the source preset. When present, the UI
   * auto-recomputes `damageFlat` whenever level or rarity changes.
   */
  baseDamageCoef?: number;
  /**
   * Catalog character id of the buffer (from the source preset). When the
   * player owns the buffer, the rotation editor seeds `level` and `rarity`
   * from that hero's synced values instead of the attacker's.
   */
  charId?: string;
}

export interface AbilityLevel {
  id: string;
  level: number;
  rarity?: Rarity;
  kind?: 'active' | 'passive';
}

export interface Attacker {
  source: CatalogCharacter;
  progression: { stars: number; rank: number; xpLevel: number; rarity: Rarity };
  equipment: CatalogEquipmentSlot[];
  activeBuffs?: ModifierStack;
  abilityLevels?: AbilityLevel[];
}

export interface Target {
  source: CatalogBoss | CatalogCharacter;
  stageIndex?: number;
  currentShield?: number;
  currentHp?: number;
  activeDebuffs?: ModifierStack;
  /**
   * Stat overrides applied on top of the base stage stats — used for prime-
   * kill debuffs (e.g. after killing Rotbone the boss's armor is -20%).
   * Values are the *final* effective stats, not deltas.
   */
  statOverrides?: {
    armor?: number;
    hp?: number;
    damage?: number;
    critDamage?: number;
  };
}

export type RngMode = 'expected' | 'minmax' | 'distribution';

export interface AttackContext {
  profile: AttackProfile;
  rngMode: RngMode;
}

export interface PerHitBreakdown {
  hitIndex: number;
  pCrit: number;
  expected: number;
  min: number;
  max: number;
}

export interface TraceStep {
  phase: string;
  description: string;
  before?: number;
  after?: number;
  detail?: Record<string, number | string | boolean>;
}

export interface DamageBreakdown {
  expected: number;
  min: number;
  max: number;
  critProbability: number;
  distribution?: { value: number; probability: number }[];
  perHit: PerHitBreakdown[];
  postShieldExpected: number;
  postHpExpected: number;
  overkill: boolean;
  cappedBy?: 'base' | 'preArmor' | 'finalHit';
  trace: TraceStep[];
}

export interface Rotation {
  turns: { attacks: AttackContext[]; buffs?: TurnBuff[] }[];
}

/**
 * Position in a 5-member Guild Raid formation. Linear model — adjacency
 * is `|Δposition| === 1`. Real Tacticus uses a hex-ish arrangement but
 * the community UI (halmmar, tacticustable) treats it as linear, and
 * the math simplifies cleanly.
 */
/**
 * Guild Raid team positions: 0..4 are the five hero slots in the linear
 * formation; 5 is the Machine of War slot. Adjacency is |Δposition|=1 —
 * the MoW is adjacent to hero slot 4 (and to the boss, which the single-boss
 * MVP still treats as adjacent to every team member).
 */
export type TeamPosition = 0 | 1 | 2 | 3 | 4 | 5;

export interface TeamMember {
  /** Slot id (not the catalog id). Lets the same catalog hero appear twice. */
  id: string;
  attacker: Attacker;
  position: TeamPosition;
}

export interface TeamAction {
  memberId: string;
  attack: AttackContext;
  /** Per-action turn buffs — merged with team-derived buffs at resolve time. */
  buffs?: TurnBuff[];
}

export interface TeamTurn {
  actions: TeamAction[];
}

export interface TeamRotation {
  members: TeamMember[];
  turns: TeamTurn[];
}

export interface MemberBreakdown {
  memberId: string;
  /** One per action that actually fired (skipped-on-cooldown actions omitted). */
  perAction: { turnIdx: number; actionIdx: number; result: DamageBreakdown }[];
  cooldownSkips: { turnIdx: number; abilityId: string }[];
  /** Passive triggers that fired for this member. */
  triggeredFires: { turnIdx: number; abilityId: string; profileIdx: number }[];
}

/** One team-buff modifier being applied to a member on a specific turn. */
export interface TeamBuffApplication {
  turnIdx: number;
  /** Hero that carries the buff (the source of the aura). */
  sourceMemberId: string;
  kind: AbilityTeamBuff['kind'];
  /** Member receiving the buff. */
  appliedToMemberId: string;
  /** Human-readable short description (for UI inspection). */
  effect: string;
}

export interface TeamRotationBreakdown {
  perMember: Record<string, MemberBreakdown>;
  /** Sum of every member's per-turn damage, cumulative across turns. */
  cumulativeTeamExpected: number[];
  turnsToKill: number | 'unreachable';
  /** Every team-buff application recorded for UI transparency. */
  teamBuffApplications: TeamBuffApplication[];
  /** Union of every member's cooldownSkips, for convenience. */
  cooldownSkips: { turnIdx: number; memberId: string; abilityId: string }[];
}

export interface RotationBreakdown {
  perTurn: DamageBreakdown[];
  cumulativeExpected: number[];
  turnsToKill: number | 'unreachable';
  /**
   * Ability-id occurrences that the engine skipped because the ability was
   * still on cooldown when the rotation tried to fire it. UI highlights
   * these so the user can fix their rotation. Empty when every scheduled
   * attack fired.
   */
  cooldownSkips: { turnIdx: number; abilityId: string }[];
  /**
   * Each passive-trigger firing recorded for UI inspection: which turn,
   * which ability fired, which profile indexes resolved. Mirrors per-turn
   * perTurn entries that originate from triggers (as opposed to
   * user-scheduled attacks).
   */
  triggeredFires: { turnIdx: number; abilityId: string; profileIdx: number }[];
}

export interface TargetResolvedStats {
  armor: number;
  hp: number;
  shield: number;
  /**
   * Target's block chance (0..1). Chain-rolled per-hit per the HDTW wiki:
   * P(n consecutive blocks) = blockChance^n. Bosses have 0 by default; a
   * trait like Daemon layers +25% on top via `onBlock` phase modifier.
   */
  blockChance: number;
  /**
   * Flat damage amount a successful block subtracts from the hit. Per wiki:
   * "Blocks are able to reduce damage dealt to 0" — the reduction is a plain
   * subtract floored at 0, NOT a percent or a cap. Applies to HP damage only;
   * block rolls against shields are cosmetic (damage is not reduced vs shield).
   */
  blockDamage: number;
  traits: TraitId[];
  damageCaps?: { base?: number; preArmor?: number; finalHit?: number };
}

export interface AttackerResolvedStats extends BaseStats {
  traits: TraitId[];
}

export interface Frame {
  attacker: AttackerResolvedStats;
  target: TargetResolvedStats;
  profile: AttackProfile;
  pierce: number;
  armorPasses: number;
  armorPassesOnCrit: number;
  preArmorFlat: number;
  preArmorMultiplier: number;
  postArmorMultiplier: number;
  critChance: number;
  critDamage: number;
  damageFactor: number;
  cappedBy?: 'base' | 'preArmor' | 'finalHit';
  cap?: number;
  trace: TraceStep[];
}
