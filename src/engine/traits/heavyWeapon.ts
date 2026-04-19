import type { Modifier } from '../modifiers';

export const heavyWeapon: Modifier = {
  id: 'heavy weapon',
  phase: 'postArmor',
  priority: 10,
  apply(frame) {
    if (frame.profile.kind !== 'ranged') return frame;
    return {
      ...frame,
      postArmorMultiplier: frame.postArmorMultiplier * 1.25,
    };
  },
};
