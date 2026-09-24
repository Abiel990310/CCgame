import { audio } from '../audio';
import { SoundPanel } from './sound';
import { icon } from './icons';
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
    sound: $('menu-sound'),
  };

  /** The slot whose delete button is armed, so a stray click cannot wipe a save. */
  private armedDelete: string | null = null;
  private sound: SoundPanel;

  constructor(private callbacks: MenuCallbacks) {
    // Mounted here as well as in the pause screen so the first thing a player
    // can do on the page is decide how loud it is.
    this.sound = new SoundPanel(this.els.sound);

    this.els.continue.addEventListener('click', () => {
      const slot = lastPlayed() ?? listSaves()[0];
      if (slot) this.play(slot);
      else this.startNew();
    });
    this.els.new.addEventListener('click', () => this.startNew());
  }

  /** `notice` replaces the usual summary line, for news the player must see. */
  open(notice?: string): void {
    this.armedDelete = null;
    this.sound.refresh();
    this.render();
    if (notice) this.els.note.textContent = notice;
    this.els.root.classList.remove('hidden');
    document.body.classList.add('in-menu');
  }

  close(): void {
    this.els.root.classList.add('hidden');
    document.body.classList.remove('in-menu');
  }

  private startNew(): void {
    this.play(createSlot(suggestName()));
  }

  private play(slot: SaveSlot): void {
    audio.play('open');
    this.close();
    // An island that already exists keeps the mode it was generated with; the
    // checkbox only ever decides a fresh one.
    this.callbacks.onPlay(slot, this.els.peaceful.checked);
  }

  private render(): void {
    const saves = listSaves();
    const recent = lastPlayed() ?? saves[0] ?? null;

    // The island name is player text, so it goes in as text and never as markup.
    this.els.continue.innerHTML = `${icon('play')}<span></span>`;
    (this.els.continue.querySelector('span') as HTMLElement).textContent = recent
      ? `Continue ${recent.name}`
      : 'Start your first island';
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

    const thumb = document.createElement('div');
    thumb.className = 'save-thumb';
    card.appendChild(thumb);

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
    rename.innerHTML = icon('pencil');
    rename.title = 'Rename';
    rename.addEventListener('click', () => {
      audio.play('click');
      this.beginRename(card, slot);
    });

    const remove = document.createElement('button');
    remove.className = 'save-tool danger';
    const armed = this.armedDelete === slot.id;
    if (armed) remove.classList.add('armed');
    if (armed) remove.textContent = 'Delete?';
    else remove.innerHTML = icon('trash');
    remove.title = armed ? 'Click again to delete this island for good' : 'Delete';
    remove.addEventListener('click', () => {
      audio.play(this.armedDelete === slot.id ? 'removed' : 'denied');
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
