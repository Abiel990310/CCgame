import { TILE } from '@shared/sim/constants';
import { tileCenter } from '@shared/sim/grid';
import { hash2 } from '@shared/sim/rng';
import type { OreKind } from '@shared/sim/types';
import { INK, tone } from './paint';

/**
 * Ore deposits. A patch has to read as "something to mine here" from across
 * the screen, so it is two things drawn in two passes: a stained bed that
 * joins every tile of the patch into one shape, then chunky outlined ore
 * lumps on top, in the colour the ore has in the bag.
 *
 * Worked tiles keep fewer lumps, so a patch visibly hollows out from where
 * its miners stand.
 */

interface OreStyle {
  bed: string;
  rim: string;
  lump: string;
  light: string;
  glint: string;
  /** A second mineral flecked through the lumps: rust, patina, a coal sheen. */
  fleck: string;
}

const STYLE: Record<OreKind, OreStyle> = {
  ironOre: { bed: '#4d4f58', rim: '#33353d', lump: '#7f93aa', light: '#bccbdc', glint: '#f2f8ff', fleck: '#c0673f' },
  copperOre: { bed: '#5e4632', rim: '#3d2c1f', lump: '#cf7f45', light: '#f3b27a', glint: '#fff0dc', fleck: '#4fae94' },
  coal: { bed: '#2c2c33', rim: '#18181d', lump: '#3a3a45', light: '#666b80', glint: '#b9c3e0', fleck: '#23232a' },
};

export interface OreTile {
  tx: number;
  ty: number;
  kind: OreKind;
  /** 1 to 4: how full the tile still is. */
  band: number;
}

/** Paint a set of ore tiles: all the beds first, then all the lumps. */
export function drawOreTiles(ctx: CanvasRenderingContext2D, tiles: OreTile[]): void {
  if (tiles.length === 0) return;

  // One path per kind, so overlapping tiles join into a single stain rather
  // than darkening where they overlap.
  const beds = new Map<OreKind, { rim: Path2D; bed: Path2D }>();
  for (const t of tiles) {
    let p = beds.get(t.kind);
    if (!p) beds.set(t.kind, (p = { rim: new Path2D(), bed: new Path2D() }));
    const { x, y } = tileCenter(t.tx, t.ty);
    const ox = (hash2(t.tx, t.ty, 71) - 0.5) * TILE * 0.2;
    const oy = (hash2(t.tx, t.ty, 72) - 0.5) * TILE * 0.2;
    const r = TILE * (0.62 + hash2(t.tx, t.ty, 73) * 0.12);
    p.rim.moveTo(x + ox + r + 1.5, y + oy);
    p.rim.ellipse(x + ox, y + oy, r + 1.5, (r + 1.5) * 0.92, 0, 0, Math.PI * 2);
    p.bed.moveTo(x + ox + r, y + oy);
    p.bed.ellipse(x + ox, y + oy, r, r * 0.92, 0, 0, Math.PI * 2);
  }
  ctx.save();
  for (const [kind, p] of beds) {
    const s = STYLE[kind];
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = s.rim;
    ctx.fill(p.rim);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = s.bed;
    ctx.fill(p.bed);
  }
  ctx.restore();

  for (const t of tiles) drawLumps(ctx, t);
}

function drawLumps(ctx: CanvasRenderingContext2D, t: OreTile): void {
  const s = STYLE[t.kind];
  const { x, y } = tileCenter(t.tx, t.ty);
  // A fixed sequence per tile; lumps drop off its end as the tile runs down,
  // so the ones that remain never jump about.
  const count = t.band + 2;
  const spots: [number, number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const h = (k: number): number => hash2(t.tx * 5 + i, t.ty * 7 - i, 90 + k);
    const r = 4.6 + h(3) * 3.6;
    spots.push([x + (h(1) - 0.5) * TILE * 0.62, y + (h(2) - 0.5) * TILE * 0.6, r, h(4)]);
  }
  spots.sort((a, b) => a[1] - b[1]);

  for (const [lx, ly, r, seed] of spots) {
    const n = 6;
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + seed * 3;
      const k2 = 0.78 + hash2(k, Math.floor(seed * 1e4), 5) * 0.3;
      const flat = Math.sin(a) > 0 ? 0.62 : 1;
      pts.push([lx + Math.cos(a) * r * k2, ly + Math.sin(a) * r * k2 * flat * 0.85]);
    }
    const trace = (): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < n; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.closePath();
    };

    // Contact shadow, then the lump, then a lit upper facet.
    ctx.fillStyle = 'rgba(12, 12, 18, 0.35)';
    ctx.beginPath();
    ctx.ellipse(lx + 1, ly + r * 0.55, r * 1.05, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    trace();
    const g = ctx.createLinearGradient(lx - r, ly - r, lx + r, ly + r);
    g.addColorStop(0, s.light);
    g.addColorStop(0.5, s.lump);
    g.addColorStop(1, tone(s.lump, -0.4));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    ctx.strokeStyle = INK;
    ctx.stroke();

    // The upper facet: the lump's top edge, closed back through its middle.
    ctx.beginPath();
    let first = true;
    for (let k = 0; k < n * 2; k++) {
      const [px, py] = pts[k % n];
      const [qx, qy] = pts[(k + 1) % n];
      if (py < ly && qy < ly) {
        if (first) ctx.moveTo(px, py);
        ctx.lineTo(qx, qy);
        first = false;
      } else if (!first) break;
    }
    ctx.lineTo(lx + r * 0.15, ly + r * 0.05);
    ctx.lineTo(lx - r * 0.3, ly + r * 0.1);
    ctx.closePath();
    ctx.fillStyle = s.light;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Flecks of the second mineral, and a glint on the sunny edge.
    ctx.fillStyle = s.fleck;
    for (let k = 0; k < 2; k++) {
      const fx = lx + (hash2(k, Math.floor(seed * 1e4), 11) - 0.5) * r;
      const fy = ly + (hash2(k, Math.floor(seed * 1e4), 12) - 0.3) * r * 0.6;
      ctx.beginPath();
      ctx.arc(fx, fy, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = s.glint;
    ctx.beginPath();
    ctx.arc(lx - r * 0.35, ly - r * 0.4, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
}
