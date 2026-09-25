/**
 * Shared craft for the world's characters, creatures and scenery: the soft
 * contact shadow, the hit-flash tint, and the sprite cache that lets a forest
 * of detailed trees cost what a forest of blobs did.
 *
 * The house light comes from the upper left. Every form is lit on that side,
 * shaded on the other, and carries a dark outline so it holds its shape
 * against any ground.
 */

/** The ink every silhouette is outlined in: a deep blue-black, never pure black. */
export const INK = '#171a24';

let deviceScale = 1;

/** The renderer reports world-to-device scale once a frame, like the item cache. */
export function setPaintScale(scale: number): void {
  deviceScale = scale;
}

export function paintScale(): number {
  return deviceScale;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** A square box of `r` about the anchor, for small baked parts. */
export function around(r: number): { left: number; right: number; top: number; bottom: number } {
  return { left: r, right: r, top: r, bottom: r };
}

/**
 * Draw something detailed from a bitmap baked at device resolution.
 *
 * `box` is the sprite's extent in world units around the anchor point, so a
 * tree rooted at its base passes a box reaching mostly upward. The pixel size
 * is quantised so small zoom changes reuse what is already baked.
 */
export function blitCached(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  box: { left: number; top: number; right: number; bottom: number },
  draw: (bake: CanvasRenderingContext2D) => void,
): void {
  const w = box.left + box.right;
  const h = box.top + box.bottom;
  // Blitting a sprite at a fractional pixel, or a scale other than the one it
  // was baked at, makes the rasteriser filter every pixel of it. With a few
  // hundred trees on screen that filtering was most of the frame, so where the
  // transform is a plain scale the sprite is baked at exactly that scale and
  // copied to a whole device pixel.
  const m = ctx.getTransform();
  const plain = m.b === 0 && m.c === 0 && m.a === m.d && m.a > 0;
  const k = plain ? Math.round(m.a * 64) / 64 : Math.max(0.5, Math.ceil(deviceScale * 4) / 4);
  const id = `${key}@${k}`;
  let sprite = sprites.get(id);
  if (sprite) {
    // Kept in order of last use, so the cap below drops what has not been
    // drawn lately rather than what was baked first: creature frames come and
    // go by the hundred, and must not push the forest out.
    sprites.delete(id);
    sprites.set(id, sprite);
  } else {
    sprite = document.createElement('canvas');
    sprite.width = Math.max(1, Math.ceil(w * k));
    sprite.height = Math.max(1, Math.ceil(h * k));
    const bake = sprite.getContext('2d');
    if (!bake) {
      ctx.save();
      ctx.translate(x, y);
      draw(ctx);
      ctx.restore();
      return;
    }
    bake.setTransform(k, 0, 0, k, box.left * k, box.top * k);
    draw(bake);
    sprites.set(id, sprite);
    // Zooming through many scales would otherwise keep every one of them.
    if (sprites.size > 900) {
      const oldest = sprites.keys().next().value;
      if (oldest !== undefined) sprites.delete(oldest);
    }
  }
  if (!plain) {
    ctx.drawImage(sprite, x - box.left, y - box.top, w, h);
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(sprite, Math.round(m.a * (x - box.left) + m.e), Math.round(m.d * (y - box.top) + m.f));
  ctx.setTransform(m);
}

let shadowSprite: HTMLCanvasElement | null = null;

/**
 * A soft contact shadow: dense under the object, fading out at its edge. The
 * gradient is baked once and stretched, because a radial gradient per creature
 * per frame is the kind of cost that only shows up on a busy night.
 */
export function softShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  alpha = 0.34,
  ry = rx * 0.42,
): void {
  if (!shadowSprite) {
    shadowSprite = document.createElement('canvas');
    shadowSprite.width = 64;
    shadowSprite.height = 64;
    const s = shadowSprite.getContext('2d');
    if (s) {
      const g = s.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(12, 14, 22, 1)');
      g.addColorStop(0.55, 'rgba(12, 14, 22, 0.7)');
      g.addColorStop(1, 'rgba(12, 14, 22, 0)');
      s.fillStyle = g;
      s.fillRect(0, 0, 64, 64);
    }
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(shadowSprite, x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = prev;
}

/**
 * How far every colour is pushed toward white. A creature that was just hit
 * flashes by having its own palette bleached, rather than by a white blob
 * standing in for it, so the flash keeps the silhouette.
 */
let flash = 0;

export function setFlash(amount: number): void {
  flash = Math.max(0, Math.min(1, amount));
}

/** The flash currently set, for art that bakes itself and must key on it. */
export function paintFlash(): number {
  return flash;
}

function mix(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const to = (v: number): number => Math.round(v + (255 - v) * amount);
  return `rgb(${to(r)}, ${to(g)}, ${to(b)})`;
}

/** A palette colour, bleached by the current flash. */
export function tint(hex: string): string {
  return flash > 0 ? mix(hex, flash * 0.85) : hex;
}

/** Lighten (positive) or darken (negative) a hex colour by a fraction, as hex. */
export function tone(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number): number => {
    const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * A fill lit from the upper left: light on the side facing the sun, the base
 * colour through the middle, shade on the far side.
 */
export function litFill(
  ctx: CanvasRenderingContext2D,
  base: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  light = 0.22,
  dark = -0.28,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, tint(tone(base, light)));
  g.addColorStop(0.45, tint(base));
  g.addColorStop(1, tint(tone(base, dark)));
  return g;
}

/** Fill the current path, then outline it in the house ink. */
export function fillInk(
  ctx: CanvasRenderingContext2D,
  fill: string | CanvasGradient,
  width = 1.1,
  ink: string = INK,
): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = ink;
  ctx.stroke();
}

/** A rounded capsule between two points: limbs, straps, branches. */
export function capsule(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: string | CanvasGradient,
  ink: string | null = INK,
  inkWidth = 1.1,
): void {
  ctx.lineCap = 'round';
  if (ink) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width + inkWidth * 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Deterministic 0..1 from a seed and a salt, for per-sprite variation. */
export function rand(seed: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
