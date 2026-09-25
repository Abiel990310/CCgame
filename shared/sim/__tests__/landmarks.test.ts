import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../../data/items';
import { TILE } from '../constants';
import { oreAt } from '../ore';
import { step } from '../step';
import { isWalkable, terrainAtIndex } from '../terrain';
import type { LandmarkKind, Player, ResourceNode, World } from '../types';
import { addPlayer, createWorld } from '../world';
import { EMPTY_INPUT } from '../step';
import { stepCycle } from '../systems/cycle';

const KINDS: LandmarkKind[] = ['cache', 'ruin', 'pod', 'shrine'];
const landmarks = (world: World): ResourceNode[] =>
  world.nodes.filter((n) => (KINDS as string[]).includes(n.kind));

/** Hold interact beside a node until it is searched or the time runs out. */
function search(world: World, player: Player, node: ResourceNode, seconds = 30): void {
  player.pos = { x: node.pos.x + 20, y: node.pos.y };
  const input = new Map([[player.id, { move: { x: 0, y: 0 }, dash: false, interact: true }]]);
  for (let t = 0; t < seconds * 30 && node.charges > 0; t++) {
    player.pos = { x: node.pos.x + 20, y: node.pos.y };
    step(world, input);
  }
}

describe('landmarks', () => {
  it('scatters every kind over a new mainland, clear of water and ore', () => {
    const world = createWorld(4242);
    const found = landmarks(world);
    for (const kind of KINDS) expect(found.filter((n) => n.kind === kind).length).toBeGreaterThan(0);
    expect(found.length).toBeGreaterThan(20);
    for (const node of found) {
      const tx = Math.floor(node.pos.x / TILE);
      const ty = Math.floor(node.pos.y / TILE);
      expect(isWalkable(terrainAtIndex(world.terrain, tx, ty))).toBe(true);
      expect(oreAt(world.ore, tx, ty)).toBe(null);
    }
  });

  it('keeps the rarest finds far from camp', () => {
    const world = createWorld(4242);
    for (const node of landmarks(world).filter((n) => n.kind === 'shrine')) {
      const tiles = Math.hypot(node.pos.x - world.camp.x, node.pos.y - world.camp.y) / TILE;
      expect(tiles).toBeGreaterThanOrEqual(80);
    }
  });

  it('leaves an island grown by an older generation without any', () => {
    expect(landmarks(createWorld(4242, false, 2)).length).toBe(0);
  });

  it('spills its whole cache when searched, then is gone for good', () => {
    const world = createWorld(4242, true);
    const player = addPlayer(world, 'Scout');
    const ruin = landmarks(world).find((n) => n.kind === 'ruin')!;
    search(world, player, ruin);
    expect(ruin.charges).toBe(0);
    const spilled = world.pickups.filter((p) => p.item !== null).map((p) => p.item);
    for (const stack of RESOURCES.ruin.landmark!.cache) expect(spilled).toContain(stack.item);
    // Far from camp, the cache is bigger than the table's base amount.
    const tiles = Math.hypot(ruin.pos.x - world.camp.x, ruin.pos.y - world.camp.y) / TILE;
    const stone = world.pickups.find((p) => p.item === 'stone')!;
    if (tiles >= 48) expect(stone.count).toBeGreaterThan(RESOURCES.ruin.landmark!.cache[0].count);

    const input = new Map([[player.id, { move: { x: 0, y: 0 }, dash: false, interact: false }]]);
    for (let t = 0; t < 30 * 90; t++) step(world, input);
    expect(world.nodes).not.toContain(ruin);
  });

  it('takes longer to search than a tree takes to chop', () => {
    expect(RESOURCES.cache.landmark!.work).toBeGreaterThan(1);
  });

  it('grants a shrine finder an upgrade of their own', () => {
    const world = createWorld(4242, true);
    const player = addPlayer(world, 'Pilgrim');
    const shrine = landmarks(world).find((n) => n.kind === 'shrine')!;
    search(world, player, shrine, 60);
    expect(shrine.charges).toBe(0);
    expect(player.pendingUpgrades).toBeGreaterThanOrEqual(1);
    expect(player.offers.length).toBeGreaterThan(0);
  });

  describe('keepers', () => {
    function walkUp(kind: LandmarkKind) {
      const world = createWorld(4242);
      world.mobs.length = 0;
      const player = addPlayer(world, 'Scout');
      player.hp = player.maxHp = 1e6;
      const node = landmarks(world).find((n) => n.kind === kind)!;
      player.pos = { x: node.pos.x + 150, y: node.pos.y };
      const idle = new Map([[player.id, EMPTY_INPUT]]);
      for (let t = 0; t < 30; t++) step(world, idle);
      return { world, player, node, idle };
    }

    it('wake once when a player walks up to a far find, and not for a cache', () => {
      const { world, node, idle } = walkUp('shrine');
      const guards = RESOURCES.shrine.landmark!.guards!.reduce((n, g) => n + g.count, 0);
      expect(node.woken).toBe(true);
      expect(world.mobs.filter((m) => m.post).length).toBe(guards);
      for (let t = 0; t < 60; t++) step(world, idle);
      expect(world.mobs.filter((m) => m.post).length).toBeLessThanOrEqual(guards);
      expect(RESOURCES.cache.landmark!.guards).toBeUndefined();
    });

    it('hold their ground rather than follow a player back to camp', () => {
      const { world, player, node } = walkUp('pod');
      player.pos = { ...world.camp };
      const idle = new Map([[player.id, EMPTY_INPUT]]);
      for (let t = 0; t < 30 * 20; t++) {
        player.pos = { ...world.camp };
        step(world, idle);
      }
      for (const mob of world.mobs.filter((m) => m.post)) {
        expect(Math.hypot(mob.pos.x - node.pos.x, mob.pos.y - node.pos.y)).toBeLessThan(200);
      }
    });

    it('are still there after dawn', () => {
      const { world } = walkUp('ruin');
      const before = world.mobs.filter((m) => m.post).length;
      world.phase = 'night';
      world.phaseTime = 0;
      stepCycle(world, 0);
      expect(world.phase).toBe('day');
      expect(world.mobs.length).toBe(before);
    });

    it('never wake on a peaceful island', () => {
      const world = createWorld(4242, true);
      const player = addPlayer(world, 'Scout');
      const node = landmarks(world).find((n) => n.kind === 'shrine')!;
      player.pos = { x: node.pos.x + 60, y: node.pos.y };
      for (let t = 0; t < 30; t++) step(world, new Map([[player.id, EMPTY_INPUT]]));
      expect(world.mobs.some((m) => m.post)).toBe(false);
    });
  });
});
