import type { MachineDef } from '@shared/data/machines';
import type { Direction } from '@shared/sim/types';
import { UI, shift } from './palette';
import { PixelGrid, blitPixels, ramp } from './pixel';
import type { Ramp, Rgb } from './pixel';

/**
 * Machine bodies as pixel sprites. The creatures and the player became pixel
 * art with a dark outline and a lit upper-left, and the factory's smooth
 * rounded blocks sat among them like toys from another game. These are the
 * same blocks, deck parts, output port and tier marks, laid out on whole
 * pixels at one pixel per world unit, so the moving parts drawn over them
 * (drill, fire, gears, dome) still land where they always did.
 *
 * Coordinates are world units from the tile's centre, as in `factory.ts`.
 */

const SIZE = 64;
const C = 32;

class Body extends PixelGrid {
  /** The grid's centre: the tile's centre for a body, the part's pivot for a moving part. */
  readonly c: number;
  constructor(size = SIZE) {
    super(size, size);
    this.c = size >> 1;
  }
  p(x: number, y: number, c: Rgb): void {
    this.set(this.c + x, this.c + y, c);
  }
  fill(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.p(x, y, c);
  }
  box(x0: number, y0: number, x1: number, y1: number, r: Ramp, round = true): void {
    this.rect(this.c + x0, this.c + y0, this.c + x1, this.c + y1, r, round);
  }
  ball(cx: number, cy: number, rx: number, ry: number, r: Ramp): void {
    this.disc(this.c + cx, this.c + cy, rx, ry, r);
  }
  /** Draw a separate piece and give it its own outline before laying it on. */
  part(draw: (g: Body) => void): void {
    const g = new Body(this.w);
    draw(g);
    g.outline();
    for (let i = 0; i < g.px.length; i++) if (g.px[i]) this.px[i] = g.px[i];
  }
}

/** Top face spans these rows, the front face the rows under it. */
const TOP = -15;
const LIP = 3;
const BASE = 13;
const HALF = 14;

/** The block: a lit top face over a shaded front, rounded at the corners. */
function block(g: Body, def: MachineDef): void {
  const top = ramp(def.color);
  const front = ramp(shift(def.color, -34));
  g.box(-HALF, LIP, HALF, BASE, front);
  // The seam under the lip, where the top face overhangs the front.
  g.fill(-HALF + 1, LIP + 1, HALF - 1, LIP + 1, front[2]);
  g.box(-HALF, TOP, HALF, LIP, top);
  // A second lit row inside the rim reads as a bevel at this size.
  g.fill(-HALF + 2, TOP + 1, HALF - 2, TOP + 1, top[0]);
}

/** Four bolts in the deck's corners. */
function bolts(g: Body, def: MachineDef, inset = 3): void {
  const lit = ramp(shift(def.color, 20))[0];
  const dark = ramp(def.color)[2];
  for (const bx of [-HALF + inset, HALF - inset]) {
    for (const by of [TOP + inset, LIP - inset + 1]) {
      g.p(bx, by, lit);
      g.p(bx + 1, by + 1, dark);
    }
  }
}

/** Slats on the front face, on the side the tier marks leave free. */
function vent(g: Body, def: MachineDef): void {
  const front = ramp(shift(def.color, -34));
  for (const vy of [6, 8, 10]) {
    g.fill(4, vy, 10, vy, front[2]);
    g.fill(4, vy + 1, 10, vy + 1, front[0]);
  }
}

/** A round recess in the deck, shaded as a hole: dark up top, lit on the far rim. */
function bore(g: Body, cx: number, cy: number, r: number, base: string): void {
  const inside = ramp(shift(base, -52));
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = (x - cx) / r;
      const dy = (y - cy) / r;
      const d = dx * dx + dy * dy;
      if (d > 1.05) continue;
      const far = dx * 0.6 + dy * 0.8;
      g.p(x, y, d > 0.7 && far > 0.2 ? inside[0] : d > 0.7 && far < -0.2 ? inside[2] : inside[1]);
    }
  }
}

function deck(g: Body, def: MachineDef): void {
  const cy = -5;
  const color = def.color;
  switch (def.family) {
    case 'miner':
      bore(g, 0, cy, 7.4, color);
      bolts(g, def);
      vent(g, def);
      break;
    case 'furnace': {
      // Firebox mouth: an arch sunk into the deck, the fire drawn in it live.
      const mouth = ramp(shift(color, -60));
      for (let y = cy - 4; y <= cy + 5; y++) {
        for (let x = -8; x <= 4; x++) {
          const arch = y - (cy - 4);
          if (arch < 3 && (x - -2) ** 2 > (arch + 3) ** 2 * 1.4) continue;
          g.p(x, y, y === cy + 5 ? mouth[0] : x === -8 || arch === 0 ? mouth[2] : mouth[1]);
        }
      }
      // Firebrick rows along the front.
      const brick = ramp(shift(color, -22));
      for (const [bx, by] of [
        [-12, 6],
        [-6, 6],
        [0, 6],
        [6, 6],
        [-9, 9],
        [-3, 9],
        [3, 9],
        [9, 9],
      ] as const) {
        g.fill(bx, by, bx + 4, by + 1, brick[0]);
        g.fill(bx, by + 2, bx + 4, by + 2, brick[2]);
      }
      // Chimney at the back right, standing clear of the deck with its own edge.
      g.part((p) => {
        p.box(5, -26, 11, -9, ramp(shift(color, -40)), false);
        p.box(4, -28, 12, -26, ramp(shift(color, 10)), false);
        p.fill(6, -28, 10, -28, ramp(shift(color, -70))[1]);
      });
      break;
    }
    case 'assembler': {
      // The hatch the gears turn under: a sunk panel with a lit lower lip.
      const hatch = ramp(shift(color, -46));
      g.fill(-10, cy - 7, 9, cy + 7, hatch[1]);
      g.fill(-10, cy - 7, 9, cy - 6, hatch[2]);
      g.fill(-10, cy - 7, -10, cy + 7, hatch[2]);
      g.fill(-9, cy + 7, 9, cy + 7, hatch[0]);
      bolts(g, def, 2);
      vent(g, def);
      break;
    }
    case 'chest': {
      const wood = ramp(color);
      // Planks across the lid and down the front.
      for (const ly of [-10, -5, 0]) g.fill(-HALF + 1, ly, HALF - 1, ly, wood[2]);
      for (const ly of [8]) g.fill(-HALF + 1, ly, HALF - 1, ly, ramp(shift(color, -34))[2]);
      // Bands in the chest's own colour, so a steel chest is not wood-banded.
      const band = ramp(shift(color, -58));
      for (const bx of [-10, 8]) {
        g.fill(bx, TOP, bx + 2, BASE, band[1]);
        g.fill(bx, TOP, bx, BASE, band[0]);
        g.p(bx + 1, TOP + 3, band[0]);
        g.p(bx + 1, BASE - 2, band[0]);
      }
      // The clasp on the lip.
      g.part((p) => p.box(-3, LIP - 2, 2, LIP + 4, ramp(def.accent)));
      break;
    }
    case 'generator': {
      // A banded boiler drum lying across the deck, a stack at the back left
      // and a gauge on the drum's face.
      const drumY = cy - 1;
      g.part((p) => {
        const drum = ramp(shift(color, -30));
        for (let y = drumY - 5; y <= drumY + 5; y++) {
          const t = (y - (drumY - 5)) / 10;
          const c = t < 0.25 ? drum[0] : t > 0.7 ? drum[2] : drum[1];
          const inset = Math.abs(y - drumY) >= 5 ? 1 : 0;
          p.fill(-11 + inset, y, 11 - inset, y, c);
        }
        const band = ramp(shift(color, -52));
        for (const bx of [-6, 4]) p.fill(bx, drumY - 5, bx + 1, drumY + 5, band[1]);
        p.ball(8, drumY, 2.6, 2.6, ramp('#e8e2d2'));
        p.p(8, drumY, [184, 50, 44]);
      });
      g.part((p) => {
        p.box(-11, -30, -5, -10, ramp(shift(color, -44)), false);
        p.box(-12, -32, -4, -30, ramp(shift(color, 6)), false);
      });
      break;
    }
    case 'solar': {
      // A grid of cells over the whole deck, with a glint across it.
      const frame = ramp(shift(color, -40));
      g.fill(-12, TOP + 2, 12, LIP - 2, frame[1]);
      const cw = 6;
      const ch = 5;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const cell = ramp(shift(def.accent, -70 + r * 8));
          const x0 = -12 + 1 + c * cw;
          const y0 = TOP + 3 + r * ch;
          g.fill(x0, y0, x0 + cw - 2, y0 + ch - 2, cell[1]);
          g.fill(x0, y0, x0 + cw - 2, y0, cell[0]);
        }
      }
      const glint = ramp(shift(def.accent, -10))[0];
      for (let i = 0; i < 12; i++) g.p(-9 + Math.floor(i / 2) - (i % 2), TOP + 3 + i, glint);
      break;
    }
    case 'fishTrap': {
      // Open water let into the deck, for the float to sit on.
      const rim = ramp(shift(def.accent, -70));
      const water = ramp(shift(def.accent, -40));
      g.fill(-10, cy - 6, 9, cy + 6, rim[1]);
      g.fill(-9, cy - 5, 8, cy + 5, water[1]);
      g.fill(-9, cy - 5, 8, cy - 5, water[2]);
      for (const [wx, wy] of [
        [-6, cy - 2],
        [2, cy + 2],
      ] as const)
        g.fill(wx, wy, wx + 3, wy, water[0]);
      break;
    }
    case 'lab':
      bolts(g, def);
      vent(g, def);
      break;
    case 'turret':
      bolts(g, def, 2);
      vent(g, def);
      break;
  }
}

/** A point laid out facing right, turned a quarter at a time to face `dir`. */
function turner(dir: Direction): (x: number, y: number) => [number, number] {
  return (x, y) => {
    switch (dir) {
      case 1:
        return [-y, x];
      case 2:
        return [-x, -y];
      case 3:
        return [y, -x];
      default:
        return [x, y];
    }
  };
}

/** The output port on the output side, pointing the way items leave. */
function port(g: Body, def: MachineDef, dir: Direction): void {
  if (def.outputSlots === 0) return;
  // Laid out facing right, about the deck's middle.
  const oy = -3;
  const turn = turner(dir);
  const plate = ramp('#2b3139');
  const gold = ramp(UI.gold);
  g.part((p) => {
    for (let y = -5; y <= 4; y++) {
      for (let x = 12; x <= 16; x++) {
        const [tx, ty] = turn(x, y);
        p.p(tx, ty + oy, y === -5 || x === 12 ? plate[0] : plate[1]);
      }
    }
    for (const [x, y] of [
      [13, -2],
      [13, -1],
      [13, 0],
      [13, 1],
      [14, -1],
      [14, 0],
      [15, 0],
    ] as const) {
      const [tx, ty] = turn(x, y);
      p.p(tx, ty + oy, x === 13 ? gold[1] : gold[0]);
    }
  });
}

/** Tier marks on the front face: one stripe for Mk2, two for Mk3. */
function pips(g: Body, def: MachineDef): void {
  if (def.tier < 2) return;
  const mark = ramp(def.accent);
  for (let i = 0; i < def.tier - 1; i++) {
    const x = -12 + i * 4;
    g.fill(x, 6, x + 1, 10, mark[1]);
    g.fill(x, 6, x + 1, 6, mark[0]);
  }
}

function makeBody(def: MachineDef, dir: Direction): PixelGrid {
  const g = new Body();
  block(g, def);
  deck(g, def);
  pips(g, def);
  g.outline();
  // The port goes on after the outline so it sits over the block's edge.
  port(g, def, dir);
  return g;
}

const stretched = new Map<string, HTMLCanvasElement>();

/**
 * Draw a machine frame with its anchor at (x, y). At a whole-number scale it
 * goes through the shared pixel blitter, crisp and on the device grid;
 * anywhere else (the smooth look's zoom, a baked palette icon) it is
 * stretched without smoothing, so a block still fills exactly its tile.
 */
export function blitGrid(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  ax: number,
  ay: number,
  make: () => PixelGrid,
): void {
  const m = ctx.getTransform();
  const scale = m.a;
  const whole = m.b === 0 && m.c === 0 && m.a === m.d && Math.abs(scale - Math.round(scale)) < 0.01 && scale >= 1;
  if (whole) {
    blitPixels(ctx, key, x, y, ax, ay, 1, make);
    return;
  }
  let canvas = stretched.get(key);
  if (!canvas) {
    canvas = make().toCanvas(1);
    stretched.set(key, canvas);
  }
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x - ax, y - ay);
  ctx.imageSmoothingEnabled = smoothing;
}

export function drawPixelBody(ctx: CanvasRenderingContext2D, def: MachineDef, dir: Direction, x: number, y: number): void {
  const facing = def.outputSlots > 0 ? dir : 0;
  blitGrid(ctx, `mbody:${def.id}:${facing}`, x, y, C, C, () => makeBody(def, dir));
}

/** A small square grid for a moving part, addressed from its centre. */
function piece(half: number, draw: (g: Body) => void): PixelGrid {
  const g = new Body(half * 2 + 1);
  draw(g);
  return g;
}

/** A cog `step` of `steps` through one tooth's turn: teeth round a rim, a dark hub. */
export function drawPixelGear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  step: number,
  steps: number,
  color: string,
): void {
  const half = Math.ceil(r) + 1;
  blitGrid(ctx, `mgear:${r}:${color}:${step}`, x, y, half, half, () =>
    piece(half, (g) => {
      const teeth = 8;
      const turn = (step / steps) * ((Math.PI * 2) / teeth);
      const shade = ramp(color);
      for (let py = -half; py <= half; py++) {
        for (let px = -half; px <= half; px++) {
          const d = Math.hypot(px, py);
          const a = Math.atan2(py, px) - turn;
          const tooth = Math.cos(a * teeth) > 0.1;
          if (d > r + 0.3 || (d > r * 0.7 && !tooth)) continue;
          const lit = -px * 0.6 - py * 0.8;
          g.p(px, py, d < r * 0.34 ? shade[2] : lit > r * 0.4 ? shade[0] : lit < -r * 0.4 ? shade[2] : shade[1]);
        }
      }
      g.outline();
    }),
  );
}

/** The miner's three-bladed drill, `step` of `steps` through a third of a turn. */
export function drawPixelDrill(ctx: CanvasRenderingContext2D, x: number, y: number, step: number, steps: number, accent: string): void {
  const half = 8;
  blitGrid(ctx, `mdrill:${accent}:${step}`, x, y, half, half, () =>
    piece(half, (g) => {
      const blade = ramp(accent);
      const turn = (step / steps) * ((Math.PI * 2) / 3);
      for (let i = 0; i < 3; i++) {
        const a = turn + (i / 3) * Math.PI * 2;
        g.limb(g.c, g.c, g.c + Math.cos(a) * 6, g.c + Math.sin(a) * 6, 2.2, blade);
      }
      g.disc(g.c, g.c, 1.8, 1.8, ramp(shift(accent, -60)));
      g.outline();
    }),
  );
}

/** A status lamp in its socket: a bright core with a lit corner, blinking red when stuck. */
export function drawPixelLamp(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  blitGrid(ctx, `mlamp:${color}`, x, y, 3, 3, () =>
    piece(3, (g) => {
      const glow = ramp(color);
      g.fill(-1, -1, 1, 1, glow[1]);
      g.p(-1, -1, glow[0]);
      g.p(0, -1, glow[0]);
      g.p(1, 1, glow[2]);
      g.outline();
    }),
  );
}

/** The ring of a warning sign over a machine that has no fuel or no power. */
export function drawPixelSignRing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, filled: boolean): void {
  blitGrid(ctx, `mring:${color}:${filled ? 1 : 0}`, x, y, 7, 7, () =>
    piece(7, (g) => {
      const edge = ramp(color);
      for (let py = -6; py <= 6; py++) {
        for (let px = -6; px <= 6; px++) {
          const d = Math.hypot(px, py);
          if (d > 6.2) continue;
          if (d > 4.6) g.p(px, py, py < 0 ? edge[0] : edge[1]);
          else if (filled) g.p(px, py, [18, 22, 30]);
        }
      }
      g.outline();
    }),
  );
}

/** A small pickaxe for the sign over a miner that has dug out everything in reach. */
export function drawPixelPickGlyph(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  blitGrid(ctx, 'mpick', x, y, 4, 4, () =>
    piece(4, (g) => {
      const head = ramp('#dfe6ee');
      const haft = ramp('#d9a864');
      // Drawn on the diagonal with the head's arms bending back towards the
      // grip: square to the frame, a pick reads as a letter T.
      for (let i = 0; i < 5; i++) g.p(-3 + i, 3 - i, i < 3 ? haft[1] : haft[0]);
      for (const [px, py] of [[2, -2], [2, -3], [3, -2], [1, -2], [2, -1]] as const) g.p(px, py, head[0]);
      for (const [px, py] of [[1, -3], [0, -3], [3, -1], [3, 0]] as const) g.p(px, py, head[1]);
      for (const [px, py] of [[-1, -3], [-2, -2], [3, 1], [2, 2]] as const) g.p(px, py, head[2]);
    }),
  );
}

/** The lab's glass dome over its dark well, brighter while it works. */
export function drawPixelDome(ctx: CanvasRenderingContext2D, x: number, y: number, def: MachineDef, running: boolean): void {
  blitGrid(ctx, `mdome:${def.id}:${running ? 1 : 0}`, x, y, 11, 11, () =>
    piece(11, (g) => {
      const well = ramp(shift(def.color, -46));
      g.disc(g.c, g.c + 3, 9, 3, well);
      const glass = ramp(shift(def.accent, running ? 0 : -70));
      for (let py = -6; py <= 3; py++) {
        for (let px = -8; px <= 8; px++) {
          const dx = px / 8.4;
          const dy = (py - 3) / 9;
          if (dx * dx + dy * dy > 1) continue;
          const lit = -px * 0.6 - (py - 3) * 0.3;
          g.p(px, py, lit > 3 ? glass[0] : lit < -3 ? glass[2] : glass[1]);
        }
      }
      g.p(-4, -3, [250, 252, 255]);
      g.p(-3, -4, [250, 252, 255]);
      g.p(-5, -2, glass[0]);
      g.outline();
    }),
  );
}

/** The turret's turntable. */
export function drawPixelTurretBase(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  blitGrid(ctx, 'mturret:base', x, y, 10, 10, () =>
    piece(10, (g) => {
      g.disc(g.c, g.c, 7.6, 7.6, ramp('#2e343c'));
      g.disc(g.c, g.c - 1, 5.6, 5.6, ramp('#56606c'));
      g.outline();
    }),
  );
}

export const TURRET_ANGLES = 32;

/** The barrel, pointing one of `TURRET_ANGLES` ways, with a brass muzzle ring. */
export function drawPixelBarrel(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  const turns = Math.PI * 2;
  const index = ((Math.round((angle / turns) * TURRET_ANGLES) % TURRET_ANGLES) + TURRET_ANGLES) % TURRET_ANGLES;
  blitGrid(ctx, `mturret:barrel:${index}`, x, y, 18, 18, () =>
    piece(18, (g) => {
      const a = (index / TURRET_ANGLES) * turns;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      g.limb(g.c, g.c, g.c + cx * 11, g.c + cy * 11, 3.6, ramp('#5c6876'));
      g.limb(g.c + cx * 11, g.c + cy * 11, g.c + cx * 14, g.c + cy * 14, 4, ramp('#d8b070'));
      g.disc(g.c, g.c, 3.4, 3.4, ramp('#6a7684'));
      g.outline();
    }),
  );
}

/** The assembler's working arm, reaching `reach` of `steps` over the gears. */
export function drawPixelArm(ctx: CanvasRenderingContext2D, x: number, y: number, reach: number, steps: number, accent: string): void {
  blitGrid(ctx, `marm:${accent}:${reach}`, x, y, 14, 14, () =>
    piece(14, (g) => {
      const tip = (reach / steps) * 3.2;
      g.limb(g.c - 9.6, g.c - 6.4, g.c + tip, g.c - 1.9, 2.4, ramp(shift(accent, -20)));
      g.disc(g.c + tip, g.c - 1.9, 2.2, 2.2, ramp(accent));
      g.outline();
    }),
  );
}

/** A lightning bolt for the no-power sign. */
export function drawPixelBolt(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  blitGrid(ctx, `mbolt:${color}`, x, y, 5, 5, () =>
    piece(5, (g) => {
      const gold = ramp(color);
      for (const [px, py, t] of [
        [1, -4, 0],
        [0, -3, 0],
        [1, -3, 1],
        [-1, -2, 0],
        [0, -2, 1],
        [-2, -1, 0],
        [-1, -1, 1],
        [0, -1, 1],
        [1, -1, 1],
        [2, -1, 2],
        [-1, 0, 1],
        [0, 0, 1],
        [1, 0, 2],
        [-1, 1, 1],
        [0, 1, 2],
        [-1, 2, 2],
        [-1, 3, 2],
      ] as const)
        g.p(px, py, gold[t]);
    }),
  );
}

/** Fill a list of rows, each `[y, x0, x1]`, turned to face `dir`. */
function rows(g: Body, dir: Direction, spans: ReadonlyArray<readonly [number, number, number]>, r: Ramp): void {
  const turn = turner(dir);
  for (const [y, x0, x1] of spans) {
    for (let x = x0; x <= x1; x++) {
      const [tx, ty] = turn(x, y);
      g.p(tx, ty, x === x0 || y === spans[0][0] ? r[0] : r[1]);
    }
  }
}

/** An arrow head of rows `from` to `to` (tip first), two wider every two rows. */
function head(from: number, to: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const step = to > from ? 1 : -1;
  for (let y = from, i = 0; y !== to + step; y += step, i++) {
    const w = Math.floor(i / 2);
    out.push([y, -1 - w, w]);
  }
  return out;
}

/**
 * The splitter's T (one way in, two arms out) or the merger's (two in, one
 * out), with its arrows in the item a filtered side sorts.
 */
export function drawPixelJunction(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  def: MachineDef,
  dir: Direction,
  sides: readonly [string, string],
): void {
  const merger = def.family === 'merger';
  blitGrid(ctx, `mjunction:${def.id}:${dir}:${sides[0]}:${sides[1]}`, x, y, 14, 14, () =>
    piece(14, (g) => {
      const bar = ramp(shift(def.color, -50));
      const turn = turner(dir);
      const bars: Array<[number, number, number, number]> = merger
        ? [
            [0, -3, 8, 2],
            [-3, -11, 2, 10],
          ]
        : [
            [-10, -3, 0, 2],
            [-3, -10, 2, 9],
          ];
      for (const [x0, y0, x1, y1] of bars) {
        for (let py = y0; py <= y1; py++) {
          for (let px = x0; px <= x1; px++) {
            const [tx, ty] = turn(px, py);
            g.p(tx, ty, py === y0 ? bar[0] : py === y1 ? bar[2] : bar[1]);
          }
        }
      }
      if (merger) {
        // Arrows pointing in from both sides, and the way out at the front.
        rows(g, dir, head(-3, -8), ramp(def.accent));
        rows(g, dir, head(2, 7), ramp(def.accent));
        const out: Array<[number, number, number]> = [];
        for (let px = 11, i = 0; px >= 7; px--, i++) for (let py = -i; py <= i - 1; py++) out.push([py, px, px]);
        rows(g, dir, out, ramp(def.accent));
      } else {
        rows(g, dir, head(-10, -5), ramp(sides[0]));
        rows(g, dir, head(9, 4), ramp(sides[1]));
      }
      g.outline();
    }),
  );
}

/** An inserter's base: a round plate and the post the arm turns on. */
export function drawPixelInserterBase(ctx: CanvasRenderingContext2D, x: number, y: number, def: MachineDef): void {
  blitGrid(ctx, `mins:base:${def.id}`, x, y, 12, 12, () =>
    piece(12, (g) => {
      g.ball(0, 5, 8.3, 4.6, ramp(shift(def.color, 4)));
      g.fill(-6, 3, 5, 3, ramp(shift(def.color, 18))[0]);
      g.part((p) => {
        p.box(-3, -7, 2, 4, ramp(shift(def.color, 6)), false);
        p.fill(-2, -6, -2, 3, ramp(shift(def.color, 30))[0]);
      });
      g.outline();
    }),
  );
}

/** An inserter's arm from its pivot to the hand at (hx, hy), with a claw and a lit pivot cap. */
export function drawPixelInserterArm(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  hx: number,
  hy: number,
  reach: number,
  tint: string,
): void {
  const half = Math.ceil(reach) + 6;
  blitGrid(ctx, `mins:${key}`, x, y, half, half, () =>
    piece(half, (g) => {
      const rod = ramp(tint);
      g.limb(g.c, g.c, g.c + hx, g.c + hy, 2.6, rod);
      g.part((p) => p.ball(hx, hy, 3, 3, ramp(shift(tint, -40))));
      g.part((p) => {
        p.ball(0, 0, 3.2, 3.2, rod);
        p.p(-1, -1, [250, 252, 255]);
      });
      g.outline();
    }),
  );
}

/** The fire in a furnace's mouth: embers along the floor, flame above, shaped to the arch. */
export function drawPixelFire(ctx: CanvasRenderingContext2D, x: number, y: number, accent: string): void {
  blitGrid(ctx, `mfire:${accent}`, x, y, 8, 8, () =>
    piece(8, (g) => {
      const flame = ramp(accent);
      const hot: Rgb = [255, 242, 196];
      for (let py = -3; py <= 4; py++) {
        for (let px = -6; px <= 3; px++) {
          const arch = py + 3;
          if (arch < 3 && (px + 1.5) ** 2 > (arch + 2.5) ** 2 * 1.4) continue;
          g.p(px, py, py >= 3 ? hot : py >= 1 ? flame[0] : flame[1]);
        }
      }
    }),
  );
}
