import { describe, expect, it } from 'vitest';
import { MACHINES } from '../../data/machines';
import { RECIPES } from '../../data/recipes';
import { RESEARCH_PACKS, TECHS, TECH_BY_ID } from '../../data/techs';
import { addItem } from '../inventory';
import {
  activeTech,
  cyclesDone,
  cyclesNeeded,
  finishCycle,
  isAvailable,
  nextTech,
  researchBonuses,
  setResearch,
  techLevel,
} from '../research';
import { countIn } from '../slots';
import { insertIntoMachine } from '../systems/factory';
import type { Machine, World } from '../types';
import { advance, at, bench, fill, lay, plantOre, put, type Bench } from './bench';

/**
 * Research is the first thing in the game that a factory feeds rather than a
 * player. These tests build labs the way a player does and run them forward,
 * so what passes here is what a research line is actually worth.
 */

/** A bench whose player can afford a lab, which costs parts nothing else does. */
function labBench(): Bench {
  const b = bench();
  addItem(b.player, 'gear', 200);
  addItem(b.player, 'circuit', 200);
  return b;
}

function xpOf(world: World): number {
  // Levels swallow XP as they are earned, so the two have to be read together.
  let total = 0;
  for (const player of world.players.values()) total += player.level * 1000 + player.xp;
  return total;
}

describe('the tech table', () => {
  it('asks for no more packs than a lab has slots', () => {
    for (const tech of TECHS) {
      expect(tech.inputs.length, `${tech.id} needs more slots than a lab has`).toBeLessThanOrEqual(
        MACHINES.lab.inputSlots,
      );
    }
  });

  it('only requires techs that exist', () => {
    for (const tech of TECHS) {
      for (const id of tech.requires) {
        expect(TECH_BY_ID.has(id), `${tech.id} requires missing ${id}`).toBe(true);
      }
    }
  });

  it('gives every pack a way to be made', () => {
    for (const pack of RESEARCH_PACKS) {
      const made = RECIPES.some((r) => r.outputs.some((o) => o.id === pack));
      expect(made, `nothing produces ${pack}`).toBe(true);
    }
  });

  it('never leaves the island with nothing to research', () => {
    const b = labBench();
    // Every one-shot tech finished: the repeatable tail is what remains.
    for (const tech of TECHS) {
      if (!tech.repeatable) b.world.research.levels[tech.id] = 1;
    }
    const next = nextTech(b.world);
    expect(next?.repeatable).toBe(true);
  });
});

describe('a lab', () => {
  it('takes research packs and nothing else', () => {
    const b = labBench();
    const lab = put(b, 'lab', at(2, 2).tx, at(2, 2).ty, 0) as Machine;

    expect(insertIntoMachine(lab, 'wood')).toBe(false);
    expect(insertIntoMachine(lab, 'ironPlate')).toBe(false);
    expect(insertIntoMachine(lab, 'researchPack')).toBe(true);
    // A pack for a tech far up the tree still goes in, so a line can stockpile.
    expect(insertIntoMachine(lab, 'powerPack')).toBe(true);
    expect(countIn(lab.input, 'researchPack')).toBe(1);
  });

  it('keeps a slot for each kind of pack', () => {
    const b = labBench();
    const lab = put(b, 'lab', at(4, 2).tx, at(4, 2).ty, 0) as Machine;

    // One pack type may not swallow the grid: three kinds, three slots.
    for (let i = 0; i < MACHINES.lab.slotSize; i++) {
      expect(insertIntoMachine(lab, 'researchPack')).toBe(true);
    }
    expect(insertIntoMachine(lab, 'researchPack')).toBe(false);
    expect(insertIntoMachine(lab, 'logicPack')).toBe(true);
    expect(insertIntoMachine(lab, 'powerPack')).toBe(true);
  });

  it('spends packs on the tech being researched and levels everyone up', () => {
    const b = labBench();
    const lab = put(b, 'lab', at(6, 2).tx, at(6, 2).ty, 0) as Machine;
    fill(lab.input, 'researchPack', 10, MACHINES.lab.slotSize);

    expect(setResearch(b.world, 'automation')).toBe(true);
    const before = xpOf(b.world);

    const tech = TECH_BY_ID.get('automation')!;
    advance(b.world, tech.time * 4 + 0.5);

    expect(cyclesDone(b.world, 'automation')).toBe(4);
    // Four cycles paid for, and the fifth already swallowed.
    expect(countIn(lab.input, 'researchPack')).toBe(5);
    expect(xpOf(b.world)).toBeGreaterThan(before);
  });

  it('stalls with nothing to research, and idles without packs', () => {
    const b = labBench();
    const lab = put(b, 'lab', at(8, 2).tx, at(8, 2).ty, 0) as Machine;

    advance(b.world, 1);
    expect(lab.stalled).toBe(true);

    setResearch(b.world, 'automation');
    advance(b.world, 1);
    expect(lab.stalled).toBe(true);
    expect(cyclesDone(b.world, 'automation')).toBe(0);
  });

  it('hands back the packs of a cycle the island abandoned', () => {
    const b = labBench();
    const lab = put(b, 'lab', at(10, 2).tx, at(10, 2).ty, 0) as Machine;
    fill(lab.input, 'researchPack', 4, MACHINES.lab.slotSize);
    fill(lab.input, 'logicPack', 4, MACHINES.lab.slotSize);

    setResearch(b.world, 'automation');
    advance(b.world, 1);
    // Mid-cycle: the pack it is chewing on is already out of the grid.
    expect(countIn(lab.input, 'researchPack')).toBe(3);

    b.world.research.levels.automation = 1;
    b.world.research.levels.beltLogistics = 1;
    expect(setResearch(b.world, 'roboticArms')).toBe(true);
    advance(b.world, 0.1);

    expect(countIn(lab.input, 'researchPack')).toBe(3);
    expect(cyclesDone(b.world, 'automation')).toBe(0);
  });

  it('banks cycles per tech, so switching loses nothing', () => {
    const b = labBench();
    b.world.research.levels.automation = 1;
    const lab = put(b, 'lab', at(12, 2).tx, at(12, 2).ty, 0) as Machine;
    fill(lab.input, 'researchPack', 20, MACHINES.lab.slotSize);

    setResearch(b.world, 'beltLogistics');
    advance(b.world, TECH_BY_ID.get('beltLogistics')!.time * 3 + 0.5);
    const banked = cyclesDone(b.world, 'beltLogistics');
    expect(banked).toBe(3);

    setResearch(b.world, 'metallurgy');
    advance(b.world, 2);
    setResearch(b.world, 'beltLogistics');
    expect(cyclesDone(b.world, 'beltLogistics')).toBe(banked);
  });
});

describe('an inserter', () => {
  it('will not pull spent packs back out of a lab', () => {
    const b = labBench();
    const lab = put(b, 'lab', at(14, 2).tx, at(14, 2).ty, 0) as Machine;
    fill(lab.input, 'researchPack', 5, MACHINES.lab.slotSize);

    // Facing away from the lab, so the tile it reaches into is the lab itself.
    const arm = put(b, 'inserter', at(15, 2).tx, at(15, 2).ty, 0) as Machine;
    advance(b.world, 5);

    expect(arm.input[0]).toBe(null);
    expect(countIn(lab.input, 'researchPack')).toBe(5);
  });
});

describe('a research line', () => {
  it('assembles packs and belts them into a lab on its own', () => {
    const b = labBench();
    const { tx, ty } = at(2, 5);

    const parts = lay(b, tx, ty, 0, [['assembler', 'researchPack'], 'belt', 'belt', 'lab']);
    const assembler = parts[0] as Machine;
    const lab = parts[3] as Machine;

    fill(assembler.input, 'gear', 20, MACHINES.assembler.slotSize);
    fill(assembler.input, 'copperPlate', 20, MACHINES.assembler.slotSize);
    setResearch(b.world, 'automation');

    advance(b.world, 40);

    expect(cyclesDone(b.world, 'automation')).toBeGreaterThan(2);
    expect(lab.stalled).toBe(false);
  });
});

describe('finishing a tech', () => {
  it('records a level, announces it, and picks up the next one', () => {
    const b = labBench();
    const tech = TECH_BY_ID.get('automation')!;
    setResearch(b.world, tech.id);

    for (let i = 0; i < cyclesNeeded(b.world, tech); i++) {
      b.world.events.length = 0;
      finishCycle(b.world, tech, 1);
    }

    expect(techLevel(b.world, 'automation')).toBe(1);
    expect(b.world.events).toContainEqual({
      kind: 'research',
      tech: 'automation',
      level: 1,
      next: 'beltLogistics',
    });
    expect(activeTech(b.world)?.id).toBe('beltLogistics');
  });

  it('opens what it was a prerequisite for, and nothing else', () => {
    const b = labBench();
    const robotic = TECH_BY_ID.get('roboticArms')!;
    expect(isAvailable(b.world, robotic)).toBe(false);

    b.world.research.levels.automation = 1;
    b.world.research.levels.beltLogistics = 1;
    expect(isAvailable(b.world, robotic)).toBe(true);
    expect(setResearch(b.world, 'deepDrilling')).toBe(false);
  });

  it('keeps a repeatable tech selected, and charges more each level', () => {
    const b = labBench();
    const tech = TECH_BY_ID.get('deepDrilling')!;
    for (const id of ['automation', 'beltLogistics', 'metallurgy', 'roboticArms', 'labAutomation']) {
      b.world.research.levels[id] = 1;
    }
    setResearch(b.world, tech.id);

    const first = cyclesNeeded(b.world, tech);
    for (let i = 0; i < first; i++) finishCycle(b.world, tech, 1);

    expect(techLevel(b.world, tech.id)).toBe(1);
    expect(activeTech(b.world)?.id).toBe(tech.id);
    expect(cyclesNeeded(b.world, tech)).toBeGreaterThan(first);
  });
});

describe('research bonuses', () => {
  it('start at nothing and compound with each level', () => {
    const b = labBench();
    expect(researchBonuses(b.world).mining).toBe(1);

    b.world.research.levels.automation = 1;
    expect(researchBonuses(b.world).mining).toBeCloseTo(1.25);

    b.world.research.levels.deepDrilling = 3;
    expect(researchBonuses(b.world).mining).toBeCloseTo(1.7);
  });

  it('make every miner on the island faster', () => {
    const mined = (researched: boolean): number => {
      const b = bench();
      const { tx, ty } = at(3, 6);
      plantOre(b.world, 'ironOre', tx, ty);
      const miner = put(b, 'miner', tx, ty, 0) as Machine;
      if (researched) b.world.research.levels.automation = 1;
      advance(b.world, 12);
      return countIn(miner.output, 'ironOre');
    };

    expect(mined(true)).toBeGreaterThan(mined(false));
  });
});
