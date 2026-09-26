import { audio } from '../audio';
import { netLogButton } from './netlog';
import { SoundPanel } from './sound';
import { icon } from './icons';
import { emblemSvg } from './emblem';
import './title.css';
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
import type { CloudWorld } from '../account/cloud';

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
  /** Everything below is for accounts, and never called when they are off. */
  onAccount?: () => void;
  /** Play an island that is in the account but not yet on this device. */
  onPlayCloud?: (world: CloudWorld) => void;
  /** Keep a local island in the account too. */
  onUpload?: (slot: SaveSlot) => Promise<void>;
  onDeleteCloud?: (world: CloudWorld) => Promise<void>;
  onRenamed?: (slot: SaveSlot) => void;
  /** Drop in on a friend who is playing. */
  onJoinFriend?: (world: CloudWorld) => void;
}

/** What the menu knows about the account, when there is one. */
export interface MenuCloud {
  /** Null while signed out. */
  userId: string | null;
  name: string;
  /** Null until the first list arrives. */
  worlds: CloudWorld[] | null;
  error: string;
}

/**
 * Motes of light drifting up over the island behind the title. Fixed spots
 * rather than random ones, so the title looks the same every time it opens;
 * mostly over the right, where the scene shows, clear of the banner.
 */
function motes(): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'menu-motes';
  const spots = [
    [48, 13, 0, 24], [56, 17, 3, -30], [63, 12, 7, 40], [71, 15, 1, -20], [78, 19, 5, 30],
    [84, 14, 9, -36], [90, 16, 2, 22], [95, 13, 11, -18], [67, 18, 4, 34], [59, 15, 10, -26],
    [87, 12, 6, 18], [75, 20, 12, -40],
  ];
  layer.innerHTML = spots
    .map(([left, time, delay, drift]) => `<i style="left:${left}%;--t:${time}s;--d:-${delay}s;--x:${drift}px"></i>`)
    .join('');
  return layer;
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
  private cloud: MenuCloud | null = null;
  /** Slots and worlds with a request in flight, so a double click sends one. */
  private pending = new Set<string>();
  private accountButton: HTMLButtonElement | null = null;
  private friendsBox: HTMLElement | null = null;

  constructor(private callbacks: MenuCallbacks) {
    // Mounted here as well as in the pause screen so the first thing a player
    // can do on the page is decide how loud it is.
    this.sound = new SoundPanel(this.els.sound);
    $('menu-logo').insertAdjacentHTML('afterbegin', emblemSvg());
    this.els.root.prepend(motes());

    this.els.continue.addEventListener('click', () => {
      const slot = lastPlayed() ?? listSaves()[0];
      const remote = this.cloudOnly()[0];
      if (slot) this.play(slot);
      else if (remote) {
        audio.play('open');
        this.callbacks.onPlayCloud?.(remote);
      } else this.startNew();
    });
    this.els.new.addEventListener('click', () => this.startNew());
  }

  /** Turn the account parts of the menu on, once, when this build has accounts. */
  enableAccounts(): void {
    if (this.accountButton) return;
    const button = document.createElement('button');
    button.className = 'menu-account';
    button.addEventListener('click', () => {
      audio.play('click');
      this.callbacks.onAccount?.();
    });
    // In the screen's corner rather than beside the title, which it squeezed
    // onto two lines.
    this.els.root.prepend(button);
    this.accountButton = button;

    const box = document.createElement('section');
    box.className = 'saves friends-worlds hidden';
    this.els.saves.after(box);
    this.friendsBox = box;
    this.cloud = { userId: null, name: '', worlds: null, error: '' };
    this.render();
  }

  setCloud(cloud: MenuCloud): void {
    this.cloud = cloud;
    // The local cards only depend on who is signed in and which islands are
    // linked, and redrawing them would throw away a rename being typed, so a
    // list refresh that changed neither leaves them be.
    const key = this.localKey();
    if (key !== this.drawnKey) this.render();
    else this.renderCloudOnly();
  }

  /** What the local cards were last drawn from; see `setCloud`. */
  private drawnKey = '';

  private localKey(): string {
    return `${this.cloud?.userId ?? ''}|${listSaves()
      .map((s) => `${s.id}:${s.cloud?.id ?? ''}`)
      .join(',')}`;
  }

  /** Replace the line under the buttons, for progress the player is waiting on. */
  say(text: string): void {
    this.els.note.textContent = text;
  }

  /** Put a way to see the connection log under the note, after a join failed. */
  offerNetLog(): void {
    this.els.note.appendChild(document.createElement('br'));
    this.els.note.appendChild(netLogButton());
  }

  get isOpen(): boolean {
    return !this.els.root.classList.contains('hidden');
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
    this.drawnKey = this.localKey();
    this.renderCloudOnly();
  }

  /** The account's islands that this device has no slot for, newest first. */
  private cloudOnly(): CloudWorld[] {
    const cloud = this.cloud;
    if (!cloud?.userId || !cloud.worlds) return [];
    const linked = new Set(listSaves().map((s) => s.cloud?.id).filter(Boolean));
    return cloud.worlds.filter((w) => w.mine && !linked.has(w.id));
  }

  /**
   * The parts that follow the account: the sign-in button, islands only in
   * the account, and friends' islands. Redrawn on every list refresh without
   * touching the local cards, so a rename in progress survives it.
   */
  private renderCloudOnly(): void {
    const cloud = this.cloud;
    if (!cloud || !this.accountButton || !this.friendsBox) return;
    const button = this.accountButton;
    button.innerHTML = `${icon('user')}<span></span>`;
    (button.querySelector('span') as HTMLElement).textContent = cloud.userId ? cloud.name || 'Account' : 'Sign in';
    button.title = cloud.userId ? 'Your account and friends' : 'Keep islands in the cloud and play with friends';

    for (const old of Array.from(this.els.list.querySelectorAll('.save-card.cloud-only'))) old.remove();
    const worlds = cloud.userId ? cloud.worlds ?? [] : [];
    const mine = this.cloudOnly();
    for (const world of mine) this.els.list.appendChild(this.cloudCard(world));
    const local = listSaves().length;
    this.els.saves.classList.toggle('hidden', local === 0 && mine.length === 0);
    // With nothing on this device, Continue picks up the account's newest island.
    if (local === 0) {
      const span = this.els.continue.querySelector('span');
      if (span) span.textContent = mine[0] ? `Continue ${mine[0].name}` : 'Start your first island';
      this.els.new.classList.toggle('hidden', mine.length === 0);
      if (mine[0]) this.els.note.textContent = `In your account · night ${mine[0].summary.night ?? 0} · level ${mine[0].summary.level ?? 1}`;
    }

    const theirs = worlds.filter((w) => !w.mine);
    const box = this.friendsBox;
    box.innerHTML = '';
    box.classList.toggle('hidden', !cloud.userId || (theirs.length === 0 && !cloud.error));
    const title = document.createElement('h2');
    title.className = 'saves-title';
    title.textContent = "Friends' islands";
    box.appendChild(title);
    if (cloud.error) {
      const note = document.createElement('p');
      note.className = 'menu-cloud-error';
      note.textContent = cloud.error;
      box.appendChild(note);
    }
    const list = document.createElement('div');
    list.className = 'save-list';
    for (const world of theirs) list.appendChild(this.friendCard(world));
    box.appendChild(list);
  }

  /** An island in the account that this device has not got yet. */
  private cloudCard(world: CloudWorld): HTMLElement {
    const card = document.createElement('article');
    card.className = 'save-card cloud-only';
    const thumb = document.createElement('div');
    thumb.className = 'save-thumb cloud';
    thumb.innerHTML = icon('cloud');
    card.appendChild(thumb);

    const title = document.createElement('button');
    title.className = 'save-open';
    const s = world.summary;
    title.innerHTML =
      `<b></b><span>In your account · Night ${s.night ?? 0} · Level ${s.level ?? 1}` +
      `${world.live ? ' · open on another device' : ''}</span><em>${describeAge(world.updatedAt)}</em>`;
    (title.querySelector('b') as HTMLElement).textContent = world.name;
    title.disabled = this.pending.has(world.id);
    title.addEventListener('click', () => {
      audio.play('open');
      this.callbacks.onPlayCloud?.(world);
    });
    card.appendChild(title);

    const tools = document.createElement('div');
    tools.className = 'save-tools';
    const remove = document.createElement('button');
    remove.className = 'save-tool danger';
    const armed = this.armedDelete === world.id;
    if (armed) remove.classList.add('armed');
    if (armed) remove.textContent = 'Delete?';
    else remove.innerHTML = icon('trash');
    remove.title = armed ? 'Click again to delete this island from your account for good' : 'Delete from your account';
    remove.disabled = this.pending.has(world.id);
    remove.addEventListener('click', () => {
      audio.play(this.armedDelete === world.id ? 'removed' : 'denied');
      if (this.armedDelete !== world.id) {
        this.armedDelete = world.id;
        this.render();
        return;
      }
      this.armedDelete = null;
      void this.busy(world.id, () => this.callbacks.onDeleteCloud?.(world));
    });
    tools.appendChild(remove);
    card.appendChild(tools);
    return card;
  }

  private friendCard(world: CloudWorld): HTMLElement {
    const card = document.createElement('article');
    card.className = 'save-card friend-world';
    const thumb = document.createElement('div');
    thumb.className = `save-thumb${world.live ? ' live' : ''}`;
    thumb.innerHTML = icon('users');
    card.appendChild(thumb);

    const text = document.createElement('div');
    text.className = 'save-open';
    const joinable = world.live && !!world.room;
    text.innerHTML = `<b></b><span></span>`;
    (text.querySelector('b') as HTMLElement).textContent = world.name;
    (text.querySelector('span') as HTMLElement).textContent =
      `${world.ownerName}'s island · ` +
      (joinable ? 'playing now' : world.live ? 'playing, co-op not open yet' : 'nobody on it right now');
    card.appendChild(text);

    const tools = document.createElement('div');
    tools.className = 'save-tools';
    const join = document.createElement('button');
    join.className = 'save-tool join';
    join.textContent = 'Join';
    join.disabled = !joinable;
    join.title = joinable ? `Drop in on ${world.ownerName}` : 'You can join while someone is on it';
    join.addEventListener('click', () => {
      audio.play('open');
      this.callbacks.onJoinFriend?.(world);
    });
    tools.appendChild(join);
    card.appendChild(tools);
    return card;
  }

  /** Run an account request for one card, keeping its buttons off meanwhile. */
  private async busy(id: string, work: () => Promise<void> | undefined): Promise<void> {
    this.pending.add(id);
    this.render();
    try {
      await work();
    } catch (error) {
      this.els.note.textContent = error instanceof Error ? error.message : 'That did not work — try again';
      audio.play('denied');
    } finally {
      this.pending.delete(id);
      this.render();
    }
  }

  private card(slot: SaveSlot): HTMLElement {
    const card = document.createElement('article');
    card.className = 'save-card';

    const thumb = document.createElement('div');
    thumb.className = 'save-thumb';
    const userId = this.cloud?.userId ?? null;
    const inAccount = !!userId && slot.cloud?.owner === userId;
    if (inAccount) {
      thumb.classList.add('synced');
      thumb.innerHTML = icon('cloud');
      thumb.title = 'Kept in your account';
    }
    card.appendChild(thumb);

    const title = document.createElement('button');
    title.className = 'save-open';
    title.disabled = this.pending.has(slot.id);
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
    if (armed) remove.textContent = inAccount ? 'Remove?' : 'Delete?';
    else remove.innerHTML = icon('trash');
    remove.title = inAccount
      ? armed
        ? 'Click again to remove it from this device. It stays in your account.'
        : 'Remove from this device'
      : armed
        ? 'Click again to delete this island for good'
        : 'Delete';
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

    tools.append(rename);
    if (userId && !slot.cloud) {
      const upload = document.createElement('button');
      upload.className = 'save-tool';
      upload.innerHTML = icon('cloud');
      upload.title = 'Keep in your account, to play it on any device';
      upload.disabled = this.pending.has(slot.id);
      upload.addEventListener('click', () => {
        audio.play('click');
        void this.busy(slot.id, () => this.callbacks.onUpload?.(slot));
      });
      tools.append(upload);
    }
    tools.append(remove);
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
      const renamed = listSaves().find((s) => s.id === slot.id);
      if (renamed && renamed.name !== slot.name) this.callbacks.onRenamed?.(renamed);
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
