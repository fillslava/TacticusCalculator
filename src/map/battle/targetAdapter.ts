import type { ModifierStack, Target } from '../../engine/types';
import type { HexEffectDef } from '../core/mapSchema';
import type { MapBattleState, Unit } from './mapBattleState';
import { hexEffectsAffecting } from './mapBattleState';

/**
 * Adapter: Unit → engine Target. Used when a unit is ATTACKED. The
 * engine's `resolveTargetStats` already branches on `target.source` —
 * CatalogCharacter (hero-as-target) vs CatalogBoss (boss-as-target) —
 * so the shim only has to fill in per-unit runtime fields:
 *
 *   - currentHp / currentShield: from the Unit
 *   - statOverrides.armor: reduced by applied hex effects (contamination
 *     -30%), multiplicatively combined across stacking effects
 *   - activeDebuffs.traits: any traits contributed by hex effects
 *
 * `flatDamageOnEnter` effects (spore mines) are NOT modeled here — they
 * fire at movement-resolve time, not attack-resolve time, and are
 * applied by the battle layer as a separate damage event (Phase 5).
 *
 * `dotOfMaxHpPct` (fire) is likewise tick-based rather than mid-attack,
 * so it ticks at end-of-turn in the battle layer and is not reflected
 * in the Target shape.
 */
export function unitToTarget(unit: Unit, battle: MapBattleState): Target {
  // Gather every effect that *could* alter this attack's Target:
  //   - positional effects on the unit's hex that affect the unit's side
  //   - per-unit status effects (contamination applied personally)
  const positional = hexEffectsAffecting(battle, unit.position, unit.side).map(
    (p) => p.def,
  );
  const personal: HexEffectDef[] = [];
  for (const a of unit.statusEffects) {
    const def = battle.hexEffectById[a.effectId];
    if (!def) continue;
    if (def.affects === 'any' || def.affects === unit.side) personal.push(def);
  }
  const effects: HexEffectDef[] = [...positional, ...personal];

  // Armor delta is multiplicative — 2 stacking -30% effects → × 0.7 × 0.7.
  // Per the catalog these are emitted as pct values where -0.3 means "-30%".
  let armorMul = 1;
  for (const e of effects) {
    if (e.modifier.kind === 'armorDelta') {
      armorMul *= 1 + e.modifier.pct;
    }
  }
  const baseArmor = resolveBaseArmor(unit);
  const statOverrides =
    armorMul === 1
      ? undefined
      : { armor: Math.max(0, baseArmor * armorMul) };

  const debuffTraits: string[] = [];
  // Reserved for future: effects that add traits to the target (none yet).

  const activeDebuffs: ModifierStack | undefined =
    debuffTraits.length > 0 ? { traits: debuffTraits } : undefined;

  const target: Target = {
    source: unit.attacker.source,
    currentHp: unit.currentHp,
    currentShield: unit.currentShield,
  };
  if (statOverrides) target.statOverrides = statOverrides;
  if (activeDebuffs) target.activeDebuffs = activeDebuffs;
  return target;
}

/**
 * The engine's hero-as-target branch reads `source.baseStats.armor`
 * directly (no star/rank scaling) — see `resolveTargetStats` in
 * `src/engine/attack.ts`. We mirror that choice here so that setting
 * `statOverrides.armor` doesn't accidentally re-introduce a scaled
 * value that the engine then fails to scale again.
 */
function resolveBaseArmor(unit: Unit): number {
  return unit.attacker.source.baseStats.armor;
}
