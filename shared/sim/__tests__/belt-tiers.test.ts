import { describe, expect, it } from 'vitest';
import { BELTS, BELT_ORDER } from '../../data/machines';
import { TICK_DT } from '../constants';
import { beltAt, factoryPlacementError, placeBelt, removeAt } from '../factory';
import { countItem } from '../inventory';
import { pushOntoBelt } from '../systems/factory';
import { step, EMPTY_INPUT } from '../step';
import { totalIn } from '../slots';
import type { Belt, BeltId, Machine } from '../types';
import { at, bench, lay } from './bench';

/** Seconds for one item to cross a line of `kind` belts from the first tile to the last tile's end. */
function crossing(kind: BeltId, length: number, reversed = false): number {
  const b = bench();
  const { tx, ty } = at(1, 1);
  let belts: Belt[];
  if (reversed) {
    // Placed from the far end back, so the tick order runs against the flow.
    belts = [];
    for (let i = length - 1; i >= 0; i--) belts[i] = lay(b, tx + i, ty, 0, [kind])[0] as Belt;
  } else {
    belts = lay(b, tx, ty, 0, new Array<BeltId>(length).fill(kind)) as Belt[];
  }
  // Nothing is on the line past the last belt, so the item parks at its end.
  pushOntoBelt(belts[0], 'ironOre');
  let ticks = 0;
  const inputs = new Map([...b.world.players.keys()].map((id) => [id, EMPTY_INPUT]));
  while (ticks < 20 * 30 * 10) {
    step(b.world, inputs);
    ticks++;
    const last = belts[length - 1].items[0];
    if (last && last.offset >= 1) break;
  }
  return ticks * TICK_DT;
}

describe('belt speed', () => {
  for (const kind of BELT_ORDER) {
    for (const reversed of [false, true]) {
      it(`${kind} carries an item at its rated speed${reversed ? ' whichever way round it was laid' : ''}`, () => {
        const length = 24;
        const seconds = crossing(kind, length, reversed);
        const expected = length / BELTS[kind].speed;
        expect(seconds).toBeGreaterThan(expected * 0.9);
        expect(seconds).toBeLessThan(expected * 1.1);
      });
    }
  }

  it('moves a Mk3 line four times as fast as a plain one', () => {
    expect(crossing('belt', 24) / crossing('beltMk3', 24)).toBeGreaterThan(3.6);
  });
});

describe('upgrading a belt in place', () => {
  it('keeps the belt, its facing and what is riding it, and refunds the old one', () => {
    const b = bench();
    const { tx, ty } = at(3, 3);
    const [belt] = lay(b, tx, ty, 1, ['belt']) as Belt[];
    pushOntoBelt(belt, 'ironOre');
    const wood = countItem(b.player, 'wood');
    const plates = countItem(b.player, 'ironPlate');
    const id = belt.id;

    expect(factoryPlacementError(b.world, b.player, 'beltMk2', tx, ty)).toBe(null);
    const upgraded = placeBelt(b.world, b.player, tx, ty, 3, 'beltMk2');

    expect(upgraded).toBe(belt);
    expect(upgraded!.id).toBe(id);
    expect(upgraded!.tier).toBe(2);
    // The facing is the belt's own; the one passed in is only for a new belt.
    expect(upgraded!.dir).toBe(1);
    expect(upgraded!.items).toHaveLength(1);
    expect(b.world.belts).toHaveLength(1);
    expect(beltAt(b.world, tx, ty)).toBe(belt);
    expect(countItem(b.player, 'wood')).toBe(wood + 1);
    expect(countItem(b.player, 'ironPlate')).toBe(plates - 1);
  });

  it('goes straight from a plain belt to a Mk3, and refuses to go down or sideways', () => {
    const b = bench();
    const { tx, ty } = at(3, 3);
    lay(b, tx, ty, 0, ['belt']);
    expect(placeBelt(b.world, b.player, tx, ty, 0, 'beltMk3')!.tier).toBe(3);

    expect(factoryPlacementError(b.world, b.player, 'beltMk2', tx, ty)).toBe('occupied');
    expect(factoryPlacementError(b.world, b.player, 'beltMk3', tx, ty)).toBe('occupied');
    expect(factoryPlacementError(b.world, b.player, 'belt', tx, ty)).toBe('occupied');
    expect(placeBelt(b.world, b.player, tx, ty, 0, 'beltMk2')).toBe(null);
    expect(beltAt(b.world, tx, ty)!.tier).toBe(3);
  });

  it('hands back what the belt cost when it is taken up, whatever its tier', () => {
    const b = bench();
    const { tx, ty } = at(3, 3);
    placeBelt(b.world, b.player, tx, ty, 0, 'beltMk3');
    const steel = countItem(b.player, 'steelPlate');
    const circuits = countItem(b.player, 'circuit');

    expect(removeAt(b.world, b.player, tx, ty)).toBe(true);
    expect(countItem(b.player, 'steelPlate')).toBe(steel + 1);
    expect(countItem(b.player, 'circuit')).toBe(circuits + 1);
    expect(countItem(b.player, 'wood')).toBe(900);
  });

  it('is refused for want of materials, and nothing is spent', () => {
    const b = bench();
    const { tx, ty } = at(3, 3);
    lay(b, tx, ty, 0, ['belt']);
    for (let i = 0; i < b.player.inventory.length; i++) {
      if (b.player.inventory[i]?.id === 'gear') b.player.inventory[i] = null;
    }
    expect(factoryPlacementError(b.world, b.player, 'beltMk2', tx, ty)).toBe('cost');
    expect(placeBelt(b.world, b.player, tx, ty, 0, 'beltMk2')).toBe(null);
    expect(beltAt(b.world, tx, ty)!.tier).toBeUndefined();
  });
});

describe('belt tiers are earned', () => {
  it('holds back Mk2 and Mk3 until their techs are done', () => {
    const b = bench();
    b.world.research.unlockedAll = false;
    const { tx, ty } = at(3, 3);
    expect(factoryPlacementError(b.world, b.player, 'belt', tx, ty)).toBe(null);
    expect(factoryPlacementError(b.world, b.player, 'beltMk2', tx, ty)).toBe('locked');
    expect(factoryPlacementError(b.world, b.player, 'beltMk3', tx, ty)).toBe('locked');

    b.world.research.levels.automation = 1;
    b.world.research.levels.beltLogistics = 1;
    expect(factoryPlacementError(b.world, b.player, 'beltMk2', tx, ty)).toBe(null);
    expect(factoryPlacementError(b.world, b.player, 'beltMk3', tx, ty)).toBe('locked');
    // Locked also stops an upgrade, which is placing a tier all the same.
    lay(b, at(5, 5).tx, at(5, 5).ty, 0, ['belt']);
    expect(placeBelt(b.world, b.player, at(5, 5).tx, at(5, 5).ty, 0, 'beltMk3')).toBe(null);
  });
});

describe('mixed lines', () => {
  it('moves an item from a plain belt onto a Mk3 and on at the faster pace', () => {
    const b = bench();
    const { tx, ty } = at(1, 1);
    const belts = lay(b, tx, ty, 0, ['belt', 'belt', 'beltMk3', 'beltMk3', 'beltMk3', 'beltMk3']) as Belt[];
    pushOntoBelt(belts[0], 'ironOre');
    let ticks = 0;
    const inputs = new Map([...b.world.players.keys()].map((id) => [id, EMPTY_INPUT]));
    while (ticks < 30 * 30 && !(belts[5].items[0]?.offset >= 1)) {
      step(b.world, inputs);
      ticks++;
    }
    const expected = 2 / BELTS.belt.speed + 4 / BELTS.beltMk3.speed;
    expect(ticks * TICK_DT).toBeGreaterThan(expected * 0.9);
    expect(ticks * TICK_DT).toBeLessThan(expected * 1.1);
  });

  it('delivers more from a saturated lane the higher the tier', () => {
    // A feed that never lets the head belt starve, into a chest at the far end.
    // Items go onto a belt a tick at a time, so a faster belt does not reach
    // its tile rate in items per second; what has to hold is the ladder.
    const delivered = (kind: BeltId): number => {
      const b = bench();
      const { tx, ty } = at(1, 1);
      const belts = lay(b, tx, ty, 0, new Array<BeltId>(12).fill(kind)) as Belt[];
      const chest = lay(b, tx + 12, ty, 0, ['chest'])[0] as Machine;
      const inputs = new Map([...b.world.players.keys()].map((id) => [id, EMPTY_INPUT]));
      for (let i = 0; i < 30 * 10; i++) {
        pushOntoBelt(belts[0], 'ironOre');
        step(b.world, inputs);
      }
      return totalIn(chest.input);
    };
    const [one, two, three] = BELT_ORDER.map(delivered);
    expect(two).toBeGreaterThan(one * 1.4);
    expect(three).toBeGreaterThan(two * 1.3);
    expect(three).toBeGreaterThan(one * 2);
  });
});
