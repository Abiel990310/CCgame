/**
 * Pixel sprites, generated in code the way a sprite artist blocks one out:
 * shapes laid on a small grid of whole pixels, each shaded from a three-step
 * ramp with the light from the upper left, then a one-pixel dark outline
 * traced round the silhouette. Nothing is loaded; frames are drawn on first
 * use and kept.
 *
 * Frames are scaled up by a whole number with no smoothing, so every texel is
 * a crisp square on screen at any zoom, and blitted to a whole device pixel.
 */

export type Rgb = readonly [number, number, number];
/** Light, mid and dark of one material. */
export type Ramp = readonly [Rgb, Rgb, Rgb];

export const OUTLINE: Rgb = [22, 17, 26];

export class PixelGrid {
  readonly px: (Rgb | null)[];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array<Rgb | null>(w * h).fill(null);
  }

  set(x: number, y: number, c: Rgb): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  get(x: number, y: number): Rgb | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this.px[y * this.w + x];
  }

  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = null;
  }

  /** A box lit along its top and left edge and shaded along the bottom and right. */
  rect(x0: number, y0: number, x1: number, y1: number, ramp: Ramp, round = false): void {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (round && (x === x0 || x === x1) && (y === y0 || y === y1)) continue;
        const edgeLit = y === y0 || x === x0;
        const edgeDark = y === y1 || x === x1;
        this.set(x, y, edgeDark ? ramp[2] : edgeLit ? ramp[0] : ramp[1]);
      }
    }
  }

  /** An ellipse shaded as a lit ball: bright toward the upper left, dark round the lower right. */
  disc(cx: number, cy: number, rx: number, ry: number, ramp: Ramp, only?: (x: number, y: number) => boolean): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1.05) continue;
        if (only && !only(x, y)) continue;
        const lit = -dx * 0.6 - dy * 0.8;
        this.set(x, y, lit > 0.35 ? ramp[0] : lit < -0.45 || d > 0.8 ? ramp[2] : ramp[1]);
      }
    }
  }

  /** A limb: a thick segment, lit on its upper-left side. */
  limb(x0: number, y0: number, x1: number, y1: number, width: number, ramp: Ramp): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len * 2));
    const nx = len > 0 ? -(y1 - y0) / len : 0;
    const ny = len > 0 ? (x1 - x0) / len : 1;
    // The side of the limb that faces the light.
    const litSide = -nx * 0.6 - ny * 0.8 > 0 ? 1 : -1;
    const r = width / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const ox = x - cx;
          const oy = y - cy;
          if (ox * ox + oy * oy > r * r + 0.25) continue;
          const across = (ox * nx + oy * ny) * litSide;
          this.set(x, y, across > r * 0.35 ? ramp[0] : across < -r * 0.35 ? ramp[2] : ramp[1]);
        }
      }
    }
  }

  /** A one-pixel line, for handles, straps and seams. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c);
    }
  }

  /** Trace the silhouette with a dark line on its outside. */
  outline(color: Rgb = OUTLINE): void {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push(y * this.w + x);
      }
    }
    for (const i of add) this.px[i] = color;
  }

  /** Every filled pixel turned one colour: the hit flash. */
  silhouette(c: Rgb): void {
    for (let i = 0; i < this.px.length; i++) if (this.px[i]) this.px[i] = c;
  }

  /** Turned a quarter anticlockwise: x becomes y, the top becomes the left. */
  rotated(): PixelGrid {
    const out = new PixelGrid(this.h, this.w);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) out.px[(this.w - 1 - x) * this.h + y] = this.px[y * this.w + x];
    }
    return out;
  }

  mirrored(): PixelGrid {
    const out = new PixelGrid(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) out.px[y * this.w + (this.w - 1 - x)] = this.px[y * this.w + x];
    }
    return out;
  }

  /** The grid as a canvas scaled up by a whole number, with hard pixel edges. */
  toCanvas(scale: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.w * scale;
    canvas.height = this.h * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const data = img.data;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.px[y * this.w + x];
        if (!c) continue;
        for (let sy = 0; sy < scale; sy++) {
          let o = ((y * scale + sy) * canvas.width + x * scale) * 4;
          for (let sx = 0; sx < scale; sx++, o += 4) {
            data[o] = c[0];
            data[o + 1] = c[1];
            data[o + 2] = c[2];
            data[o + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

/** A ramp from one mid colour: lighter and darker steps, the dark one cooler. */
export function ramp(hex: string): Ramp {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const light: Rgb = [Math.min(255, r * 1.22 + 18), Math.min(255, g * 1.22 + 16), Math.min(255, b * 1.15 + 12)];
  const dark: Rgb = [r * 0.66, g * 0.66, b * 0.74 + 6];
  return [light.map(Math.round) as unknown as Rgb, [r, g, b], dark.map(Math.round) as unknown as Rgb];
}

const frames = new Map<string, { canvas: HTMLCanvasElement; used: number }>();
let stamp = 0;
const FRAME_CAP = 600;

/**
 * Draw a generated frame with its anchor at (x, y) in world units. `texel` is
 * world units per pixel of the grid; the frame is drawn at the nearest whole
 * number of device pixels per texel, so it stays crisp.
 */
export function blitPixels(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  anchorX: number,
  anchorY: number,
  texel: number,
  make: () => PixelGrid,
): void {
  const m = ctx.getTransform();
  const plain = m.b === 0 && m.c === 0 && m.a === m.d && m.a > 0;
  const scale = Math.max(1, Math.round((plain ? m.a : Math.hypot(m.a, m.b)) * texel));
  const id = `${key}@${scale}`;
  let entry = frames.get(id);
  if (!entry) {
    entry = { canvas: make().toCanvas(scale), used: 0 };
    frames.set(id, entry);
    if (frames.size > FRAME_CAP) {
      const cutoff = [...frames.values()].map((e) => e.used).sort((a, b) => a - b)[Math.floor(FRAME_CAP / 4)];
      for (const [k, e] of frames) if (e.used <= cutoff) frames.delete(k);
    }
  }
  entry.used = ++stamp;
  const canvas = entry.canvas;
  if (!plain) {
    // Squashed or rotated: let the transform stretch it, still without smoothing.
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    const w = canvas.width / scale;
    const h = canvas.height / scale;
    ctx.drawImage(canvas, x - anchorX * texel, y - anchorY * texel, w * texel, h * texel);
    ctx.imageSmoothingEnabled = smoothing;
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, Math.round(m.a * x + m.e - anchorX * scale), Math.round(m.d * y + m.f - anchorY * scale));
  ctx.setTransform(m);
}
