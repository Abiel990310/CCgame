import './story.css';

/** The painted scene is this many pixels across and scaled up whole, so it shares the game's pixel grid. */
const W = 160;
const H = 90;
/** The scenes animate at a flipbook rate, not the display's, which suits pixel art and costs little. */
const FRAME_MS = 1000 / 12;

type Paint = (g: CanvasRenderingContext2D, t: number, peaceful: boolean) => void;

interface Card {
  title: string;
  body: (peaceful: boolean) => string;
  paint: Paint;
}

/** A fixed pseudo-random value in [0, 1) for a pair of integers, so stars and grass never shimmer. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string): void {
  g.fillStyle = colour;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A filled circle built from whole-pixel rows, so a glow or a sun keeps the stepped edge. */
function disc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: string, below = Infinity): void {
  for (let dy = -r; dy <= r; dy++) {
    if (cy + dy >= below) break;
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    rect(g, cx - half, cy + dy, half * 2, 1, colour);
  }
}

/**
 * A sky in flat bands with a checkered row where two meet, the way a pixel
 * artist grades a sky without a smooth gradient.
 */
function sky(g: CanvasRenderingContext2D, bands: string[], bottom: number): void {
  const step = bottom / bands.length;
  bands.forEach((colour, i) => rect(g, 0, i * step, W, step + 1, colour));
  for (let i = 1; i < bands.length; i++) {
    const y = Math.round(i * step);
    g.fillStyle = bands[i - 1];
    for (let x = y & 1; x < W; x += 2) g.fillRect(x, y, 1, 1);
  }
}

function stars(g: CanvasRenderingContext2D, t: number, bottom: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(hash(i, 1) * W);
    const y = Math.floor(hash(i, 2) * bottom);
    // Each star twinkles on its own beat.
    const on = Math.sin(t * (1.2 + hash(i, 3) * 2) + i) > -0.6;
    if (on) rect(g, x, y, 1, 1, hash(i, 4) > 0.8 ? '#fff4d0' : '#c8d2ff');
  }
}

/** Sea from the horizon down, with glints that drift sideways. */
function sea(g: CanvasRenderingContext2D, t: number, top: number, deep: string, light: string, glint: string): void {
  rect(g, 0, top, W, H - top, deep);
  for (let y = top; y < H; y += 3) rect(g, 0, y, W, 1, light);
  for (let i = 0; i < 22; i++) {
    const y = top + 2 + Math.floor(hash(i, 7) * (H - top - 2));
    const x = Math.floor((hash(i, 8) * W + t * (4 + hash(i, 9) * 6)) % W);
    rect(g, x, y, 2 + Math.floor(hash(i, 10) * 3), 1, glint);
  }
}

/** An island's profile: a hump of land with its trees poking up. */
function island(g: CanvasRenderingContext2D, cx: number, base: number, half: number, rise: number, land: string, trees: string): void {
  for (let x = -half; x <= half; x++) {
    const h = Math.round(rise * Math.cos((x / half) * (Math.PI / 2)) ** 0.7);
    rect(g, cx + x, base - h, 1, h, land);
    if (h > 3 && hash(x + cx, 5) > 0.72) rect(g, cx + x - 1, base - h - 3, 3, 3, trees);
  }
}

/** Card one: the supply pod streaks down onto an island at dawn. */
const paintDrop: Paint = (g, t) => {
  sky(g, ['#1b1f3a', '#2d2a4e', '#553a5c', '#8a4f5a', '#c9795a', '#eaa865'], 58);
  stars(g, t, 26, 26);
  // The sun has barely cleared the sea.
  disc(g, 34, 58, 13, 'rgba(255, 217, 138, 0.25)', 58);
  disc(g, 34, 58, 9, '#ffd98a', 58);
  sea(g, t, 58, '#1c3450', '#244363', '#f2b77a');
  island(g, 112, 60, 34, 12, '#15202b', '#0f1820');

  // The pod falls along a line into the island and loops once it lands.
  const fall = 3.2;
  const p = Math.min(1, (t % (fall + 1.4)) / fall);
  const x0 = 28;
  const y0 = -6;
  const x1 = 118;
  const y1 = 47;
  const px = x0 + (x1 - x0) * p;
  const py = y0 + (y1 - y0) * p;
  if (p < 1) {
    for (let i = 1; i < 18; i++) {
      const q = Math.max(0, p - i * 0.012);
      const tx = x0 + (x1 - x0) * q;
      const ty = y0 + (y1 - y0) * q;
      rect(g, tx, ty, 2, 2, i < 4 ? '#fff1b0' : i < 9 ? '#ff9c4a' : i < 14 ? '#c04a3a' : '#5a3a4a');
    }
    rect(g, px - 1, py - 1, 4, 4, '#e8e4dc');
    rect(g, px, py, 2, 2, '#9aa3ad');
  } else {
    // A glow where it came down, fading as the loop comes round again.
    const after = (t % (fall + 1.4)) - fall;
    const r = Math.max(0, 6 - after * 4);
    rect(g, x1 - r, y1 - r / 2, r * 2 + 2, r + 2, '#ff9c4a');
    rect(g, x1, y1, 2, 2, '#fff1b0');
    for (let i = 0; i < 5; i++) rect(g, x1 - 2 + i * 1.5, y1 - 3 - after * (6 + i * 2), 1, 1, '#b8b0a8');
  }
};

/** Card two: ruins and a shrine at dusk, and eyes in the treeline unless the island is peaceful. */
const paintRuins: Paint = (g, t, peaceful) => {
  sky(g, ['#1a1830', '#2a2244', '#3d2e52', '#5a3c5a', '#7a4c58'], 54);
  stars(g, t, 30, 22);
  // The far treeline.
  for (let x = 0; x < W; x++) {
    const h = 8 + Math.round(hash(x >> 2, 11) * 7);
    rect(g, x, 54 - h, 1, h + 1, '#141a24');
  }
  rect(g, 0, 54, W, H - 54, '#1f3326');
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(hash(i, 12) * W);
    const y = 55 + Math.floor(hash(i, 13) * (H - 56));
    rect(g, x, y, 1, 2, hash(i, 14) > 0.5 ? '#2c4a30' : '#18291d');
  }

  // Broken columns, one of them fallen.
  const stone = '#6c6a78';
  const shade = '#4a4856';
  rect(g, 22, 34, 6, 28, stone);
  rect(g, 26, 34, 2, 28, shade);
  rect(g, 20, 32, 10, 3, stone);
  rect(g, 40, 46, 6, 16, stone);
  rect(g, 44, 46, 2, 16, shade);
  rect(g, 37, 64, 18, 5, stone);
  rect(g, 37, 67, 18, 2, shade);
  rect(g, 18, 62, 40, 2, '#35333f');

  // The shrine hums.
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
  rect(g, 98, 40, 22, 24, '#3c3a4a');
  rect(g, 94, 36, 30, 5, '#4d4a5c');
  rect(g, 104, 46, 10, 12, '#1a1426');
  rect(g, 107 - pulse * 2, 49 - pulse * 2, 4 + pulse * 4, 6 + pulse * 4, '#7a4cc8');
  rect(g, 108, 50, 2, 4, '#e0c8ff');
  for (let i = 0; i < 4; i++) {
    const rise = (t * 6 + i * 7) % 24;
    rect(g, 106 + ((i * 5) % 8), 44 - rise, 1, 1, rise < 18 ? '#c49cff' : '#6a4c9a');
  }

  // A rusted pod half-sunk in the grass.
  rect(g, 136, 62, 12, 7, '#7a5a44');
  rect(g, 138, 60, 8, 3, '#8e6a50');
  rect(g, 140, 64, 4, 2, '#3a2a22');

  if (!peaceful) {
    // Pairs of eyes blink in the treeline.
    for (let i = 0; i < 4; i++) {
      const x = 12 + Math.floor(hash(i, 20) * 136);
      const y = 42 + Math.floor(hash(i, 21) * 8);
      const open = Math.sin(t * 1.3 + i * 2.1) > -0.2;
      if (open) {
        rect(g, x, y, 1, 1, '#ff5a4a');
        rect(g, x + 3, y, 1, 1, '#ff5a4a');
      }
    }
  }
};

/** Card three: the factory at night and the Skyward Beacon firing its beam upward. */
const paintBeacon: Paint = (g, t) => {
  const ground = 72;
  sky(g, ['#090c1a', '#0e1428', '#141c36', '#1c2644'], ground);
  stars(g, t, ground - 6, 44);
  const beat = 0.5 + 0.5 * Math.sin(t * 3);
  disc(g, 80, 50, 12 + Math.round(beat * 3), 'rgba(240, 210, 122, 0.12)');
  disc(g, 80, 50, 7 + Math.round(beat * 2), 'rgba(240, 210, 122, 0.2)');
  // The beam, widest at its base, with a pulse climbing it.
  for (let y = 0; y < 50; y++) {
    const w = 1 + Math.floor((y / 50) * 3);
    rect(g, 80 - w, y, w * 2, 1, (y + Math.floor(t * 24)) % 12 < 2 ? '#fff6d8' : '#f0d27a');
  }

  rect(g, 0, ground, W, H - ground, '#12161c');

  // The beacon's tower.
  rect(g, 75, 54, 10, ground - 54, '#3a3f4c');
  rect(g, 83, 54, 2, ground - 54, '#2c303c');
  rect(g, 73, 52, 14, 4, '#50566a');
  rect(g, 77, 49, 6, 4, '#ffe9a8');
  rect(g, 78, 60, 4, 3, '#f0b94a');

  // Factory blocks either side, their windows lit, one chimney smoking.
  const blocks: [number, number, number][] = [
    [6, 58, 22],
    [32, 62, 18],
    [54, 56, 14],
    [96, 60, 20],
    [120, 54, 16],
    [140, 62, 18],
  ];
  blocks.forEach(([x, y, w], i) => {
    rect(g, x, y, w, ground - y, '#1c2230');
    rect(g, x, y, w, 1, '#2a3244');
    for (let wx = x + 2; wx < x + w - 2; wx += 4) {
      for (let wy = y + 3; wy < ground - 2; wy += 4) {
        if (hash(wx + i, wy) > 0.35) rect(g, wx, wy, 2, 2, hash(wx, wy + i) > 0.5 ? '#f0b94a' : '#c98a3a');
      }
    }
  });
  rect(g, 124, 42, 4, 12, '#1c2230');
  for (let i = 0; i < 6; i++) {
    const rise = (t * 5 + i * 5) % 30;
    const r = 1 + Math.floor(rise / 10);
    rect(g, 125 + Math.sin(t + i) * 2 + rise * 0.4, 40 - rise, r, r, rise < 20 ? '#4a4e5a' : '#2c303a');
  }

  // In front: belts carrying ore toward the blocks, and the beam's light on the ground.
  disc(g, 80, ground + 2, 16, 'rgba(240, 185, 74, 0.1)');
  for (const [y, speed, colour] of [
    [77, 10, '#9ab4d8'],
    [84, 14, '#d88a5a'],
  ] as [number, number, string][]) {
    rect(g, 0, y, W, 3, '#2a2620');
    rect(g, 0, y + 3, W, 1, '#0c0e12');
    for (let x = 0; x < W; x += 4) rect(g, x, y + 1, 1, 1, '#3a342a');
    for (let i = 0; i < 12; i++) rect(g, (t * speed + i * 14) % W, y, 2, 2, colour);
  }
  for (let x = 0; x < W; x++) if (hash(x, 30) > 0.7) rect(g, x, ground + 1, 1, 1, '#1c232c');
};

/** Ending card one: the beam reaches the stars, and a light up there answers and turns toward it. */
const paintAnswer: Paint = (g, t) => {
  sky(g, ['#05070f', '#090c1a', '#0e1428', '#141c36'], 78);
  stars(g, t, 76, 60);
  // The island far below, the beam climbing out of it.
  rect(g, 0, 78, W, H - 78, '#0e1a26');
  for (let y = 80; y < H; y += 3) rect(g, 0, y, W, 1, '#13253a');
  island(g, 80, 80, 30, 6, '#10151c', '#0c1016');
  for (let y = 0; y < 76; y++) {
    const w = y > 60 ? 2 : 1;
    rect(g, 80 - w, y, w * 2, 1, (y + Math.floor(t * 30)) % 14 < 2 ? '#fff6d8' : '#e8c46a');
  }
  disc(g, 80, 74, 5, 'rgba(240, 210, 122, 0.3)');

  // A light high up blinks twice, then drifts down toward the beam and grows.
  const cycle = 7;
  const c = t % cycle;
  const blink = c < 1.6 ? Math.floor(c / 0.4) % 2 === 0 : true;
  const fall = Math.max(0, (c - 1.6) / (cycle - 1.6));
  const sx = 124 - fall * 34;
  const sy = 10 + fall * 20;
  if (blink) {
    const r = Math.round(1 + fall * 4);
    rect(g, sx - r - 2, sy, r * 2 + 5, 1, '#3a5a7a');
    rect(g, sx, sy - r - 2, 1, r * 2 + 5, '#3a5a7a');
    rect(g, sx - r, sy, r * 2 + 1, 1, '#bfe8ff');
    rect(g, sx, sy - r, 1, r * 2 + 1, '#bfe8ff');
    rect(g, sx - 1, sy - 1, 3, 3, '#ffffff');
  }
};

/** Ending card two: dawn, the factory working, and the ship holding over the island in the beacon's light. */
const paintFound: Paint = (g, t) => {
  const ground = 70;
  sky(g, ['#2a2a50', '#4a3a60', '#7a4c62', '#b8685e', '#e8a060'], ground);
  stars(g, t, 18, 12);
  for (let y = 0; y < ground; y++) rect(g, 79, y, 2, 1, 'rgba(255, 238, 190, 0.5)');

  // The ship: a hull with running lights and a soft cone under it.
  const bob = Math.round(Math.sin(t * 1.4) * 1.5);
  const hx = 64;
  const hy = 16 + bob;
  for (let i = 0; i < 26; i++) {
    const spread = Math.round(i * 0.55);
    rect(g, hx + 16 - spread, hy + 8 + i, 1 + spread * 2, 1, `rgba(190, 230, 255, ${0.16 - i * 0.005})`);
  }
  rect(g, hx + 4, hy + 2, 24, 6, '#3c4658');
  rect(g, hx, hy + 5, 32, 3, '#4e5a70');
  rect(g, hx + 10, hy, 12, 3, '#5a667e');
  rect(g, hx + 13, hy + 1, 6, 1, '#bfe8ff');
  const on = Math.floor(t * 2) % 2 === 0;
  rect(g, hx - 1, hy + 6, 2, 1, on ? '#ff5a4a' : '#6a2a2a');
  rect(g, hx + 31, hy + 6, 2, 1, on ? '#7fd89a' : '#2a5a3a');

  rect(g, 0, ground, W, H - ground, '#243226');
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hash(i, 40) * W);
    const y = ground + 1 + Math.floor(hash(i, 41) * (H - ground - 2));
    rect(g, x, y, 1, 2, hash(i, 42) > 0.5 ? '#314a32' : '#1a2a1e');
  }
  // The beacon and the factory in morning light.
  rect(g, 76, 52, 8, ground - 52, '#4a4f5c');
  rect(g, 74, 50, 12, 3, '#626a7e');
  rect(g, 78, 47, 4, 3, '#ffe9a8');
  const blocks: [number, number, number][] = [
    [8, 58, 20],
    [30, 62, 16],
    [50, 56, 14],
    [100, 60, 18],
    [122, 56, 14],
    [140, 60, 16],
  ];
  blocks.forEach(([x, y, w]) => {
    rect(g, x, y, w, ground - y, '#3a3440');
    rect(g, x, y, w, 1, '#5a4e58');
    rect(g, x + w - 3, y, 3, ground - y, '#2e2a34');
  });
  for (let i = 0; i < 5; i++) {
    const rise = (t * 5 + i * 6) % 30;
    rect(g, 130 + rise * 0.3, 52 - rise, 2, 2, rise < 18 ? '#8a7a80' : '#6a5e68');
  }
  // Two birds wheel over the scene.
  for (let i = 0; i < 2; i++) {
    const bx = (t * (8 + i * 3) + i * 60) % (W + 20) - 10;
    const by = 36 + i * 8 + Math.round(Math.sin(t * 2 + i) * 2);
    const flap = Math.floor(t * 6 + i) % 2 === 0;
    rect(g, bx - 2, by - (flap ? 1 : 0), 2, 1, '#1c1c28');
    rect(g, bx, by, 1, 1, '#1c1c28');
    rect(g, bx + 1, by - (flap ? 1 : 0), 2, 1, '#1c1c28');
  }
};

/** Which run of cards to show: the arrival on a new island, or lighting the Skyward Beacon. */
export type StoryDeck = 'opening' | 'ending';

const OPENING: Card[] = [
  {
    title: 'The drop went wide',
    body: () =>
      'Your supply pod came down hard on an island no chart names. The radio is dead. What you have is what you can carry.',
    paint: paintDrop,
  },
  {
    title: 'Someone was here first',
    body: (peaceful) =>
      peaceful
        ? 'Ruins, humming shrines, older pods rusting in the grass. Whoever built them is long gone, and the nights here are quiet.'
        : 'Ruins, humming shrines, older pods rusting in the grass. Whoever built them is gone. At night, things come out of the trees to see who is new.',
    paint: paintRuins,
  },
  {
    title: 'Make the sky look down',
    body: () =>
      'Gather by hand, then build machines to do it for you. Grow the factory until it can raise a Skyward Beacon, and someone up there will finally see you.',
    paint: paintBeacon,
  },
];

const ENDING: Card[] = [
  {
    title: 'Something answered',
    body: () =>
      'The beam reached further than the radio ever did. High above the clouds, a light blinked twice and turned toward the island.',
    paint: paintAnswer,
  },
  {
    title: 'Found',
    body: () =>
      'They know where you are now. Keep the beacon fed with processors and it burns on, and every machine on the island works faster in its light. There is always more to build.',
    paint: paintFound,
  },
];

const DECKS: Record<StoryDeck, { cards: Card[]; last: string }> = {
  opening: { cards: OPENING, last: 'Begin' },
  ending: { cards: ENDING, last: 'Keep building' },
};

/**
 * The cards shown once before a new island's first day, saying why you are
 * here and what the long game is, and the pair that answers it once the
 * Skyward Beacon is lit. The world holds still behind them.
 */
export class StoryCards {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private dots: HTMLElement;
  private next: HTMLButtonElement;
  private index = 0;
  private deck: StoryDeck = 'opening';
  private peaceful = false;
  private started = 0;
  private lastPaint = 0;
  private done: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'story';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="story-card" role="dialog" aria-modal="true" aria-labelledby="story-title">
        <canvas class="story-art" width="${W}" height="${H}" aria-hidden="true"></canvas>
        <h2 id="story-title" class="story-title"></h2>
        <p class="story-body"></p>
        <div class="story-foot">
          <button type="button" class="ghost-btn story-skip">Skip</button>
          <div class="story-dots"></div>
          <button type="button" class="primary-btn story-next"></button>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.g = this.canvas.getContext('2d')!;
    this.titleEl = this.root.querySelector('.story-title')!;
    this.bodyEl = this.root.querySelector('.story-body')!;
    this.dots = this.root.querySelector('.story-dots')!;
    this.next = this.root.querySelector('.story-next')!;

    this.next.addEventListener('click', (e) => {
      e.stopPropagation();
      this.advance();
    });
    this.root.querySelector('.story-skip')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    // A tap on the picture turns the page as well, which is what a thumb tries first.
    this.canvas.addEventListener('click', () => this.advance());
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return this.done !== null;
  }

  private get cards(): Card[] {
    return DECKS[this.deck].cards;
  }

  /** Show a deck from its first card; resolves once the last is turned or they are skipped. */
  play(deck: StoryDeck, peaceful: boolean): Promise<void> {
    this.close();
    this.deck = deck;
    this.peaceful = peaceful;
    this.index = 0;
    this.dots.innerHTML = this.cards.map(() => '<i></i>').join('');
    this.root.hidden = false;
    this.show();
    this.started = performance.now();
    requestAnimationFrame((now) => this.animate(now));
    return new Promise((resolve) => {
      this.done = resolve;
    });
  }

  close(): void {
    const done = this.done;
    if (!done) return;
    this.done = null;
    this.root.hidden = true;
    done();
  }

  private advance(): void {
    if (!this.isOpen) return;
    if (this.index >= this.cards.length - 1) {
      this.close();
      return;
    }
    this.index++;
    this.show();
  }

  private show(): void {
    const card = this.cards[this.index];
    this.titleEl.textContent = card.title;
    this.bodyEl.textContent = card.body(this.peaceful);
    this.next.textContent = this.index === this.cards.length - 1 ? DECKS[this.deck].last : 'Next';
    this.dots.querySelectorAll('i').forEach((dot, i) => dot.classList.toggle('on', i === this.index));
    // Replaying the entrance on each page makes the turn read as a turn.
    const inner = this.root.querySelector<HTMLElement>('.story-card')!;
    inner.classList.remove('turn');
    void inner.offsetWidth;
    inner.classList.add('turn');
    this.paint(performance.now());
    this.next.focus({ preventScroll: true });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    // The game's own keys stay dead underneath: Esc here skips the story, it
    // does not also open the pause menu.
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'Escape') this.close();
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.advance();
    else if ((e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') && this.index > 0) {
      this.index--;
      this.show();
    }
  }

  private animate(now: number): void {
    if (!this.isOpen) return;
    requestAnimationFrame((t) => this.animate(t));
    if (now - this.lastPaint >= FRAME_MS) this.paint(now);
  }

  private paint(now: number): void {
    this.lastPaint = now;
    const t = Math.floor((now - this.started) / FRAME_MS) * (FRAME_MS / 1000);
    this.g.clearRect(0, 0, W, H);
    this.cards[this.index].paint(this.g, t, this.peaceful);
  }
}
