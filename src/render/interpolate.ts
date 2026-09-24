import type { Vec2, World } from '@shared/sim/types';

/**
 * A move longer than this in one tick is a teleport (a respawn, a pickup
 * snapping into existence), not motion, so it is drawn where it landed rather
 * than swept across the map.
 */
const MAX_BLEND = 96;

interface Moving {
  id: number;
  pos: Vec2;
}

/**
 * Draws moving things between their last two tick positions.
 *
 * The sim ticks at 30 Hz but the screen refreshes at 60 or more, so drawing
 * `pos` straight shows every position for two or more frames and walking reads
 * as 10–15 fps however fast the machine is. Blending lags the view one tick
 * behind the sim in exchange for motion that changes every frame. It lives in
 * the client because `shared/` must never know what a frame is.
 */
export class Interpolator {
  private readonly prev = {
    players: new Map<number, Vec2>(),
    mobs: new Map<number, Vec2>(),
    projectiles: new Map<number, Vec2>(),
    pickups: new Map<number, Vec2>(),
  };
  private saved: Array<[Moving, Vec2]> = [];

  /** Call immediately before each `step`. */
  capture(world: World): void {
    record(this.prev.players, world.players.values());
    record(this.prev.mobs, world.mobs);
    record(this.prev.projectiles, world.projectiles);
    record(this.prev.pickups, world.pickups);
  }

  /**
   * Moves every entity to its blended position for drawing. `alpha` is how far
   * the accumulator is into the next tick. `restore` must follow before the
   * world is stepped again, or the sim would resume from a drawn position.
   */
  apply(world: World, alpha: number): void {
    this.saved.length = 0;
    this.blend(this.prev.players, world.players.values(), alpha);
    this.blend(this.prev.mobs, world.mobs, alpha);
    this.blend(this.prev.projectiles, world.projectiles, alpha);
    this.blend(this.prev.pickups, world.pickups, alpha);
  }

  restore(): void {
    for (const [entity, pos] of this.saved) entity.pos = pos;
    this.saved.length = 0;
  }

  private blend(prev: Map<number, Vec2>, entities: Iterable<Moving>, alpha: number): void {
    for (const entity of entities) {
      const from = prev.get(entity.id);
      if (!from) continue;
      const to = entity.pos;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if ((dx === 0 && dy === 0) || dx * dx + dy * dy > MAX_BLEND * MAX_BLEND) continue;
      this.saved.push([entity, to]);
      // A fresh object, so nothing that kept a reference to `pos` sees it move.
      entity.pos = { x: from.x + dx * alpha, y: from.y + dy * alpha };
    }
  }
}

function record(into: Map<number, Vec2>, entities: Iterable<Moving>): void {
  into.clear();
  for (const entity of entities) into.set(entity.id, { x: entity.pos.x, y: entity.pos.y });
}
