import { audio } from '../audio';
import type { Account } from '../account';
import { validName, type FriendsOverview, type Profile } from '../account/cloud';
import { icon } from './icons';
import './account.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, className = 'ghost-btn small'): HTMLButtonElement {
  const b = el('button', className);
  b.textContent = label;
  return b;
}

/** Letters typed into a form are not movement or build keys. */
function quiet(input: HTMLInputElement, onEnter?: () => void, onEscape?: () => void): void {
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') onEnter?.();
    if (e.key === 'Escape') onEscape?.();
  });
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

type View = 'sign-in' | 'sign-up' | 'profile';

const FRIEND_RESULTS: Record<string, string> = {
  sent: 'Request sent. You are friends once they accept.',
  friends: 'They had already asked — you are friends now.',
  already: 'You are already friends.',
  self: 'That is you.',
  not_found: 'Nobody goes by that name. Check the spelling with them.',
  too_many: 'You have a lot of unanswered requests. Wait for some to be answered.',
};

/**
 * The account screen from the main menu: signing in or up while signed out,
 * and the player's name and friends once signed in.
 */
export class AccountScreen {
  private root = el('div', 'modal account-screen hidden');
  private inner = el('div', 'modal-inner account-inner');
  private view: View = 'sign-in';
  private status = '';
  private bad = false;
  private busy = false;
  private friends: FriendsOverview | null = null;
  private armedRemove: string | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  /** What was typed, kept across redraws so switching views does not lose it. */
  private draft = { email: '', password: '', name: '', friend: '' };

  constructor(
    private account: Account,
    private onClose: () => void,
  ) {
    this.root.appendChild(this.inner);
    document.body.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    account.onChange(() => {
      if (this.isOpen) this.render();
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.view = this.account.signedIn ? 'profile' : 'sign-in';
    this.status = '';
    this.root.classList.remove('hidden');
    this.render();
    if (this.account.signedIn) {
      if (!this.account.profile) void this.account.loadProfile().catch(() => undefined);
      void this.loadFriends();
      this.poll ??= setInterval(() => void this.loadFriends(), 15_000);
    }
  }

  close(): void {
    this.root.classList.add('hidden');
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
    this.armedRemove = null;
    this.onClose();
  }

  private say(text: string, bad = false): void {
    this.status = text;
    this.bad = bad;
    const line = this.inner.querySelector('.account-status');
    if (line) {
      line.textContent = text;
      line.classList.toggle('bad', bad);
    }
  }

  private async run(work: () => Promise<void>, fallback: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await work();
    } catch (error) {
      this.status = message(error, fallback);
      this.bad = true;
      audio.play('denied');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private render(): void {
    if (this.view === 'profile' && !this.account.signedIn) this.view = 'sign-in';
    if (this.view !== 'profile' && this.account.signedIn) this.view = 'profile';
    const inner = this.inner;
    inner.innerHTML = '';
    const close = el('button', 'account-close');
    close.innerHTML = icon('close');
    close.title = 'Close';
    close.addEventListener('click', () => this.close());
    inner.appendChild(close);
    inner.appendChild(el('p', 'eyebrow', 'Account'));
    if (this.view === 'profile') this.renderProfile();
    else this.renderSignIn(this.view === 'sign-up');
  }

  private field(kind: 'email' | 'password' | 'name', placeholder: string, submit: () => void): HTMLInputElement {
    const input = el('input', 'coop-input account-input');
    input.type = kind === 'email' ? 'email' : kind === 'password' ? 'password' : 'text';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    input.autocomplete = kind === 'email' ? 'email' : kind === 'password' ? (this.view === 'sign-up' ? 'new-password' : 'current-password') : 'username';
    if (kind === 'name') input.maxLength = 16;
    input.value = this.draft[kind];
    input.disabled = this.busy;
    input.addEventListener('input', () => (this.draft[kind] = input.value));
    quiet(input, submit, () => this.close());
    return input;
  }

  private renderSignIn(signUp: boolean): void {
    const inner = this.inner;
    inner.appendChild(el('h2', '', signUp ? 'Create an account' : 'Sign in'));
    inner.appendChild(
      el(
        'p',
        'blurb',
        'Keep your islands in the cloud to play them on any device, add friends, and drop in on their islands while they play. Islands on this device stay here either way.',
      ),
    );
    const submit = (): void => void (signUp ? this.signUp() : this.signIn());
    const fields = el('div', 'account-fields');
    if (signUp) {
      const name = this.field('name', 'Name friends will know you by', submit);
      fields.appendChild(name);
    }
    fields.appendChild(this.field('email', 'Email', submit));
    fields.appendChild(this.field('password', signUp ? 'Password (6 or more characters)' : 'Password', submit));
    inner.appendChild(fields);

    const status = el('p', `account-status${this.bad ? ' bad' : ''}`, this.status);
    inner.appendChild(status);

    const row = el('div', 'start-row');
    const go = button(this.busy ? 'One moment…' : signUp ? 'Create account' : 'Sign in', 'primary-btn');
    go.disabled = this.busy;
    go.addEventListener('click', submit);
    row.appendChild(go);
    inner.appendChild(row);

    const links = el('div', 'account-links');
    const swap = el('button', 'link-btn', signUp ? 'Have an account? Sign in' : 'New here? Create an account');
    swap.addEventListener('click', () => {
      this.view = signUp ? 'sign-in' : 'sign-up';
      this.status = '';
      this.render();
    });
    links.appendChild(swap);
    if (!signUp) {
      const forgot = el('button', 'link-btn', 'Forgot password?');
      forgot.addEventListener('click', () => void this.recover());
      links.appendChild(forgot);
    }
    inner.appendChild(links);
    (inner.querySelector('input') as HTMLInputElement | null)?.focus();
  }

  private async signIn(): Promise<void> {
    const { email, password } = this.draft;
    if (!email.includes('@') || !password) {
      this.say('Enter your email and password.', true);
      return;
    }
    await this.run(async () => {
      await this.account.api.signIn(email.trim(), password);
      this.draft.password = '';
      this.status = '';
      audio.play('open');
      await this.account.loadProfile();
      await this.loadFriends();
    }, 'Could not sign in');
  }

  private async signUp(): Promise<void> {
    const { email, password } = this.draft;
    const name = this.draft.name.trim();
    if (!validName(name)) {
      this.say('A name is 3 to 16 letters, numbers or _ — no spaces.', true);
      return;
    }
    if (!email.includes('@')) {
      this.say('Enter an email you can get mail at.', true);
      return;
    }
    if (password.length < 6) {
      this.say('Choose a password of 6 or more characters.', true);
      return;
    }
    await this.run(async () => {
      if (!(await this.account.cloud.nameAvailable(name))) {
        this.status = `Someone is already called ${name}. Try another name.`;
        this.bad = true;
        return;
      }
      const result = await this.account.api.signUp(email.trim(), password, name);
      this.draft.password = '';
      if (result.kind === 'confirm-email') {
        this.view = 'sign-in';
        this.status = `Almost there: open the link we sent to ${email.trim()}, then sign in here.`;
        this.bad = false;
        return;
      }
      audio.play('open');
      this.status = '';
      await this.account.loadProfile();
      await this.loadFriends();
    }, 'Could not create the account');
  }

  private async recover(): Promise<void> {
    const email = this.draft.email.trim();
    if (!email.includes('@')) {
      this.say('Type your email above first, then press Forgot password.', true);
      return;
    }
    await this.run(async () => {
      await this.account.api.recover(email);
      this.status = `If ${email} has an account, a reset link is on its way.`;
      this.bad = false;
    }, 'Could not send the reset email');
  }

  private async loadFriends(): Promise<void> {
    if (!this.account.signedIn) return;
    try {
      this.friends = await this.account.cloud.friends();
    } catch {
      // The list stays as it was; the next poll tries again.
    }
    if (this.isOpen && this.view === 'profile' && !this.busy && !this.typing()) this.render();
  }

  /** A redraw would steal the caret from whoever is typing. */
  private typing(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLInputElement && this.inner.contains(active) && active.value !== '';
  }

  private renderProfile(): void {
    const inner = this.inner;
    const profile = this.account.profile;
    const head = el('div', 'account-head');
    const title = el('h2', '', profile?.name ?? '…');
    head.appendChild(title);
    const rename = el('button', 'save-tool');
    rename.innerHTML = icon('pencil');
    rename.title = 'Change your name';
    rename.addEventListener('click', () => this.beginRename(head, profile));
    head.appendChild(rename);
    inner.appendChild(head);
    inner.appendChild(el('p', 'blurb account-email', this.account.email));

    inner.appendChild(this.friendsSection());

    inner.appendChild(el('p', `account-status${this.bad ? ' bad' : ''}`, this.status));
    const row = el('div', 'start-row');
    const done = button('Done', 'primary-btn');
    done.addEventListener('click', () => this.close());
    const out = button('Sign out', 'ghost-btn');
    out.disabled = this.busy;
    out.addEventListener('click', () =>
      void this.run(async () => {
        await this.account.api.signOut();
        this.friends = null;
        this.status = 'Signed out. Islands on this device are still here.';
        this.bad = false;
      }, 'Could not sign out'),
    );
    row.append(done, out);
    inner.appendChild(row);
  }

  private beginRename(head: HTMLElement, profile: Profile | null): void {
    const input = el('input', 'coop-input account-input');
    input.value = profile?.name ?? '';
    input.maxLength = 16;
    input.setAttribute('aria-label', 'Your name');
    const commit = (): void => {
      const name = input.value.trim();
      if (!profile || name === profile.name) return this.render();
      if (!validName(name)) {
        this.say('A name is 3 to 16 letters, numbers or _ — no spaces.', true);
        return;
      }
      void this.run(async () => {
        const result = await this.account.cloud.setName(name);
        if (result === 'taken') {
          this.status = `Someone is already called ${name}.`;
          this.bad = true;
          return;
        }
        this.account.setProfile({ ...profile, name });
        this.status = '';
      }, 'Could not change your name');
    };
    quiet(input, commit, () => this.render());
    head.innerHTML = '';
    head.appendChild(input);
    const save = button('Save');
    save.addEventListener('click', commit);
    head.appendChild(save);
    input.focus();
    input.select();
  }

  private friendsSection(): HTMLElement {
    const box = el('section', 'account-friends');
    box.appendChild(el('p', 'saves-title', 'Friends'));

    const row = el('div', 'coop-row account-add');
    const input = el('input', 'coop-input account-input');
    input.placeholder = "Friend's name";
    input.setAttribute('aria-label', "Friend's name");
    input.maxLength = 16;
    input.value = this.draft.friend;
    input.addEventListener('input', () => (this.draft.friend = input.value));
    const add = button('Add friend', 'primary-btn');
    add.disabled = this.busy;
    const send = (): void => {
      const name = this.draft.friend.trim();
      if (!name) return;
      void this.run(async () => {
        const result = await this.account.cloud.addFriend(name);
        this.status = FRIEND_RESULTS[result] ?? 'Done.';
        this.bad = result === 'not_found' || result === 'self' || result === 'too_many';
        if (!this.bad) this.draft.friend = '';
        this.friends = await this.account.cloud.friends();
        audio.play(this.bad ? 'denied' : 'click');
      }, 'Could not send the request');
    };
    quiet(input, send, () => this.close());
    add.addEventListener('click', send);
    row.append(input, add);
    box.appendChild(row);

    const f = this.friends;
    if (!f) {
      box.appendChild(el('p', 'coop-blurb', 'Loading…'));
      return box;
    }
    const list = el('div', 'account-list');
    for (const p of f.incoming) {
      list.appendChild(
        this.person(p.name, 'wants to be friends', [
          ['Accept', 'primary-btn small', () => this.account.cloud.answerRequest(p.id, true)],
          ['Decline', 'ghost-btn small', () => this.account.cloud.answerRequest(p.id, false)],
        ]),
      );
    }
    for (const p of f.friends) {
      const armed = this.armedRemove === p.id;
      list.appendChild(
        this.person(p.name, 'friend', [
          [
            armed ? 'Remove?' : 'Remove',
            `ghost-btn small${armed ? ' armed' : ''}`,
            () => {
              if (this.armedRemove !== p.id) {
                this.armedRemove = p.id;
                return Promise.resolve();
              }
              this.armedRemove = null;
              return this.account.cloud.removeFriend(p.id);
            },
          ],
        ]),
      );
    }
    for (const p of f.outgoing) {
      list.appendChild(this.person(p.name, 'asked, waiting', [['Cancel', 'ghost-btn small', () => this.account.cloud.cancelRequest(p.id)]]));
    }
    if (list.childElementCount === 0) {
      box.appendChild(
        el('p', 'coop-blurb', 'No friends yet. Ask a friend for the name they signed up with and add it above.'),
      );
    }
    box.appendChild(list);
    return box;
  }

  private person(name: string, note: string, actions: [string, string, () => Promise<void>][]): HTMLElement {
    const row = el('div', 'account-person');
    const who = el('div', 'account-who');
    who.appendChild(el('b', '', name));
    who.appendChild(el('span', '', note));
    row.appendChild(who);
    for (const [label, className, act] of actions) {
      const b = button(label, className);
      b.disabled = this.busy;
      b.addEventListener('click', () =>
        void this.run(async () => {
          await act();
          this.status = '';
          this.friends = await this.account.cloud.friends();
        }, 'That did not go through'),
      );
      row.appendChild(b);
    }
    return row;
  }
}

/**
 * A question over whatever is on screen, answered by one of `options`. The
 * first option is the primary one and what Enter picks; an outside click or
 * Escape answers null.
 */
export function choose<T extends string>(title: string, text: string, options: [T, string][]): Promise<T | null> {
  return new Promise((resolve) => {
    const root = el('div', 'modal account-ask');
    const inner = el('div', 'modal-inner');
    inner.appendChild(el('h2', '', title));
    inner.appendChild(el('p', 'blurb', text));
    const row = el('div', 'start-row');
    const done = (answer: T | null): void => {
      root.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve(answer);
    };
    const buttons = options.map(([value, label], i) => {
      const b = button(label, i === 0 ? 'primary-btn' : 'ghost-btn');
      b.addEventListener('click', () => done(value));
      row.appendChild(b);
      return b;
    });
    const cancel = button('Cancel', 'ghost-btn');
    cancel.addEventListener('click', () => done(null));
    row.appendChild(cancel);
    inner.appendChild(row);
    root.appendChild(inner);
    document.body.appendChild(root);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.stopPropagation();
      done(e.key === 'Enter' ? options[0][0] : null);
    };
    window.addEventListener('keydown', onKey, true);
    root.addEventListener('click', (e) => {
      if (e.target === root) done(null);
    });
    buttons[0]?.focus();
  });
}
