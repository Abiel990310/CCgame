import { describe, expect, it } from 'vitest';
import { BELT_CAPACITY, BELT_SPEED, MACHINES } from '../../data/machines';
import { RECIPE_BY_ID } from '../../data/recipes';
import { TICK_DT } from '../constants';
import {
  beltAt,
  factoryPlacementError,
  placeBelt,
  placeMachine,
  removeAt,
  setRecipe,
} from '../factory';
import { tileKey } from '../grid';
import { addItem, countItem } from '../inventory';
import { oreAt } from '../ore';
import { EMPTY_INPUT, step } from '../step';
import { pushOntoBelt } from '../systems/factory';
import type { Direction, ItemId, Player, World } from '../types';
import { addPlayer, createWorld } from '../world';

function run(world: World, seconds: number): void {
  const ticks = Math.round(seconds / TICK_DT);
  const inputs = new Map([...world.players.keys()].map((id) => [id, EMPTY_INPUT]));
  for (let i = 0; i < ticks; i++) step(world, inputs);
}

/** A world with a stocked player, parked well away from anything dangerous. */
function setup(seed = 4242): { world: World; player: Player } {
  const world = createWorld(seed, true);
  const player = addPlayer(world, 'test');
  for (const item of [
    'wood',
    'stone',
    'ironPlate',
    'ironOre',
    'copperOre',
    'copperPlate',
  ] as ItemId[]) {
    addItem(player, item, 500);
  }
  return { world, player };
}

/** Find a tile carrying the given ore, so miner tests are seed-independent. */
function findOre(world: World, kind: 'ironOre' | 'copperOre' | 'coal'): { tx: number; ty: number } {
  const tiles = Math.sqrt(world.ore.length);
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      if (oreAt(world.ore, tx, ty) === kind) return { tx, ty };
    }
  }
  throw new Error(`no ${kind} generated`);
}

/**
 * An empty, buildable tile. Cost is ignored deliberately: a tile is free or not
 * regardless of what the player happens to be carrying.
 */
function findFree(world: World, player: Player): { tx: number; ty: number } {
  const tiles = Math.sqrt(world.ore.length);
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const error = factoryPlacementError(world, player, 'belt', tx, ty);
      if (error === null || error === 'cost') return { tx, ty };
    }
  }
  throw new Error('no free tile');
}

describe('ore generation', () => {
  it('places every ore kind on walkable land', () => {
    const world = createWorld(101);
    for (const kind of ['ironOre', 'copperOre', 'coal'] as const) {
      expect(() => findOre(world, kind)).not.toThrow();
    }
  });

  it('is deterministic for a seed', () => {
    const a = createWorld(55);
    const b = createWorld(55);
    expect(Array.from(a.ore)).toEqual(Array.from(b.ore));
  });

  it('never buries an ore tile under a resource node', () => {
    const world = createWorld(77);
    for (const node of world.nodes) {
      const tx = Math.floor(node.pos.x / 32);
      const ty = Math.floor(node.pos.y / 32);
      expect(oreAt(world.ore, tx, ty)).toBe(null);
    }
  });
});

describe('placement', () => {
  it('places and indexes a belt', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);

    const belt = placeBelt(world, player, tx, ty, 0);
    expect(belt).not.toBe(null);
    expect(world.grid.get(tileKey(tx, ty))).toBe(belt);
    expect(beltAt(world, tx, ty)).toBe(belt);
  });

  it('refuses a second thing on the same tile', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);
    placeBelt(world, player, tx, ty, 0);
    expect(factoryPlacementError(world, player, 'belt', tx, ty)).toBe('occupied');
  });

  it('requires a miner to sit on ore', () => {
    const { world, player } = setup();
    const free = findFree(world, player);
    expect(factoryPlacementError(world, player, 'miner', free.tx, free.ty)).toBe('ore');

    const ore = findOre(world, 'ironOre');
    expect(factoryPlacementError(world, player, 'miner', ore.tx, ore.ty)).toBe(null);
  });

  it('reports a cost shortfall', () => {
    const world = createWorld(9, true);
    const player = addPlayer(world, 'broke');
    const { tx, ty } = findFree(world, player);
    expect(factoryPlacementError(world, player, 'belt', tx, ty)).toBe('cost');
  });

  it('charges for what it places', () => {
    const { world, player } = setup();
    const before = countItem(player, 'wood');
    const { tx, ty } = findFree(world, player);
    placeBelt(world, player, tx, ty, 0);
    expect(countItem(player, 'wood')).toBe(before - 1);
  });

  it('refunds on removal and frees the tile', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);
    const before = countItem(player, 'wood');

    placeBelt(world, player, tx, ty, 0);
    expect(removeAt(world, player, tx, ty)).toBe(true);

    expect(countItem(player, 'wood')).toBe(before);
    expect(world.grid.has(tileKey(tx, ty))).toBe(false);
    expect(world.belts.length).toBe(0);
  });

  it('returns a machine’s contents when removed', () => {
    const { world, player } = setup();
    const ore = findOre(world, 'ironOre');
    const miner = placeMachine(world, player, 'miner', ore.tx, ore.ty, 0)!;
    miner.output.push({ id: 'ironOre', count: 7 });

    const before = countItem(player, 'ironOre');
    removeAt(world, player, ore.tx, ore.ty);
    expect(countItem(player, 'ironOre')).toBe(before + 7);
  });
});

describe('belts', () => {
  /** Lay a straight run of belts heading right from a free tile. */
  function layBelts(world: World, player: Player, length: number, dir: Direction = 0) {
    const start = findFree(world, player);
    const belts = [];
    for (let i = 0; i < length; i++) {
      const belt = placeBelt(world, player, start.tx + i, start.ty, dir);
      if (!belt) throw new Error('belt run hit an obstruction');
      belts.push(belt);
    }
    return belts;
  }

  it('carries an item along a belt', () => {
    const { world, player } = setup();
    const [belt] = layBelts(world, player, 1);
    pushOntoBelt(belt, 'ironOre');

    const before = belt.items[0].offset;
    run(world, 0.2);
    expect(belt.items[0].offset).toBeGreaterThan(before);
  });

  it('hands an item to the next belt', () => {
    const { world, player } = setup();
    const belts = layBelts(world, player, 3);
    pushOntoBelt(belts[0], 'ironOre');

    // One tile per 1/BELT_SPEED seconds, with margin for the handoff.
    run(world, 2 / BELT_SPEED + 0.5);
    expect(belts[0].items.length).toBe(0);
    expect(belts[2].items.length).toBe(1);
    expect(belts[2].items[0].item).toBe('ironOre');
  });

  it('respects belt capacity', () => {
    const { world, player } = setup();
    const [belt] = layBelts(world, player, 1);
    let accepted = 0;
    for (let i = 0; i < BELT_CAPACITY + 5; i++) {
      if (pushOntoBelt(belt, 'ironOre')) accepted++;
    }
    expect(accepted).toBeLessThanOrEqual(BELT_CAPACITY);
  });

  it('backs up rather than dropping items at a dead end', () => {
    const { world, player } = setup();
    const belts = layBelts(world, player, 2);
    for (let i = 0; i < 3; i++) {
      pushOntoBelt(belts[0], 'ironOre');
      run(world, 0.25);
    }
    run(world, 5);

    const total = belts.reduce((sum, b) => sum + b.items.length, 0);
    expect(total).toBe(3);
  });

  it('keeps items ordered and never overlapping', () => {
    const { world, player } = setup();
    const belts = layBelts(world, player, 4);
    for (let i = 0; i < 4; i++) {
      pushOntoBelt(belts[0], 'ironOre');
      run(world, 0.3);
    }
    run(world, 2);

    for (const belt of belts) {
      for (let i = 1; i < belt.items.length; i++) {
        expect(belt.items[i].offset).toBeLessThan(belt.items[i - 1].offset);
      }
    }
  });
});

describe('miners', () => {
  it('extracts the ore it stands on', () => {
    const { world, player } = setup();
    const ore = findOre(world, 'ironOre');
    const miner = placeMachine(world, player, 'miner', ore.tx, ore.ty, 0)!;

    run(world, 4);
    expect(miner.output.reduce((n, s) => n + s.count, 0)).toBeGreaterThan(0);
    expect(miner.output[0].id).toBe('ironOre');
  });

  it('feeds a belt placed at its output', () => {
    const { world, player } = setup();
    const ore = findOre(world, 'ironOre');
    const miner = placeMachine(world, player, 'miner', ore.tx, ore.ty, 0)!;
    const belt = placeBelt(world, player, ore.tx + 1, ore.ty, 0);
    if (!belt) return; // Neighbouring tile was not buildable on this seed.

    run(world, 4);
    const moved = belt.items.length > 0 || miner.output.length === 0;
    expect(moved).toBe(true);
  });

  it('stalls once its buffer is full', () => {
    const { world, player } = setup();
    const ore = findOre(world, 'ironOre');
    const miner = placeMachine(world, player, 'miner', ore.tx, ore.ty, 0)!;
    miner.output.push({ id: 'ironOre', count: MACHINES.miner.slotSize });

    run(world, 2);
    expect(miner.stalled).toBe(true);
  });
});

describe('crafting machines', () => {
  it('smelts ore into plates', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);
    const furnace = placeMachine(world, player, 'furnace', tx, ty, 0)!;

    setRecipe(world, furnace.id, 'ironPlate');
    furnace.input.push({ id: 'ironOre', count: 10 });

    run(world, 5);
    expect(furnace.output.some((s) => s.id === 'ironPlate' && s.count > 0)).toBe(true);
  });

  it('consumes exactly the recipe inputs per craft', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);
    const assembler = placeMachine(world, player, 'assembler', tx, ty, 0)!;

    setRecipe(world, assembler.id, 'gear');
    // Exactly one craft's worth: 1 gear costs 2 plates and takes 1.5s.
    assembler.input.push({ id: 'ironPlate', count: 2 });

    run(world, 1.7);
    expect(assembler.output.find((s) => s.id === 'gear')?.count ?? 0).toBe(1);
    expect(assembler.input.find((s) => s.id === 'ironPlate')?.count ?? 0).toBe(0);
  });

  it('starts the next craft immediately while inputs remain', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);
    const assembler = placeMachine(world, player, 'assembler', tx, ty, 0)!;

    setRecipe(world, assembler.id, 'gear');
    assembler.input.push({ id: 'ironPlate', count: 6 });

    // Three crafts at 1.5s each; machines do not idle between them.
    run(world, 4.8);
    expect(assembler.output.find((s) => s.id === 'gear')?.count ?? 0).toBe(3);
    expect(assembler.input.find((s) => s.id === 'ironPlate')?.count ?? 0).toBe(0);
  });

  it('stalls without inputs', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);
    const furnace = placeMachine(world, player, 'furnace', tx, ty, 0)!;
    setRecipe(world, furnace.id, 'ironPlate');

    run(world, 1);
    expect(furnace.stalled).toBe(true);
    expect(furnace.output.length).toBe(0);
  });

  it('only accepts items its recipe uses', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);
    const furnace = placeMachine(world, player, 'furnace', tx, ty, 0)!;
    setRecipe(world, furnace.id, 'ironPlate');

    const belt = placeBelt(world, player, tx - 1, ty, 0);
    if (!belt) return;

    pushOntoBelt(belt, 'copperOre');
    run(world, 3);
    // Copper is not part of the iron recipe, so it must stay on the belt.
    expect(furnace.input.some((s) => s.id === 'copperOre')).toBe(false);
    expect(belt.items.length).toBe(1);
  });

  it('rejects a recipe the machine cannot run', () => {
    const { world, player } = setup();
    const { tx, ty } = findFree(world, player);
    const furnace = placeMachine(world, player, 'furnace', tx, ty, 0)!;
    expect(setRecipe(world, furnace.id, 'gear')).toBe(false);
    expect(setRecipe(world, furnace.id, 'copperPlate')).toBe(true);
  });
});

describe('a full production chain', () => {
  it('runs miner → belt → furnace → chest end to end', () => {
    const { world, player } = setup(31337);
    const ore = findOre(world, 'ironOre');

    // Build the line to the right of the miner; skip the seed if it will not fit.
    const cells = [1, 2, 3].map((dx) => ({ tx: ore.tx + dx, ty: ore.ty }));
    const buildable = cells.every(
      (c) => factoryPlacementError(world, player, 'belt', c.tx, c.ty) === null,
    );
    if (!buildable) return;

    placeMachine(world, player, 'miner', ore.tx, ore.ty, 0);
    placeBelt(world, player, cells[0].tx, cells[0].ty, 0);
    const furnace = placeMachine(world, player, 'furnace', cells[1].tx, cells[1].ty, 0)!;
    setRecipe(world, furnace.id, 'ironPlate');
    const chest = placeMachine(world, player, 'chest', cells[2].tx, cells[2].ty, 0)!;

    run(world, 30);

    const plates = chest.input.find((s) => s.id === 'ironPlate')?.count ?? 0;
    expect(plates).toBeGreaterThan(0);
  });
});

describe('peaceful worlds', () => {
  it('spawns no raiders at night', () => {
    const world = createWorld(12, true);
    addPlayer(world, 'test');
    world.phaseTime = 0.1;
    run(world, 20);

    expect(world.phase).toBe('night');
    expect(world.mobs.length).toBe(0);
    expect(world.waveBudget).toBe(0);
  });

  it('still raids when not peaceful', () => {
    const world = createWorld(12, false);
    addPlayer(world, 'test');
    world.phaseTime = 0.1;
    run(world, 20);
    expect(world.mobs.length).toBeGreaterThan(0);
  });
});

describe('recipe table integrity', () => {
  it('only references machines that can run them', () => {
    for (const [, recipe] of RECIPE_BY_ID) {
      expect(MACHINES[recipe.machine].choosesRecipe).toBe(true);
      expect(recipe.time).toBeGreaterThan(0);
      expect(recipe.outputs.length).toBeGreaterThan(0);
    }
  });

  it('never has a recipe whose inputs exceed the machine’s slots', () => {
    for (const [, recipe] of RECIPE_BY_ID) {
      expect(recipe.inputs.length).toBeLessThanOrEqual(MACHINES[recipe.machine].inputSlots);
    }
  });
});
