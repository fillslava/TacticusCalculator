import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BossesCatalogSchema,
  CharactersCatalogSchema,
  type BossData,
  type CharacterData,
} from '../src/data/schema';

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
  guildRaidUnits: Record<string, GameInfoUnit>;
  heroes: Record<string, GameInfoUnit>;
  machinesOfWar?: Record<string, GameInfoUnit>;
  abilities?: Record<string, GameInfoAbility>;
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
  Gauss: 'gauss',
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
    bosses.push({
      id: shortId,
      displayName: BOSS_DISPLAY_MAP[shortId] ?? unit.longName ?? unit.name ?? shortId,
      stages,
    });
  }
  bosses.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return bosses;
}

function patchCharacters(raw: GameInfo, current: CharacterData[]): CharacterData[] {
  const pool: GameInfoUnit[] = [
    ...Object.values(raw.heroes ?? {}),
    ...Object.values(raw.machinesOfWar ?? {}),
  ];
  const patched: CharacterData[] = [];
  let stats = 0,
    weapons = 0,
    traits = 0;
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
    patched.push(next);
  }

  console.log(
    `Characters: ${stats} stat overrides · ${weapons} weapon overrides · ${traits} trait overrides`,
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

function writeCurves(raw: GameInfo): void {
  const abilityFactor = buildAbilityFactor(raw);
  const current = JSON.parse(readFileSync(CURVES_OUT, 'utf8'));
  const merged = {
    abilityFactor,
    starMultiplierPerStar: current.starMultiplierPerStar ?? 0.1,
    // Game uses 0.1 step (common=1.0, mythic=1.5). Scraped wiki claimed 0.2
    // but in-game tooltip calibration (Eldryon L55 mythic = 1072) matches 0.1.
    rarityAbilityStep: 0.1,
    gearRanks: current.gearRanks,
  };
  writeFileSync(CURVES_OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(
    `Wrote curves: abilityFactor L1=${abilityFactor[0]} L55=${abilityFactor[54]} L65=${abilityFactor[64]}`,
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
