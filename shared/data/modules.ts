import type { ItemId } from '../sim/types';

/**
 * What one module does to the machine it sits in, each as a share added to
 * that machine's multiplier: 0.5 speed is +50%. Every module costs something
 * as well as giving something, so filling a machine is a choice about which
 * of speed, ore and power the island is short of rather than a straight win.
 */
export interface ModuleDef {
  /** Work rate, crafting and mining alike. */
  speed: number;
  /** Free crafts, as a share of every craft finished. */
  output: number;
  /** Power drawn while working. */
  power: number;
}

export const MODULES: Partial<Record<ItemId, ModuleDef>> = {
  speedModule: { speed: 0.5, output: 0, power: 0.7 },
  // Slower and hungrier, but a miner fitted with two gets a fifth more ore out
  // of a finite patch: the one module that makes the island itself last.
  outputModule: { speed: -0.15, output: 0.1, power: 0.4 },
  efficiencyModule: { speed: 0, output: 0, power: -0.4 },
};

/**
 * The least a machine's speed or power may be pushed down to. Without it two
 * efficiency modules would make a machine free, and stacking penalties could
 * stop one outright.
 */
export const MODULE_FLOOR = 0.2;

export function isModule(id: ItemId): boolean {
  return MODULES[id] !== undefined;
}
