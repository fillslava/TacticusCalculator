/**
 * Phase 2 engine additions: passive-trigger auto-fire, cooldown tracking,
 * and per-battle scaling. The module is pure — it only exposes helpers
 * that rotation.ts threads through. Kept separate from attack.ts so the
 * single-attack solver stays state-free.
 */
import type {
  Attacker,
  AttackProfile,
  CatalogAbility,
  TraitId,
} from './types';

/**
 * Mutable per-battle state. Threaded through `resolveRotation` across
 * turns. Cooldowns map ability-id → remaining turns; `turnsAttackedThisBattle`
 * drives Kariyan-style scaling.
 *
 * MVP assumption for `turnsAttackedThisBattle`: the attacker is attacked
 * each turn by the enemy, so the counter advances once per turn. When Guild
 * Raid context arrives (Phase 3) this will be replaced by a per-turn
 * signal from the rotation spec.
 */
export interface RotationState {
  cooldowns: Record<string, number>;
  turnsAttackedThisBattle: number;
}

export function initRotationState(): RotationState {
  return { cooldowns: {}, turnsAttackedThisBattle: 0 };
}

/**
 * Find the catalog ability a profile refers to, by matching `abilityId`
 * against the attacker's `source.abilities` list. Returns undefined for
 * non-ability profiles (melee/ranged) or when the id doesn't resolve.
 */
export function abilityFor(
  attacker: Attacker,
  profile: AttackProfile,
): CatalogAbility | undefined {
  if (profile.kind !== 'ability' || !profile.abilityId) return undefined;
  return attacker.source.abilities.find((a) => a.id === profile.abilityId);
}

export interface TriggerCheckCtx {
  profile: AttackProfile;
  isFirstAttackOfTurn: boolean;
  targetTraits: readonly TraitId[];
}

/**
 * Decide whether a passive fires off the currently-resolving attack.
 *
 * - `afterOwnNormalAttack` — fires only after melee/ranged profiles, not
 *   after other abilities (passives don't chain off actives in Tacticus).
 * - `afterOwnFirstAttackOfTurn` — fires only on the very first attack of
 *   a turn. Target-trait filter (e.g. `big target`) narrows further: only
 *   fires when the target carries that trait. Passives with this trigger
 *   are often paired: one big-target-gated variant + one unrestricted
 *   fallback on the same hero (Kariyan's Legacy of Combat). Both variants
 *   may satisfy the trigger; the rotation is responsible for only picking
 *   the intended one — that's a hand-authoring concern, not an engine one.
 */
export function shouldTrigger(
  ability: CatalogAbility,
  ctx: TriggerCheckCtx,
): boolean {
  const trigger = ability.trigger;
  if (!trigger) return false;
  if (ability.kind !== 'passive') return false;
  const isNormal =
    ctx.profile.kind === 'melee' || ctx.profile.kind === 'ranged';
  if (trigger.kind === 'afterOwnNormalAttack') {
    return isNormal;
  }
  if (trigger.kind === 'afterOwnFirstAttackOfTurn') {
    if (!ctx.isFirstAttackOfTurn) return false;
    if (trigger.requiresTargetTrait) {
      return ctx.targetTraits.includes(trigger.requiresTargetTrait);
    }
    return true;
  }
  return false;
}

/**
 * Per-battle scaling multiplier for an ability. For abilities with
 * `scaling.per === 'turnsAttackedThisBattle'`, returns
 * `1 + (pctPerStep / 100) × turns`. Non-scaling abilities return 1.
 */
export function scalingMultiplier(
  ability: CatalogAbility | undefined,
  state: RotationState,
): number {
  if (!ability?.scaling) return 1;
  if (ability.scaling.per === 'turnsAttackedThisBattle') {
    return 1 + (ability.scaling.pctPerStep / 100) * state.turnsAttackedThisBattle;
  }
  return 1;
}

/**
 * Fold a scaling multiplier into a profile's `preArmorMultiplier`. Applied
 * before `resolveAttack` runs so the attack solver doesn't need to know
 * about battle state.
 */
export function applyScaling(profile: AttackProfile, mult: number): AttackProfile {
  if (mult === 1) return profile;
  return {
    ...profile,
    preArmorMultiplier: (profile.preArmorMultiplier ?? 1) * mult,
  };
}

/**
 * Is this ability attack currently off-cooldown and allowed to fire?
 * Always true for melee/ranged/non-ability profiles. For abilities
 * with no cooldown declared (undefined), fires freely — cooldown
 * tracking is opt-in per ability.
 */
export function canFireAbility(
  profile: AttackProfile,
  state: RotationState,
): boolean {
  if (profile.kind !== 'ability' || !profile.abilityId) return true;
  const remaining = state.cooldowns[profile.abilityId] ?? 0;
  return remaining <= 0;
}

/**
 * After firing an ability, stamp its cooldown onto RotationState. The
 * `999` convention for once-per-battle survives because `tickCooldowns`
 * decrements by 1 — it would take 999 turns to re-arm, far longer than
 * any real battle.
 */
export function stampCooldown(
  attacker: Attacker,
  profile: AttackProfile,
  state: RotationState,
): void {
  if (profile.kind !== 'ability' || !profile.abilityId) return;
  const ability = abilityFor(attacker, profile);
  const cd = ability?.cooldown;
  if (cd === undefined) return;
  state.cooldowns[profile.abilityId] = cd;
}

/**
 * Advance cooldowns by one turn. Called by `resolveRotation` at the end
 * of each turn. Mutates state in place for simplicity — callers that need
 * to compare states across ticks should clone first.
 */
export function tickCooldowns(state: RotationState): void {
  for (const k of Object.keys(state.cooldowns)) {
    state.cooldowns[k] = Math.max(0, state.cooldowns[k] - 1);
  }
}
