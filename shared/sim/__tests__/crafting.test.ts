import { describe, expect, it } from 'vitest';
import { CRAFTS, CRAFT_BY_ID } from '../../data/crafting';
import { ITEMS, RESOURCES } from '../../data/items';
import { CRAFTED_MACHINES, MACHINES, MACHINE_ORDER, placementCost } from '../../data/machines';
import { craft, craftError, toolSpeed, WORKBENCH_REACH } from '../crafting';
import { factoryPlacementError } from '../factory';
import { BAG_ROW, INVENTORY_SLOTS, addItem } from '../inventory';
import { countIn } from '../slots';
import { stepGathering } from '../systems/gathering';
import type { Player, World } from '../types';
import { addPlayer, createWorld } from '../world';
import { at, bench, plantOre } from './bench';

/**
 * The workbench is where tools and every advanced machine come from. These
 * hold it to its rules: you have to be standing at one, you have to have
 * earned the machine, a full bag never eats the ingredients, and a crafted
 * machine is placed by spending the item rather than paying for it twice.
 */

function atBench(): { world: World; player: Player } {
  const world = createWorld(31, true);
  const player = addPlayer(world, 'crafter');
  world.buildings.push({
    id: world.nextId++,
    type: 'workbench',
    pos: { x: player.pos.x + 40, y: player.pos.y },
    level: 1,
  });
  return { world, player };
}

function stock(player: Player, id: string): void {
  for (const c of CRAFT_BY_ID.get(id)!.cost) addItem(player, c.id, c.count);
}

describe('the crafting table', () => {
  it('has an item and a recipe for every crafted machine, costed as the machine', () => {
    for (const id of CRAFTED_MACHINES) {
      expect(ITEMS[id].name).toBe(MACHINES[id].name);
      expect(CRAFT_BY_ID.get(id)?.cost).toEqual(MACHINES[id].cost);
      expect(placementCost(id)).toEqual([{ id, count: 1 }]);
    }
  });

  it('leaves the basic pieces to be built straight from materials', () => {
    for (const id of MACHINE_ORDER.filter((m) => !MACHINES[m].crafted)) {
      expect(placementCost(id)).toEqual(MACHINES[id].cost);
      expect(CRAFT_BY_ID.has(id)).toBe(false);
    }
  });

  it('makes every tool out of things that exist', () => {
    const tools = CRAFTS.filter((c) => c.group === 'tools');
    expect(tools.length).toBeGreaterThan(0);
    for (const c of tools) {
      expect(ITEMS[c.output].tool).toBeDefined();
      for (const part of c.cost) expect(ITEMS[part.id]).toBeDefined();
    }
  });
});

describe('crafting at a workbench', () => {
  it('turns the ingredients into the item', () => {
    const { world, player } = atBench();
    stock(player, 'stoneAxe');

    expect(craft(world, player, 'stoneAxe')).toBe(true);

    expect(countIn(player.inventory, 'stoneAxe')).toBe(1);
    for (const c of CRAFT_BY_ID.get('stoneAxe')!.cost) expect(countIn(player.inventory, c.id)).toBe(0);
    expect(world.events.some((e) => e.kind === 'crafted' && e.item === 'stoneAxe')).toBe(true);
  });

  it('refuses away from a workbench', () => {
    const { world, player } = atBench();
    stock(player, 'stoneAxe');
    player.pos = { x: player.pos.x - WORKBENCH_REACH * 2, y: player.pos.y };

    expect(craftError(world, player, 'stoneAxe')).toBe('far');
    expect(craft(world, player, 'stoneAxe')).toBe(false);
    expect(countIn(player.inventory, 'wood')).toBeGreaterThan(0);
  });

  it('refuses without the ingredients', () => {
    const { world, player } = atBench();
    expect(craftError(world, player, 'ironPick')).toBe('cost');
  });

  it('refuses a machine the island has not researched yet', () => {
    const { world, player } = atBench();
    stock(player, 'minerMk2');
    expect(craftError(world, player, 'minerMk2')).toBe('locked');

    world.research.unlockedAll = true;
    expect(craft(world, player, 'minerMk2')).toBe(true);
    expect(countIn(player.inventory, 'minerMk2')).toBe(1);
  });

  it('keeps the ingredients when the bag has no room for what comes out', () => {
    const { world, player } = atBench();
    stock(player, 'stonePick');
    // Fill every empty slot with something that will not stack with a pick.
    for (let i = 0; i < INVENTORY_SLOTS; i++) addItem(player, 'berry', 999);

    expect(craftError(world, player, 'stonePick')).toBe('room');
    expect(craft(world, player, 'stonePick')).toBe(false);
    expect(countIn(player.inventory, 'stone')).toBe(8);
  });
});

describe('bags', () => {
  it('sews a satchel onto the bag as a new row, keeping everything where it was', () => {
    const { world, player } = atBench();
    stock(player, 'satchel');
    player.inventory[INVENTORY_SLOTS - 1] = { id: 'berry', count: 5 };
    expect(craft(world, player, 'satchel')).toBe(true);
    expect(player.bag).toBe(1);
    expect(player.inventory).toHaveLength(INVENTORY_SLOTS + BAG_ROW);
    expect(player.inventory[INVENTORY_SLOTS - 1]).toEqual({ id: 'berry', count: 5 });
    expect(player.inventory.slice(INVENTORY_SLOTS).every((s) => s === null)).toBe(true);
    // It is sewn on, not carried: nothing to lose in a chest.
    expect(countIn(player.inventory, 'satchel')).toBe(0);
    expect(countIn(player.inventory, 'fiber')).toBe(0);
  });

  it('sews them on in order, each once', () => {
    const { world, player } = atBench();
    for (const id of ['satchel', 'ironPack', 'steelPack']) stock(player, id);
    expect(craftError(world, player, 'ironPack')).toBe('order');
    expect(craft(world, player, 'satchel')).toBe(true);
    expect(craftError(world, player, 'satchel')).toBe('owned');
    expect(craft(world, player, 'ironPack')).toBe(true);
    expect(craft(world, player, 'steelPack')).toBe(true);
    expect(player.inventory).toHaveLength(INVENTORY_SLOTS + 3 * BAG_ROW);
  });

  it('can be sewn on when the bag is already full, which is when it is wanted', () => {
    const { world, player } = atBench();
    stock(player, 'satchel');
    for (let i = 0; i < INVENTORY_SLOTS; i++) addItem(player, 'berry', 999);
    expect(craftError(world, player, 'satchel')).toBe(null);
    expect(craft(world, player, 'satchel')).toBe(true);
    expect(addItem(player, 'stone', 5)).toBe(5);
  });
});

describe('placing a crafted machine', () => {
  it('needs the crafted item, however many materials are in the bag', () => {
    const b = bench();
    const { tx, ty } = at(0, 0);
    plantOre(b.world, 'ironOre', tx, ty);
    b.player.inventory.fill(null);
    for (const c of MACHINES.minerMk2.cost) addItem(b.player, c.id, c.count * 10);

    expect(factoryPlacementError(b.world, b.player, 'minerMk2', tx, ty)).toBe('cost');
    addItem(b.player, 'minerMk2', 1);
    expect(factoryPlacementError(b.world, b.player, 'minerMk2', tx, ty)).toBe(null);
  });
});

describe('tools', () => {
  it('speed up gathering of their own kind only, and only the best one counts', () => {
    const { player } = atBench();
    expect(toolSpeed(player, 'axe')).toBe(1);

    addItem(player, 'stoneAxe', 1);
    addItem(player, 'ironAxe', 1);
    expect(toolSpeed(player, 'axe')).toBe(ITEMS.ironAxe.tool!.speed);
    expect(toolSpeed(player, 'pick')).toBe(1);
  });

  it('fell a tree in fewer swings', () => {
    const swings = (withAxe: boolean): number => {
      const world = createWorld(17);
      // A tree standing alone, so it is the node nearest the player.
      const node = world.nodes.find(
        (n) => n.kind === 'tree' && world.nodes.every((o) => o === n || Math.hypot(o.pos.x - n.pos.x, o.pos.y - n.pos.y) > 90),
      )!;
      const player = addPlayer(world, 'test');
      player.pos = { x: node.pos.x, y: node.pos.y + 20 };
      if (withAxe) addItem(player, 'steelAxe', 1);
      const input = { move: { x: 0, y: 0 }, dash: false, interact: true };
      let ticks = 0;
      while (node.charges === RESOURCES.tree.charges && ticks < 10_000) {
        stepGathering(world, player, input, 1 / 30);
        ticks++;
      }
      return ticks;
    };
    expect(swings(true)).toBeLessThan(swings(false) / 2);
  });
});
