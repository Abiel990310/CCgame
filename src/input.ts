import type { PlayerInput, Vec2 } from '@shared/sim/types';

const MOVE_KEYS: Record<string, Vec2> = {
  KeyW: { x: 0, y: -1 },
  ArrowUp: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/** How long a still finger rests on a piece in build mode before removing it. */
const HOLD_TO_REMOVE_MS = 550;
/** How far a finger can wander and still count as holding still. */
const HOLD_SLOP_PX = 12;

/** The quick slots, 1-indexed exactly as they are labelled on screen. */
export type HotbarKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ActionKey =
  | 'build'
  | 'inventory'
  | 'cancel'
  | 'rotate'
  | 'remove'
  | 'mute'
  | 'copy'
  | 'paste'
  | 'craft'
  | 'upgrade'
  | 'map'
  | 'ledger'
  | `hotbar${HotbarKey}`
  | `bind${HotbarKey}`;

/** Which quick slot a key code names, or 0 for anything else. */
function hotbarDigit(code: string): number {
  if (!code.startsWith('Digit')) return 0;
  const digit = Number(code.slice(5));
  return digit >= 1 && digit <= 8 ? digit : 0;
}

/**
 * Collects keyboard, pointer and touch into one frame-stable input snapshot.
 * The sim only ever sees `PlayerInput`, which keeps a future server honest.
 */
export class InputManager {
  private keys = new Set<string>();
  private stick: { active: boolean; origin: Vec2; pos: Vec2; id: number } = {
    active: false,
    origin: { x: 0, y: 0 },
    pos: { x: 0, y: 0 },
    id: -1,
  };
  private touchDash = false;
  private touchInteract = false;
  /** Edge-triggered actions, drained once per frame. */
  private pending: ActionKey[] = [];

  pointer: Vec2 = { x: 0, y: 0 };
  pointerDown = false;
  /**
   * A mouse resting over the world rather than over a panel. Hover cards need
   * it: a touch has no hover, and a pointer that has moved onto the HUD should
   * not keep describing whatever was last under it.
   */
  hovering = false;
  clicked = false;
  /**
   * Set by the game each frame. In build mode a finger is a cursor: a tap
   * places, a drag lays a line, and holding still removes what is under it.
   */
  buildMode = false;
  private touched = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  /** The finger acting as the build cursor, and when it could become a hold. */
  private buildTouch: { id: number; origin: Vec2; timer: number } | null = null;

  constructor(private target: HTMLElement) {
    this.bind();
  }

  private bind(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Typing a save name is not a move order.
      if (e.target instanceof HTMLInputElement) return;
      // Let the browser keep its own shortcuts; only claim game keys.
      const claimed = ['Space', 'KeyE', 'KeyB', 'KeyR', 'KeyX', 'KeyM', 'KeyL', 'KeyU', 'Tab', 'Escape'];
      if (e.code in MOVE_KEYS || claimed.includes(e.code)) e.preventDefault();

      // A number picks a quick slot; with shift it binds the selected piece to
      // one. Modified digits belong to the browser (Ctrl+1 switches tabs).
      const digit = hotbarDigit(e.code);
      if (digit > 0) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        this.pending.push(
          (e.shiftKey ? `bind${digit}` : `hotbar${digit}`) as ActionKey,
        );
        return;
      }

      this.keys.add(e.code);
      if (e.code === 'KeyB') this.pending.push('build');
      if (e.code === 'KeyR') this.pending.push('rotate');
      if (e.code === 'KeyX') this.pending.push('remove');
      if (e.code === 'KeyM') this.pending.push(e.shiftKey ? 'mute' : 'map');
      if (e.code === 'KeyL') this.pending.push('ledger');
      if (e.code === 'KeyC') this.pending.push('craft');
      if (e.code === 'KeyU') this.pending.push('upgrade');
      if (e.code === 'Tab') this.pending.push('inventory');
      if (e.code === 'Escape') this.pending.push('cancel');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.target.addEventListener('pointermove', (e) => {
      // Fingers set the pointer from touch events, which know which finger is
      // walking and which is pointing.
      if (e.pointerType === 'touch') return;
      this.aim(e);
    });
    this.target.addEventListener('pointerleave', () => (this.hovering = false));
    // A screen closing under a still mouse sends no move, only this, so without
    // it hover cards stay off, or describe wherever the cursor was before.
    this.target.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') this.aim(e);
    });
    // Right-click removes, so the browser menu must not fight it.
    this.target.addEventListener('contextmenu', (e) => e.preventDefault());

    this.target.addEventListener('pointerdown', (e) => {
      this.touched = e.pointerType === 'touch';
      if (e.pointerType === 'touch') return;
      // A mouse that moved while a screen covered the island never told the
      // canvas where it went, so a click straight after closing that screen
      // would land wherever the cursor last was over the world.
      this.aim(e);
      // Shift with either button copies a machine's settings or pastes them,
      // the pair Factorio players already have in their hands.
      if (e.shiftKey && (e.button === 0 || e.button === 2)) {
        this.pending.push(e.button === 2 ? 'copy' : 'paste');
        return;
      }
      if (e.button === 2) {
        this.pending.push('remove');
        return;
      }
      this.pointerDown = true;
      this.clicked = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointerDown = false;
    });

    this.bindTouch();
  }

  private aim(e: PointerEvent): void {
    const rect = this.target.getBoundingClientRect();
    this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.hovering = true;
  }

  private bindTouch(): void {
    this.target.addEventListener(
      'touchstart',
      (e) => {
        const rect = this.target.getBoundingClientRect();
        this.touched = true;
        for (const touch of Array.from(e.changedTouches)) {
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          // Building keeps a narrower strip on the left for walking, so most of
          // the screen can be pointed at.
          const stickZone = this.buildMode ? rect.width * 0.3 : rect.width / 2;
          if (this.buildMode && x >= stickZone && !this.buildTouch) {
            this.pointer = { x, y };
            this.pointerDown = true;
            this.clicked = true;
            const timer = window.setTimeout(() => {
              if (!this.buildTouch || this.buildTouch.id !== touch.identifier) return;
              this.pending.push('remove');
              this.buildTouch.timer = 0;
              this.pointerDown = false;
            }, HOLD_TO_REMOVE_MS);
            this.buildTouch = { id: touch.identifier, origin: { x, y }, timer };
            continue;
          }
          // Left half drives the stick, right half is "do the thing": gather,
          // or open the machine under the finger.
          if (x < stickZone && !this.stick.active) {
            this.stick = { active: true, origin: { x, y }, pos: { x, y }, id: touch.identifier };
          } else {
            this.touchInteract = true;
            this.pointer = { x, y };
            this.clicked = true;
          }
        }
      },
      { passive: true },
    );

    this.target.addEventListener(
      'touchmove',
      (e) => {
        const rect = this.target.getBoundingClientRect();
        for (const touch of Array.from(e.changedTouches)) {
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          if (this.buildTouch?.id === touch.identifier) {
            const held = this.buildTouch;
            // A finger that has moved is laying a line, not asking to remove.
            if (held.timer && Math.hypot(x - held.origin.x, y - held.origin.y) > HOLD_SLOP_PX) {
              window.clearTimeout(held.timer);
              held.timer = 0;
            }
            if (this.pointerDown) this.pointer = { x, y };
            continue;
          }
          if (touch.identifier !== this.stick.id) continue;
          this.stick.pos = { x, y };
        }
      },
      { passive: true },
    );

    const end = (e: TouchEvent): void => {
      for (const touch of Array.from(e.changedTouches)) {
        if (this.buildTouch?.id === touch.identifier) {
          window.clearTimeout(this.buildTouch.timer);
          this.buildTouch = null;
          this.pointerDown = false;
        } else if (touch.identifier === this.stick.id) this.stick.active = false;
        else this.touchInteract = false;
      }
    };
    this.target.addEventListener('touchend', end, { passive: true });
    this.target.addEventListener('touchcancel', end, { passive: true });
  }

  /** The press just placed something, so holding it must not take it away. */
  cancelHold(): void {
    if (!this.buildTouch?.timer) return;
    window.clearTimeout(this.buildTouch.timer);
    this.buildTouch.timer = 0;
  }

  /** True when the last press came from a finger, so hints can say "tap". */
  get isTouch(): boolean {
    return this.touched;
  }

  /** Exposed so the HUD can draw the on-screen stick where the finger is. */
  get stickState(): { active: boolean; origin: Vec2; pos: Vec2 } {
    return this.stick;
  }

  triggerDash(): void {
    this.touchDash = true;
  }

  drainActions(): ActionKey[] {
    const actions = this.pending;
    this.pending = [];
    return actions;
  }

  takeClick(): boolean {
    const was = this.clicked;
    this.clicked = false;
    return was;
  }

  sample(): PlayerInput {
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        x += dir.x;
        y += dir.y;
      }
    }

    if (this.stick.active) {
      const dx = this.stick.pos.x - this.stick.origin.x;
      const dy = this.stick.pos.y - this.stick.origin.y;
      const len = Math.hypot(dx, dy);
      if (len > 8) {
        const scale = Math.min(1, len / 60) / len;
        x += dx * scale;
        y += dy * scale;
      }
    }

    const dash = this.keys.has('Space') || this.touchDash;
    this.touchDash = false;

    return {
      move: { x, y },
      dash,
      interact: this.keys.has('KeyE') || this.pointerDown || this.touchInteract,
    };
  }
}
