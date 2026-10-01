import { describe, expect, it } from 'vitest';
import { MAP_SIZE } from '../constants';
import { applyOrder } from '../commands';
import { COOK_REACH, cook, nearCampfire } from '../food';
import { addItem, countItem } from '../inventory';
import { MAX_PINS, PIN_HUES, sanitizePins } from '../pins';
import { bench } from './bench';

describe('map pins', () => {
  it('drops a pin where it is told and takes it down by id', () => {
    const { world, player } = bench();
    expect(applyOrder(world, { p: player.id, c: { k: 'pin', x: 400.4, y: 700.6, hue: 2 } })).toBe(true);
    expect(world.pins).toHaveLength(1);
    // Whole numbers, so a pin costs next to nothing in a save.
    expect(world.pins[0]).toMatchObject({ x: 400, y: 701, hue: 2 });

    expect(applyOrder(world, { p: player.id, c: { k: 'unpin', id: world.pins[0].id } })).toBe(true);
    expect(world.pins).toHaveLength(0);
    expect(applyOrder(world, { p: player.id, c: { k: 'unpin', id: 12345 } })).toBe(false);
  });

  it('refuses a pin off the island, on top of another, in a bad colour or past the cap', () => {
    const { world, player } = bench();
    const pin = (x: number, y: number, hue = 0): boolean => applyOrder(world, { p: player.id, c: { k: 'pin', x, y, hue } }) === true;

    expect(pin(-5, 10)).toBe(false);
    expect(pin(10, MAP_SIZE + 1)).toBe(false);
    expect(pin(Number.NaN, 10)).toBe(false);
    expect(pin(100, 100, PIN_HUES)).toBe(false);
    expect(pin(100, 100, 1.5)).toBe(false);

    expect(pin(100, 100)).toBe(true);
    expect(pin(104, 103)).toBe(false);
    for (let i = 1; world.pins.length < MAX_PINS; i++) expect(pin(100 + i * 40, 100)).toBe(true);
    expect(pin(100, 900)).toBe(false);
  });

  it('reads pins back from a save defensively', () => {
    const good = { id: 3, x: 50, y: 60, hue: 1 };
    const pins = sanitizePins(
      [good, null, 'x', { id: 'a', x: 1, y: 1, hue: 0 }, { id: 4, x: -1, y: 1, hue: 0 }, { id: 99, x: 1, y: 1, hue: 0 }, { id: 5, x: 9, y: 9, hue: 77 }],
      10,
    );
    expect(pins).toEqual([good, { id: 5, x: 9, y: 9, hue: 0 }]);
    expect(sanitizePins(undefined, 10)).toEqual([]);
    expect(sanitizePins({}, 10)).toEqual([]);
  });
});

describe('cooking by hand', () => {
  function atCampfire() {
    const b = bench();
    const camp = b.world.buildings.find((x) => x.type === 'campfire')!;
    b.player.pos = { x: camp.pos.x + 40, y: camp.pos.y };
    return b;
  }

  it('grills every fish in the bag at the campfire', () => {
    const { world, player } = atCampfire();
    addItem(player, 'fish', 5);
    const before = countItem(player, 'grilledFish');

    expect(applyOrder(world, { p: player.id, c: { k: 'cook' } })).toBe(true);
    expect(countItem(player, 'fish')).toBe(0);
    expect(countItem(player, 'grilledFish')).toBe(before + 5);
    expect(world.events.some((e) => e.kind === 'crafted' && e.item === 'grilledFish')).toBe(true);
  });

  it('does nothing away from the fire, with no fish, or while downed', () => {
    const { world, player } = atCampfire();
    expect(cook(world, player)).toBe(0);

    addItem(player, 'fish', 2);
    player.downed = 3;
    expect(cook(world, player)).toBe(0);
    player.downed = 0;

    const camp = world.buildings.find((x) => x.type === 'campfire')!;
    player.pos = { x: camp.pos.x + COOK_REACH + 20, y: camp.pos.y };
    expect(nearCampfire(world, player)).toBeNull();
    expect(applyOrder(world, { p: player.id, c: { k: 'cook' } })).toBe(false);
    expect(countItem(player, 'fish')).toBe(2);
  });
});
