import type { Modifier } from '../modifiers';

export const parry: Modifier = {
  id: 'parry',
  phase: 'statScaling',
  priority: 100,
  apply(frame) {
    if (frame.profile.kind !== 'melee') return frame;
    const reducedHits = Math.max(1, frame.profile.hits - 1);
    return {
      ...frame,
      profile: { ...frame.profile, hits: reducedHits },
      trace: [
        ...frame.trace,
        {
          phase: 'statScaling',
          description: 'parry: melee hits reduced by 1 (floor 1)',
          before: frame.profile.hits,
          after: reducedHits,
        },
      ],
    };
  },
};
