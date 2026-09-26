import { OUTLINE, PixelGrid, blitPixels, type Rgb } from './pixel';

/**
 * A 5-by-5 capital font for the words and numbers that float up in the world:
 * damage, loot, Dodge, Counter. A system font drawn at the pixel grid came
 * out soft and blurry next to sprites whose every texel is a hard square;
 * these are laid on the same grid, outlined the same way.
 */
const GLYPHS: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  F: ['#####', '#....', '####.', '#....', '#....'],
  G: ['.####', '#....', '#..##', '#...#', '.####'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  J: ['....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '####.', '#....', '#....'],
  Q: ['.###.', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  Z: ['#####', '...#.', '..#..', '.#...', '#####'],
  0: ['.###.', '#..##', '#.#.#', '##..#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '.###.'],
  2: ['####.', '....#', '.###.', '#....', '#####'],
  3: ['####.', '....#', '.###.', '....#', '####.'],
  4: ['#...#', '#...#', '#####', '....#', '....#'],
  5: ['#####', '#....', '####.', '....#', '####.'],
  6: ['.###.', '#....', '####.', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '..#..'],
  8: ['.###.', '#...#', '.###.', '#...#', '.###.'],
  9: ['.###.', '#...#', '.####', '....#', '.###.'],
  '+': ['.....', '..#..', '.###.', '..#..', '.....'],
  '-': ['.....', '.....', '.###.', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '.....', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '..#..'],
  ',': ['.....', '.....', '.....', '..#..', '.#...'],
  "'": ['..#..', '..#..', '.....', '.....', '.....'],
  '%': ['##..#', '##.#.', '..#..', '.#.##', '#..##'],
  '/': ['....#', '...#.', '..#..', '.#...', '#....'],
  ':': ['.....', '..#..', '.....', '..#..', '.....'],
  '?': ['.###.', '#...#', '..##.', '.....', '..#..'],
  '×': ['.....', '.#.#.', '..#..', '.#.#.', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....'],
};

const W = 5;
const H = 5;
const GAP = 1;
/** Room for the outline all round. */
const PAD = 1;

function rgbOf(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Whether every character of `text` has a glyph, so a caller can fall back to a real font. */
export function pixelFontCovers(text: string): boolean {
  for (const ch of text.toUpperCase()) if (!(ch in GLYPHS)) return false;
  return true;
}

export function pixelTextWidth(text: string): number {
  return text.length * (W + GAP) - GAP + PAD * 2;
}

/**
 * Draw `text` centred on (x, y), each font pixel `texel` world units. The
 * bottom row of each letter is a shade darker, so the words read as lit from
 * above like everything else in the pixel look.
 */
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, texel: number, color: string): void {
  const up = text.toUpperCase();
  const width = pixelTextWidth(up);
  const height = H + PAD * 2;
  blitPixels(ctx, `pf|${up}|${color}`, x, y, width / 2, height / 2, texel, () => {
    const g = new PixelGrid(width, height);
    const fill = rgbOf(color);
    const shade: Rgb = [Math.round(fill[0] * 0.72), Math.round(fill[1] * 0.72), Math.round(fill[2] * 0.72)];
    let cx = PAD;
    for (const ch of up) {
      const glyph = GLYPHS[ch] ?? GLYPHS[' '];
      for (let gy = 0; gy < H; gy++) {
        for (let gx = 0; gx < W; gx++) {
          if (glyph[gy][gx] === '#') g.set(cx + gx, PAD + gy, gy === H - 1 ? shade : fill);
        }
      }
      cx += W + GAP;
    }
    g.outline(OUTLINE);
    return g;
  });
}
