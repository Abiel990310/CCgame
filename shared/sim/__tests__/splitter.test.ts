import { describe, expect, it } from 'vitest';
import { MACHINES, SPLITTER_BUFFER } from '../../data/machines';
import { TICK_DT } from '../constants';
import { clickSlot } from '../containers';
import { removeAt, setFilter, sideTiles } from '../factory';
import { countIn, totalIn } from '../slots';
import { insertIntoMachine, pushOntoBelt } from '../systems/factory';
import type { Belt, Machine, World } from '../types';
import { advance, at, bench, contents, fill, itemsOnBelts, lay, plantOre, put } from './bench';

/**
 * A splitter is a T: whatever feeds it goes out to the tiles on its left and
 * right, turn by turn. These tests are about where items end up rather than
 * about the buffer in the middle, because the buffer is an implementation
 * detail and the two lines it feeds are the feature.
 */

/** Step one tick at a time, checking an invariant after each one. */
function watch(world: World, seconds: number, check: () => void): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) {
    advance(world, TICK_DT);
    check();
  }
}

/** A belt feeding a splitter, with a chest on each of its two sides. */
function tee() {
  const b = bench();
  const mid = at(3, 3);
  const feed = put(b, 'belt', mid.tx - 1, mid.ty, 0) as Belt;
  const splitter = put(b, 'splitter', mid.tx, mid.ty, 0) as Machine;
  const [l, r] = sideTiles(splitter);
  const left = put(b, 'chest', l.tx, l.ty, 0) as Machine;
  const right = put(b, 'chest', r.tx, r.ty, 0) as Machine;
  return { b, feed, splitter, left, right };
}

describe('a splitter feeding two lines', () => {
  it('hands its two sides one item each, turn by turn', () => {
    const { b, splitter, left, right } = tee();
    fill(splitter.input, 'ironPlate', SPLITTER_BUFFER, SPLITTER_BUFFER);

    advance(b.world, TICK_DT);

    expect(countIn(left.input, 'ironPlate')).toBe(SPLITTER_BUFFER / 2);
    expect(countIn(right.input, 'ironPlate')).toBe(SPLITTER_BUFFER / 2);
  });

  it('splits one miner across two chests, evenly and without losing ore', () => {
    const b = bench();
    const start = at(1, 3);
    plantOre(b.world, 'ironOre', start.tx, start.ty);
    const parts = lay(b, start.tx, start.ty, 0, ['miner', 'belt', 'splitter']);
    const splitter = parts[2] as Machine;
    const [l, r] = sideTiles(splitter);
    const left = put(b, 'chest', l.tx, l.ty, 0) as Machine;
    const right = put(b, 'chest', r.tx, r.ty, 0) as Machine;

    advance(b.world, 40);

    const delivered = countIn(left.input, 'ironOre') + countIn(right.input, 'ironOre');
    expect(delivered).toBeGreaterThan(20);
    // Turn by turn means the two sides never drift more than one item apart.
    expect(Math.abs(countIn(left.input, 'ironOre') - countIn(right.input, 'ironOre')))
      .toBeLessThanOrEqual(1);

    const mined = delivered + totalIn(splitter.input) + itemsOnBelts(b.world);
    expect(totalIn((parts[0] as Machine).output) + mined).toBeGreaterThan(20);
  });

  it('sends everything the other way when one side is blocked', () => {
    const { b, splitter, left, right } = tee();
    // A chest full to its last slot takes nothing more.
    fill(left.input, 'stone', MACHINES.chest.slotSize * MACHINES.chest.inputSlots, MACHINES.chest.slotSize);
    fill(splitter.input, 'ironPlate', SPLITTER_BUFFER, SPLITTER_BUFFER);

    advance(b.world, TICK_DT);

    expect(countIn(right.input, 'ironPlate')).toBe(SPLITTER_BUFFER);
    expect(totalIn(splitter.input)).toBe(0);
  });
});

describe('a splitter with a side filtered', () => {
  it('sorts a mixed belt into one chest each', () => {
    const { b, feed, splitter, left, right } = tee();
    expect(setFilter(b.world, splitter.id, 0, 'ironOre')).toBe(true);
    expect(setFilter(b.world, splitter.id, 1, 'copperOre')).toBe(true);

    for (let i = 0; i < 6; i++) {
      expect(pushOntoBelt(feed, i % 2 === 0 ? 'ironOre' : 'copperOre')).toBe(true);
      advance(b.world, 0.4);
    }
    advance(b.world, 5);

    expect(contents(left.input)).toEqual(['ironOre']);
    expect(contents(right.input)).toEqual(['copperOre']);
    expect(countIn(left.input, 'ironOre')).toBe(3);
    expect(countIn(right.input, 'copperOre')).toBe(3);
  });

  it('still alternates between the sides an unfiltered item may use', () => {
    const { b, splitter, left, right } = tee();
    setFilter(b.world, splitter.id, 0, 'coal');
    fill(splitter.input, 'ironPlate', SPLITTER_BUFFER, SPLITTER_BUFFER);

    advance(b.world, TICK_DT);

    // The filtered side never takes a plate, so the open side takes them all.
    expect(countIn(left.input, 'ironPlate')).toBe(0);
    expect(countIn(right.input, 'ironPlate')).toBe(SPLITTER_BUFFER);
  });

  it('refuses an item neither side would route rather than jamming on it', () => {
    const { b, feed, splitter, left, right } = tee();
    setFilter(b.world, splitter.id, 0, 'ironOre');
    setFilter(b.world, splitter.id, 1, 'ironOre');

    expect(insertIntoMachine(splitter, 'coal')).toBe(false);

    pushOntoBelt(feed, 'coal');
    advance(b.world, 10);

    // The coal is still on the belt, and the splitter is empty rather than stuck.
    expect(itemsOnBelts(b.world)).toBe(1);
    expect(totalIn(splitter.input)).toBe(0);
    expect(totalIn(left.input) + totalIn(right.input)).toBe(0);
  });

  it('has no sides to set on a machine that is not a splitter', () => {
    const { b, splitter, left } = tee();
    expect(setFilter(b.world, left.id, 0, 'coal')).toBe(false);
    expect(setFilter(b.world, splitter.id, 2, 'coal')).toBe(false);
    // Setting a side to what it already is changes nothing.
    expect(setFilter(b.world, splitter.id, 0, null)).toBe(false);
    expect(splitter.filters).toEqual([null, null]);
  });
});

describe('setting a filter by hand', () => {
  it('points a side at what is in hand without spending any of it', () => {
    const { b, splitter } = tee();
    b.player.cursor = { id: 'ironPlate', count: 5 };

    expect(clickSlot(b.world, b.player, splitter.id, { area: 'filter', index: 1 })).toBe(true);

    expect(splitter.filters).toEqual([null, 'ironPlate']);
    expect(b.player.cursor).toEqual({ id: 'ironPlate', count: 5 });
  });

  it('opens the side back up when clicked empty-handed', () => {
    const { b, splitter } = tee();
    setFilter(b.world, splitter.id, 0, 'coal');
    b.player.cursor = null;

    expect(clickSlot(b.world, b.player, splitter.id, { area: 'filter', index: 0 })).toBe(true);

    expect(splitter.filters).toEqual([null, null]);
  });

  it('refuses a stack neither side would route', () => {
    const { b, splitter } = tee();
    setFilter(b.world, splitter.id, 0, 'ironOre');
    setFilter(b.world, splitter.id, 1, 'ironOre');
    b.player.cursor = { id: 'coal', count: 3 };

    expect(clickSlot(b.world, b.player, splitter.id, { area: 'input', index: 0 })).toBe(false);
    expect(totalIn(splitter.input)).toBe(0);
  });
});

describe('a splitter that would feed itself', () => {
  it('never pushes back into the belt that fed it', () => {
    const b = bench();
    const mid = at(3, 3);
    // Facing down, its right-hand side is the tile the feed belt sits on.
    const feed = put(b, 'belt', mid.tx - 1, mid.ty, 0) as Belt;
    const splitter = put(b, 'splitter', mid.tx, mid.ty, 1) as Machine;
    const [l, r] = sideTiles(splitter);
    expect(r).toEqual({ tx: feed.tx, ty: feed.ty });
    const chest = put(b, 'chest', l.tx, l.ty, 0) as Machine;
    fill(splitter.input, 'ironPlate', SPLITTER_BUFFER, SPLITTER_BUFFER);

    // Not one item may ever land on the belt, not even to come straight back.
    watch(b.world, 3, () => expect(itemsOnBelts(b.world)).toBe(0));

    expect(countIn(chest.input, 'ironPlate')).toBe(SPLITTER_BUFFER);
  });

  it('will not trade an item back and forth with a splitter aimed at it', () => {
    const b = bench();
    const mid = at(3, 3);
    const splitter = put(b, 'splitter', mid.tx, mid.ty, 0) as Machine;
    const [l, r] = sideTiles(splitter);
    // A second splitter sitting on the first one's left side, aimed back at it.
    const facing = put(b, 'splitter', l.tx, l.ty, 2) as Machine;
    expect(sideTiles(facing)[0]).toEqual({ tx: splitter.tx, ty: splitter.ty });
    const chest = put(b, 'chest', r.tx, r.ty, 0) as Machine;

    fill(splitter.input, 'ironPlate', SPLITTER_BUFFER, SPLITTER_BUFFER);

    // One tick: the whole buffer goes the one way it can, rather than half of
    // it being handed over and handed straight back.
    advance(b.world, TICK_DT);

    expect(countIn(chest.input, 'ironPlate')).toBe(SPLITTER_BUFFER);
    expect(totalIn(facing.input)).toBe(0);
  });
});

describe('taking a splitter back down', () => {
  it('returns the cost and whatever was still passing through it', () => {
    const { b, splitter } = tee();
    fill(splitter.input, 'ironPlate', 3, SPLITTER_BUFFER);
    const before = countIn(b.player.inventory, 'ironPlate');

    expect(removeAt(b.world, b.player, splitter.tx, splitter.ty)).toBe(true);

    const cost = MACHINES.splitter.cost.find((c) => c.id === 'ironPlate')!.count;
    expect(countIn(b.player.inventory, 'ironPlate')).toBe(before + 3 + cost);
  });
});
