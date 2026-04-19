import { resolveAttack } from './attack';
import type {
  Attacker,
  AttackContext,
  AttackProfile,
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

export function applyBonusHits(
  profile: AttackProfile,
  buffs: TurnBuff[] | undefined,
  isFirstTurn: boolean,
): AttackProfile {
  if (!buffs || buffs.length === 0) return profile;
  let extra = 0;
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
    if (match) extra += n;
  }
  if (extra === 0) return profile;
  return { ...profile, hits: Math.max(1, profile.hits + extra) };
}

export function resolveRotation(
  attacker: Attacker,
  target: Target,
  rotation: Rotation,
): RotationBreakdown {
  const perTurn: DamageBreakdown[] = [];
  const cumulativeExpected: number[] = [];
  let cumulative = 0;
  let remainingShield = target.currentShield ?? 0;
  let remainingHp = target.currentHp ?? resolveBaseHp(target);
  let turnsToKill: number | 'unreachable' = 'unreachable';

  rotation.turns.forEach((turn, turnIdx) => {
    const buffedAttacker = applyTurnBuffs(attacker, turn.buffs);
    let turnTotal = 0;
    for (const ctx of turn.attacks) {
      const stepTarget: Target = {
        ...target,
        currentShield: remainingShield,
        currentHp: remainingHp,
      };
      const adjusted: AttackContext = {
        ...ctx,
        profile: applyBonusHits(ctx.profile, turn.buffs, turnIdx === 0),
      };
      const result = resolveAttack(buffedAttacker, stepTarget, adjusted);
      perTurn.push(result);
      turnTotal += result.expected;

      let dmgLeft = result.expected;
      if (remainingShield > 0) {
        const absorbed = Math.min(remainingShield, dmgLeft);
        remainingShield -= absorbed;
        dmgLeft -= absorbed;
      }
      remainingHp = Math.max(0, remainingHp - dmgLeft);
    }
    cumulative += turnTotal;
    cumulativeExpected.push(cumulative);
    if (remainingHp <= 0 && turnsToKill === 'unreachable') {
      turnsToKill = turnIdx + 1;
    }
  });

  return { perTurn, cumulativeExpected, turnsToKill };
}

function resolveBaseHp(target: Target): number {
  if ('stages' in target.source) {
    const idx = target.stageIndex ?? 0;
    return target.source.stages[Math.min(idx, target.source.stages.length - 1)].hp;
  }
  return target.source.baseStats.hp;
}

export function singleAttackRotation(ctx: AttackContext): Rotation {
  return { turns: [{ attacks: [ctx] }] };
}
