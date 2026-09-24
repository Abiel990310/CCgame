import { RESOURCES } from '../../data/items';
import { GATHER, PLAYER } from '../constants';
import { distanceSq } from '../math';
import { toolSpeed } from '../crafting';
import { nodeSpotTaken } from '../nodes';
import { nextFloat } from '../progression';
import type { ItemId, Player, PlayerInput, ResourceNode, World } from '../types';

export function findNearestNode(world: World, player: Player): ResourceNode | null {
  const reach = PLAYER.interactRadius;
  let best: ResourceNode | null = null;
  let bestDist = reach * reach;

  for (const node of world.nodes) {
    if (node.charges <= 0) continue;
    const def = RESOURCES[node.kind];
    const d = distanceSq(node.pos, player.pos);
    const limit = (reach + def.radius) * (reach + def.radius);
    if (d < limit && d < bestDist) {
      best = node;
      bestDist = d;
    }
  }
  return best;
}

/** One pick from a node's weighted drop table. A fish trap rolls the same one. */
export function rollDrop(world: World, kind: ResourceNode['kind']): { item: ItemId; count: number } {
  const drops = RESOURCES[kind].drops;
  const total = drops.reduce((sum, d) => sum + d.weight, 0);
  let roll = nextFloat(world) * total;
  for (const drop of drops) {
    roll -= drop.weight;
    if (roll <= 0) return { item: drop.item, count: drop.count };
  }
  const fallback = drops[0];
  return { item: fallback.item, count: fallback.count };
}

export function stepGathering(
  world: World,
  player: Player,
  input: PlayerInput,
  dt: number,
): void {
  const target = input.interact ? findNearestNode(world, player) : null;

  if (!target) {
    player.gatherNodeId = null;
    player.gatherProgress = 0;
    return;
  }

  // Switching nodes restarts progress, so you cannot chip away at everything.
  if (player.gatherNodeId !== target.id) {
    player.gatherNodeId = target.id;
    player.gatherProgress = 0;
  }

  const tool = toolSpeed(player, RESOURCES[target.kind].tool);
  player.gatherProgress += (dt / GATHER.baseSeconds) * player.stats.gatherSpeed * tool;
  if (player.gatherProgress < 1) return;

  player.gatherProgress -= 1;
  target.charges -= 1;
  if (target.charges <= 0) target.regrow = GATHER.regrowSeconds;

  const def = RESOURCES[target.kind];
  const drop = rollDrop(world, target.kind);

  world.pickups.push({
    id: world.nextId++,
    pos: { ...target.pos },
    vel: {
      x: (nextFloat(world) - 0.5) * 110,
      y: (nextFloat(world) - 0.5) * 110,
    },
    item: drop.item,
    count: drop.count,
    xp: def.xp,
    settle: 0.35,
  });

  world.events.push({ kind: 'gathered', pos: { ...target.pos }, item: drop.item });
}

export function stepNodeRegrowth(world: World, dt: number): void {
  for (let i = world.nodes.length - 1; i >= 0; i--) {
    const node = world.nodes[i];
    if (node.charges > 0) continue;

    node.regrow -= dt;
    if (node.regrow > 0) continue;

    // Nothing grows back through a base. A stump the player has built over is
    // land they cleared, so it goes for good instead of sprouting in the way.
    if (nodeSpotTaken(world, node)) {
      world.nodes.splice(i, 1);
      continue;
    }
    node.charges = node.maxCharges;
  }
}
