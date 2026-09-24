import { MOBS } from '@shared/data/mobs';
import type { SimEvent, Vec2 } from '@shared/sim/types';
import { UI, rgba } from './palette';

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
  color: string;
  size: number;
}

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
          this.text(event.pos, `${event.amount}`, UI.ink, 12);
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
      pos: { x: pos.x + (Math.random() - 0.5) * 12, y: pos.y - 8 },
      text,
      life: 0.8,
      color,
      size,
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
      else t.pos.y -= 26 * dt;
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
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 1.6);
      ctx.font = `700 ${t.size}px system-ui, sans-serif`;
      ctx.fillStyle = rgba('#10141a', 0.5);
      ctx.fillText(t.text, t.pos.x, t.pos.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.pos.x, t.pos.y);
    }
    ctx.globalAlpha = 1;
  }
}
