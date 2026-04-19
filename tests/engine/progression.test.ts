import { describe, expect, it } from 'vitest';
import {
  MAX_PROGRESSION,
  STEPS_PER_RARITY,
  clampProgression,
  progressionLabel,
  progressionToRarity,
  progressionToRarityIndex,
  progressionToStarLevel,
  progressionToVisibleStars,
  rarityToMaxProgression,
  rarityToMinProgression,
} from '../../src/engine/progression';

describe('progression', () => {
  it('has 19 levels (0-18) spanning 6 rarities', () => {
    expect(MAX_PROGRESSION).toBe(18);
    expect(STEPS_PER_RARITY.common).toBe(2);
    expect(STEPS_PER_RARITY.uncommon).toBe(3);
    expect(STEPS_PER_RARITY.rare).toBe(3);
    expect(STEPS_PER_RARITY.epic).toBe(3);
    expect(STEPS_PER_RARITY.legendary).toBe(4);
    expect(STEPS_PER_RARITY.mythic).toBe(4);
  });

  it('clamps negative, oversize, NaN', () => {
    expect(clampProgression(-5)).toBe(0);
    expect(clampProgression(999)).toBe(18);
    expect(clampProgression(NaN)).toBe(0);
  });

  it('maps progression to correct rarity', () => {
    expect(progressionToRarity(0)).toBe('common');
    expect(progressionToRarity(1)).toBe('common');
    expect(progressionToRarity(2)).toBe('uncommon');
    expect(progressionToRarity(4)).toBe('uncommon');
    expect(progressionToRarity(5)).toBe('rare');
    expect(progressionToRarity(7)).toBe('rare');
    expect(progressionToRarity(8)).toBe('epic');
    expect(progressionToRarity(10)).toBe('epic');
    expect(progressionToRarity(11)).toBe('legendary');
    expect(progressionToRarity(14)).toBe('legendary');
    expect(progressionToRarity(15)).toBe('mythic');
    expect(progressionToRarity(18)).toBe('mythic');
  });

  it('starLevel = progression - rarityIndex', () => {
    expect(progressionToStarLevel(0)).toBe(0);
    expect(progressionToStarLevel(14)).toBe(10);
    expect(progressionToStarLevel(18)).toBe(13);
  });

  it('visible star counts match wiki (11 legendary max, 14 skull)', () => {
    expect(progressionToVisibleStars(14)).toBe(11);
    expect(progressionToVisibleStars(18)).toBe(14);
    expect(progressionToVisibleStars(0)).toBe(1);
  });

  it('rarity ranges are contiguous with no gaps', () => {
    expect(rarityToMinProgression('common')).toBe(0);
    expect(rarityToMaxProgression('common')).toBe(1);
    expect(rarityToMinProgression('uncommon')).toBe(2);
    expect(rarityToMaxProgression('uncommon')).toBe(4);
    expect(rarityToMinProgression('legendary')).toBe(11);
    expect(rarityToMaxProgression('legendary')).toBe(14);
    expect(rarityToMinProgression('mythic')).toBe(15);
    expect(rarityToMaxProgression('mythic')).toBe(18);
  });

  it('rarity index is monotonic', () => {
    for (let p = 1; p <= MAX_PROGRESSION; p++) {
      expect(progressionToRarityIndex(p)).toBeGreaterThanOrEqual(
        progressionToRarityIndex(p - 1),
      );
    }
  });

  it('produces a skull label at max', () => {
    expect(progressionLabel(0)).toContain('common');
    expect(progressionLabel(18)).toContain('mythic');
    expect(progressionLabel(18)).toContain('☠');
  });
});
