import { hash2 } from '@shared/sim/rng';
import { rgba, shift } from './palette';

/** Scratch vertex buffers, reused so a forest of blobs allocates nothing. */
const VERTS: number[] = [];
const SHADE: number[] = [];

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

/**
 * Two-tone fill: the lit half and the shadowed half of the same silhouette,
 * which is what sells a flat shape as a faceted one.
 *
 * The shaded half is worked out as its own polygon rather than by clipping the
 * blob to a quad. A canvas clip builds a mask per call, and an island is
 * hundreds of these: on a full base that one `clip` was the difference between
 * thirty and sixty frames a second. The shape it produces is the same.
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
  polygonVerts(VERTS, x, y, radius, sides, seed, wobble, 0);
  ctx.beginPath();
  trace(ctx, VERTS);
  ctx.fillStyle = color;
  ctx.fill();

  // Light comes from the upper left, so shade everything below this line.
  const ax = x - radius * 1.2;
  const ay = y + radius * 0.25;
  const dx = radius * 2.6;
  const dy = -radius * 0.8;

  SHADE.length = 0;
  const corners = VERTS.length / 2;
  for (let i = 0; i < corners; i++) {
    const j = (i + 1) % corners;
    const cx = VERTS[i * 2];
    const cy = VERTS[i * 2 + 1];
    const nx = VERTS[j * 2];
    const ny = VERTS[j * 2 + 1];
    const here = dx * (cy - ay) - dy * (cx - ax);
    const next = dx * (ny - ay) - dy * (nx - ax);
    if (here > 0) SHADE.push(cx, cy);
    // Where an edge crosses the light line, walk to the crossing and turn.
    if (here > 0 !== next > 0) {
      const t = here / (here - next);
      SHADE.push(cx + (nx - cx) * t, cy + (ny - cy) * t);
    }
  }
  if (SHADE.length < 6) return;

  ctx.beginPath();
  trace(ctx, SHADE);
  ctx.fillStyle = shift(color, -22);
  ctx.fill();
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
