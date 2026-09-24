import { MAP_SIZE, MAP_TILES, TILE } from '@shared/sim/constants';
import { oreAt, oreBand } from '@shared/sim/ore';
import { hash2 } from '@shared/sim/rng';
import { TERRAIN_ORDER } from '@shared/sim/terrain';
import type { Terrain } from '@shared/sim/types';
import { drawOreTile } from './factory';
import { TERRAIN_COLORS, shift } from './palette';

/** A world-space rectangle to paint, in pixels. */
export interface GroundRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How far outside the rect painting has to start. A jittered corner moves a
 * third of a tile, shore foam reaches nearly half of one past its tile centre,
 * and ore pebbles scatter: a tile of margin covers all three.
 */
const OVERHANG = 1;

/**
 * How much each facet is grown about its middle. Neighbouring triangles share
 * their corners exactly, so antialiasing along a shared edge leaves a hairline
 * of whatever is underneath; overlapping them by a fraction of a pixel closes
 * it. Stroking each triangle in its own fill colour did the same job and cost
 * three times as much as filling it.
 */
const BLEED = 1.06;

/**
 * Every shade a facet can take, resolved once. The mesh picks between a lit and
 * a shadowed face and then drifts it by a whole step, so the whole palette is
 * small enough to precompute and index into.
 */
const FACET_SHADES: Record<Terrain, { lit: string[]; shade: string[] }> = buildFacetShades();

function buildFacetShades(): Record<Terrain, { lit: string[]; shade: string[] }> {
  const out = {} as Record<Terrain, { lit: string[]; shade: string[] }>;
  for (const kind of Object.keys(TERRAIN_COLORS) as Terrain[]) {
    const { lit, shade, vary } = TERRAIN_COLORS[kind];
    const ramp = (base: string): string[] => {
      const steps: string[] = [];
      for (let i = -vary; i <= vary; i++) steps.push(shift(base, i));
      return steps;
    };
    out[kind] = { lit: ramp(lit), shade: ramp(shade) };
  }
  return out;
}

/**
 * The island as a jittered triangle mesh, painted on demand into whatever
 * surface asks for it.
 *
 * It used to be baked once into a canvas the size of the whole island — 3072
 * square, some 38 MB of pixels held for the session, with the pre-scaled ground
 * cache a second copy layered on top. Only the tiles under the viewport are
 * ever seen, and painting those costs less than resampling the whole island
 * did, so nothing is kept now but the vertex lattice.
 *
 * Jittering the shared vertex grid (rather than each triangle separately) keeps
 * the surface watertight, which is what makes it read as low-poly rather than
 * as noise.
 */
export class GroundMesh {
  private readonly verts: Float32Array;

  constructor(readonly seed: number) {
    this.verts = buildVertexGrid(seed);
  }

  /**
   * Paint every tile touching `rect`. The caller owns the transform, so this
   * draws in world coordinates.
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

    // Under the mesh, so any hairline left between facets reads as sea rather
    // than as a hole in the island.
    const x0 = Math.max(rect.x, 0);
    const y0 = Math.max(rect.y, 0);
    const x1 = Math.min(rect.x + rect.w, MAP_SIZE);
    const y1 = Math.min(rect.y + rect.h, MAP_SIZE);
    if (x1 > x0 && y1 > y0) {
      ctx.fillStyle = TERRAIN_COLORS.deep.shade;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    // One path per shade rather than one per triangle: a viewport holds a
    // couple of thousand facets but only a few dozen colours between them, and
    // it is the draw call, not the geometry, that costs.
    const byShade = new Map<string, Path2D>();
    const facet = (
      shade: string,
      p: [number, number],
      q: [number, number],
      r: [number, number],
    ): void => {
      let path = byShade.get(shade);
      if (path === undefined) byShade.set(shade, (path = new Path2D()));
      const cx = (p[0] + q[0] + r[0]) / 3;
      const cy = (p[1] + q[1] + r[1]) / 3;
      path.moveTo(cx + (p[0] - cx) * BLEED, cy + (p[1] - cy) * BLEED);
      path.lineTo(cx + (q[0] - cx) * BLEED, cy + (q[1] - cy) * BLEED);
      path.lineTo(cx + (r[0] - cx) * BLEED, cy + (r[1] - cy) * BLEED);
      path.closePath();
    };

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const kind = TERRAIN_ORDER[terrain[ty * MAP_TILES + tx]] ?? 'deep';
        const a = this.vertAt(tx, ty);
        const b = this.vertAt(tx + 1, ty);
        const c = this.vertAt(tx + 1, ty + 1);
        const d = this.vertAt(tx, ty + 1);

        // Two triangles per tile, each shaded independently for facet variation.
        facet(facetShade(kind, hash2(tx, ty, this.seed)), a, b, c);
        facet(facetShade(kind, hash2(tx, ty, this.seed + 991)), a, c, d);
      }
    }

    // Facets bleed over their neighbours, so which of two adjacent shades wins
    // the edge is down to draw order. Ordering by the shade itself keeps that
    // answer the same wherever the viewport happens to start, which is what
    // stops edges flickering as the cached ground scrolls.
    for (const shade of [...byShade.keys()].sort()) {
      ctx.fillStyle = shade;
      ctx.fill(byShade.get(shade)!);
    }

    drawShoreFoam(ctx, terrain, this.seed, tx0, ty0, tx1, ty1);
    drawOre(ctx, ore, oreLeft, tx0, ty0, tx1, ty1);
  }

  private vertAt(tx: number, ty: number): [number, number] {
    const i = (ty * (MAP_TILES + 1) + tx) * 2;
    return [this.verts[i], this.verts[i + 1]];
  }
}

/** Ore sits on the ground, over the mesh and under everything placed on it. */
function drawOre(
  ctx: CanvasRenderingContext2D,
  ore: Uint8Array,
  oreLeft: Uint16Array,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
): void {
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const kind = oreAt(ore, tx, ty);
      // A worked tile is drawn thinner, so a patch visibly wears away from its
      // rim inward and a player can see one running out before it stops.
      if (kind) drawOreTile(ctx, tx, ty, kind, oreBand(oreLeft[ty * MAP_TILES + tx]));
    }
  }
}

function buildVertexGrid(seed: number): Float32Array {
  const size = MAP_TILES + 1;
  const verts = new Float32Array(size * size * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 2;
      const edge = x === 0 || y === 0 || x === MAP_TILES || y === MAP_TILES;
      // Pin the border so the island has no ragged outer seam.
      const jitter = edge ? 0 : TILE * 0.3;
      verts[i] = x * TILE + (hash2(x, y, seed) - 0.5) * 2 * jitter;
      verts[i + 1] = y * TILE + (hash2(x, y, seed + 4231) - 0.5) * 2 * jitter;
    }
  }
  return verts;
}

/** Which face a triangle shows, and how far its shade drifts from that face. */
function facetShade(kind: Terrain, roll: number): string {
  const { vary } = TERRAIN_COLORS[kind];
  const ramp = roll > 0.5 ? FACET_SHADES[kind].lit : FACET_SHADES[kind].shade;
  return ramp[Math.round((roll - 0.5) * 2 * vary) + vary];
}

/** A soft pale rim wherever land meets water, drawn over the mesh. */
function drawShoreFoam(
  ctx: CanvasRenderingContext2D,
  terrain: Uint8Array,
  seed: number,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#f2e6c4';

  const wet = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return true;
    const kind = TERRAIN_ORDER[terrain[ty * MAP_TILES + tx]];
    return kind === 'water' || kind === 'deep';
  };

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (wet(tx, ty)) continue;
      if (!wet(tx + 1, ty) && !wet(tx - 1, ty) && !wet(tx, ty + 1) && !wet(tx, ty - 1)) continue;
      const r = TILE * (0.55 + hash2(tx, ty, seed + 77) * 0.35);
      ctx.beginPath();
      ctx.arc((tx + 0.5) * TILE, (ty + 0.5) * TILE, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
