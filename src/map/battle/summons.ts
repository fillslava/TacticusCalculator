import type { AttackProfile, CatalogCharacter } from '../../engine/types';
import type { Hex } from '../core/hex';
import { hexKey } from '../core/hex';
import { applyHexEffect, type MapBattleState, type Unit } from './mapBattleState';

/**
 * Phase 5 — player-side summons.
 *
 * The only summon in the shipped catalog is the **Biovore spore mine**.
 * Spore mines are two things simultaneously:
 *
 *   1. A **hex effect** on the ground that damages an enemy when it
 *      enters the hex (the `sporeMine` entry in `hexEffects.json`, whose
 *      modifier kind is `flatDamageOnEnter`). The hex effect handles the
 *      "boss walks into the mine" case.
 *   2. A **targetable summon Unit** sitting on the same hex. Making it a
 *      Unit lets the boss AI's `PREFER_SUMMONS_THEN_WEAKEST` policy find
 *      it and shoot it (detonating it prematurely from the boss's own
 *      turn). A plain hex-effect without a Unit wrapper would be
 *      invisible to `targetPolicy.pick`.
 *
 * Shape of a spore-mine Unit:
 *   - `side: 'player'` — it belongs to the team (so "enemy" policies
 *     find it as a valid target).
 *   - `kind: 'summon'` — PREFER_SUMMONS_THEN_WEAKEST keys off this.
 *   - `currentHp: 1` — fragile by design; any real hit overkills it.
 *   - `attacker.source` is a synthetic `CatalogCharacter` with a
 *     placeholder melee profile so the `Attacker` type is satisfied. The
 *     mine never attacks (no scripted turn slot); the profile is pure
 *     ballast.
 *
 * IDs are stable + deterministic (`sporeMine_<hexKey>_<seq>`) so scenario
 * tests can re-run without mine-id churn.
 */

let sporeMineSeq = 0;

/** Test hook — reset the running counter so fixture output is stable. */
export function __resetSporeMineSeq(): void {
  sporeMineSeq = 0;
}

export function spawnSporeMine(
  battle: MapBattleState,
  at: Hex,
  opts: { hp?: number; damage?: number } = {},
): Unit {
  const hp = Math.max(1, opts.hp ?? 1);
  const id = `sporeMine_${hexKey(at)}_${sporeMineSeq++}`;

  const placeholder: AttackProfile = {
    label: 'Detonation',
    damageType: 'bio',
    hits: 1,
    kind: 'melee',
  };
  const source: CatalogCharacter = {
    id: 'biovore_spore_mine',
    displayName: 'Spore Mine',
    faction: 'Tyranids',
    alliance: 'xenos',
    baseStats: {
      damage: 0,
      armor: 0,
      hp,
      critChance: 0,
      critDamage: 0,
      blockChance: 0,
      blockDamage: 0,
      meleeHits: 1,
      rangedHits: 1,
    },
    melee: placeholder,
    abilities: [],
    traits: ['summon'],
    maxRarity: 'epic',
  };

  const unit: Unit = {
    id,
    side: 'player',
    kind: 'summon',
    position: { q: at.q, r: at.r },
    attacker: {
      source,
      progression: { stars: 0, rank: 0, xpLevel: 1, rarity: 'epic' },
      equipment: [],
    },
    maxHp: hp,
    maxShield: 0,
    currentHp: hp,
    currentShield: 0,
    statusEffects: [],
  };

  // Register the unit.
  battle.units[id] = unit;

  // And, mirroring the wiki behaviour, drop the matching hex effect so a
  // boss stepping onto the hex triggers the `flatDamageOnEnter` modifier
  // in addition to being able to be shot. The hex-effect catalog already
  // carries the damage amount; caller can pass `opts.damage` for scenario
  // tests that need a specific number, and we skip emission if 0 is
  // requested.
  const effectDamage = Math.max(0, opts.damage ?? 0);
  if (effectDamage > 0) {
    applyHexEffect(battle, at, 'sporeMine', 'player', 'biovore');
  }

  return unit;
}

/**
 * Purge spore-mine effects + the matching summon unit from a hex — used
 * by the battle layer when the mine resolves (boss stepped on it) so the
 * player doesn't see a ghost summon still sitting there with 1 HP.
 */
export function detonateSporeMine(
  battle: MapBattleState,
  unitId: string,
): void {
  const unit = battle.units[unitId];
  if (!unit || unit.kind !== 'summon') return;
  const key = hexKey(unit.position);
  delete battle.units[unitId];
  const list = battle.hexEffectsAt[key];
  if (list) {
    battle.hexEffectsAt[key] = list.filter((e) => e.effectId !== 'sporeMine');
    if (battle.hexEffectsAt[key].length === 0) delete battle.hexEffectsAt[key];
  }
}
