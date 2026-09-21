import { BUILDINGS } from '../data/buildings';
import { RESOURCES } from '../data/items';
import { TILE } from './constants';
import { tileKey } from './grid';
import type { ResourceNode, World } from './types';

/** The scenery standing on a tile — what you have to clear before building there. */
export function nodeOnTile(world: World, tx: number, ty: number): ResourceNode | null {
  for (const node of world.nodes) {
    if (node.charges <= 0) continue;
    if (Math.floor(node.pos.x / TILE) === tx && Math.floor(node.pos.y / TILE) === ty) return node;
  }
  return null;
}

/** True once the player has built where this node grew, so it has nowhere to return to. */
export function nodeSpotTaken(world: World, node: ResourceNode): boolean {
  const tx = Math.floor(node.pos.x / TILE);
  const ty = Math.floor(node.pos.y / TILE);
  if (world.grid.has(tileKey(tx, ty))) return true;

  const radius = RESOURCES[node.kind].radius;
  for (const building of world.buildings) {
    const reach = BUILDINGS[building.type].radius + radius;
    if (Math.hypot(building.pos.x - node.pos.x, building.pos.y - node.pos.y) < reach) return true;
  }
  return false;
}

/**
 * Drop the stumps of nodes that have just been built over. Land you cleared and
 * built on is yours: nothing grows back through a belt or a wall.
 */
export function clearFelledNodes(world: World): void {
  for (let i = world.nodes.length - 1; i >= 0; i--) {
    const node = world.nodes[i];
    if (node.charges <= 0 && nodeSpotTaken(world, node)) world.nodes.splice(i, 1);
  }
}
