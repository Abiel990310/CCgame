import { CanvasSource, Container, Graphics, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';

/**
 * The slice of the Canvas 2D API the world's art is written against, drawn
 * with PixiJS instead.
 *
 * Every painter in `src/render` takes a `CanvasRenderingContext2D`. Handing
 * them this instead turns what they draw into Pixi display objects, in the
 * order they drew it: paths become `Graphics`, and bitmaps (the baked trees,
 * belts, machine bodies, ground chunks) become `Sprite`s. So the art is
 * written once and either renderer can show it, and the painter's-algorithm
 * order the 3/4 view depends on survives unchanged.
 *
 * Paths are flattened here, into device pixels, rather than handed to Pixi's
 * own curve commands: Canvas applies the transform to an arc, an ellipse and a
 * line width, and doing that once here keeps the two renderers drawing the
 * same shapes. Only what the game's art uses is covered. Bakes still draw on
 * real canvases, so anything used only inside a bake need not be here.
 */

type Style = string | ShimGradient;

interface State {
  m: [number, number, number, number, number, number];
  fillStyle: Style;
  strokeStyle: Style;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  dash: number[];
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

interface SubPath {
  pts: number[];
  closed: boolean;
}

/** Largest gap, in device pixels, between a flattened curve and the true one. */
const TOLERANCE = 0.3;

/** Frames a texture may go unused before its GPU copy is freed. */
const TEXTURE_IDLE_FRAMES = 240;

export class ShimGradient {
  readonly stops: Array<[number, string]> = [];
  constructor(
    readonly kind: 'linear' | 'radial',
    /** linear: x0 y0 x1 y1; radial: x0 y0 r0 x1 y1 r1, in user space. */
    readonly coords: number[],
  ) {}

  addColorStop(offset: number, color: string): void {
    this.stops.push([offset, color]);
  }
}

export class PixiContext2D {
  readonly root = new Container();

  private state: State = freshState();
  private stack: State[] = [];
  private path: SubPath[] = [];
  private current: SubPath | null = null;

  private graphicsPool: Graphics[] = [];
  private spritePool: Sprite[] = [];
  private graphicsUsed = 0;
  private spritesUsed = 0;
  /** The Graphics that path drawing is going into, while nothing else has been drawn since. */
  private open: Graphics | null = null;
  private openBlend: 'normal' | 'add' = 'normal';

  private frame = 0;
  private textures = new Map<CanvasImageSource, { texture: Texture; used: number }>();
  private frames = new Map<string, Texture>();
  private gradients = new Map<string, { texture: Texture; used: number }>();
  private texts = new Map<string, { canvas: HTMLCanvasElement; k: number; ox: number; oy: number; used: number }>();
  private measure: CanvasRenderingContext2D | null = null;

  /** Start a frame: everything drawn before is dropped. */
  begin(): void {
    this.frame++;
    this.root.removeChildren();
    this.graphicsUsed = 0;
    this.spritesUsed = 0;
    this.open = null;
    this.state = freshState();
    this.stack.length = 0;
    this.path = [];
    this.current = null;
    if (this.frame % 60 === 0) this.evict();
  }

  // --- state -----------------------------------------------------------------

  get fillStyle(): Style {
    return this.state.fillStyle;
  }
  set fillStyle(v: Style) {
    this.state.fillStyle = v;
  }
  get strokeStyle(): Style {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: Style) {
    this.state.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    if (Number.isFinite(v) && v > 0) this.state.lineWidth = v;
  }
  get lineCap(): CanvasLineCap {
    return this.state.lineCap;
  }
  set lineCap(v: CanvasLineCap) {
    this.state.lineCap = v;
  }
  get lineJoin(): CanvasLineJoin {
    return this.state.lineJoin;
  }
  set lineJoin(v: CanvasLineJoin) {
    this.state.lineJoin = v;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(v: number) {
    if (Number.isFinite(v) && v >= 0 && v <= 1) this.state.globalAlpha = v;
  }
  get globalCompositeOperation(): GlobalCompositeOperation {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(v: GlobalCompositeOperation) {
    this.state.globalCompositeOperation = v;
  }
  get font(): string {
    return this.state.font;
  }
  set font(v: string) {
    this.state.font = v;
  }
  get textAlign(): CanvasTextAlign {
    return this.state.textAlign;
  }
  set textAlign(v: CanvasTextAlign) {
    this.state.textAlign = v;
  }
  get textBaseline(): CanvasTextBaseline {
    return this.state.textBaseline;
  }
  set textBaseline(v: CanvasTextBaseline) {
    this.state.textBaseline = v;
  }
  // Accepted and ignored: sprites are copied at whole pixels already.
  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';

  setLineDash(segments: number[]): void {
    this.state.dash = segments.length % 2 === 0 ? segments.slice() : [...segments, ...segments];
  }
  getLineDash(): number[] {
    return this.state.dash.slice();
  }

  save(): void {
    const s = this.state;
    this.stack.push({ ...s, m: [...s.m], dash: s.dash.slice() });
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) this.state = s;
  }

  // --- transform -------------------------------------------------------------

  setTransform(a: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number): void {
    if (typeof a === 'object') {
      const m = a;
      this.state.m = [m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1, m.e ?? 0, m.f ?? 0];
      return;
    }
    this.state.m = [a, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0];
  }
  resetTransform(): void {
    this.state.m = [1, 0, 0, 1, 0, 0];
  }
  getTransform(): DOMMatrix {
    const [a, b, c, d, e, f] = this.state.m;
    return { a, b, c, d, e, f } as DOMMatrix;
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const m = this.state.m;
    this.state.m = [
      m[0] * a + m[2] * b,
      m[1] * a + m[3] * b,
      m[0] * c + m[2] * d,
      m[1] * c + m[3] * d,
      m[0] * e + m[2] * f + m[4],
      m[1] * e + m[3] * f + m[5],
    ];
  }
  translate(x: number, y: number): void {
    const m = this.state.m;
    m[4] += m[0] * x + m[2] * y;
    m[5] += m[1] * x + m[3] * y;
  }
  scale(x: number, y: number): void {
    const m = this.state.m;
    m[0] *= x;
    m[1] *= x;
    m[2] *= y;
    m[3] *= y;
  }
  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.transform(cos, sin, -sin, cos, 0, 0);
  }

  // --- paths -----------------------------------------------------------------

  beginPath(): void {
    this.path = [];
    this.current = null;
  }

  moveTo(x: number, y: number): void {
    const m = this.state.m;
    this.current = { pts: [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]], closed: false };
    this.path.push(this.current);
  }

  lineTo(x: number, y: number): void {
    if (!this.current) {
      this.moveTo(x, y);
      return;
    }
    const m = this.state.m;
    this.current.pts.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  }

  closePath(): void {
    const cur = this.current;
    if (!cur) return;
    cur.closed = true;
    // Canvas carries on from the subpath's first point.
    this.current = { pts: [cur.pts[0], cur.pts[1]], closed: false };
    this.path.push(this.current);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }

  roundRect(x: number, y: number, w: number, h: number, radii?: number | DOMPointInit | Array<number | DOMPointInit>): void {
    const list = Array.isArray(radii) ? radii : [radii ?? 0];
    const r = list.map((v) => (typeof v === 'number' ? v : (v.x ?? 0)));
    // Canvas's shorthand: 1 value for all, 2 for diagonals, 3 or 4 clockwise.
    const [tl, tr, br, bl] =
      r.length === 1 ? [r[0], r[0], r[0], r[0]]
      : r.length === 2 ? [r[0], r[1], r[0], r[1]]
      : r.length === 3 ? [r[0], r[1], r[2], r[1]]
      : [r[0], r[1], r[2], r[3]];
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    const fit = Math.min(1, w / Math.max(1e-6, tl + tr, bl + br), h / Math.max(1e-6, tl + bl, tr + br));
    const a = tl * fit;
    const b = tr * fit;
    const c = br * fit;
    const d = bl * fit;
    this.moveTo(x + a, y);
    this.lineTo(x + w - b, y);
    if (b > 0) this.arc(x + w - b, y + b, b, -Math.PI / 2, 0);
    this.lineTo(x + w, y + h - c);
    if (c > 0) this.arc(x + w - c, y + h - c, c, 0, Math.PI / 2);
    this.lineTo(x + d, y + h);
    if (d > 0) this.arc(x + d, y + h - d, d, Math.PI / 2, Math.PI);
    this.lineTo(x, y + a);
    if (a > 0) this.arc(x + a, y + a, a, Math.PI, Math.PI * 1.5);
    this.closePath();
  }

  arc(x: number, y: number, r: number, start: number, end: number, ccw = false): void {
    this.ellipse(x, y, r, r, 0, start, end, ccw);
  }

  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw = false,
  ): void {
    if (rx < 0 || ry < 0) return;
    let sweep = end - start;
    const TAU = Math.PI * 2;
    // Canvas's sweep rules: a turn or more is a full turn, otherwise the angle
    // is wrapped into the direction asked for.
    if (!ccw) {
      if (sweep >= TAU) sweep = TAU;
      else {
        sweep %= TAU;
        if (sweep < 0) sweep += TAU;
      }
    } else if (-sweep >= TAU) sweep = -TAU;
    else {
      sweep %= TAU;
      if (sweep > 0) sweep -= TAU;
    }

    const m = this.state.m;
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const rDev = Math.max(rx, ry) * k;
    const step = rDev > TOLERANCE ? 2 * Math.acos(1 - TOLERANCE / rDev) : Math.PI / 2;
    const n = Math.min(128, Math.max(2, Math.ceil(Math.abs(sweep) / step)));
    const cr = Math.cos(rotation);
    const sr = Math.sin(rotation);

    for (let i = 0; i <= n; i++) {
      const t = start + (sweep * i) / n;
      const ex = Math.cos(t) * rx;
      const ey = Math.sin(t) * ry;
      const px = x + ex * cr - ey * sr;
      const py = y + ex * sr + ey * cr;
      if (i === 0 && !this.current) this.moveTo(px, py);
      else this.lineTo(px, py);
    }
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const from = this.lastUser();
    const n = this.curveSteps(from[0], from[1], cx, cy, cx, cy, x, y);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      this.lineTo(u * u * from[0] + 2 * u * t * cx + t * t * x, u * u * from[1] + 2 * u * t * cy + t * t * y);
    }
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const from = this.lastUser();
    const n = this.curveSteps(from[0], from[1], c1x, c1y, c2x, c2y, x, y);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      this.lineTo(a * from[0] + b * c1x + c * c2x + d * x, a * from[1] + b * c1y + c * c2y + d * y);
    }
  }

  /** The current point, taken back into user space so curves can be built there. */
  private lastUser(): [number, number] {
    const cur = this.current;
    if (!cur) return [0, 0];
    const n = cur.pts.length;
    return this.toUser(cur.pts[n - 2], cur.pts[n - 1]);
  }

  private toUser(px: number, py: number): [number, number] {
    const [a, b, c, d, e, f] = this.state.m;
    const det = a * d - b * c || 1e-9;
    const x = px - e;
    const y = py - f;
    return [(d * x - c * y) / det, (a * y - b * x) / det];
  }

  private curveSteps(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): number {
    const m = this.state.m;
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const len = (Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)) * k;
    return Math.min(64, Math.max(2, Math.ceil(Math.sqrt(len) * 1.2)));
  }

  // --- drawing ---------------------------------------------------------------

  fill(): void {
    const style = this.state.fillStyle;
    const g = this.graphics();
    let any = false;
    g.beginPath();
    for (const sub of this.path) {
      if (sub.pts.length < 6) continue;
      g.poly(sub.pts, true);
      any = true;
    }
    if (!any) return;
    this.paint(g, style, false);
  }

  stroke(): void {
    const s = this.state;
    const m = s.m;
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const g = this.graphics();
    let any = false;
    g.beginPath();
    for (const sub of this.path) {
      if (sub.pts.length < 4) continue;
      if (s.dash.length > 0) {
        for (const run of dashed(sub.pts, sub.closed, s.dash.map((v) => v * k))) {
          g.poly(run, false);
          any = true;
        }
      } else {
        g.poly(sub.pts, sub.closed);
        any = true;
      }
    }
    if (!any) return;
    this.paint(g, s.strokeStyle, true, s.lineWidth * k);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const path = this.path;
    const cur = this.current;
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    this.path = path;
    this.current = cur;
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const path = this.path;
    const cur = this.current;
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    this.path = path;
    this.current = cur;
  }

  /** The stage is cleared by `begin`; nothing draws holes into it. */
  clearRect(): void {}

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    return new ShimGradient('linear', [x0, y0, x1, y1]) as unknown as CanvasGradient;
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient {
    return new ShimGradient('radial', [x0, y0, r0, x1, y1, r1]) as unknown as CanvasGradient;
  }

  drawImage(image: CanvasImageSource, ...args: number[]): void {
    const w0 = sourceWidth(image);
    const h0 = sourceHeight(image);
    if (w0 === 0 || h0 === 0) return;
    let sx = 0;
    let sy = 0;
    let sw = w0;
    let sh = h0;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (args.length >= 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    } else if (args.length >= 4) {
      [dx, dy, dw, dh] = args;
    } else {
      [dx, dy] = args;
      dw = w0;
      dh = h0;
    }
    const texture = this.texture(image, sx, sy, sw, sh);
    this.sprite(texture, dx, dy, dw / sw, dh / sh);
  }

  fillText(text: string, x: number, y: number): void {
    this.text(text, x, y, false);
  }

  strokeText(text: string, x: number, y: number): void {
    this.text(text, x, y, true);
  }

  measureText(text: string): TextMetrics {
    const ctx = this.measureCtx();
    ctx.font = this.state.font;
    return ctx.measureText(text);
  }

  // --- internals -------------------------------------------------------------

  private blend(): 'normal' | 'add' {
    return this.state.globalCompositeOperation === 'lighter' ? 'add' : 'normal';
  }

  /** The Graphics the next path goes into: the open one, unless a sprite or a blend change came between. */
  private graphics(): Graphics {
    const blend = this.blend();
    if (this.open && this.openBlend === blend) return this.open;
    let g = this.graphicsPool[this.graphicsUsed];
    if (!g) {
      g = new Graphics();
      this.graphicsPool.push(g);
    }
    this.graphicsUsed++;
    g.clear();
    g.blendMode = blend;
    this.root.addChild(g);
    this.open = g;
    this.openBlend = blend;
    return g;
  }

  private paint(g: Graphics, style: Style, stroke: boolean, width = 1): void {
    const s = this.state;
    if (typeof style === 'string') {
      const [color, alpha] = parseColor(style);
      const a = alpha * s.globalAlpha;
      if (a <= 0) return;
      if (stroke) g.stroke({ width, color, alpha: a, cap: s.lineCap, join: s.lineJoin });
      else g.fill({ color, alpha: a });
      return;
    }
    const fill = this.gradientFill(style);
    if (!fill) return;
    if (stroke) {
      g.stroke({
        width,
        texture: fill.texture,
        matrix: fill.matrix,
        textureSpace: 'global',
        color: 0xffffff,
        alpha: s.globalAlpha,
        cap: s.lineCap,
        join: s.lineJoin,
      });
    } else {
      g.fill({ texture: fill.texture, matrix: fill.matrix, textureSpace: 'global', color: 0xffffff, alpha: s.globalAlpha });
    }
  }

  /**
   * A gradient as a small texture baked on a real canvas once per set of
   * stops, and a matrix placing it where the gradient lies on screen.
   *
   * Pixi repeats a texture fill past its edge, so each bake covers well past
   * the gradient's own extent: twice the outer radius, or a gradient's length
   * either side of it, which every glow and sheen in the game stays inside.
   */
  private gradientFill(g: ShimGradient): { texture: Texture; matrix: Matrix } | null {
    const m = this.state.m;
    const world = new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]);
    const stops = g.stops.map(([o, c]) => `${o.toFixed(3)}:${c}`).join('|');
    if (g.kind === 'linear') {
      const [x0, y0, x1, y1] = g.coords;
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (dx === 0 && dy === 0) return null;
      const key = `L|${stops}`;
      const texture = this.gradientTexture(key, () => bakeLinear(g));
      // Texture x runs -1..2 of the gradient's length over 384 px; y is one
      // pixel, stretched across the perpendicular.
      const len = LINEAR_UNIT;
      const place = new Matrix(dx / len, dy / len, -dy, dx, x0 - dx, y0 - dy);
      return { texture, matrix: place.prepend(world) };
    }
    const [x0, y0, r0, x1, y1, r1] = g.coords;
    if (r1 <= 0) return null;
    const q = (v: number): string => (Math.round(v * 32) / 32).toFixed(3);
    const key = `R|${q((x0 - x1) / r1)}|${q((y0 - y1) / r1)}|${q(r0 / r1)}|${stops}`;
    const texture = this.gradientTexture(key, () => bakeRadial(g));
    const s = r1 / RADIAL_UNIT;
    const place = new Matrix(s, 0, 0, s, x1 - RADIAL_SIZE / 2 * s, y1 - RADIAL_SIZE / 2 * s);
    return { texture, matrix: place.prepend(world) };
  }

  private gradientTexture(key: string, bake: () => HTMLCanvasElement): Texture {
    let entry = this.gradients.get(key);
    if (!entry) {
      entry = { texture: new Texture({ source: new CanvasSource({ resource: bake() }) }), used: this.frame };
      this.gradients.set(key, entry);
    }
    entry.used = this.frame;
    return entry.texture;
  }

  private texture(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Texture {
    let entry = this.textures.get(image);
    if (!entry) {
      const source = new CanvasSource({ resource: image as HTMLCanvasElement });
      entry = { texture: new Texture({ source }), used: this.frame };
      this.textures.set(image, entry);
    }
    entry.used = this.frame;
    const base = entry.texture;
    if (sx === 0 && sy === 0 && sw === base.width && sh === base.height) return base;
    const key = `${base.uid}:${sx}:${sy}:${sw}:${sh}`;
    let framed = this.frames.get(key);
    if (!framed) {
      framed = new Texture({ source: base.source, frame: new Rectangle(sx, sy, sw, sh) });
      this.frames.set(key, framed);
    }
    return framed;
  }

  private sprite(texture: Texture, dx: number, dy: number, kx: number, ky: number): void {
    let s = this.spritePool[this.spritesUsed];
    if (!s) {
      s = new Sprite();
      this.spritePool.push(s);
    }
    this.spritesUsed++;
    s.texture = texture;
    const [a, b, c, d, e, f] = this.state.m;
    if (b === 0 && c === 0) {
      s.rotation = 0;
      s.skew.set(0, 0);
      s.scale.set(a * kx, d * ky);
      s.position.set(a * dx + e, d * dy + f);
    } else {
      s.setFromMatrix(new Matrix(a * kx, b * kx, c * ky, d * ky, a * dx + c * dy + e, b * dx + d * dy + f));
    }
    s.alpha = this.state.globalAlpha;
    s.blendMode = this.blend();
    this.root.addChild(s);
    this.open = null;
  }

  /**
   * Text is set on a real canvas once per string and style and drawn as a
   * sprite, at the scale it is shown so it stays crisp.
   */
  private text(text: string, x: number, y: number, stroke: boolean): void {
    const s = this.state;
    const style = stroke ? s.strokeStyle : s.fillStyle;
    if (typeof style !== 'string' || text === '') return;
    const m = s.m;
    const k = Math.max(0.5, Math.round(Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * 4) / 4);
    const key = `${stroke ? 's' : 'f'}|${s.font}|${style}|${stroke ? s.lineWidth : 0}|${s.textAlign}|${s.textBaseline}|${s.lineJoin}|${k}|${text}`;
    let entry = this.texts.get(key);
    if (!entry) {
      const probe = this.measureCtx();
      probe.font = s.font;
      probe.textAlign = s.textAlign;
      probe.textBaseline = s.textBaseline;
      // Measured with the same alignment and baseline, the box is relative to
      // the anchor exactly as Canvas would place the text around it.
      const metrics = probe.measureText(text);
      const pad = (stroke ? s.lineWidth : 0) + 2;
      const left = Math.ceil(metrics.actualBoundingBoxLeft + pad);
      const right = Math.ceil(metrics.actualBoundingBoxRight + pad);
      const up = Math.ceil(metrics.actualBoundingBoxAscent + pad);
      const down = Math.ceil(metrics.actualBoundingBoxDescent + pad);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil((left + right) * k));
      canvas.height = Math.max(1, Math.ceil((up + down) * k));
      const c = canvas.getContext('2d');
      if (!c) return;
      c.setTransform(k, 0, 0, k, left * k, up * k);
      c.font = s.font;
      c.textAlign = s.textAlign;
      c.textBaseline = s.textBaseline;
      c.lineJoin = s.lineJoin;
      if (stroke) {
        c.strokeStyle = style;
        c.lineWidth = s.lineWidth;
        c.strokeText(text, 0, 0);
      } else {
        c.fillStyle = style;
        c.fillText(text, 0, 0);
      }
      entry = { canvas, k, ox: left, oy: up, used: this.frame };
      this.texts.set(key, entry);
    }
    entry.used = this.frame;
    const texture = this.texture(entry.canvas, 0, 0, entry.canvas.width, entry.canvas.height);
    this.sprite(texture, x - entry.ox, y - entry.oy, 1 / entry.k, 1 / entry.k);
  }

  private measureCtx(): CanvasRenderingContext2D {
    if (!this.measure) {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) throw new Error('2D canvas context unavailable');
      this.measure = ctx;
    }
    return this.measure;
  }

  /** Free everything this context put on the GPU; the renderer must be gone first. */
  destroy(): void {
    this.evict(true);
    for (const g of this.graphicsPool) g.destroy();
    for (const sprite of this.spritePool) sprite.destroy();
    this.root.destroy();
  }

  /**
   * Free the GPU copies of bitmaps nothing has drawn lately.
   *
   * While the renderer runs, a texture it has drawn may still sit in one of
   * its cached batches, so its GPU copy is unloaded rather than the texture
   * destroyed; the objects themselves go once nothing refers to them.
   */
  private evict(all = false): void {
    const stale = all ? Infinity : this.frame - TEXTURE_IDLE_FRAMES;
    const free = (texture: Texture): void => {
      if (all) texture.destroy(true);
      else texture.source.unload();
    };
    for (const [image, entry] of this.textures) {
      if (entry.used >= stale) continue;
      for (const [key, framed] of this.frames) {
        if (framed.source === entry.texture.source) this.frames.delete(key);
      }
      free(entry.texture);
      this.textures.delete(image);
    }
    for (const [key, entry] of this.texts) {
      if (entry.used < stale) this.texts.delete(key);
    }
    for (const [key, entry] of this.gradients) {
      if (entry.used >= stale) continue;
      free(entry.texture);
      this.gradients.delete(key);
    }
  }
}

function freshState(): State {
  return {
    m: [1, 0, 0, 1, 0, 0],
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    dash: [],
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
}

/** The game only ever draws canvases and images, whose sizes are plain numbers. */
function sourceWidth(image: CanvasImageSource): number {
  if (image instanceof HTMLImageElement) return image.naturalWidth;
  return (image as { width: number }).width;
}

function sourceHeight(image: CanvasImageSource): number {
  if (image instanceof HTMLImageElement) return image.naturalHeight;
  return (image as { height: number }).height;
}

/** Split a polyline into the runs a dash pattern leaves drawn. */
function dashed(pts: number[], closed: boolean, pattern: number[]): number[][] {
  const runs: number[][] = [];
  const all = closed ? [...pts, pts[0], pts[1]] : pts;
  let index = 0;
  let left = pattern[0];
  let on = true;
  let run: number[] | null = [all[0], all[1]];
  for (let i = 2; i < all.length; i += 2) {
    let x0 = all[i - 2];
    let y0 = all[i - 1];
    const x1 = all[i];
    const y1 = all[i + 1];
    let seg = Math.hypot(x1 - x0, y1 - y0);
    while (seg > 0) {
      const take = Math.min(seg, left);
      const t = take / seg;
      x0 += (x1 - x0) * t;
      y0 += (y1 - y0) * t;
      seg -= take;
      left -= take;
      if (on && run) run.push(x0, y0);
      if (left <= 1e-6) {
        if (on && run && run.length >= 4) runs.push(run);
        on = !on;
        index = (index + 1) % pattern.length;
        left = pattern[index] || 1;
        run = on ? [x0, y0] : null;
      }
    }
  }
  if (on && run && run.length >= 4) runs.push(run);
  return runs;
}

const colors = new Map<string, [number, number]>();
let colorProbe: CanvasRenderingContext2D | null = null;

/** A CSS colour as Pixi's number and alpha. The browser does the parsing, once per string. */
function parseColor(css: string): [number, number] {
  const known = colors.get(css);
  if (known) return known;
  let hit = parseFast(css);
  if (!hit) {
    colorProbe ??= document.createElement('canvas').getContext('2d');
    if (colorProbe) {
      colorProbe.fillStyle = '#000';
      colorProbe.fillStyle = css;
      hit = parseFast(String(colorProbe.fillStyle));
    }
  }
  hit ??= [0, 1];
  if (colors.size > 4000) colors.clear();
  colors.set(css, hit);
  return hit;
}

function parseFast(css: string): [number, number] | null {
  const s = css.trim();
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return [(r << 16) | (g << 8) | b, a];
    }
    if (h.length === 6 || h.length === 8) {
      const n = parseInt(h.slice(0, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
      return Number.isNaN(n) ? null : [n, a];
    }
    return null;
  }
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(s);
  if (!match) return null;
  const r = Math.round(Number(match[1]));
  const g = Math.round(Number(match[2]));
  const b = Math.round(Number(match[3]));
  let a = match[4] === undefined ? 1 : Number(match[4]);
  if (match[5] === '%') a /= 100;
  return [(r << 16) | (g << 8) | b, Math.max(0, Math.min(1, a))];
}

/** Pixels per gradient length in a baked linear gradient. */
const LINEAR_UNIT = 128;

function bakeLinear(g: ShimGradient): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = LINEAR_UNIT * 3;
  canvas.height = 1;
  const c = canvas.getContext('2d');
  if (c) {
    const grad = c.createLinearGradient(LINEAR_UNIT, 0, LINEAR_UNIT * 2, 0);
    for (const [o, color] of g.stops) grad.addColorStop(o, color);
    c.fillStyle = grad;
    c.fillRect(0, 0, canvas.width, 1);
  }
  return canvas;
}

/** Pixels per outer radius in a baked radial gradient, and the bake's size. */
const RADIAL_UNIT = 64;
const RADIAL_SIZE = RADIAL_UNIT * 4;

function bakeRadial(g: ShimGradient): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = RADIAL_SIZE;
  canvas.height = RADIAL_SIZE;
  const c = canvas.getContext('2d');
  if (c) {
    const [x0, y0, r0, x1, y1, r1] = g.coords;
    const k = RADIAL_UNIT / r1;
    const mid = RADIAL_SIZE / 2;
    const grad = c.createRadialGradient(mid + (x0 - x1) * k, mid + (y0 - y1) * k, r0 * k, mid, mid, RADIAL_UNIT);
    for (const [o, color] of g.stops) grad.addColorStop(o, color);
    c.fillStyle = grad;
    c.fillRect(0, 0, RADIAL_SIZE, RADIAL_SIZE);
  }
  return canvas;
}
