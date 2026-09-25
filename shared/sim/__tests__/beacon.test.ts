import { describe, expect, it } from 'vitest';
import { BEACON_BOOST, BEACON_BURN_SECONDS, BEACON_FUEL_CAP, BEACON_LIT, BEACON_STAGES, BEACON_WARD_PACE, BEACON_WARD_TILES, BEACON_XP } from '../../data/beacon';
import { GOAL_BY_ID } from '../../data/goals';
import { beaconBurning, beaconStage, withBeacon } from '../beacon';
import { researchBonuses } from '../research';
import { tileCenter } from '../grid';
import { TILE } from '../constants';
import { spawnMob, stepMobs } from '../systems/mobs';
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

describe('a lit beacon', () => {
  function lit(b: Bench): Machine {
    const m = beacon(b);
    m.recipe = BEACON_LIT;
    return m;
  }

  it('stays banked until it is fed, then burns a processor a minute', () => {
    const b = bench();
    const m = lit(b);
    advance(b.world, 1);
    expect(beaconBurning(m)).toBe(false);
    fill(m.input, 'processor', 3);
    advance(b.world, 1);
    expect(beaconBurning(m)).toBe(true);
    expect(countIn(m.input, 'processor')).toBe(2);
    advance(b.world, BEACON_BURN_SECONDS * 3);
    expect(countIn(m.input, 'processor')).toBe(0);
    expect(beaconBurning(m)).toBe(false);
  });

  it('speeds every machine on the island while it burns', () => {
    const b = bench();
    const m = lit(b);
    const plain = researchBonuses(b.world);
    expect(withBeacon(b.world, plain).crafting).toBe(plain.crafting);
    m.progress = 10;
    const boosted = withBeacon(b.world, plain);
    expect(boosted.crafting).toBeCloseTo(plain.crafting + BEACON_BOOST, 6);
    expect(boosted.mining).toBeCloseTo(plain.mining + BEACON_BOOST, 6);
    expect(boosted.lab).toBeCloseTo(plain.lab + BEACON_BOOST, 6);
  });

  it('takes processors by hand up to its reserve, and nothing else', () => {
    const b = bench();
    const m = lit(b);
    b.player.cursor = { id: 'processor', count: 50 };
    expect(clickSlot(b.world, b.player, m.id, { area: 'input', index: 0 })).toBe(true);
    expect(countIn(m.input, 'processor')).toBe(BEACON_FUEL_CAP);
    b.player.cursor = { id: 'steelPlate', count: 5 };
    expect(clickSlot(b.world, b.player, m.id, { area: 'input', index: 1 })).toBe(false);
  });

  it('slows creatures inside its ward while it burns, and only there', () => {
    // How far a slime walks in two seconds from a spot beside the beacon.
    function walked(burning: boolean, tilesOut: number): number {
      const b = bench();
      const m = lit(b);
      m.progress = burning ? 1000 : 0;
      const c = tileCenter(m.tx, m.ty);
      const mob = spawnMob(b.world, 'slime', { x: c.x, y: c.y + TILE * tilesOut });
      const start = { ...mob.pos };
      for (let i = 0; i < 20; i++) stepMobs(b.world, 0.1);
      return Math.hypot(mob.pos.x - start.x, mob.pos.y - start.y);
    }
    const inside = BEACON_WARD_TILES / 3;
    const free = walked(false, inside);
    expect(free).toBeGreaterThan(TILE);
    // Not exact: velocity eases toward the new pace rather than snapping to it.
    const slowed = walked(true, inside) / free;
    expect(slowed).toBeGreaterThan(BEACON_WARD_PACE - 0.1);
    expect(slowed).toBeLessThan(BEACON_WARD_PACE + 0.15);
    const outside = BEACON_WARD_TILES * 3;
    expect(walked(true, outside)).toBeCloseTo(walked(false, outside), 3);
  });
});
