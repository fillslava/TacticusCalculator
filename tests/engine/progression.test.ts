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
  it('has 20 levels (0-19) spanning 6 rarities (halmmar API scheme)', () => {
    expect(MAX_PROGRESSION).toBe(19);
    expect(STEPS_PER_RARITY.common).toBe(3);
    expect(STEPS_PER_RARITY.uncommon).toBe(3);
    expect(STEPS_PER_RARITY.rare).toBe(3);
    expect(STEPS_PER_RARITY.epic).toBe(3);
    expect(STEPS_PER_RARITY.legendary).toBe(4);
    expect(STEPS_PER_RARITY.mythic).toBe(4);
  });

  it('clamps negative, oversize, NaN', () => {
    expect(clampProgression(-5)).toBe(0);
    expect(clampProgression(999)).toBe(19);
    expect(clampProgression(NaN)).toBe(0);
  });

  it('maps progression to correct rarity', () => {
    expect(progressionToRarity(0)).toBe('common');
    expect(progressionToRarity(2)).toBe('common');
    expect(progressionToRarity(3)).toBe('uncommon');
    expect(progressionToRarity(5)).toBe('uncommon');
    expect(progressionToRarity(6)).toBe('rare');
    expect(progressionToRarity(8)).toBe('rare');
    expect(progressionToRarity(9)).toBe('epic');
    expect(progressionToRarity(11)).toBe('epic');
    expect(progressionToRarity(12)).toBe('legendary');
    expect(progressionToRarity(15)).toBe('legendary');
    expect(progressionToRarity(16)).toBe('mythic');
    expect(progressionToRarity(19)).toBe('mythic');
  });

  it('starLevel = progression - rarityIndex', () => {
    expect(progressionToStarLevel(0)).toBe(0);
    expect(progressionToStarLevel(15)).toBe(11);
    expect(progressionToStarLevel(19)).toBe(14);
  });

  it('visible star counts match wiki', () => {
    expect(progressionToVisibleStars(15)).toBe(12);
    expect(progressionToVisibleStars(19)).toBe(15);
    expect(progressionToVisibleStars(0)).toBe(1);
  });

  it('rarity ranges are contiguous with no gaps', () => {
    expect(rarityToMinProgression('common')).toBe(0);
    expect(rarityToMaxProgression('common')).toBe(2);
    expect(rarityToMinProgression('uncommon')).toBe(3);
    expect(rarityToMaxProgression('uncommon')).toBe(5);
    expect(rarityToMinProgression('legendary')).toBe(12);
    expect(rarityToMaxProgression('legendary')).toBe(15);
    expect(rarityToMinProgression('mythic')).toBe(16);
    expect(rarityToMaxProgression('mythic')).toBe(19);
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
    expect(progressionLabel(19)).toContain('mythic');
    expect(progressionLabel(19)).toContain('☠');
  });
});
