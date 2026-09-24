import { audio } from '../audio';
import { cleanCode, CODE_LENGTH, MAX_GUESTS } from '../net/protocol';
import { icon } from './icons';
import './coop.css';

const NAME_KEY = 'ccgame.coop.name';

/** The name shown over this player's head on anyone's island. */
export function playerName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() || 'Islander';
  } catch {
    return 'Islander';
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.replace(/\s+/g, ' ').trim().slice(0, 16));
  } catch {
    // Not remembered next time; nothing else depends on it.
  }
}

/** A link that opens the join screen with the code already filled in. */
function inviteLink(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', code);
  // A self-hosted broker has to come along, or the friend signals somewhere else.
  const broker = new URLSearchParams(location.search).get('broker');
  if (broker) url.searchParams.set('broker', broker);
  return url.toString();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

export interface CoopPanelCallbacks {
  /** Open the island to friends; resolves with the room code. */
  onHost: () => Promise<string>;
  onStopHosting: () => void;
}

type Mode = { kind: 'solo' } | { kind: 'host'; code: string } | { kind: 'guest'; code: string };

/**
 * Co-op inside a game: the section of the pause screen that opens the island
 * to friends, and the chip that says who is here while it is open.
 */
export class CoopPanel {
  private mode: Mode = { kind: 'solo' };
  private names: string[] = [];
  private section = el('section', 'coop-pause');
  private chip = el('div', 'coop-chip panel hidden');
  private busy = false;
  private error = '';

  constructor(private callbacks: CoopPanelCallbacks) {
    const sound = document.getElementById('pause-sound');
    sound?.parentElement?.insertBefore(this.section, sound);
    (document.getElementById('corner-right') ?? document.getElementById('ui'))?.appendChild(this.chip);
    this.render();
  }

  setSolo(): void {
    this.mode = { kind: 'solo' };
    this.names = [];
    this.render();
  }

  setHosting(code: string, names: string[]): void {
    this.mode = { kind: 'host', code };
    this.names = names;
    this.render();
  }

  setGuest(code: string, names: string[]): void {
    this.mode = { kind: 'guest', code };
    this.names = names;
    this.render();
  }

  setRoster(names: string[]): void {
    this.names = names;
    this.render();
  }

  /** The pause screen is opening: make its quit button say what it will do. */
  refreshPause(): void {
    const quit = document.getElementById('pause-quit');
    if (quit) quit.textContent = this.mode.kind === 'guest' ? 'Leave island' : 'Save & quit to menu';
    this.render();
  }

  private render(): void {
    const { mode } = this;
    const others = this.names.length;
    this.chip.classList.toggle('hidden', mode.kind === 'solo');
    if (mode.kind !== 'solo') {
      this.chip.innerHTML = `${icon('users')}<b></b><span></span>`;
      const code = this.chip.querySelector('b') as HTMLElement;
      code.textContent = mode.code;
      code.dataset.count = String(others);
      (this.chip.querySelector('span') as HTMLElement).textContent =
        others === 1 ? 'just you so far' : `${others} on the island`;
      this.chip.title = this.names.join(', ');
    }

    const s = this.section;
    s.innerHTML = '';
    s.appendChild(el('p', 'eyebrow', 'Co-op'));

    if (mode.kind === 'solo') {
      s.appendChild(
        el(
          'p',
          'coop-blurb',
          `Up to ${MAX_GUESTS} friends can join this island with a code, from any browser. It stays yours: the save lives here, and so do their characters.`,
        ),
      );
      const row = el('div', 'coop-row');
      const name = el('input', 'coop-input coop-name');
      name.value = playerName();
      name.maxLength = 16;
      name.placeholder = 'Your name';
      name.setAttribute('aria-label', 'Your name');
      name.addEventListener('change', () => rememberName(name.value));
      // Letters typed into a name are not movement or build keys.
      name.addEventListener('keydown', (e) => e.stopPropagation());
      const invite = el('button', 'primary-btn', `${icon('users')}Invite friends`);
      invite.disabled = this.busy;
      if (this.busy) invite.lastChild!.textContent = 'Opening…';
      invite.addEventListener('click', () => {
        rememberName(name.value);
        void this.host();
      });
      row.append(name, invite);
      s.appendChild(row);
      if (this.error) s.appendChild(el('p', 'coop-error')).textContent = this.error;
      return;
    }

    const code = el('div', 'coop-code');
    code.textContent = mode.code;
    s.appendChild(code);
    if (mode.kind === 'host') {
      s.appendChild(el('p', 'coop-blurb', 'Friends open the game, choose <b>Join a friend</b>, and type this code. Or send them the link.'));
    }
    const roster = el('p', 'coop-roster');
    roster.textContent = `On the island: ${this.names.join(', ')}`;
    s.appendChild(roster);

    if (mode.kind === 'host') {
      const row = el('div', 'coop-row');
      const copy = el('button', 'ghost-btn small', 'Copy invite link');
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(inviteLink(mode.code)).then(
          () => (copy.textContent = 'Link copied'),
          () => (copy.textContent = inviteLink(mode.code)),
        );
      });
      const stop = el('button', 'ghost-btn small', 'Stop inviting');
      stop.addEventListener('click', () => {
        audio.play('click');
        this.callbacks.onStopHosting();
      });
      row.append(copy, stop);
      s.appendChild(row);
    } else {
      s.appendChild(el('p', 'coop-blurb', 'The host keeps the save. What you gather and build stays on their island for next time.'));
    }
  }

  private async host(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.render();
    try {
      await this.callbacks.onHost();
      audio.play('open');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open the island to friends';
      audio.play('denied');
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

/**
 * The main menu's way onto someone else's island: a code, a name, and a
 * button. A `?join=CODE` link opens it with the code filled in.
 */
export class JoinScreen {
  private root = el('div', 'modal coop-join hidden');
  private code: HTMLInputElement;
  private name: HTMLInputElement;
  private status: HTMLElement;
  private go: HTMLButtonElement;
  private busy = false;

  constructor(private onJoin: (code: string, name: string) => Promise<void>) {
    const inner = el('div', 'modal-inner');
    inner.appendChild(el('p', 'eyebrow', 'Co-op'));
    inner.appendChild(el('h2', '', 'Join a friend'));
    inner.appendChild(
      el('p', 'blurb', 'Ask the host for their island code. It is in their pause menu, under <b>Invite friends</b>.'),
    );

    this.code = el('input', 'coop-input coop-code-input');
    this.code.maxLength = CODE_LENGTH + 2;
    this.code.placeholder = 'CODE';
    this.code.autocomplete = 'off';
    this.code.spellcheck = false;
    this.code.setAttribute('aria-label', 'Island code');
    this.code.addEventListener('input', () => {
      this.code.value = this.code.value.toUpperCase();
    });

    this.name = el('input', 'coop-input coop-name');
    this.name.maxLength = 16;
    this.name.placeholder = 'Your name';
    this.name.setAttribute('aria-label', 'Your name');

    const fields = el('div', 'coop-fields');
    fields.append(this.code, this.name);
    inner.appendChild(fields);

    this.status = el('p', 'coop-status');
    inner.appendChild(this.status);

    const row = el('div', 'start-row');
    this.go = el('button', 'primary-btn', `${icon('play')}Join`);
    const cancel = el('button', 'ghost-btn', 'Back');
    row.append(this.go, cancel);
    inner.appendChild(row);
    this.root.appendChild(inner);
    document.body.appendChild(this.root);

    this.go.addEventListener('click', () => void this.join());
    cancel.addEventListener('click', () => this.close());
    for (const input of [this.code, this.name]) {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void this.join();
        if (e.key === 'Escape') this.close();
      });
    }
  }

  open(code = ''): void {
    this.code.value = code;
    this.name.value = playerName() === 'Islander' ? '' : playerName();
    this.status.textContent = '';
    this.status.classList.remove('bad');
    this.root.classList.remove('hidden');
    (code ? this.name : this.code).focus();
  }

  close(): void {
    if (this.busy) return;
    this.root.classList.add('hidden');
  }

  private async join(): Promise<void> {
    if (this.busy) return;
    const code = cleanCode(this.code.value);
    if (!code) {
      this.say(`A code is ${CODE_LENGTH} letters and numbers.`, true);
      return;
    }
    const name = this.name.value.trim() || 'Islander';
    rememberName(name);
    this.busy = true;
    this.go.disabled = true;
    this.say('Finding the island…');
    try {
      await this.onJoin(code, name);
      this.busy = false;
      this.close();
    } catch (error) {
      this.say(error instanceof Error ? error.message : 'Could not join.', true);
      audio.play('denied');
    } finally {
      this.busy = false;
      this.go.disabled = false;
    }
  }

  private say(text: string, bad = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('bad', bad);
  }
}
