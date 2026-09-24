import { ITEMS } from '@shared/data/items';
import type { MachineDef } from '@shared/data/machines';
import { BELT_SPEED, INSERTER_SWING, MACHINES } from '@shared/data/machines';
import { RECIPE_BY_ID, craftTime } from '@shared/data/recipes';
import { TECH_BY_ID } from '@shared/data/techs';
import { TILE } from '@shared/sim/constants';
import { filterOf } from '@shared/sim/factory';
import { dirAngle, tileCenter } from '@shared/sim/grid';
import { MINE_TIME } from '@shared/sim/systems/factory';
import type { Belt, Machine, OreKind } from '@shared/sim/types';
import { drawItemSprite } from './items';
import { UI, rgba, shift } from './palette';
import { meter, polygon, shadow } from './shapes';

const ORE_COLORS: Record<OreKind, string> = {
  ironOre: '#b9a49a',
  copperOre: '#d98c4e',
  coal: '#3c3c46',
};

/**
 * Ore is drawn as scattered pebbles, never as a tinted tile. A flat per-tile
 * fill produces hard square edges across a patch that read as rendering
 * artefacts; soft circular shading plus rocks reads as an actual deposit.
 */
/**
 * `band` is how full the tile still is, 1 to 4. A worked-out tile keeps fewer
 * pebbles and a fainter stain, which is what lets a patch be read at a glance
 * rather than by opening every miner on it.
 */
export function drawOreTile(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  kind: OreKind,
  band = 4,
): void {
  const { x, y } = tileCenter(tx, ty);
  const color = ORE_COLORS[kind];

  // Circles overlap between neighbouring tiles, so a patch has no visible grid.
  ctx.fillStyle = rgba(color, 0.085 + band * 0.034);
  ctx.beginPath();
  ctx.arc(x, y, TILE * 0.62, 0, Math.PI * 2);
  ctx.fill();

  // Deterministic pebble placement so a patch never shimmers between frames.
  // Pebbles are dropped from the end of that fixed sequence as the tile runs
  // down, so the ones that remain never jump about.
  for (let i = 0; i < band + 1; i++) {
    const hx = ((tx * 73856093) ^ (ty * 19349663) ^ (i * 83492791)) >>> 0;
    const ox = ((hx % 1000) / 1000 - 0.5) * TILE * 0.82;
    const oy = (((hx >> 10) % 1000) / 1000 - 0.5) * TILE * 0.82;
    const r = 2.8 + ((hx >> 20) % 100) / 100 * 2.6;

    ctx.fillStyle = 'rgba(10, 14, 20, 0.2)';
    ctx.beginPath();
    ctx.ellipse(x + ox, y + oy + r * 0.5, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    polygon(ctx, x + ox, y + oy, r, 5, hx, 0.32);
    ctx.fillStyle = color;
    ctx.fill();
    polygon(ctx, x + ox - r * 0.22, y + oy - r * 0.26, r * 0.5, 5, hx + 7, 0.32);
    ctx.fillStyle = shift(color, 30);
    ctx.fill();
  }
}

export function drawBelt(ctx: CanvasRenderingContext2D, belt: Belt, time: number): void {
  const { x, y } = tileCenter(belt.tx, belt.ty);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dirAngle(belt.dir));

  ctx.fillStyle = '#3f4650';
  ctx.beginPath();
  ctx.roundRect(-TILE / 2, -TILE * 0.34, TILE, TILE * 0.68, 3);
  ctx.fill();

  // Scrolling treads: the clearest possible signal of which way a belt runs.
  // All four go into one path — a stroke apiece is four draw calls per belt,
  // and a base is thousands of belts.
  ctx.strokeStyle = '#59616d';
  ctx.lineWidth = 2;
  const spacing = TILE / 4;
  const scroll = (time * BELT_SPEED * TILE) % spacing;
  ctx.beginPath();
  for (let i = -TILE / 2 - spacing; i < TILE / 2 + spacing; i += spacing) {
    const lx = i + scroll;
    if (lx < -TILE / 2 || lx > TILE / 2) continue;
    ctx.moveTo(lx, -TILE * 0.3);
    ctx.lineTo(lx, TILE * 0.3);
  }
  ctx.stroke();

  ctx.fillStyle = '#6d7683';
  ctx.beginPath();
  ctx.moveTo(TILE * 0.22, 0);
  ctx.lineTo(TILE * 0.06, -TILE * 0.16);
  ctx.lineTo(TILE * 0.06, TILE * 0.16);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/** Items ride on top of every belt, drawn after the belts themselves. */
export function drawBeltItems(ctx: CanvasRenderingContext2D, belt: Belt): void {
  const { x, y } = tileCenter(belt.tx, belt.ty);
  const angle = dirAngle(belt.dir);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  for (const riding of belt.items) {
    // offset 0 is the back edge of the tile, 1 the front edge.
    const along = (riding.offset - 0.5) * TILE;
    const ix = x + dx * along;
    const iy = y + dy * along;

    ctx.fillStyle = 'rgba(10, 14, 20, 0.28)';
    ctx.beginPath();
    ctx.ellipse(ix, iy + 3, 4.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    drawItemSprite(ctx, ix, iy, 5.2, riding.item);
  }
}

export function drawMachine(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  time: number,
): void {
  const def = MACHINES[machine.type];
  const { x, y } = tileCenter(machine.tx, machine.ty);

  if (def.family === 'inserter') {
    drawInserter(ctx, machine, x, y);
    return;
  }

  shadow(ctx, x, y + TILE * 0.36, TILE * 0.44);

  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.roundRect(x - TILE * 0.44, y - TILE * 0.5, TILE * 0.88, TILE * 0.86, 5);
  ctx.fill();

  ctx.fillStyle = shift(def.color, -24);
  ctx.beginPath();
  ctx.roundRect(x - TILE * 0.44, y + TILE * 0.14, TILE * 0.88, TILE * 0.22, 5);
  ctx.fill();

  drawMachineFace(ctx, machine, def, time, x, y);
  drawTierPips(ctx, def, x, y);
  drawOutputNub(ctx, machine, x, y);

  if (machine.stalled) {
    // A stalled machine has to be findable at a glance in a big factory.
    ctx.globalAlpha = 0.6 + Math.sin(time * 5) * 0.25;
    ctx.fillStyle = UI.danger;
    ctx.beginPath();
    ctx.arc(x + TILE * 0.3, y - TILE * 0.36, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (outOfFuel(machine)) {
    // The commonest reason a burner stops, so it gets its own sign: a lump of
    // coal in a red ring says what to bring without opening the machine.
    const pulse = 0.7 + Math.sin(time * 5) * 0.3;
    ctx.strokeStyle = UI.danger;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x - TILE * 0.28, y - TILE * 0.36, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawItemSprite(ctx, x - TILE * 0.28, y - TILE * 0.36, 3.6, 'coal');
  }

  drawProgress(ctx, machine, x, y);
}

function outOfFuel(machine: Machine): boolean {
  if (!machine.fuel || (machine.heat ?? 0) > 0) return false;
  return machine.fuel.every((slot) => slot === null || slot.count <= 0);
}

function drawMachineFace(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  def: MachineDef,
  time: number,
  x: number,
  y: number,
): void {
  const running = !machine.stalled;
  const accent = def.accent;
  // A faster tier animates faster, so a Mk3 reads as working harder than the
  // Mk1 beside it without having to open either one.
  const rate = time * def.speed;

  switch (def.family) {
    case 'miner': {
      // A drill head that only turns while the miner is actually working.
      const spin = running ? rate * 3 : 0;
      ctx.save();
      ctx.translate(x, y - TILE * 0.06);
      ctx.rotate(spin);
      ctx.fillStyle = accent;
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i / 3) * Math.PI * 2);
        ctx.fillRect(-1.8, -TILE * 0.26, 3.6, TILE * 0.26);
        ctx.restore();
      }
      ctx.restore();
      ctx.fillStyle = shift(accent, -40);
      ctx.beginPath();
      ctx.arc(x, y - TILE * 0.06, 3.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'furnace': {
      const glow = running ? 0.65 + Math.sin(rate * 7) * 0.25 : 0.12;
      ctx.fillStyle = rgba(accent, glow);
      ctx.beginPath();
      ctx.roundRect(x - TILE * 0.2, y - TILE * 0.22, TILE * 0.4, TILE * 0.3, 3);
      ctx.fill();
      break;
    }
    case 'assembler': {
      const arm = running ? Math.sin(rate * 4) * TILE * 0.12 : 0;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - TILE * 0.18, y - TILE * 0.2);
      ctx.lineTo(x + arm, y + TILE * 0.02);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x + arm, y + TILE * 0.02, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'splitter': {
      // The T is the whole explanation of the piece: one way in, two arms out.
      ctx.save();
      ctx.translate(x, y - TILE * 0.04);
      ctx.rotate(dirAngle(machine.dir));

      ctx.strokeStyle = shift(accent, -55);
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-TILE * 0.3, 0);
      ctx.lineTo(0, 0);
      ctx.moveTo(0, -TILE * 0.3);
      ctx.lineTo(0, TILE * 0.3);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // Left is side 0, right is side 1 — the same order the screen shows them.
      // A filtered side wears the item's own colour, which is how a sorter is
      // read at a glance; the outline is what keeps a dark item like coal from
      // disappearing into the casing.
      for (const side of [0, 1]) {
        const away = side === 0 ? -1 : 1;
        const filter = filterOf(machine, side);
        ctx.beginPath();
        ctx.moveTo(0, away * TILE * 0.44);
        ctx.lineTo(-TILE * 0.13, away * TILE * 0.22);
        ctx.lineTo(TILE * 0.13, away * TILE * 0.22);
        ctx.closePath();
        ctx.fillStyle = filter ? ITEMS[filter].color : accent;
        ctx.fill();
        if (filter) {
          ctx.strokeStyle = 'rgba(236, 242, 248, 0.75)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }
    case 'chest': {
      ctx.fillStyle = accent;
      ctx.fillRect(x - TILE * 0.08, y - TILE * 0.24, TILE * 0.16, TILE * 0.18);
      ctx.fillStyle = shift(def.color, -30);
      ctx.fillRect(x - TILE * 0.44, y - TILE * 0.08, TILE * 0.88, 3);
      break;
    }
    case 'lab': {
      // A lit dome with something rising through it. A lab has no output side
      // and no moving arm, so the bubbles are the only sign it is working.
      ctx.fillStyle = rgba(accent, running ? 0.5 : 0.14);
      ctx.beginPath();
      ctx.arc(x, y - TILE * 0.1, TILE * 0.24, Math.PI, 0);
      ctx.fill();

      ctx.fillStyle = rgba(accent, running ? 0.95 : 0.25);
      for (let i = 0; i < 3; i++) {
        const rise = running ? ((time * 0.6 + i / 3) % 1) : (i + 1) / 4;
        const bx = x + Math.sin((i + 1) * 2.4 + time) * TILE * 0.09;
        ctx.beginPath();
        ctx.arc(bx, y - TILE * 0.04 - rise * TILE * 0.2, 1.8 + (1 - rise) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}

/**
 * An inserter is drawn as a slim post with one arm, because the arm is the
 * only thing that says which way round it is. The hand slides along the
 * facing axis rather than sweeping round a circle: a rotating arm spends half
 * its cycle pointing at tiles the inserter has nothing to do with, and in a
 * 3/4 view it swings into the ground. Sliding, it is always over either the
 * tile it takes from or the tile it feeds.
 *
 * The post is deliberately darker and bluer than the island's rock, which it
 * would otherwise be mistaken for wherever a line crosses stone.
 *
 * A long arm sweeps across two tiles rather than one, which is the only thing
 * on screen that says how far it reaches.
 */
function drawInserter(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  x: number,
  y: number,
): void {
  const def = MACHINES[machine.type];
  const hand = machine.input[0];
  // Empty-handed, the arm rests back over its source, waiting.
  const swing = hand ? Math.min(machine.progress / INSERTER_SWING, 1) : 0;
  const angle = dirAngle(machine.dir);
  // -1 is fully back over the source tile, +1 fully forward over the target.
  // The hand stops half a tile short of the far tile's centre, so a long arm
  // visibly clears the tile it reaches over instead of resting on top of it.
  const along = (swing * 2 - 1) * TILE * (def.reach - 0.5);
  const pivotY = y - TILE * 0.22;
  const handX = x + Math.cos(angle) * along;
  const handY = pivotY + Math.sin(angle) * along;

  shadow(ctx, x, y + TILE * 0.2, TILE * 0.22);

  ctx.strokeStyle = machine.stalled ? UI.danger : def.accent;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, pivotY);
  ctx.lineTo(handX, handY);
  ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.roundRect(x - TILE * 0.15, y - TILE * 0.26, TILE * 0.3, TILE * 0.5, 4);
  ctx.fill();

  ctx.fillStyle = shift(def.color, -22);
  ctx.beginPath();
  ctx.roundRect(x - TILE * 0.15, y + TILE * 0.08, TILE * 0.3, TILE * 0.16, 4);
  ctx.fill();

  // A lit cap on the pivot, so the post never reads as one more boulder.
  ctx.fillStyle = machine.stalled ? UI.danger : def.accent;
  ctx.beginPath();
  ctx.arc(x, pivotY, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // A filtered arm carries a chip of what it is set to, so a bank of arms
  // taking different items out of one chest can be told apart without
  // opening every one of them.
  if (machine.filter) {
    // A pale plate behind it, because the darkest items in the table are
    // nearly the colour of the post and would otherwise leave no chip at all.
    ctx.fillStyle = '#e4e9f2';
    ctx.beginPath();
    ctx.roundRect(x - TILE * 0.13, y + TILE * 0.06, TILE * 0.26, TILE * 0.2, 3);
    ctx.fill();
    drawItemSprite(ctx, x, y + TILE * 0.16, TILE * 0.09, machine.filter);
  }

  // The carried item goes on last: mid-swing the hand is over the post, and an
  // item that blinks out of sight halfway across looks like a dropped one.
  if (hand) {
    ctx.fillStyle = 'rgba(10, 14, 20, 0.28)';
    ctx.beginPath();
    ctx.ellipse(handX, handY + TILE * 0.22, 4.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    drawItemSprite(ctx, handX, handY, 5.2, hand.id);
  }
}

/**
 * Tier marks along the top edge: one chevron per tier above the first. Tiers
 * share a silhouette on purpose — a furnace should still read as a furnace —
 * so the pips are what tells a bank of Mk2s from a bank of Mk3s at a glance.
 */
function drawTierPips(
  ctx: CanvasRenderingContext2D,
  def: MachineDef,
  x: number,
  y: number,
): void {
  if (def.tier < 2) return;

  const marks = def.tier - 1;
  const width = 5;
  const left = x - ((marks - 1) * width) / 2;
  ctx.fillStyle = def.accent;
  for (let i = 0; i < marks; i++) {
    ctx.beginPath();
    ctx.roundRect(left + i * width - 1.6, y - TILE * 0.46, 3.2, 4.4, 1.4);
    ctx.fill();
  }
}

/** A small tab on the output side, so rotation is readable before you commit. */
function drawOutputNub(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  x: number,
  y: number,
): void {
  if (MACHINES[machine.type].outputSlots === 0) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dirAngle(machine.dir));
  ctx.fillStyle = UI.gold;
  ctx.beginPath();
  ctx.roundRect(TILE * 0.36, -TILE * 0.12, TILE * 0.14, TILE * 0.24, 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Seconds one cycle of this machine takes at its own base speed. Research
 * multiplies how fast progress accumulates rather than shortening the cycle,
 * so this stays right however far up the tech tree the island is.
 */
function cycleLength(machine: Machine): number {
  const def = MACHINES[machine.type];
  // A miner's speed scales how fast progress climbs toward MINE_TIME, so the
  // bar is out of MINE_TIME whatever the tier.
  if (def.family === 'miner') return MINE_TIME;
  if (def.family === 'lab') {
    const tech = machine.recipe ? TECH_BY_ID.get(machine.recipe) : null;
    return tech ? tech.time : 0;
  }
  const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  return recipe ? craftTime(recipe, def.speed) : 0;
}

function drawProgress(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  x: number,
  y: number,
): void {
  const def = MACHINES[machine.type];
  // A chest has no cycle, an inserter's arm already is its progress bar, and a
  // splitter passes items straight through.
  if (def.family === 'chest' || def.family === 'inserter' || def.family === 'splitter') return;

  const duration = cycleLength(machine);
  if (duration <= 0 || machine.progress <= 0) return;

  meter(ctx, x, y + TILE * 0.4, TILE * 0.8, 3, machine.progress / duration, UI.xp);
}
