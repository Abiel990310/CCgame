import type { Player } from '@shared/sim/types';
import { SELF } from '../render/characters';
import { drawPixelPlayer } from '../render/pixelplayer';

/** The medallion shows this many sprite pixels across: the head and shoulders. */
const SPAN = 22;
/** Where the sprite's feet sit below the medallion's top, which frames the bust. */
const FEET = 35;

/**
 * The player's face in the vitals medallion, drawn from the same pixel
 * sprite as the character in the world, so it blinks, flinches when hit and
 * greys out when downed. Repainted only when what it shows changes.
 */
export class Portrait {
  private g: CanvasRenderingContext2D;
  private last = '';
  /**
   * The medallion's width, told by the browser when it changes. Asking for it
   * every frame, after the HUD has changed the page, made the browser lay out
   * the whole interface again each frame to answer.
   */
  private width = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    new ResizeObserver((entries) => {
      for (const entry of entries) this.width = entry.contentRect.width;
    }).observe(canvas);
  }

  update(player: Player, now: number): void {
    const size = Math.max(1, Math.round(this.width * (window.devicePixelRatio || 1)));
    const k = Math.max(1, Math.ceil(size / SPAN));
    const blink = ((now / 1000) * 0.35 + 0.1) % 1 < 0.035;
    const flash = player.hitFlash > 0.1;
    const recoil = player.hitFlash > 0 && player.hitFlash <= 0.1;
    const idle = Math.floor((now / 1000) * 1.6) % 2;
    const key = `${k}|${blink ? 1 : 0}|${flash ? 1 : 0}|${recoil ? 1 : 0}|${idle}`;
    const root = this.canvas.parentElement;
    root?.classList.toggle('downed', player.downed > 0);
    root?.classList.toggle('low', player.downed <= 0 && player.hp / player.maxHp < 0.3);
    if (key === this.last) return;
    this.last = key;
    if (this.canvas.width !== SPAN * k) {
      this.canvas.width = SPAN * k;
      this.canvas.height = SPAN * k;
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.imageSmoothingEnabled = false;
    g.setTransform(k, 0, 0, k, 0, 0);
    drawPixelPlayer(
      g,
      SPAN / 2,
      FEET,
      SELF,
      { view: 'down', flip: false, walk: -1, idle, swing: -1, tool: null, dash: false, flash, recoil, blink },
      () => 0,
    );
  }
}
