import type { MachineDef } from '@shared/data/machines';
import type { Direction } from '@shared/sim/types';
import { shift } from './palette';
import { OUTLINE, PixelGrid, ramp } from './pixel';
import type { Ramp, Rgb } from './pixel';
import { blitGrid } from './pixelmachines';

/**
 * Belts, underground belts, power poles and the beacon as pixel sprites, to
 * match the machines they run between. A belt is the thing a base has most
 * of, so a soft belt under crisp machines was the most visible seam left in
 * the pixel look.
 *
 * Coordinates are world units from the tile's centre, one pixel per unit.
 */

/** A grid addressed from an origin inside it, which need not be its centre. */
class Sprite extends PixelGrid {
  constructor(
    w: number,
    h: number,
    readonly ox: number,
    readonly oy: number,
  ) {
    super(w, h);
  }
  p(x: number, y: number, c: Rgb): void {
    this.set(this.ox + x, this.oy + y, c);
  }
  fill(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.p(x, y, c);
  }
  box(x0: number, y0: number, x1: number, y1: number, r: Ramp, round = true): void {
    this.rect(this.ox + x0, this.oy + y0, this.ox + x1, this.oy + y1, r, round);
  }
  ball(cx: number, cy: number, rx: number, ry: number, r: Ramp): void {
    this.disc(this.ox + cx, this.oy + cy, rx, ry, r);
  }
  stroke(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    this.line(this.ox + x0, this.oy + y0, this.ox + x1, this.oy + y1, c);
  }
  bar(x0: number, y0: number, x1: number, y1: number, width: number, r: Ramp): void {
    this.limb(this.ox + x0, this.oy + y0, this.ox + x1, this.oy + y1, width, r);
  }
  /** Draw a separate piece and give it its own outline before laying it on. */
  part(draw: (g: Sprite) => void): void {
    const g = new Sprite(this.w, this.h, this.ox, this.oy);
    draw(g);
    g.outline();
    for (let i = 0; i < g.px.length; i++) if (g.px[i]) this.px[i] = g.px[i];
  }
}

const rgb = (hex: string): Rgb => ramp(hex)[1];

const BELT = {
  bed: rgb('#2b3139'),
  bedShade: rgb('#21262d'),
  treadLit: rgb('#58626f'),
  tread: rgb('#1d2127'),
  railLit: rgb('#c3cad3'),
  rail: rgb('#8a939f'),
  railDark: rgb('#5d6572'),
  arrow: rgb('#b08c40'),
  arrowLit: rgb('#d9ad52'),
} as const;

/** Tread spacing along a belt; it divides a tile, so neighbours' treads line up. */
const TREAD = 8;

/**
 * Where a belt's pixels go. `u` runs along the belt and `v` across it, both
 * in world orientation (a low `v` is the rail toward the light on either
 * axis), so the rails and treads are lit the same way whichever way it runs.
 */
function beltAxis(g: Sprite, dir: Direction): (u: number, v: number, c: Rgb) => void {
  return dir % 2 === 0 ? (u, v, c) => g.p(u, v, c) : (u, v, c) => g.p(v, u, c);
}

/** The flow sign along `u`: east and south run toward higher coordinates. */
const flow = (dir: Direction): 1 | -1 => (dir === 0 || dir === 1 ? 1 : -1);

/** A belt's bed, treads, rails and chevron over `u` from `u0` to `u1`, treads `step` pixels on. */
function paintBelt(g: Sprite, dir: Direction, step: number, u0 = -16, u1 = 15): void {
  const put = beltAxis(g, dir);
  const sign = flow(dir);
  for (let u = u0; u <= u1; u++) {
    // Rails: an outline, a lit edge, the rail and its shaded side, both sides.
    put(u, -14, OUTLINE);
    put(u, -13, BELT.railLit);
    put(u, -12, BELT.rail);
    put(u, -11, BELT.railDark);
    put(u, 10, BELT.railLit);
    put(u, 11, BELT.rail);
    put(u, 12, BELT.railDark);
    put(u, 13, OUTLINE);
    put(u, -10, BELT.bedShade);
    for (let v = -9; v <= 9; v++) put(u, v, BELT.bed);
  }
  // A joint in the rails at every tile's edge, so a run reads as laid sections.
  if (u0 === -16) for (const v of [-13, -12, 10, 11]) put(-16, v, BELT.railDark);

  // Treads, each a lit ridge with its face behind it, scrolling with the flow.
  const off = (((sign * step) % TREAD) + TREAD) % TREAD;
  for (let k = -16 + off; k <= 15; k += TREAD) {
    for (const [du, c] of [
      [0, BELT.treadLit],
      [1, BELT.tread],
    ] as const) {
      const u = k + du;
      if (u < u0 || u > u1) continue;
      for (let v = -8; v <= 8; v++) put(u, v, c);
    }
  }

  // A chevron painted on the bed, pointing the way things go.
  for (let i = 0; i < 5; i++) {
    for (const du of [0, 1]) {
      const u = sign > 0 ? -3 + i + du : 2 - i - du;
      if (u < u0 || u > u1) continue;
      const c = du === 0 ? BELT.arrowLit : BELT.arrow;
      put(u, -5 + i, c);
      put(u, 4 - i, c);
    }
  }
}

export function drawPixelBelt(ctx: CanvasRenderingContext2D, x: number, y: number, dir: Direction, step: number): void {
  const s = Math.floor(step) % TREAD;
  blitGrid(ctx, `pbelt:${dir}:${s}`, x, y, 16, 16, () => {
    const g = new Sprite(32, 32, 16, 16);
    paintBelt(g, dir, s);
    return g;
  });
}

/**
 * An underground belt end: the half of a belt the line joins, running into a
 * hood whose mouth faces it. An entrance's belt is behind the hood, an
 * exit's in front, so a pair reads as one line diving under and back up.
 */
export function drawPixelTunnel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  def: MachineDef,
  dir: Direction,
  step: number,
): void {
  const s = Math.floor(step) % TREAD;
  const entrance = def.tunnel === 'in';
  blitGrid(ctx, `ptunnel:${def.id}:${dir}:${s}`, x, y, 20, 20, () => {
    const g = new Sprite(40, 40, 20, 20);
    const sign = flow(dir);
    // `a` runs the way items flow, whichever axis that is.
    const along = (a: number): number => (sign > 0 ? a : -1 - a);
    const joins = entrance ? [-16, -1] : [0, 15];
    paintBelt(g, dir, s, Math.min(along(joins[0]), along(joins[1])), Math.max(along(joins[0]), along(joins[1])));

    const [a0, a1] = entrance ? [-3, 14] : [-15, 2];
    const lo = Math.min(along(a0), along(a1));
    const hi = Math.max(along(a0), along(a1));
    const horiz = dir % 2 === 0;

    g.part((h) => {
      const hput = beltAxis(h, dir);
      const hrect = (u0: number, v0: number, u1: number, v1: number, r: Ramp, round = true): void =>
        horiz ? h.box(u0, v0, u1, v1, r, round) : h.box(v0, u0, v1, u1, r, round);
      hrect(lo, -15, hi, 14, ramp(shift(def.color, -34)));
      hrect(lo + 2, -13, hi - 2, 12, ramp(def.color));
      // The mouth, on the side the belt meets.
      const m0 = entrance ? along(a0) : along(a1);
      const mouth = sign > 0 === entrance ? [m0, m0 + 3] : [m0 - 3, m0];
      const dark = rgb('#12161c');
      for (let u = mouth[0]; u <= mouth[1]; u++) for (let v = -10; v <= 9; v++) hput(u, v, dark);
      // Chevrons along the cap, pointing the way items go under it.
      const accent = ramp(def.accent);
      const mid = entrance ? 6 : -7;
      for (const off of [-3, 2]) {
        for (let i = 0; i < 4; i++) {
          const u = along(mid + off + i);
          hput(u, -4 + i, accent[0]);
          hput(u, 3 - i, accent[1]);
        }
      }
    });
    return g;
  });
}

/** Where a pole's crossarm sits above its tile centre. */
const POLE_TOP = 30;

/** A timber post on a stone footing, with a crossarm and two glass insulators. */
export function drawPixelPole(ctx: CanvasRenderingContext2D, x: number, y: number, def: MachineDef): void {
  blitGrid(ctx, `ppole:${def.id}`, x, y, 12, 40, () => {
    const g = new Sprite(24, 54, 12, 40);
    const foot = 10;
    const top = -POLE_TOP;
    g.part((h) => {
      h.ball(0, foot, 5, 2, ramp('#6d6a64'));
      h.box(-2, top, 1, foot, ramp(def.color), false);
      // Grain down the post, and a band where the arm is bolted on.
      h.fill(0, top + 7, 0, foot - 3, ramp(def.color)[2]);
      h.box(-8, top + 2, 7, top + 4, ramp(shift(def.color, -10)), false);
    });
    for (const ix of [-8, 6]) {
      g.part((h) => {
        const glass = ramp('#8fc3c9');
        h.box(ix, top - 3, ix + 1, top + 1, glass, false);
        h.p(ix, top - 2, [236, 248, 248]);
      });
    }
    return g;
  });
}

/** Height of each lattice section the beacon raises. */
const SECTION = 20;

/**
 * The Skyward Beacon at a stage: a stepped plinth, a lattice section per
 * stage raised, and scaffold poles standing ready for the next until it is
 * lit. The light and its beam are drawn over it, soft, since they are light.
 */
export function drawPixelBeacon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  def: MachineDef,
  stage: number,
  lit: boolean,
): void {
  blitGrid(ctx, `pbeacon:${def.id}:${stage}:${lit ? 1 : 0}`, x, y, 20, 130, () => {
    const g = new Sprite(40, 148, 20, 130);
    const foot = 12;
    g.part((h) => {
      h.box(-14, foot - 7, 13, foot, ramp(shift(def.color, -18)));
      h.fill(-13, foot - 6, 12, foot - 6, ramp(shift(def.color, 12))[0]);
      h.box(-11, foot - 12, 10, foot - 7, ramp(shift(def.color, -8)));
      h.fill(-10, foot - 11, 9, foot - 11, ramp(shift(def.color, 20))[0]);
    });
    const base = 0;
    let top = base;
    for (let i = 0; i < stage; i++) {
      const y0 = top;
      const y1 = top - SECTION;
      const hw0 = 8 - i * 0.96;
      const hw1 = 8 - (i + 1) * 0.96;
      const steel = ramp(shift(def.color, -4 + i * 4));
      const inside = ramp(shift(def.color, -52))[1];
      g.part((h) => {
        for (let yy = y1; yy <= y0; yy++) {
          const t = (y0 - yy) / SECTION;
          const hw = Math.round(hw0 + (hw1 - hw0) * t);
          h.fill(-hw + 2, yy, hw - 3, yy, inside);
          h.p(-hw, yy, steel[0]);
          h.p(-hw + 1, yy, steel[1]);
          h.p(hw - 2, yy, steel[1]);
          h.p(hw - 1, yy, steel[2]);
        }
        // Cross-bracing, so it reads as a built frame rather than a block.
        h.stroke(Math.round(-hw0) + 2, y0 - 1, Math.round(hw1) - 3, y1 + 2, steel[0]);
        h.stroke(Math.round(hw0) - 3, y0 - 1, Math.round(-hw1) + 2, y1 + 2, steel[1]);
        const hw = Math.round(hw1);
        h.fill(-hw, y1, hw - 1, y1, steel[0]);
        h.fill(-hw, y1 + 1, hw - 1, y1 + 1, steel[2]);
      });
      top = y1;
    }
    if (!lit) {
      // Scaffold poles standing ready for the next section.
      const next = top - SECTION;
      const wood = ramp('#b08850');
      g.part((h) => {
        h.bar(-12, base, -10, next, 2, wood);
        h.bar(11, base, 9, next, 2, wood);
        h.fill(-10, next + 2, 9, next + 2, wood[1]);
        h.fill(-10, next + 3, 9, next + 3, wood[2]);
      });
    } else {
      g.part((h) => h.box(-6, top - 2, 5, top + 1, ramp(shift(def.color, -40)), false));
    }
    return g;
  });
}

/** The beacon's lamp: an ember while banked, a white-hot core while it burns. */
export function drawPixelBeaconLamp(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  blitGrid(ctx, `pbeaconlamp:${color}`, x, y, 6, 6, () => {
    const g = new Sprite(13, 13, 6, 6);
    g.ball(0, 0, 4, 4, ramp(color));
    g.outline();
    return g;
  });
}

/** Height of the beacon's top above its tile centre at a stage. */
export function beaconTop(stage: number): number {
  return -stage * SECTION;
}
