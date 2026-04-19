import { registerTrait } from '../modifiers';
import { gravisArmor, terminatorArmour } from './gravis';
import { daemon } from './daemon';
import { heavyWeapon } from './heavyWeapon';
import { parry } from './parry';
import { emplacement } from './emplacement';

let registered = false;

export function registerBuiltinTraits(): void {
  if (registered) return;
  registered = true;
  registerTrait(gravisArmor);
  registerTrait(terminatorArmour);
  registerTrait(daemon);
  registerTrait(heavyWeapon);
  registerTrait(parry);
  registerTrait(emplacement);
}

registerBuiltinTraits();

export { gravisArmor, terminatorArmour, daemon, heavyWeapon, parry, emplacement };
