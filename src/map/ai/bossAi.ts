import type { AttackContext, AttackProfile, DamageBreakdown } from '../../engine/types';
import { loadMapCatalog } from '../core/catalog';
import type { BossScript, BossScriptTurn } from '../core/mapSchema';
import { applyDamageToUnit, killUnit } from '../battle/death';
import { resolveIncomingAttack } from '../battle/incoming';
import type { MapBattleState, Unit } from '../battle/mapBattleState';
import { detonateSporeMine } from '../battle/summons';
import { getTargetPolicy } from './targetPolicy';

/**
 * Phase 5 — scripted enemy turn orchestrator.
 *
 * Responsibilities for one call to `runEnemyTurn`:
 *
 *   1. Locate the scripted boss (`kind === 'boss'`, `side === 'enemy'`,
 *      has a `scriptPointer`). The single-boss MVP assumes at most one
 *      such unit; extra enemy units are ignored here and belong to
 *      future phases (summons on the boss side, adds, etc.).
 *   2. Look up the current turn step on its `BossScript`. The script's
 *      `turns[]` is consulted modulo `repeatsFrom` (or modulo its length
 *      when `repeatsFrom` is omitted), so a 4-turn Avatar rotation loops
 *      deterministically as long as the fight lasts.
 *   3. For `{ kind: 'ability' }` or `{ kind: 'normal' }` steps, pick a
 *      target via the script's declared policy and fire a single
 *      `resolveIncomingAttack`. Ability profiles come from the script's
 *      inline `abilities` map; normal attacks use the boss's `melee`
 *      profile (with the boss's `baseStats.damage` — which hydration
 *      absorbs from the script's `stats` block).
 *   4. Drain HP/shield from the victim, kill the unit if its HP hit 0,
 *      and — for spore-mine victims — also tear down the matching hex
 *      effect so `targetPolicy` never sees a stale summon entry.
 *   5. Advance the script pointer.
 *
 * What this function DOES NOT do (reserved for later phases):
 *   - multi-target abilities (Wailing Doom: Sweeps hits 3 targets in
 *     game, but for Phase 5 we keep it to one target per turn — the
 *     script's damageFactor is tuned accordingly),
 *   - boss movement on the hex grid,
 *   - tail-on hex effects (Fire DoT persistence etc.).
 *
 * The function RETURNS an `EnemyTurnResult` describing what happened so
 * the UI / scenario tests can assert on exact outcomes. It DOES mutate
 * the `MapBattleState` in place (HP, units map, script pointer, battle
 * state). The battle state lives across turns by design.
 */

export interface EnemyTurnAction {
  kind: 'attack' | 'skip';
  stepKind: BossScriptTurn['kind'];
  attackerId: string;
  targetId?: string;
  abilityId?: string;
  result?: DamageBreakdown;
  /** True when the attack reduced the target to 0 HP on this turn. */
  killedTarget?: boolean;
}

export interface EnemyTurnResult {
  scriptId?: string;
  /** Step index BEFORE the pointer advance — useful for assertions. */
  turnStepIdx?: number;
  actions: EnemyTurnAction[];
}

/**
 * Convenience used by both `runEnemyTurn` and by `predict.ts` (Phase 6).
 * Retrieves the BossScript from the catalog lazily so callers don't have
 * to thread the `MapCatalog` through themselves.
 */
export function getBossScript(scriptId: string): BossScript | undefined {
  return loadMapCatalog().bossScriptById[scriptId];
}

/**
 * Resolve the next step in a script, honoring `repeatsFrom`. Returns
 * `null` when the pointer is past the end and the script does not
 * repeat (one-shot rotation).
 */
function currentStep(
  script: BossScript,
  pointerTurnIdx: number,
): { step: BossScriptTurn; resolvedIdx: number } | null {
  const len = script.turns.length;
  if (pointerTurnIdx < len) {
    return { step: script.turns[pointerTurnIdx], resolvedIdx: pointerTurnIdx };
  }
  if (script.repeatsFrom === undefined) return null;
  const loopLen = len - script.repeatsFrom;
  if (loopLen <= 0) return null;
  const offsetIntoLoop = (pointerTurnIdx - len) % loopLen;
  const idx = script.repeatsFrom + offsetIntoLoop;
  return { step: script.turns[idx], resolvedIdx: idx };
}

function findScriptedBoss(battle: MapBattleState): Unit | undefined {
  for (const u of Object.values(battle.units)) {
    if (u.side === 'enemy' && u.kind === 'boss' && u.scriptPointer) return u;
  }
  return undefined;
}

function profileForStep(
  step: BossScriptTurn,
  boss: Unit,
  script: BossScript,
): AttackProfile | null {
  if (step.kind === 'none') return null;
  if (step.kind === 'normal') return boss.attacker.source.melee;
  const ability = script.abilities?.[step.abilityId];
  if (!ability) return null;
  return ability;
}

export function runEnemyTurn(battle: MapBattleState): EnemyTurnResult {
  const boss = findScriptedBoss(battle);
  if (!boss || !boss.scriptPointer) {
    return { actions: [] };
  }
  const script = getBossScript(boss.scriptPointer.scriptId);
  if (!script) {
    return { scriptId: boss.scriptPointer.scriptId, actions: [] };
  }

  const stepResolved = currentStep(script, boss.scriptPointer.turnIdx);
  if (!stepResolved) {
    return {
      scriptId: script.id,
      turnStepIdx: boss.scriptPointer.turnIdx,
      actions: [{ kind: 'skip', stepKind: 'none', attackerId: boss.id }],
    };
  }
  const { step, resolvedIdx } = stepResolved;
  const profile = profileForStep(step, boss, script);

  const actions: EnemyTurnAction[] = [];

  if (!profile) {
    actions.push({
      kind: 'skip',
      stepKind: step.kind,
      attackerId: boss.id,
      abilityId: step.kind === 'ability' ? step.abilityId : undefined,
    });
    boss.scriptPointer.turnIdx += 1;
    return { scriptId: script.id, turnStepIdx: resolvedIdx, actions };
  }

  // Target selection — the boss's enemies are the PLAYER side. Spore
  // mines are `side: 'player'` + `kind: 'summon'` and fold in naturally.
  const candidates = Object.values(battle.units).filter(
    (u) => u.side === 'player' && u.currentHp > 0,
  );
  const policy = getTargetPolicy(script.targetPolicy);
  const target = policy.pick(candidates, { attacker: boss, battle });

  if (!target) {
    actions.push({
      kind: 'skip',
      stepKind: step.kind,
      attackerId: boss.id,
      abilityId: step.kind === 'ability' ? step.abilityId : undefined,
    });
    boss.scriptPointer.turnIdx += 1;
    return { scriptId: script.id, turnStepIdx: resolvedIdx, actions };
  }

  // Resolve damage via the shared incoming-attack pipeline so terrain/
  // hex-effect buffs + the engine's resolveAttack math apply identically
  // to player and enemy attacks.
  const ctx: AttackContext = { profile, rngMode: 'expected' };
  const result = resolveIncomingAttack(boss, target, ctx, battle);

  // `postShieldExpected + postHpExpected` = total expected damage taken.
  // For a deterministic scenario we drain the expected (mean) value —
  // this mirrors how the TeamPage UI reports damage in the default rng
  // mode and keeps tests stable without the distribution wobble.
  const totalExpected = result.postShieldExpected + result.postHpExpected;
  const { killed } = applyDamageToUnit(target, totalExpected);

  if (killed) {
    // If we killed a spore mine, also remove the lingering hex effect.
    if (target.kind === 'summon') detonateSporeMine(battle, target.id);
    killUnit(battle, target.id);
  }

  actions.push({
    kind: 'attack',
    stepKind: step.kind,
    attackerId: boss.id,
    targetId: target.id,
    abilityId:
      step.kind === 'ability' ? step.abilityId : profile.abilityId ?? undefined,
    result,
    killedTarget: killed,
  });

  // Advance the script pointer AFTER the attack resolves so the
  // EnemyTurnResult.turnStepIdx reflects the step we just fired.
  boss.scriptPointer.turnIdx += 1;

  return { scriptId: script.id, turnStepIdx: resolvedIdx, actions };
}
