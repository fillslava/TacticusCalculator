import type { Rarity } from './types';
import { RARITY_ORDER } from './types';

export const STEPS_PER_RARITY: Record<Rarity, number> = {
  common: 3,
  uncommon: 3,
  rare: 3,
  epic: 3,
  legendary: 4,
  mythic: 4,
};

const CUMULATIVE_START: number[] = [];
{
  let sum = 0;
  for (const r of RARITY_ORDER) {
    CUMULATIVE_START.push(sum);
    sum += STEPS_PER_RARITY[r];
  }
}

export const MAX_PROGRESSION = RARITY_ORDER.reduce(
  (acc, r) => acc + STEPS_PER_RARITY[r],
  0,
) - 1;

export function clampProgression(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(MAX_PROGRESSION, Math.round(p)));
}

export function progressionToRarityIndex(p: number): number {
  const c = clampProgression(p);
  for (let i = CUMULATIVE_START.length - 1; i >= 0; i--) {
    if (c >= CUMULATIVE_START[i]) return i;
  }
  return 0;
}

export function progressionToRarity(p: number): Rarity {
  return RARITY_ORDER[progressionToRarityIndex(p)];
}

export function progressionToStarLevel(p: number): number {
  const c = clampProgression(p);
  const r = progressionToRarityIndex(c);
  return c - r;
}

export function progressionPositionInRarity(p: number): number {
  const c = clampProgression(p);
  const r = progressionToRarityIndex(c);
  return c - CUMULATIVE_START[r];
}

/**
 * Given an Attacker's `progression.stars` (which is a cumulative star level
 * across all rarities, e.g. 14 for Mythic 4★) and its `progression.rarity`,
 * return the 0-indexed position WITHIN that rarity (e.g. 3 for Mythic 4★).
 *
 * The engine stores `stars` as a starLevel, not a progression ordinal, so
 * callers that need "which star tier within the current rarity" (team buffs
 * like Biovore Mythic Acid's pctByStar) must use this, not
 * `progressionPositionInRarity(stars)` directly.
 *
 * Robust to starLevel/rarity mismatches (e.g. starLevel=0 with rarity=mythic):
 * the result is clamped to [0, stepsInRarity-1].
 */
export function progressionPositionFromStarLevel(
  stars: number,
  rarity: Rarity,
): number {
  const rarityIdx = RARITY_ORDER.indexOf(rarity);
  if (rarityIdx < 0) return 0;
  // starLevel at the bottom of this rarity (e.g. Mythic 1★ is starLevel 11).
  const minStarLevel = progressionToStarLevel(CUMULATIVE_START[rarityIdx]);
  const maxPos = STEPS_PER_RARITY[rarity] - 1;
  const pos = Math.max(0, stars) - minStarLevel;
  return Math.max(0, Math.min(maxPos, pos));
}

export function rarityToMinProgression(r: Rarity): number {
  const idx = RARITY_ORDER.indexOf(r);
  return idx < 0 ? 0 : CUMULATIVE_START[idx];
}

export function rarityToMaxProgression(r: Rarity): number {
  return rarityToMinProgression(r) + STEPS_PER_RARITY[r] - 1;
}

const VISIBLE_STARS: number[] = [];
{
  for (let p = 0; p <= MAX_PROGRESSION; p++) {
    VISIBLE_STARS.push(progressionToStarLevel(p) + 1);
  }
}

export function progressionToVisibleStars(p: number): number {
  return VISIBLE_STARS[clampProgression(p)];
}

const RARITY_GLYPH: Record<Rarity, string> = {
  common: '·',
  uncommon: '★',
  rare: '★',
  epic: '◆',
  legendary: '◆',
  mythic: '♛',
};

export function progressionLabel(p: number): string {
  const c = clampProgression(p);
  const rarity = progressionToRarity(c);
  const pos = progressionPositionInRarity(c) + 1;
  const stepsInRarity = STEPS_PER_RARITY[rarity];
  const vis = progressionToVisibleStars(c);
  const isSkull = c === MAX_PROGRESSION;
  const glyph = isSkull ? '☠' : RARITY_GLYPH[rarity];
  return `${rarity} ${pos}/${stepsInRarity} ${glyph} · ${vis}★`;
}
