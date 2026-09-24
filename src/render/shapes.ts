import { hash2 } from '@shared/sim/rng';
import { rgba } from './palette';

/** Scratch vertex buffers, reused so a forest of blobs allocates nothing. */
const VERTS: number[] = [];

function polygonVerts(
  out: number[],
  x: number,
  y: number,
  radius: number,
  sides: number,
  seed: number,
  wobble: number,
  rotation: number,
): void {
  out.length = 0;
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    const r = radius * (1 - wobble * 0.5 + hash2(i, seed, seed + 13) * wobble);
    out.push(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
}

function trace(ctx: CanvasRenderingContext2D, verts: number[]): void {
  ctx.moveTo(verts[0], verts[1]);
  for (let i = 2; i < verts.length; i += 2) ctx.lineTo(verts[i], verts[i + 1]);
  ctx.closePath();
}

/** Draw an irregular polygon — the base primitive for every low-poly object. */
export function polygon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  seed: number,
  wobble = 0.22,
  rotation = 0,
): void {
  polygonVerts(VERTS, x, y, radius, sides, seed, wobble, rotation);
  ctx.beginPath();
  trace(ctx, VERTS);
}

export function shadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha = 0.22,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#10141a';
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Small filled bar used for health and harvest progress in the world. */
export function meter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fraction: number,
  color: string,
): void {
  const f = Math.max(0, Math.min(1, fraction));
  ctx.fillStyle = rgba('#10141a', 0.55);
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y, width, height, height / 2);
  ctx.fill();

  if (f <= 0) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y, width * f, height, height / 2);
  ctx.fill();
}
