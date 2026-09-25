import { describe, expect, it } from 'vitest';
import { ORE, TICK_DT } from '../constants';
import { factoryPlacementError, placeMachine, removeAt } from '../factory';
import { tileKey } from '../grid';
import { minerOreLeft, oreAt, oreBand, oreLeftAt, generateOre } from '../ore';
import { countIn } from '../slots';
import { EMPTY_INPUT, step } from '../step';
import type { Machine, SimEvent } from '../types';
import { createWorld } from '../world';
import { advance, at, bench, plantOre, put } from './bench';

/** Seconds of mining that yields roughly `count` ore, with room to spare. */
function minutesFor(count: number): number {
  return count * 1.2 + 2;
}

describe('ore patches run out', () => {
  it('takes one ore out of the ground for each one it produces', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    plantOre(b.world, 'ironOre', tx, ty, 40);

    const miner = put(b, 'miner', tx, ty, 0) as Machine;
    advance(b.world, minutesFor(10));

    // Everything mined is either still in the miner or already on its way out;
    // with nothing to push into, it all stays in the output grid.
    const mined = countIn(miner.output, 'ironOre');
    expect(mined).toBeGreaterThan(0);
    expect(oreLeftAt(b.world, tx, ty)).toBe(40 - mined);
  });

  it('empties its own tile, then works the ring around it', () => {
    const b = bench();
    const { tx, ty } = at(4, 3);
    plantOre(b.world, 'ironOre', tx, ty, 3);
    plantOre(b.world, 'ironOre', tx + 1, ty, 5);

    const miner = put(b, 'miner', tx, ty, 0) as Machine;
    advance(b.world, minutesFor(8));

    expect(oreLeftAt(b.world, tx, ty)).toBe(0);
    expect(oreAt(b.world.ore, tx, ty)).toBe(null);
    expect(oreLeftAt(b.world, tx + 1, ty)).toBe(0);
    expect(countIn(miner.output, 'ironOre')).toBe(8);
  });

  it('stalls once there is nothing left within reach', () => {
    const b = bench();
    const { tx, ty } = at(6, 3);
    plantOre(b.world, 'ironOre', tx, ty, 4);

    const miner = put(b, 'miner', tx, ty, 0) as Machine;
    advance(b.world, minutesFor(4) + 5);

    expect(miner.stalled).toBe(true);
    expect(countIn(miner.output, 'ironOre')).toBe(4);
    // A stalled miner keeps producing nothing rather than producing for free.
    advance(b.world, 20);
    expect(countIn(miner.output, 'ironOre')).toBe(4);
  });

  it('says so once, on the ore that empties its reach', () => {
    const b = bench();
    const { tx, ty } = at(12, 3);
    plantOre(b.world, 'copperOre', tx, ty, 2);
    plantOre(b.world, 'copperOre', tx, ty + 1, 1);

    const miner = put(b, 'miner', tx, ty, 0) as Machine;
    const dry: SimEvent[] = [];
    let producedWhenDry = -1;
    const inputs = new Map([...b.world.players.keys()].map((id) => [id, EMPTY_INPUT]));
    for (let t = 0; t < minutesFor(3) + 20; t += TICK_DT) {
      step(b.world, inputs);
      for (const e of b.world.events) {
        if (e.kind !== 'minerDry') continue;
        dry.push(e);
        producedWhenDry = countIn(miner.output, 'copperOre');
      }
    }

    expect(dry).toHaveLength(1);
    expect(dry[0]).toMatchObject({ machine: 'miner', ore: 'copperOre' });
    expect(producedWhenDry).toBe(3);
  });

  it('never reaches past its own ring, or into a different ore', () => {
    const b = bench();
    const { tx, ty } = at(9, 3);
    plantOre(b.world, 'ironOre', tx, ty, 2);
    // Copper next door, and iron two tiles out — neither is this miner's.
    plantOre(b.world, 'copperOre', tx + 1, ty, 50);
    plantOre(b.world, 'ironOre', tx + 1 + ORE.minerReach, ty, 50);

    const miner = put(b, 'miner', tx, ty, 0) as Machine;
    advance(b.world, minutesFor(6));

    expect(countIn(miner.output, 'ironOre')).toBe(2);
    expect(countIn(miner.output, 'copperOre')).toBe(0);
    expect(oreLeftAt(b.world, tx + 1, ty)).toBe(50);
    expect(oreLeftAt(b.world, tx + 1 + ORE.minerReach, ty)).toBe(50);
  });

  it('refuses a new miner on ground that has been worked out', () => {
    const b = bench();
    const { tx, ty } = at(12, 3);
    plantOre(b.world, 'ironOre', tx, ty, 2);

    const miner = put(b, 'miner', tx, ty, 0) as Machine;
    expect(minerOreLeft(b.world, miner)).toBe(2);
    advance(b.world, minutesFor(2) + 2);

    expect(minerOreLeft(b.world, miner)).toBe(0);
    expect(removeAt(b.world, b.player, tx, ty)).toBe(true);
    expect(factoryPlacementError(b.world, b.player, 'miner', tx, ty)).toBe('ore');
    expect(placeMachine(b.world, b.player, 'miner', tx, ty, 0)).toBe(null);
  });

  it('reports a tile to the renderer only when it visibly thins', () => {
    const b = bench();
    const { tx, ty } = at(14, 3);
    // Two ore left is deep inside the lowest band, so pulling one out changes
    // nothing on screen; emptying the tile does.
    plantOre(b.world, 'ironOre', tx, ty, 2);
    put(b, 'miner', tx, ty, 0);

    const seen: number[] = [];
    for (let i = 0; i < Math.round(minutesFor(2) * 30); i++) {
      advance(b.world, 1 / 30);
      for (const event of b.world.events) {
        if (event.kind === 'oreChanged') seen.push(tileKey(event.tx, event.ty));
      }
    }

    expect(seen).toEqual([tileKey(tx, ty)]);
  });

  it('bands a tile by how much is left in it', () => {
    expect(oreBand(0)).toBe(0);
    expect(oreBand(ORE.tileAmount)).toBe(4);
    expect(oreBand(ORE.tileAmount * 0.6)).toBe(3);
    expect(oreBand(ORE.tileAmount * 0.3)).toBe(2);
    expect(oreBand(1)).toBe(1);
  });
});

describe('generated patches', () => {
  it('fills every ore tile and leaves every other one empty', () => {
    const world = createWorld(4242);
    const field = generateOre(world.terrain, 4242);

    let ored = 0;
    for (let i = 0; i < field.kind.length; i++) {
      if (field.kind[i] === 0) expect(field.left[i]).toBe(0);
      else {
        ored++;
        expect(field.left[i]).toBeGreaterThan(0);
        expect(field.left[i]).toBeLessThanOrEqual(ORE.tileAmount * 1.12);
      }
    }
    expect(ored).toBeGreaterThan(100);
  });

  it('is the same field every time, so a save can store only what changed', () => {
    const terrain = createWorld(77).terrain;
    const a = generateOre(terrain, 77);
    const c = generateOre(terrain, 77);
    expect([...a.kind]).toEqual([...c.kind]);
    expect([...a.left]).toEqual([...c.left]);
  });

  it('holds hours of mining in a single patch', () => {
    const world = createWorld(2026);
    const field = generateOre(world.terrain, world.seed);
    const total = field.left.reduce((sum, n) => sum + n, 0);
    const patches = 9 + 7 + 6;
    // One ore every 1.2 seconds, so an average patch is hours of one miner.
    expect((total / patches) * 1.2).toBeGreaterThan(2 * 3600);
  });
});
