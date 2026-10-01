import { describe, expect, it } from 'vitest';
import { DASH, PLAYER } from '../constants';
import { BAG_ROW, INVENTORY_SLOTS, carrySlots } from '../inventory';
import { researchBonuses } from '../research';
import { step } from '../step';
import { addPlayer, createWorld } from '../world';
import { advance, bench } from './bench';

describe('techs that better the islander', () => {
  it('reaches farther for a drop with Magnetism', () => {
    const reachOf = (levels: Record<string, number>): number => {
      const world = createWorld(41);
      const player = addPlayer(world, 'test');
      Object.assign(world.research.levels, levels);
      // Just outside the base reach: only the tech can bring it in.
      const gap = PLAYER.pickupRadius * 1.2;
      world.pickups.push({
        id: 900,
        pos: { x: player.pos.x + gap, y: player.pos.y },
        vel: { x: 0, y: 0 },
        item: 'wood',
        count: 1,
        xp: 0,
        settle: 0,
      });
      advance(world, 1);
      return world.pickups.length;
    };
    expect(reachOf({})).toBe(1);
    expect(reachOf({ magnetism: 1 })).toBe(0);
  });

  it('recharges the dash sooner with Footwork', () => {
    const cooldown = (levels: Record<string, number>): number => {
      const { world, player } = bench();
      Object.assign(world.research.levels, levels);
      player.dashCd = 0;
      step(world, new Map([[player.id, { move: { x: 1, y: 0 }, dash: true, interact: false }]]));
      return player.dashCd;
    };
    const base = cooldown({});
    expect(base).toBeCloseTo(DASH.cooldown, 1);
    expect(cooldown({ footwork: 1 })).toBeCloseTo(base / 1.25, 1);
  });

  describe('Pack Frames and Load-Bearing Harness', () => {
    it('add a row of eight each to every islander, new ones too', () => {
      const world = createWorld(41);
      const first = addPlayer(world, 'one');
      expect(first.inventory).toHaveLength(INVENTORY_SLOTS);

      world.research.levels.packFrames = 1;
      world.research.levels.loadBearing = 1;
      expect(researchBonuses(world).carry).toBe(2);
      expect(carrySlots(world, first)).toBe(INVENTORY_SLOTS + 2 * BAG_ROW);

      const joiner = addPlayer(world, 'two');
      advance(world, 0.1);
      expect(first.inventory).toHaveLength(INVENTORY_SLOTS + 2 * BAG_ROW);
      expect(joiner.inventory).toHaveLength(INVENTORY_SLOTS + 2 * BAG_ROW);
    });

    it('keep a stack where the player put it, and stack with a sewn-on bag', () => {
      const world = createWorld(41);
      const player = addPlayer(world, 'one');
      player.inventory[5] = { id: 'wood', count: 7 };
      player.bag = 1;
      world.research.levels.packFrames = 1;
      advance(world, 0.1);
      expect(player.inventory).toHaveLength(INVENTORY_SLOTS + 2 * BAG_ROW);
      expect(player.inventory[5]).toEqual({ id: 'wood', count: 7 });
      expect(player.inventory.slice(INVENTORY_SLOTS).every((s) => s === null)).toBe(true);
    });
  });
});
