import type { ItemId, ItemStack, MachineId } from '../sim/types';
import { CRAFTED_MACHINES, MACHINES } from './machines';

/**
 * What the workbench makes. Tools are rows here; crafted machines come from
 * the machine table, whose `cost` is their recipe, so a new tier needs no row
 * of its own — only `crafted: true` on the machine.
 */
export interface CraftDef {
  id: string;
  output: ItemId;
  count: number;
  cost: ItemStack[];
  group: 'tools' | 'bags' | 'machines';
  /** The machine whose research gate this recipe shares, if any. */
  unlock?: MachineId;
}

const TOOLS: CraftDef[] = [
  tool('stoneAxe', [
    { id: 'wood', count: 8 },
    { id: 'stone', count: 6 },
    { id: 'fiber', count: 4 },
  ]),
  tool('stonePick', [
    { id: 'wood', count: 8 },
    { id: 'stone', count: 8 },
    { id: 'fiber', count: 4 },
  ]),
  tool('forageBasket', [
    { id: 'wood', count: 4 },
    { id: 'fiber', count: 12 },
  ]),
  tool('fishingRod', [
    { id: 'wood', count: 6 },
    { id: 'fiber', count: 10 },
  ]),
  tool('ironAxe', [
    { id: 'wood', count: 6 },
    { id: 'ironPlate', count: 8 },
  ]),
  tool('ironPick', [
    { id: 'wood', count: 6 },
    { id: 'ironPlate', count: 10 },
  ]),
  tool('steelAxe', [
    { id: 'steelPlate', count: 6 },
    { id: 'gear', count: 2 },
  ]),
  tool('steelPick', [
    { id: 'steelPlate', count: 8 },
    { id: 'gear', count: 2 },
  ]),
];

/**
 * Each is sewn on in turn and adds a row of the bag. Priced at the tier that
 * starts to overflow 24 slots: fibre early, then iron once plates pile up,
 * then steel once the tree is deep enough to carry a dozen kinds of part.
 */
const BAGS: CraftDef[] = [
  bag('satchel', [
    { id: 'fiber', count: 30 },
    { id: 'wood', count: 12 },
  ]),
  bag('ironPack', [
    { id: 'ironPlate', count: 16 },
    { id: 'fiber', count: 20 },
  ]),
  bag('steelPack', [
    { id: 'steelPlate', count: 12 },
    { id: 'gear', count: 4 },
  ]),
];

function bag(output: ItemId, cost: ItemStack[]): CraftDef {
  return { id: output, output, count: 1, cost, group: 'bags' };
}

function tool(output: ItemId, cost: ItemStack[]): CraftDef {
  return { id: output, output, count: 1, cost, group: 'tools' };
}

export const CRAFTS: CraftDef[] = [
  ...TOOLS,
  ...BAGS,
  ...CRAFTED_MACHINES.map(
    (id): CraftDef => ({
      id,
      output: id,
      count: 1,
      cost: MACHINES[id].cost,
      group: 'machines',
      unlock: id,
    }),
  ),
];

export const CRAFT_BY_ID = new Map(CRAFTS.map((c) => [c.id, c]));
