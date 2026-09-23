import { ITEMS } from '@shared/data/items';
import { BELT_SPEED, INSERTER_SWING, MACHINES, isInserter } from '@shared/data/machines';
import { RECIPE_BY_ID, craftTime } from '@shared/data/recipes';
import { TILE } from '@shared/sim/constants';
import { dirAngle, tileCenter } from '@shared/sim/grid';
import type { Belt, Machine, OreKind } from '@shared/sim/types';
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
export function drawOreTile(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  kind: OreKind,
): void {
  const { x, y } = tileCenter(tx, ty);
  const color = ORE_COLORS[kind];

  // Circles overlap between neighbouring tiles, so a patch has no visible grid.
  ctx.fillStyle = rgba(color, 0.22);
  ctx.beginPath();
  ctx.arc(x, y, TILE * 0.62, 0, Math.PI * 2);
  ctx.fill();

  // Deterministic pebble placement so a patch never shimmers between frames.
  for (let i = 0; i < 5; i++) {
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

    polygon(ctx, ix, iy, 4.6, 5, riding.offset * 1000 + belt.id, 0.2);
    ctx.fillStyle = ITEMS[riding.item].color;
    ctx.fill();
  }
}

export function drawMachine(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  time: number,
): void {
  const def = MACHINES[machine.type];
  const { x, y } = tileCenter(machine.tx, machine.ty);

  if (isInserter(machine.type)) {
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

  drawMachineFace(ctx, machine, def.accent, time, x, y);
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

  drawProgress(ctx, machine, x, y);
}

function drawMachineFace(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  accent: string,
  time: number,
  x: number,
  y: number,
): void {
  const running = !machine.stalled;

  switch (machine.type) {
    case 'miner': {
      // A drill head that only turns while the miner is actually working.
      const spin = running ? time * 3 : 0;
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
      const glow = running ? 0.65 + Math.sin(time * 7) * 0.25 : 0.12;
      ctx.fillStyle = rgba(accent, glow);
      ctx.beginPath();
      ctx.roundRect(x - TILE * 0.2, y - TILE * 0.22, TILE * 0.4, TILE * 0.3, 3);
      ctx.fill();
      break;
    }
    case 'assembler': {
      const arm = running ? Math.sin(time * 4) * TILE * 0.12 : 0;
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
    case 'chest': {
      ctx.fillStyle = accent;
      ctx.fillRect(x - TILE * 0.08, y - TILE * 0.24, TILE * 0.16, TILE * 0.18);
      ctx.fillStyle = shift('#a4713d', -30);
      ctx.fillRect(x - TILE * 0.44, y - TILE * 0.08, TILE * 0.88, 3);
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
    // Pale backing, because the darkest item in the table is nearly the colour
    // of the post and would otherwise leave no chip at all.
    ctx.fillStyle = '#e4e9f2';
    ctx.beginPath();
    ctx.roundRect(x - TILE * 0.11, y + TILE * 0.08, TILE * 0.22, TILE * 0.15, 3);
    ctx.fill();
    ctx.fillStyle = ITEMS[machine.filter].color;
    ctx.beginPath();
    ctx.roundRect(x - TILE * 0.08, y + TILE * 0.105, TILE * 0.16, TILE * 0.1, 2);
    ctx.fill();
  }

  // The carried item goes on last: mid-swing the hand is over the post, and an
  // item that blinks out of sight halfway across looks like a dropped one.
  if (hand) {
    ctx.fillStyle = 'rgba(10, 14, 20, 0.28)';
    ctx.beginPath();
    ctx.ellipse(handX, handY + TILE * 0.22, 4.5, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    polygon(ctx, handX, handY, 4.8, 5, machine.id, 0.2);
    ctx.fillStyle = ITEMS[hand.id].color;
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

function drawProgress(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  x: number,
  y: number,
): void {
  // A chest has no cycle, and an inserter's arm already is its progress bar.
  if (machine.type === 'chest' || isInserter(machine.type)) return;

  const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  const duration =
    machine.type === 'miner' ? 1.2 : recipe ? craftTime(recipe, MACHINES[machine.type].speed) : 0;
  if (duration <= 0 || machine.progress <= 0) return;

  meter(ctx, x, y + TILE * 0.4, TILE * 0.8, 3, machine.progress / duration, UI.xp);
}
