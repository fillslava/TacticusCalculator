export const VARIANCE_LOW = 0.8;
export const VARIANCE_HIGH = 1.2;
export const VARIANCE_MID = 1.0;

export function varianceBand(damage: number): { low: number; mid: number; high: number } {
  return {
    low: damage * VARIANCE_LOW,
    mid: damage * VARIANCE_MID,
    high: damage * VARIANCE_HIGH,
  };
}

export function varianceBuckets(damage: number, buckets = 3): number[] {
  if (buckets < 1) throw new Error('buckets must be >= 1');
  if (buckets === 1) return [damage * VARIANCE_MID];
  const step = (VARIANCE_HIGH - VARIANCE_LOW) / (buckets - 1);
  return Array.from({ length: buckets }, (_, i) => damage * (VARIANCE_LOW + step * i));
}
