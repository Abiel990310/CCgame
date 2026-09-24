import { ITEMS } from '@shared/data/items';
import type { MachineDef } from '@shared/data/machines';
import { BELT_SPEED, INSERTER_SWING, MACHINES, TRAP_TIME } from '@shared/data/machines';
import { RECIPE_BY_ID, craftTime } from '@shared/data/recipes';
import { TECH_BY_ID } from '@shared/data/techs';
import { TILE } from '@shared/sim/constants';
import { filterOf } from '@shared/sim/factory';
import { dirAngle, tileCenter } from '@shared/sim/grid';
import { MINE_TIME } from '@shared/sim/systems/factory';
import type { Belt, Direction, Machine, MachineId, OreKind } from '@shared/sim/types';
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
 *
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
  // Kept faint: stronger, the overlapping discs read as a field of blotches.
  ctx.fillStyle = rgba(color, 0.04 + band * 0.02);
  ctx.beginPath();
  ctx.arc(x, y, TILE * 0.6, 0, Math.PI * 2);
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

/**
 * A belt is a dark rubber bed between two steel rails. The rails are what
 * make a run read as one continuous conveyor rather than a row of tiles, and
 * the treads scrolling across the bed are the clearest signal of direction.
 */
export function drawBelt(ctx: CanvasRenderingContext2D, belt: Belt, time: number): void {
  const { x, y } = tileCenter(belt.tx, belt.ty);
  drawBeltAt(ctx, x, y, belt.dir, time);
}

export function drawBeltAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: Belt['dir'],
  time: number,
): void {
  const h = TILE / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dirAngle(dir));

  // Bed.
  ctx.fillStyle = BELT.bed;
  ctx.fillRect(-h, -TILE * 0.36, TILE, TILE * 0.72);

  // Scrolling treads. All of them go into one path — a stroke apiece is
  // several draw calls per belt, and a base is thousands of belts.
  ctx.strokeStyle = BELT.tread;
  ctx.lineWidth = 2;
  const spacing = TILE / 4;
  const scroll = (time * BELT_SPEED * TILE) % spacing;
  ctx.beginPath();
  for (let i = -h - spacing; i < h + spacing; i += spacing) {
    const lx = i + scroll;
    if (lx < -h + 1 || lx > h - 1) continue;
    ctx.moveTo(lx, -TILE * 0.28);
    ctx.lineTo(lx, TILE * 0.28);
  }
  ctx.stroke();

  // Rails, one path: the lit top edge and the shaded body of both sides.
  ctx.fillStyle = BELT.rail;
  ctx.beginPath();
  ctx.rect(-h, -TILE * 0.44, TILE, TILE * 0.1);
  ctx.rect(-h, TILE * 0.34, TILE, TILE * 0.1);
  ctx.fill();
  ctx.fillStyle = BELT.railLit;
  ctx.beginPath();
  ctx.rect(-h, -TILE * 0.44, TILE, TILE * 0.035);
  ctx.rect(-h, TILE * 0.34, TILE, TILE * 0.035);
  ctx.fill();

  // A chevron painted on the bed.
  ctx.fillStyle = BELT.arrow;
  ctx.beginPath();
  ctx.moveTo(TILE * 0.2, 0);
  ctx.lineTo(TILE * 0.02, -TILE * 0.15);
  ctx.lineTo(TILE * 0.02, -TILE * 0.07);
  ctx.lineTo(TILE * 0.1, 0);
  ctx.lineTo(TILE * 0.02, TILE * 0.07);
  ctx.lineTo(TILE * 0.02, TILE * 0.15);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

const BELT = {
  bed: '#2b3139',
  tread: '#3b434e',
  rail: '#8a939f',
  railLit: '#c3cad3',
  arrow: 'rgba(232, 182, 76, 0.55)',
} as const;

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

/**
 * Every machine is the same 3/4-view block — a lit top face over a shaded
 * front face — so a factory reads as one family of objects standing on the
 * ground. What the machine *does* is painted on the top face, and the front
 * carries its status light and tier marks, which is where the eye goes when
 * scanning a line for the one that stopped.
 */
export function drawMachine(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  time: number,
  cached = true,
): void {
  const def = MACHINES[machine.type];
  const { x, y } = tileCenter(machine.tx, machine.ty);

  if (def.family === 'inserter') {
    drawInserter(ctx, machine, x, y);
    return;
  }

  if (cached && bodyScale > 0) blitBody(ctx, def, machine.dir, x, y);
  else drawBody(ctx, def, machine.dir, x, y);
  drawMachineLive(ctx, machine, def, time, x, y);
  drawStatusLight(ctx, machine, def, time, x, y);
  drawProgress(ctx, machine, x, y);
}

/**
 * Everything about a machine that does not move: shadow, block, deck details,
 * output port and tier marks. It is a dozen fills a machine, and a base is
 * hundreds of machines, so it is baked once per type and facing at device
 * resolution and blitted — the same trade `drawItemSprite` makes for items.
 * Only the drill, the fire, the gears and the lamp are drawn live.
 */
function drawBody(ctx: CanvasRenderingContext2D, def: MachineDef, dir: Direction, x: number, y: number): void {
  shadow(ctx, x + 2, y + TILE * 0.4, TILE * 0.5, 0.26);
  drawBlock(ctx, def, x, y);
  drawMachineDeck(ctx, def, x, y);
  drawOutputNub(ctx, def, dir, x, y);
  drawTierPips(ctx, def, x, y);
}

const bodies = new Map<string, HTMLCanvasElement>();
let bodyScale = 0;
/** Half the sprite's side, in world units: room for the chimney, port and shadow. */
const BODY_REACH = TILE * 0.95;

/** The renderer reports its device scale once a frame, as it does for items. */
export function setFactoryScale(scale: number): void {
  bodyScale = scale;
}

function blitBody(ctx: CanvasRenderingContext2D, def: MachineDef, dir: Direction, x: number, y: number): void {
  const px = Math.max(24, Math.ceil((BODY_REACH * 2 * bodyScale) / 6) * 6);
  const key = `${def.id}:${dir}:${px}`;
  let sprite = bodies.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = px;
    sprite.height = px;
    const bake = sprite.getContext('2d');
    if (!bake) {
      drawBody(ctx, def, dir, x, y);
      return;
    }
    const k = px / (BODY_REACH * 2);
    bake.setTransform(k, 0, 0, k, px / 2, px / 2);
    drawBody(bake, def, dir, 0, 0);
    bodies.set(key, sprite);
  }
  ctx.drawImage(sprite, x - BODY_REACH, y - BODY_REACH, BODY_REACH * 2, BODY_REACH * 2);
}

/** Where the top face ends and the front face begins, as a fraction of a tile. */
const TOP = -0.46;
const LIP = 0.12;
const BASE = 0.42;
const HALF = 0.45;

function drawBlock(ctx: CanvasRenderingContext2D, def: MachineDef, x: number, y: number): void {
  const left = x - TILE * HALF;
  const width = TILE * HALF * 2;
  const chest = def.family === 'chest';

  // Front face, drawn first and tall enough to sit under the top face's lip.
  ctx.fillStyle = shift(def.color, -34);
  ctx.beginPath();
  ctx.roundRect(left, y + TILE * (LIP - 0.1), width, TILE * (BASE - LIP + 0.1), 5);
  ctx.fill();

  // Top face.
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.roundRect(left, y + TILE * TOP, width, TILE * (LIP - TOP), chest ? 4 : 6);
  ctx.fill();

  // A lit rim along the top edge and a dark seam where the faces meet: the
  // two lines that make a flat rectangle read as a solid block.
  ctx.fillStyle = shift(def.color, 34);
  ctx.beginPath();
  ctx.roundRect(left + 3, y + TILE * TOP + 1, width - 6, 2, 1);
  ctx.fill();
  ctx.fillStyle = shift(def.color, -58);
  ctx.fillRect(left + 2, y + TILE * LIP - 1, width - 4, 1.5);
}

/** The fixed parts of each family's deck, baked into the body sprite. */
function drawMachineDeck(ctx: CanvasRenderingContext2D, def: MachineDef, x: number, y: number): void {
  const accent = def.accent;
  const cy = y - TILE * 0.17;

  switch (def.family) {
    case 'miner': {
      // A bore in the deck for the drill to turn in.
      ctx.fillStyle = shift(def.color, -52);
      ctx.beginPath();
      ctx.arc(x, cy, TILE * 0.23, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shift(def.color, -18);
      ctx.beginPath();
      ctx.arc(x, cy, TILE * 0.23, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineTo(x, cy);
      ctx.fill();

      // Corner bolts.
      ctx.fillStyle = shift(def.color, 26);
      for (const [bx, by] of CORNERS) {
        ctx.beginPath();
        ctx.arc(x + bx * TILE * 0.35, y + TILE * (by < 0 ? -0.37 : 0.03), 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'furnace': {
      // The firebox mouth, and a chimney at the back right.
      ctx.fillStyle = shift(def.color, -60);
      ctx.beginPath();
      ctx.roundRect(x - TILE * 0.24, cy - TILE * 0.13, TILE * 0.4, TILE * 0.3, [TILE * 0.15, TILE * 0.15, 3, 3]);
      ctx.fill();
      const chx = x + TILE * 0.27;
      const chy = y - TILE * 0.36;
      ctx.fillStyle = shift(def.color, -40);
      ctx.fillRect(chx - 3.5, chy - 7, 7, 10);
      ctx.fillStyle = shift(def.color, 10);
      ctx.fillRect(chx - 4.5, chy - 8.5, 9, 2.5);
      break;
    }
    case 'assembler': {
      // The hatch the gears turn under.
      ctx.fillStyle = shift(def.color, -46);
      ctx.beginPath();
      ctx.roundRect(x - TILE * 0.3, cy - TILE * 0.22, TILE * 0.6, TILE * 0.44, 4);
      ctx.fill();
      break;
    }
    case 'chest': {
      // Planks across the lid, iron bands, and a clasp on the front.
      ctx.strokeStyle = shift(def.color, -30);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        const ly = y + TILE * (TOP + ((LIP - TOP) * i) / 4);
        ctx.moveTo(x - TILE * 0.42, ly);
        ctx.lineTo(x + TILE * 0.42, ly);
      }
      ctx.stroke();
      // Bands take the chest's own colour, so a steel chest is not wood-banded.
      ctx.fillStyle = shift(def.color, -58);
      ctx.fillRect(x - TILE * 0.3, y + TILE * TOP, 3, TILE * (BASE - TOP));
      ctx.fillRect(x + TILE * 0.3 - 3, y + TILE * TOP, 3, TILE * (BASE - TOP));
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(x - 3, y + TILE * LIP - 3, 6, 7, 1.5);
      ctx.fill();
      break;
    }
    case 'fishTrap': {
      // A square of open water let into the deck, for the float to sit on.
      ctx.fillStyle = shift(accent, -70);
      ctx.beginPath();
      ctx.roundRect(x - TILE * 0.3, cy - TILE * 0.2, TILE * 0.6, TILE * 0.4, 4);
      ctx.fill();
      ctx.fillStyle = shift(accent, -40);
      ctx.beginPath();
      ctx.roundRect(x - TILE * 0.26, cy - TILE * 0.16, TILE * 0.52, TILE * 0.32, 3);
      ctx.fill();
      break;
    }
  }
}

/** The moving parts: only what changes frame to frame is drawn every frame. */
function drawMachineLive(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  def: MachineDef,
  time: number,
  x: number,
  y: number,
): void {
  const running = !machine.stalled && machine.progress > 0;
  const accent = def.accent;
  // A faster tier animates faster, so a Mk3 reads as working harder than the
  // Mk1 beside it without having to open either one.
  const rate = time * def.speed;
  const cy = y - TILE * 0.17;

  switch (def.family) {
    case 'miner': {
      // The drill only turns while the miner is actually working.
      const spin = running ? rate * 5 : 0.4;
      ctx.fillStyle = accent;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = spin + (i / 3) * Math.PI * 2;
        ctx.moveTo(x + Math.cos(a) * TILE * 0.2, cy + Math.sin(a) * TILE * 0.2);
        ctx.lineTo(x + Math.cos(a + 2.2) * TILE * 0.06, cy + Math.sin(a + 2.2) * TILE * 0.06);
        ctx.lineTo(x + Math.cos(a - 0.5) * TILE * 0.07, cy + Math.sin(a - 0.5) * TILE * 0.07);
      }
      ctx.fill();
      ctx.fillStyle = shift(accent, -60);
      ctx.beginPath();
      ctx.arc(x, cy, 2.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'furnace': {
      // The fire glows while it smelts, and the chimney smokes.
      const glow = running ? 0.75 + Math.sin(rate * 7) * 0.2 : 0.18;
      ctx.fillStyle = rgba(accent, glow);
      ctx.beginPath();
      ctx.roundRect(x - TILE * 0.2, cy - TILE * 0.08, TILE * 0.32, TILE * 0.22, [TILE * 0.12, TILE * 0.12, 2, 2]);
      ctx.fill();
      if (!running) break;
      ctx.fillStyle = rgba('#fff2c4', glow * 0.8);
      ctx.fillRect(x - TILE * 0.14, cy + TILE * 0.06, TILE * 0.2, TILE * 0.05);
      const chx = x + TILE * 0.27;
      const chy = y - TILE * 0.36;
      for (let i = 0; i < 3; i++) {
        const t = (rate * 0.6 + i / 3) % 1;
        ctx.fillStyle = `rgba(220, 224, 230, ${0.35 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(chx + Math.sin(t * 5 + i) * 2 + t * 4, chy - 10 - t * 14, 2 + t * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'assembler': {
      // Turning gears, and a working arm that swings over them.
      const spin = running ? rate * 2.4 : 0;
      gear(ctx, x - TILE * 0.08, cy, TILE * 0.15, spin, shift(def.color, 30));
      gear(ctx, x + TILE * 0.14, cy + TILE * 0.07, TILE * 0.09, -spin * 1.6, accent);

      const arm = running ? Math.sin(rate * 4) * TILE * 0.1 : 0;
      ctx.strokeStyle = shift(accent, -20);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - TILE * 0.3, cy - TILE * 0.2);
      ctx.lineTo(x + arm, cy - TILE * 0.06);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(x + arm, cy - TILE * 0.06, 2.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'splitter': {
      // The T is the whole explanation of the piece: one way in, two arms out.
      ctx.save();
      ctx.translate(x, cy);
      ctx.rotate(dirAngle(machine.dir));

      ctx.strokeStyle = shift(def.color, -50);
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-TILE * 0.26, 0);
      ctx.lineTo(0, 0);
      ctx.moveTo(0, -TILE * 0.22);
      ctx.lineTo(0, TILE * 0.22);
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
        ctx.moveTo(0, away * TILE * 0.3);
        ctx.lineTo(-TILE * 0.11, away * TILE * 0.14);
        ctx.lineTo(TILE * 0.11, away * TILE * 0.14);
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
    case 'fishTrap': {
      // A ripple spreading from a float that bobs while the trap is fishing
      // and lies still once its catch has nowhere to go.
      ctx.strokeStyle = rgba(accent, running ? 0.6 : 0.25);
      ctx.lineWidth = 1.2;
      const ripple = running ? (time * 0.8) % 1 : 0.4;
      ctx.beginPath();
      const rx = TILE * (0.06 + ripple * 0.18);
      const ry = TILE * (0.03 + ripple * 0.08);
      ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      const bob = running ? Math.sin(time * 3) * 1.4 : 0;
      ctx.fillStyle = '#e8574f';
      ctx.beginPath();
      ctx.arc(x, cy - 2 + bob, 3, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#f2efe6';
      ctx.beginPath();
      ctx.arc(x, cy - 2 + bob, 3, 0, Math.PI);
      ctx.fill();
      break;
    }
    case 'lab': {
      // A glass dome with something rising through it. A lab has no output
      // side and no moving arm, so the bubbles are the only sign it is working.
      ctx.fillStyle = shift(def.color, -46);
      ctx.beginPath();
      ctx.ellipse(x, cy + TILE * 0.08, TILE * 0.28, TILE * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(accent, running ? 0.45 : 0.16);
      ctx.beginPath();
      ctx.arc(x, cy + TILE * 0.08, TILE * 0.26, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.arc(x - TILE * 0.1, cy - TILE * 0.06, TILE * 0.05, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgba(accent, running ? 0.95 : 0.3);
      for (let i = 0; i < 3; i++) {
        const rise = running ? (time * 0.6 + i / 3) % 1 : (i + 1) / 4;
        const bx = x + Math.sin((i + 1) * 2.4 + time) * TILE * 0.09;
        ctx.beginPath();
        ctx.arc(bx, cy + TILE * 0.04 - rise * TILE * 0.2, 1.8 + (1 - rise) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}

/** Stuck rather than waiting: every output slot taken, or a miner off its ore. */
function isBlocked(machine: Machine, def: MachineDef): boolean {
  if (def.family === 'miner' && machine.output.every((s) => s === null)) return true;
  return machine.output.length > 0 && machine.output.every((s) => s !== null);
}

const CORNERS: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

function gear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  angle: number,
  color: string,
): void {
  const teeth = 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = angle + (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.72;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(16, 20, 26, 0.55)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The lamp on the front face: green while it works, amber while it waits for
 * something to arrive, red and pulsing when it is truly stuck — output backed
 * up, or a miner with nothing under it. The sim's `stalled` covers both of
 * the last two, and a red light on every furnace waiting on a slow belt would
 * drown out the one that actually needs a hand.
 */
function drawStatusLight(
  ctx: CanvasRenderingContext2D,
  machine: Machine,
  def: MachineDef,
  time: number,
  x: number,
  y: number,
): void {
  // A chest has nothing to report, and a splitter passes items straight on.
  if (def.family === 'chest' || def.family === 'splitter') return;
  const lx = x + TILE * 0.32;
  const ly = y + TILE * 0.27;
  const blocked = machine.stalled && isBlocked(machine, def);
  const color = !machine.stalled ? UI.good : blocked ? UI.danger : UI.gold;
  const pulse = blocked ? 0.55 + Math.sin(time * 6) * 0.35 : 1;

  ctx.fillStyle = 'rgba(10, 14, 20, 0.6)';
  ctx.beginPath();
  ctx.arc(lx, ly, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lx, ly, 2.1, 0, Math.PI * 2);
  ctx.fill();
  if (blocked) {
    ctx.fillStyle = rgba(UI.danger, 0.25);
    ctx.beginPath();
    ctx.arc(lx, ly, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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

  shadow(ctx, x + 1, y + TILE * 0.24, TILE * 0.26, 0.26);

  // A round base plate, so an arm reads as a machine and not as a post.
  ctx.fillStyle = shift(def.color, -24);
  ctx.beginPath();
  ctx.ellipse(x, y + TILE * 0.14, TILE * 0.26, TILE * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shift(def.color, 18);
  ctx.beginPath();
  ctx.ellipse(x, y + TILE * 0.1, TILE * 0.24, TILE * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // The post.
  ctx.fillStyle = shift(def.color, -14);
  ctx.beginPath();
  ctx.roundRect(x - TILE * 0.1, pivotY, TILE * 0.2, y + TILE * 0.12 - pivotY, 3);
  ctx.fill();
  ctx.fillStyle = shift(def.color, 30);
  ctx.fillRect(x - TILE * 0.1 + 1.5, pivotY + 2, 1.5, y + TILE * 0.08 - pivotY);

  // The arm: a dark outline under the lit rod, so it holds up over any ground.
  const tint = machine.stalled ? UI.danger : def.accent;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(10, 14, 20, 0.55)';
  ctx.lineWidth = 4.6;
  ctx.beginPath();
  ctx.moveTo(x, pivotY);
  ctx.lineTo(handX, handY);
  ctx.stroke();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.lineCap = 'butt';

  // The claw.
  ctx.fillStyle = shift(tint, -40);
  ctx.beginPath();
  ctx.arc(handX, handY, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // A lit cap on the pivot.
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(x, pivotY, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(x - 1, pivotY - 1, 1.2, 0, Math.PI * 2);
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
 * Tier marks on the front face: one bar per tier above the first. Tiers share
 * a silhouette on purpose — a furnace should still read as a furnace — so the
 * marks are what tells a bank of Mk2s from a bank of Mk3s at a glance.
 */
function drawTierPips(
  ctx: CanvasRenderingContext2D,
  def: MachineDef,
  x: number,
  y: number,
): void {
  if (def.tier < 2) return;

  const marks = def.tier - 1;
  const left = x - TILE * 0.36;
  ctx.fillStyle = def.accent;
  ctx.beginPath();
  for (let i = 0; i < marks; i++) {
    ctx.roundRect(left + i * 5, y + TILE * 0.2, 3, TILE * 0.14, 1);
  }
  ctx.fill();
}

/** A port on the output side, so rotation is readable before you commit. */
function drawOutputNub(
  ctx: CanvasRenderingContext2D,
  def: MachineDef,
  dir: Direction,
  x: number,
  y: number,
): void {
  if (def.outputSlots === 0) return;

  ctx.save();
  ctx.translate(x, y - TILE * 0.1);
  ctx.rotate(dirAngle(dir));
  ctx.fillStyle = '#2b3139';
  ctx.beginPath();
  ctx.roundRect(TILE * 0.38, -TILE * 0.15, TILE * 0.14, TILE * 0.3, 2);
  ctx.fill();
  ctx.fillStyle = UI.gold;
  ctx.beginPath();
  ctx.moveTo(TILE * 0.5, 0);
  ctx.lineTo(TILE * 0.41, -TILE * 0.09);
  ctx.lineTo(TILE * 0.41, TILE * 0.09);
  ctx.closePath();
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
  if (def.family === 'fishTrap') return TRAP_TIME;
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

  meter(ctx, x, y + TILE * 0.47, TILE * 0.72, 3, machine.progress / duration, UI.xp);
}

/**
 * A machine that exists only to be looked at: the build ghost, and the icons
 * the hotbar and palette bake from the same drawing the world uses.
 */
export function previewMachine(type: MachineId, tx: number, ty: number, dir: Direction): Machine {
  return {
    id: -1,
    type,
    tx,
    ty,
    dir,
    recipe: null,
    filter: null,
    progress: 0,
    input: [],
    output: [],
    stalled: false,
    ore: null,
  };
}
