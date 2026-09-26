import { ITEMS } from '@shared/data/items';
import { MOBS } from '@shared/data/mobs';
import type { ItemId, MobTypeId, SimEvent, SpellId, Vec2 } from '@shared/sim/types';
import { drawItemSprite } from './items';
import { INK } from './paint';
import { drawPixelText, pixelFontCovers, pixelTextWidth } from './pixelfont';
import { DEATH_TIME, pixelSprites } from './pixelmobs';

interface Particle {
  pos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** Pulls the particle down the screen: chips arc and fall rather than drift. */
  gravity?: number;
  /** Swells as it fades, the way a puff of dust spreads out. */
  grow?: number;
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
  /** Expanding shock rings, one per burst. */
  private rings: Array<{ pos: Vec2; radius: number; life: number; maxLife: number; color: string }> = [];
  /** Columns of light rising off a player: a heal, seen from across the screen. */
  private pillars: Array<{ pos: Vec2; life: number; maxLife: number; color: string }> = [];
  /** Melee swings: a bright crescent that sweeps across the arc and fades. */
  private slashes: Array<{ pos: Vec2; angle: number; life: number; maxLife: number; heavy: boolean; flip: boolean; counter?: boolean }> = [];
  /**
   * Creatures dying where they fell. They stand in the world, so the renderer
   * sorts them in with everything else rather than drawing them on top.
   */
  readonly bodies: Array<{ pos: Vec2; type: MobTypeId; age: number; flip: boolean }> = [];
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
          if (pixelSprites() && event.type !== 'wisp') {
            // Which way it falls only has to look arbitrary, not be remembered.
            const flip = (Math.floor(event.pos.x) + Math.floor(event.pos.y)) % 2 === 0;
            this.bodies.push({ pos: { ...event.pos }, type: event.type, age: 0, flip });
          }
          this.shake = Math.min(6, this.shake + 1.5);
          break;
        case 'blast':
          this.rings.push({ pos: { ...event.pos }, radius: event.radius, life: 0.35, maxLife: 0.35, color: '#ffb35a' });
          this.burst(event.pos, 16, '#ff9a4a', event.radius * 3.2);
          this.shake = Math.min(7, this.shake + 1.2);
          break;
        case 'spit':
          this.burst(event.pos, 4, '#c8e070', 60);
          break;
        case 'guardsWoke':
          this.rings.push({ pos: { ...event.pos }, radius: 200, life: 0.9, maxLife: 0.9, color: '#ff7a5a' });
          this.shake = Math.min(8, this.shake + 3);
          break;
        case 'summon':
          this.rings.push({ pos: { ...event.pos }, radius: 70, life: 0.5, maxLife: 0.5, color: '#c9a0ff' });
          this.burst(event.pos, 10, '#b48cf0', 120);
          break;
        case 'landmark':
          this.rings.push({ pos: { ...event.pos }, radius: 90, life: 0.8, maxLife: 0.8, color: '#ffe0a0' });
          this.burst(event.pos, 22, '#ffe7a0', 170);
          break;
        case 'beacon':
          this.rings.push({ pos: { ...event.pos }, radius: event.lit ? 320 : 120, life: 1.1, maxLife: 1.1, color: '#ffd46a' });
          this.burst(event.pos, event.lit ? 60 : 24, '#ffe7a0', event.lit ? 320 : 180);
          this.shake = Math.min(10, this.shake + (event.lit ? 7 : 3));
          break;
        case 'boss':
          this.rings.push({ pos: { ...event.pos }, radius: 140, life: 0.9, maxLife: 0.9, color: '#e0a040' });
          this.shake = Math.min(12, this.shake + 8);
          break;
        case 'bossRage':
          // A roar: two red shock rings, embers thrown off, and the word over it.
          this.rings.push({ pos: { ...event.pos }, radius: 170, life: 0.7, maxLife: 0.7, color: '#ff5a3a' });
          this.rings.push({ pos: { ...event.pos }, radius: 90, life: 0.45, maxLife: 0.45, color: '#ffd0a0' });
          this.burst(event.pos, 30, '#ff7a3a', 260);
          this.text({ x: event.pos.x, y: event.pos.y - MOBS[event.type].radius * 2.4 }, 'Enraged!', '#ff8a5a', 18);
          this.shake = Math.min(14, this.shake + 10);
          break;
        case 'gathered':
          this.burst(event.pos, 6, '#f0e2c0', 110);
          break;
        case 'playerHit':
          this.shake = Math.min(10, this.shake + 4);
          break;
        case 'slam':
          this.rings.push({ pos: { ...event.pos }, radius: event.radius + 14, life: 0.4, maxLife: 0.4, color: '#ffc85a' });
          this.rings.push({ pos: { ...event.pos }, radius: event.radius * 0.6, life: 0.28, maxLife: 0.28, color: '#fff1d0' });
          this.dust(event.pos, 14, 2.4);
          this.shake = Math.min(12, this.shake + (event.hits > 0 ? 6 : 3));
          break;
        case 'parry':
          this.rings.push({ pos: { ...event.pos }, radius: 26, life: 0.22, maxLife: 0.22, color: '#ffffff' });
          this.burst(event.pos, 12, '#fff4c8', 260);
          this.shake = Math.min(10, this.shake + 4);
          break;
        case 'dodge':
          this.rings.push({ pos: { ...event.pos }, radius: 22, life: 0.25, maxLife: 0.25, color: '#bfe8ff' });
          this.text(event.pos, 'Dodge', '#bfe8ff', 13);
          break;
        case 'cast':
          this.cast(event.spell, event.pos, event.dir, event.radius);
          if (event.hits > 0) this.shake = Math.min(9, this.shake + 3);
          break;
        case 'strike': {
          const heavy = event.combo === 2;
          const life = heavy ? 0.26 : 0.2;
          // Alternate hits sweep opposite ways, like a forehand and a backhand.
          this.slashes.push({ pos: { ...event.pos }, angle: Math.atan2(event.dir.y, event.dir.x), life, maxLife: life, heavy, flip: event.combo === 1, counter: event.counter });
          if (event.counter) {
            // The answer to a dodge: a wider gold arc, sparks thrown along it, and its name.
            const at = { x: event.pos.x + event.dir.x * 30, y: event.pos.y - 10 + event.dir.y * 22 };
            this.spray(at, event.dir, 16, ['#ffe7a0', '#ffd46a', '#ffffff'], 260);
            this.rings.push({ pos: at, radius: 30, life: 0.25, maxLife: 0.25, color: '#ffd46a' });
            this.text({ x: event.pos.x - event.dir.x * 10, y: event.pos.y - 22 }, 'Counter', '#ffd46a', 14);
            this.shake = Math.min(10, this.shake + 3);
          }
          if (event.hits > 0) this.shake = Math.min(8, this.shake + (heavy ? 3 : 1.2));
          break;
        }
        case 'levelUp':
          // Placed by the game, which knows where that player is standing.
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

  /**
   * A tool biting into a node: chips thrown up and out on the striker's side,
   * arcing down under gravity. Wood splinters and a leaf or two off a tree,
   * grit and a spark off stone, leaves off a bush.
   */
  chips(pos: Vec2, kind: string, fromX: number): void {
    const side = Math.sign(fromX - pos.x) || 1;
    const at = { x: pos.x + side * 7, y: pos.y - (kind === 'tree' ? 12 : 6) };
    const palette =
      kind === 'tree'
        ? ['#d7a867', '#b07a42', '#8a5a2e', '#e8c98f']
        : kind === 'rock'
          ? ['#b9b6ad', '#8d8a82', '#d6d2c7', '#ffe6a0']
          : ['#6fa14a', '#8cc05a', '#4f7f36'];
    const count = kind === 'bush' ? 4 : 6;
    for (let i = 0; i < count; i++) {
      const life = 0.35 + Math.random() * 0.3;
      this.particles.push({
        pos: { ...at },
        vel: { x: side * (40 + Math.random() * 90), y: -(70 + Math.random() * 110) },
        life,
        maxLife: life,
        size: 1.2 + Math.random() * 1.6,
        color: palette[i % palette.length],
        gravity: 520,
      });
    }
    if (kind === 'tree') {
      // A leaf shaken loose from the crown, falling slowly.
      const life = 0.9 + Math.random() * 0.4;
      this.particles.push({
        pos: { x: pos.x + (Math.random() - 0.5) * 30, y: pos.y - 48 - Math.random() * 20 },
        vel: { x: (Math.random() - 0.5) * 30, y: 10 },
        life,
        maxLife: life,
        size: 2,
        color: '#7fae4e',
        gravity: 30,
      });
    }
  }

  /** A soft puff of dust at someone's feet: a step, a dash, a landing. */
  dust(pos: Vec2, count = 3, spread = 1): void {
    for (let i = 0; i < count; i++) {
      const life = 0.35 + Math.random() * 0.25;
      this.particles.push({
        pos: { x: pos.x + (Math.random() - 0.5) * 8 * spread, y: pos.y + (Math.random() - 0.5) * 3 },
        vel: { x: (Math.random() - 0.5) * 40 * spread, y: -8 - Math.random() * 12 },
        life,
        maxLife: life,
        size: 1.6 + Math.random() * 1.2,
        color: 'rgba(222, 205, 170, 0.55)',
        grow: 6,
      });
    }
  }

  /** A gold column and ring round whoever just levelled up. */
  levelUp(pos: Vec2): void {
    this.rings.push({ pos: { ...pos }, radius: 70, life: 0.7, maxLife: 0.7, color: '#ffd46a' });
    this.rings.push({ pos: { ...pos }, radius: 40, life: 0.5, maxLife: 0.5, color: '#fff2c0' });
    for (let i = 0; i < 26; i++) {
      const life = 0.6 + Math.random() * 0.5;
      this.particles.push({
        pos: { x: pos.x + (Math.random() - 0.5) * 22, y: pos.y + 4 },
        vel: { x: (Math.random() - 0.5) * 30, y: -(60 + Math.random() * 120) },
        life,
        maxLife: life,
        size: 1.4 + Math.random() * 1.8,
        color: i % 3 === 0 ? '#fff2c0' : '#ffd46a',
        gravity: -40,
      });
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

  /** The look of each spell going off; a fireball's burst is the sim's own `blast`. */
  private cast(spell: SpellId, pos: Vec2, dir: Vec2, radius: number): void {
    const chest = { x: pos.x, y: pos.y - 12 };
    switch (spell) {
      case 'fireball': {
        const at = { x: chest.x + dir.x * 14, y: chest.y + dir.y * 14 };
        this.rings.push({ pos: at, radius: 16, life: 0.18, maxLife: 0.18, color: '#ffc070' });
        this.spray(at, dir, 10, ['#ffd36a', '#ff8a3d', '#ff5a2a'], 160);
        break;
      }
      case 'frostNova':
        this.rings.push({ pos: { ...pos }, radius, life: 0.42, maxLife: 0.42, color: '#bfefff' });
        this.rings.push({ pos: { ...pos }, radius: radius * 0.7, life: 0.32, maxLife: 0.32, color: '#ffffff' });
        // Shards flung out to the edge of the ring, so its reach is seen.
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
          const life = 0.35 + Math.random() * 0.2;
          const mag = (radius / life) * (0.8 + Math.random() * 0.3);
          this.particles.push({
            pos: { ...pos },
            vel: { x: Math.cos(a) * mag, y: Math.sin(a) * mag * 0.75 },
            life,
            maxLife: life,
            size: 1.8 + Math.random() * 1.8,
            color: i % 3 === 0 ? '#ffffff' : '#9fe3ff',
          });
        }
        break;
      case 'mend':
        this.rings.push({ pos: { ...pos }, radius: 34, life: 0.55, maxLife: 0.55, color: '#8ef0a8' });
        this.pillars.push({ pos: { ...pos }, life: 0.75, maxLife: 0.75, color: '142, 240, 168' });
        // Motes rising around the body, like the regen of a potion.
        for (let i = 0; i < 24; i++) {
          const life = 0.6 + Math.random() * 0.5;
          this.particles.push({
            pos: { x: pos.x + (Math.random() - 0.5) * 26, y: pos.y - Math.random() * 20 },
            vel: { x: (Math.random() - 0.5) * 12, y: -40 - Math.random() * 40 },
            life,
            maxLife: life,
            size: 2 + Math.random() * 2,
            color: i % 3 === 0 ? '#ffffff' : i % 2 === 0 ? '#c8ffd4' : '#8ef0a8',
          });
        }
        this.text(pos, 'Mend', '#8ef0a8', 14);
        break;
    }
  }

  /** Sparks thrown mostly one way, fanning around `dir`. */
  private spray(pos: Vec2, dir: Vec2, count: number, colors: string[], speed: number): void {
    const base = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * 1.3;
      const mag = speed * (0.4 + Math.random() * 0.6);
      const life = 0.2 + Math.random() * 0.25;
      this.particles.push({
        pos: { ...pos },
        vel: { x: Math.cos(a) * mag, y: Math.sin(a) * mag },
        life,
        maxLife: life,
        size: 1.4 + Math.random() * 2,
        color: colors[i % colors.length],
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
      // Thrown things keep their momentum; puffs and sparks slow in the air.
      const drag = p.gravity ? 1.2 : 3.5;
      p.vel.x *= 1 - drag * dt;
      p.vel.y *= 1 - drag * dt;
      if (p.gravity) p.vel.y += p.gravity * dt;
      if (p.grow) p.size += p.grow * dt;
    }

    for (let i = this.bodies.length - 1; i >= 0; i--) {
      this.bodies[i].age += dt;
      if (this.bodies[i].age >= DEATH_TIME) this.bodies.splice(i, 1);
    }

    for (let i = this.slashes.length - 1; i >= 0; i--) {
      this.slashes[i].life -= dt;
      if (this.slashes[i].life <= 0) this.slashes.splice(i, 1);
    }

    for (let i = this.pillars.length - 1; i >= 0; i--) {
      this.pillars[i].life -= dt;
      if (this.pillars[i].life <= 0) this.pillars.splice(i, 1);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
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

  /**
   * The swing's crescent: its leading edge races across the arc in the first
   * third of its life, the tail following, so it reads as a blade's path
   * rather than a shape that appears. Squashed to lie on the 3/4 ground.
   */
  private drawSlash(
    ctx: CanvasRenderingContext2D,
    s: { pos: Vec2; angle: number; life: number; maxLife: number; heavy: boolean; flip: boolean; counter?: boolean },
  ): void {
    const f = 1 - s.life / s.maxLife;
    const half = 1.15;
    const head = Math.min(1, f * 3);
    const tail = Math.max(0, (f - 0.25) / 0.75);
    if (head <= tail) return;
    const dir = s.flip ? -1 : 1;
    const a0 = s.angle - half * dir + 2 * half * dir * tail;
    const a1 = s.angle - half * dir + 2 * half * dir * head;
    const reach = s.counter ? 54 : s.heavy ? 46 : 40;
    const width = s.counter ? 15 : s.heavy ? 12 : 8;
    ctx.save();
    ctx.translate(s.pos.x, s.pos.y - 10);
    ctx.scale(1, 0.72);
    ctx.globalAlpha = Math.min(1, (1 - f) * 1.6);
    ctx.fillStyle = s.counter ? '#ffb02a' : s.heavy ? '#ffc85a' : '#fff1d0';
    ctx.beginPath();
    ctx.arc(0, 0, reach, a0, a1, s.flip);
    ctx.arc(0, 0, reach - width, a1, a0, !s.flip);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, reach - 1, a0 + (a1 - a0) * 0.45, a1, s.flip);
    ctx.arc(0, 0, reach - width * 0.45, a1, a0 + (a1 - a0) * 0.45, !s.flip);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      // Snaps out fast and thins as it goes, flattened to lie on the ground.
      const f = 1 - r.life / r.maxLife;
      const reach = r.radius * (0.35 + 0.65 * Math.sqrt(Math.max(0, f)));
      ctx.globalAlpha = Math.max(0, 1 - f) * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2 + (1 - f) * 5;
      ctx.beginPath();
      ctx.ellipse(r.pos.x, r.pos.y, reach, reach * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of this.slashes) this.drawSlash(ctx, s);

    for (const p of this.pillars) {
      // Rises out of the ground and fades from the bottom up.
      const f = 1 - p.life / p.maxLife;
      const h = 34 + 46 * Math.sqrt(f);
      const w = 18 * (1 - f * 0.4);
      const g = ctx.createLinearGradient(0, p.pos.y + 4, 0, p.pos.y - h);
      g.addColorStop(0, `rgba(${p.color}, ${0.9 * (1 - f)})`);
      g.addColorStop(0.5, `rgba(${p.color}, ${0.45 * (1 - f)})`);
      g.addColorStop(1, `rgba(${p.color}, 0)`);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.pos.x, p.pos.y - h / 2 + 4, w, h / 2 + 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

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

      const pixel = pixelSprites();
      if (t.item) {
        const name = ITEMS[t.item].name;
        const label = `${t.text} ${name}`;
        if (pixel && pixelFontCovers(label)) {
          const texel = Math.max(1, Math.round(t.size * 0.16));
          const w = pixelTextWidth(label) * texel;
          const ix = t.pos.x - w / 2 - 7;
          drawItemSprite(ctx, ix, t.pos.y, 5.5, t.item);
          drawPixelText(ctx, label, ix + 8 + w / 2, t.pos.y, texel, t.color);
          continue;
        }
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
      if (pixel && pixelFontCovers(t.text)) {
        // Whole font pixels only, so the pop steps up a size rather than blurring.
        drawPixelText(ctx, t.text, t.pos.x, t.pos.y, Math.max(1, Math.round(t.size * pop * 0.16)), t.color);
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
