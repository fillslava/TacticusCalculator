export type DamageType =
  | 'bio'
  | 'blast'
  | 'bolter'
  | 'chain'
  | 'direct'
  | 'energy'
  | 'eviscerating'
  | 'flame'
  | 'gauss'
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

export const PIERCE_RATIOS: Record<DamageType, number> = {
  bio: 0.3,
  blast: 0.15,
  bolter: 0.2,
  chain: 0.2,
  direct: 1.0,
  energy: 0.3,
  eviscerating: 0.5,
  flame: 0.25,
  gauss: 0.3,
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
