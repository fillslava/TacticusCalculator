export function damageAfterArmor(
  dmg: number,
  armor: number,
  pierce: number,
  passes: number,
): number {
  let d = dmg;
  for (let i = 0; i < passes; i++) {
    d = Math.max(d - armor, d * pierce);
  }
  return Math.max(1, d);
}

export function applyPostArmorMultiplier(dmg: number, multiplier: number): number {
  return Math.max(1, dmg * multiplier);
}
