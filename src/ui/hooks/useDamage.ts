import { useMemo } from 'react';
import { useApp } from '../../state/store';
import { getCharacter, getBoss, getEquipment } from '../../data/catalog';
import { resolveRotation } from '../../engine/rotation';
import { applyPrimeDebuffs } from '../../engine/bossDebuffs';
import {
  progressionToRarity,
  progressionToStarLevel,
} from '../../engine/progression';
import type {
  Attacker,
  AttackContext,
  CatalogBoss,
  CatalogCharacter,
  CatalogEquipmentSlot,
  ItemStatMods,
  Target,
} from '../../engine/types';

/**
 * Expands an `attackKey` (melee / ranged / ability:id) into the list of
 * atomic {@link AttackContext}s to resolve in a single turn slot. Most
 * abilities return a singleton; multi-component abilities like Kharn's
 * "Kill! Maim! Burn!" return one context per component (Piercing +
 * Eviscerating + Plasma), which the rotation engine sums.
 */
function attackContextsFor(
  key: string,
  char: CatalogCharacter,
): AttackContext[] {
  if (key === 'melee' && char.melee)
    return [{ profile: char.melee, rngMode: 'expected' }];
  if (key === 'ranged' && char.ranged)
    return [{ profile: char.ranged, rngMode: 'expected' }];
  if (key.startsWith('ability:')) {
    const id = key.slice('ability:'.length);
    const ability = char.abilities.find((a) => a.id === id);
    if (!ability) return [];
    // Stamp `abilityProfileIdx` on multi-profile abilities so the engine's
    // applyBonusHits can enforce the wiki STMA rule (extra hits only on
    // the first profile to hit the target). Single-profile abilities are
    // left untagged (undefined ≡ 0 ≡ "first profile").
    const isMulti = ability.profiles.length > 1;
    return ability.profiles.map<AttackContext>((profile, idx) => ({
      profile: isMulti ? { ...profile, abilityProfileIdx: idx } : profile,
      rngMode: 'expected',
    }));
  }
  return [];
}

function customBoss(
  armor: number,
  hp: number,
  shield: number,
  traits: string[],
): CatalogBoss {
  return {
    id: 'custom',
    displayName: 'Custom',
    stages: [{ name: 'custom', armor, hp, shield, traits }],
  };
}

function extraStatsSlot(mods: ItemStatMods | undefined): CatalogEquipmentSlot | null {
  if (!mods) return null;
  const hasAny = Object.values(mods).some(
    (v) => typeof v === 'number' && v !== 0,
  );
  if (!hasAny) return null;
  return {
    slotId: 1,
    id: '__extra_stats__',
    rarity: 'legendary',
    level: 1,
    mods,
  };
}

export function useDamage() {
  const { build, target, rotation } = useApp();

  return useMemo(() => {
    const char = build.characterId ? getCharacter(build.characterId) : undefined;
    if (!char) return null;

    const equipment: CatalogEquipmentSlot[] = build.equipmentIds
      .map((id) => (id ? getEquipment(id) : undefined))
      .filter((e): e is CatalogEquipmentSlot => Boolean(e));
    const extra = extraStatsSlot(build.extraStats);
    if (extra) equipment.push(extra);

    const attacker: Attacker = {
      source: char,
      progression: {
        stars: progressionToStarLevel(build.progression),
        rank: build.rank,
        xpLevel: build.xpLevel,
        rarity: progressionToRarity(build.progression),
      },
      equipment,
    };

    const boss = target.bossId
      ? getBoss(target.bossId)
      : customBoss(
          target.customArmor ?? 0,
          target.customHp ?? 100_000,
          target.customShield ?? 0,
          target.customTraits ?? [],
        );
    if (!boss) return null;
    const stageIdx = Math.min(
      target.stageIndex,
      Math.max(0, boss.stages.length - 1),
    );
    const stage = boss.stages[stageIdx];
    const primeLevels = [target.prime1Level ?? 0, target.prime2Level ?? 0];
    const hasAnyPrime = primeLevels.some((l) => l > 0);
    const debuffed = hasAnyPrime
      ? applyPrimeDebuffs(
          { armor: stage.armor, hp: stage.hp },
          boss.primes,
          primeLevels,
        )
      : null;
    const targetResolved: Target = {
      source: boss,
      stageIndex: target.stageIndex,
      ...(debuffed
        ? { statOverrides: { armor: debuffed.armor, hp: debuffed.hp } }
        : {}),
    };

    const turns = rotation
      .map((t) => {
        const ctxs = attackContextsFor(t.attackKey, char);
        return ctxs.length > 0 ? { attacks: ctxs, buffs: t.buffs } : null;
      })
      .filter((t): t is { attacks: AttackContext[]; buffs: import('../../engine/types').TurnBuff[] } => Boolean(t));

    if (turns.length === 0) return null;

    const result = resolveRotation(attacker, targetResolved, { turns });
    return { result, attacker, target: targetResolved };
  }, [build, target, rotation]);
}
