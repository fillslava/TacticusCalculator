/**
 * Calibration harness: asserts that the engine's `expected` damage matches
 * numbers observed in the in-game damage-preview screen, within a per-case
 * tolerance. Fixture authoring is documented at
 * `tests/fixtures/ingame-preview-cases.schema.md`.
 *
 * This harness lands before the fixture set is populated so that as you
 * capture in-game screenshots over time, each addition becomes a hard
 * regression guard automatically — no harness code changes required.
 *
 * Empty fixture file ⇒ the harness logs a skip note and passes, so the
 * suite stays green while you accumulate data.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRotation } from '../../src/engine/rotation';
import { applyPrimeDebuffs } from '../../src/engine/bossDebuffs';
import {
  progressionToRarity,
  progressionToStarLevel,
  rarityToMinProgression,
} from '../../src/engine/progression';
import {
  loadCatalog,
  getCharacter,
  getBoss,
  getEquipment,
} from '../../src/data/catalog';
import '../../src/engine/traits';
import type {
  AbilityLevel,
  Attacker,
  AttackContext,
  CatalogBoss,
  CatalogCharacter,
  CatalogEquipmentSlot,
  Target,
  TurnBuff,
} from '../../src/engine/types';
import { RaritySchema } from '../../src/data/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = join(__dirname, '..', 'fixtures', 'ingame-preview-cases.json');

// ---- Fixture schema ------------------------------------------------------

const AttackerSchema = z
  .object({
    characterId: z.string(),
    progression: z.number().int().optional(),
    rarity: RaritySchema.optional(),
    stars: z.number().int().optional(),
    rank: z.number().int(),
    xpLevel: z.number().int(),
    equipment: z.array(z.string()).default([]),
    abilityLevels: z.array(z.number().int()).optional(),
  })
  .refine(
    (a) =>
      typeof a.progression === 'number' ||
      (typeof a.rarity === 'string' && typeof a.stars === 'number'),
    { message: 'attacker needs either `progression` or `{rarity, stars}`' },
  );

const TargetSchema = z
  .object({
    bossId: z.string().nullable().optional(),
    stageIndex: z.number().int().default(0),
    customArmor: z.number().optional(),
    customHp: z.number().optional(),
    customShield: z.number().optional(),
    customTraits: z.array(z.string()).optional(),
    primeLevels: z.array(z.number().int()).optional(),
  })
  .refine(
    (t) =>
      (t.bossId && t.bossId.length > 0) ||
      typeof t.customHp === 'number' ||
      typeof t.customArmor === 'number',
    { message: 'target needs either `bossId` or custom stats' },
  );

const CaseSchema = z.object({
  id: z.string(),
  notes: z.string().optional(),
  attacker: AttackerSchema,
  target: TargetSchema,
  attack: z.string(),
  expected: z.number().positive(),
  tolerance: z.number().positive().default(0.02),
});

const FixtureFileSchema = z.object({
  version: z.literal(1),
  description: z.string().optional(),
  cases: z.array(CaseSchema),
});

type CalibrationCase = z.infer<typeof CaseSchema>;

// ---- Harness helpers ------------------------------------------------------

function loadFixtures(): CalibrationCase[] {
  const raw = readFileSync(FIXTURE, 'utf-8');
  const parsed = FixtureFileSchema.parse(JSON.parse(raw));
  return parsed.cases;
}

function resolveProgression(
  a: CalibrationCase['attacker'],
): { stars: number; rarity: Attacker['progression']['rarity'] } {
  if (typeof a.progression === 'number') {
    return {
      stars: progressionToStarLevel(a.progression),
      rarity: progressionToRarity(a.progression),
    };
  }
  // both rarity+stars supplied (enforced by refine)
  const base = rarityToMinProgression(a.rarity!);
  return {
    stars: progressionToStarLevel(base + a.stars!),
    rarity: a.rarity!,
  };
}

function buildAttacker(
  c: CalibrationCase,
  char: CatalogCharacter,
): Attacker {
  const equipment: CatalogEquipmentSlot[] = c.attacker.equipment
    .map((id) => getEquipment(id))
    .filter((e): e is CatalogEquipmentSlot => Boolean(e));
  if (equipment.length !== c.attacker.equipment.length) {
    const missing = c.attacker.equipment.filter((id) => !getEquipment(id));
    throw new Error(
      `Case ${c.id}: unknown equipment id(s) ${missing.join(', ')}`,
    );
  }
  const { stars, rarity } = resolveProgression(c.attacker);

  /* Map `[5, 5, 5]` onto the character's ability list by index so fixture
   * authors don't have to memorise ability ids. */
  let abilityLevels: AbilityLevel[] | undefined;
  if (c.attacker.abilityLevels && c.attacker.abilityLevels.length > 0) {
    abilityLevels = c.attacker.abilityLevels
      .map<AbilityLevel | null>((level, idx) => {
        const ab = char.abilities[idx];
        if (!ab) return null;
        return { id: ab.id, level, kind: ab.kind as 'active' | 'passive' };
      })
      .filter((e): e is AbilityLevel => Boolean(e));
  }

  return {
    source: char,
    progression: {
      stars,
      rank: c.attacker.rank,
      xpLevel: c.attacker.xpLevel,
      rarity,
    },
    equipment,
    abilityLevels,
  };
}

function buildTarget(c: CalibrationCase): Target {
  const t = c.target;
  let boss: CatalogBoss | undefined;
  if (t.bossId) {
    boss = getBoss(t.bossId);
    if (!boss) throw new Error(`Case ${c.id}: unknown bossId "${t.bossId}"`);
  } else {
    boss = {
      id: 'custom',
      displayName: 'Custom',
      stages: [
        {
          name: 'custom',
          hp: t.customHp ?? 100_000,
          armor: t.customArmor ?? 0,
          shield: t.customShield ?? 0,
          traits: t.customTraits ?? [],
        },
      ],
    };
  }
  const stageIdx = Math.min(t.stageIndex, Math.max(0, boss.stages.length - 1));
  const stage = boss.stages[stageIdx];
  const primeLevels = t.primeLevels ?? [];
  const hasAnyPrime = primeLevels.some((l) => l > 0);
  const debuffed = hasAnyPrime
    ? applyPrimeDebuffs(
        { armor: stage.armor, hp: stage.hp },
        boss.primes,
        primeLevels,
      )
    : null;
  return {
    source: boss,
    stageIndex: t.stageIndex,
    ...(debuffed
      ? { statOverrides: { armor: debuffed.armor, hp: debuffed.hp } }
      : {}),
  };
}

/** Mirrors the UI's `attackContextsFor` so multi-profile abilities expand
 *  correctly. */
function attackContextsFor(
  key: string,
  char: CatalogCharacter,
): AttackContext[] {
  if (key === 'melee' && char.melee)
    return [{ profile: char.melee, rngMode: 'expected' }];
  if (key === 'ranged' && char.ranged)
    return [{ profile: char.ranged, rngMode: 'expected' }];
  if (key.startsWith('ability:')) {
    const id = key.slice('ability:'.length);
    const ability = char.abilities.find((a) => a.id === id);
    if (!ability) return [];
    return ability.profiles.map<AttackContext>((profile) => ({
      profile,
      rngMode: 'expected',
    }));
  }
  return [];
}

function runCase(c: CalibrationCase): { actual: number; relErr: number } {
  const char = getCharacter(c.attacker.characterId);
  if (!char) {
    throw new Error(`Case ${c.id}: unknown characterId "${c.attacker.characterId}"`);
  }
  const attacker = buildAttacker(c, char);
  const target = buildTarget(c);
  const attacks = attackContextsFor(c.attack, char);
  if (attacks.length === 0) {
    throw new Error(`Case ${c.id}: attack "${c.attack}" resolved to no contexts`);
  }
  const buffs: TurnBuff[] = [];
  const result = resolveRotation(attacker, target, {
    turns: [{ attacks, buffs }],
  });
  const actual = result.perTurn[0]?.expected ?? 0;
  const relErr = c.expected > 0 ? Math.abs(actual - c.expected) / c.expected : 0;
  return { actual, relErr };
}

// ---- Tests ---------------------------------------------------------------

describe('calibration: in-game damage-preview fixtures', () => {
  // Touch the catalog early so schema drift fails here, not inside each case.
  loadCatalog();
  const cases = loadFixtures();

  if (cases.length === 0) {
    it.skip('no calibration cases populated yet — add entries to tests/fixtures/ingame-preview-cases.json', () => {});
    return;
  }

  for (const c of cases) {
    it(`${c.id} — engine matches in-game preview within ±${(c.tolerance * 100).toFixed(1)}%`, () => {
      const { actual, relErr } = runCase(c);
      if (relErr > c.tolerance) {
        // Surface both numbers so a red test immediately tells you whether
        // the engine overshot or undershot, and by how much.
        const diff = actual - c.expected;
        const pct = (relErr * 100).toFixed(2);
        throw new Error(
          `${c.id}: expected ${c.expected}, got ${Math.round(actual)} (${diff >= 0 ? '+' : ''}${Math.round(diff)}, ±${pct}%, tol ±${(c.tolerance * 100).toFixed(1)}%)`,
        );
      }
      expect(relErr).toBeLessThanOrEqual(c.tolerance);
    });
  }
});
