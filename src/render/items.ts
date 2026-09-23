import { ITEMS, type ItemShape } from '@shared/data/items';
import type { ItemId } from '@shared/sim/types';
import { rgba, shift } from './palette';

/**
 * One drawing of an item, used everywhere an item is shown: riding a belt, in
 * an inserter's hand, lying on the ground, and in an inventory slot. The bag
 * used to draw CSS boxes and the world used to draw a five-sided blob, so a
 * stack of steel plate and a stack of iron plate were the same grey disc out
 * on the belt no matter how different they looked in the bag.
 *
 * Shapes are built from the item's own colour so a new row in `ITEMS` needs no
 * art. Light comes from the upper left, matching the rest of the renderer, so
 * the lower right of every silhouette is the shaded tone.
 *
 * `size` is the half-extent in pixels: a belt item is about 5, an inventory
 * icon about 14. Detail that would collapse into mush is dropped below a
 * threshold rather than drawn at a fraction of a pixel.
 */
export function drawItem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  item: ItemId,
): void {
  const def = ITEMS[item];
  SHAPES[def.shape](ctx, x, y, size, def.color);
}

type ShapeFn = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
) => void;

/** Lit tone, shaded tone, and the thin dark outline every shape is drawn with. */
function tones(color: string): { lit: string; shade: string; line: string } {
  return { lit: shift(color, 16), shade: shift(color, -30), line: rgba('#10141a', 0.45) };
}

function outline(ctx: CanvasRenderingContext2D, s: number, line: string): void {
  if (s < 4) return;
  ctx.lineWidth = Math.max(0.6, s * 0.09);
  ctx.strokeStyle = line;
  ctx.stroke();
}

/** A jagged mined lump. Fixed vertices, so a stack never shimmers between frames. */
const CHUNK: Array<[number, number]> = [
  [-0.92, -0.1],
  [-0.55, -0.78],
  [0.18, -0.95],
  [0.85, -0.42],
  [0.95, 0.35],
  [0.4, 0.92],
  [-0.42, 0.85],
];

function chunk(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  ctx.beginPath();
  ctx.moveTo(x + CHUNK[0][0] * s, y + CHUNK[0][1] * s);
  for (let i = 1; i < CHUNK.length; i++) ctx.lineTo(x + CHUNK[i][0] * s, y + CHUNK[i][1] * s);
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  // A facet across the top left is what makes the lump read as solid rock.
  ctx.beginPath();
  ctx.moveTo(x - 0.92 * s, y - 0.1 * s);
  ctx.lineTo(x - 0.55 * s, y - 0.78 * s);
  ctx.lineTo(x + 0.18 * s, y - 0.95 * s);
  ctx.lineTo(x + 0.15 * s, y - 0.12 * s);
  ctx.closePath();
  ctx.fillStyle = lit;
  ctx.fill();
}

/** A smooth raw-metal lump: rounder than a chunk, so ore and metal differ. */
function nugget(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
): void {
  const { lit, shade, line } = tones(color);
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.08, s * 0.95, s * 0.72, -0.18, 0, Math.PI * 2);
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.ellipse(x - s * 0.22, y - s * 0.22, s * 0.55, s * 0.34, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = lit;
  ctx.fill();
}

function log(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  const h = s * 0.52;
  ctx.beginPath();
  ctx.roundRect(x - s * 0.95, y - h, s * 1.9, h * 2, h);
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  // The cut end, so a log is never mistaken for a plain capsule.
  ctx.beginPath();
  ctx.ellipse(x - s * 0.62, y, h * 0.62, h * 0.82, 0, 0, Math.PI * 2);
  ctx.fillStyle = lit;
  ctx.fill();
  if (s >= 7) {
    ctx.beginPath();
    ctx.ellipse(x - s * 0.62, y, h * 0.26, h * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = shade;
    ctx.fill();
  }
}

/** Three loose strands. Thin, so it never reads as a solid body. */
function strand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
): void {
  const { lit, shade } = tones(color);
  const w = Math.max(1, s * 0.22);
  const rows: Array<[number, number, string]> = [
    [-0.62, 0.9, lit],
    [0, 1, color],
    [0.62, 0.78, shade],
  ];
  for (const [dy, len, tone] of rows) {
    ctx.beginPath();
    ctx.roundRect(x - s * len, y + dy * s * 0.6 - w / 2, s * len * 2, w, w / 2);
    ctx.fillStyle = tone;
    ctx.fill();
  }
}

function orb(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  ctx.beginPath();
  ctx.arc(x, y, s * 0.88, 0, Math.PI * 2);
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.arc(x - s * 0.18, y - s * 0.18, s * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = lit;
  ctx.fill();
}

function fish(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  // Body: a pointed oval swimming left, with a forked tail behind it.
  ctx.beginPath();
  ctx.moveTo(x + s * 0.28, y);
  ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.66, x - s * 0.95, y);
  ctx.quadraticCurveTo(x - s * 0.1, y + s * 0.66, x + s * 0.28, y);
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.moveTo(x + s * 0.26, y);
  ctx.lineTo(x + s * 0.92, y - s * 0.54);
  ctx.lineTo(x + s * 0.92, y + s * 0.54);
  ctx.closePath();
  ctx.fillStyle = lit;
  ctx.fill();
  outline(ctx, s, line);

  if (s >= 7) {
    ctx.beginPath();
    ctx.arc(x - s * 0.58, y - s * 0.08, s * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = rgba('#10141a', 0.7);
    ctx.fill();
  }
}

/** A rolled sheet: flat, wide, with a lit top face. */
function plate(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  const h = s * 0.38;
  ctx.beginPath();
  ctx.roundRect(x - s * 0.92, y - h, s * 1.84, h * 2, s * 0.14);
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.roundRect(x - s * 0.78, y - h * 0.8, s * 1.56, h * 0.9, s * 0.1);
  ctx.fillStyle = lit;
  ctx.fill();
}

/** A cast brick: a trapezoid, so steel never reads as one more flat plate. */
function ingot(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  const top = s * 0.42;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.62, y - top);
  ctx.lineTo(x + s * 0.62, y - top);
  ctx.lineTo(x + s * 0.95, y + top);
  ctx.lineTo(x - s * 0.95, y + top);
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.moveTo(x - s * 0.62, y - top);
  ctx.lineTo(x + s * 0.62, y - top);
  ctx.lineTo(x + s * 0.72, y - top * 0.1);
  ctx.lineTo(x - s * 0.72, y - top * 0.1);
  ctx.closePath();
  ctx.fillStyle = lit;
  ctx.fill();
}

function gear(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  const teeth = 8;
  const outer = s * 0.95;
  const inner = s * 0.68;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.arc(x, y, s * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = lit;
  ctx.fill();

  // The bore. Below this size it would be a single dark pixel in the middle.
  if (s >= 5) {
    ctx.beginPath();
    ctx.arc(x, y, s * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = rgba('#10141a', 0.55);
    ctx.fill();
  }
}

/** Wire on a spool: concentric arcs, which read as coiled even when tiny. */
function coil(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade } = tones(color);
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, s * 0.24);
  ctx.strokeStyle = shade;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.82, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = lit;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  // The loose end, so the coil is clearly wire rather than a ring.
  if (s >= 6) {
    ctx.strokeStyle = shade;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.8, y - s * 0.18);
    ctx.lineTo(x + s * 1.02, y - s * 0.72);
    ctx.stroke();
  }
}

/** A printed board: a square with a lit edge and traces across it. */
function board(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  ctx.beginPath();
  ctx.roundRect(x - s * 0.82, y - s * 0.78, s * 1.64, s * 1.56, s * 0.16);
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.roundRect(x - s * 0.66, y - s * 0.62, s * 1.32, s * 0.7, s * 0.1);
  ctx.fillStyle = lit;
  ctx.fill();

  if (s < 7) return;
  ctx.lineWidth = Math.max(0.8, s * 0.12);
  ctx.strokeStyle = rgba('#10141a', 0.5);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y + s * 0.34);
  ctx.lineTo(x + s * 0.12, y + s * 0.34);
  ctx.lineTo(x + s * 0.12, y + s * 0.62);
  ctx.moveTo(x + s * 0.48, y + s * 0.2);
  ctx.lineTo(x + s * 0.48, y + s * 0.62);
  ctx.stroke();
}

/** A packaged die with legs down both sides. */
function chip(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  const legs = Math.max(1, s * 0.2);
  ctx.fillStyle = shade;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.roundRect(x - s * 0.98, y + i * s * 0.44 - legs / 2, s * 1.96, legs, legs / 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.roundRect(x - s * 0.66, y - s * 0.66, s * 1.32, s * 1.32, s * 0.16);
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.roundRect(x - s * 0.5, y - s * 0.5, s * 1.0, s * 0.62, s * 0.1);
  ctx.fillStyle = lit;
  ctx.fill();
}

/** A cell standing upright, with a terminal on top. */
function cell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  ctx.beginPath();
  ctx.roundRect(x - s * 0.44, y - s * 0.72, s * 0.88, s * 1.52, s * 0.14);
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.roundRect(x - s * 0.3, y - s * 0.6, s * 0.32, s * 1.3, s * 0.1);
  ctx.fillStyle = lit;
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(x - s * 0.2, y - s * 0.95, s * 0.4, s * 0.26, s * 0.08);
  ctx.fillStyle = lit;
  ctx.fill();
  outline(ctx, s, line);
}

/** A drum on its side with a shaft out of the front. */
function motor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);
  ctx.beginPath();
  ctx.roundRect(x - s * 0.9, y - s * 0.6, s * 1.5, s * 1.2, s * 0.2);
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  ctx.beginPath();
  ctx.roundRect(x - s * 0.76, y - s * 0.46, s * 1.22, s * 0.4, s * 0.14);
  ctx.fillStyle = lit;
  ctx.fill();

  // Shaft, drawn in the same grey as the gear so it reads as bare metal.
  ctx.beginPath();
  ctx.roundRect(x + s * 0.56, y - s * 0.16, s * 0.42, s * 0.32, s * 0.1);
  ctx.fillStyle = shift('#9aa4ae', 10);
  ctx.fill();
  outline(ctx, s, line);
}

/**
 * A round-bottomed flask with a stopper. Research packs are the only items that
 * are not a part or a material, and a silhouette nothing else on a belt shares
 * is what says so at a glance.
 */
function flask(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string): void {
  const { lit, shade, line } = tones(color);

  ctx.beginPath();
  ctx.moveTo(x - s * 0.26, y - s * 0.85);
  ctx.lineTo(x - s * 0.26, y - s * 0.2);
  ctx.arc(x, y + s * 0.26, s * 0.72, Math.PI * 1.22, Math.PI * 1.78, true);
  ctx.lineTo(x + s * 0.26, y - s * 0.85);
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
  outline(ctx, s, line);

  // The liquid catches the light on its left, the way every other shape does.
  ctx.beginPath();
  ctx.arc(x - s * 0.14, y + s * 0.2, s * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = lit;
  ctx.fill();

  if (s < 5) return;
  ctx.beginPath();
  ctx.roundRect(x - s * 0.34, y - s * 0.98, s * 0.68, s * 0.24, s * 0.08);
  ctx.fillStyle = shift('#d8cbb0', 0);
  ctx.fill();
  outline(ctx, s, line);
}

const SHAPES: Record<ItemShape, ShapeFn> = {
  chunk,
  nugget,
  log,
  strand,
  orb,
  fish,
  plate,
  ingot,
  gear,
  coil,
  board,
  chip,
  cell,
  motor,
  flask,
};

/**
 * Out in the world an item is drawn thousands of times a frame — a belt field
 * filling the viewport is a few thousand of them — and every shape above is
 * several path fills and a stroke. Tracing them per item cost 67ms a frame on
 * a full screen of belts against 37ms for the single blob they replaced, so
 * each silhouette is baked once into a small canvas and blitted after that.
 *
 * The bake is at device resolution, which the renderer reports once a frame
 * through `setItemScale`; the size is quantised so a zoom nudge on resize does
 * not rebuild the set.
 */
const sprites = new Map<string, HTMLCanvasElement>();
let worldScale = 1;

/** How much of the sprite's box the silhouette fills, leaving room for the
 * shapes that reach past their own radius (a coil's loose end) and for the
 * outline stroke. */
const FIT = 0.84;

export function setItemScale(scale: number): void {
  worldScale = scale;
}

/** Draw an item in the world: the same silhouette, from a cached sprite. */
export function drawItemSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  item: ItemId,
): void {
  const box = (size * 2) / FIT;
  const px = Math.max(12, Math.ceil((box * worldScale) / 6) * 6);
  const key = `${item}:${px}`;

  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = px;
    sprite.height = px;
    const bake = sprite.getContext('2d');
    if (!bake) {
      drawItem(ctx, x, y, size, item);
      return;
    }
    drawItem(bake, px / 2, px / 2, (px / 2) * FIT, item);
    sprites.set(key, sprite);
  }

  ctx.drawImage(sprite, x - box / 2, y - box / 2, box, box);
}

/**
 * The same drawing again, as a data URL, so DOM slots show exactly what the
 * belt shows. Every icon is baked once into a `--icon-<id>` custom property on
 * the document, which keeps the slot markup to one `var()` instead of an
 * inlined data URL repeated in forty cells on every repaint.
 */
const ICON_PX = 96;
let installed = false;

export function itemIconVar(item: ItemId): string {
  installItemIcons();
  return `var(--icon-${item})`;
}

export function installItemIcons(): void {
  if (installed) return;
  installed = true;

  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const lines: string[] = [];
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    ctx.clearRect(0, 0, ICON_PX, ICON_PX);
    // A margin keeps the widest shapes and their outlines off the edge.
    drawItem(ctx, ICON_PX / 2, ICON_PX / 2, ICON_PX * 0.44, id);
    lines.push(`--icon-${id}: url(${canvas.toDataURL()});`);
  }

  const style = document.createElement('style');
  style.textContent = `:root {\n${lines.join('\n')}\n}`;
  document.head.appendChild(style);
}
