import { MAP_SIZE, MAP_TILES, TILE } from '@shared/sim/constants';
import { oreAt, oreBand } from '@shared/sim/ore';
import { hash2, valueNoise } from '@shared/sim/rng';
import { TERRAIN_ORDER } from '@shared/sim/terrain';
import type { Terrain } from '@shared/sim/types';
import { drawOreTiles, type OreTile } from './ore';

/** A world-space rectangle to paint, in pixels. */
export interface GroundRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How far outside the rect painting has to start. Grass tufts, pebbles, shore
 * foam and ore all reach a little past their own tile: one tile covers them.
 */
const OVERHANG = 1;

/** Colour field samples per tile edge. Four keeps biome edges organic, not stepped. */
const FIELD_RES = 4;

/**
 * Ground colours, and how far each wanders. `alt` is the colour a biome drifts
 * toward in patches (dry grass, damp sand, lichen on stone), so a meadow is
 * not a single swatch of green.
 */
const GROUND: Record<Terrain, { base: [number, number, number]; alt: [number, number, number] }> = {
  deep: { base: [22, 64, 96], alt: [18, 54, 84] },
  water: { base: [44, 120, 150], alt: [52, 134, 158] },
  sand: { base: [222, 204, 158], alt: [206, 186, 138] },
  grass: { base: [112, 164, 88], alt: [140, 170, 92] },
  forest: { base: [78, 128, 72], alt: [92, 122, 66] },
  rock: { base: [140, 144, 146], alt: [124, 130, 134] },
};

/** How far out each band of the sea reaches from the shore, in world units. */
const SEA_REACH = [9, 24, 46, 78];
/** The eight directions the sea looks along for land, worked out once. */
const RING_COS = Array.from({ length: 8 }, (_, k) => Math.cos((k / 8) * Math.PI * 2));
const RING_SIN = Array.from({ length: 8 }, (_, k) => Math.sin((k / 8) * Math.PI * 2));

/** Surf, shallows, open water, deeper water, and the deep beyond every band. */
const SEA: [number, number, number][] = [
  [214, 232, 226],
  [92, 176, 182],
  [52, 136, 162],
  [36, 102, 138],
  [24, 68, 102],
];

const WET_SAND: [number, number, number] = [188, 170, 128];

/**
 * The island's ground, painted on demand into whatever surface asks for it.
 *
 * It is a soft colour field — a few samples a tile, stretched with smoothing,
 * so meadow fades into beach and shallows fade into deep water the way
 * painted ground does — with a hand-placed layer of detail over it: grass
 * tufts, flowers, leaf litter, pebbles, sand ripples. The field is one small
 * bitmap built once per island; the detail is deterministic per tile, so the
 * strip-by-strip ground cache always paints the same picture.
 */
export class GroundMesh {
  private field: HTMLCanvasElement | null = null;
  private fieldOf: Uint8Array | null = null;
  private grain: CanvasPattern | null = null;

  constructor(readonly seed: number) {}

  /**
   * Paint every tile touching `rect`. The caller owns the transform and the
   * clip, so this draws in world coordinates.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    terrain: Uint8Array,
    ore: Uint8Array,
    oreLeft: Uint16Array,
    rect: GroundRect,
  ): void {
    const tx0 = Math.max(0, Math.floor(rect.x / TILE) - OVERHANG);
    const ty0 = Math.max(0, Math.floor(rect.y / TILE) - OVERHANG);
    const tx1 = Math.min(MAP_TILES - 1, Math.floor((rect.x + rect.w) / TILE) + OVERHANG);
    const ty1 = Math.min(MAP_TILES - 1, Math.floor((rect.y + rect.h) / TILE) + OVERHANG);
    if (tx1 < tx0 || ty1 < ty0) return;

    const field = this.ensureField(terrain);
    if (field) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(field, 0, 0, MAP_SIZE, MAP_SIZE);
      ctx.restore();
    }

    const grain = this.ensureGrain(ctx);
    if (grain) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = grain;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }

    drawDetail(ctx, terrain, this.seed, tx0, ty0, tx1, ty1);
    drawOre(ctx, ore, oreLeft, tx0, ty0, tx1, ty1);
  }

  /**
   * One pixel per quarter tile. Each sample looks up the terrain at a
   * noise-nudged point, so biome edges wander instead of following the grid,
   * and takes a colour that drifts across the island in broad patches.
   */
  private ensureField(terrain: Uint8Array): HTMLCanvasElement | null {
    if (this.field && this.fieldOf === terrain) return this.field;
    const size = MAP_TILES * FIELD_RES;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    if (!c) return null;
    const image = c.createImageData(size, size);
    const px = image.data;
    const step = TILE / FIELD_RES;
    const seed = this.seed;
    const kindAt = (x: number, y: number): Terrain => terrainAt(terrain, Math.floor(x / TILE), Math.floor(y / TILE));
    /**
     * The first of the sea's bands that reaches the other element: land, for
     * a water sample; water, when `wet` asks from the beach. 4 means none.
     */
    const landWithin = (x: number, y: number, wet = false): number => {
      for (let band = 0; band < SEA_REACH.length; band++) {
        const r = SEA_REACH[band];
        for (let k = 0; k < 8; k++) {
          const found = kindAt(x + RING_COS[k] * r, y + RING_SIN[k] * r);
          if (isWet(found) === wet) return band;
        }
        if (wet) return SEA_REACH.length;
      }
      return SEA_REACH.length;
    };

    for (let sy = 0; sy < size; sy++) {
      for (let sx = 0; sx < size; sx++) {
        const wx = (sx + 0.5) * step;
        const wy = (sy + 0.5) * step;
        const jx =
          (valueNoise(wx / 52, wy / 52, seed + 11) - 0.5) * TILE * 1.3 +
          (valueNoise(wx / 17, wy / 17, seed + 13) - 0.5) * TILE * 0.45;
        const jy =
          (valueNoise(wx / 52, wy / 52, seed + 29) - 0.5) * TILE * 1.3 +
          (valueNoise(wx / 17, wy / 17, seed + 31) - 0.5) * TILE * 0.45;
        // Biome edges wander freely, but the coast stays within a few pixels
        // of where the land really ends, or you would see yourself wade.
        const sx0 = wx + jx * 0.22;
        const sy0 = wy + jy * 0.22;
        const near = kindAt(sx0, sy0);
        const far = kindAt(wx + jx, wy + jy);
        const kind = isWet(near) === isWet(far) ? far : near;
        let { base, alt } = GROUND[kind];

        if (isWet(kind)) {
          // Water is coloured by how far the nearest land is, so the sea
          // shelves from surf to shallows to deep along the real coastline.
          const reach = landWithin(sx0, sy0);
          const band = SEA[reach];
          base = band;
          alt = band;
        } else if (kind === 'sand' && landWithin(sx0, sy0, true) === 0) {
          base = WET_SAND;
          alt = WET_SAND;
        }

        const patch = valueNoise(wx / 260, wy / 260, seed + 101) * 0.65 + valueNoise(wx / 90, wy / 90, seed + 7) * 0.35;
        const mixAlt = Math.max(0, Math.min(1, (patch - 0.35) * 2.2));
        const light = 1 + (valueNoise(wx / 55, wy / 55, seed + 53) - 0.5) * 0.12 + (hash2(sx, sy, seed) - 0.5) * 0.025;

        const i = (sy * size + sx) * 4;
        px[i] = Math.min(255, (base[0] + (alt[0] - base[0]) * mixAlt) * light);
        px[i + 1] = Math.min(255, (base[1] + (alt[1] - base[1]) * mixAlt) * light);
        px[i + 2] = Math.min(255, (base[2] + (alt[2] - base[2]) * mixAlt) * light);
        px[i + 3] = 255;
      }
    }
    c.putImageData(image, 0, 0);

    // A blur about one sample wide melts the stair-steps a sample grid leaves
    // along every biome edge, and lets every repaint stretch the field with
    // plain bilinear smoothing. Blurring at this size rather than after
    // enlarging it costs a seventh as much, which was most of the hitch as an
    // island first appears. Where canvas filters are unsupported it is simply
    // skipped, and the edges are a little crisper.
    const soft = document.createElement('canvas');
    soft.width = size;
    soft.height = size;
    const b = soft.getContext('2d');
    if (!b) return null;
    // Blurring pulls in transparent black at the border; pad it with the sea.
    b.fillStyle = 'rgb(22, 64, 96)';
    b.fillRect(0, 0, size, size);
    b.filter = 'blur(1px)';
    b.drawImage(canvas, 0, 0);
    b.filter = 'none';

    this.field = soft;
    this.fieldOf = terrain;
    return soft;
  }

  /**
   * Fine grain over everything: soft light and dark flecks, so stretched
   * colour reads as a surface rather than as a gradient.
   */
  private ensureGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.grain) return this.grain;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    if (!c) return null;
    for (let i = 0; i < 420; i++) {
      const x = hash2(i, 1, this.seed) * size;
      const y = hash2(i, 2, this.seed) * size;
      const r = 0.6 + hash2(i, 3, this.seed) * 1.6;
      const dark = hash2(i, 4, this.seed) < 0.6;
      c.fillStyle = dark ? 'rgba(20, 30, 20, 0.16)' : 'rgba(255, 255, 230, 0.12)';
      c.beginPath();
      c.ellipse(x, y, r * 1.4, r, 0, 0, Math.PI * 2);
      c.fill();
    }
    this.grain = ctx.createPattern(canvas, 'repeat');
    return this.grain;
  }
}

function terrainAt(terrain: Uint8Array, tx: number, ty: number): Terrain {
  if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return 'deep';
  return TERRAIN_ORDER[terrain[ty * MAP_TILES + tx]] ?? 'deep';
}

function isWet(kind: Terrain): boolean {
  return kind === 'water' || kind === 'deep';
}

/**
 * The hand-placed layer: every tile gets a few marks chosen by its biome and
 * a hash of its position. Marks of one colour go into one path, so a screen of
 * meadow is a handful of fills however many tufts it holds.
 */
function drawDetail(
  ctx: CanvasRenderingContext2D,
  terrain: Uint8Array,
  seed: number,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
): void {
  const strokes = new Map<string, Path2D>();
  const fills = new Map<string, Path2D>();
  const stroke = (color: string): Path2D => {
    let p = strokes.get(color);
    if (!p) strokes.set(color, (p = new Path2D()));
    return p;
  };
  const fill = (color: string): Path2D => {
    let p = fills.get(color);
    if (!p) fills.set(color, (p = new Path2D()));
    return p;
  };

  const tuft = (x: number, y: number, h: number, dark: string, light: string): void => {
    const d = stroke(dark);
    d.moveTo(x - 1.6, y);
    d.quadraticCurveTo(x - 2.2, y - h * 0.6, x - 3.4, y - h * 0.9);
    d.moveTo(x + 1.4, y);
    d.quadraticCurveTo(x + 2, y - h * 0.6, x + 3.2, y - h * 0.85);
    const l = stroke(light);
    l.moveTo(x, y);
    l.quadraticCurveTo(x - 0.3, y - h * 0.7, x + 0.6, y - h);
  };

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const kind = terrainAt(terrain, tx, ty);
      const h = (k: number): number => hash2(tx * 7 + k, ty * 13 - k, seed + 313);
      const ox = tx * TILE;
      const oy = ty * TILE;
      const at = (k: number): [number, number] => [ox + 3 + h(k) * (TILE - 6), oy + 3 + h(k + 50) * (TILE - 6)];

      switch (kind) {
        case 'grass': {
          const tufts = Math.floor(h(1) * 2.6);
          for (let i = 0; i < tufts; i++) {
            const [x, y] = at(10 + i);
            tuft(x, y, 3.2 + h(20 + i) * 2.2, '#5f9448', '#9cc877');
          }
          if (h(2) < 0.1) {
            // A small patch of flowers.
            const colors = ['#f4f1e6', '#f2d46a', '#c9a6e8'];
            const color = colors[Math.floor(h(3) * colors.length)];
            const [fx, fy] = at(30);
            for (let i = 0; i < 4; i++) {
              const x = fx + (h(31 + i) - 0.5) * 9;
              const y = fy + (h(35 + i) - 0.5) * 6;
              const petal = fill(color);
              petal.moveTo(x + 1.3, y);
              petal.arc(x, y, 1.3, 0, Math.PI * 2);
              const eye = fill('#d98f2c');
              eye.moveTo(x + 0.45, y);
              eye.arc(x, y, 0.45, 0, Math.PI * 2);
            }
          }
          break;
        }
        case 'forest': {
          const [x, y] = at(10);
          if (h(12) < 0.6) tuft(x, y, 3.6 + h(11) * 2, '#44743c', '#80ac62');
          // Leaf litter on the forest floor.
          const litter = 2 + Math.floor(h(4) * 3);
          for (let i = 0; i < litter; i++) {
            const [lx, ly] = at(60 + i);
            const color = h(70 + i) < 0.5 ? '#6f7a3c' : '#8a6a3a';
            const leaf = fill(color);
            const a = h(80 + i) * Math.PI;
            leaf.moveTo(lx + Math.cos(a) * 1.8, ly + Math.sin(a) * 1.8);
            leaf.ellipse(lx, ly, 1.8, 0.9, a, 0, Math.PI * 2);
          }
          if (h(5) < 0.18) {
            // A fern.
            const [fx, fy] = at(90);
            const fern = stroke('#5e9a4e');
            for (let i = -2; i <= 2; i++) {
              const a = -Math.PI / 2 + i * 0.45;
              fern.moveTo(fx, fy);
              fern.quadraticCurveTo(fx + Math.cos(a) * 3, fy + Math.sin(a) * 4, fx + Math.cos(a) * 6, fy + Math.sin(a) * 5 + 1.5);
            }
          }
          break;
        }
        case 'sand': {
          if (h(1) < 0.55) {
            // Wind ripples: a pale crest over a faint trough.
            const [x, y] = at(10);
            const w = 6 + h(11) * 6;
            const crest = stroke('#f3e6c0');
            crest.moveTo(x - w, y);
            crest.quadraticCurveTo(x, y - 2.2, x + w, y);
            const trough = stroke('#c9ae7c');
            trough.moveTo(x - w * 0.8, y + 1.4);
            trough.quadraticCurveTo(x, y - 0.6, x + w * 0.8, y + 1.4);
          }
          if (h(2) < 0.12) {
            const [x, y] = at(20);
            const shell = fill('#f6eee0');
            shell.moveTo(x + 1.6, y);
            shell.ellipse(x, y, 1.6, 1.1, 0.4, 0, Math.PI * 2);
          }
          break;
        }
        case 'rock': {
          const pebbles = Math.floor(h(1) * 3);
          for (let i = 0; i < pebbles; i++) {
            const [x, y] = at(10 + i);
            const r = 1.2 + h(20 + i) * 1.6;
            const body = fill('#7d838b');
            body.moveTo(x + r * 1.3, y);
            body.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2);
            const lit = fill('#b9bec4');
            lit.moveTo(x - r * 0.2 + r * 0.6, y - r * 0.35);
            lit.ellipse(x - r * 0.2, y - r * 0.35, r * 0.6, r * 0.35, 0, 0, Math.PI * 2);
          }
          if (h(3) < 0.35) {
            // A crack in the bedrock.
            const [x, y] = at(30);
            const crack = stroke('#6c7178');
            crack.moveTo(x - 5, y - 2);
            crack.lineTo(x - 1, y);
            crack.lineTo(x + 2, y - 1);
            crack.lineTo(x + 6, y + 2);
          }
          if (h(4) < 0.2) {
            const [x, y] = at(40);
            const moss = fill('#7f9a5a');
            for (let i = 0; i < 3; i++) {
              const mx = x + (h(41 + i) - 0.5) * 6;
              const my = y + (h(44 + i) - 0.5) * 4;
              moss.moveTo(mx + 1.8, my);
              moss.ellipse(mx, my, 1.8, 1.1, 0, 0, Math.PI * 2);
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.9;
  for (const [color, path] of strokes) {
    ctx.strokeStyle = color;
    ctx.stroke(path);
  }
  for (const [color, path] of fills) {
    ctx.fillStyle = color;
    ctx.fill(path);
  }
  ctx.restore();
}

/** Ore sits on the ground, over the detail and under everything placed on it. */
function drawOre(
  ctx: CanvasRenderingContext2D,
  ore: Uint8Array,
  oreLeft: Uint16Array,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
): void {
  const tiles: OreTile[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const kind = oreAt(ore, tx, ty);
      // A worked tile is drawn thinner, so a patch visibly wears away from its
      // rim inward and a player can see one running out before it stops.
      if (kind) tiles.push({ tx, ty, kind, band: oreBand(oreLeft[ty * MAP_TILES + tx]) });
    }
  }
  drawOreTiles(ctx, tiles);
}
