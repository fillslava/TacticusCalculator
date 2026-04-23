import { resolveAttack } from '../../engine/attack';
import {
  applyBonusHits,
  applyHitsDelta,
  applyPierceBuffs,
  applyTurnBuffs,
} from '../../engine/rotation';
import type { AttackContext, AttackProfile } from '../../engine/types';
import { deriveHexBuffs } from '../battle/hexBuffs';
import type { MapBattleState, Unit } from '../battle/mapBattleState';
import type { AttackKey } from '../battle/playerTurn';
import { unitToTarget } from '../battle/targetAdapter';
import type { Policy, Suggestion } from './policy';

/**
 * Phase 6 — heuristic predict-mode suggester.
 *
 * Given an active player unit + the current battle, enumerates every
 * (profile, target) pair and evaluates it through the same
 * `resolveIncomingAttack`-shaped pipeline the actual attack uses — so
 * predicted damage matches the number that WILL appear once the user
 * commits the action (±numerical noise inside the engine itself). This
 * is the reason we reuse `deriveHexBuffs` / `applyTurnBuffs` verbatim
 * rather than a simpler estimator.
 *
 * Scoring formula (heuristic):
 *
 *   score = expectedDamage * (1 + killWeight * killChance)
 *
 * with `killWeight = 1.5` to bias rankings toward actions that finish a
 * target — "prefer a 100k kill over a 110k that leaves 10 HP alive".
 *
 * Scope:
 *   - Predict does NOT respect positional range / cooldowns yet — the
 *     map layer still lacks range metadata on abilities. The panel
 *     shows every profile the character has against every enemy that is
 *     alive; a future phase can prune by `ability.rangeHexes`.
 *   - Predict does NOT include the `move + attack` combo — it ranks
 *     attacks from the unit's current position. A later phase could
 *     fold movement into the search but the branching factor explodes
 *     so we leave it out.
 *
 * The output is `Suggestion[]`, sorted best-first. Empty `[]` is
 * returned if there's nothing sensible to do (dead attacker, no enemies,
 * no firing profiles).
 */

const DEFAULT_KILL_WEIGHT = 1.5;

export interface SuggestOptions {
  /** Cap on the number of suggestions to return. Undefined → all. */
  limit?: number;
  /** Override the kill-weight coefficient in the scoring formula. */
  killWeight?: number;
}

/**
 * The reference heuristic Policy object. Exported as a plain const so
 * callers can bind it without instantiating anything, mirroring how
 * `targetPolicy.ts` ships its three preset policies.
 */
export const HEURISTIC_POLICY: Policy = {
  id: 'heuristic',
  displayName: 'Heuristic',
  suggest(active, battle) {
    return suggestAction(active, battle);
  },
};

export function suggestAction(
  active: Unit,
  battle: MapBattleState,
  opts: SuggestOptions = {},
): Suggestion[] {
  if (active.currentHp <= 0) return [];
  const killWeight = opts.killWeight ?? DEFAULT_KILL_WEIGHT;

  const enemies = Object.values(battle.units).filter(
    (u) => u.side !== active.side && u.currentHp > 0,
  );
  if (enemies.length === 0) return [];

  const out: Suggestion[] = [];
  for (const { key, profile, label } of enumerateProfiles(active)) {
    for (const target of enemies) {
      const s = scoreAttack(active, target, { key, profile, label }, battle, killWeight);
      if (s) out.push(s);
    }
  }
  out.sort((a, b) => b.score - a.score);
  return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

// ────────────────────────────────────────────────────────────────────
// Per-pair scoring
// ────────────────────────────────────────────────────────────────────

interface ProfileEntry {
  key: AttackKey;
  profile: AttackProfile;
  label: string;
}

function scoreAttack(
  attacker: Unit,
  victim: Unit,
  entry: ProfileEntry,
  battle: MapBattleState,
  killWeight: number,
): Suggestion | null {
  const ctx: AttackContext = { profile: entry.profile, rngMode: 'expected' };
  const hexBuffs = deriveHexBuffs(attacker, victim, battle, ctx.profile);
  const buffedAttacker = applyTurnBuffs(attacker.attacker, hexBuffs);
  const withBonusHits = applyBonusHits(ctx.profile, hexBuffs, false);
  const withHitsDelta = applyHitsDelta(withBonusHits, hexBuffs, false);
  const withPierce = applyPierceBuffs(withHitsDelta, hexBuffs);
  const expectedCtx: AttackContext = { ...ctx, profile: withPierce };
  const expectedTarget = unitToTarget(victim, battle);
  const expectedBreakdown = resolveAttack(
    buffedAttacker,
    expectedTarget,
    expectedCtx,
  );
  const expectedDamage = expectedBreakdown.expected;

  // Distribution pass — needed only for kill probability. Heavier than
  // the expected pass but bounded by catalog hit-count × 2**hits, and
  // `predict` is called at most once per click.
  const distCtx: AttackContext = {
    ...ctx,
    profile: withPierce,
    rngMode: 'distribution',
  };
  const distBreakdown = resolveAttack(buffedAttacker, expectedTarget, distCtx);
  const killChance = killChanceFromBreakdown(distBreakdown, victim);

  const score = expectedDamage * (1 + killWeight * killChance);

  return {
    attackerId: attacker.id,
    targetId: victim.id,
    attackKey: entry.key,
    profileLabel: entry.label,
    expectedDamage,
    killChance,
    score,
    breakdown: expectedBreakdown,
    ctx: expectedCtx,
  };
}

/**
 * Estimate the probability the attack kills the victim.
 *
 * Prefers the engine's full distribution when it's populated (future
 * engine upgrades may emit it), but gracefully degrades to the
 * (min, max, expected) triple that `resolveAttack` always produces.
 * Degradation strategy:
 *   - If min >= threshold → guaranteed kill, return 1.
 *   - If max < threshold → impossible, return 0.
 *   - Otherwise → assume a uniform distribution across [min, max] and
 *     return the fraction above threshold. This is crude but matches
 *     the engine's current internal modelling (per-hit crit + variance
 *     sampled uniformly) closely enough for ranking. If we later want
 *     tighter probabilities we can replace the inner branch without
 *     touching callers.
 */
function killChanceFromBreakdown(
  breakdown: ReturnType<typeof resolveAttack>,
  victim: Unit,
): number {
  const threshold = Math.max(1, victim.currentHp + victim.currentShield);
  const dist = breakdown.distribution;
  if (dist && dist.length > 0) {
    let p = 0;
    for (const b of dist) {
      if (b.value >= threshold) p += b.probability;
    }
    return Math.min(1, Math.max(0, p));
  }
  // Fallback: use the (min, max) range the engine always populates.
  const min = breakdown.min ?? breakdown.expected;
  const max = breakdown.max ?? breakdown.expected;
  if (min >= threshold) return 1;
  if (max < threshold) return 0;
  const span = Math.max(1e-9, max - min);
  const p = (max - threshold) / span;
  return Math.min(1, Math.max(0, p));
}

// ────────────────────────────────────────────────────────────────────
// Profile enumeration
// ────────────────────────────────────────────────────────────────────

/**
 * List every profile the active unit can fire, with the `attackKey`
 * vocabulary matching `playerTurn.ts` so UI callers can round-trip the
 * suggestion into a committable `PlayerAction`. Multi-profile abilities
 * are surfaced as their FIRST profile only — the UI's profile picker
 * will fan the ability out into every component when the user clicks.
 *
 * Passives (`kind === 'passive'`) are excluded because they aren't
 * user-initiatable.
 */
function enumerateProfiles(unit: Unit): ProfileEntry[] {
  const src = unit.attacker.source;
  const out: ProfileEntry[] = [];
  if (src.melee) {
    out.push({
      key: 'melee',
      profile: src.melee,
      label: src.melee.label ?? 'Melee',
    });
  }
  if (src.ranged) {
    out.push({
      key: 'ranged',
      profile: src.ranged,
      label: src.ranged.label ?? 'Ranged',
    });
  }
  for (const ability of src.abilities) {
    if (ability.kind === 'passive') continue;
    if (ability.profiles.length === 0) continue;
    const profile = ability.profiles[0];
    out.push({
      key: `ability:${ability.id}` as AttackKey,
      profile,
      label: ability.name,
    });
  }
  return out;
}
