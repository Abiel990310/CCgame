import { RESOURCES } from '../../data/items';
import { GATHER, PLAYER, TILE } from '../constants';
import { distanceSq } from '../math';
import { toolSpeed } from '../crafting';
import { nodeSpotTaken } from '../nodes';
import { nextFloat, rollOffers } from '../progression';
import { perk } from '../perks';
import { researchBonuses } from '../research';
import type { ItemId, Player, PlayerInput, ResourceKind, ResourceNode, World } from '../types';

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

/** The perk that speeds up each kind of harvest; bushes have none. */
const KNACK: Record<ResourceKind, string> = {
  tree: 'lumberjack',
  rock: 'prospector',
  fish: 'angler',
  bush: '',
  cache: '',
  ruin: '',
  pod: '',
  shrine: '',
};

/** Tiles from camp per extra half of a landmark's cache: the far ones pay for the walk. */
const LANDMARK_REACH = 48;

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
  const research = researchBonuses(world).gather;
  const knack = 1 + 0.4 * perk(player, KNACK[target.kind]);
  const work = RESOURCES[target.kind].landmark?.work ?? 1;
  player.gatherProgress += (dt / GATHER.baseSeconds / work) * player.stats.gatherSpeed * tool * research * knack;
  if (player.gatherProgress < 1) return;

  player.gatherProgress -= 1;
  target.charges -= 1;
  if (target.charges <= 0) target.regrow = GATHER.regrowSeconds;

  const def = RESOURCES[target.kind];
  if (def.landmark) {
    searchLandmark(world, player, target);
    return;
  }
  const drop = rollDrop(world, target.kind);
  // Only rolled for a player who has the perk, so nobody else's RNG stream moves.
  const forager = perk(player, 'forager');
  const count = forager > 0 && nextFloat(world) < 0.15 * forager ? drop.count * 2 : drop.count;

  world.pickups.push({
    id: world.nextId++,
    pos: { ...target.pos },
    vel: {
      x: (nextFloat(world) - 0.5) * 110,
      y: (nextFloat(world) - 0.5) * 110,
    },
    item: drop.item,
    count,
    xp: def.xp,
    settle: 0.35,
  });

  world.events.push({ kind: 'gathered', pos: { ...target.pos }, item: drop.item });
}

/**
 * A searched landmark spills everything it held at once and is gone for good.
 * The cache grows with the distance from camp, so the far coast is worth it.
 */
function searchLandmark(world: World, player: Player, node: ResourceNode): void {
  const def = RESOURCES[node.kind];
  const { cache, boon } = def.landmark!;
  const tiles = Math.hypot(node.pos.x - world.camp.x, node.pos.y - world.camp.y) / TILE;
  const scale = 1 + Math.floor(tiles / LANDMARK_REACH) * 0.5;

  cache.forEach((stack, i) => {
    const angle = (i / cache.length) * Math.PI * 2 + nextFloat(world);
    world.pickups.push({
      id: world.nextId++,
      pos: { ...node.pos },
      vel: { x: Math.cos(angle) * 150, y: Math.sin(angle) * 150 },
      item: stack.item,
      count: Math.round(stack.count * scale),
      // The search's XP rides on the first stack, so it is paid once.
      xp: i === 0 ? def.xp : 0,
      settle: 0.4,
    });
  });
  if (boon === 'upgrade') {
    player.pendingUpgrades += 1;
    if (player.offers.length === 0) player.offers = rollOffers(world, player);
  }
  world.events.push({ kind: 'landmark', pos: { ...node.pos }, landmark: node.kind, playerId: player.id });
}

export function stepNodeRegrowth(world: World, dt: number): void {
  for (let i = world.nodes.length - 1; i >= 0; i--) {
    const node = world.nodes[i];
    if (node.charges > 0) continue;
    // A searched landmark is spent, not resting.
    if (RESOURCES[node.kind].landmark) {
      world.nodes.splice(i, 1);
      continue;
    }

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
