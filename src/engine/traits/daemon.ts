import type { Modifier } from '../modifiers';

export const daemon: Modifier = {
  id: 'daemon',
  phase: 'onBlock',
  apply(frame) {
    const blockChanceAdd = 0.25;
    const blockDamageCap = frame.attacker.damage * 0.5;
    return {
      ...frame,
      attacker: {
        ...frame.attacker,
      },
      target: {
        ...frame.target,
      },
      trace: [
        ...frame.trace,
        {
          phase: 'onBlock',
          description: 'daemon: +25% chance to block up to 50% of attacker damage',
          detail: { blockChanceAdd, blockDamageCap },
        },
      ],
    };
  },
};
