import { BUILDINGS } from '../data/buildings';
import { CAMP, TILE } from './constants';
import { distance } from './math';
import { giveOrDrop, payAll, hasAll } from './inventory';
import { clearFelledNodes } from './nodes';
import { isWalkable, terrainAtIndex } from './terrain';
import type { Building, BuildingId, Player, Vec2, World } from './types';

export type PlacementError = 'range' | 'terrain' | 'overlap' | 'cost' | null;

/** Why a placement would fail, or null when it is legal. Drives the ghost preview. */
export function placementError(
  world: World,
  player: Player,
  type: BuildingId,
  pos: Vec2,
): PlacementError {
  const def = BUILDINGS[type];

  if (distance(pos, world.camp) > CAMP.buildRadius) return 'range';

  const t = terrainAtIndex(world.terrain, Math.floor(pos.x / TILE), Math.floor(pos.y / TILE));
  if (!isWalkable(t)) return 'terrain';

  for (const b of world.buildings) {
    if (distance(b.pos, pos) < def.radius + BUILDINGS[b.type].radius) return 'overlap';
  }
  for (const node of world.nodes) {
    if (node.charges > 0 && distance(node.pos, pos) < def.radius + 14) return 'overlap';
  }

  if (!hasAll(player, def.cost)) return 'cost';
  return null;
}

export function placeBuilding(
  world: World,
  player: Player,
  type: BuildingId,
  pos: Vec2,
): boolean {
  if (placementError(world, player, type, pos) !== null) return false;
  if (!payAll(player, BUILDINGS[type].cost)) return false;

  world.buildings.push({
    id: world.nextId++,
    type,
    // Walls take chip damage from mobs; level doubles as their hit points.
    level: type === 'wall' ? 4 : 1,
    pos: { ...pos },
  });
  world.events.push({ kind: 'built', pos: { ...pos }, type });
  clearFelledNodes(world);
  return true;
}

/** The camp piece under a point, nearest first — what a click is pointing at. */
export function buildingAt(world: World, pos: Vec2): Building | null {
  let best: Building | null = null;
  let bestDist = Infinity;

  for (const b of world.buildings) {
    const d = distance(b.pos, pos);
    // A little slack, so clicking the edge of a wall still counts as clicking it.
    if (d > BUILDINGS[b.type].radius + 4 || d >= bestDist) continue;
    best = b;
    bestDist = d;
  }
  return best;
}

export type RemovalResult = 'removed' | 'campfire' | 'none';

/** Take a camp piece back down, refunding what it cost to put up. */
export function removeBuildingAt(world: World, player: Player, pos: Vec2): RemovalResult {
  const target = buildingAt(world, pos);
  if (!target) return 'none';
  // The campfire is what the camp is; mobs path to it and the island is built
  // around it, so it is the one piece that does not come back down.
  if (target.type === 'campfire') return 'campfire';

  world.buildings.splice(world.buildings.indexOf(target), 1);
  world.events.push({ kind: 'removed', pos: { ...target.pos } });
  for (const entry of BUILDINGS[target.type].cost) {
    giveOrDrop(world, player, entry.id, entry.count);
  }
  return 'removed';
}
