import type { Modifier } from '../modifiers';

export const emplacement: Modifier = {
  id: 'emplacement',
  phase: 'postArmor',
  apply(frame) {
    if (frame.profile.kind !== 'melee') return frame;
    return {
      ...frame,
      postArmorMultiplier: frame.postArmorMultiplier * 0.5,
    };
  },
};
