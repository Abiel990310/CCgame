import { describe, expect, it } from 'vitest';
import { HAUL, MACHINES, haulDelay } from '../../data/machines';
import { TICK_DT } from '../constants';
import { factoryPlacementError, haulPartner, placeMachine, removeAt } from '../factory';
import { countItem } from '../inventory';
import { totalIn } from '../slots';
import { EMPTY_INPUT, step } from '../step';
import { pushOntoBelt } from '../systems/factory';
import type { Belt, Machine } from '../types';
import { advance, at, bench, itemsOnBelts, lay, type Bench } from './bench';

const inputsOf = (b: Bench) => new Map([...b.world.players.keys()].map((id) => [id, EMPTY_INPUT]));

/** A feed belt, a sender, a receiver `gap` tiles on, and a belt and chest after it. */
function route(b: Bench, gap: number, y = 1) {
  const head = at(1, y);
  const [feed, sender] = lay(b, head.tx, head.ty, 0, ['belt', 'haul']) as [Belt, Machine];
  const far = at(2 + gap, y);
  const [receiver, out, chest] = lay(b, far.tx, far.ty, 0, ['haul', 'belt', 'chest']) as [Machine, Belt, Machine];
  return { feed, sender, receiver, out, chest };
}

describe('long-haul ports', () => {
  it('pairs the second port placed with the first, and the third starts a new pair', () => {
    const b = bench();
    const [a, c, d, e] = [at(1, 1), at(9, 1), at(1, 4), at(9, 4)];
    const first = placeMachine(b.world, b.player, 'haul', a.tx, a.ty, 0)!;
    expect(first.type).toBe('haul');
    expect(haulPartner(b.world, first)).toBe(null);

    const second = placeMachine(b.world, b.player, 'haul', c.tx, c.ty, 0)!;
    expect(second.type).toBe('haulExit');
    expect(first.link).toBe(second.id);
    expect(second.link).toBe(first.id);
    expect(haulPartner(b.world, first)).toBe(second);

    const third = placeMachine(b.world, b.player, 'haul', d.tx, d.ty, 0)!;
    expect(third.type).toBe('haul');
    expect(third.link).toBeUndefined();
    const fourth = placeMachine(b.world, b.player, 'haul', e.tx, e.ty, 0)!;
    expect(fourth.type).toBe('haulExit');
    expect(fourth.link).toBe(third.id);
    // The first pair is untouched by the second.
    expect(first.link).toBe(second.id);
  });

  it('costs one crafted port to place either end, and refunds one', () => {
    const b = bench();
    const before = countItem(b.player, 'haul');
    placeMachine(b.world, b.player, 'haul', at(1, 1).tx, at(1, 1).ty, 0);
    placeMachine(b.world, b.player, 'haul', at(9, 1).tx, at(9, 1).ty, 0);
    expect(countItem(b.player, 'haul')).toBe(before - 2);
    removeAt(b.world, b.player, at(9, 1).tx, at(9, 1).ty);
    expect(countItem(b.player, 'haul')).toBe(before - 1);
  });

  it('carries every item across, none lost and none made', () => {
    const b = bench();
    const { feed, sender, chest } = route(b, 20);
    expect(sender.link).toBeDefined();

    const fed = 12;
    for (let i = 0; i < fed; i++) {
      expect(pushOntoBelt(feed, 'ironOre'), `ore ${i}`).toBe(true);
      advance(b.world, 0.7);
    }
    advance(b.world, 15);

    expect(totalIn(chest.input)).toBe(fed);
    expect(itemsOnBelts(b.world)).toBe(0);
    expect(sender.transit).toHaveLength(0);
    expect(totalIn(sender.input)).toBe(0);
  });

  it('takes longer the further apart the ports are', () => {
    const arrival = (gap: number): number => {
      const b = bench();
      const { feed, chest } = route(b, gap);
      pushOntoBelt(feed, 'ironOre');
      const inputs = inputsOf(b);
      let ticks = 0;
      while (totalIn(chest.input) === 0 && ticks < 30 * 60) {
        step(b.world, inputs);
        ticks++;
      }
      return ticks * TICK_DT;
    };
    const near = arrival(4);
    const far = arrival(24);
    // Twenty more tiles is two more seconds in the pipe; the belts either side
    // are the same length, so the difference is the haul alone.
    expect(far - near).toBeGreaterThan((20 / HAUL.speed) * 0.8);
    expect(far - near).toBeLessThan((20 / HAUL.speed) * 1.3);
    expect(far).toBeGreaterThan(haulDelay(24));
  });

  it('refuses what it is fed until it has a partner, so the line backs up', () => {
    const b = bench();
    const head = at(1, 1);
    const [feed, sender] = lay(b, head.tx, head.ty, 0, ['belt', 'haul']) as [Belt, Machine];
    for (let i = 0; i < 6; i++) {
      pushOntoBelt(feed, 'ironOre');
      advance(b.world, 0.3);
    }
    advance(b.world, 5);
    expect(totalIn(sender.input)).toBe(0);
    expect(feed.items.length).toBeGreaterThan(0);
    expect(sender.stalled).toBe(true);
  });

  it('sends no faster than its rate, however full the belt behind it is', () => {
    const b = bench();
    const { feed, chest } = route(b, 6);
    const inputs = inputsOf(b);
    const seconds = 10;
    for (let i = 0; i < seconds * 30; i++) {
      pushOntoBelt(feed, 'ironOre');
      step(b.world, inputs);
    }
    const delivered = totalIn(chest.input);
    expect(delivered).toBeLessThanOrEqual(Math.ceil(HAUL.rate * seconds) + 1);
    // And it does keep up with it once the first parcels have landed, allowing for the belts either side.
    expect(delivered).toBeGreaterThan(HAUL.rate * (seconds - haulDelay(6) - 3));
  });

  it('stops taking items when the far end cannot let them out, and loses none', () => {
    const b = bench();
    const { feed, sender, receiver, out, chest } = route(b, 6);
    // Nothing downstream will ever move: the belt after the receiver is gone.
    removeAt(b.world, b.player, out.tx, out.ty);
    removeAt(b.world, b.player, chest.tx, chest.ty);
    const inputs = inputsOf(b);
    let pushed = 0;
    for (let i = 0; i < 30 * 60; i++) {
      if (pushOntoBelt(feed, 'ironOre')) pushed++;
      step(b.world, inputs);
    }
    // The receiver holds its buffer; the pipe holds the rest, and then it is full.
    const held = totalIn(receiver.output) + (sender.transit?.length ?? 0) + totalIn(sender.input) + feed.items.length;
    expect(held).toBe(pushed);
    expect(sender.transit!.length).toBeLessThanOrEqual(HAUL.capacity);
    expect(totalIn(receiver.output)).toBe(HAUL.buffer);

    // Put the line back and everything that was waiting comes out, in the order it went in.
    const belt = lay(b, out.tx, out.ty, 0, ['belt', 'chest']);
    advance(b.world, 40);
    expect(totalIn((belt[1] as Machine).input)).toBe(pushed);
  });

  it('puts a parcel back in the bag when a port is taken up mid-flight', () => {
    const b = bench();
    const { feed, sender, receiver } = route(b, 20);
    for (let i = 0; i < 4; i++) {
      pushOntoBelt(feed, 'ironOre');
      advance(b.world, 0.5);
    }
    expect(sender.transit!.length).toBeGreaterThan(0);
    const inTransit = sender.transit!.length;
    const ore = countItem(b.player, 'ironOre');

    expect(removeAt(b.world, b.player, receiver.tx, receiver.ty)).toBe(true);
    expect(countItem(b.player, 'ironOre')).toBeGreaterThanOrEqual(ore + inTransit);
    // The sender is a sender again, waiting for a new partner.
    expect(sender.link).toBeUndefined();
    expect(sender.transit).toHaveLength(0);
    expect(MACHINES[sender.type].haul).toBe('in');
  });

  it('turns a receiver into a sender when its partner is taken up, so a new port can pair with it', () => {
    const b = bench();
    const { sender, receiver } = route(b, 12);
    expect(removeAt(b.world, b.player, sender.tx, sender.ty)).toBe(true);
    expect(receiver.type).toBe('haul');
    expect(receiver.link).toBeUndefined();

    const next = placeMachine(b.world, b.player, 'haul', at(2, 5).tx, at(2, 5).ty, 0)!;
    expect(next.type).toBe('haulExit');
    expect(next.link).toBe(receiver.id);
    expect(receiver.link).toBe(next.id);
  });
});

describe('long-haul ports are earned', () => {
  it('stay locked until Long-Haul Logistics is done', () => {
    const b = bench();
    b.world.research.unlockedAll = false;
    const { tx, ty } = at(3, 3);
    expect(factoryPlacementError(b.world, b.player, 'haul', tx, ty)).toBe('locked');
    expect(placeMachine(b.world, b.player, 'haul', tx, ty, 0)).toBe(null);

    b.world.research.levels.longHaul = 1;
    expect(factoryPlacementError(b.world, b.player, 'haul', tx, ty)).toBe(null);
  });
});
