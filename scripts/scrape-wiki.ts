import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import {
  CharactersCatalogSchema,
  BossesCatalogSchema,
  DamageTypeSchema,
  type CharacterData,
  type BossData,
} from '../src/data/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'src', 'data');
const CACHE_DIR = join(ROOT, 'src', 'data', '_raw');

const BASE = 'https://tacticus.wiki.gg';
const CHAR_CATEGORY = '/wiki/Category:Characters';
const BOSS_CATEGORY = '/wiki/Category:Guild_Raid_Boss';

const TYPE_MAP: Record<string, string> = {
  power: 'power',
  bolter: 'bolter',
  chain: 'chain',
  las: 'las',
  melta: 'melta',
  plasma: 'plasma',
  flame: 'flame',
  psychic: 'psychic',
  direct: 'direct',
  physical: 'physical',
  piercing: 'piercing',
  energy: 'energy',
  particle: 'particle',
  projectile: 'projectile',
  pulse: 'pulse',
  toxic: 'toxic',
  bio: 'bio',
  blast: 'blast',
  eviscerating: 'eviscerating',
  molecular: 'molecular',
  gauss: 'gauss',
  heavy: 'heavyRound',
  heavyround: 'heavyRound',
  'heavy round': 'heavyRound',
};

function toCamelId(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

async function fetchCached(path: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheKey = path.replace(/[^a-zA-Z0-9]+/g, '_') + '.html';
  const cachePath = join(CACHE_DIR, cacheKey);
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf8');
  }
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': 'tacticus-calc-scraper/0.1' },
  });
  if (!res.ok) throw new Error(`fetch ${path} -> ${res.status}`);
  const html = await res.text();
  writeFileSync(cachePath, html);
  return html;
}

async function listCategoryLinks(categoryPath: string): Promise<{ name: string; href: string }[]> {
  const out = new Map<string, string>();
  let next: string | null = categoryPath;
  while (next) {
    const html = await fetchCached(next);
    const $ = cheerio.load(html);
    $('.mw-category a, .mw-category-group a, #mw-pages a').each((_, el) => {
      const href = $(el).attr('href');
      const name = $(el).text().trim();
      if (!href || !name) return;
      if (!href.startsWith('/wiki/')) return;
      if (href.includes(':')) return;
      out.set(name, href);
    });
    const nextLink = $('a:contains("next page")').attr('href');
    next = nextLink && nextLink !== next ? nextLink : null;
  }
  return Array.from(out, ([name, href]) => ({ name, href }));
}

function parseInfoboxNumber(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function mapDamageType(raw: string): string | null {
  const k = raw.toLowerCase().trim();
  if (k in TYPE_MAP) return TYPE_MAP[k];
  const stripped = k.replace(/\s+/g, '');
  if (stripped in TYPE_MAP) return TYPE_MAP[stripped];
  return null;
}

interface ScrapedCharacter {
  name: string;
  ok: boolean;
  data?: CharacterData;
  reason?: string;
}

function parseCharacterPage(name: string, html: string): ScrapedCharacter {
  const $ = cheerio.load(html);
  const infobox = $('.infobox, .pi-theme-default, aside').first();
  if (infobox.length === 0) {
    return { name, ok: false, reason: 'no infobox' };
  }

  const pick = (label: RegExp): string | undefined => {
    let val: string | undefined;
    infobox.find('tr, .pi-item').each((_, el) => {
      const text = $(el).text();
      if (label.test(text)) {
        const valEl = $(el).find('.pi-data-value, td').last();
        val = valEl.text().trim() || text.replace(label, '').trim();
      }
    });
    return val;
  };

  const damage = parseInfoboxNumber(pick(/damage/i));
  const armor = parseInfoboxNumber(pick(/armour|armor/i));
  const hp = parseInfoboxNumber(pick(/health|hp/i));
  const faction = pick(/faction/i) ?? 'Unknown';
  const alliance = pick(/alliance|grand\s*alliance/i) ?? 'Unknown';
  const meleeTypeRaw = pick(/melee\s*type|melee\s*attack\s*type/i) ?? '';
  const rangedTypeRaw = pick(/ranged\s*type|ranged\s*attack\s*type/i) ?? '';
  const meleeHits = parseInfoboxNumber(pick(/melee\s*hits/i)) ?? 1;
  const rangedHits = parseInfoboxNumber(pick(/ranged\s*hits/i)) ?? 0;

  if (damage === null || armor === null || hp === null) {
    return { name, ok: false, reason: 'missing stats' };
  }

  const meleeType = mapDamageType(meleeTypeRaw);
  if (!meleeType) {
    return { name, ok: false, reason: `unknown melee type "${meleeTypeRaw}"` };
  }

  const id = toCamelId(name);
  const char: CharacterData = {
    id,
    displayName: name,
    faction,
    alliance,
    baseStats: {
      damage,
      armor,
      hp,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits,
      rangedHits,
    },
    melee: {
      label: 'Melee',
      damageType: DamageTypeSchema.parse(meleeType),
      hits: meleeHits,
      kind: 'melee',
    },
    ranged:
      rangedHits > 0 && mapDamageType(rangedTypeRaw)
        ? {
            label: 'Ranged',
            damageType: DamageTypeSchema.parse(mapDamageType(rangedTypeRaw)!),
            hits: rangedHits,
            kind: 'ranged',
          }
        : undefined,
    abilities: [],
    traits: [],
    maxRarity: 'legendary',
  };
  return { name, ok: true, data: char };
}

async function scrapeCharacters(): Promise<CharacterData[]> {
  const links = await listCategoryLinks(CHAR_CATEGORY);
  console.log(`character links: ${links.length}`);
  const out: CharacterData[] = [];
  const fails: { name: string; reason?: string }[] = [];
  for (const { name, href } of links) {
    try {
      const html = await fetchCached(href);
      const res = parseCharacterPage(name, html);
      if (res.ok && res.data) out.push(res.data);
      else fails.push({ name, reason: res.reason });
    } catch (e) {
      fails.push({ name, reason: (e as Error).message });
    }
  }
  console.log(`characters parsed: ${out.length}, failed: ${fails.length}`);
  if (fails.length > 0) {
    writeFileSync(join(CACHE_DIR, '_char_fails.json'), JSON.stringify(fails, null, 2));
  }
  return out;
}

async function scrapeBosses(): Promise<BossData[]> {
  const links = await listCategoryLinks(BOSS_CATEGORY);
  console.log(`boss links: ${links.length}`);
  const out: BossData[] = [];
  for (const { name, href } of links) {
    try {
      const html = await fetchCached(href);
      const $ = cheerio.load(html);
      const infobox = $('.infobox, aside').first();
      const hp = parseInfoboxNumber(infobox.find('tr:contains("Health"), tr:contains("HP")').last().text());
      const armor = parseInfoboxNumber(infobox.find('tr:contains("Armour"), tr:contains("Armor")').last().text());
      if (hp === null || armor === null) {
        console.warn(`skip boss ${name}: missing stats`);
        continue;
      }
      const id = toCamelId(name);
      out.push({
        id,
        displayName: name,
        stages: [{ name: 'L1', hp, armor, traits: [] }],
      });
    } catch (e) {
      console.warn(`skip boss ${name}:`, (e as Error).message);
    }
  }
  console.log(`bosses parsed: ${out.length}`);
  return out;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const mode = process.argv[2] ?? 'all';

  if (mode === 'all' || mode === 'characters') {
    const chars = await scrapeCharacters();
    CharactersCatalogSchema.parse(chars);
    writeFileSync(join(OUT_DIR, 'characters.wiki.json'), JSON.stringify(chars, null, 2));
  }

  if (mode === 'all' || mode === 'bosses') {
    const bosses = await scrapeBosses();
    BossesCatalogSchema.parse(bosses);
    writeFileSync(join(OUT_DIR, 'bosses.wiki.json'), JSON.stringify(bosses, null, 2));
  }

  console.log('done. Review *.wiki.json, then run diff-catalog to compare against halmmar seed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
