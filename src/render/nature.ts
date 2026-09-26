import type { ResourceNode } from '@shared/sim/types';
import { drawLandmark } from './landmarks';
import { INK, blitCached, fillInk, litFill, rand, softShadow, tone } from './paint';

/**
 * Trees, rocks, bushes and fishing spots.
 *
 * An island holds hundreds of these, so each is painted once per variant into
 * a bitmap and blitted after that. That is what buys the detail: a canopy of
 * shaded leaf clusters costs the same per frame as the flat blob it replaced.
 * Only the canopy is split off from its trunk, so it can sway in the wind.
 */

const VARIANTS = 6;

function variantOf(node: ResourceNode): number {
  return Math.floor(rand(node.seed, 17) * VARIANTS);
}

/** When each node was last struck by a tool, in render time. Cosmetic only. */
const struck = new Map<number, number>();

/** A tool just bit into this node: it shudders for a moment. */
export function strikeNode(id: number, time: number): void {
  struck.set(id, time);
  if (struck.size > 64) {
    for (const [key, at] of struck) if (time - at > 1) struck.delete(key);
  }
}

/**
 * How far a struck node is thrown sideways right now: a hard first kick that
 * rings down over a third of a second, the way a trunk takes an axe.
 */
function shudder(id: number, time: number): number {
  const at = struck.get(id);
  if (at === undefined) return 0;
  const t = time - at;
  if (t < 0 || t > 0.35) return 0;
  return Math.sin(t * 55) * 2.6 * (1 - t / 0.35) ** 2;
}

/**
 * Sprite names, boxes and bake callbacks, made once per variant. Building a
 * name string, a box and a closure for every tree on screen every frame was
 * most of the garbage a frame made.
 */
const byVariant = <T>(make: (v: number) => T): T[] => Array.from({ length: VARIANTS }, (_, v) => make(v));
const isPine = (v: number): boolean => v >= 4;
const TRUNK_BOX = { left: 30, right: 34, top: 36, bottom: 12 };
const CROWN_BOX = { left: 31, right: 31, top: 80, bottom: 4 };
const ROCK_BOX = { left: 24, right: 26, top: 30, bottom: 10 };
const BUSH_BOX = { left: 20, right: 22, top: 24, bottom: 8 };
const STUMP_BOX = { left: 18, right: 18, top: 18, bottom: 8 };
const TRUNK = byVariant((v) => ({ key: `trunk:${v}`, bake: (c: CanvasRenderingContext2D) => drawTrunk(c, v, isPine(v)) }));
const CROWN = byVariant((v) => ({
  key: `crown:${v}`,
  bake: (c: CanvasRenderingContext2D) => (isPine(v) ? drawPineCrown(c, v) : drawBroadleafCrown(c, v)),
}));
const ROCK = byVariant((v) => ({ key: `rock:${v}`, bake: (c: CanvasRenderingContext2D) => drawBoulder(c, v) }));
const BUSH = byVariant((v) => ({ key: `bush:${v}`, bake: (c: CanvasRenderingContext2D) => drawBush(c, v) }));
const stumps = new Map<string, { key: string; bake: (c: CanvasRenderingContext2D) => void }[]>();
function stumpOf(kind: ResourceNode['kind'], v: number): { key: string; bake: (c: CanvasRenderingContext2D) => void } {
  let row = stumps.get(kind);
  if (!row) {
    row = byVariant((w) => ({ key: `stump:${kind}:${w}`, bake: (c: CanvasRenderingContext2D) => drawStump(c, kind, w) }));
    stumps.set(kind, row);
  }
  return row[v];
}

export function drawNature(ctx: CanvasRenderingContext2D, node: ResourceNode, time: number): void {
  const { y } = node.pos;
  const jolt = shudder(node.id, time);
  const x = node.pos.x + (node.kind === 'tree' ? jolt * 0.35 : jolt);
  const v = variantOf(node);

  if (node.charges <= 0) {
    const stump = stumpOf(node.kind, v);
    blitCached(ctx, stump.key, x, y, STUMP_BOX, stump.bake);
    return;
  }

  switch (node.kind) {
    case 'tree': {
      blitCached(ctx, TRUNK[v].key, x, y, TRUNK_BOX, TRUNK[v].bake);
      // The crown swings further than the trunk, which is rooted.
      const sway = Math.sin(time * 0.9 + node.seed) * 1.1 + jolt * 1.4;
      blitCached(ctx, CROWN[v].key, x + sway, y, CROWN_BOX, CROWN[v].bake);
      break;
    }
    case 'rock':
      blitCached(ctx, ROCK[v].key, x, y, ROCK_BOX, ROCK[v].bake);
      break;
    case 'bush': {
      const sway = Math.sin(time * 1.1 + node.seed) * 0.5;
      blitCached(ctx, BUSH[v].key, x + sway, y, BUSH_BOX, BUSH[v].bake);
      break;
    }
    case 'fish':
      drawFishing(ctx, node, time);
      break;
    default:
      drawLandmark(ctx, node, time);
      return;
  }

  if (node.charges < node.maxCharges) {
    harvestBar(ctx, node.pos.x, y + 11, 26, node.charges / node.maxCharges);
  }
}

function harvestBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, f: number): void {
  ctx.fillStyle = 'rgba(14, 16, 24, 0.7)';
  ctx.beginPath();
  ctx.roundRect(x - width / 2 - 1, y - 1, width + 2, 5, 2.5);
  ctx.fill();
  ctx.fillStyle = '#9be07e';
  ctx.beginPath();
  ctx.roundRect(x - width / 2, y, width * Math.max(0, Math.min(1, f)), 3, 1.5);
  ctx.fill();
}

// ─── Foliage ────────────────────────────────────────────────────────────────

interface Leafage {
  light: string;
  mid: string;
  dark: string;
  ink: string;
}

/** A few greens, so a forest is not one colour: spring, deep, olive, and cool. */
const LEAVES: Leafage[] = [
  { light: '#a6d17a', mid: '#5f9a4c', dark: '#2e5a33', ink: '#15261a' },
  { light: '#92c46e', mid: '#4d8a47', dark: '#244d30', ink: '#122317' },
  { light: '#c2cf73', mid: '#7f9a45', dark: '#44592a', ink: '#1f2714' },
  { light: '#8cc79a', mid: '#44896a', dark: '#1f4a3c', ink: '#0f231c' },
];

/**
 * A leaf cluster: a circle with a scalloped rim, lit from the upper left,
 * with leaf-edge highlights along the sunny side.
 */
function cluster(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, seed: number, leaf: Leafage): void {
  const bumps = 9;
  const path = (grow: number): void => {
    ctx.beginPath();
    for (let i = 0; i <= bumps; i++) {
      const a = (i / bumps) * Math.PI * 2 + seed;
      const wob = 1 + (rand(seed * 7, i % bumps) - 0.5) * 0.14;
      const px = cx + Math.cos(a) * r * wob * grow;
      const py = cy + Math.sin(a) * r * wob * grow;
      if (i === 0) {
        ctx.moveTo(px, py);
        continue;
      }
      const m = a - Math.PI / bumps;
      ctx.quadraticCurveTo(cx + Math.cos(m) * r * 1.22 * grow, cy + Math.sin(m) * r * 1.22 * grow, px, py);
    }
    ctx.closePath();
  };
  path(1);
  const g = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.1, cx, cy, r * 1.25);
  g.addColorStop(0, leaf.light);
  g.addColorStop(0.5, leaf.mid);
  g.addColorStop(1, leaf.dark);
  ctx.fillStyle = g;
  ctx.fill();

  // Leaf tips catching the sun along the lit rim.
  ctx.fillStyle = tone(leaf.light, 0.15);
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (1.05 + rand(seed, i + 40) * 0.75);
    const d = r * (0.55 + rand(seed, i + 60) * 0.35);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * 0.16, r * 0.09, a + 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // And a few dark gaps on the shaded side.
  ctx.fillStyle = leaf.dark;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * (0.05 + rand(seed, i + 80) * 0.7);
    const d = r * (0.45 + rand(seed, i + 90) * 0.35);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * 0.13, r * 0.08, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The outline of a group of clusters, drawn once behind all of them. */
function clusterInk(ctx: CanvasRenderingContext2D, blobs: [number, number, number][], ink: string, width: number): void {
  ctx.fillStyle = ink;
  ctx.beginPath();
  for (const [cx, cy, r] of blobs) {
    ctx.moveTo(cx + r * 1.08 + width, cy);
    ctx.arc(cx, cy, r * 1.08 + width, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawTrunk(ctx: CanvasRenderingContext2D, v: number, pine: boolean): void {
  // Sun from the upper left throws the tree's shadow down and to the right.
  softShadow(ctx, 7, 1, 20, 0.3, 8);
  softShadow(ctx, 0, 0, 9, 0.4, 3.5);

  const bark = pine ? '#6a4b38' : '#76553a';
  const top = pine ? -20 : -24;
  const w = pine ? 3.4 : 4.2;
  ctx.beginPath();
  ctx.moveTo(-w - 2.6, 1.5);
  ctx.quadraticCurveTo(-w, -2, -w * 0.75, top);
  ctx.lineTo(w * 0.75, top);
  ctx.quadraticCurveTo(w, -2, w + 2.8, 1.5);
  ctx.quadraticCurveTo(0, 3, -w - 2.6, 1.5);
  ctx.closePath();
  fillInk(ctx, litFill(ctx, bark, -w - 2, top, w + 2, 0, 0.2, -0.4), 1.2);

  // Bark grain.
  ctx.strokeStyle = tone(bark, -0.4);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const gx = -w * 0.4 + i * w * 0.45 + (rand(v, i) - 0.5);
    ctx.moveTo(gx, top + 4 + rand(v, i + 3) * 4);
    ctx.lineTo(gx + (rand(v, i + 6) - 0.5) * 1.5, -2 - rand(v, i + 9) * 4);
  }
  ctx.stroke();

  if (!pine) {
    // Two limbs reaching up into the crown.
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.moveTo(-1, top + 3);
    ctx.lineTo(-7, top - 7);
    ctx.moveTo(1.5, top + 2);
    ctx.lineTo(6.5, top - 9);
    ctx.stroke();
    ctx.strokeStyle = tone(bark, -0.05);
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
}

function drawBroadleafCrown(ctx: CanvasRenderingContext2D, v: number): void {
  const leaf = LEAVES[v % LEAVES.length];
  const cy = -40 - rand(v, 1) * 4;
  const blobs: [number, number, number][] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rand(v, i + 20) * 0.6;
    const d = 9 + rand(v, i + 30) * 4;
    blobs.push([Math.cos(a) * d * 1.15, cy + Math.sin(a) * d * 0.8, 9 + rand(v, i + 10) * 3.5]);
  }
  blobs.push([0, cy - 3, 12]);
  blobs.push([-2, cy - 12, 9.5]);
  // Back to front, so lower clusters overlap the ones behind them.
  blobs.sort((a, b) => a[1] - b[1]);

  clusterInk(ctx, blobs, leaf.ink, 1.2);
  // A darker underlayer where the crown's own shadow falls.
  ctx.fillStyle = leaf.dark;
  ctx.beginPath();
  for (const [bx, by, r] of blobs) {
    ctx.moveTo(bx + r, by + 1.5);
    ctx.arc(bx, by + 1.5, r, 0, Math.PI * 2);
  }
  ctx.fill();
  blobs.forEach(([bx, by, r], i) => cluster(ctx, bx, by, r, v * 31 + i * 7 + 1, leaf));
}

function drawPineCrown(ctx: CanvasRenderingContext2D, v: number): void {
  const leaf: Leafage = { light: '#7fb58a', mid: '#3f7a5a', dark: '#1d4436', ink: '#0d1f19' };
  const tiers = 4;
  const base = -14;
  const height = 54 + rand(v, 2) * 8;
  // Outline pass, then tiers from the top down, each overlapping the one below.
  const tierShape = (i: number, grow: number): void => {
    const t = i / tiers;
    const ty = base - height * (1 - t) * 0.82;
    const w = (7 + t * 15) * grow;
    const h = height * 0.34 * grow;
    const jag = 5;
    ctx.beginPath();
    ctx.moveTo(0, ty - h);
    for (let k = 0; k <= jag; k++) {
      const f = k / jag;
      ctx.lineTo(w * f, ty - h + h * f + (k % 2 ? -1.5 : 1));
    }
    ctx.quadraticCurveTo(0, ty + 3.5 * grow, -w, ty);
    for (let k = jag; k >= 0; k--) {
      const f = k / jag;
      ctx.lineTo(-w * f, ty - h + h * f + (k % 2 ? -1.5 : 1));
    }
    ctx.closePath();
  };
  for (let i = 0; i < tiers; i++) {
    tierShape(i + 1, 1);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = leaf.ink;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  for (let i = 0; i < tiers; i++) {
    tierShape(i + 1, 1);
    const t = (i + 1) / tiers;
    const ty = base - height * (1 - t) * 0.82;
    ctx.fillStyle = litFill(ctx, leaf.mid, -18, ty - 18, 18, ty + 2, 0.35, -0.45);
    ctx.fill();
    // Needles catching light on the sunny slope.
    ctx.strokeStyle = leaf.light;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const f = 0.25 + k * 0.18;
      const w = 7 + t * 15;
      const lx = -w * f;
      const ly = ty - height * 0.34 * (1 - f);
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + 2.5, ly + 2.2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawBush(ctx: CanvasRenderingContext2D, v: number): void {
  softShadow(ctx, 3, 1, 15, 0.34, 5.5);
  const leaf = LEAVES[(v + 1) % LEAVES.length];
  const blobs: [number, number, number][] = [
    [-6, -7, 7 + rand(v, 1) * 1.5],
    [6, -7, 7 + rand(v, 2) * 1.5],
    [0, -12, 8 + rand(v, 3) * 1.5],
    [0, -5, 7.5],
  ];
  blobs.sort((a, b) => a[1] - b[1]);
  clusterInk(ctx, blobs, leaf.ink, 1.1);
  blobs.forEach(([bx, by, r], i) => cluster(ctx, bx, by, r, v * 13 + i * 5 + 3, leaf));

  // Berries, clustered in threes, each with a highlight.
  for (let i = 0; i < 5; i++) {
    const bx = (rand(v, i + 50) - 0.5) * 20;
    const by = -4 - rand(v, i + 60) * 12;
    for (let k = 0; k < 3; k++) {
      const ox = bx + (k === 1 ? 1.6 : k === 2 ? -0.6 : 0);
      const oy = by + (k === 0 ? 0 : 1.6);
      ctx.beginPath();
      ctx.arc(ox, oy, 1.65, 0, Math.PI * 2);
      fillInk(ctx, litFill(ctx, '#d8435a', ox - 1.5, oy - 1.5, ox + 1.5, oy + 1.5, 0.3, -0.35), 0.7, '#3a0f18');
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(ox - 0.9, oy - 0.9, 0.6, 0.6);
    }
  }
}

// ─── Stone ──────────────────────────────────────────────────────────────────

const STONE = '#939aa5';

/** A chiselled boulder: a rounded hull, a lit top facet, cracks, sometimes moss. */
function boulder(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, seed: number, mossy: boolean): void {
  const n = 8;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(seed, 99) * 0.5;
    const k = 0.82 + rand(seed, i) * 0.26;
    // Flatten the base: boulders sit, they do not balance.
    const py = Math.sin(a) > 0 ? Math.sin(a) * 0.55 : Math.sin(a);
    pts.push([cx + Math.cos(a) * rx * k, cy + py * ry * k]);
  }
  const hull = (): void => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % n];
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.quadraticCurveTo(ax, ay, mx, my);
    }
    const [ax, ay] = pts[0];
    const [bx, by] = pts[1];
    ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    ctx.closePath();
  };
  hull();
  fillInk(ctx, litFill(ctx, STONE, cx - rx, cy - ry, cx + rx, cy + ry * 0.6, 0.12, -0.42), 1.3);

  // The top facet: the same hull pulled up and in, lit strongly.
  ctx.save();
  hull();
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.18, cy - ry * 0.55, rx * 0.78, ry * 0.62, -0.15, 0, Math.PI * 2);
  ctx.fillStyle = litFill(ctx, tone(STONE, 0.2), cx - rx, cy - ry, cx + rx * 0.4, cy, 0.25, -0.05);
  ctx.fill();
  // Facet edge.
  ctx.strokeStyle = tone(STONE, -0.3);
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Cracks.
  ctx.strokeStyle = tone(STONE, -0.5);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  const kx = cx + (rand(seed, 40) - 0.3) * rx * 0.8;
  ctx.moveTo(kx, cy - ry * 0.35);
  ctx.lineTo(kx + rx * 0.12, cy);
  ctx.lineTo(kx + rx * 0.02, cy + ry * 0.3);
  ctx.moveTo(kx + rx * 0.12, cy);
  ctx.lineTo(kx + rx * 0.3, cy + ry * 0.08);
  ctx.stroke();

  if (mossy) {
    ctx.fillStyle = '#6d9a4e';
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 9; i++) {
      const mx = cx - rx * 0.55 + rand(seed, i + 70) * rx * 0.9;
      const my = cy - ry * 0.95 + rand(seed, i + 80) * ry * 0.45;
      ctx.beginPath();
      ctx.ellipse(mx, my, 2.4 + rand(seed, i) * 1.6, 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#9cc46e';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(cx - rx * 0.45 + rand(seed, i + 110) * rx * 0.7, cy - ry * 0.9 + rand(seed, i + 120) * ry * 0.3, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // A glint on the sunny corner.
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx - rx * 0.45, cy - ry * 0.7, rx * 0.16, ry * 0.08, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawBoulder(ctx: CanvasRenderingContext2D, v: number): void {
  softShadow(ctx, 5, 1, 21, 0.38, 7);
  const mossy = v % 3 === 0;
  boulder(ctx, -1, -9, 15, 12, v * 11 + 1, mossy);
  // A companion stone, and a pebble or two.
  if (v % 2 === 0) boulder(ctx, 11, -2, 7.5, 6, v * 11 + 5, false);
  else boulder(ctx, -13, -1, 6.5, 5, v * 11 + 7, v === 5);
  ctx.fillStyle = tone(STONE, -0.1);
  for (let i = 0; i < 3; i++) {
    const px = -16 + rand(v, i + 3) * 32;
    const py = 2 + rand(v, i + 5) * 3;
    ctx.beginPath();
    ctx.ellipse(px, py, 1.6, 1.1, 0, 0, Math.PI * 2);
    fillInk(ctx, tone(STONE, -0.05), 0.6);
  }
}

// ─── Remains ────────────────────────────────────────────────────────────────

function drawStump(ctx: CanvasRenderingContext2D, kind: ResourceNode['kind'], v: number): void {
  switch (kind) {
    case 'tree': {
      softShadow(ctx, 2, 1, 10, 0.3, 4);
      const bark = '#6e4f37';
      ctx.beginPath();
      ctx.moveTo(-6.5, 1.5);
      ctx.lineTo(-5, -7);
      ctx.lineTo(5, -7);
      ctx.lineTo(6.5, 1.5);
      ctx.quadraticCurveTo(0, 3.2, -6.5, 1.5);
      ctx.closePath();
      fillInk(ctx, litFill(ctx, bark, -6, -7, 6, 1), 1.1);
      ctx.beginPath();
      ctx.ellipse(0, -7, 5, 2.2, 0, 0, Math.PI * 2);
      fillInk(ctx, '#d9b27c', 1);
      ctx.strokeStyle = '#a97f4f';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(0, -7, 3.2, 1.3, 0, 0, Math.PI * 2);
      ctx.moveTo(1.4, -7);
      ctx.ellipse(0, -7, 1.4, 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'rock':
      softShadow(ctx, 2, 1, 12, 0.3, 4);
      for (let i = 0; i < 4; i++) {
        const px = -7 + rand(v, i) * 14;
        const py = -2 + rand(v, i + 4) * 3;
        ctx.beginPath();
        ctx.ellipse(px, py, 2.6 + rand(v, i + 8) * 1.4, 1.9, 0, 0, Math.PI * 2);
        fillInk(ctx, litFill(ctx, STONE, px - 3, py - 2, px + 3, py + 2), 0.9);
      }
      break;
    case 'bush':
      softShadow(ctx, 2, 1, 10, 0.28, 4);
      ctx.strokeStyle = '#5a4432';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.4;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 8);
      }
      ctx.stroke();
      ctx.fillStyle = '#5f8a4a';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(-5 + i * 3.4, -5 - rand(v, i) * 4, 1.6, 1, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'fish':
      ctx.strokeStyle = 'rgba(223, 242, 251, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
}

// ─── Water ──────────────────────────────────────────────────────────────────

/** A shoal: dark shapes circling under the surface, and rings where they rise. */
function drawFishing(ctx: CanvasRenderingContext2D, node: ResourceNode, time: number): void {
  const { x, y } = node.pos;
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.45 + i / 3 + node.seed * 0.001) % 1;
    ctx.strokeStyle = `rgba(223, 242, 251, ${0.5 * (1 - t)})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, 5 + t * 15, (5 + t * 15) * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(12, 40, 60, 0.45)';
  for (let i = 0; i < 2; i++) {
    const a = time * (0.9 + i * 0.3) + node.seed + i * Math.PI;
    const fx = x + Math.cos(a) * 8;
    const fy = y + Math.sin(a) * 3.5;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4, 1.6, 0, 0, Math.PI * 2);
    ctx.moveTo(-3.5, 0);
    ctx.lineTo(-6, -1.6);
    ctx.lineTo(-6, 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // Now and then one breaks the surface.
  const leap = (time * 0.3 + node.seed * 0.01) % 1;
  if (leap < 0.08) {
    const k = leap / 0.08;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI - Math.PI;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 5 * k, y - Math.sin(-a) * 6 * k - 2, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
