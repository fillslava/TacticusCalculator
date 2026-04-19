import { damageAfterArmor } from './armor';
import { varianceBand } from './variance';
import { critProbabilityAtHit, clamp01 } from './crit';
import { pierceOf } from './dmgTypes';
import {
  applyStarAndRank,
  applyEquipmentMods,
  abilityLevelMultiplier,
  statFactor,
} from './scaling';
import { fold, resolveTraits } from './modifiers';
import { loadCatalog } from '../data/catalog';
import type {
  Attacker,
  AttackContext,
  AttackerResolvedStats,
  BossStage,
  DamageBreakdown,
  Frame,
  PerHitBreakdown,
  Target,
  TargetResolvedStats,
  TraceStep,
} from './types';

function resolveAttackerStats(attacker: Attacker): AttackerResolvedStats {
  const base = applyStarAndRank(
    attacker.source.baseStats,
    attacker.progression.stars,
    attacker.progression.rank,
  );
  const withEq = applyEquipmentMods(
    base,
    attacker.equipment.map((e) => e.mods),
  );
  const buffs = attacker.activeBuffs;
  if (buffs) {
    withEq.damage += buffs.damageFlat ?? 0;
    withEq.critChance += buffs.critChance ?? 0;
    withEq.critDamage += buffs.critDamage ?? 0;
    for (const m of buffs.damageMultipliers ?? []) {
      withEq.damage *= m;
    }
  }
  return {
    ...withEq,
    traits: [...attacker.source.traits, ...(buffs?.traits ?? [])],
  };
}

function resolveTargetStats(target: Target): TargetResolvedStats {
  if ('stages' in target.source) {
    const idx = target.stageIndex ?? 0;
    const stage: BossStage =
      target.source.stages[Math.min(idx, target.source.stages.length - 1)];
    return {
      armor: stage.armor,
      hp: target.currentHp ?? stage.hp,
      shield: target.currentShield ?? stage.shield ?? 0,
      traits: [...stage.traits, ...(target.activeDebuffs?.traits ?? [])],
      damageCaps: stage.damageCapsByStage,
    };
  }
  const cs = target.source;
  return {
    armor: cs.baseStats.armor,
    hp: target.currentHp ?? cs.baseStats.hp,
    shield: target.currentShield ?? 0,
    traits: [...cs.traits, ...(target.activeDebuffs?.traits ?? [])],
  };
}

function buildInitialFrame(attacker: Attacker, target: Target, ctx: AttackContext): Frame {
  const a = resolveAttackerStats(attacker);
  const t = resolveTargetStats(target);
  const profile = { ...ctx.profile };
  const pierce = pierceOf(profile.damageType, profile.pierceOverride);

  let damageFactor = profile.damageFactor ?? 1;
  let abilityMul = 1;
  if (profile.kind === 'ability') {
    const curves = loadCatalog().curves;
    abilityMul = abilityLevelMultiplier(
      attacker.progression.xpLevel,
      attacker.progression.rarity,
      curves.abilityFactor,
    );
    damageFactor *= abilityMul;
  }

  const sf = statFactor(attacker.progression.stars, attacker.progression.rank);
  const trace: TraceStep[] = [
    {
      phase: 'statScaling',
      description: `statFactor=${sf.toFixed(3)} (stars=${attacker.progression.stars} rank=${attacker.progression.rank})`,
    },
    {
      phase: 'statScaling',
      description: `attacker: dmg=${a.damage.toFixed(1)} armor=${a.armor.toFixed(1)} hp=${a.hp.toFixed(1)}`,
    },
    {
      phase: 'statScaling',
      description: `target: armor=${t.armor} hp=${t.hp} shield=${t.shield}`,
    },
    {
      phase: 'statScaling',
      description:
        profile.kind === 'ability'
          ? `profile: ${profile.label} type=${profile.damageType} pierce=${pierce} hits=${profile.hits} dmgFactor=${(profile.damageFactor ?? 1).toFixed(2)} × abilityMul=${abilityMul.toFixed(2)}`
          : `profile: ${profile.label} type=${profile.damageType} pierce=${pierce} hits=${profile.hits}`,
    },
  ];
  return {
    attacker: a,
    target: t,
    profile,
    pierce,
    armorPasses: 1,
    armorPassesOnCrit: 1,
    preArmorFlat: profile.preArmorAddFlat ?? 0,
    preArmorMultiplier: profile.preArmorMultiplier ?? 1,
    postArmorMultiplier: 1,
    critChance: a.critChance,
    critDamage: a.critDamage,
    damageFactor,
    trace,
  };
}

function perHitDamage(
  baseDamage: number,
  isCrit: boolean,
  frame: Frame,
): { expected: number; min: number; max: number } {
  const critBonus = isCrit ? frame.critDamage : 0;
  const base = baseDamage + critBonus;
  const effective = base * frame.damageFactor + frame.preArmorFlat;
  const effectiveMul = effective * frame.preArmorMultiplier;

  let capped = effectiveMul;
  if (frame.profile.capAt === 'preArmor' && frame.cap !== undefined) {
    capped = Math.min(capped, frame.cap);
  }

  const band = varianceBand(capped);
  const passes = isCrit ? frame.armorPassesOnCrit : frame.armorPasses;
  const lo = damageAfterArmor(band.low, frame.target.armor, frame.pierce, passes);
  const mid = damageAfterArmor(band.mid, frame.target.armor, frame.pierce, passes);
  const hi = damageAfterArmor(band.high, frame.target.armor, frame.pierce, passes);

  let eMul = frame.postArmorMultiplier;
  const eLo = lo * eMul;
  const eMid = mid * eMul;
  const eHi = hi * eMul;

  let expected = eMid;
  let min = eLo;
  let max = eHi;
  if (frame.profile.capAt === 'finalHit' && frame.cap !== undefined) {
    expected = Math.min(expected, frame.cap);
    min = Math.min(min, frame.cap);
    max = Math.min(max, frame.cap);
  }
  return { expected, min, max };
}

export function resolveAttack(
  attacker: Attacker,
  target: Target,
  ctx: AttackContext,
): DamageBreakdown {
  let frame = buildInitialFrame(attacker, target, ctx);

  const allTraitIds = [
    ...frame.attacker.traits,
    ...frame.target.traits,
  ];
  const mods = resolveTraits(allTraitIds);
  frame = fold(frame, mods);

  const baseDamage = frame.attacker.damage;
  const perHit: PerHitBreakdown[] = [];
  let totalExpected = 0;
  let totalMin = 0;
  let totalMax = 0;

  const hits = Math.max(1, Math.floor(frame.profile.hits));
  const pCritBase = clamp01(frame.critChance);

  for (let n = 1; n <= hits; n++) {
    const pCrit = critProbabilityAtHit(pCritBase, n);
    const crit = perHitDamage(baseDamage, true, frame);
    const nonCrit = perHitDamage(baseDamage, false, frame);
    const expected = crit.expected * pCrit + nonCrit.expected * (1 - pCrit);
    const min = nonCrit.min;
    const max = crit.max;
    totalExpected += expected;
    totalMin += min;
    totalMax += max;
    perHit.push({ hitIndex: n, pCrit, expected, min, max });
  }

  const critProbability = pCritBase;

  const shield = frame.target.shield;
  const hp = frame.target.hp;
  const postShieldExpected = Math.max(0, totalExpected - shield);
  const postHpExpected = Math.max(0, hp - postShieldExpected);

  return {
    expected: totalExpected,
    min: totalMin,
    max: totalMax,
    critProbability,
    perHit,
    postShieldExpected,
    postHpExpected,
    overkill: totalExpected > hp * 2,
    cappedBy: frame.cappedBy,
    trace: frame.trace,
  };
}
