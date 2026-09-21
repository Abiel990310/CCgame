import { MAP_SIZE, MAP_TILES, TILE } from '@shared/sim/constants';
import { hash2 } from '@shared/sim/rng';
import { TERRAIN_ORDER } from '@shared/sim/terrain';
import type { Terrain } from '@shared/sim/types';
import { TERRAIN_COLORS, shift } from './palette';

/**
 * The island is baked once into an offscreen canvas as a jittered triangle mesh.
 * Jittering the shared vertex grid (rather than each triangle separately) keeps
 * the surface watertight, which is what makes it read as low-poly rather than
 * as noise.
 */
export function bakeTerrain(terrain: Uint8Array, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const ctx = canvas.getContext('2d')!;

  const verts = buildVertexGrid(seed);
  const vertAt = (tx: number, ty: number): [number, number] => {
    const i = (ty * (MAP_TILES + 1) + tx) * 2;
    return [verts[i], verts[i + 1]];
  };

  ctx.fillStyle = TERRAIN_COLORS.deep.shade;
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const kind = TERRAIN_ORDER[terrain[ty * MAP_TILES + tx]] ?? 'deep';
      const a = vertAt(tx, ty);
      const b = vertAt(tx + 1, ty);
      const c = vertAt(tx + 1, ty + 1);
      const d = vertAt(tx, ty + 1);

      // Two triangles per tile, each shaded independently for facet variation.
      drawFacet(ctx, kind, [a, b, c], hash2(tx, ty, seed));
      drawFacet(ctx, kind, [a, c, d], hash2(tx, ty, seed + 991));
    }
  }

  drawShoreFoam(ctx, terrain, seed);
  return canvas;
}

function buildVertexGrid(seed: number): Float32Array {
  const size = MAP_TILES + 1;
  const verts = new Float32Array(size * size * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 2;
      const edge = x === 0 || y === 0 || x === MAP_TILES || y === MAP_TILES;
      // Pin the border so the baked island has no ragged outer seam.
      const jitter = edge ? 0 : TILE * 0.3;
      verts[i] = x * TILE + (hash2(x, y, seed) - 0.5) * 2 * jitter;
      verts[i + 1] = y * TILE + (hash2(x, y, seed + 4231) - 0.5) * 2 * jitter;
    }
  }
  return verts;
}

function drawFacet(
  ctx: CanvasRenderingContext2D,
  kind: Terrain,
  tri: Array<[number, number]>,
  roll: number,
): void {
  const shade = TERRAIN_COLORS[kind];
  const base = roll > 0.5 ? shade.lit : shade.shade;
  ctx.fillStyle = shift(base, Math.round((roll - 0.5) * 2 * shade.vary));

  ctx.beginPath();
  ctx.moveTo(tri[0][0], tri[0][1]);
  ctx.lineTo(tri[1][0], tri[1][1]);
  ctx.lineTo(tri[2][0], tri[2][1]);
  ctx.closePath();
  ctx.fill();
  // Hairline stroke in the fill colour closes sub-pixel gaps between facets.
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** A soft pale rim wherever land meets water, drawn over the baked mesh. */
function drawShoreFoam(ctx: CanvasRenderingContext2D, terrain: Uint8Array, seed: number): void {
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#f2e6c4';

  const wet = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= MAP_TILES || ty >= MAP_TILES) return true;
    const kind = TERRAIN_ORDER[terrain[ty * MAP_TILES + tx]];
    return kind === 'water' || kind === 'deep';
  };

  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
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
