export type DamageType =
  | 'bio'
  | 'blast'
  | 'bolter'
  | 'chain'
  | 'direct'
  | 'energy'
  | 'eviscerating'
  | 'flame'
  | 'heavyRound'
  | 'las'
  | 'melta'
  | 'molecular'
  | 'particle'
  | 'physical'
  | 'piercing'
  | 'plasma'
  | 'power'
  | 'projectile'
  | 'psychic'
  | 'pulse'
  | 'toxic';

// Per tacticus.wiki.gg's Damage_Types_and_Pierce_Ratio page. Gauss and
// Enmitic were merged into Molecular in July 2023 (all at 60%). The catalog
// no longer carries 'gauss' — the four Necron profiles that used it have
// been renamed to 'molecular' and their redundant pierceOverride=0.6 dropped.
export const PIERCE_RATIOS: Record<DamageType, number> = {
  bio: 0.3,
  blast: 0.15,
  bolter: 0.2,
  chain: 0.2,
  direct: 1.0,
  energy: 0.3,
  eviscerating: 0.5,
  flame: 0.25,
  heavyRound: 0.55,
  las: 0.1,
  melta: 0.75,
  molecular: 0.6,
  particle: 0.35,
  physical: 0.01,
  piercing: 0.8,
  plasma: 0.65,
  power: 0.4,
  projectile: 0.15,
  psychic: 1.0,
  pulse: 0.2,
  toxic: 0.7,
};

export const ALL_DAMAGE_TYPES: DamageType[] = Object.keys(PIERCE_RATIOS) as DamageType[];

export function pierceOf(type: DamageType, override?: number): number {
  return override ?? PIERCE_RATIOS[type];
}
