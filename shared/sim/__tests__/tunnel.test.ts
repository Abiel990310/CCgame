import { describe, expect, it } from 'vitest';
import { TUNNEL_REACH } from '../../data/machines';
import { entityAt, factoryPlacementError, removeAt, tunnelEntranceOf, tunnelExitOf } from '../factory';
import { countIn } from '../slots';
import { pushOntoBelt } from '../systems/factory';
import type { Belt, Machine } from '../types';
import { advance, at, bench, itemsOnBelts, put } from './bench';

/**
 * An underground belt is one item placed twice: the first becomes an entrance,
 * the next one down the line facing the same way becomes its exit. What goes
 * in comes up at the exit, and whatever stands on the tiles between is left
 * alone — which is the only reason to build one.
 */

/** Belt, entrance, `gap` tiles, exit, belt, chest, all facing east. */
function tunnel(gap: number) {
  const b = bench();
  const start = at(2, 3);
  const feed = put(b, 'belt', start.tx, start.ty, 0) as Belt;
  const entrance = put(b, 'tunnel', start.tx + 1, start.ty, 0) as Machine;
  const exitAt = start.tx + 2 + gap;
  const exit = put(b, 'tunnel', exitAt, start.ty, 0) as Machine;
  const out = put(b, 'belt', exitAt + 1, start.ty, 0) as Belt;
  const chest = put(b, 'chest', exitAt + 2, start.ty, 0) as Machine;
  return { b, start, feed, entrance, exit, out, chest };
}

describe('placing an underground belt', () => {
  it('makes the second piece facing the same way the exit', () => {
    const { b, entrance, exit } = tunnel(3);
    expect(entrance.type).toBe('tunnel');
    expect(exit.type).toBe('tunnelExit');
    expect(tunnelExitOf(b.world, entrance)).toBe(exit);
    expect(tunnelEntranceOf(b.world, exit)).toBe(entrance);
  });

  it(`pairs across as many as ${TUNNEL_REACH} tiles and no further`, () => {
    const { b, entrance, exit } = tunnel(TUNNEL_REACH);
    expect(exit.type).toBe('tunnelExit');
    expect(tunnelExitOf(b.world, entrance)).toBe(exit);

    const far = at(2, 5);
    const lone = put(b, 'tunnel', far.tx, far.ty, 0) as Machine;
    const past = put(b, 'tunnel', far.tx + TUNNEL_REACH + 2, far.ty, 0) as Machine;
    expect(past.type).toBe('tunnel');
    expect(tunnelExitOf(b.world, lone)).toBe(null);
  });

  it('does not pair with a piece facing another way', () => {
    const b = bench();
    const spot = at(2, 3);
    put(b, 'tunnel', spot.tx, spot.ty, 0);
    const across = put(b, 'tunnel', spot.tx + 3, spot.ty, 1) as Machine;
    expect(across.type).toBe('tunnel');
  });

  it('starts a new tunnel after an exit, so a line can dive more than once', () => {
    const b = bench();
    const spot = at(2, 3);
    const types = [0, 3, 5, 8].map((dx) => (put(b, 'tunnel', spot.tx + dx, spot.ty, 0) as Machine).type);
    expect(types).toEqual(['tunnel', 'tunnelExit', 'tunnel', 'tunnelExit']);
  });

  it('costs one crafted piece at either end and gives it back when removed', () => {
    const { b, exit } = tunnel(2);
    const before = countIn(b.player.inventory, 'tunnel');
    expect(removeAt(b.world, b.player, exit.tx, exit.ty)).toBe(true);
    expect(countIn(b.player.inventory, 'tunnel')).toBe(before + 1);
  });

  it('cannot be placed without one in the bag', () => {
    const b = bench();
    b.player.inventory = b.player.inventory.map((s) => (s?.id === 'tunnel' ? null : s));
    const spot = at(2, 3);
    expect(factoryPlacementError(b.world, b.player, 'tunnel', spot.tx, spot.ty)).toBe('cost');
  });
});

describe('an underground belt carrying a line', () => {
  it('brings everything fed in up at the exit and on to the chest', () => {
    const { b, feed, chest } = tunnel(TUNNEL_REACH);
    for (let i = 0; i < 12; i++) {
      expect(pushOntoBelt(feed, 'ironPlate')).toBe(true);
      advance(b.world, 0.5);
    }
    advance(b.world, 10);
    expect(countIn(chest.input, 'ironPlate')).toBe(12);
    expect(itemsOnBelts(b.world)).toBe(0);
  });

  it('passes under a belt line crossing it without touching it', () => {
    const { b, start, feed, chest } = tunnel(3);
    // A north-to-south line straight across the gap, into its own chest.
    const cx = start.tx + 3;
    const cross = [start.ty - 2, start.ty - 1, start.ty, start.ty + 1].map(
      (ty) => put(b, 'belt', cx, ty, 1) as Belt,
    );
    const sink = put(b, 'chest', cx, start.ty + 2, 0) as Machine;

    for (let i = 0; i < 8; i++) {
      pushOntoBelt(feed, 'ironPlate');
      pushOntoBelt(cross[0], 'coal');
      advance(b.world, 0.6);
    }
    advance(b.world, 10);
    expect(countIn(chest.input, 'ironPlate')).toBe(8);
    expect(countIn(chest.input, 'coal')).toBe(0);
    expect(countIn(sink.input, 'coal')).toBe(8);
    expect(countIn(sink.input, 'ironPlate')).toBe(0);
  });

  it('comes up at the nearest exit when two are in reach', () => {
    const b = bench();
    const spot = at(2, 3);
    const feed = put(b, 'belt', spot.tx, spot.ty, 0) as Belt;
    put(b, 'tunnel', spot.tx + 1, spot.ty, 0);
    const near = put(b, 'tunnel', spot.tx + 3, spot.ty, 0) as Machine;
    const nearChest = put(b, 'chest', spot.tx + 4, spot.ty, 0) as Machine;
    // Built past the first exit, this is an entrance of its own, not a second exit.
    const next = put(b, 'tunnel', spot.tx + 5, spot.ty, 0) as Machine;
    expect(near.type).toBe('tunnelExit');
    expect(next.type).toBe('tunnel');

    for (let i = 0; i < 4; i++) {
      pushOntoBelt(feed, 'gear');
      advance(b.world, 0.6);
    }
    advance(b.world, 5);
    expect(countIn(nearChest.input, 'gear')).toBe(4);
  });

  it('holds what it has when the exit is taken away, and reports it', () => {
    const { b, feed, entrance, exit } = tunnel(2);
    removeAt(b.world, b.player, exit.tx, exit.ty);
    for (let i = 0; i < 3; i++) {
      pushOntoBelt(feed, 'coal');
      advance(b.world, 0.6);
    }
    advance(b.world, 3);
    expect(entrance.stalled).toBe(true);
    expect(countIn(entrance.input, 'coal')).toBe(3);
  });

  it('refuses a belt pushing into the exit from behind', () => {
    const { b, exit } = tunnel(3);
    const behind = put(b, 'belt', exit.tx, exit.ty - 1, 1) as Belt;
    pushOntoBelt(behind, 'stone');
    advance(b.world, 3);
    expect(behind.items).toHaveLength(1);
    expect(entityAt(b.world, exit.tx, exit.ty)).toBe(exit);
  });
});
