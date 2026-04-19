import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BossesCatalogSchema, type BossData } from '../src/data/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'tacticustable-gameinfo.json');
const OUT = join(ROOT, 'src', 'data', 'bosses.json');

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

interface GameInfoUnit {
  id: string;
  name: string;
  longName?: string;
  factionId: string;
  traits?: string[];
  isBoss?: boolean;
  stats: GameInfoStat[];
}

interface GameInfo {
  guildRaidUnits: Record<string, GameInfoUnit>;
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

const TRAIT_MAP: Record<string, string> = {
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

const TIER_LABELS = ['L1', 'L2', 'L3', 'L4'];
const TIER_PROG_INDICES = ['15', '17', '18', '19'];

function pickTier(stats: GameInfoStat[], progIdx: string): GameInfoStat | undefined {
  const matches = stats.filter((s) => String(s.progressionIndex) === progIdx);
  return matches[matches.length - 1];
}

function mapTraits(traits: string[] | undefined): string[] {
  if (!traits) return [];
  return traits.map((t) => TRAIT_MAP[t] ?? t.toLowerCase()).filter((t, i, a) => a.indexOf(t) === i);
}

function toStage(
  label: string,
  stat: GameInfoStat,
  traits: string[] | undefined,
): BossData['stages'][number] {
  return {
    name: label,
    hp: stat.health,
    armor: stat.fixedArmor ?? 0,
    traits: mapTraits(traits),
  };
}

function main(): void {
  const raw = JSON.parse(readFileSync(SOURCE, 'utf8')) as GameInfo;
  const bosses: BossData[] = [];

  for (const [gameId, shortId] of Object.entries(BOSS_ID_MAP)) {
    const unit = raw.guildRaidUnits[gameId];
    if (!unit) {
      console.warn(`Missing ${gameId}`);
      continue;
    }
    const stages: BossData['stages'] = [];
    for (let i = 0; i < TIER_PROG_INDICES.length; i++) {
      const stat = pickTier(unit.stats, TIER_PROG_INDICES[i]);
      if (!stat) continue;
      stages.push(toStage(TIER_LABELS[i], stat, unit.traits));
    }
    bosses.push({
      id: shortId,
      displayName: BOSS_DISPLAY_MAP[shortId] ?? unit.longName ?? unit.name,
      stages,
    });
  }

  bosses.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const parsed = BossesCatalogSchema.parse(bosses);
  writeFileSync(OUT, JSON.stringify(parsed, null, 2) + '\n');
  console.log(`Wrote ${parsed.length} bosses to ${OUT}`);
  for (const b of parsed) {
    console.log(
      `  ${b.id.padEnd(22)} ${b.displayName.padEnd(35)} stages: ${b.stages.map((s) => `${s.name}(hp${Math.round(s.hp / 1_000_000)}M armor${s.armor})`).join(' ')}`,
    );
  }
}

main();
