import type { Account } from '.';
import type { Game } from '../game';
import { findSlot, type SaveSlot } from '../saves';
import type { MainMenu } from '../ui/menu';
import { AccountScreen, ask } from '../ui/account';
import { rememberName } from '../ui/coop';
import type { CloudWorld, WorldAccess } from './cloud';
import { CloudSession, downloadWorld, linkedTo, slotHasData, uploadSlot } from './sync';

/** How often the menu refreshes the account's islands and friends' presence. */
const MENU_POLL_MS = 10_000;

/**
 * Everything accounts add between the main menu and the game: what happens
 * when a card is clicked while signed in, and keeping the menu's lists fresh.
 * It only exists when this build has accounts; without it the menu and game
 * behave exactly as they always have.
 */
export class AccountFlow {
  private worlds: CloudWorld[] | null = null;
  private error = '';
  private screen: AccountScreen;
  /** The session of the island being played, if it is a cloud one. */
  private session: CloudSession | null = null;
  private listing = false;

  constructor(
    private account: Account,
    private menu: MainMenu,
    private game: Game,
  ) {
    this.screen = new AccountScreen(account, () => void this.refresh());
    menu.enableAccounts();
    account.onChange(() => {
      if (!account.signedIn) this.worlds = null;
      const name = account.profile?.name;
      if (name) rememberName(name);
      this.show();
    });
    if (account.signedIn) {
      void account.loadProfile().catch(() => undefined);
      void this.refresh();
    }
    setInterval(() => {
      if (this.menu.isOpen && !document.hidden && this.account.signedIn) void this.refresh();
    }, MENU_POLL_MS);
  }

  openAccount(): void {
    this.screen.open();
  }

  /** Fetch the account's islands and friends' islands for the menu. */
  async refresh(): Promise<void> {
    if (!this.account.signedIn || this.listing) {
      this.show();
      return;
    }
    this.listing = true;
    try {
      this.worlds = await this.account.cloud.listWorlds();
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not reach your account';
    } finally {
      this.listing = false;
      this.show();
    }
  }

  private show(): void {
    this.menu.setCloud({
      userId: this.account.userId,
      name: this.account.profile?.name ?? '',
      worlds: this.worlds,
      error: this.error,
    });
  }

  /** Play a local slot, bringing its account copy into it first when it has one. */
  async play(slot: SaveSlot, peaceful: boolean, force = false): Promise<void> {
    const cloud = this.account.cloud;
    if (!this.account.signedIn || !linkedTo(slot, cloud)) {
      const fresh = this.account.signedIn && !slot.cloud && !slotHasData(slot.id);
      await this.game.enter(slot, peaceful);
      // A new island made while signed in goes to the account from the start.
      if (fresh) await this.adopt(slot);
      return;
    }

    let opened;
    try {
      opened = await CloudSession.open(cloud, slot, this.events(), force);
    } catch (error) {
      // Offline or the server is down: the island is still here to play.
      await this.game.enter(findSlot(slot.id) ?? slot, peaceful);
      this.game.cloudNotice(
        `${error instanceof Error ? error.message : 'Could not reach your account'} — playing the copy on this device`,
        'warn',
      );
      return;
    }

    if (opened.kind === 'missing') {
      this.menu.open(`${slot.name} is no longer in your account. The copy on this device is still here.`);
      return;
    }
    if (opened.kind === 'busy') {
      const seconds = Math.max(1, Math.round(opened.seenSecondsAgo));
      const take = await ask(
        `${slot.name} is open elsewhere`,
        `It is being played on another device (last heard from ${seconds}s ago). Take it over? That device stops and comes back to its menu.`,
        'Take over',
      );
      if (take) await this.play(slot, peaceful, true);
      else this.menu.open();
      return;
    }

    this.session = opened.session;
    await this.game.enter(findSlot(slot.id) ?? slot, peaceful);
    if (!opened.session.alive) return;
    this.game.attachCloud(opened.session, opened.access);
    for (const note of opened.notes) this.game.cloudNotice(note, 'warn');
  }

  /** Put the island just started in the account, then hold it like any cloud island. */
  private async adopt(slot: SaveSlot): Promise<void> {
    try {
      this.game.saveNow();
      const linked = await uploadSlot(this.account.cloud, findSlot(slot.id) ?? slot);
      const opened = await CloudSession.open(this.account.cloud, linked, this.events());
      if (opened.kind !== 'open') return;
      this.session = opened.session;
      this.game.attachCloud(opened.session, opened.access);
    } catch (error) {
      this.game.cloudNotice(
        `Not kept in your account yet (${error instanceof Error ? error.message : 'offline'}) — it is saved on this device`,
        'warn',
      );
    }
  }

  private events() {
    return {
      room: () => this.game.cloudRoom(),
      onLost: () => this.game.cloudLost(),
      onNotice: (text: string, tone: 'good' | 'warn') => this.game.cloudNotice(text, tone),
    };
  }

  async playCloud(world: CloudWorld, peaceful: boolean): Promise<void> {
    try {
      const slot = await downloadWorld(this.account.cloud, world);
      this.menu.close();
      await this.play(slot, peaceful);
    } catch (error) {
      this.menu.open(error instanceof Error ? error.message : 'Could not download that island');
    }
  }

  async upload(slot: SaveSlot): Promise<void> {
    await uploadSlot(this.account.cloud, slot);
    await this.refresh();
  }

  async deleteCloud(world: CloudWorld): Promise<void> {
    await this.account.cloud.deleteWorld(world.id);
    await this.refresh();
  }

  renamed(slot: SaveSlot): void {
    if (!linkedTo(slot, this.account.cloud)) return;
    void this.account.cloud
      .updateWorld(slot.cloud!.id, { name: slot.name })
      .then(() => this.refresh())
      .catch(() => undefined);
  }

  async setAccess(access: WorldAccess): Promise<void> {
    const session = this.session;
    if (!session?.alive) throw new Error('This island is not in your account');
    await this.account.cloud.updateWorld(session.worldId, { access });
    this.game.setCloudAccess(access);
  }

  async joinFriend(world: CloudWorld): Promise<void> {
    if (!world.room) return;
    const name = this.account.profile?.name ?? 'Friend';
    try {
      await this.game.joinGame(world.room, name, `u:${this.account.userId}`);
      this.menu.close();
    } catch (error) {
      this.menu.open(error instanceof Error ? error.message : `Could not join ${world.ownerName}`);
      void this.refresh();
    }
  }
}
