import { resolveAttack } from './attack';
import { pierceOf } from './dmgTypes';
import {
  abilityFor,
  applyScaling,
  canFireAbility,
  initRotationState,
  RotationState,
  scalingMultiplier,
  shouldTrigger,
  stampCooldown,
  tickCooldowns,
} from './triggers';
import type {
  Attacker,
  AttackContext,
  AttackProfile,
  CatalogAbility,
  DamageBreakdown,
  ModifierStack,
  Rotation,
  RotationBreakdown,
  Target,
  TurnBuff,
} from './types';

export function applyTurnBuffs(attacker: Attacker, buffs: TurnBuff[] | undefined): Attacker {
  if (!buffs || buffs.length === 0) return attacker;
  const base = attacker.activeBuffs;
  const merged: ModifierStack = {
    traits: [...(base?.traits ?? [])],
    damageMultipliers: [...(base?.damageMultipliers ?? [])],
    damageFlat: base?.damageFlat ?? 0,
    critChance: base?.critChance ?? 0,
    critDamage: base?.critDamage ?? 0,
  };
  for (const b of buffs) {
    if (b.damageFlat) merged.damageFlat! += b.damageFlat;
    if (b.damageMultiplier && b.damageMultiplier !== 1)
      merged.damageMultipliers!.push(b.damageMultiplier);
    if (b.critChance) merged.critChance! += b.critChance;
    if (b.critDamage) merged.critDamage! += b.critDamage;
    if (b.traits) merged.traits!.push(...b.traits);
  }
  return { ...attacker, activeBuffs: merged };
}

/**
 * Fold every buff's `pierceAdd` into the profile's `pierceOverride`. Pierce
 * is a profile-level stat (consumed by `damageAfterArmor`), so we mutate the
 * profile rather than routing through ModifierStack. Stacks additively
 * across buffs and clamps to `[0, 1]`.
 *
 * Attack-kind gating (melee-only, ability-only) is handled at derivation
 * site — `deriveTeamBuffs` only emits a `pierceAdd` buff when the current
 * profile matches the buff's attack-kind filter, mirroring how damageFlat
 * is handled for Aesoth/Trajann. By the time buffs reach this function,
 * every pierceAdd entry is already qualified for the profile.
 *
 * Returns the unmodified profile when no buffs contribute pierce.
 */
export function applyPierceBuffs(
  profile: AttackProfile,
  buffs: TurnBuff[] | undefined,
): AttackProfile {
  if (!buffs || buffs.length === 0) return profile;
  let add = 0;
  for (const b of buffs) {
    if (b.pierceAdd) add += b.pierceAdd;
  }
  if (add === 0) return profile;
  // When the profile has no explicit `pierceOverride`, the engine falls
  // back to the damage-type's default pierce ratio (see dmgTypes.ts). We
  // must add relative to that default, not zero — otherwise buffing power
  // (default 0.4) by +0.4 would produce pierce=0.4 instead of 0.8,
  // silently CANCELING the buff for any unmodified profile.
  const base = profile.pierceOverride ?? pierceOf(profile.damageType);
  const next = Math.max(0, Math.min(1, base + add));
  if (next === base) return profile;
  return { ...profile, pierceOverride: next };
}

/**
 * Fold every buff's `hitsDelta` into the profile's hit count. Unlike
 * `applyBonusHits`, this is **not** STMA-gated — a tall-grass -2 applies
 * on every profile of a multi-profile ability, not just the first. The
 * cumulative delta is added to `profile.hits` and the result is clamped
 * at `>= 1` (tall grass wiki: "ranged attacks have -2 hits, minimum 1").
 *
 * Attack-kind filtering honors `hitsDeltaOn` (default 'all'):
 *   - 'all':     every profile
 *   - 'first':   only on the first turn of the rotation (rare; symmetric
 *                with the existing `bonusHitsOn: 'first'` semantics)
 *   - 'normal':  melee or ranged profiles only
 *   - 'ability': ability profiles only
 *
 * Returns the input profile unchanged when no matching buffs contribute.
 */
export function applyHitsDelta(
  profile: AttackProfile,
  buffs: TurnBuff[] | undefined,
  isFirstTurn: boolean,
): AttackProfile {
  if (!buffs || buffs.length === 0) return profile;
  const kind = profile.kind;
  const isNormal = kind === 'melee' || kind === 'ranged';
  const isAbility = kind === 'ability';
  let delta = 0;
  for (const b of buffs) {
    const d = b.hitsDelta;
    if (!d) continue;
    const trigger = b.hitsDeltaOn ?? 'all';
    const match =
      trigger === 'all' ||
      (trigger === 'first' && isFirstTurn) ||
      (trigger === 'normal' && isNormal) ||
      (trigger === 'ability' && isAbility);
    if (!match) continue;
    delta += d;
  }
  if (delta === 0) return profile;
  return { ...profile, hits: Math.max(1, profile.hits + delta) };
}

export function applyBonusHits(
  profile: AttackProfile,
  buffs: TurnBuff[] | undefined,
  isFirstTurn: boolean,
): AttackProfile {
  if (!buffs || buffs.length === 0) return profile;
  // Wiki STMA rule: extra hits apply only to the FIRST attack of a
  // multi-profile ability that hits a target. Subsequent profiles
  // (abilityProfileIdx > 0) receive no bonus-hit additions. See
  // `AttackProfile.abilityProfileIdx` for the stamping contract.
  if ((profile.abilityProfileIdx ?? 0) > 0) return profile;
  let extra = 0;
  let cappedExtra = 0;
  let minCap = Infinity;
  const kind = profile.kind;
  const isNormal = kind === 'melee' || kind === 'ranged';
  const isAbility = kind === 'ability';
  for (const b of buffs) {
    const n = b.bonusHits;
    if (!n) continue;
    const trigger = b.bonusHitsOn ?? 'all';
    const match =
      trigger === 'all' ||
      (trigger === 'first' && isFirstTurn) ||
      (trigger === 'normal' && isNormal) ||
      (trigger === 'ability' && isAbility);
    if (!match) continue;
    extra += n;
    // If this buff caps its bonus hits (Vitruvius Master Annihilator), track
    // the tightest cap across all contributing buffs. Multiple capped buffs
    // stacking is a degenerate case — we keep the smallest cap so no bonus
    // hit exceeds any single cap claim.
    if (b.bonusHitCap !== undefined) {
      cappedExtra += n;
      if (b.bonusHitCap < minCap) minCap = b.bonusHitCap;
    }
  }
  if (extra === 0) return profile;
  const out: AttackProfile = {
    ...profile,
    hits: Math.max(1, profile.hits + extra),
  };
  if (cappedExtra > 0) {
    out.bonusHitCount = (profile.bonusHitCount ?? 0) + cappedExtra;
    out.bonusHitCap =
      profile.bonusHitCap !== undefined
        ? Math.min(profile.bonusHitCap, minCap)
        : minCap;
  }
  return out;
}

/**
 * Resolve a full rotation against a target. Threads cooldown state and
 * per-battle counters across turns, auto-fires passive triggers after each
 * normal/first-attack, and applies Kariyan-style scaling to abilities
 * that declare it.
 *
 * Ordering per turn:
 *   1. apply user turn buffs
 *   2. for each scheduled attack (in order):
 *      a. if ability & on cooldown → record a skip, continue
 *      b. apply scaling multiplier (if ability has `scaling`)
 *      c. resolve attack, append to perTurn, drain shield/HP
 *      d. stamp cooldown if ability
 *      e. fire all passives whose triggers match (appending extra perTurn
 *         entries; each consumes the same shield/HP pool)
 *   3. tick cooldowns down by 1
 *   4. increment turnsAttackedThisBattle
 *
 * Triggered-passive damage is included in perTurn alongside scheduled
 * attacks — `triggeredFires` annotates which entries came from passives
 * so the UI can label them.
 */
export function resolveRotation(
  attacker: Attacker,
  target: Target,
  rotation: Rotation,
): RotationBreakdown {
  const perTurn: DamageBreakdown[] = [];
  const cumulativeExpected: number[] = [];
  const cooldownSkips: { turnIdx: number; abilityId: string }[] = [];
  const triggeredFires: { turnIdx: number; abilityId: string; profileIdx: number }[] = [];
  const state: RotationState = initRotationState();
  let cumulative = 0;
  let remainingShield = target.currentShield ?? 0;
  let remainingHp = target.currentHp ?? resolveBaseHp(target);
  let turnsToKill: number | 'unreachable' = 'unreachable';

  rotation.turns.forEach((turn, turnIdx) => {
    const buffedAttacker = applyTurnBuffs(attacker, turn.buffs);
    let turnTotal = 0;
    let isFirstAttackOfTurn = true;

    /** Resolve a single AttackContext given current shield/HP state.
     *  Mutates closure variables `remainingShield`/`remainingHp` and pushes
     *  into `perTurn`. */
    const runAttack = (ctx: AttackContext): DamageBreakdown => {
      const stepTarget: Target = {
        ...target,
        currentShield: remainingShield,
        currentHp: remainingHp,
      };
      const result = resolveAttack(buffedAttacker, stepTarget, ctx);
      perTurn.push(result);
      turnTotal += result.expected;

      let dmgLeft = result.expected;
      if (remainingShield > 0) {
        const absorbed = Math.min(remainingShield, dmgLeft);
        remainingShield -= absorbed;
        dmgLeft -= absorbed;
      }
      remainingHp = Math.max(0, remainingHp - dmgLeft);
      return result;
    };

    for (const ctx of turn.attacks) {
      // 1. Cooldown gate.
      if (!canFireAbility(ctx.profile, state)) {
        cooldownSkips.push({
          turnIdx,
          abilityId: ctx.profile.abilityId ?? '<unknown>',
        });
        continue;
      }

      // 2. Apply scaling (Kariyan-style) to the profile before resolving.
      const matchedAbility = abilityFor(buffedAttacker, ctx.profile);
      const scaleMul = scalingMultiplier(matchedAbility, state);
      const scaled = applyScaling(ctx.profile, scaleMul);

      // 3. Apply per-turn bonus hits and hitsDelta, then resolve. Order:
      //    bonusHits first (STMA gated) → hitsDelta second (applies on
      //    every profile). Tall-grass -2 floors at 1 even after Vitruvius
      //    adds its +1.
      const adjusted: AttackContext = {
        ...ctx,
        profile: applyHitsDelta(
          applyBonusHits(scaled, turn.buffs, turnIdx === 0),
          turn.buffs,
          turnIdx === 0,
        ),
      };
      runAttack(adjusted);

      // 4. Cooldown stamp (only actual abilities).
      stampCooldown(buffedAttacker, ctx.profile, state);

      // 5. Fire any passive triggers off this attack.
      for (const passive of buffedAttacker.source.abilities) {
        const shouldFire = shouldTrigger(passive, {
          profile: ctx.profile,
          isFirstAttackOfTurn,
          targetTraits: collectTargetTraits(target),
        });
        if (!shouldFire) continue;
        const isMultiProfile = passive.profiles.length > 1;
        passive.profiles.forEach((p, profileIdx) => {
          // Stamp abilityProfileIdx on multi-profile triggered passives
          // (e.g. Volk Fleshmetal Guns) so applyBonusHits applies bonus
          // hits only to the first profile per STMA rule.
          const tagged = isMultiProfile ? { ...p, abilityProfileIdx: profileIdx } : p;
          const passiveCtx: AttackContext = {
            profile: applyHitsDelta(
              applyBonusHits(tagged, turn.buffs, turnIdx === 0),
              turn.buffs,
              turnIdx === 0,
            ),
            rngMode: ctx.rngMode,
          };
          runAttack(passiveCtx);
          triggeredFires.push({
            turnIdx,
            abilityId: passive.id,
            profileIdx,
          });
        });
      }

      isFirstAttackOfTurn = false;
    }

    cumulative += turnTotal;
    cumulativeExpected.push(cumulative);
    if (remainingHp <= 0 && turnsToKill === 'unreachable') {
      turnsToKill = turnIdx + 1;
    }

    // End-of-turn state tick: decrement cooldowns, advance attack counter.
    tickCooldowns(state);
    state.turnsAttackedThisBattle++;
  });

  return {
    perTurn,
    cumulativeExpected,
    turnsToKill,
    cooldownSkips,
    triggeredFires,
  };
}

/**
 * Collect the traits visible on the target — stage traits for bosses,
 * character traits for hero targets, plus any debuff-applied traits.
 * Used by `shouldTrigger` to evaluate `requiresTargetTrait` filters.
 */
function collectTargetTraits(target: Target): string[] {
  const debuffTraits = target.activeDebuffs?.traits ?? [];
  if ('stages' in target.source) {
    const idx = target.stageIndex ?? 0;
    const stage = target.source.stages[Math.min(idx, target.source.stages.length - 1)];
    return [...stage.traits, ...debuffTraits];
  }
  return [...target.source.traits, ...debuffTraits];
}

function resolveBaseHp(target: Target): number {
  if (target.statOverrides?.hp !== undefined) return target.statOverrides.hp;
  if ('stages' in target.source) {
    const idx = target.stageIndex ?? 0;
    return target.source.stages[Math.min(idx, target.source.stages.length - 1)].hp;
  }
  return target.source.baseStats.hp;
}

export function singleAttackRotation(ctx: AttackContext): Rotation {
  return { turns: [{ attacks: [ctx] }] };
}

// Re-export for convenience.
export type { RotationState };
export { initRotationState };

// Silence unused-import warning — CatalogAbility is used for cross-file
// type narrowing in tests; re-exporting keeps it in the public surface.
export type { CatalogAbility };
