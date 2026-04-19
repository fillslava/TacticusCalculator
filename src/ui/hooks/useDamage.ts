import { useMemo } from 'react';
import { useApp } from '../../state/store';
import { getCharacter, getBoss, getEquipment } from '../../data/catalog';
import { resolveRotation } from '../../engine/rotation';
import {
  progressionToRarity,
  progressionToStarLevel,
} from '../../engine/progression';
import type {
  Attacker,
  AttackContext,
  AttackProfile,
  CatalogBoss,
  CatalogCharacter,
  CatalogEquipmentSlot,
  ItemStatMods,
  Target,
} from '../../engine/types';

function attackContextFor(
  key: string,
  char: CatalogCharacter,
): AttackContext | null {
  let profile: AttackProfile | undefined;
  if (key === 'melee') profile = char.melee;
  else if (key === 'ranged') profile = char.ranged;
  else if (key.startsWith('ability:')) {
    const id = key.slice('ability:'.length);
    profile = char.abilities.find((a) => a.id === id)?.profile;
  }
  if (!profile) return null;
  return { profile, rngMode: 'expected' };
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
    const targetResolved: Target = {
      source: boss,
      stageIndex: target.stageIndex,
    };

    const turns = rotation
      .map((t) => {
        const ctx = attackContextFor(t.attackKey, char);
        return ctx ? { attacks: [ctx], buffs: t.buffs } : null;
      })
      .filter((t): t is { attacks: AttackContext[]; buffs: import('../../engine/types').TurnBuff[] } => Boolean(t));

    if (turns.length === 0) return null;

    const result = resolveRotation(attacker, targetResolved, { turns });
    return { result, attacker, target: targetResolved };
  }, [build, target, rotation]);
}
