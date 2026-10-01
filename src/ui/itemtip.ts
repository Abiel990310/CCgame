import type { ItemId } from '@shared/sim/types';
import { ITEMS } from '@shared/data/items';
import { itemIconVar } from '../render/items';
import { itemInfo } from './iteminfo';

/**
 * The card that follows the mouse over any item in the interface: bag and
 * machine slots, the pouch, recipe and craft costs. Anything drawn with
 * `data-tip="<item id>"` gets it, plus `data-tip-note` for what that one slot
 * adds ("Kept for Coal."), so a screen opts in with an attribute rather than
 * wiring its own hover code.
 *
 * Mouse only. On a touchscreen a press is how items are picked up and moved,
 * and a card that opened on it would sit under the finger doing the moving.
 */
class ItemTip {
  private card = document.createElement('div');
  private target: HTMLElement | null = null;
  private key = '';
  /** The element a press landed on: no card over it until the pointer leaves. */
  private pressed: HTMLElement | null = null;
  private x = 0;
  private y = 0;

  constructor() {
    this.card.className = 'item-tip';
    this.card.hidden = true;
    document.body.appendChild(this.card);
    document.addEventListener('pointermove', (e) => this.move(e), { passive: true });
    document.addEventListener('pointerdown', () => {
      this.pressed = this.target;
      this.hide();
    });
    document.addEventListener('pointerleave', () => this.hide());
    // A slot repaints under a still pointer as items arrive or leave, and the
    // pouch rebuilds its chips outright, so the card rechecks what it is over.
    window.setInterval(() => this.refresh(), 200);
  }

  private move(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') {
      this.hide();
      return;
    }
    this.x = e.clientX;
    this.y = e.clientY;
    const over = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tip]') : null;
    if (over !== this.pressed) this.pressed = null;
    this.target = over;
    this.refresh();
  }

  private refresh(): void {
    const t = this.target;
    // Something in hand is the one thing being looked at; a card would cover
    // the slot it is about to be dropped in.
    const holding = document.querySelector('#inv-carried:not(.hidden)') !== null;
    if (!t || !t.isConnected || t === this.pressed || holding || !t.dataset.tip || !(t.dataset.tip in ITEMS)) {
      this.hide();
      return;
    }
    const key = `${t.dataset.tip}|${t.dataset.tipNote ?? ''}`;
    if (key !== this.key) {
      this.key = key;
      this.card.innerHTML = render(t.dataset.tip as ItemId, t.dataset.tipNote ?? '');
    }
    this.card.hidden = false;
    this.place();
  }

  /** Beside the pointer, flipped to the other side near a screen edge. */
  private place(): void {
    const gap = 16;
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    let left = this.x + gap;
    let top = this.y + gap;
    if (left + w > window.innerWidth - 8) left = this.x - gap - w;
    if (top + h > window.innerHeight - 8) top = this.y - gap - h;
    left = Math.max(8, left);
    top = Math.max(8, top);
    this.card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  private hide(): void {
    this.card.hidden = true;
  }
}

function render(id: ItemId, note: string): string {
  const info = itemInfo(id);
  const effect = info.effect.map((line) => `<p class="tip-effect">${esc(line)}</p>`).join('');
  const sect = (label: string, items: string[]): string =>
    items.length ? `<div class="tip-sect"><span>${label}</span><b>${esc(items.join(', '))}</b></div>` : '';
  const hint = note ? `<p class="tip-hint">${esc(note)}</p>` : '';
  return (
    `<header><i class="tip-icon" style="background-image:${itemIconVar(id)}"></i>` +
    `<div><h4>${esc(info.name)}</h4><span class="tip-kind">${esc(info.kind)}</span></div></header>` +
    effect +
    sect('From', info.from) +
    sect('Used in', info.uses) +
    hint
  );
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

let installed = false;

/** Once per page: the card listens on the document, whichever island is up. */
export function installItemTip(): void {
  if (installed) return;
  installed = true;
  new ItemTip();
}
