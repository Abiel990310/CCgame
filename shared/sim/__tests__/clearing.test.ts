import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../data/buildings';
import { RESOURCES } from '../../data/items';
import { GATHER, TILE } from '../constants';
import { buildingAt, placeBuilding, removeBuildingAt } from '../building';
import { factoryPlacementError, placeBelt } from '../factory';
import { countItem } from '../inventory';
import type { ResourceKind, World } from '../types';
import { advance, at, bench, type Bench } from './bench';

/** Plant scenery in the middle of a bench tile, the way world generation does. */
function plant(world: World, kind: ResourceKind, tx: number, ty: number): void {
  world.nodes.push({
    id: world.nextId++,
    kind,
    pos: { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE },
    seed: 1,
    charges: RESOURCES[kind].charges,
    maxCharges: RESOURCES[kind].charges,
    regrow: 0,
  });
}

/** Chop it flat, as a player holding interact eventually does. */
function chop(world: World, nodeId: number): void {
  const node = world.nodes.find((n) => n.id === nodeId)!;
  node.charges = 0;
  node.regrow = GATHER.regrowSeconds;
}

function nodeCount(b: Bench): number {
  return b.world.nodes.length;
}

describe('building over scenery', () => {
  it('refuses to bury a standing tree under a belt', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    plant(b.world, 'tree', tx, ty);

    expect(factoryPlacementError(b.world, b.player, 'belt', tx, ty)).toBe('scenery');
    expect(placeBelt(b.world, b.player, tx, ty, 0)).toBe(null);
  });

  it('lets you build once the tree is chopped', () => {
    const b = bench();
    const { tx, ty } = at(2, 2);
    plant(b.world, 'tree', tx, ty);
    chop(b.world, b.world.nodes[b.world.nodes.length - 1].id);

    expect(factoryPlacementError(b.world, b.player, 'belt', tx, ty)).toBe(null);
    expect(placeBelt(b.world, b.player, tx, ty, 0)).not.toBe(null);
  });
});

describe('regrowth', () => {
  it('regrows a chopped node in open ground', () => {
    const b = bench();
    const { tx, ty } = at(4, 2);
    plant(b.world, 'tree', tx, ty);
    const node = b.world.nodes[b.world.nodes.length - 1];
    chop(b.world, node.id);

    advance(b.world, GATHER.regrowSeconds + 1);

    expect(b.world.nodes.find((n) => n.id === node.id)?.charges).toBe(node.maxCharges);
  });

  it('never regrows through a belt built on its spot', () => {
    const b = bench();
    const { tx, ty } = at(5, 2);
    plant(b.world, 'tree', tx, ty);
    const node = b.world.nodes[b.world.nodes.length - 1];
    chop(b.world, node.id);
    expect(placeBelt(b.world, b.player, tx, ty, 0)).not.toBe(null);

    advance(b.world, GATHER.regrowSeconds + 1);

    expect(b.world.nodes.find((n) => n.id === node.id)).toBe(undefined);
    expect(b.world.belts.length).toBe(1);
  });

  it('never regrows through a camp building standing over it', () => {
    const b = bench();
    const pos = { ...b.world.camp, x: b.world.camp.x + 60 };
    plant(b.world, 'bush', Math.floor(pos.x / TILE), Math.floor(pos.y / TILE));
    const node = b.world.nodes[b.world.nodes.length - 1];
    node.pos = { ...pos };
    chop(b.world, node.id);

    expect(placeBuilding(b.world, b.player, 'wall', pos)).toBe(true);
    advance(b.world, GATHER.regrowSeconds + 1);

    expect(b.world.nodes.find((n) => n.id === node.id)).toBe(undefined);
  });

  it('leaves scenery elsewhere on the island alone', () => {
    const b = bench();
    const before = nodeCount(b);
    const { tx, ty } = at(6, 2);
    plant(b.world, 'tree', tx, ty);
    chop(b.world, b.world.nodes[b.world.nodes.length - 1].id);
    placeBelt(b.world, b.player, tx, ty, 0);

    advance(b.world, GATHER.regrowSeconds + 1);

    // Only the stump under the belt goes; the island keeps everything else.
    expect(nodeCount(b)).toBe(before);
  });
});

describe('removing camp buildings', () => {
  it('takes a wall back down and refunds it', () => {
    const b = bench();
    const pos = { x: b.world.camp.x + 70, y: b.world.camp.y };
    const wood = countItem(b.player, 'wood');

    expect(placeBuilding(b.world, b.player, 'wall', pos)).toBe(true);
    expect(countItem(b.player, 'wood')).toBeLessThan(wood);

    expect(removeBuildingAt(b.world, b.player, pos)).toBe('removed');
    expect(buildingAt(b.world, pos)).toBe(null);
    expect(countItem(b.player, 'wood')).toBe(wood);
  });

  it('finds the piece from anywhere within it, not just dead centre', () => {
    const b = bench();
    const pos = { x: b.world.camp.x + 70, y: b.world.camp.y };
    placeBuilding(b.world, b.player, 'wall', pos);

    const edge = { x: pos.x + BUILDINGS.wall.radius - 1, y: pos.y };
    expect(removeBuildingAt(b.world, b.player, edge)).toBe('removed');
  });

  it('keeps the campfire, which the camp is built around', () => {
    const b = bench();
    expect(removeBuildingAt(b.world, b.player, b.world.camp)).toBe('campfire');
    expect(b.world.buildings.some((x) => x.type === 'campfire')).toBe(true);
  });

  it('says nothing is there when the cursor is over empty grass', () => {
    const b = bench();
    const empty = { x: b.world.camp.x + 200, y: b.world.camp.y + 200 };
    expect(removeBuildingAt(b.world, b.player, empty)).toBe('none');
  });
});
