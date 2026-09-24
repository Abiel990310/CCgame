import { MAP_SIZE } from '@shared/sim/constants';
import { clamp, damp } from '@shared/sim/math';
import type { Vec2 } from '@shared/sim/types';

export class Camera {
  pos: Vec2 = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
  zoom = 1.6;
  width = 1;
  height = 1;

  follow(target: Vec2, dt: number): void {
    this.pos.x = damp(this.pos.x, target.x, 7, dt);
    this.pos.y = damp(this.pos.y, target.y, 7, dt);

    // Clamp so the view never drifts past the island into empty space.
    const halfW = this.width / 2 / this.zoom;
    const halfH = this.height / 2 / this.zoom;
    if (halfW * 2 < MAP_SIZE) this.pos.x = clamp(this.pos.x, halfW, MAP_SIZE - halfW);
    if (halfH * 2 < MAP_SIZE) this.pos.y = clamp(this.pos.y, halfH, MAP_SIZE - halfH);
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: (sx - this.width / 2) / this.zoom + this.pos.x,
      y: (sy - this.height / 2) / this.zoom + this.pos.y,
    };
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    return {
      x: (wx - this.pos.x) * this.zoom + this.width / 2,
      y: (wy - this.pos.y) * this.zoom + this.height / 2,
    };
  }

  /** Visible world rect, padded, for culling. */
  bounds(pad = 80): { minX: number; minY: number; maxX: number; maxY: number } {
    const halfW = this.width / 2 / this.zoom + pad;
    const halfH = this.height / 2 / this.zoom + pad;
    return {
      minX: this.pos.x - halfW,
      minY: this.pos.y - halfH,
      maxX: this.pos.x + halfW,
      maxY: this.pos.y + halfH,
    };
  }
}
