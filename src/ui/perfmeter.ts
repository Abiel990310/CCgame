/** What the meter reads besides its own timings. */
export interface PerfSource {
  readonly backend: 'pixi' | 'canvas';
  /** Sprites and shapes the GPU renderer drew last frame; 0 on Canvas. */
  readonly drawnObjects: number;
}

const STORAGE_KEY = 'ccgame.perf';
/** How much history the slow-frame figures cover. */
const WINDOW_MS = 2000;

/**
 * A small frame-time readout, off unless asked for (F3, or `?perf=1` in the
 * address, which sticks). An average fps hides the stutter players actually
 * feel, so it shows the slowest frames too, and splits each frame into the
 * simulation and the drawing so a report says which one to look at.
 */
export class PerfMeter {
  private el: HTMLElement | null = null;
  private frames: Array<{ at: number; gap: number; sim: number; draw: number }> = [];
  private shownAt = 0;

  constructor(private source: PerfSource) {
    const asked = new URLSearchParams(location.search).get('perf');
    if (asked !== null) store(asked === '0' ? '' : '1');
    if (read() === '1') this.show(true);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F3' || e.repeat) return;
      e.preventDefault();
      this.show(!this.el);
      store(this.el ? '1' : '');
    });
  }

  /** Called once a frame with how long its parts took, in milliseconds. */
  record(now: number, gap: number, sim: number, draw: number, counts: string): void {
    if (!this.el) return;
    this.frames.push({ at: now, gap, sim, draw });
    while (this.frames.length > 0 && now - this.frames[0].at > WINDOW_MS) this.frames.shift();
    // Rewriting the text every frame would itself cost a layout per frame.
    if (now - this.shownAt < 250) return;
    this.shownAt = now;

    const n = this.frames.length;
    const gaps = this.frames.map((f) => f.gap).sort((a, b) => a - b);
    const fps = n > 1 ? (n - 1) / ((now - this.frames[0].at) / 1000) : 0;
    const p95 = gaps[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0;
    const worst = gaps[n - 1] ?? 0;
    const avg = (pick: (f: { sim: number; draw: number }) => number): number =>
      this.frames.reduce((a, f) => a + pick(f), 0) / Math.max(n, 1);
    const pixi = this.source.backend === 'pixi';
    this.el.textContent = [
      `${pixi ? 'GPU' : 'Canvas'} · ${fps.toFixed(0)} fps`,
      `frame 95% ${p95.toFixed(1)} ms · worst ${worst.toFixed(0)} ms`,
      `sim ${avg((f) => f.sim).toFixed(2)} ms · draw ${avg((f) => f.draw).toFixed(2)} ms`,
      pixi ? `${counts} · ${this.source.drawnObjects} drawn` : counts,
    ].join('\n');
  }

  private show(on: boolean): void {
    if (on === !!this.el) return;
    if (!on) {
      this.el?.remove();
      this.el = null;
      this.frames = [];
      return;
    }
    const el = document.createElement('pre');
    el.className = 'perf-meter';
    document.body.appendChild(el);
    this.el = el;
  }
}

// Private windows and blocked storage throw; the meter just forgets.
function read(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function store(value: string): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to keep it in.
  }
}
