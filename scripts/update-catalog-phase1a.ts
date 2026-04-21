/**
 * Phase 1a — replace the catalog entries for Kharn, Kariyan, Laviscus,
 * Gulgortz, Trajann and Biovore with hand-authored ability data sourced
 * from tacticus.wiki.gg. Damage factors are reverse-engineered from the
 * wiki's Mythic-level-60 damage range midpoints, using the formula
 *
 *   damageFactor = wikiMid / (baseDamage × hits × abilityLevelMultiplier[mythic,60])
 *
 * where abilityLevelMultiplier[mythic,60] = curves.abilityFactor[59] × 2.0
 * = 65.25 × 2.0 = 130.5. The derivation lands within ±5% of every
 * lower-rarity cell, so a single factor covers the whole scaling curve.
 *
 * Multi-component abilities (Kharn's "Kill! Maim! Burn!") use the new
 * `profiles` array. Triggered passives (Kharn's Betrayer, Gulgortz's
 * Light 'Im Up, Kariyan's Legacy of Combat) emit a `trigger` tag the
 * engine will consume in Phase 2. Team-conditional buffs (Laviscus'
 * Outrage, Trajann's Legendary Commander, Biovore's Mythic acid) emit a
 * `teamBuff` tag consumed by the Guild Raid resolver in Phase 3.
 *
 * Run: npx tsx scripts/update-catalog-phase1a.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Ability = Record<string, unknown>;
type Character = {
  id: string;
  abilities: Ability[];
  [k: string]: unknown;
};

const file = resolve(__dirname, '../src/data/characters.json');
const chars: Character[] = JSON.parse(readFileSync(file, 'utf8'));

function replace(id: string, patch: (c: Character) => Character): void {
  const idx = chars.findIndex((c) => c.id === id);
  if (idx < 0) throw new Error(`character not found: ${id}`);
  chars[idx] = patch(chars[idx]);
}

// ----- Kharn -------------------------------------------------------------
// Active "Kill! Maim! Burn!"  — 1× Piercing + 6× Eviscerating + 1× Plasma
//   Mythic L60 mid: 7961 / 1827 (6 hits) / 5285
// Passive "The Betrayer"  — 4× Eviscerating after normal attack
//   Mythic L60 mid: 2089 (4 hits)
replace('kharn', (c) => ({
  ...c,
  abilities: [
    {
      id: 'kharn_kmb',
      name: 'Kill! Maim! Burn!',
      kind: 'active',
      curveId: 'abilityFactor',
      cooldown: 3,
      profiles: [
        {
          label: 'KMB — Piercing',
          damageType: 'piercing',
          hits: 1,
          damageFactor: 2.44,
          kind: 'ability',
          abilityId: 'kharn_kmb',
        },
        {
          label: 'KMB — Eviscerating',
          damageType: 'eviscerating',
          hits: 6,
          damageFactor: 0.0933,
          kind: 'ability',
          abilityId: 'kharn_kmb',
        },
        {
          label: 'KMB — Plasma',
          damageType: 'plasma',
          hits: 1,
          damageFactor: 1.62,
          kind: 'ability',
          abilityId: 'kharn_kmb',
        },
      ],
    },
    {
      id: 'kharn_betrayer',
      name: 'The Betrayer',
      kind: 'passive',
      curveId: 'abilityFactor',
      trigger: { kind: 'afterOwnNormalAttack' },
      profiles: [
        {
          label: 'Betrayer — Eviscerating',
          damageType: 'eviscerating',
          hits: 4,
          damageFactor: 0.1601,
          kind: 'ability',
          abilityId: 'kharn_betrayer',
        },
      ],
    },
  ],
}));

// ----- Kariyan -----------------------------------------------------------
// Active "Martial Inspiration" — 3× Eviscerating, cd=2, +33% (mythic) per
//   turn Kariyan has attacked this battle. Mythic L60 total mid: 4307.
// Passive "Legacy of Combat" — after first attack per turn, bonus attack.
//   If adjacent to Big Target: 1× Piercing (mythic mid 7047).
//   Else: 3× Power (mythic mid 1762 total).
replace('kariyan', (c) => ({
  ...c,
  abilities: [
    {
      id: 'kariyan_martial_inspiration',
      name: 'Martial Inspiration',
      kind: 'active',
      curveId: 'abilityFactor',
      cooldown: 2,
      scaling: { per: 'turnsAttackedThisBattle', pctPerStep: 33 },
      profiles: [
        {
          label: 'Martial Inspiration — Eviscerating',
          damageType: 'eviscerating',
          hits: 3,
          damageFactor: 0.524,
          kind: 'ability',
          abilityId: 'kariyan_martial_inspiration',
        },
      ],
    },
    {
      id: 'kariyan_loc_piercing',
      name: "Legacy of Combat (vs Big Target)",
      kind: 'passive',
      curveId: 'abilityFactor',
      trigger: {
        kind: 'afterOwnFirstAttackOfTurn',
        requiresTargetTrait: 'big target',
      },
      profiles: [
        {
          label: 'LoC — Piercing',
          damageType: 'piercing',
          hits: 1,
          damageFactor: 2.571,
          kind: 'ability',
          abilityId: 'kariyan_loc_piercing',
        },
      ],
    },
    {
      id: 'kariyan_loc_power',
      name: 'Legacy of Combat (normal target)',
      kind: 'passive',
      curveId: 'abilityFactor',
      trigger: { kind: 'afterOwnFirstAttackOfTurn' },
      profiles: [
        {
          label: 'LoC — Power',
          damageType: 'power',
          hits: 3,
          damageFactor: 0.2143,
          kind: 'ability',
          abilityId: 'kariyan_loc_power',
        },
      ],
    },
  ],
}));

// ----- Laviscus ---------------------------------------------------------
// Active "Euphoric Strikes" — 1× Power + next attack has +crit chance
//   Mythic L60 total mid: 5742. Crit chance bonus: 30% (mythic).
// Passive "Refusal to be Outdone" — Outrage-based team buff.
//   Mythic: +120% damage stat, +1044 crit damage per contributor.
replace('laviscus', (c) => ({
  ...c,
  abilities: [
    {
      id: 'laviscus_euphoric_strikes',
      name: 'Euphoric Strikes',
      kind: 'active',
      curveId: 'abilityFactor',
      cooldown: 1,
      profiles: [
        {
          label: 'Euphoric Strikes — Power',
          damageType: 'power',
          hits: 1,
          damageFactor: 1.1,
          kind: 'ability',
          abilityId: 'laviscus_euphoric_strikes',
        },
      ],
    },
    {
      id: 'laviscus_refusal_outdone',
      name: 'Refusal to be Outdone',
      kind: 'passive',
      curveId: 'abilityFactor',
      teamBuff: {
        kind: 'laviscusOutrage',
        outragePct: 120,
        critDmgPerContributor: 1044,
      },
      profiles: [],
    },
  ],
}));

// ----- Boss Gulgortz ----------------------------------------------------
// Active "WAAAGH!" — summons + team buff + charge attack (melee).
//   Mythic L60: Extra Damage = 1044 (flat add to buffed allies' normal melee).
// Passive "Light 'Im Up" — after normal attack, 3× Projectile on same enemy.
//   Mythic L60 total mid: 2284.
replace('gulgortz', (c) => ({
  ...c,
  abilities: [
    {
      id: 'gulgortz_waaagh',
      name: 'WAAAGH!',
      kind: 'active',
      curveId: 'abilityFactor',
      cooldown: 2,
      profiles: [
        {
          label: 'WAAAGH! — Charge (melee attack)',
          damageType: 'eviscerating',
          hits: 2,
          pierceOverride: 0.5,
          damageFactor: 1,
          preArmorAddFlat: 1044, // mythic L60 extra damage on buffed melee
          kind: 'ability',
          abilityId: 'gulgortz_waaagh',
        },
      ],
    },
    {
      id: 'gulgortz_light_im_up',
      name: "Light 'Im Up",
      kind: 'passive',
      curveId: 'abilityFactor',
      trigger: { kind: 'afterOwnNormalAttack' },
      profiles: [
        {
          label: "Light 'Im Up — Projectile",
          damageType: 'projectile',
          hits: 3,
          pierceOverride: 0.15,
          damageFactor: 0.2244,
          kind: 'ability',
          abilityId: 'gulgortz_light_im_up',
        },
      ],
    },
  ],
}));

// ----- Trajann ----------------------------------------------------------
// Active "Moment Shackle" — heal + block + reactive 2× Bolter on enemies
//   who leave adjacency. Mythic L60 total mid: 4698 (2 hits bolter).
// Passive "Legendary Commander" — team buff: +1436 flat damage (mythic)
//   to enemies adjacent to a friend who used an active this turn; +2
//   extra hits for first non-normal attacks if they're also adjacent to
//   Trajann.
replace('trajann', (c) => ({
  ...c,
  abilities: [
    {
      id: 'trajann_moment_shackle',
      name: 'Moment Shackle',
      kind: 'active',
      curveId: 'abilityFactor',
      cooldown: 3,
      profiles: [
        {
          label: 'Moment Shackle — Bolter (reactive)',
          damageType: 'bolter',
          hits: 2,
          damageFactor: 1.637,
          kind: 'ability',
          abilityId: 'trajann_moment_shackle',
        },
      ],
    },
    {
      id: 'trajann_legendary_commander',
      name: 'Legendary Commander',
      kind: 'passive',
      curveId: 'abilityFactor',
      teamBuff: {
        kind: 'trajannLegendaryCommander',
        flatDamage: 1436,
        extraHitsAdjacentToSelf: 2,
      },
      profiles: [],
    },
  ],
}));

// ----- Biovore (Machine of War) -----------------------------------------
// MoW: baseStats are all 0 (doesn't attack directly — summons Spore Mines
// with their own HP/damage stats). Wiki's Mythic L60 Spore Mine damage:
// 7178-8614 (mid 7896). Scales by MoW stars 11-14 for Mythic ability.
//
// Primary "Bio Minefield"       — summon/move, cd 2
// Secondary "Spore Mines Launcher" — summon, cd 0
// Mythic "Hyper Corrosive Acid" — teamBuff: Mythic allies deal +X% damage
//   to enemies damaged by a friendly Spore Mine. Default 20% (14 stars).
replace('biovore', (c) => ({
  ...c,
  abilities: [
    {
      id: 'biovore_bio_minefield',
      name: 'Bio Minefield',
      kind: 'active',
      cooldown: 2,
      profiles: [
        {
          label: 'Spore Mine — Toxic',
          damageType: 'toxic',
          hits: 1,
          preArmorAddFlat: 7896, // mythic L60 spore mine damage (mid)
          damageFactor: 1,
          kind: 'ability',
          abilityId: 'biovore_bio_minefield',
        },
      ],
    },
    {
      id: 'biovore_spore_mines_launcher',
      name: 'Spore Mines Launcher',
      kind: 'active',
      cooldown: 0,
      profiles: [
        {
          label: 'Spore Mine — Toxic',
          damageType: 'toxic',
          hits: 1,
          preArmorAddFlat: 7896,
          damageFactor: 1,
          kind: 'ability',
          abilityId: 'biovore_spore_mines_launcher',
        },
      ],
    },
    {
      id: 'biovore_hyper_corrosive_acid',
      name: 'Hyper Corrosive Acid',
      kind: 'passive',
      teamBuff: {
        kind: 'biovoreMythicAcid',
        pct: 20, // 14 stars — default upper bound
      },
      profiles: [],
    },
  ],
}));

writeFileSync(file, JSON.stringify(chars, null, 2) + '\n');
console.log(`Updated 6 characters in ${file}`);
