import { describe, expect, it } from 'vitest';
import { BEACON_LIT, BEACON_STAGES, BEACON_XP } from '../../data/beacon';
import { GOAL_BY_ID } from '../../data/goals';
import { beaconStage } from '../beacon';
import { clickSlot, quickMove } from '../containers';
import { countIn } from '../slots';
import type { Machine } from '../types';
import { advance, at, bench, fill, put, type Bench } from './bench';

function beacon(b: Bench): Machine {
  const spot = at(4, 3);
  return put(b, 'beacon', spot.tx, spot.ty, 0) as Machine;
}

/** Hands the beacon exactly what its current stage needs, as a belt would. */
function feedStage(machine: Machine): void {
  for (const need of beaconStage(machine)!.stage.needs) fill(machine.input, need.id, need.count);
}

describe('beacon stages', () => {
  it('raises each stage in turn and lights at the end', () => {
    const b = bench();
    const m = beacon(b);
    advance(b.world, 0.2);
    expect(m.recipe).toBe(BEACON_STAGES[0].id);
    expect(m.stalled).toBe(true);

    const xp = b.player.xp;
    const level = b.player.level;
    for (let i = 0; i < BEACON_STAGES.length; i++) {
      expect(beaconStage(m)!.index).toBe(i);
      feedStage(m);
      advance(b.world, 0.2);
    }
    expect(m.recipe).toBe(BEACON_LIT);
    expect(m.input.every((s) => s === null)).toBe(true);
    expect(b.player.level > level || b.player.xp >= xp + BEACON_XP * 0.5).toBe(true);
    expect(GOAL_BY_ID.get('beaconLit')!.have(b.world, b.player)).toBe(1);
  });

  it('takes from an arm only what the stage still needs', () => {
    const b = bench();
    const m = beacon(b);
    const arm = at(3, 3);
    // Facing right, it lifts out of the chest behind it into the beacon.
    put(b, 'inserter', arm.tx, arm.ty, 0);
    const chestAt = at(2, 3);
    const chest = put(b, 'chest', chestAt.tx, chestAt.ty, 0) as Machine;
    fill(chest.input, 'steelPlate', 400);
    fill(chest.input, 'gear', 50);
    advance(b.world, 200);
    expect(countIn(m.input, 'steelPlate')).toBe(150);
    expect(countIn(m.input, 'gear')).toBe(0);
    expect(m.recipe).toBe(BEACON_STAGES[0].id);
  });

  it('keeps a whole stack handed in to what the stage needs', () => {
    const b = bench();
    const m = beacon(b);
    advance(b.world, 0.1);
    const bag = b.player.inventory;
    bag.fill(null);
    bag[0] = { id: 'pipe', count: 300 };
    expect(quickMove(b.world, b.player, m.id, { area: 'bag', index: 0 })).toBe(true);
    expect(countIn(m.input, 'pipe')).toBe(100);
    expect(bag[0]?.count).toBe(200);

    // By cursor: the rest stays in hand.
    b.player.cursor = { id: 'steelPlate', count: 500 };
    expect(clickSlot(b.world, b.player, m.id, { area: 'input', index: 1 })).toBe(true);
    expect(countIn(m.input, 'steelPlate')).toBe(150);
    expect(b.player.cursor?.count).toBe(350);

    // Something no stage wants is refused outright.
    b.player.cursor = { id: 'gear', count: 5 };
    expect(clickSlot(b.world, b.player, m.id, { area: 'input', index: 2 })).toBe(false);
  });
});
