import { hash2 } from '@shared/sim/rng';
import { rgba, shift } from './palette';

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
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    const r = radius * (1 - wobble * 0.5 + hash2(i, seed, seed + 13) * wobble);
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Two-tone fill: the lit half and the shadowed half of the same silhouette,
 * which is what sells a flat shape as a faceted one.
 */
export function facetedBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  seed: number,
  color: string,
  wobble = 0.22,
): void {
  polygon(ctx, x, y, radius, sides, seed, wobble);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = shift(color, -22);
  ctx.beginPath();
  // Light comes from the upper left, so shade the lower right.
  ctx.moveTo(x - radius * 1.2, y + radius * 0.25);
  ctx.lineTo(x + radius * 1.4, y - radius * 0.55);
  ctx.lineTo(x + radius * 1.4, y + radius * 1.4);
  ctx.lineTo(x - radius * 1.2, y + radius * 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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
