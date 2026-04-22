import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  AbilityScalingSchema,
  AbilityTeamBuffSchema,
  AbilityTriggerSchema,
  AttackProfileSchema,
  BossesCatalogSchema,
  CharactersCatalogSchema,
  type BossData,
  type CharacterData,
} from '../src/data/schema';

type AttackProfile = z.infer<typeof AttackProfileSchema>;
type AbilityTrigger = z.infer<typeof AbilityTriggerSchema>;
type AbilityScaling = z.infer<typeof AbilityScalingSchema>;
type AbilityTeamBuff = z.infer<typeof AbilityTeamBuffSchema>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'tacticustable-gameinfo.json');
const BOSSES_OUT = join(ROOT, 'src', 'data', 'bosses.json');
const CHARS_OUT = join(ROOT, 'src', 'data', 'characters.json');
const CURVES_OUT = join(ROOT, 'src', 'data', 'curves.json');
const ABILITY_TABLES_OUT = join(ROOT, 'src', 'data', 'abilityTables.json');

interface GameInfoStat {
  health: number;
  damage: number;
  fixedArmor: number | null;
  rank: number;
  starLevel: number;
  baseRarity: string;
  progressionIndex: string | number;
  abilityLevel: number;
  blockChance: number | null;
  blockDamage: number | null;
  critChance: number | null;
  critDamage: number | null;
}

interface GameInfoWeapon {
  hits: number;
  damageProfile: string;
  range: number | null;
  piercingRatio: number;
  traits: string[] | null;
}

interface GameInfoRank {
  level: string;
  health: number;
  damage: number;
  armor: number;
}

interface GameInfoUnit {
  id: string;
  name?: string;
  longName?: string;
  factionId: string;
  traits?: string[];
  isBoss?: boolean;
  meleeWeapon?: GameInfoWeapon | null;
  rangeWeapon?: GameInfoWeapon | null;
  ranks?: GameInfoRank[];
  stats?: GameInfoStat[];
  activeAbility?: string | null;
  passiveAbility?: string | null;
  mowActiveAbility?: string[] | null;
  mythicAbilities?: string[] | null;
}

interface GameInfoAbility {
  gameId?: string;
  name: string;
  description?: string;
  variables?: Record<string, unknown>;
  constants?: Record<string, string> | null;
  variablesAffectedByRarityBonus?: string[] | null;
}

interface GameInfo {
  guildRaidUnits: Record<string, GameInfoUnitWithPrimes>;
  heroes: Record<string, GameInfoUnit>;
  machinesOfWar?: Record<string, GameInfoUnit>;
  abilities?: Record<string, GameInfoAbility>;
  bossDebuffs?: Record<string, string[]>;
}

interface GameInfoUnitWithPrimes extends GameInfoUnit {
  isBoss?: boolean;
  isPrime?: boolean;
  prime1?: string;
  prime2?: string;
  prime1Name?: string;
  prime2Name?: string;
}

const BOSS_ID_MAP: Record<string, string> = {
  GuildBoss1Boss1TyranTervigonLeviathan: 'tervigonLeviathan',
  GuildBoss1Boss2TyranTervigonKronos: 'tervigonKronos',
  GuildBoss1Boss3TyranTervigonGorgon: 'tervigonGorgon',
  GuildBoss2Boss1TyranHiveTyrantLeviathan: 'hiveTyrantLeviathan',
  GuildBoss2Boss2TyranHiveTyrantKronos: 'hiveTyrantKronos',
  GuildBoss2Boss3TyranHiveTyrantGorgon: 'hiveTyrantGorgon',
  GuildBoss3Boss1NecroSilentKing: 'szarekh',
  GuildBoss4Boss1OrksGhazghkull: 'ghazghkull',
  GuildBoss5Boss1DeathMortarion: 'mortarion',
  GuildBoss6Boss1TyranScreamerKiller: 'screamerKiller',
  GuildBoss7Boss1AstraRogaldorn: 'rogalDorn',
  GuildBoss8Boss1EldarAvatar: 'avatar',
  GuildBoss9Boss1ThousMagnus: 'magnus',
  GuildBoss10Boss1AdmecBelisarius: 'cawl',
  GuildBoss11Boss1TauRiptide: 'riptide',
};

const BOSS_DISPLAY_MAP: Record<string, string> = {
  tervigonLeviathan: 'Tervigon (Leviathan)',
  tervigonKronos: 'Tervigon (Kronos)',
  tervigonGorgon: 'Tervigon (Gorgon)',
  hiveTyrantLeviathan: 'Hive Tyrant (Leviathan)',
  hiveTyrantKronos: 'Hive Tyrant (Kronos)',
  hiveTyrantGorgon: 'Hive Tyrant (Gorgon)',
  szarekh: 'Szarekh, the Silent King',
  ghazghkull: 'Ghazghkull Mag Uruk Thraka',
  mortarion: 'Mortarion, the Death Lord',
  screamerKiller: 'Screamer-Killer',
  rogalDorn: 'Rogal Dorn Battle Tank',
  avatar: 'Avatar of Khaine',
  magnus: 'Magnus the Red',
  cawl: 'Belisarius Cawl',
  riptide: 'XV104 Riptide Battlesuit',
};

const BOSS_TRAIT_MAP: Record<string, string> = {
  BigTarget: 'big',
  Daemon: 'daemon',
  Mechanical: 'mech',
  Psyker: 'psyker',
  Flying: 'flying',
  Immune: 'immune',
  Boss: 'boss',
  Synapse: 'synapse',
  Vehicle: 'vehicle',
  Dakka: 'dakka',
  IndirectFire: 'indirect fire',
  SuppressiveFire: 'suppressive fire',
  InstinctiveBehaviour: 'instinctive behaviour',
  ShadowInTheWarp: 'shadow in the warp',
  ContagionsOfNurgle: 'contagions of nurgle',
  WeaverOfFate: 'weaver of fate',
};

const CHAR_TRAIT_MAP: Record<string, string> = {
  ActOfFaith: 'act of faith',
  Ambush: 'ambush',
  BeastSnagga: 'beast snagga',
  BigTarget: 'big target',
  BlessingsOfKhorne: 'blessings of khorne',
  Camouflage: 'camouflage',
  ContagionsOfNurgle: 'contagions of nurgle',
  CrushingStrike: 'crushing strike',
  Daemon: 'daemon',
  Explodes: 'explodes',
  FinalJustice: 'final justice',
  Flying: 'flying',
  GetStuckIn: 'get stuck in',
  Healer: 'healer',
  HeavyWeapon: 'heavy weapon',
  IndirectFire: 'indirect fire',
  Infiltrate: 'infiltrate',
  LetTheGalaxyBurn: 'let the galaxy burn',
  LivingMetal: 'living metal',
  MachineOfWar: 'machine of war',
  MartialKatah: 'martial katah',
  Mechanic: 'mechanic',
  Mechanical: 'mechanical',
  MkXGravis: 'mk x gravis',
  Overwatch: 'overwatch',
  Parry: 'parry',
  PrioritisedEfficiency: 'prioritised efficiency',
  Psyker: 'psyker',
  PutridExplosion: 'putrid explosion',
  RangedSpecialist: 'ranged specialist',
  RapidAssault: 'rapid assault',
  Resilient: 'resilient',
  ShadowInTheWarp: 'shadow in the warp',
  SuppressiveFire: 'suppressive fire',
  Synapse: 'synapse',
  TeleportStrike: 'teleport strike',
  TerminatorArmour: 'terminator armour',
  Terrifying: 'terrifying',
  ThrillSeekers: 'thrill seekers',
  Unstoppable: 'unstoppable',
  Vehicle: 'vehicle',
  WeaverOfFate: 'weaver of fate',
};

const DAMAGE_PROFILE_MAP: Record<string, string> = {
  Bio: 'bio',
  Blast: 'blast',
  Bolter: 'bolter',
  Chain: 'chain',
  Energy: 'energy',
  Eviscerate: 'eviscerating',
  Flame: 'flame',
  // Legacy 'Gauss' was merged into 'molecular' in July 2023.
  Gauss: 'molecular',
  HeavyRound: 'heavyRound',
  Las: 'las',
  Melta: 'melta',
  Particle: 'particle',
  Physical: 'physical',
  Piercing: 'piercing',
  Plasma: 'plasma',
  Power: 'power',
  Projectile: 'projectile',
  Psychic: 'psychic',
  Pulse: 'pulse',
  Toxic: 'toxic',
  Direct: 'direct',
  DirectDamage: 'direct',
  Molecular: 'molecular',
};

const HERO_ID_ALIAS: Record<string, string> = {
  plaguecrawler: 'plagueburst-crawler',
  malleus: 'malleus-rocket-launcher',
  tsonji: 'tau-broadside-battlesuit',
  rotbone: 'nauseous-rotbone',
};

const LEGENDARY_LABELS = ['L1', 'L2', 'L3', 'L4', 'L5'];
const MYTHIC_LABELS = ['M1', 'M2'];

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapBossTraits(traits: string[] | undefined): string[] {
  if (!traits) return [];
  return traits
    .map((t) => BOSS_TRAIT_MAP[t] ?? t.toLowerCase())
    .filter((t, i, a) => a.indexOf(t) === i);
}

function mapCharTraits(traits: string[] | undefined): string[] {
  if (!traits) return [];
  return traits
    .map((t) => CHAR_TRAIT_MAP[t] ?? t.toLowerCase())
    .filter((t, i, a) => a.indexOf(t) === i);
}

function toBossStage(
  label: string,
  stat: GameInfoStat,
  traits: string[] | undefined,
): BossData['stages'][number] {
  return {
    name: label,
    hp: stat.health,
    armor: stat.fixedArmor ?? 0,
    traits: mapBossTraits(traits),
  };
}

function findHeroUnit(
  charId: string,
  displayName: string,
  pool: GameInfoUnit[],
): GameInfoUnit | undefined {
  const aliasId = HERO_ID_ALIAS[charId];
  if (aliasId) {
    const aliased = pool.find((u) => u.id === aliasId);
    if (aliased) return aliased;
  }
  const target = norm(charId);
  const targetName = norm(displayName);
  let best: { unit: GameInfoUnit; score: number } | undefined;
  for (const u of pool) {
    const uid = norm(u.id);
    const un = norm(u.name);
    const uln = norm(u.longName);
    let score = 0;
    if (uid === target) score = 1000;
    else if (un === targetName) score = 950;
    else if (uln === target) score = 900;
    else if (target.length >= 4 && uid.startsWith(target)) score = 800 + target.length;
    else if (target.length >= 4 && target.startsWith(uid) && uid.length >= 4)
      score = 780 + uid.length;
    else if (
      targetName.length >= 4 &&
      un.length >= 4 &&
      (un.startsWith(targetName) || targetName.startsWith(un))
    )
      score = 700 + Math.min(un.length, targetName.length);
    if (score > 0 && (!best || score > best.score)) best = { unit: u, score };
  }
  return best?.unit;
}

/**
 * Parse a `boss_debuff_*` string into a structured stat change. Ability-
 * specific debuffs (e.g. `boss_debuff_ArchContaminator_hits_2`) return null
 * because they don't affect the damage calc — we still record them as inert
 * steps so kill-count dropdowns line up with the in-game tier numbering.
 */
function parseBossDebuff(raw: string): NonNullable<BossData['primes']>[number]['steps'][number] {
  const m = /^boss_debuff_(fixedArmor|dmg|hp|critDmg)_(\d+)$/.exec(raw);
  if (m) {
    const statMap: Record<string, 'armor' | 'damage' | 'hp' | 'critDamage'> = {
      fixedArmor: 'armor',
      dmg: 'damage',
      hp: 'hp',
      critDmg: 'critDamage',
    };
    const stat = statMap[m[1]];
    if (stat) {
      return { stat, mode: 'pct', value: Number(m[2]) / 100, rawId: raw };
    }
  }
  return { stat: null, rawId: raw };
}

function buildPrimesFor(
  unit: GameInfoUnitWithPrimes,
  raw: GameInfo,
): BossData['primes'] {
  const primes: BossData['primes'] = [];
  const defs: [string | undefined, string | undefined][] = [
    [unit.prime1, unit.prime1Name],
    [unit.prime2, unit.prime2Name],
  ];
  for (const [debuffKey, rawName] of defs) {
    if (!debuffKey) continue;
    const arr = raw.bossDebuffs?.[debuffKey];
    if (!arr || arr.length === 0) continue;
    const name = primeDisplayName(rawName ?? debuffKey);
    primes.push({
      name,
      steps: arr.map(parseBossDebuff),
    });
  }
  return primes.length > 0 ? primes : undefined;
}

/**
 * Strip gameinfo prefixes (GuildBoss\d+MiniBoss\d+FactionName) down to a
 * readable prime name (e.g. "Rotbone", "Blightbringer").
 */
function primeDisplayName(raw: string): string {
  return (
    raw.replace(/^GuildBoss\d+MiniBoss\d+(?:[A-Z][a-z]+)?/, '').replace(/^_/, '') ||
    raw
  );
}

function buildBosses(raw: GameInfo): BossData[] {
  const bosses: BossData[] = [];
  for (const [gameId, shortId] of Object.entries(BOSS_ID_MAP)) {
    const unit = raw.guildRaidUnits[gameId];
    if (!unit || !unit.stats) {
      console.warn(`Missing boss ${gameId}`);
      continue;
    }
    const stages: BossData['stages'] = [];
    const legendary = unit.stats.filter((s) => s.baseRarity === 'Legendary');
    const mythic = unit.stats.filter((s) => s.baseRarity === 'Mythic');
    for (let i = 0; i < LEGENDARY_LABELS.length && i < legendary.length; i++) {
      stages.push(toBossStage(LEGENDARY_LABELS[i], legendary[i], unit.traits));
    }
    for (let i = 0; i < MYTHIC_LABELS.length && i < mythic.length; i++) {
      stages.push(toBossStage(MYTHIC_LABELS[i], mythic[i], unit.traits));
    }
    const primes = buildPrimesFor(unit, raw);
    bosses.push({
      id: shortId,
      displayName: BOSS_DISPLAY_MAP[shortId] ?? unit.longName ?? unit.name ?? shortId,
      stages,
      ...(primes ? { primes } : {}),
    });
  }
  bosses.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return bosses;
}

/**
 * Characters whose `abilities` are hand-authored (with verified damage
 * factors, triggers, teamBuffs, scaling). The extractor skips these so we
 * don't clobber reviewed data. Any character not on this list gets abilities
 * derived fresh from gameinfo.
 */
const HAND_AUTHORED_ABILITY_IDS = new Set([
  'kharn',
  'kariyan',
  'laviscus',
  'gulgortz',
  'trajann',
  'biovore',
  // Vitruvius's Master Annihilator `capByLevel` is hand-curated against the
  // wiki's published anchors (L50=7477) and diverges from gameinfo's raw
  // `maxDmg` curve (L50=4154). Preserve the hand-authored block.
  'vitruvius',
  // Godswyl's Champion of the Feast is a passive that fires AFTER his first
  // normal attack of the turn (wiki: "After moving, deals 1x X Power Damage
  // ... if Godswyl does not move, then this ability triggers at the end of
  // his turn"). The importer does not synthesize `trigger` fields for
  // conditional passives, so without this hand-authored entry the passive
  // would have `kind: 'passive'` with profiles but no trigger, and
  // `shouldTrigger` would return false for every attack — silently
  // cancelling the "second hit" the user expects.
  'godswyl',
]);

/**
 * Ability damage variables in gameinfo are 65-entry arrays indexed by
 * xpLevel (1..65). For the scraper-derived `preArmorAddFlat` we pin to
 * xpLevel 50 (index 49) — legendary-cap — as a representative value. A
 * future engine upgrade can store the full array and scale per-level; for
 * now the hand-authored entries (Phase 2) cover abilities we need exact
 * scaling for.
 */
const REFERENCE_LEVEL_INDEX = 49;
const COMPONENT_SUFFIXES = ['', '_2', '_3', '_4', '_5'] as const;

function numArray(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const nums = v.map((x) => (typeof x === 'number' ? x : Number(x as string)));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}

function atLevel(arr: number[] | null, level = REFERENCE_LEVEL_INDEX): number | null {
  if (!arr || arr.length === 0) return null;
  return arr[Math.min(level, arr.length - 1)] ?? null;
}

/**
 * Returns the full per-level curve for a variable, rounded to integers. Used
 * by teamBuff builders that need every level's value (e.g. Trajann's
 * `flatDamageByLevel`). Returns null when the gameinfo variable is missing or
 * not an array of numbers — callers fall back to a hand-authored default.
 */
function numArrayRounded(a: GameInfoAbility, key: string): number[] | null {
  const arr = numArray(a.variables?.[key]);
  return arr === null ? null : arr.map((n) => Math.round(n));
}

/**
 * Derive a passive's trigger from its description text. We only detect the
 * two shapes the engine currently supports; unmatched descriptions return
 * undefined (the ability is treated as an aura/teamBuff).
 */
function describeTrigger(desc: string | undefined): AbilityTrigger | undefined {
  if (!desc) return undefined;
  const clean = desc.replace(/<[^>]+>/g, '').toLowerCase();
  if (/after performing (?:a |an )?normal attack/.test(clean)) {
    return { kind: 'afterOwnNormalAttack' };
  }
  if (/after performing (?:his|her|its|their) first attack (?:each|this) turn/.test(clean)) {
    const requires = /big target/.test(clean) ? 'big target' : undefined;
    return requires
      ? { kind: 'afterOwnFirstAttackOfTurn', requiresTargetTrait: requires }
      : { kind: 'afterOwnFirstAttackOfTurn' };
  }
  return undefined;
}

/**
 * Known scaling abilities. Gameinfo surfaces scaling only by description
 * text ("deals +X% for each turn you've been attacked…") — a structured
 * detection would require description parsing per ability, so we keep a
 * small explicit map. Any other ability scales as if pctPerStep=0.
 */
const SCALING_BY_ID: Record<string, AbilityScaling> = {
  MartialInspiration: { per: 'turnsAttackedThisBattle', pctPerStep: 33 },
};

/**
 * Known team-buff ability builders. Values derive from per-level variables
 * where possible (LegendaryCommander's extraDmg and nrOfHits), fall back to
 * constants from the hand-authored reconciliation where gameinfo doesn't
 * expose them (Laviscus's outrage multipliers are encoded into the passive
 * description but not the variables block).
 */
const TEAM_BUFF_BUILDERS: Record<string, (a: GameInfoAbility) => AbilityTeamBuff> = {
  RefusalToBeOutdone: (_a) => ({
    kind: 'laviscusOutrage',
    outragePctOfOutrage: 120,
    critDmgPerChaosContributor: 1044,
  }),
  LegendaryCommander: (a) => {
    // Per-level curves: gameinfo exposes `extraDmg` (X) and `nrOfHits` (Y)
    // as arrays indexed by level-1. Fall back to a single-entry placeholder
    // when gameinfo drops the variable; the engine clamps past-end indices
    // to the last entry, so a single-entry array still resolves correctly
    // for every level.
    const flats = numArrayRounded(a, 'extraDmg') ?? [0];
    const hits = numArrayRounded(a, 'nrOfHits') ?? [2];
    return {
      kind: 'trajannLegendaryCommander',
      flatDamageByLevel: flats,
      extraHitsByLevel: hits,
    };
  },
  StandVigil: (a) => {
    // gameinfo `variables`: extraArmor[] (X, per level) + extraDmgPct[] (Y%,
    // per level). `constants.range` = extended hex range when a friendly
    // Custodes fires an active (2 per current wiki). Fall back to a single-
    // entry placeholder when variables are missing — engine clamps past-end.
    const armor = numArrayRounded(a, 'extraArmor') ?? [0];
    const dmgPct = numArrayRounded(a, 'extraDmgPct') ?? [0];
    const rangeRaw = a.constants?.range;
    const range = rangeRaw !== undefined ? Number(rangeRaw) : 2;
    return {
      kind: 'aesothStandVigil',
      extraArmorByLevel: armor,
      extraDmgPctByLevel: dmgPct,
      extendedRangeHexes: Number.isFinite(range) && range >= 1 ? range : 2,
    };
  },
  // Vitruvius's MasterAnnihilator `capByLevel` intentionally has NO builder
  // here — the gameinfo `maxDmg` curve (4154 @ L50) diverges sharply from
  // the wiki's published anchors (7477 @ L50). The hand-authored values are
  // the source of truth; Vitruvius is listed under `HAND_AUTHORED_ABILITY_IDS`
  // so the importer preserves his ability block instead of overriding it.
};

/**
 * Convert a gameinfo ability id (PascalCase-like `KillMaimBurn`) into the
 * catalog's `charId_snake_case` form. Falls back to a normalised slug when
 * the input lacks word boundaries.
 */
function abilityLocalId(charId: string, gameId: string): string {
  const snake = gameId
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${charId}_${snake || 'ability'}`;
}

/**
 * Extract the damage profiles encoded under a gameinfo ability. Multi-
 * component abilities (Kharn's Kill! Maim! Burn!) tag suffixes `_2`, `_3`,
 * … on `damageProfile`, `nrOfHits`, `minDmg`, `maxDmg`. Profiles follow the
 * declaration order (1, 2, 3, …). preArmorAddFlat is pinned to xpLevel 50
 * (see REFERENCE_LEVEL_INDEX).
 *
 * Fallback rules (observed in wild gameinfo data):
 * - Suffix components inherit the base `damageProfile` if their own isn't
 *   set (e.g. Typhus's PlagueWind: all three components are Psychic but
 *   only the base `damageProfile` constant exists).
 * - Suffix components inherit base `nrOfHits` likewise.
 * - A component is considered "present" if it has damage data (minDmg+maxDmg
 *   or a single `dmg` variable). Suffixes with only a constants entry but
 *   no damage data are skipped.
 */
function extractProfiles(abilityId: string, ability: GameInfoAbility): AttackProfile[] {
  const profiles: AttackProfile[] = [];
  const constants = ability.constants ?? {};
  const variables = ability.variables ?? {};
  const baseProfile = constants['damageProfile'];
  const baseHits = Number(constants['nrOfHits'] ?? 1) || 1;

  for (const suffix of COMPONENT_SUFFIXES) {
    const dpKey = 'damageProfile' + suffix;
    const hitsKey = 'nrOfHits' + suffix;
    const minKey = 'minDmg' + suffix;
    const maxKey = 'maxDmg' + suffix;
    const flatKey = 'dmg' + suffix;

    const rawProfile = constants[dpKey] ?? baseProfile;
    if (!rawProfile) continue;

    const minArr = numArray(variables[minKey]);
    const maxArr = numArray(variables[maxKey]);
    const flatArr = numArray(variables[flatKey]);
    const minAtLevel = atLevel(minArr);
    const maxAtLevel = atLevel(maxArr);
    const flatAtLevel = atLevel(flatArr);

    // Skip a suffix component that has no damage data of its own. The base
    // component ('' suffix) always emits if rawProfile exists; suffix
    // components need their own dmg variables to justify a profile entry.
    if (suffix !== '' && minAtLevel === null && maxAtLevel === null && flatAtLevel === null) {
      continue;
    }

    const damageType = DAMAGE_PROFILE_MAP[rawProfile];
    if (!damageType) {
      console.warn(`extractProfiles(${abilityId}): unknown damageProfile "${rawProfile}"`);
      continue;
    }
    const rawHits = constants[hitsKey] ?? constants['nrOfHits'];
    const hits = Number(rawHits ?? baseHits) || baseHits || 1;

    const midAtLevel =
      minAtLevel !== null && maxAtLevel !== null
        ? (minAtLevel + maxAtLevel) / 2
        : flatAtLevel;

    // Use the canonical damage type name in the label (so `DirectDamage`
    // appears as "direct" not the raw gameinfo string). Component number
    // suffix stays numeric for multi-hit abilities.
    const componentName = damageType;
    const componentLabel =
      suffix === '' ? componentName : `${componentName} #${suffix.slice(1)}`;
    profiles.push({
      label: `${ability.name} — ${componentLabel}`,
      damageType: damageType as AttackProfile['damageType'],
      hits,
      ...(midAtLevel !== null ? { preArmorAddFlat: Math.round(midAtLevel) } : {}),
      damageFactor: 1,
      kind: 'ability',
      abilityId,
    });
  }
  return profiles;
}

/**
 * Build `CharacterData['abilities']` for a hero from its gameinfo record.
 * Emits one CatalogAbility per populated slot (`activeAbility`,
 * `passiveAbility`), with profiles[] extracted from the ability's damage
 * constants/variables. teamBuff/scaling applied from known maps.
 *
 * Limitations:
 * - MoW and mythic abilities are ignored (no hero has them in this snapshot)
 * - Passives that condition on multiple target-trait branches (Kariyan's
 *   Legacy of Combat) aren't split into separate ability entries; consumers
 *   that need that split should hand-author the character
 * - Single component only: abilities with only `damageProfile_2` (no base)
 *   drop to an empty profiles list
 */
function extractHeroAbilities(
  charId: string,
  hero: GameInfoUnit,
  raw: GameInfo,
): CharacterData['abilities'] {
  const out: CharacterData['abilities'] = [];
  const abilityMap = raw.abilities ?? {};
  const slots: [string | null | undefined, 'active' | 'passive'][] = [
    [hero.activeAbility, 'active'],
    [hero.passiveAbility, 'passive'],
  ];
  for (const [gameId, kind] of slots) {
    if (!gameId) continue;
    const a = abilityMap[gameId];
    if (!a) {
      console.warn(`${charId}: ability "${gameId}" referenced by hero but absent from abilities{}`);
      continue;
    }
    const localId = abilityLocalId(charId, gameId);
    const profiles = extractProfiles(localId, a);
    // Prefer `cooldownTurns` (the recurring cooldown after first use). Fall
    // back to `initialCooldownTurns` only when the recurring one is absent —
    // some actives only advertise the first-use delay in the snapshot, and
    // most of those recur at the same cadence in-game.
    const cooldownRaw = a.constants?.cooldownTurns ?? a.constants?.initialCooldownTurns;
    const cooldown = cooldownRaw !== undefined ? Number(cooldownRaw) : undefined;
    const trigger = kind === 'passive' ? describeTrigger(a.description) : undefined;
    const scaling = SCALING_BY_ID[gameId];
    const teamBuild = TEAM_BUFF_BUILDERS[gameId];
    const teamBuff = teamBuild ? teamBuild(a) : undefined;

    out.push({
      id: localId,
      name: a.name,
      kind,
      ...(profiles.length > 0 ? { curveId: 'abilityFactor' } : {}),
      profiles,
      ...(cooldown !== undefined && Number.isFinite(cooldown) ? { cooldown } : {}),
      ...(trigger ? { trigger } : {}),
      ...(scaling ? { scaling } : {}),
      ...(teamBuff ? { teamBuff } : {}),
    });
  }
  return out;
}

function patchCharacters(raw: GameInfo, current: CharacterData[]): CharacterData[] {
  const pool: GameInfoUnit[] = [
    ...Object.values(raw.heroes ?? {}),
    ...Object.values(raw.machinesOfWar ?? {}),
  ];
  const patched: CharacterData[] = [];
  let stats = 0,
    weapons = 0,
    traits = 0,
    abilitiesPatched = 0,
    abilitiesSkipped = 0;
  const unmatched: string[] = [];

  for (const ch of current) {
    const hero = findHeroUnit(ch.id, ch.displayName, pool);
    if (!hero) {
      unmatched.push(ch.id);
      patched.push(ch);
      continue;
    }
    const next: CharacterData = { ...ch };
    const base0 = hero.ranks?.[0];
    if (base0) {
      next.baseStats = {
        ...ch.baseStats,
        hp: base0.health,
        damage: base0.damage,
        armor: base0.armor,
        meleeHits: hero.meleeWeapon?.hits ?? ch.baseStats.meleeHits,
        rangedHits: hero.rangeWeapon?.hits ?? ch.baseStats.rangedHits,
      };
      stats++;
    }
    if (hero.meleeWeapon) {
      const mt = DAMAGE_PROFILE_MAP[hero.meleeWeapon.damageProfile];
      next.melee = {
        ...ch.melee,
        label: ch.melee?.label ?? 'Melee',
        hits: hero.meleeWeapon.hits,
        pierceOverride: hero.meleeWeapon.piercingRatio / 100,
        kind: 'melee',
        ...(mt ? { damageType: mt as CharacterData['melee']['damageType'] } : {}),
      };
      weapons++;
    }
    if (hero.rangeWeapon) {
      const rt = DAMAGE_PROFILE_MAP[hero.rangeWeapon.damageProfile];
      next.ranged = {
        ...(ch.ranged ?? { label: 'Ranged', damageType: 'physical', hits: 1 }),
        label: ch.ranged?.label ?? 'Ranged',
        hits: hero.rangeWeapon.hits,
        pierceOverride: hero.rangeWeapon.piercingRatio / 100,
        kind: 'ranged',
        ...(rt ? { damageType: rt as CharacterData['melee']['damageType'] } : {}),
      };
    } else if (ch.ranged) {
      next.ranged = ch.ranged;
    }
    if (hero.traits && hero.traits.length > 0) {
      next.traits = mapCharTraits(hero.traits);
      traits++;
    }
    if (HAND_AUTHORED_ABILITY_IDS.has(ch.id)) {
      // Preserve hand-authored ability data (verified damage factors,
      // multi-variant triggers, exact teamBuff numbers).
      abilitiesSkipped++;
    } else {
      const extracted = extractHeroAbilities(ch.id, hero, raw);
      next.abilities = extracted;
      if (extracted.length > 0) abilitiesPatched++;
    }
    patched.push(next);
  }

  console.log(
    `Characters: ${stats} stat overrides · ${weapons} weapon overrides · ${traits} trait overrides · ${abilitiesPatched} ability overrides (${abilitiesSkipped} hand-authored preserved)`,
  );
  if (unmatched.length > 0) {
    console.log(`Unmatched (${unmatched.length}): ${unmatched.join(', ')}`);
  }
  return patched;
}

/**
 * The set of buffer/passive abilities surfaced as presets in the UI. Any
 * 65-entry variable array on one of these abilities is exported to
 * abilityTables.json so the preset can look up per-xpLevel damage values.
 */
const BUFF_ABILITY_IDS = [
  'Doom',
  'RitesOfBattle',
  'FirstAmongTraitors',
  'LegendaryCommander',
  'PathOfCommand',
  'Waaagh',
  'DestroyTheWitch',
  'StructuralAnalyser',
  'SpotterReworked',
  'DefenderOfTheGreaterGood',
  'SagaOfTheWarriorBorn',
];

function buildAbilityTables(
  raw: GameInfo,
): Record<string, unknown> {
  const abilities = raw.abilities ?? {};
  const out: Record<string, unknown> = {};
  for (const id of BUFF_ABILITY_IDS) {
    const a = abilities[id];
    if (!a) {
      console.warn(`buildAbilityTables: ability "${id}" not in gameinfo`);
      continue;
    }
    const tables: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(a.variables ?? {})) {
      if (!Array.isArray(v) || v.length !== 65) continue;
      const nums = v.map((x) =>
        typeof x === 'number' ? x : Number(x as string),
      );
      if (nums.some((x) => !Number.isFinite(x))) continue;
      tables[k] = nums;
    }
    out[id] = {
      name: a.name,
      variablesAffectedByRarityBonus: a.variablesAffectedByRarityBonus ?? null,
      constants: a.constants ?? null,
      tables,
    };
  }
  return out;
}

/**
 * Extract the authoritative per-xpLevel ability factor curve from gameinfo.
 * Picks the ability variable with the largest L1 base (best precision) and
 * normalises by its L1 value.
 *
 * The previously-scraped curve diverged from gameinfo past L50 (exponential
 * vs. near-linear). Using a gameinfo-derived curve keeps ability damage
 * accurate at all character levels.
 */
function buildAbilityFactor(raw: GameInfo): number[] {
  const abilities = raw.abilities ?? {};
  let bestArr: number[] | null = null;
  for (const a of Object.values(abilities)) {
    for (const v of Object.values(a.variables ?? {})) {
      if (!Array.isArray(v) || v.length !== 65) continue;
      const nums = v.map((x) =>
        typeof x === 'number' ? x : Number(x as string),
      );
      if (nums.some((x) => !Number.isFinite(x))) continue;
      // Require monotonic-increasing (flat powerups like PowerUp_Bomb have
      // a constant-then-step shape that would bias the curve).
      let mono = true;
      for (let i = 1; i < nums.length; i++) {
        if (nums[i] < nums[i - 1]) {
          mono = false;
          break;
        }
      }
      if (!mono) continue;
      if (!bestArr || nums[0] > bestArr[0]) bestArr = nums;
    }
  }
  if (!bestArr) throw new Error('buildAbilityFactor: no suitable curve found');
  return bestArr.map((v) => +(v / bestArr![0]).toFixed(4));
}

function buildGearRanks(raw: GameInfo): [string, number][] {
  // Any hero has the same 20-entry rank list (STONE I → MYTHIC II).
  const heroes = Object.values(raw.heroes ?? {});
  for (const h of heroes) {
    if (!h.ranks || h.ranks.length === 0) continue;
    return h.ranks.map((r, i) => [toTitleCase(r.level), i] as [string, number]);
  }
  throw new Error('buildGearRanks: no hero with ranks[] found');
}

function toTitleCase(s: string): string {
  // Preserve roman numerals (I, II, III). Capitalise only the tier word.
  return s
    .split(/\s+/)
    .map((w) =>
      /^[IVX]+$/i.test(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(' ');
}

function writeCurves(raw: GameInfo): void {
  const abilityFactor = buildAbilityFactor(raw);
  const gearRanks = buildGearRanks(raw);
  const current = JSON.parse(readFileSync(CURVES_OUT, 'utf8'));
  const merged = {
    abilityFactor,
    starMultiplierPerStar: current.starMultiplierPerStar ?? 0.1,
    // Game uses 0.1 step (common=1.0, mythic=1.5). Scraped wiki claimed 0.2
    // but in-game tooltip calibration (Eldryon L55 mythic = 1072) matches 0.1.
    rarityAbilityStep: 0.1,
    gearRanks,
  };
  writeFileSync(CURVES_OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(
    `Wrote curves: abilityFactor L1=${abilityFactor[0]} L55=${abilityFactor[54]} L65=${abilityFactor[64]} · ${gearRanks.length} gear ranks ending at ${gearRanks[gearRanks.length - 1][0]}`,
  );
}

function main(): void {
  const raw = JSON.parse(readFileSync(SOURCE, 'utf8')) as GameInfo;

  const bosses = BossesCatalogSchema.parse(buildBosses(raw));
  writeFileSync(BOSSES_OUT, JSON.stringify(bosses, null, 2) + '\n');
  console.log(`Wrote ${bosses.length} bosses → ${BOSSES_OUT}`);

  const currentChars = JSON.parse(readFileSync(CHARS_OUT, 'utf8')) as CharacterData[];
  const patched = CharactersCatalogSchema.parse(patchCharacters(raw, currentChars));
  writeFileSync(CHARS_OUT, JSON.stringify(patched, null, 2) + '\n');
  console.log(`Wrote ${patched.length} characters → ${CHARS_OUT}`);

  writeCurves(raw);

  const abilityTables = buildAbilityTables(raw);
  writeFileSync(ABILITY_TABLES_OUT, JSON.stringify(abilityTables, null, 2) + '\n');
  console.log(
    `Wrote ability tables for ${Object.keys(abilityTables).length} abilities → ${ABILITY_TABLES_OUT}`,
  );
}

main();
