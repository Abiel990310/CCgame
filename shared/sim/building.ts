import { BUILDINGS } from '../data/buildings';
import { CAMP, TILE } from './constants';
import { distance } from './math';
import { payAll, hasAll } from './inventory';
import { isWalkable, terrainAtIndex } from './terrain';
import type { BuildingId, Player, Vec2, World } from './types';

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
  return true;
}
