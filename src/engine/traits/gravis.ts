import type { Modifier } from '../modifiers';

export const gravisArmor: Modifier = {
  id: 'gravisArmor',
  phase: 'armorPasses',
  apply(frame) {
    return {
      ...frame,
      armorPasses: Math.max(frame.armorPasses, 2),
      armorPassesOnCrit: Math.max(frame.armorPassesOnCrit, 1),
    };
  },
};

export const terminatorArmour: Modifier = {
  id: 'terminator armour',
  phase: 'postArmor',
  apply(frame) {
    return {
      ...frame,
      postArmorMultiplier: frame.postArmorMultiplier * 0.8,
    };
  },
};
