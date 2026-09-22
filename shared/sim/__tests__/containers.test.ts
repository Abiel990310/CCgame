import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import {
  clickSlot,
  gatherStacks,
  quickMove,
  sortArea,
  stowCursor,
  takeAll,
  withdraw,
} from '../containers';
import { addItem, countItem, INVENTORY_SLOTS } from '../inventory';
import { addToSlots, countIn, normalizeSlots, sortSlots, stacksIn, totalIn } from '../slots';
import { pushOntoBelt } from '../systems/factory';
import type { Belt, Machine, Player, World } from '../types';
import { advance, at, bench, contents, lay, plantOre, put } from './bench';

/**
 * Moving items by hand. These are the rules the inventory screen drives, and
 * the reason a chest stopped being a one-way bin: everything here is what a
 * player can do with a pointer, asserted without a browser.
 */

/** A chest placed on the bench, stocked with whatever the test needs. */
function chestWith(stocked: Array<[string, number]> = []): {
  world: World;
  player: Player;
  chest: Machine;
} {
  const b = bench();
  const { tx, ty } = at(4, 3);
  const chest = put(b, 'chest', tx, ty, 0) as Machine;
  // The bench stocks the bag so placement never fails; an empty one makes the
  // assertions below about exactly what moved.
  b.player.inventory.fill(null);
  for (const [id, count] of stocked) {
    addToSlots(chest.input, id as never, count, MACHINES.chest.slotSize);
  }
  return { world: b.world, player: b.player, chest };
}

describe('slot grids', () => {
  it('keeps a slot empty in place rather than sliding the grid left', () => {
    const { world, player, chest } = chestWith([
      ['ironPlate', 5],
      ['coal', 5],
    ]);

    // Empty the first slot; the coal must not shuffle into its place.
    clickSlot(world, player, chest.id, { area: 'input', index: 0 }, 'left');
    stowCursor(world, player);

    expect(chest.input[0]).toBe(null);
    expect(chest.input[1]?.id).toBe('coal');
  });

  it('fills partial stacks before opening a new slot', () => {
    const { chest } = chestWith([['coal', 10]]);
    addToSlots(chest.input, 'coal', 5, MACHINES.chest.slotSize);

    expect(stacksIn(chest.input)).toEqual([{ id: 'coal', count: 15 }]);
    expect(chest.input.filter((s) => s !== null)).toHaveLength(1);
  });

  it('splits across slots once one is at its ceiling', () => {
    const { chest } = chestWith();
    const cap = MACHINES.chest.slotSize;

    addToSlots(chest.input, 'coal', cap + 3, cap);

    expect(chest.input[0]?.count).toBe(cap);
    expect(chest.input[1]?.count).toBe(3);
  });

  it('reports what it could not store when the grid is full', () => {
    const { chest } = chestWith();
    const room = MACHINES.chest.inputSlots * MACHINES.chest.slotSize;

    const stored = addToSlots(chest.input, 'coal', room + 40, MACHINES.chest.slotSize);

    expect(stored).toBe(room);
  });
});

describe('taking items out of a chest', () => {
  it('picks a stack up and puts it in the bag', () => {
    const { world, player, chest } = chestWith([['ironPlate', 30]]);

    clickSlot(world, player, chest.id, { area: 'input', index: 0 }, 'left');
    expect(player.cursor).toEqual({ id: 'ironPlate', count: 30 });

    clickSlot(world, player, null, { area: 'bag', index: 0 }, 'left');
    expect(player.cursor).toBe(null);
    expect(countItem(player, 'ironPlate')).toBe(30);
    expect(totalIn(chest.input)).toBe(0);
  });

  it('sends a whole stack across on a shift-click, both ways', () => {
    const { world, player, chest } = chestWith([['coal', 24]]);

    quickMove(world, player, chest.id, { area: 'input', index: 0 });
    expect(countItem(player, 'coal')).toBe(24);
    expect(totalIn(chest.input)).toBe(0);

    const slot = player.inventory.findIndex((s) => s?.id === 'coal');
    quickMove(world, player, chest.id, { area: 'bag', index: slot });
    expect(countItem(player, 'coal')).toBe(0);
    expect(countIn(chest.input, 'coal')).toBe(24);
  });

  it('empties the whole chest in one action', () => {
    const { world, player, chest } = chestWith([
      ['ironPlate', 40],
      ['coal', 12],
    ]);

    expect(takeAll(world, player, chest.id)).toBe(52);
    expect(totalIn(chest.input)).toBe(0);
    expect(countItem(player, 'ironPlate')).toBe(40);
    expect(countItem(player, 'coal')).toBe(12);
  });

  it('leaves behind whatever the bag has no room for', () => {
    const { world, player, chest } = chestWith([['coal', 300]]);
    // Fill every slot the bag has with something else.
    for (let i = 0; i < INVENTORY_SLOTS; i++) player.inventory[i] = { id: 'gear', count: 999 };

    expect(takeAll(world, player, chest.id)).toBe(0);
    expect(countIn(chest.input, 'coal')).toBe(300);
  });
});

describe('splitting and swapping', () => {
  it('right-click takes half, keeping the larger half in hand', () => {
    const { world, player, chest } = chestWith([['coal', 7]]);

    clickSlot(world, player, chest.id, { area: 'input', index: 0 }, 'right');

    expect(player.cursor).toEqual({ id: 'coal', count: 4 });
    expect(chest.input[0]?.count).toBe(3);
  });

  it('right-click places a single item from the held stack', () => {
    const { world, player, chest } = chestWith([['coal', 10]]);
    clickSlot(world, player, chest.id, { area: 'input', index: 0 }, 'left');

    clickSlot(world, player, chest.id, { area: 'input', index: 4 }, 'right');

    expect(chest.input[4]).toEqual({ id: 'coal', count: 1 });
    expect(player.cursor).toEqual({ id: 'coal', count: 9 });
  });

  it('merges into a slot holding the same item, up to its ceiling', () => {
    const cap = MACHINES.chest.slotSize;
    const { world, player, chest } = chestWith();
    chest.input[0] = { id: 'coal', count: cap - 5 };
    player.cursor = { id: 'coal', count: 20 };

    clickSlot(world, player, chest.id, { area: 'input', index: 0 }, 'left');

    expect(chest.input[0]?.count).toBe(cap);
    expect(player.cursor).toEqual({ id: 'coal', count: 15 });
  });

  it('swaps two different items', () => {
    const { world, player, chest } = chestWith([['coal', 6]]);
    player.cursor = { id: 'ironPlate', count: 3 };

    clickSlot(world, player, chest.id, { area: 'input', index: 0 }, 'left');

    expect(chest.input[0]).toEqual({ id: 'ironPlate', count: 3 });
    expect(player.cursor).toEqual({ id: 'coal', count: 6 });
  });
});

describe('what a machine will accept by hand', () => {
  it('lets the player feed a furnace the ore its recipe uses', () => {
    const b = bench();
    const { tx, ty } = at(4, 5);
    const furnace = put(b, ['furnace', 'ironPlate'], tx, ty, 0) as Machine;
    b.player.inventory.fill(null);
    addItem(b.player, 'ironOre', 10);

    const slot = b.player.inventory.findIndex((s) => s?.id === 'ironOre');
    quickMove(b.world, b.player, furnace.id, { area: 'bag', index: slot });

    expect(countIn(furnace.input, 'ironOre')).toBe(10);
    advance(b.world, 5);
    expect(countIn(furnace.output, 'ironPlate')).toBeGreaterThan(0);
  });

  it('refuses an item the furnace recipe does not use', () => {
    const b = bench();
    const { tx, ty } = at(4, 5);
    const furnace = put(b, ['furnace', 'ironPlate'], tx, ty, 0) as Machine;
    b.player.inventory.fill(null);
    addItem(b.player, 'copperOre', 10);

    const slot = b.player.inventory.findIndex((s) => s?.id === 'copperOre');
    expect(quickMove(b.world, b.player, furnace.id, { area: 'bag', index: slot })).toBe(false);

    b.player.cursor = { id: 'copperOre', count: 10 };
    expect(clickSlot(b.world, b.player, furnace.id, { area: 'input', index: 0 })).toBe(false);
    expect(totalIn(furnace.input)).toBe(0);
  });

  it('refuses to put anything into an output slot, but allows taking from it', () => {
    const b = bench();
    const { tx, ty } = at(4, 5);
    plantOre(b.world, 'ironOre', tx, ty);
    const miner = put(b, 'miner', tx, ty, 0) as Machine;

    advance(b.world, 5);
    const mined = countIn(miner.output, 'ironOre');
    expect(mined).toBeGreaterThan(0);

    b.player.cursor = { id: 'coal', count: 4 };
    expect(clickSlot(b.world, b.player, miner.id, { area: 'output', index: 0 })).toBe(false);
    expect(countIn(miner.output, 'coal')).toBe(0);

    b.player.cursor = null;
    clickSlot(b.world, b.player, miner.id, { area: 'output', index: 0 }, 'left');
    expect(stacksIn([b.player.cursor])).toEqual([{ id: 'ironOre', count: mined }]);
  });
});

describe('the held stack', () => {
  it('goes back to the bag when the screen closes', () => {
    const { world, player, chest } = chestWith([['ironPlate', 12]]);
    clickSlot(world, player, chest.id, { area: 'input', index: 0 }, 'left');

    stowCursor(world, player);

    expect(player.cursor).toBe(null);
    expect(countItem(player, 'ironPlate')).toBe(12);
  });

  it('falls at the player’s feet rather than vanishing when the bag is full', () => {
    const { world, player, chest } = chestWith([['ironPlate', 12]]);
    clickSlot(world, player, chest.id, { area: 'input', index: 0 }, 'left');
    for (let i = 0; i < INVENTORY_SLOTS; i++) player.inventory[i] = { id: 'gear', count: 999 };

    stowCursor(world, player);

    expect(player.cursor).toBe(null);
    const dropped = world.pickups.find((p) => p.item === 'ironPlate');
    expect(dropped?.count).toBe(12);
  });
});

describe('a chest at the end of a line', () => {
  it('gives back what the belts delivered', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'ironOre', tx, ty);
    const parts = lay(b, tx, ty, 0, ['miner', 'belt', ['furnace', 'ironPlate'], 'belt', 'chest']);
    const chest = parts[4] as Machine;

    advance(b.world, 30);
    const delivered = countIn(chest.input, 'ironPlate');
    expect(delivered).toBeGreaterThan(0);

    b.player.inventory.fill(null);
    const taken = withdraw(b.world, b.player, chest.id, 'ironPlate', delivered);

    expect(taken).toBe(delivered);
    expect(countItem(b.player, 'ironPlate')).toBe(delivered);
    expect(countIn(chest.input, 'ironPlate')).toBe(0);
  });

  it('still accepts from a belt while the player is taking from it', () => {
    const b = bench();
    const { tx, ty } = at(2, 6);
    const belt = put(b, 'belt', tx, ty, 0) as Belt;
    const chest = put(b, 'chest', tx + 1, ty, 0) as Machine;

    addToSlots(chest.input, 'coal', 30, MACHINES.chest.slotSize);
    withdraw(b.world, b.player, chest.id, 'coal', 30);
    pushOntoBelt(belt, 'gear');
    advance(b.world, 3);

    expect(contents(chest.input)).toEqual(['gear']);
  });
});

describe('tidying a grid', () => {
  it('merges loose stacks of one item into full ones', () => {
    const { world, player, chest } = chestWith();
    const cap = MACHINES.chest.slotSize;
    // Eight part-used stacks: what a chest looks like after a line has run and
    // the player has taken handfuls out of the middle of it.
    for (let i = 0; i < 4; i++) chest.input[i * 2] = { id: 'coal', count: 80 };

    expect(sortArea(world, player, chest.id, 'input')).toBe(true);

    expect(stacksIn(chest.input)).toEqual([{ id: 'coal', count: 320 }]);
    expect(chest.input[0]).toEqual({ id: 'coal', count: cap });
    expect(chest.input[1]).toEqual({ id: 'coal', count: 320 - cap });
    expect(chest.input[2]).toBe(null);
  });

  it('lays items out in table order and leaves nothing behind', () => {
    const { world, player, chest } = chestWith();
    chest.input[5] = { id: 'circuit', count: 3 };
    chest.input[2] = { id: 'wood', count: 4 };
    chest.input[7] = { id: 'coal', count: 9 };

    sortArea(world, player, chest.id, 'input');

    expect(contents(chest.input)).toEqual(['wood', 'coal', 'circuit']);
    expect(totalIn(chest.input)).toBe(16);
  });

  it('respects the container ceiling rather than the item stack size', () => {
    const { world, player, chest } = chestWith([['coal', 500]]);

    sortArea(world, player, chest.id, 'input');

    for (const slot of chest.input) {
      if (slot) expect(slot.count).toBeLessThanOrEqual(MACHINES.chest.slotSize);
    }
    expect(totalIn(chest.input)).toBe(500);
  });

  it('sorts the bag without touching the container', () => {
    const { world, player, chest } = chestWith([['coal', 20]]);
    player.inventory[9] = { id: 'stone', count: 2 };
    player.inventory[3] = { id: 'wood', count: 7 };

    expect(sortArea(world, player, null, 'bag')).toBe(true);

    expect(contents(player.inventory)).toEqual(['wood', 'stone']);
    expect(stacksIn(chest.input)).toEqual([{ id: 'coal', count: 20 }]);
  });

  it('reports a grid that is already tidy as unchanged', () => {
    const { world, player, chest } = chestWith();
    chest.input[4] = { id: 'coal', count: 20 };

    expect(sortArea(world, player, chest.id, 'input')).toBe(true);
    expect(sortArea(world, player, chest.id, 'input')).toBe(false);
  });

  it('leaves a grid alone rather than dropping what will not fit', () => {
    // Two slots holding more than two full stacks can only happen to a save
    // written before a ceiling changed; sorting must not be how it is lost.
    const slots = [
      { id: 'coal' as const, count: 40 },
      { id: 'coal' as const, count: 40 },
    ];

    expect(sortSlots(slots, 30)).toBe(false);
    expect(totalIn(slots)).toBe(80);
  });
});

describe('gathering one item into the slot that was clicked', () => {
  it('pulls the loose stacks in, smallest first', () => {
    const { world, player, chest } = chestWith();
    chest.input[0] = { id: 'coal', count: 100 };
    chest.input[3] = { id: 'coal', count: 40 };
    chest.input[5] = { id: 'coal', count: 10 };
    chest.input[6] = { id: 'wood', count: 5 };

    expect(gatherStacks(world, player, chest.id, { area: 'input', index: 0 })).toBe(true);

    expect(chest.input[0]).toEqual({ id: 'coal', count: 150 });
    expect(chest.input[3]).toBe(null);
    expect(chest.input[5]).toBe(null);
    // Anything else stays exactly where the player put it.
    expect(chest.input[6]).toEqual({ id: 'wood', count: 5 });
  });

  it('stops at the slot ceiling and empties the smallest stacks first', () => {
    const { world, player, chest } = chestWith();
    const cap = MACHINES.chest.slotSize;
    chest.input[0] = { id: 'coal', count: cap - 15 };
    chest.input[1] = { id: 'coal', count: 60 };
    chest.input[2] = { id: 'coal', count: 5 };

    gatherStacks(world, player, chest.id, { area: 'input', index: 0 });

    expect(chest.input[0]).toEqual({ id: 'coal', count: cap });
    expect(chest.input[2]).toBe(null);
    expect(chest.input[1]).toEqual({ id: 'coal', count: 50 });
  });

  it('does nothing on a full slot, an empty one, or while a stack is held', () => {
    const { world, player, chest } = chestWith();
    chest.input[0] = { id: 'coal', count: MACHINES.chest.slotSize };
    chest.input[1] = { id: 'coal', count: 20 };

    expect(gatherStacks(world, player, chest.id, { area: 'input', index: 0 })).toBe(false);
    expect(gatherStacks(world, player, chest.id, { area: 'input', index: 4 })).toBe(false);

    player.cursor = { id: 'coal', count: 1 };
    chest.input[0] = { id: 'coal', count: 20 };
    expect(gatherStacks(world, player, chest.id, { area: 'input', index: 0 })).toBe(false);
    expect(chest.input[1]).toEqual({ id: 'coal', count: 20 });
  });

  it('gathers in the bag too, at the bag\u2019s own ceiling', () => {
    const { world, player } = chestWith();
    player.inventory[2] = { id: 'stone', count: 300 };
    player.inventory[8] = { id: 'stone', count: 250 };

    expect(gatherStacks(world, player, null, { area: 'bag', index: 2 })).toBe(true);

    expect(player.inventory[2]).toEqual({ id: 'stone', count: 550 });
    expect(player.inventory[8]).toBe(null);
  });
});

describe('reading an older save', () => {
  it('takes a compacted list as the first slots of a grid', () => {
    const legacy = [
      { id: 'wood', count: 40 },
      { id: 'stone', count: 12 },
    ];

    const slots = normalizeSlots(legacy, INVENTORY_SLOTS);

    expect(slots).toHaveLength(INVENTORY_SLOTS);
    expect(slots[0]).toEqual({ id: 'wood', count: 40 });
    expect(slots[1]).toEqual({ id: 'stone', count: 12 });
    expect(slots[2]).toBe(null);
  });

  it('drops entries it cannot read and keeps the rest', () => {
    const slots = normalizeSlots(
      [{ id: 'nonsense', count: 4 }, null, { id: 'coal', count: 3 }, { count: 9 }],
      8,
    );

    expect(stacksIn(slots)).toEqual([{ id: 'coal', count: 3 }]);
  });

  it('merges anything that no longer fits where it sat', () => {
    // A chest saved with more entries than the grid has slots.
    const slots = normalizeSlots(
      [
        { id: 'coal', count: 5 },
        { id: 'coal', count: 5 },
        { id: 'wood', count: 2 },
      ],
      2,
    );

    expect(stacksIn(slots)).toEqual([
      { id: 'coal', count: 10 },
      { id: 'wood', count: 2 },
    ]);
  });
});
