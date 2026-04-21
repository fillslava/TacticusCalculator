import type { Modifier } from '../modifiers';

/**
 * Daemon trait: +25% block chance, blocks reduce damage by 50% of the
 * attacker's (resolved) damage stat. Per HDTW the block formula is a flat
 * subtract, so setting blockDamage to `attacker.damage × 0.5` makes a
 * successful block leave half the attacker's damage intact.
 *
 * The trait stacks ADDITIVELY on top of the target's own blockChance and
 * takes the MAX of existing and trait-added blockDamage — multiple block
 * sources aren't modelled yet; we approximate them by keeping the strongest
 * block amount and letting the chance add up to the clamp-at-1 ceiling.
 */
export const daemon: Modifier = {
  id: 'daemon',
  phase: 'onBlock',
  apply(frame) {
    const blockChanceAdd = 0.25;
    const daemonBlockDamage = frame.attacker.damage * 0.5;
    const newChance = Math.min(1, frame.target.blockChance + blockChanceAdd);
    const newDamage = Math.max(frame.target.blockDamage, daemonBlockDamage);
    return {
      ...frame,
      target: {
        ...frame.target,
        blockChance: newChance,
        blockDamage: newDamage,
      },
      trace: [
        ...frame.trace,
        {
          phase: 'onBlock',
          description: 'daemon: +25% block chance, block subtracts 50% of attacker damage',
          detail: { blockChanceAdd, daemonBlockDamage, resultingChance: newChance },
        },
      ],
    };
  },
};
