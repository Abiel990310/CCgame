import { ITEMS } from '@shared/data/items';
import { MOBS } from '@shared/data/mobs';
import type { ItemId, SimEvent, Vec2 } from '@shared/sim/types';
import { drawItemSprite } from './items';
import { INK } from './paint';

interface Particle {
  pos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface FloatingText {
  pos: Vec2;
  text: string;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  /** Sideways drift, so a burst of hits fans out instead of stacking. */
  drift: number;
  /** Loot lines carry the item, drawn beside the count, and merge by it. */
  item?: ItemId;
  count?: number;
}

/** The HUD's rounded face, so numbers in the world and on the panels match. */
const FONT = "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif";

/**
 * Purely cosmetic layer driven by simulation events. Nothing here feeds back
 * into the sim, so it is safe to skip entirely on a headless server.
 */
export class Effects {
  private particles: Particle[] = [];
  private texts: FloatingText[] = [];
  /** Screen-space shake, decayed every frame. */
  shake = 0;

  consume(events: SimEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'hit':
          this.burst(event.pos, 4, '#ffe8b0', 90);
          // Big hits read bigger and hotter, so a good upgrade is felt.
          this.text(event.pos, `${event.amount}`, event.amount >= 20 ? '#ffb347' : '#fff4d6', event.amount >= 20 ? 16 : 13);
          break;
        case 'collected':
          if (event.item) this.loot(event.pos, event.item, event.count);
          break;
        case 'mobDied':
          this.burst(event.pos, 14, MOBS[event.type].color, 170);
          this.shake = Math.min(6, this.shake + 1.5);
          break;
        case 'gathered':
          this.burst(event.pos, 6, '#f0e2c0', 110);
          break;
        case 'playerHit':
          this.shake = Math.min(10, this.shake + 4);
          break;
        case 'built':
          this.burst(event.pos, 10, '#e8d8b0', 130);
          break;
        case 'crafted':
          this.burst(event.pos, 12, '#f0b94a', 120);
          break;
        default:
          break;
      }
    }
  }

  burst(pos: Vec2, count: number, color: string, speed: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const mag = speed * (0.35 + Math.random() * 0.65);
      const life = 0.3 + Math.random() * 0.45;
      this.particles.push({
        pos: { ...pos },
        vel: { x: Math.cos(angle) * mag, y: Math.sin(angle) * mag },
        life,
        maxLife: life,
        size: 1.6 + Math.random() * 2.6,
        color,
      });
    }
  }

  text(pos: Vec2, text: string, color: string, size: number): void {
    if (!text) return;
    this.texts.push({
      pos: { x: pos.x + (Math.random() - 0.5) * 12, y: pos.y - 14 },
      text,
      life: 0.8,
      maxLife: 0.8,
      color,
      size,
      drift: (Math.random() - 0.5) * 30,
    });
  }

  /**
   * "+3 wood" over the player. Pickups arrive in quick runs, so a line still
   * rising for the same item counts up rather than a second one stacking on it.
   */
  loot(pos: Vec2, item: ItemId, count: number): void {
    const open = this.texts.find((t) => t.item === item && t.maxLife - t.life < 0.7);
    if (open) {
      open.count = (open.count ?? 0) + count;
      open.text = `+${open.count}`;
      open.life = open.maxLife - 0.12;
      return;
    }
    this.texts.push({
      pos: { x: pos.x, y: pos.y - 34 },
      text: `+${count}`,
      life: 1.3,
      maxLife: 1.3,
      color: '#fff4d6',
      size: 11,
      drift: 0,
      item,
      count,
    });
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 18);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.vel.x *= 1 - 3.5 * dt;
      p.vel.y *= 1 - 3.5 * dt;
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) this.texts.splice(i, 1);
      else {
        // Quick rise that eases off, so a number pops out and then hangs.
        const age = t.maxLife - t.life;
        t.pos.y -= (t.item ? 16 : 60 * Math.max(0.15, 1 - age * 2.2)) * dt;
        t.pos.x += t.drift * dt;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const age = t.maxLife - t.life;
      // Pops in oversized and settles, the way a hit lands in an action game.
      const pop = 1 + Math.max(0, 0.45 - age * 3.2);
      ctx.globalAlpha = Math.min(1, t.life * 3);
      ctx.font = `900 ${Math.round(t.size * pop)}px ${FONT}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;

      if (t.item) {
        const name = ITEMS[t.item].name;
        const label = `${t.text} ${name}`;
        const w = ctx.measureText(label).width;
        const ix = t.pos.x - w / 2 - 7;
        drawItemSprite(ctx, ix, t.pos.y, 5.5, t.item);
        ctx.textAlign = 'left';
        ctx.strokeText(label, ix + 8, t.pos.y);
        ctx.fillStyle = t.color;
        ctx.fillText(label, ix + 8, t.pos.y);
        ctx.textAlign = 'center';
        continue;
      }
      ctx.strokeText(t.text, t.pos.x, t.pos.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.pos.x, t.pos.y);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }
}
