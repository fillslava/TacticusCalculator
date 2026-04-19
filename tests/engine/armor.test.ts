import { describe, it, expect } from 'vitest';
import { damageAfterArmor } from '../../src/engine/armor';

describe('damageAfterArmor', () => {
  it('takes max of (dmg - armor) vs (dmg * pierce)', () => {
    expect(damageAfterArmor(100, 40, 0.2, 1)).toBe(60);
    expect(damageAfterArmor(100, 90, 0.2, 1)).toBe(20);
  });

  it('floors at 1 damage', () => {
    expect(damageAfterArmor(10, 1000, 0.01, 1)).toBe(1);
  });

  it('applies armor twice for Gravis (passes=2)', () => {
    const once = damageAfterArmor(200, 100, 0.4, 1);
    expect(once).toBe(100);
    const twice = damageAfterArmor(200, 100, 0.4, 2);
    expect(twice).toBe(40);
  });

  it('ignores armor when pierce is 1.0 (Direct/Psychic)', () => {
    expect(damageAfterArmor(100, 9999, 1.0, 1)).toBe(100);
  });

  it('applies pierce ratio exactly when armor dominates', () => {
    expect(damageAfterArmor(100, 9999, 0.1, 1)).toBe(10);
  });

  it('returns dmg when zero passes', () => {
    expect(damageAfterArmor(100, 50, 0.5, 0)).toBe(100);
  });
});
