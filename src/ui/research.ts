import { ITEMS } from '@shared/data/items';
import { MACHINES } from '@shared/data/machines';
import { TECHS, TECH_BY_ID, techCycles, type TechDef } from '@shared/data/techs';
import {
  cyclesDone,
  cyclesNeeded,
  isAvailable,
  isFinished,
  researchPlan,
  techLevel,
  type QueueOp,
} from '@shared/sim/research';
import type { World } from '@shared/sim/types';
import { audio } from '../audio';
import { itemIconVar } from '../render/items';

export type OrderResearch = (techId: string, op: QueueOp, place?: number) => void;

/** Everything the research lists draw from, so they repaint only when research moves. */
export function researchKey(world: World): string {
  const current = world.research.current;
  const levels = TECHS.map((t) => techLevel(world, t.id)).join(',');
  return `${current}:${world.research.queue.join(',')}:${levels}:${current ? cyclesDone(world, current) : 0}`;
}

/**
 * The tech tree, as the cards a level-up draft uses, under the queue the labs
 * work down. Shared by the lab's screen and the research tab the HUD bar opens,
 * so the two can never disagree about what is planned.
 */
export function paintResearch(world: World, parent: HTMLElement, order: OrderResearch): void {
  paintQueue(world, parent, order);
  paintTechs(world, parent, order);
}

/** The level an entry of the plan will bring a tech to, counting the same tech planned ahead of it. */
function levelAt(world: World, plan: string[], index: number): number {
  const id = plan[index];
  return techLevel(world, id) + plan.slice(0, index).filter((p) => p === id).length;
}

function techName(def: TechDef, level: number): string {
  return def.repeatable && level > 0 ? `${def.name} ${level + 1}` : def.name;
}

/**
 * Locked techs stay on the list rather than being hidden: what you are working
 * toward is most of the reason to build another assembler.
 */
function paintTechs(world: World, parent: HTMLElement, order: OrderResearch): void {
  const plan = researchPlan(world.research);
  for (const tech of TECHS) {
    const level = techLevel(world, tech.id);
    const open = isAvailable(world, tech);
    const done = isFinished(world, tech);
    const current = world.research.current === tech.id;
    const place = plan.indexOf(tech.id);
    const planned = plan.filter((id) => id === tech.id).length;

    const button = document.createElement('button');
    button.className = `offer tech${current ? ' on' : place >= 0 ? ' queued' : ''}`;
    // A locked tech can still be queued: its prerequisites go in ahead of it.
    button.disabled = done;

    const cost = tech.inputs
      .map(
        (i) =>
          `<span class="stack" title="${ITEMS[i.id].name}"><i class="ic" style="background-image:${itemIconVar(i.id)}"></i>${i.count}</span>`,
      )
      .join('');
    const progress = `${cyclesDone(world, tech.id)} / ${cyclesNeeded(world, tech)} cycles`;
    const state = done
      ? 'Done'
      : tech.repeatable && planned > 0
        ? `${current ? 'Researching' : 'Queued'} · ${planned} planned · click to add another`
        : current
          ? `Researching · ${progress}`
          : place >= 0
            ? `Queued ${place + 1}${ordinal(place + 1)} · click to drop`
            : !open
              ? `Needs ${tech.requires.map((id) => TECH_BY_ID.get(id)?.name ?? id).join(', ')}`
              : tech.repeatable
                ? `${progress} · click to queue`
                : progress;
    const unlocks = tech.unlocks?.length
      ? `<span class="tech-unlocks">Unlocks ${tech.unlocks.map((id) => MACHINES[id].name).join(', ')}</span>`
      : '';

    button.innerHTML =
      `<b>${techName(tech, level)}</b><span>${tech.description}</span>${unlocks}` +
      `<span class="recipe-flow">${cost}<em>${tech.time}s · ${state}</em></span>`;
    button.addEventListener('click', () => {
      audio.play('click');
      // Only a repeatable tech is planned again; everything else toggles.
      order(tech.id, !tech.repeatable && place >= 0 ? 'remove' : 'add');
    });
    parent.appendChild(button);
  }
}

/**
 * The order the labs will work in, above the tree. Each row can move up a
 * place or be dropped; the front row is what every lab is on right now. A
 * repeatable tech planned several times has a row per level.
 */
function paintQueue(world: World, parent: HTMLElement, order: OrderResearch): void {
  const research = world.research;
  const plan = researchPlan(research);

  const box = document.createElement('div');
  box.className = 'research-queue';
  const head = document.createElement('p');
  head.className = 'filter-head';
  head.textContent = plan.length ? 'Research queue' : 'Research queue is empty';
  box.appendChild(head);
  if (!plan.length) {
    const hint = document.createElement('p');
    hint.className = 'queue-hint';
    hint.textContent = 'Click techs below to line them up. Anything locked brings its prerequisites with it.';
    box.appendChild(hint);
  }

  plan.forEach((id, index) => {
    const tech = TECH_BY_ID.get(id);
    if (!tech) return;
    const level = levelAt(world, plan, index);
    const row = document.createElement('div');
    row.className = `queue-row${index === 0 && research.current ? ' on' : ''}`;
    // Banked cycles belong to the level being worked on, the first of its kind.
    const first = level === techLevel(world, id);
    const done = first ? cyclesDone(world, id) : 0;
    row.innerHTML =
      `<span class="queue-num">${index + 1}</span><b>${techName(tech, level)}</b>` +
      `<span class="queue-cycles">${done} / ${techCycles(tech, level)}</span>`;

    const control = (label: string, title: string, op: QueueOp, enabled: boolean): void => {
      const b = document.createElement('button');
      b.className = 'mini-btn';
      b.textContent = label;
      b.title = title;
      b.disabled = !enabled;
      b.addEventListener('click', () => {
        audio.play('click');
        order(id, op, index);
      });
      row.appendChild(b);
    };
    const ahead = index > 0 ? plan[index - 1] : null;
    control('▲', 'Research this sooner', 'up', ahead !== null && ahead !== id && !tech.requires.includes(ahead));
    control('✕', 'Take it off the queue', 'remove', true);
    box.appendChild(row);
  });
  parent.appendChild(box);
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
