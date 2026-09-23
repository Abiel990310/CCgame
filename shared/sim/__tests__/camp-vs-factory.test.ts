import { describe, expect, it } from 'vitest';
import { placeBuilding, placementError } from '../building';
import { factoryPlacementError, placeBelt } from '../factory';
import { tileCenter, tileKey } from '../grid';
import { TERRAIN_ORDER } from '../terrain';
import { bench, type Bench } from './bench';

/**
 * The camp and the factory only meet inside the camp's build radius, and the
 * bench sits deliberately clear of it, so these tests flatten their own patch
 * around the campfire instead.
 */
const CAMP_TILE = 48;

function campBench(): Bench {
  const b = bench();
  const grass = TERRAIN_ORDER.indexOf('grass');

  for (let ty = CAMP_TILE - 2; ty <= CAMP_TILE + 2; ty++) {
    for (let tx = CAMP_TILE - 4; tx <= CAMP_TILE + 4; tx++) {
      b.world.terrain[tileKey(tx, ty)] = grass;
      b.world.ore[tileKey(tx, ty)] = 0;
    }
  }
  return b;
}

describe('camp pieces against the factory grid', () => {
  it('refuses to run a belt through a wall', () => {
    const b = campBench();
    const tx = CAMP_TILE - 2;
    const ty = CAMP_TILE;
    expect(placeBuilding(b.world, b.player, 'wall', tileCenter(tx, ty))).toBe(true);

    expect(factoryPlacementError(b.world, b.player, 'belt', tx, ty)).toBe('camp');
    expect(placeBelt(b.world, b.player, tx, ty, 0)).toBe(null);
  });

  it('leaves the tile beside a wall buildable', () => {
    const b = campBench();
    const ty = CAMP_TILE;
    expect(placeBuilding(b.world, b.player, 'wall', tileCenter(CAMP_TILE - 2, ty))).toBe(true);

    expect(factoryPlacementError(b.world, b.player, 'belt', CAMP_TILE - 3, ty)).toBe(null);
    expect(placeBelt(b.world, b.player, CAMP_TILE - 3, ty, 0)).not.toBe(null);
  });

  it('blocks the tiles the campfire stands on, not the ring it grazes', () => {
    const b = campBench();
    const err = (tx: number, ty: number) =>
      factoryPlacementError(b.world, b.player, 'belt', tx, ty);

    // The campfire sits on the map's exact centre, which is a tile corner, so
    // it really does stand on all four tiles that meet there.
    expect(err(CAMP_TILE, CAMP_TILE)).toBe('camp');
    expect(err(CAMP_TILE - 1, CAMP_TILE - 1)).toBe('camp');
    // A tile further out is only grazed by its radius and stays buildable.
    expect(err(CAMP_TILE + 1, CAMP_TILE)).toBe(null);
    expect(err(CAMP_TILE - 2, CAMP_TILE)).toBe(null);
  });

  it('refuses to drop a wall on top of a belt', () => {
    const b = campBench();
    const tx = CAMP_TILE - 2;
    const ty = CAMP_TILE;
    expect(placeBelt(b.world, b.player, tx, ty, 0)).not.toBe(null);

    expect(placementError(b.world, b.player, 'wall', tileCenter(tx, ty))).toBe('factory');
    expect(placeBuilding(b.world, b.player, 'wall', tileCenter(tx, ty))).toBe(false);
  });

  it('leaves the tile beside a belt open to the camp', () => {
    const b = campBench();
    const ty = CAMP_TILE;
    expect(placeBelt(b.world, b.player, CAMP_TILE - 2, ty, 0)).not.toBe(null);

    const beside = tileCenter(CAMP_TILE - 3, ty);
    expect(placementError(b.world, b.player, 'wall', beside)).toBe(null);
    expect(placeBuilding(b.world, b.player, 'wall', beside)).toBe(true);
  });
});
