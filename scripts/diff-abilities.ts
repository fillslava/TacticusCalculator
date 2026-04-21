/**
 * One-off diagnostic: for the 6 hand-authored reference heroes, dump what
 * the extractor WOULD produce from gameinfo side-by-side with the committed
 * hand-authored abilities. Used during Phase 1b to validate the extractor
 * matches the hand-authored structure closely enough that we can rely on
 * it for the other ~100 heroes. Delete this script once Phase 1b is done.
 */
import { readFileSync } from 'node:fs';

interface Ability {
  name: string;
  constants?: Record<string, string> | null;
  variables?: Record<string, unknown>;
}

const DAMAGE_PROFILE_MAP: Record<string, string> = {
  Bio: 'bio', Blast: 'blast', Bolter: 'bolter', Chain: 'chain', Energy: 'energy',
  Eviscerate: 'eviscerating', Flame: 'flame', Gauss: 'molecular', HeavyRound: 'heavyRound',
  Las: 'las', Melta: 'melta', Particle: 'particle', Physical: 'physical', Piercing: 'piercing',
  Plasma: 'plasma', Power: 'power', Projectile: 'projectile', Psychic: 'psychic',
  Pulse: 'pulse', Toxic: 'toxic', Direct: 'direct', DirectDamage: 'direct',
  Molecular: 'molecular',
};
const SUFFIXES = ['', '_2', '_3', '_4', '_5'];
const REF = 49;

function numArray(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const nums = v.map((x) => (typeof x === 'number' ? x : Number(x as string)));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}
function atLevel(arr: number[] | null, l = REF): number | null {
  if (!arr || arr.length === 0) return null;
  return arr[Math.min(l, arr.length - 1)] ?? null;
}

function extractProfiles(ability: Ability) {
  const out: Array<{ dt: string; hits: number; flat: number | null; suf: string }> = [];
  const c = ability.constants ?? {};
  const v = ability.variables ?? {};
  const baseP = c.damageProfile;
  const baseH = Number(c.nrOfHits ?? 1) || 1;
  for (const s of SUFFIXES) {
    const rawP = c['damageProfile' + s] ?? baseP;
    if (!rawP) continue;
    const minA = numArray(v['minDmg' + s]);
    const maxA = numArray(v['maxDmg' + s]);
    const fA = numArray(v['dmg' + s]);
    const mn = atLevel(minA);
    const mx = atLevel(maxA);
    const fl = atLevel(fA);
    if (s !== '' && mn === null && mx === null && fl === null) continue;
    const dt = DAMAGE_PROFILE_MAP[rawP];
    if (!dt) continue;
    const hits = Number(c['nrOfHits' + s] ?? c.nrOfHits ?? baseH) || baseH;
    const mid = mn !== null && mx !== null ? (mn + mx) / 2 : fl;
    out.push({ dt, hits, flat: mid === null ? null : Math.round(mid), suf: s });
  }
  return out;
}

const MAP: Record<string, { active: string | null; passive: string | null }> = {
  kharn: { active: 'KillMaimBurn', passive: 'TheBetrayer' },
  kariyan: { active: 'MartialInspiration', passive: 'LegacyOfCombat' },
  laviscus: { active: 'EuphoricStrikes', passive: 'RefusalToBeOutdone' },
  gulgortz: { active: 'Waaagh', passive: 'LightImUp' },
  trajann: { active: 'MomentShackle', passive: 'LegendaryCommander' },
  biovore: { active: null, passive: null },
};

const raw = JSON.parse(readFileSync('tacticustable-gameinfo.json', 'utf8'));
const chars = JSON.parse(readFileSync('src/data/characters.json', 'utf8'));

for (const [id, slots] of Object.entries(MAP)) {
  const c = chars.find((x: { id: string }) => x.id === id);
  console.log('\n===== ' + id + ' =====');
  console.log('-- HAND-AUTHORED:');
  for (const a of c.abilities) {
    const ps = a.profiles
      .map(
        (p: { hits: number; damageType: string; damageFactor?: number; preArmorAddFlat?: number }) =>
          `${p.hits}x ${p.damageType}(${p.damageFactor ?? 1}f${p.preArmorAddFlat ? '+' + p.preArmorAddFlat : ''})`,
      )
      .join(', ');
    console.log(
      `   [${a.kind}] ${a.name}: cd=${a.cooldown ?? '-'} trig=${a.trigger?.kind ?? '-'} buff=${a.teamBuff?.kind ?? '-'} scal=${a.scaling?.per ?? '-'} | ${ps}`,
    );
  }
  console.log('-- EXTRACTOR (synthetic, flat pinned to xpLevel 50):');
  for (const [kind, gameId] of Object.entries(slots)) {
    if (!gameId) {
      console.log(`   [${kind}] — no id in map`);
      continue;
    }
    const a = raw.abilities[gameId];
    if (!a) {
      console.log(`   [${kind}] ${gameId}: NOT IN GAMEINFO`);
      continue;
    }
    const profs = extractProfiles(a);
    const cd = a.constants?.cooldownTurns ?? a.constants?.initialCooldownTurns;
    const ps = profs
      .map((p) => `${p.hits}x ${p.dt}(flat=${p.flat ?? '-'})`)
      .join(', ');
    console.log(`   [${kind}] ${a.name}: cd=${cd ?? '-'} | ${ps}`);
  }
}
