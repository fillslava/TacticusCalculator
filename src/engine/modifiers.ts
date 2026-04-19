import type { Frame, TraitId } from './types';

export type Phase =
  | 'statScaling'
  | 'buffStats'
  | 'preArmor'
  | 'armorPasses'
  | 'postArmor'
  | 'onCrit'
  | 'onBlock'
  | 'shieldHp'
  | 'postDamage';

export const PHASE_ORDER: Phase[] = [
  'statScaling',
  'buffStats',
  'preArmor',
  'armorPasses',
  'postArmor',
  'onCrit',
  'onBlock',
  'shieldHp',
  'postDamage',
];

export interface Modifier {
  id: TraitId | string;
  phase: Phase;
  priority?: number;
  apply(frame: Frame): Frame;
}

const registry: Map<string, Modifier> = new Map();

export function registerTrait(mod: Modifier): void {
  registry.set(mod.id, mod);
}

export function getTrait(id: string): Modifier | undefined {
  return registry.get(id);
}

export function resolveTraits(ids: readonly string[]): Modifier[] {
  const out: Modifier[] = [];
  for (const id of ids) {
    const m = registry.get(id);
    if (m) out.push(m);
  }
  return out;
}

export function listRegisteredIds(): string[] {
  return Array.from(registry.keys());
}

export function sortByPhase(mods: Modifier[]): Modifier[] {
  return [...mods].sort((a, b) => {
    const pa = PHASE_ORDER.indexOf(a.phase);
    const pb = PHASE_ORDER.indexOf(b.phase);
    if (pa !== pb) return pa - pb;
    return (a.priority ?? 0) - (b.priority ?? 0);
  });
}

export function fold(frame: Frame, mods: Modifier[]): Frame {
  let f = frame;
  for (const m of sortByPhase(mods)) {
    f = m.apply(f);
    f.trace.push({
      phase: m.phase,
      description: `applied ${m.id}`,
    });
  }
  return f;
}
