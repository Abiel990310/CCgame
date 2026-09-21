import {
  createSlot,
  deleteSlot,
  describeAge,
  describePlaytime,
  lastPlayed,
  listSaves,
  renameSlot,
  suggestName,
  type SaveSlot,
} from '../saves';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el as T;
};

export interface MenuCallbacks {
  /**
   * Play a slot — loading its island, or generating one the first time, in
   * which case `peaceful` decides whether nights ever raid it.
   */
  onPlay: (slot: SaveSlot, peaceful: boolean) => void;
}

/**
 * The main menu. It owns the list of saves and nothing about the simulation:
 * it hands a slot to the game and steps out of the way.
 */
export class MainMenu {
  private els = {
    root: $('menu'),
    continue: $<HTMLButtonElement>('menu-continue'),
    new: $<HTMLButtonElement>('menu-new'),
    note: $('menu-note'),
    peaceful: $<HTMLInputElement>('opt-peaceful'),
    saves: $('saves'),
    list: $('save-list'),
  };

  /** The slot whose delete button is armed, so a stray click cannot wipe a save. */
  private armedDelete: string | null = null;

  constructor(private callbacks: MenuCallbacks) {
    this.els.continue.addEventListener('click', () => {
      const slot = lastPlayed() ?? listSaves()[0];
      if (slot) this.play(slot);
      else this.startNew();
    });
    this.els.new.addEventListener('click', () => this.startNew());
  }

  open(): void {
    this.armedDelete = null;
    this.render();
    this.els.root.classList.remove('hidden');
  }

  close(): void {
    this.els.root.classList.add('hidden');
  }

  private startNew(): void {
    this.play(createSlot(suggestName()));
  }

  private play(slot: SaveSlot): void {
    this.close();
    // An island that already exists keeps the mode it was generated with; the
    // checkbox only ever decides a fresh one.
    this.callbacks.onPlay(slot, this.els.peaceful.checked);
  }

  private render(): void {
    const saves = listSaves();
    const recent = lastPlayed() ?? saves[0] ?? null;

    this.els.continue.textContent = recent ? `Continue — ${recent.name}` : 'Start your first island';
    this.els.new.classList.toggle('hidden', saves.length === 0);
    this.els.note.textContent = recent
      ? `${describeAge(recent.updatedAt)} · night ${recent.night} · level ${recent.level}`
      : 'A fresh island, generated the moment you start.';
    this.els.saves.classList.toggle('hidden', saves.length === 0);

    this.els.list.innerHTML = '';
    for (const slot of saves) this.els.list.appendChild(this.card(slot));
  }

  private card(slot: SaveSlot): HTMLElement {
    const card = document.createElement('article');
    card.className = 'save-card';

    const title = document.createElement('button');
    title.className = 'save-open';
    title.innerHTML =
      `<b></b><span>Night ${slot.night} · Level ${slot.level} · ` +
      `${describePlaytime(slot.playSeconds)}</span>` +
      `<em>${describeAge(slot.updatedAt)}</em>`;
    // Names are player text, so they go in as text and never as markup.
    (title.querySelector('b') as HTMLElement).textContent = slot.name;
    title.addEventListener('click', () => this.play(slot));
    card.appendChild(title);

    const tools = document.createElement('div');
    tools.className = 'save-tools';

    const rename = document.createElement('button');
    rename.className = 'save-tool';
    rename.textContent = 'Rename';
    rename.addEventListener('click', () => this.beginRename(card, slot));

    const remove = document.createElement('button');
    remove.className = 'save-tool danger';
    remove.textContent = this.armedDelete === slot.id ? 'Really delete?' : 'Delete';
    remove.addEventListener('click', () => {
      if (this.armedDelete === slot.id) {
        deleteSlot(slot.id);
        this.armedDelete = null;
      } else {
        this.armedDelete = slot.id;
      }
      this.render();
    });

    tools.append(rename, remove);
    card.appendChild(tools);
    return card;
  }

  private beginRename(card: HTMLElement, slot: SaveSlot): void {
    const input = document.createElement('input');
    input.className = 'save-rename';
    input.value = slot.name;
    input.maxLength = 40;

    const commit = (): void => {
      renameSlot(slot.id, input.value);
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') this.render();
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);

    card.innerHTML = '';
    card.appendChild(input);
    input.focus();
    input.select();
  }
}
