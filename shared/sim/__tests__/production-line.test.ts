import { describe, expect, it } from 'vitest';
import { BELT_SPEED, MACHINES } from '../../data/machines';
import { RECIPE_BY_ID, craftTime } from '../../data/recipes';
import { beltAt, machineAt } from '../factory';
import { pushOntoBelt } from '../systems/factory';
import { totalIn } from '../slots';
import type { Belt, Machine } from '../types';
import type { Bench } from './bench';
import {
  advance,
  at,
  bench,
  contents,
  held,
  itemsOnBelts,
  lay,
  plantOre,
  put,
  totalHeld,
} from './bench';

/**
 * End-to-end coverage for production lines: a miner on an ore patch feeding a
 * belt into a furnace and out to a chest, asserted on the items that actually
 * arrive at the far end.
 *
 * Lines are built through the same placement API the build UI calls, and run by
 * the same `step` the game runs, so what passes here is what a player gets.
 */

/** Seconds per plate once the line is saturated; the furnace is the bottleneck. */
const SMELT = craftTime(RECIPE_BY_ID.get('ironPlate')!, MACHINES.furnace.speed);

/**
 * Generous allowance for a line to fill: first ore mined, carried down the
 * belts and smelted. Used only to bound how few items a run may deliver.
 */
const WARMUP = 8;

describe('a miner → belt → furnace → belt → chest line', () => {
  /** The canonical line, laid left to right along one bench row. */
  function ironLine(b: Bench, row = 1) {
    const { tx, ty } = at(2, row);
    plantOre(b.world, 'ironOre', tx, ty);
    const parts = lay(b, tx, ty, 0, [
      'miner',
      'belt',
      'belt',
      ['furnace', 'ironPlate'],
      'belt',
      'chest',
    ]);
    return {
      miner: parts[0] as Machine,
      furnace: parts[3] as Machine,
      chest: parts[5] as Machine,
    };
  }

  it('delivers iron plates to the chest', () => {
    const b = bench();
    const { chest } = ironLine(b);

    advance(b.world, 30);

    expect(held(chest, 'ironPlate')).toBeGreaterThan(0);
  });

  it('delivers nothing but the smelted plates', () => {
    const b = bench();
    const { chest } = ironLine(b);

    advance(b.world, 30);

    // Raw ore must be consumed by the furnace, never carried through to storage.
    expect(contents(chest.input)).toEqual(['ironPlate']);
  });

  it('delivers at the furnace’s rate, which is the line’s bottleneck', () => {
    const b = bench();
    const { miner, furnace, chest } = ironLine(b);

    const seconds = 60;
    advance(b.world, seconds);

    const plates = held(chest, 'ironPlate');
    // A furnace cannot beat one craft per recipe time, whatever feeds it.
    expect(plates).toBeLessThanOrEqual(Math.floor(seconds / SMELT));
    expect(plates).toBeGreaterThanOrEqual(Math.floor((seconds - WARMUP) / SMELT));

    // And it is the furnace holding the line up, not the miner: ore the furnace
    // has not got to yet piles up in front of it.
    expect(held(furnace, 'ironOre')).toBeGreaterThan(0);
    expect(miner.stalled).toBe(false);
  });

  it('turns a corner', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'ironOre', tx, ty);

    // Right along the row, then down the column.
    put(b, 'miner', tx, ty, 0);
    put(b, 'belt', tx + 1, ty, 0);
    put(b, 'belt', tx + 2, ty, 1);
    put(b, 'belt', tx + 2, ty + 1, 1);
    put(b, ['furnace', 'ironPlate'], tx + 2, ty + 2, 1);
    put(b, 'belt', tx + 2, ty + 3, 1);
    const chest = put(b, 'chest', tx + 2, ty + 4, 1) as Machine;

    advance(b.world, 30);

    expect(held(chest, 'ironPlate')).toBeGreaterThan(0);
  });

  it('stalls without delivering when the furnace is set to the wrong recipe', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'ironOre', tx, ty);
    const parts = lay(b, tx, ty, 0, [
      'miner',
      'belt',
      'belt',
      // A copper furnace on an iron line: nothing it is fed is an input.
      ['furnace', 'copperPlate'],
      'belt',
      'chest',
    ]);
    const furnace = parts[3] as Machine;
    const chest = parts[5] as Machine;

    advance(b.world, 30);

    expect(totalHeld(chest)).toBe(0);
    expect(furnace.stalled).toBe(true);
    // The furnace refuses ore its recipe does not use, so the line backs up
    // behind it rather than filling it with something it can never smelt.
    expect(totalHeld(furnace)).toBe(0);
    expect(itemsOnBelts(b.world)).toBeGreaterThan(0);
  });

  it('runs identically on two worlds built the same way', () => {
    const a = bench(2026);
    const c = bench(2026);
    const chestA = ironLine(a).chest;
    const chestC = ironLine(c).chest;

    advance(a.world, 25);
    advance(c.world, 25);

    expect(chestA.input).toEqual(chestC.input);
    expect(a.world.belts.map((belt) => belt.items)).toEqual(c.world.belts.map((b2) => b2.items));
  });
});

describe('a line’s throughput', () => {
  it('turns every ore that enters into exactly one plate in the chest', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    const parts = lay(b, tx, ty, 0, [
      'belt',
      'belt',
      ['furnace', 'ironPlate'],
      'belt',
      'chest',
    ]);
    const head = parts[0] as Belt;
    const furnace = parts[2] as Machine;
    const chest = parts[4] as Machine;

    // Feed a known quantity by hand, spaced so the head belt always has room.
    const fed = 6;
    for (let i = 0; i < fed; i++) {
      expect(pushOntoBelt(head, 'ironOre'), `ore ${i} refused`).toBe(true);
      advance(b.world, 1 / BELT_SPEED);
    }

    // Long enough for the last ore to travel the line and be smelted.
    advance(b.world, fed * SMELT + 10);

    expect(held(chest, 'ironPlate')).toBe(fed);
    // Nothing left stranded anywhere along the way.
    expect(itemsOnBelts(b.world)).toBe(0);
    expect(totalHeld(furnace)).toBe(0);
    expect(totalIn(furnace.output)).toBe(0);
  });

  it('carries a two-stage line through to assembled gears', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'ironOre', tx, ty);
    const parts = lay(b, tx, ty, 0, [
      'miner',
      'belt',
      ['furnace', 'ironPlate'],
      'belt',
      ['assembler', 'gear'],
      'belt',
      'chest',
    ]);
    const chest = parts[6] as Machine;

    const seconds = 60;
    advance(b.world, seconds);

    // One gear costs two plates, so the furnace caps the line at a gear per
    // two smelts however fast the assembler itself runs.
    const gears = held(chest, 'gear');
    expect(gears).toBeGreaterThan(0);
    expect(gears).toBeLessThanOrEqual(Math.floor(seconds / (SMELT * 2)));
    expect(contents(chest.input)).toEqual(['gear']);
  });
});

describe('two lines side by side', () => {
  it('keeps iron and copper apart', () => {
    const b = bench();
    const { tx, ty: ironRow } = at(2, 1);
    const { ty: copperRow } = at(2, 3);

    plantOre(b.world, 'ironOre', tx, ironRow);
    plantOre(b.world, 'copperOre', tx, copperRow);

    const iron = lay(b, tx, ironRow, 0, [
      'miner',
      'belt',
      ['furnace', 'ironPlate'],
      'belt',
      'chest',
    ]);
    const copper = lay(b, tx, copperRow, 0, [
      'miner',
      'belt',
      ['furnace', 'copperPlate'],
      'belt',
      'chest',
    ]);

    advance(b.world, 30);

    const ironChest = iron[4] as Machine;
    const copperChest = copper[4] as Machine;
    expect(held(ironChest, 'ironPlate')).toBeGreaterThan(0);
    expect(held(copperChest, 'copperPlate')).toBeGreaterThan(0);
    expect(contents(ironChest.input)).toEqual(['ironPlate']);
    expect(contents(copperChest.input)).toEqual(['copperPlate']);
  });
});

describe('the bench itself', () => {
  it('builds the line on the tiles it was asked for', () => {
    const b = bench();
    const { tx, ty } = at(2, 1);
    plantOre(b.world, 'ironOre', tx, ty);
    lay(b, tx, ty, 0, ['miner', 'belt', ['furnace', 'ironPlate'], 'belt', 'chest']);

    expect(machineAt(b.world, tx, ty)?.type).toBe('miner');
    expect(beltAt(b.world, tx + 1, ty)).not.toBe(null);
    expect(machineAt(b.world, tx + 2, ty)?.type).toBe('furnace');
    expect(machineAt(b.world, tx + 4, ty)?.type).toBe('chest');
  });
});
