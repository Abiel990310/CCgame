import type { ResourceNode } from '@shared/sim/types';
import { INK, blitCached, fillInk, litFill, rand, softShadow, tone } from './paint';

/**
 * Landmarks: places on the mainland worth the walk. Each has a silhouette
 * nothing else on the island shares, and the rarer ones glow, so a player
 * spots one from the edge of the screen and goes to look.
 */
/** Drawn a size up from the scenery, so a landmark stands out among the rocks round it. */
const S = 1.3;

const box = (left: number, right: number, top: number, bottom: number) => ({
  left: left * S,
  right: right * S,
  top: top * S,
  bottom: bottom * S,
});

function bake(draw: (c: CanvasRenderingContext2D) => void): (c: CanvasRenderingContext2D) => void {
  return (c) => {
    c.scale(S, S);
    draw(c);
  };
}

export function drawLandmark(ctx: CanvasRenderingContext2D, node: ResourceNode, time: number): void {
  const { x, y } = node.pos;
  const v = Math.floor(rand(node.seed, 17) * 4);
  switch (node.kind) {
    case 'cache':
      blitCached(ctx, `lm:cache:${v}`, x, y, box(18, 18, 16, 8), bake((c) => drawCache(c, v)));
      break;
    case 'ruin':
      blitCached(ctx, `lm:ruin:${v}`, x, y, box(34, 34, 44, 12), bake((c) => drawRuin(c, v)));
      break;
    case 'pod':
      blitCached(ctx, `lm:pod:${v}`, x, y, box(30, 30, 30, 10), bake((c) => drawPod(c, v)));
      beaconBlink(ctx, x + 6 * S, y - 20 * S, time, node.seed, '#ff6a5a');
      break;
    case 'shrine':
      blitCached(ctx, `lm:shrine:${v}`, x, y, box(24, 24, 46, 8), bake(drawShrine));
      shrineGlow(ctx, x, y - 36 * S, time, node.seed);
      break;
    case 'vein':
      blitCached(ctx, `lm:vein:${v}`, x, y, box(34, 34, 30, 10), bake((c) => drawVein(c, v)));
      veinGlint(ctx, x - 6 * S, y - 14 * S, time, node.seed);
      break;
    default:
      break;
  }
}

const STONE = '#9a978e';
const EARTH = '#7a5a3c';

/** A mound of turned earth with a crate corner showing and a marker stick. */
function drawCache(ctx: CanvasRenderingContext2D, v: number): void {
  softShadow(ctx, 2, 1, 14, 0.3, 5);
  ctx.beginPath();
  ctx.ellipse(0, -1, 13, 6, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, EARTH, -12, -7, 12, 4), 1);
  ctx.beginPath();
  ctx.roundRect(-5 + v, -9, 10, 7, 1.5);
  fillInk(ctx, litFill(ctx, '#b48a55', -5, -9, 5, -2), 1);
  ctx.strokeStyle = tone('#b48a55', -0.4);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-5 + v, -5.5);
  ctx.lineTo(5 + v, -5.5);
  ctx.stroke();
  // Marker: a stick with a rag tied on.
  ctx.strokeStyle = '#5a4030';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(9, -2);
  ctx.lineTo(10, -14);
  ctx.stroke();
  ctx.fillStyle = '#d0503c';
  ctx.beginPath();
  ctx.moveTo(10, -14);
  ctx.lineTo(15, -12.5);
  ctx.lineTo(10, -11);
  ctx.closePath();
  ctx.fill();
}

/** Broken columns round a cracked floor, one still standing with a lintel. */
function drawRuin(ctx: CanvasRenderingContext2D, v: number): void {
  softShadow(ctx, 3, 2, 30, 0.28, 10);
  // Floor slabs.
  ctx.beginPath();
  ctx.ellipse(0, 0, 28, 10, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, tone(STONE, -0.1), -28, -10, 28, 10, 0.15, -0.2), 1);
  ctx.strokeStyle = tone(STONE, -0.4);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-18, -3);
  ctx.lineTo(4, 5);
  ctx.moveTo(-4, -8);
  ctx.lineTo(14, 1);
  ctx.stroke();
  // Columns at the back and sides, broken at different heights.
  const cols: Array<[number, number, number]> = [
    [-20, -2, 14 + v * 2],
    [-8, -7, 30],
    [8, -7, 30],
    [21, -1, 9 + v],
  ];
  for (const [cx, cy, h] of cols) {
    ctx.beginPath();
    ctx.roundRect(cx - 4, cy - h, 8, h, 1.5);
    fillInk(ctx, litFill(ctx, STONE, cx - 4, cy - h, cx + 4, cy), 1);
    ctx.fillStyle = tone(STONE, 0.25);
    ctx.fillRect(cx - 4, cy - h, 8, 1.6);
  }
  // The lintel across the two tall ones.
  ctx.beginPath();
  ctx.roundRect(-13, -40, 26, 5, 1.5);
  fillInk(ctx, litFill(ctx, tone(STONE, 0.05), -13, -40, 13, -35), 1);
  // Ivy.
  ctx.fillStyle = '#5f8a4a';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.ellipse(-9 + rand(v, i) * 3, -30 + i * 4.5, 1.8, 1.2, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fallen drum in front.
  ctx.beginPath();
  ctx.ellipse(12, 5, 5, 3, 0.3, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, STONE, 7, 2, 17, 8), 0.9);
}

/** A scorched capsule half buried at an angle, with a hatch sprung open. */
function drawPod(ctx: CanvasRenderingContext2D, v: number): void {
  softShadow(ctx, 3, 2, 26, 0.34, 8);
  // Scorched crater.
  ctx.fillStyle = 'rgba(40, 30, 24, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 26, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.rotate(-0.35 + v * 0.05);
  ctx.beginPath();
  ctx.roundRect(-16, -14, 32, 18, 9);
  fillInk(ctx, litFill(ctx, '#c9ced6', -16, -14, 16, 4, 0.3, -0.35), 1.2);
  // Heat shield band and scorch.
  ctx.fillStyle = '#3c3a40';
  ctx.beginPath();
  ctx.roundRect(-16, -14, 8, 18, [9, 0, 0, 9]);
  ctx.fill();
  ctx.fillStyle = 'rgba(60, 40, 30, 0.35)';
  ctx.beginPath();
  ctx.ellipse(-4, -2, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Open hatch.
  ctx.beginPath();
  ctx.roundRect(0, -12, 10, 12, 2);
  fillInk(ctx, '#2a2e36', 1);
  ctx.beginPath();
  ctx.roundRect(10, -16, 4, 14, 1.5);
  fillInk(ctx, litFill(ctx, '#aeb4be', 10, -16, 14, -2), 0.9);
  // A stripe of paint.
  ctx.fillStyle = '#e07a3a';
  ctx.fillRect(-8, -13, 3, 16);
  ctx.restore();
}

/** A standing stone with a hollow at the top where the essence gathers. */
function drawShrine(ctx: CanvasRenderingContext2D): void {
  softShadow(ctx, 2, 2, 18, 0.3, 6);
  // Ring of small stones.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sx = Math.cos(a) * 16;
    const sy = Math.sin(a) * 6 + 1;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 3, 2.2, 0, 0, Math.PI * 2);
    fillInk(ctx, litFill(ctx, STONE, sx - 3, sy - 2, sx + 3, sy + 2), 0.8);
  }
  // The monolith, tapering, with carved lines.
  ctx.beginPath();
  ctx.moveTo(-8, 2);
  ctx.lineTo(-6, -36);
  ctx.quadraticCurveTo(0, -42, 6, -36);
  ctx.lineTo(8, 2);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, '#7c7a8c', -8, -40, 8, 2, 0.25, -0.35), 1.2);
  ctx.strokeStyle = '#b58cf0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(0, -8);
  ctx.moveTo(-3, -24);
  ctx.lineTo(3, -20);
  ctx.moveTo(3, -16);
  ctx.lineTo(-3, -12);
  ctx.stroke();
  ctx.strokeStyle = INK;
}

/**
 * A dark outcrop shot through with bright seams, and beside it the nest that
 * holds it: a ring of trampled earth and twigs with pale eggs in it. The seams
 * say ore from across the screen, the eggs say somebody is home.
 */
function drawVein(ctx: CanvasRenderingContext2D, v: number): void {
  softShadow(ctx, 3, 2, 30, 0.3, 9);
  // The outcrop, left of centre.
  ctx.beginPath();
  ctx.moveTo(-26, 3);
  ctx.lineTo(-24, -10);
  ctx.lineTo(-15, -22 - v);
  ctx.lineTo(-4, -17);
  ctx.lineTo(3, -4);
  ctx.lineTo(4, 4);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, '#5c5a66', -26, -22, 4, 4, 0.2, -0.35), 1.2);
  // Seams of three metals, each a short bright stroke along the rock.
  const seams: Array<[string, number, number, number, number]> = [
    ['#d28046', -21, -6, -12, -14],
    ['#8fb2e0', -14, 0, -6, -9],
    ['#e8c04c', -19, -13, -14, -18 - v * 0.5],
  ];
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const [color, x0, y0, x1, y1] of seams) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  // The nest: churned earth with twigs round the rim.
  ctx.beginPath();
  ctx.ellipse(14, 2, 15, 6.5, 0, 0, Math.PI * 2);
  fillInk(ctx, litFill(ctx, '#6a4c34', -1, -4, 29, 8, 0.1, -0.3), 1);
  ctx.strokeStyle = '#8a6a44';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand(v, i) * 0.4;
    ctx.beginPath();
    ctx.moveTo(14 + Math.cos(a) * 12, 2 + Math.sin(a) * 4.6);
    ctx.lineTo(14 + Math.cos(a) * 17, 2 + Math.sin(a) * 7.3 - 2);
    ctx.stroke();
  }
  // Eggs.
  const eggs: Array<[number, number]> = [[9, 2], [15, 0], [20, 3.5], [13, 5]];
  for (const [ex, ey] of eggs) {
    ctx.beginPath();
    ctx.ellipse(ex, ey, 3, 3.8, 0, 0, Math.PI * 2);
    fillInk(ctx, litFill(ctx, '#bfe6c4', ex - 3, ey - 4, ex + 3, ey + 4, 0.25, -0.4), 0.8);
  }
}

/** A glint crossing the vein now and then, so it catches the eye. */
function veinGlint(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
  const t = (time * 0.6 + rand(seed, 3) * 5) % 4;
  if (t > 0.5) return;
  const k = Math.sin((t / 0.5) * Math.PI);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(255, 240, 200, ${0.9 * k})`;
  ctx.lineWidth = 1.2;
  const r = 6 * k;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.restore();
}

/** The pod's distress light, blinking twice and pausing. */
function beaconBlink(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number, color: string): void {
  const t = (time + seed) % 1.6;
  const on = t < 0.12 || (t > 0.3 && t < 0.42);
  if (!on) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255, 90, 80, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 12, y - 12, 24, 24);
  ctx.restore();
}

/** Essence pooling over the shrine, with motes drifting up out of it. */
function shrineGlow(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, seed: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.75 + Math.sin(time * 1.8 + seed) * 0.25;
  const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
  g.addColorStop(0, `rgba(200, 160, 255, ${0.6 * pulse})`);
  g.addColorStop(1, 'rgba(160, 120, 240, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 26, y - 26, 52, 52);
  ctx.fillStyle = 'rgba(230, 215, 255, 0.85)';
  for (let i = 0; i < 4; i++) {
    const p = (time * 0.35 + i / 4 + rand(seed, i) * 0.2) % 1;
    ctx.globalAlpha = 1 - p;
    ctx.beginPath();
    ctx.arc(x + Math.sin(time + i * 2) * 6, y - p * 26, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
