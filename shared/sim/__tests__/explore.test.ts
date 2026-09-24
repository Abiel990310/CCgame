import { describe, expect, it } from 'vitest';
import { MAP_TILES, TILE } from '../constants';
import { exploredShare, packExplored, reveal, unpackExplored } from '../explore';
import { step } from '../step';
import { addPlayer, createWorld } from '../world';

describe('a big island', () => {
  it('grows new islands at the new size and keeps old ones at theirs', () => {
    const fresh = createWorld(7);
    expect(MAP_TILES).toBe(256);
    expect(fresh.terrain.length).toBe(256 * 256);

    const old = createWorld(7, false, 1);
    expect(MAP_TILES).toBe(96);
    expect(old.terrain.length).toBe(96 * 96);
  });

  it('puts richer ore further from camp', () => {
    const world = createWorld(4242);
    const centre = MAP_TILES / 2;
    const near: number[] = [];
    const far: number[] = [];
    for (let i = 0; i < world.ore.length; i++) {
      if (!world.ore[i]) continue;
      const d = Math.hypot((i % MAP_TILES) - centre, Math.floor(i / MAP_TILES) - centre);
      (d < 40 ? near : d > 80 ? far : []).push(world.oreLeft[i]);
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(mean(far)).toBeGreaterThan(mean(near) * 1.4);
  });
});

describe('exploration', () => {
  it('starts with the camp seen and fills in where the player walks', () => {
    const world = createWorld(12345, true);
    const player = addPlayer(world, 'Scout');
    const start = exploredShare(world);
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(0.1);

    const east = new Map([[player.id, { move: { x: 1, y: 0 }, dash: false, interact: false }]]);
    for (let i = 0; i < 180; i++) step(world, east);
    expect(exploredShare(world)).toBeGreaterThan(start);
    const tx = Math.floor(player.pos.x / TILE);
    const ty = Math.floor(player.pos.y / TILE);
    expect(world.explored[ty * MAP_TILES + tx]).toBe(1);
  });

  it('packs the seen mask into text and back without losing a tile', () => {
    const world = createWorld(99);
    reveal(world, 10 * TILE, 10 * TILE, 5);
    reveal(world, 200 * TILE, 40 * TILE, 9);
    const text = packExplored(world.explored);
    expect(text.length).toBeLessThan(2000);
    expect(unpackExplored(text, world.explored.length)).toEqual(world.explored);
    // A save from before exploration has nothing to unpack.
    expect(unpackExplored('', 16).every((v) => v === 0)).toBe(true);
  });
});
