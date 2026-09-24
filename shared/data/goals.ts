import { MACHINES } from './machines';
import type { ItemId, MachineFamily, Player, World } from '../sim/types';

/**
 * The first hours as a chain of small goals, one shown at a time. Each row
 * names a state of the island rather than an action, so a goal the player
 * already reached by their own route is simply ticked off, and a check never
 * needs history the save does not keep.
 */
export interface GoalDef {
  id: string;
  title: string;
  /** How to do it, in one line, for someone who has never played. */
  hint: string;
  /** The same for a touchscreen, where the hint names a key. */
  touchHint?: string;
  /** Progress towards `need`, so the tracker can show a count. */
  have: (world: World, player: Player) => number;
  need: number;
  /** XP on completion: small, but enough that a goal feels like a step. */
  xp: number;
  /** A goal that cannot happen on this island is passed over. */
  skip?: (world: World) => boolean;
}

/** Everything of one item the island holds: bag, machines and belts. */
export function itemsAnywhere(world: World, player: Player, id: ItemId): number {
  let total = 0;
  for (const slot of player.inventory) if (slot?.id === id) total += slot.count;
  if (player.cursor?.id === id) total += player.cursor.count;
  for (const machine of world.machines) {
    for (const slot of machine.input) if (slot?.id === id) total += slot.count;
    for (const slot of machine.output) if (slot?.id === id) total += slot.count;
  }
  for (const belt of world.belts) for (const it of belt.items) if (it.item === id) total += 1;
  return total;
}

function inBag(player: Player, id: ItemId): number {
  let total = 0;
  for (const slot of player.inventory) if (slot?.id === id) total += slot.count;
  return total;
}

function machinesOf(world: World, family: MachineFamily): number {
  let total = 0;
  for (const machine of world.machines) if (MACHINES[machine.type].family === family) total += 1;
  return total;
}

function platesInStorage(world: World): number {
  let total = 0;
  for (const machine of world.machines) {
    if (!MACHINES[machine.type].storage) continue;
    for (const slot of machine.input) {
      if (slot && (slot.id === 'ironPlate' || slot.id === 'copperPlate' || slot.id === 'steelPlate')) {
        total += slot.count;
      }
    }
  }
  return total;
}

export const GOALS: GoalDef[] = [
  {
    id: 'wood',
    title: 'Gather wood',
    hint: 'Stand by a tree and hold E, or hold the mouse button.',
    touchHint: 'Stand by a tree and hold a finger on the right side of the screen.',
    have: (_w, p) => inBag(p, 'wood'),
    need: 15,
    xp: 4,
  },
  {
    id: 'stone',
    title: 'Gather stone',
    hint: 'Rocks give stone. Hold E beside one.',
    touchHint: 'Rocks give stone. Hold the right side of the screen beside one.',
    have: (_w, p) => inBag(p, 'stone'),
    need: 15,
    xp: 4,
  },
  {
    id: 'miner',
    title: 'Place a Miner on ore',
    hint: 'Press B to build. Miners only work on the coloured ore patches.',
    touchHint: 'Tap Build. Miners only work on the coloured ore patches.',
    have: (w) => machinesOf(w, 'miner'),
    need: 1,
    xp: 8,
  },
  {
    id: 'belt',
    title: 'Lay a belt line',
    hint: 'Belts carry what the miner digs. Hold the button and drag to lay a line.',
    touchHint: 'Belts carry what the miner digs. Drag a finger to lay a line.',
    have: (w) => w.belts.length,
    need: 4,
    xp: 8,
  },
  {
    id: 'furnace',
    title: 'Build a Furnace',
    hint: 'Run the belt into it and it smelts ore into plates.',
    have: (w) => machinesOf(w, 'furnace'),
    need: 1,
    xp: 8,
  },
  {
    id: 'ironPlate',
    title: 'Smelt iron plates',
    hint: 'Iron ore in, iron plate out. Click a furnace to see inside.',
    have: (w, p) => itemsAnywhere(w, p, 'ironPlate'),
    need: 10,
    xp: 12,
  },
  {
    id: 'store',
    title: 'Store plates in a chest',
    hint: 'An inserter lifts plates out of the furnace into a Storage Chest.',
    have: (w) => platesInStorage(w),
    need: 10,
    xp: 12,
  },
  {
    id: 'copperPlate',
    title: 'Smelt copper plates',
    hint: 'Copper ore is the orange patch. It needs its own miner and furnace.',
    have: (w, p) => itemsAnywhere(w, p, 'copperPlate'),
    need: 10,
    xp: 14,
  },
  {
    id: 'gear',
    title: 'Make gears',
    hint: 'An Assembler set to Gear turns two iron plates into one.',
    have: (w, p) => itemsAnywhere(w, p, 'gear'),
    need: 5,
    xp: 16,
  },
  {
    id: 'researchPack',
    title: 'Make research packs',
    hint: 'An Assembler set to Research Pack takes a gear and a copper plate.',
    have: (w, p) => itemsAnywhere(w, p, 'researchPack'),
    need: 5,
    xp: 20,
  },
  {
    id: 'lab',
    title: 'Build a Lab',
    // Goal progress is saved as an index into this table, so the workbench is
    // folded into this hint rather than given a row of its own.
    hint: 'Build a Workbench (Camp tab), press C beside it to craft a Lab, then place it.',
    touchHint: 'Build a Workbench (Camp tab), tap Craft beside it to make a Lab, then place it.',
    have: (w) => machinesOf(w, 'lab'),
    need: 1,
    xp: 20,
  },
  {
    id: 'research',
    title: 'Finish your first research',
    hint: 'Keep the lab fed. Every cycle it completes also levels you up.',
    have: (w) => Object.values(w.research.levels).reduce((sum, n) => sum + n, 0),
    need: 1,
    xp: 30,
  },
  {
    id: 'circuit',
    title: 'Make circuits',
    hint: 'Wire from copper plus a gear. Circuits open the second research pack.',
    have: (w, p) => itemsAnywhere(w, p, 'circuit'),
    need: 5,
    xp: 30,
  },
  {
    id: 'tier2',
    title: 'Build a Mk2 machine',
    hint: 'Research unlocks faster tiers. Craft one at the workbench and place it over its Mk1.',
    have: (w) => w.machines.filter((m) => MACHINES[m.type].tier >= 2).length,
    need: 1,
    xp: 40,
  },
];

export const GOAL_BY_ID = new Map(GOALS.map((g) => [g.id, g]));
