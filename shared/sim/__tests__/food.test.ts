import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../data/items';
import { applyOrder } from '../commands';
import { eat, pickFood } from '../food';
import { addItem, countItem } from '../inventory';
import { countIn } from '../slots';
import type { Machine } from '../types';
import { advance, at, bench, fill, put } from './bench';

/**
 * Fish and berries are what a player eats to heal. These hold the one key to
 * doing the sensible thing: it eats the food that fits the wound, never wastes
 * a meal at full health, and a furnace turns fish into the better meal.
 */
describe('eating', () => {
  it('heals by the food eaten and uses it up', () => {
    const { world, player } = bench();
    addItem(player, 'fish', 2);
    player.hp = 50;

    expect(applyOrder(world, { p: player.id, c: { k: 'eat' } })).toBe(true);
    expect(player.hp).toBe(50 + ITEMS.fish.food!);
    expect(countItem(player, 'fish')).toBe(1);
    expect(world.events.some((e) => e.kind === 'ate' && e.item === 'fish')).toBe(true);
  });

  it('does nothing at full health, with no food, or while downed', () => {
    const { world, player } = bench();
    expect(eat(world, player)).toBe(false);

    addItem(player, 'fish', 1);
    expect(eat(world, player)).toBe(false);
    expect(countItem(player, 'fish')).toBe(1);

    player.hp = 10;
    player.downed = 3;
    expect(eat(world, player)).toBe(false);
    expect(countItem(player, 'fish')).toBe(1);
  });

  it('eats the smallest food that fills the gap, and the biggest when none does', () => {
    const { player } = bench();
    addItem(player, 'berry', 5);
    addItem(player, 'fish', 5);
    addItem(player, 'grilledFish', 5);

    player.hp = player.maxHp - 3;
    expect(pickFood(player)).toBe('berry');
    player.hp = player.maxHp - 10;
    expect(pickFood(player)).toBe('fish');
    player.hp = player.maxHp - 30;
    expect(pickFood(player)).toBe('grilledFish');
    player.hp = 1;
    expect(pickFood(player)).toBe('grilledFish');
  });

  it('never heals past full', () => {
    const { world, player } = bench();
    addItem(player, 'grilledFish', 1);
    player.hp = player.maxHp - 1;
    expect(eat(world, player)).toBe(true);
    expect(player.hp).toBe(player.maxHp);
  });
});

describe('grilling fish', () => {
  it('turns fish into grilled fish in a stone furnace', () => {
    const b = bench();
    const spot = at(0, 2);
    const furnace = put(b, ['furnace', 'grilledFish'], spot.tx, spot.ty, 0) as Machine;
    fill(furnace.input, 'fish', 5);

    advance(b.world, 20);
    expect(countIn(furnace.output, 'grilledFish')).toBe(5);
    expect(ITEMS.grilledFish.food!).toBeGreaterThan(ITEMS.fish.food!);
  });
});
