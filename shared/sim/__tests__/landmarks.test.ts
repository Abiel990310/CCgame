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
import { damageMob } from '../systems/combat';
import { landmarksLeft } from '../nodes';
import { decode, encode, restoreSnapshot, takeSnapshot, type Snapshot } from '../snapshot';

const KINDS: LandmarkKind[] = ['cache', 'ruin', 'pod', 'shrine', 'vein'];
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

  it('grows ore veins only on generation 4, leaving generation 3 exactly as it was', () => {
    const three = landmarks(createWorld(4242, false, 3));
    const four = landmarks(createWorld(4242, false, 4));
    expect(three.some((n) => n.kind === 'vein')).toBe(false);
    expect(four.filter((n) => n.kind === 'vein').length).toBeGreaterThan(0);
    // Everything generation 3 placed is still where it was, by id and place.
    const by = new Map(four.map((n) => [n.id, n]));
    for (const n of three) expect(by.get(n.id)?.pos).toEqual(n.pos);
  });

  describe('counting', () => {
    it('starts at none searched and counts each search', () => {
      const world = createWorld(4242, true);
      expect(world.searched).toBe(0);
      const player = addPlayer(world, 'Scout');
      const [a, b] = landmarks(world).filter((n) => n.kind === 'cache');
      search(world, player, a);
      expect(world.searched).toBe(1);
      search(world, player, b);
      expect(world.searched).toBe(2);
    });

    it('rides in a snapshot so a guest reads the same tally', () => {
      const world = createWorld(4242, true);
      world.searched = 5;
      expect(restoreSnapshot(decode<Snapshot>(encode(takeSnapshot(world)))).searched).toBe(5);
      const old = takeSnapshot(world) as Partial<Snapshot>;
      delete old.searched;
      expect(restoreSnapshot(old as Snapshot).searched).toBe(0);
    });

    it('lets landmarksLeft and searched add up to what the island grew', () => {
      const world = createWorld(4242, true);
      const total = landmarksLeft(world.nodes);
      const player = addPlayer(world, 'Scout');
      search(world, player, landmarks(world).find((n) => n.kind === 'cache')!);
      expect(world.searched + landmarksLeft(world.nodes)).toBe(total);
    });
  });

  describe('the ore vein', () => {
    it('spills raw ore and is guarded by a nest that holds its ground', () => {
      const def = RESOURCES.vein.landmark!;
      expect(def.cache.map((s) => s.item)).toEqual(expect.arrayContaining(['ironOre', 'copperOre', 'coal']));
      expect(def.guards!.some((g) => g.type === 'mother')).toBe(true);

      const world = createWorld(4242);
      world.mobs.length = 0;
      const player = addPlayer(world, 'Scout');
      player.hp = player.maxHp = 1e6;
      const vein = landmarks(world).find((n) => n.kind === 'vein')!;
      player.pos = { x: vein.pos.x + 150, y: vein.pos.y };
      const idle = new Map([[player.id, EMPTY_INPUT]]);
      for (let t = 0; t < 30; t++) step(world, idle);
      const mother = world.mobs.find((m) => m.type === 'mother')!;
      expect(mother.post).toBeDefined();

      // When she falls her brood keeps the nest rather than marching on camp.
      damageMob(world, mother, 1e6, player.id);
      const brood = world.mobs.filter((m) => m.type === 'slime');
      expect(brood.length).toBeGreaterThan(0);
      for (const slime of brood) expect(slime.post).toEqual(mother.post);
    });
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
