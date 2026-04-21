import { damageAfterArmor } from './armor';
import { varianceBand } from './variance';
import { critProbabilityAtHit, clamp01 } from './crit';
import { applyBlockToBand, blendBands, blockProbabilityAtHit } from './block';
import type { DamageBand } from './block';
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
    // Bosses don't carry block stats in the scraped catalog (BossStage has no
    // block fields). Traits like Daemon layer block on via onBlock modifier.
    return {
      armor: target.statOverrides?.armor ?? stage.armor,
      hp: target.currentHp ?? target.statOverrides?.hp ?? stage.hp,
      shield: target.currentShield ?? stage.shield ?? 0,
      blockChance: 0,
      blockDamage: 0,
      traits: [...stage.traits, ...(target.activeDebuffs?.traits ?? [])],
      damageCaps: stage.damageCapsByStage,
    };
  }
  const cs = target.source;
  return {
    armor: target.statOverrides?.armor ?? cs.baseStats.armor,
    hp: target.currentHp ?? target.statOverrides?.hp ?? cs.baseStats.hp,
    shield: target.currentShield ?? 0,
    blockChance: cs.baseStats.blockChance ?? 0,
    blockDamage: cs.baseStats.blockDamage ?? 0,
    traits: [...cs.traits, ...(target.activeDebuffs?.traits ?? [])],
  };
}

function buildInitialFrame(attacker: Attacker, target: Target, ctx: AttackContext): Frame {
  let a = resolveAttackerStats(attacker);
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
    // Ability damage does NOT scale with stars/rank in Tacticus — the
    // tacticus.wiki.gg damage tables (verified across all 6 rarities for
    // Kharn's "Kill! Maim! Burn!" Piercing) use the raw level-1-rank-0 base
    // damage stat, combined only with damageFactor and the ability-level ×
    // rarity multiplier. `resolveAttackerStats` has already multiplied by
    // statFactor for normal attacks, so we revert that here for abilities
    // only. Crit chance, crit damage, and traits stay scaled — they
    // participate in the ability damage formula unchanged.
    a = { ...a, damage: attacker.source.baseStats.damage };
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

interface PerHitBands {
  preArmor: DamageBand;
  postArmor: DamageBand;
}

function perHitDamage(baseDamage: number, isCrit: boolean, frame: Frame): PerHitBands {
  // Per HDTW wiki step 1: "Damage value" = the per-hit damage written on the
  // ability description (i.e. baseDamage × damageFactor × abilityMul).
  // Crit replaces that per-hit value with (Damage + Crit Damage). So the
  // critDamage flat bonus MUST be added AFTER the damage-factor chain, not
  // before — otherwise an ability with damageFactor×abilityMul = 130 (Mythic
  // L60) would amplify a 1797-point crit weapon into 234 000 per hit, which
  // is an order of magnitude more than the game actually deals.
  const effectiveBeforeCrit = baseDamage * frame.damageFactor;
  const critBonus = isCrit ? frame.critDamage : 0;
  const effective = effectiveBeforeCrit + critBonus + frame.preArmorFlat;
  const effectiveMul = effective * frame.preArmorMultiplier;

  let preArmorCapped = effectiveMul;
  if (frame.profile.capAt === 'preArmor' && frame.cap !== undefined) {
    preArmorCapped = Math.min(preArmorCapped, frame.cap);
  }

  const band = varianceBand(preArmorCapped);
  const preArmorBand: DamageBand = { expected: band.mid, min: band.low, max: band.high };

  const passes = isCrit ? frame.armorPassesOnCrit : frame.armorPasses;
  const postMul = frame.postArmorMultiplier;
  const armored = (v: number) =>
    damageAfterArmor(v, frame.target.armor, frame.pierce, passes) * postMul;
  let postArmorBand: DamageBand = {
    expected: armored(band.mid),
    min: armored(band.low),
    max: armored(band.high),
  };
  if (frame.profile.capAt === 'finalHit' && frame.cap !== undefined) {
    postArmorBand = {
      expected: Math.min(postArmorBand.expected, frame.cap),
      min: Math.min(postArmorBand.min, frame.cap),
      max: Math.min(postArmorBand.max, frame.cap),
    };
  }
  return { preArmor: preArmorBand, postArmor: postArmorBand };
}

/**
 * Armor-reduce a pre-armor damage band. Used to apply armor to shield-overflow
 * damage, which the wiki states "is treated as a new attack and goes through
 * the damage calculation, skipping the variance roll" — so we reuse the
 * variance-less per-hit expected/min/max values directly.
 *
 * Simplification: always uses non-crit armorPasses even when the overflow
 * originated from a crit-blended expectation. Matters only for traits that
 * change armor passes on crit (e.g. Gravis), where overflow into HP might be
 * slightly over- or under-penetrated.
 */
function armorReduceBand(band: DamageBand, frame: Frame): DamageBand {
  const reduce = (v: number) =>
    damageAfterArmor(v, frame.target.armor, frame.pierce, frame.armorPasses) *
    frame.postArmorMultiplier;
  return {
    expected: reduce(band.expected),
    min: reduce(band.min),
    max: reduce(band.max),
  };
}

function subtractShield(band: DamageBand, shieldRemaining: number): {
  toShield: DamageBand;
  overflow: DamageBand;
} {
  const eat = (v: number) => Math.min(v, shieldRemaining);
  const rest = (v: number) => Math.max(0, v - shieldRemaining);
  return {
    toShield: { expected: eat(band.expected), min: eat(band.min), max: eat(band.max) },
    overflow: { expected: rest(band.expected), min: rest(band.min), max: rest(band.max) },
  };
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
  let totalHpDamage = 0;

  const hits = Math.max(1, Math.floor(frame.profile.hits));
  const pCritBase = clamp01(frame.critChance);
  const pBlockBase = clamp01(frame.target.blockChance);
  const blockDamage = Math.max(0, frame.target.blockDamage);

  // Shield & HP are consumed as hits resolve. Per HDTW_Shields, damage applied
  // to shields skips armor (shield has 0 armor) and block rolls are cosmetic
  // vs shields. Overflow from a shield-breaking hit is treated as a fresh
  // attack through armor/block — variance is NOT re-rolled (we're in
  // expected mode anyway). Block chain probability p^n advances independently
  // of shield routing.
  let shieldRemaining = frame.target.shield;
  const hp = frame.target.hp;

  for (let n = 1; n <= hits; n++) {
    const pCrit = critProbabilityAtHit(pCritBase, n);
    const pBlock = blockProbabilityAtHit(pBlockBase, n);
    const crit = perHitDamage(baseDamage, true, frame);
    const nonCrit = perHitDamage(baseDamage, false, frame);

    // Crit-blended pre- and post-armor bands.
    const preArmor = blendBands(crit.preArmor, nonCrit.preArmor, pCrit);
    const postArmor = blendBands(crit.postArmor, nonCrit.postArmor, pCrit);

    let shieldBand: DamageBand = { expected: 0, min: 0, max: 0 };
    let hpBand: DamageBand = { expected: 0, min: 0, max: 0 };

    if (shieldRemaining > 0) {
      // Shield eats pre-armor damage up to its remaining HP; block roll still
      // happens (for chain accounting) but doesn't reduce the number that
      // lands on shield.
      const split = subtractShield(preArmor, shieldRemaining);
      shieldBand = split.toShield;
      shieldRemaining = Math.max(0, shieldRemaining - split.toShield.expected);
      if (split.overflow.max > 0 || split.overflow.expected > 0) {
        const overflowArmored = armorReduceBand(split.overflow, frame);
        hpBand = applyBlockToBand(overflowArmored, pBlock, blockDamage);
      }
    } else {
      hpBand = applyBlockToBand(postArmor, pBlock, blockDamage);
    }

    const hitExpected = shieldBand.expected + hpBand.expected;
    const hitMin = shieldBand.min + hpBand.min;
    const hitMax = shieldBand.max + hpBand.max;

    totalExpected += hitExpected;
    totalMin += hitMin;
    totalMax += hitMax;
    totalHpDamage += hpBand.expected;

    perHit.push({ hitIndex: n, pCrit, expected: hitExpected, min: hitMin, max: hitMax });
  }

  const critProbability = pCritBase;
  const postShieldExpected = totalHpDamage;
  const postHpExpected = Math.max(0, hp - postShieldExpected);

  return {
    expected: totalExpected,
    min: totalMin,
    max: totalMax,
    critProbability,
    perHit,
    postShieldExpected,
    postHpExpected,
    overkill: totalHpDamage > hp * 2,
    cappedBy: frame.cappedBy,
    trace: frame.trace,
  };
}
