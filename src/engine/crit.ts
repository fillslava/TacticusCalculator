export function clamp01(p: number): number {
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

export function combineTwoCritChances(a: number, b: number): number {
  const pa = clamp01(a);
  const pb = clamp01(b);
  return 1 - (1 - pa) * (1 - pb);
}

export function critProbabilityAtHit(chance: number, hitIndex: number): number {
  return Math.pow(clamp01(chance), hitIndex);
}

export function atLeastOneCritProbability(chance: number, hits: number): number {
  if (hits <= 0) return 0;
  return clamp01(chance);
}

export function expectedCritsChained(chance: number, hits: number): number {
  const p = clamp01(chance);
  if (p === 0) return 0;
  if (p === 1) return hits;
  let sum = 0;
  for (let n = 1; n <= hits; n++) sum += Math.pow(p, n);
  return sum;
}
