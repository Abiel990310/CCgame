import { MAP_TILES, TILE } from '@shared/sim/constants';
import type { World } from '@shared/sim/types';
import { GroundMesh } from './terrain';

/** Tiles along each edge of a cached piece of ground. */
const CHUNK_TILES = 4;
const CHUNK = CHUNK_TILES * TILE;
const CHUNKS = Math.ceil(MAP_TILES / CHUNK_TILES);

/** Chunks painted ahead of the view each frame, so walking rarely waits on one. */
const PREFETCH_PER_FRAME = 2;

/** World units of ground drawn past the view, enough to cover screen shake. */
const SHAKE_PAD = 16;

interface Chunk {
  canvas: HTMLCanvasElement;
  /** The device pixel this chunk's top-left corner lands on at the cached scale. */
  px: number;
  py: number;
}

export interface View {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The island's ground, pre-scaled to the zoom it is shown at and cut into
 * small fixed chunks.
 *
 * It replaces one big cache that scrolled with the camera. Scrolling meant
 * copying the whole cache onto itself and painting the strip that came in,
 * which on a 2x screen cost 35 to 95 ms a few times a second while walking.
 * A chunk is painted once, in a couple of milliseconds, and never moves; the
 * ones just past the edge of the view are painted a few a frame before they
 * are needed.
 *
 * Chunk edges sit on whole device pixels shared with their neighbours
 * (`floor(edge * scale)`), so chunks tile without seams and blit without
 * resampling.
 */
export class GroundCache {
  private mesh: GroundMesh | null = null;
  private terrain: Uint8Array | null = null;
  private scale = 0;
  private chunks = new Map<number, Chunk>();
  /** Chunks whose ore changed since they were painted. */
  private dirty = new Set<number>();

  /** Blit every chunk the view touches; `originX/Y` is the world origin in device pixels. */
  draw(ctx: CanvasRenderingContext2D, world: World, view: View, scale: number, originX: number, originY: number): void {
    if (this.mesh === null || this.mesh.seed !== world.seed) this.mesh = new GroundMesh(world.seed);
    // A different island under the same camera (the menu's backdrop, then the
    // game) must not keep the old island's ground.
    if (this.terrain !== world.terrain || this.scale !== scale) {
      this.terrain = world.terrain;
      this.scale = scale;
      this.chunks.clear();
      this.dirty.clear();
    }

    // Screen shake moves the picture a little past the camera's own bounds.
    const pad = SHAKE_PAD;
    const cx0 = Math.max(0, Math.floor((view.minX - pad) / CHUNK));
    const cy0 = Math.max(0, Math.floor((view.minY - pad) / CHUNK));
    const cx1 = Math.min(CHUNKS - 1, Math.floor((view.maxX + pad) / CHUNK));
    const cy1 = Math.min(CHUNKS - 1, Math.floor((view.maxY + pad) / CHUNK));

    for (const key of this.dirty) this.chunks.delete(key);
    this.dirty.clear();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.chunk(world, cx, cy);
        if (chunk) ctx.drawImage(chunk.canvas, originX + chunk.px, originY + chunk.py);
      }
    }
    ctx.restore();

    this.prefetch(world, cx0 - 1, cy0 - 1, cx1 + 1, cy1 + 1);
    this.evict(cx0 - 2, cy0 - 2, cx1 + 2, cy1 + 2);
  }

  /** Ore on this tile changed, so the chunks holding it and its spill are stale. */
  oreChanged(tx: number, ty: number): void {
    // Ore art reaches a tile past its own, so a neighbouring chunk may hold some.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = Math.floor((tx + dx) / CHUNK_TILES);
        const cy = Math.floor((ty + dy) / CHUNK_TILES);
        if (cx >= 0 && cy >= 0 && cx < CHUNKS && cy < CHUNKS) this.dirty.add(cy * CHUNKS + cx);
      }
    }
  }

  private chunk(world: World, cx: number, cy: number): Chunk | null {
    const key = cy * CHUNKS + cx;
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    const mesh = this.mesh;
    if (!mesh) return null;

    const scale = this.scale;
    const px = Math.floor(cx * CHUNK * scale);
    const py = Math.floor(cy * CHUNK * scale);
    const w = Math.floor((cx + 1) * CHUNK * scale) - px;
    const h = Math.floor((cy + 1) * CHUNK * scale) - py;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    ctx.fillStyle = '#12232e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -px, -py);
    mesh.paint(ctx, world.terrain, world.ore, world.oreLeft, {
      x: px / scale,
      y: py / scale,
      w: w / scale,
      h: h / scale,
    });
    chunk = { canvas, px, py };
    this.chunks.set(key, chunk);
    return chunk;
  }

  private prefetch(world: World, cx0: number, cy0: number, cx1: number, cy1: number): void {
    let budget = PREFETCH_PER_FRAME;
    for (let cy = Math.max(0, cy0); cy <= Math.min(CHUNKS - 1, cy1) && budget > 0; cy++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(CHUNKS - 1, cx1) && budget > 0; cx++) {
        if (this.chunks.has(cy * CHUNKS + cx)) continue;
        this.chunk(world, cx, cy);
        budget--;
      }
    }
  }

  private evict(cx0: number, cy0: number, cx1: number, cy1: number): void {
    for (const key of this.chunks.keys()) {
      const cx = key % CHUNKS;
      const cy = (key - cx) / CHUNKS;
      if (cx < cx0 || cx > cx1 || cy < cy0 || cy > cy1) this.chunks.delete(key);
    }
  }
}
