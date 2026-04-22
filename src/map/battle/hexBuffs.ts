import type { AttackProfile, TurnBuff } from '../../engine/types';
import type { MapBattleState, Unit } from './mapBattleState';
import { hexEffectsAffecting, terrainAt } from './mapBattleState';

/**
 * Translate terrain + hex effects into engine-shaped `TurnBuff[]` so the
 * existing `applyTurnBuffs` / `applyBonusHits` / `applyPierceBuffs` /
 * `applyHitsDelta` pipeline folds them through without any engine edit
 * beyond the Phase 2 additive hooks.
 *
 * Five wiki-confirmed map mechanics covered in this MVP:
 *
 *   1. **High Ground (attacker)** — attacker on a `highGround` hex gets
 *      +50% damage (`onAttackFromDamageMultiplier = 1.5` in terrain.json).
 *      Emitted as `damageMultiplier: 1.5`.
 *
 *   2. **Trenches (defender)** — target on a `trenches` hex halves
 *      incoming damage (`crossingBorderDefenseMultiplier = 0.5`). We
 *      emit `damageMultiplier: 0.5` as an approximation; the strict
 *      "crossing border" semantics (attacker and defender on different
 *      sides of a trench line) will land in a later phase once we have
 *      map-specific border metadata.
 *
 *   3. **Tall Grass (defender)** — target on a `tallGrass` hex reduces
 *      the attacker's ranged hits by 2 (min 1). Emitted as
 *      `hitsDelta: -2, hitsDeltaOn: 'normal'` guarded on a ranged
 *      profile. Ability attacks are unaffected by default — if
 *      calibration later shows abilities are also reduced, flip the
 *      emission gate.
 *
 *   4. **Ice (defender)** — target on an `ice` hex takes +25% crit
 *      damage. Emitted via the `ice` hex-effect catalog entry's
 *      `critDamageDelta: +0.25` (terrain.onOccupyEffect = 'ice' in the
 *      terrain catalog is Phase 4's concern; here we handle the effect
 *      if it's present on the hex at all).
 *
 *   5. **Contamination (armor)** — hex effects with
 *      `kind: 'armorDelta'` are NOT emitted here. They land in
 *      `targetAdapter.ts::unitToTarget` via `statOverrides.armor` so
 *      the engine's defensive phase picks them up. Keeping the split
 *      clean: hexBuffs emits OFFENSIVE and MID-ATTACK mods; the target
 *      adapter owns defensive-stat overrides.
 *
 * Razor wire's on-occupy Fire spawn is a state mutation (applyHexEffect
 * at movement time), not a TurnBuff. Spore mine's flatDamageOnEnter is
 * also movement-time. Neither is emitted from this function.
 */
export function deriveHexBuffs(
  attacker: Unit,
  target: Unit,
  battle: MapBattleState,
  profile: AttackProfile,
): TurnBuff[] {
  const buffs: TurnBuff[] = [];

  // ── 1. High Ground — on the attacker's hex.
  const attackerTerrain = terrainAt(battle, attacker.position);
  if (
    attackerTerrain &&
    attackerTerrain.onAttackFromDamageMultiplier !== undefined &&
    attackerTerrain.onAttackFromDamageMultiplier !== 1
  ) {
    buffs.push({
      id: `terrain:${attackerTerrain.id}:attackerBonus`,
      name: `${attackerTerrain.displayName} (attacker)`,
      damageMultiplier: attackerTerrain.onAttackFromDamageMultiplier,
    });
  }

  // ── 2. Trenches — on the target's hex.
  const targetTerrain = terrainAt(battle, target.position);
  if (
    targetTerrain &&
    targetTerrain.crossingBorderDefenseMultiplier !== undefined &&
    targetTerrain.crossingBorderDefenseMultiplier !== 1
  ) {
    buffs.push({
      id: `terrain:${targetTerrain.id}:defenderBonus`,
      name: `${targetTerrain.displayName} (defender)`,
      damageMultiplier: targetTerrain.crossingBorderDefenseMultiplier,
    });
  }

  // ── 3. Tall Grass — ranged-hits penalty on the target's hex.
  if (
    targetTerrain &&
    targetTerrain.rangedHitsDelta !== undefined &&
    targetTerrain.rangedHitsDelta !== 0 &&
    profile.kind === 'ranged'
  ) {
    buffs.push({
      id: `terrain:${targetTerrain.id}:rangedHits`,
      name: `${targetTerrain.displayName} (ranged hits)`,
      hitsDelta: targetTerrain.rangedHitsDelta,
      hitsDeltaOn: 'normal',
    });
  }

  // ── 4. Hex-effect modifiers on the target's hex (Ice +25% crit dmg,
  //    Despoiled Ground +20% imperial dmg, ...). Effects whose `affects`
  //    catalog field excludes the defender's side are filtered out.
  for (const { def } of hexEffectsAffecting(battle, target.position, target.side)) {
    switch (def.modifier.kind) {
      case 'critDamageDelta':
        buffs.push({
          id: `hexEffect:${def.id}:critDamage`,
          name: `${def.displayName} (+crit damage)`,
          critDamage: def.modifier.pct,
        });
        break;
      case 'factionDamageDelta': {
        const attackerAlliance = attacker.attacker.source.alliance;
        if (attackerAlliance === def.modifier.alliance) {
          buffs.push({
            id: `hexEffect:${def.id}:factionDamage`,
            name: `${def.displayName} (+${def.modifier.alliance} damage)`,
            damageMultiplier: 1 + def.modifier.pct,
          });
        }
        break;
      }
      // armorDelta → handled in targetAdapter.ts
      // dotOfMaxHpPct → end-of-turn tick, handled in battle layer
      // flatDamageOnEnter → movement-time, handled in battle layer
      // blocksMove → pathfinding, handled in battle layer
      case 'armorDelta':
      case 'dotOfMaxHpPct':
      case 'flatDamageOnEnter':
      case 'blocksMove':
        break;
    }
  }

  return buffs;
}
