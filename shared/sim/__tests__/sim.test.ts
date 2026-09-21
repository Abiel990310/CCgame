import { describe, expect, it } from 'vitest';
import { CYCLE, MAP_TILES, PLAYER, TICK_DT } from '../constants';
import { addItem, countItem, removeItem, INVENTORY_SLOTS } from '../inventory';
import { chooseUpgrade, grantXp, xpForLevel } from '../progression';
import { EMPTY_INPUT, step } from '../step';
import { isWalkable, terrainAt } from '../terrain';
import type { PlayerInput, World } from '../types';
import { addPlayer, createWorld } from '../world';
import { placeBuilding, placementError } from '../building';

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });

function run(world: World, seconds: number, inputs = new Map<number, PlayerInput>()): void {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(world, inputs);
}

describe('world generation', () => {
  it('produces an island with a walkable camp clearing', () => {
    const world = createWorld(42);
    expect(isWalkable(terrainAt(world.terrain, world.camp))).toBe(true);
    expect(world.terrain.length).toBe(MAP_TILES * MAP_TILES);
  });

  it('is fully deterministic for a given seed', () => {
    const a = createWorld(7);
    const b = createWorld(7);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.nodes[0].pos).toEqual(b.nodes[0].pos);
  });

  it('scatters every resource kind across the island', () => {
    const world = createWorld(99);
    const kinds = new Set(world.nodes.map((n) => n.kind));
    expect(kinds.has('tree')).toBe(true);
    expect(kinds.has('rock')).toBe(true);
    expect(kinds.has('bush')).toBe(true);
  });

  it('keeps the camp clearing free of resource nodes', () => {
    const world = createWorld(5);
    for (const node of world.nodes) {
      expect(Math.hypot(node.pos.x - world.camp.x, node.pos.y - world.camp.y)).toBeGreaterThan(119);
    }
  });
});

describe('simulation determinism', () => {
  it('produces identical state from identical inputs', () => {
    let playerId = -1;
    const worlds = [createWorld(3), createWorld(3)].map((w) => {
      const player = addPlayer(w, 'test');
      playerId = player.id;
      run(w, 20, new Map([[player.id, input({ move: { x: 1, y: 0.4 } })]]));
      return w;
    });
    expect(worlds[0].players.get(playerId)!.pos).toEqual(worlds[1].players.get(playerId)!.pos);
    expect(worlds[0].mobs.length).toBe(worlds[1].mobs.length);
    expect(worlds[0].rngState).toBe(worlds[1].rngState);
  });
});

describe('movement', () => {
  it('moves the player in the input direction', () => {
    const world = createWorld(11);
    const player = addPlayer(world, 'test');
    const before = { ...player.pos };
    run(world, 1, new Map([[player.id, input({ move: { x: 1, y: 0 } })]]));
    expect(player.pos.x).toBeGreaterThan(before.x);
  });

  it('never walks into water', () => {
    const world = createWorld(23);
    const player = addPlayer(world, 'test');
    // Push hard in one direction for long enough to reach the shore.
    run(world, 40, new Map([[player.id, input({ move: { x: 1, y: 0 } })]]));
    expect(isWalkable(terrainAt(world.terrain, player.pos))).toBe(true);
  });

  it('puts dash on cooldown after use', () => {
    const world = createWorld(31);
    const player = addPlayer(world, 'test');
    run(world, TICK_DT, new Map([[player.id, input({ move: { x: 1, y: 0 }, dash: true })]]));
    expect(player.dashCd).toBeGreaterThan(0);
  });
});

describe('inventory', () => {
  it('stacks, counts and removes items', () => {
    const world = createWorld(1);
    const player = addPlayer(world, 'test');
    addItem(player, 'wood', 5);
    addItem(player, 'wood', 3);
    expect(countItem(player, 'wood')).toBe(8);
    // Eight wood is one stack in one slot; the rest of the grid stays empty.
    expect(player.inventory.filter((slot) => slot !== null)).toHaveLength(1);

    expect(removeItem(player, 'wood', 6)).toBe(true);
    expect(countItem(player, 'wood')).toBe(2);
    expect(removeItem(player, 'wood', 99)).toBe(false);
  });

  it('refuses to overfill and reports what it stored', () => {
    const world = createWorld(1);
    const player = addPlayer(world, 'test');
    for (let i = 0; i < INVENTORY_SLOTS; i++) addItem(player, 'stone', 999);
    expect(addItem(player, 'wood', 10)).toBe(0);
  });
});

describe('gathering', () => {
  it('harvests a nearby node and drops a pickup', () => {
    const world = createWorld(17);
    const node = world.nodes.find((n) => n.kind === 'tree')!;
    const player = addPlayer(world, 'test');
    player.pos = { x: node.pos.x, y: node.pos.y + 20 };

    const charges = node.charges;
    run(world, 2, new Map([[player.id, input({ interact: true })]]));

    expect(node.charges).toBeLessThan(charges);
    // The drop is spawned then vacuumed up, so assert on what actually landed.
    const carried = countItem(player, 'wood') + countItem(player, 'fiber');
    expect(carried + world.pickups.length).toBeGreaterThan(0);
  });

  it('regrows a depleted node after its timer', () => {
    const world = createWorld(17);
    const node = world.nodes.find((n) => n.kind === 'bush')!;
    node.charges = 0;
    node.regrow = 1;
    run(world, 2);
    expect(node.charges).toBe(node.maxCharges);
  });
});

describe('day and night cycle', () => {
  it('turns to night and spawns mobs, then clears them at dawn', () => {
    const world = createWorld(13);
    addPlayer(world, 'test');

    world.phaseTime = 0.1;
    run(world, 12);
    expect(world.phase).toBe('night');
    expect(world.mobs.length).toBeGreaterThan(0);

    world.phaseTime = 0.1;
    run(world, 1);
    expect(world.phase).toBe('day');
    expect(world.mobs.length).toBe(0);
  });

  it('scales the night budget with the night index', () => {
    const world = createWorld(13);
    addPlayer(world, 'test');
    world.phaseTime = 0.1;
    run(world, 0.2);
    const firstNight = world.waveBudget + world.mobs.length;

    world.nightIndex = 5;
    world.phase = 'day';
    world.phaseTime = 0.1;
    run(world, 0.2);
    expect(world.waveBudget).toBeGreaterThan(firstNight);
  });
});

describe('combat', () => {
  it('auto-fires at a nearby mob without any player input', () => {
    const world = createWorld(19);
    const player = addPlayer(world, 'test');
    world.mobs.push({
      id: 999,
      type: 'slime',
      pos: { x: player.pos.x + 60, y: player.pos.y },
      vel: { x: 0, y: 0 },
      hp: 999,
      maxHp: 999,
      attackCd: 0,
      seed: 1,
      hitFlash: 0,
    });
    run(world, 1.5);
    expect(world.mobs[0].hp).toBeLessThan(999);
  });

  it('downs a player at zero health rather than deleting them', () => {
    const world = createWorld(19);
    const player = addPlayer(world, 'test');
    player.hp = 1;
    world.mobs.push({
      id: 998,
      type: 'brute',
      pos: { ...player.pos },
      vel: { x: 0, y: 0 },
      hp: 9999,
      maxHp: 9999,
      attackCd: 0,
      seed: 2,
      hitFlash: 0,
    });
    run(world, 0.5);
    expect(player.downed).toBeGreaterThan(0);
    expect(world.players.has(player.id)).toBe(true);
  });

  it('revives a downed player with health, after the timer', () => {
    const world = createWorld(19);
    const player = addPlayer(world, 'test');
    player.downed = 0.5;
    player.hp = 0;
    run(world, 1);
    expect(player.downed).toBe(0);
    expect(player.hp).toBeGreaterThan(0);
  });
});

describe('progression', () => {
  it('levels up and offers upgrades', () => {
    const world = createWorld(29);
    const player = addPlayer(world, 'test');
    grantXp(world, player, xpForLevel(1) + 1);
    expect(player.level).toBe(2);
    expect(player.pendingUpgrades).toBe(1);
    expect(player.offers.length).toBeGreaterThan(0);
  });

  it('applies a chosen upgrade and consumes the pending pick', () => {
    const world = createWorld(29);
    const player = addPlayer(world, 'test');
    grantXp(world, player, xpForLevel(1) + 1);

    const offer = player.offers[0];
    expect(chooseUpgrade(world, player, offer.id)).toBe(true);
    expect(player.pendingUpgrades).toBe(0);
    expect(player.offers.length).toBe(0);
  });

  it('rejects an upgrade that was never offered', () => {
    const world = createWorld(29);
    const player = addPlayer(world, 'test');
    grantXp(world, player, xpForLevel(1) + 1);
    expect(chooseUpgrade(world, player, 'not-a-real-upgrade')).toBe(false);
    expect(player.pendingUpgrades).toBe(1);
  });

  it('never offers the same upgrade twice in one draft', () => {
    const world = createWorld(29);
    const player = addPlayer(world, 'test');
    grantXp(world, player, xpForLevel(1) + 1);
    expect(new Set(player.offers.map((o) => o.id)).size).toBe(player.offers.length);
  });
});

describe('building', () => {
  it('places a building when the player can afford it', () => {
    const world = createWorld(37);
    const player = addPlayer(world, 'test');
    addItem(player, 'wood', 20);
    addItem(player, 'stone', 20);

    const pos = { x: world.camp.x + 60, y: world.camp.y };
    expect(placementError(world, player, 'wall', pos)).toBe(null);
    expect(placeBuilding(world, player, 'wall', pos)).toBe(true);
    expect(countItem(player, 'wood')).toBe(16);
  });

  it('rejects placement that is unaffordable, overlapping or out of range', () => {
    const world = createWorld(37);
    const player = addPlayer(world, 'test');

    const pos = { x: world.camp.x + 60, y: world.camp.y };
    expect(placementError(world, player, 'wall', pos)).toBe('cost');

    addItem(player, 'wood', 40);
    addItem(player, 'stone', 40);
    placeBuilding(world, player, 'wall', pos);
    expect(placementError(world, player, 'wall', pos)).toBe('overlap');
    expect(
      placementError(world, player, 'wall', { x: world.camp.x + 4000, y: world.camp.y }),
    ).toBe('range');
  });
});

describe('pickups', () => {
  it('vacuums a settled pickup into the inventory', () => {
    const world = createWorld(41);
    const player = addPlayer(world, 'test');
    world.pickups.push({
      id: 500,
      pos: { x: player.pos.x + 10, y: player.pos.y },
      vel: { x: 0, y: 0 },
      item: 'wood',
      count: 3,
      xp: 2,
      settle: 0,
    });
    run(world, 0.5);
    expect(countItem(player, 'wood')).toBe(3);
    expect(world.pickups.length).toBe(0);
  });

  it('leaves unsettled pickups alone', () => {
    const world = createWorld(41);
    const player = addPlayer(world, 'test');
    world.pickups.push({
      id: 501,
      pos: { ...player.pos },
      vel: { x: 0, y: 0 },
      item: 'wood',
      count: 1,
      xp: 0,
      settle: 5,
    });
    run(world, TICK_DT);
    expect(world.pickups.length).toBe(1);
  });
});

describe('invariants over a long run', () => {
  it('survives several full day/night cycles without NaN or leaks', () => {
    const world = createWorld(77);
    const player = addPlayer(world, 'test');
    const inputs = new Map([[player.id, input({ move: { x: 0.6, y: -0.8 }, interact: true })]]);

    run(world, (CYCLE.daySeconds + CYCLE.nightSeconds) * 2, inputs);

    expect(Number.isFinite(player.pos.x)).toBe(true);
    expect(Number.isFinite(player.pos.y)).toBe(true);
    expect(player.hp).toBeGreaterThanOrEqual(0);
    expect(player.hp).toBeLessThanOrEqual(player.maxHp);
    expect(world.projectiles.length).toBeLessThan(500);
    expect(world.pickups.length).toBeLessThan(2000);
    expect(world.nightIndex).toBeGreaterThanOrEqual(2);
  });

  it('keeps max health consistent with the hearty upgrade', () => {
    const world = createWorld(77);
    const player = addPlayer(world, 'test');
    grantXp(world, player, 100000);
    expect(player.maxHp).toBeGreaterThanOrEqual(PLAYER.maxHp);
  });
});
