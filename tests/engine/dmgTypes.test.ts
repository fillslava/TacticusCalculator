import { describe, it, expect } from 'vitest';
import { PIERCE_RATIOS, pierceOf, ALL_DAMAGE_TYPES } from '../../src/engine/dmgTypes';

describe('PIERCE_RATIOS', () => {
  it('covers 21 damage types (legacy gauss collapsed into molecular)', () => {
    expect(ALL_DAMAGE_TYPES).toHaveLength(21);
  });

  it('molecular uses 60% pierce (gauss → molecular merger)', () => {
    expect(PIERCE_RATIOS.molecular).toBe(0.6);
  });

  it('has psychic and direct at 1.0', () => {
    expect(PIERCE_RATIOS.psychic).toBe(1.0);
    expect(PIERCE_RATIOS.direct).toBe(1.0);
  });

  it('has physical near zero (0.01)', () => {
    expect(PIERCE_RATIOS.physical).toBe(0.01);
  });

  it('pierceOf respects override', () => {
    expect(pierceOf('las')).toBe(0.1);
    expect(pierceOf('las', 0.5)).toBe(0.5);
  });
});
