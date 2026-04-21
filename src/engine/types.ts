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
      /** Flat ATK buff (%) added to each adjacent ally's damage. */
      outragePct: number;
      /** Extra crit-damage per Outrage contributor. */
      critDmgPerContributor: number;
    }
  | {
      kind: 'trajannLegendaryCommander';
      /** Flat bonus damage added against enemies adjacent to a Shield Host
       *  friend who used an active this turn. */
      flatDamage: number;
      /** Extra hits appended to melee/ranged when adjacent. */
      extraHitsAdjacentToSelf: number;
    }
  | {
      kind: 'biovoreMythicAcid';
      /** % damage bonus granted to Mythic-tier allies after a Spore Mine
       *  damages the same target. */
      pct: number;
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
export type TeamPosition = 0 | 1 | 2 | 3 | 4;

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
