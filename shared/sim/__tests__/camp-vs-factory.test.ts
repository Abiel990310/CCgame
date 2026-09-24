import { describe, expect, it } from 'vitest';
import { placeBuilding, placementError } from '../building';
import { factoryPlacementError, placeBelt } from '../factory';
import { tileCenter, tileKey } from '../grid';
import { TERRAIN_ORDER } from '../terrain';
import { MAP_TILES } from '../constants';
import { bench, type Bench } from './bench';

/**
 * The camp and the factory only meet inside the camp's build radius, and the
 * bench sits deliberately clear of it, so these tests flatten their own patch
 * around the campfire instead.
 */
// Read once a world exists: each island sets its own size.
const campTile = (): number => MAP_TILES / 2;

function campBench(): Bench {
  const b = bench();
  const grass = TERRAIN_ORDER.indexOf('grass');

  for (let ty = campTile() - 2; ty <= campTile() + 2; ty++) {
    for (let tx = campTile() - 4; tx <= campTile() + 4; tx++) {
      b.world.terrain[tileKey(tx, ty)] = grass;
      b.world.ore[tileKey(tx, ty)] = 0;
    }
  }
  return b;
}

describe('camp pieces against the factory grid', () => {
  it('refuses to run a belt through a wall', () => {
    const b = campBench();
    const tx = campTile() - 2;
    const ty = campTile();
    expect(placeBuilding(b.world, b.player, 'wall', tileCenter(tx, ty))).toBe(true);

    expect(factoryPlacementError(b.world, b.player, 'belt', tx, ty)).toBe('camp');
    expect(placeBelt(b.world, b.player, tx, ty, 0)).toBe(null);
  });

  it('leaves the tile beside a wall buildable', () => {
    const b = campBench();
    const ty = campTile();
    expect(placeBuilding(b.world, b.player, 'wall', tileCenter(campTile() - 2, ty))).toBe(true);

    expect(factoryPlacementError(b.world, b.player, 'belt', campTile() - 3, ty)).toBe(null);
    expect(placeBelt(b.world, b.player, campTile() - 3, ty, 0)).not.toBe(null);
  });

  it('blocks the tiles the campfire stands on, not the ring it grazes', () => {
    const b = campBench();
    const err = (tx: number, ty: number) =>
      factoryPlacementError(b.world, b.player, 'belt', tx, ty);

    // The campfire sits on the map's exact centre, which is a tile corner, so
    // it really does stand on all four tiles that meet there.
    expect(err(campTile(), campTile())).toBe('camp');
    expect(err(campTile() - 1, campTile() - 1)).toBe('camp');
    // A tile further out is only grazed by its radius and stays buildable.
    expect(err(campTile() + 1, campTile())).toBe(null);
    expect(err(campTile() - 2, campTile())).toBe(null);
  });

  it('refuses to drop a wall on top of a belt', () => {
    const b = campBench();
    const tx = campTile() - 2;
    const ty = campTile();
    expect(placeBelt(b.world, b.player, tx, ty, 0)).not.toBe(null);

    expect(placementError(b.world, b.player, 'wall', tileCenter(tx, ty))).toBe('factory');
    expect(placeBuilding(b.world, b.player, 'wall', tileCenter(tx, ty))).toBe(false);
  });

  it('leaves the tile beside a belt open to the camp', () => {
    const b = campBench();
    const ty = campTile();
    expect(placeBelt(b.world, b.player, campTile() - 2, ty, 0)).not.toBe(null);

    const beside = tileCenter(campTile() - 3, ty);
    expect(placementError(b.world, b.player, 'wall', beside)).toBe(null);
    expect(placeBuilding(b.world, b.player, 'wall', beside)).toBe(true);
  });
});
