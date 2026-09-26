import { applyOrder, isHostOnly, type Order } from '@shared/sim/commands';
import { bagSlots } from '@shared/sim/inventory';
import { normalizeSlots } from '@shared/sim/slots';
import { checksum, decode, encode, takeSnapshot } from '@shared/sim/snapshot';
import type { Player, PlayerInput, World } from '@shared/sim/types';
import { createPlayer, spawnPoint } from '@shared/sim/world';
import { Broker, type RelayType, type Signaller } from './broker';
import type { GuestBook } from './guests';
import { Link } from './link';
import { RealtimeBroker, realtimeAvailable } from './realtime';
import {
  BUILD,
  CHECK_EVERY,
  olderBuild,
  MAX_GUESTS,
  makeCode,
  peerId,
  type GuestMessage,
  type HostMessage,
  type TickMessage,
} from './protocol';

export interface HostEvents {
  /** Someone arrived or left; the names are everyone now on the island. */
  onRoster: (names: string[], news: string) => void;
  /** The broker went away. Friends already connected stay connected. */
  onTrouble: (reason: string) => void;
  /** Something the host should do, such as reload for a friend on a newer version. */
  onNotice?: (text: string) => void;
}

interface Guest {
  link: Link;
  token: string;
  name: string;
  /** Their character's id once they are on the island. */
  playerId: number | null;
  /** True once they hold a snapshot, so ticks mean something to them. */
  ready: boolean;
  input: PlayerInput;
  /** A dash pressed between two ticks still happens, even if released first. */
  dash: boolean;
  resync: boolean;
}

/** A route that has not opened by then counts as down. */
const OPEN_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Timed out reaching the matchmaking service')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const STILL: PlayerInput = { move: { x: 0, y: 0 }, dash: false, interact: false };

/**
 * The host's side of co-op. The host's world is the real one: guests send what
 * they press and what they click, the host applies it between ticks, and after
 * every tick it tells every guest exactly what went in, so their copies take
 * the same step. Nothing a guest says is trusted beyond "this is what I
 * pressed": the host decides which player it acts for, and every order is
 * checked by `applyOrder` before it touches the island.
 */
export class CoopHost {
  private guests = new Map<string, Guest>();
  /** Orders applied since the last tick, owed to every guest with the next one. */
  private pending: Order[] = [];
  /** Orders guests have sent, waiting for the next tick boundary. */
  private inbox: Order[] = [];
  private joining: Guest[] = [];
  private leaving: Guest[] = [];
  /** Characters on the island that belong to a friend rather than the host. */
  private guestIds = new Set<number>();

  private constructor(
    /** Every route a guest may arrive by; each guest's link stays on the one it came in on. */
    private brokers: Signaller[],
    readonly code: string,
    private book: GuestBook,
    private events: HostEvents,
  ) {}

  /**
   * Register a fresh room code on every route there is: the game's own online
   * service when this build has one, and the public broker. Either alone is
   * enough to open the room; friends try the first, then the second.
   */
  static async open(book: GuestBook, events: HostEvents): Promise<CoopHost> {
    let host: CoopHost | null = null;
    const onRelay = (broker: Signaller) => (type: RelayType, src: string, payload: unknown) =>
      host?.relay(broker, type, src, payload);
    const onFail = (reason: string): void => host?.events.onTrouble(reason);

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = makeCode();
      const peer: Broker = new Broker(peerId(code), { onRelay: (...args) => onRelay(peer)(...args), onFail });
      const own: RealtimeBroker | null = realtimeAvailable()
        ? new RealtimeBroker(peerId(code), 'host', { onRelay: (...args) => onRelay(own!)(...args), onFail })
        : null;
      // Both at once: a route that is slow to fail must not hold up the other.
      const [peerOpen, ownOpen] = await Promise.allSettled([
        withTimeout(peer.open(), OPEN_TIMEOUT_MS),
        own ? withTimeout(own.open(), OPEN_TIMEOUT_MS) : Promise.reject(new Error('no online service')),
      ]);
      const taken = peerOpen.status === 'rejected' && peerOpen.reason instanceof Error && peerOpen.reason.message.includes('in use');
      if (taken) {
        peer.close();
        own?.close();
        lastError = peerOpen.reason;
        continue;
      }
      const brokers: Signaller[] = [];
      if (own && ownOpen.status === 'fulfilled') brokers.push(own);
      else own?.close();
      if (peerOpen.status === 'fulfilled') brokers.push(peer);
      else {
        peer.close();
        lastError = peerOpen.reason;
      }
      if (brokers.length === 0) break;
      host = new CoopHost(brokers, code, book, events);
      return host;
    }
    throw lastError instanceof Error ? lastError : new Error('Could not open a room');
  }

  get guestCount(): number {
    let n = 0;
    for (const guest of this.guests.values()) if (guest.playerId !== null) n++;
    return n;
  }

  /** Whether a character is a friend's, and so no part of the host's own save. */
  isGuest(id: number): boolean {
    return this.guestIds.has(id);
  }

  names(world: World): string[] {
    return [...world.players.values()].map((p) => p.name);
  }

  private relay(broker: Signaller, type: string, src: string, payload: unknown): void {
    let guest = this.guests.get(src);
    // A guest arrives with an offer, or, when it goes straight to the relay,
    // with the request to use it.
    const starts = type === 'OFFER' || (typeof payload === 'object' && payload !== null && (payload as { relay?: string }).relay === 'start');
    if (!guest && starts) {
      guest = this.greet(broker, src);
    }
    guest?.link.signal(type, payload);
  }

  private greet(broker: Signaller, src: string): Guest {
    const guest: Guest = {
      token: '',
      name: 'Friend',
      playerId: null,
      ready: false,
      input: STILL,
      dash: false,
      resync: false,
      link: new Link(broker, src, {
        onOpen: () => {},
        onMessage: (text) => this.receive(guest, text),
        onClose: () => this.drop(guest),
      }),
    };
    this.guests.set(src, guest);
    return guest;
  }

  private receive(guest: Guest, text: string): void {
    let message: GuestMessage;
    try {
      message = decode<GuestMessage>(text);
    } catch {
      return;
    }
    switch (message.t) {
      case 'hello': {
        if (guest.token) return;
        if (message.build !== BUILD) {
          const guestNewer = olderBuild(BUILD, String(message.build));
          // A guest on the older build reloads itself and comes straight back;
          // a host on the older one has to reload, which only they can do.
          this.refuse(
            guest,
            guestNewer
              ? "Your friend's game is an older version. Ask them to reload their page (their island saves first), then join again."
              : 'Updating to the same version as your friend…',
            BUILD,
          );
          if (guestNewer) this.events.onNotice?.(`${tidyName(message.name)} is on a newer version. Save, quit and reload the page to let them in.`);
          return;
        }
        const token = String(message.token).slice(0, 64);
        const twin = [...this.guests.values()].find((g) => g !== guest && g.token === token);
        // A twin still joining is this same friend's earlier try on another
        // route, which never heard back; the new one replaces it.
        if (twin && twin.playerId === null) twin.link.close();
        else if (twin) {
          this.refuse(guest, 'You are already on this island in another tab.');
          return;
        }
        if (this.guestCount + this.joining.length >= MAX_GUESTS) {
          this.refuse(guest, `This island is full: a host and ${MAX_GUESTS} friends.`);
          return;
        }
        guest.token = token;
        guest.name = tidyName(message.name);
        this.joining.push(guest);
        break;
      }
      case 'input': {
        const input = message.input;
        if (!isInput(input)) return;
        guest.input = { move: { x: clampUnit(input.move.x), y: clampUnit(input.move.y) }, dash: input.dash, interact: input.interact };
        if (input.dash) guest.dash = true;
        break;
      }
      case 'cmd':
        if (guest.playerId === null || typeof message.c !== 'object' || message.c === null) return;
        if (isHostOnly(message.c)) return;
        this.inbox.push({ p: guest.playerId, c: message.c });
        break;
      case 'resync':
        guest.resync = true;
        break;
      default:
        break;
    }
  }

  private refuse(guest: Guest, reason: string, build?: string): void {
    this.send(guest, build ? { t: 'reject', reason, build } : { t: 'reject', reason });
    // Give the refusal a moment to arrive before the channel goes.
    window.setTimeout(() => guest.link.close(), 500);
  }

  private drop(guest: Guest): void {
    this.guests.delete(guest.link.remote);
    this.joining = this.joining.filter((g) => g !== guest);
    if (guest.playerId !== null) this.leaving.push(guest);
  }

  private send(guest: Guest, message: HostMessage): void {
    guest.link.send(encode(message));
  }

  /** Apply an order to the host's world and owe it to every guest. */
  apply(world: World, order: Order): ReturnType<typeof applyOrder> {
    const result = applyOrder(world, order);
    this.pending.push(order);
    return result;
  }

  /** Everything guests asked for since the last tick, applied now, before it. */
  beforeStep(world: World): void {
    for (const guest of this.leaving) {
      const player = guest.playerId === null ? undefined : world.players.get(guest.playerId);
      if (player) this.book.put(guest.token, player);
      if (guest.playerId !== null) {
        this.apply(world, { p: guest.playerId, c: { k: 'leave' } });
        this.guestIds.delete(guest.playerId);
      }
      this.events.onRoster(this.names(world), `${guest.name} left`);
    }
    this.leaving = [];
    for (const order of this.inbox) this.apply(world, order);
    this.inbox = [];
  }

  /** The host's own input plus the latest from each guest. */
  inputs(world: World, own: Map<number, PlayerInput>): Map<number, PlayerInput> {
    const inputs = new Map(own);
    for (const guest of this.guests.values()) {
      if (guest.playerId === null || !world.players.has(guest.playerId)) continue;
      inputs.set(guest.playerId, guest.dash ? { ...guest.input, dash: true } : guest.input);
      guest.dash = false;
    }
    return inputs;
  }

  /**
   * Tell every guest what went into the tick just stepped, then bring in
   * anyone waiting. A newcomer's snapshot is taken here, between ticks, with
   * nothing pending, so it is exactly the world the next tick message follows.
   */
  afterStep(world: World, inputs: Map<number, PlayerInput>): void {
    const tick: TickMessage = { t: 'tick', n: world.tick, o: this.pending, i: [...inputs] };
    if (world.tick % CHECK_EVERY === 0) tick.h = checksum(world);
    this.pending = [];

    const text = encode(tick);
    let snapshot: string | null = null;
    const snap = (): string => (snapshot ??= encode({ t: 'snapshot', snap: takeSnapshot(world) }));

    for (const guest of this.guests.values()) {
      if (!guest.ready) continue;
      if (guest.resync) {
        guest.resync = false;
        guest.link.send(snap());
      } else guest.link.send(text);
    }

    for (const guest of this.joining) {
      if (!guest.link.open) continue;
      guest.link.send(snap());
      guest.ready = true;
      const player = this.characterFor(world, guest);
      this.apply(world, { p: player.id, c: { k: 'join', player } });
      guest.playerId = player.id;
      this.guestIds.add(player.id);
      this.send(guest, { t: 'welcome', id: player.id });
      this.events.onRoster(this.names(world), `${guest.name} joined`);
    }
    this.joining = [];
  }

  /** The friend's character as they left it, or a new one at the campfire. */
  private characterFor(world: World, guest: Guest): Player {
    const fresh = createPlayer(world.nextId, guest.name, spawnPoint(world));
    const kept = this.book.get(guest.token);
    if (!kept || world.players.has(kept.id)) return fresh;
    // Fields added since they last played take their defaults, and a bag from
    // before a size change is fitted to today's grid.
    const player: Player = { ...fresh, ...kept, name: guest.name, pos: fresh.pos, vel: { x: 0, y: 0 } };
    player.inventory = normalizeSlots(kept.inventory, bagSlots(player));
    player.gatherNodeId = null;
    player.gatherProgress = 0;
    return player;
  }

  /** Write every friend's character to the book, so a crash costs them little. */
  keep(world: World): void {
    for (const guest of this.guests.values()) {
      const player = guest.playerId === null ? undefined : world.players.get(guest.playerId);
      if (player) this.book.put(guest.token, player);
    }
  }

  /** End the room: keep everyone's characters, tell them, and let them go. */
  close(world: World, reason: string): void {
    this.keep(world);
    for (const guest of this.guests.values()) {
      this.send(guest, { t: 'bye', reason });
      guest.link.close();
    }
    this.guests.clear();
    for (const broker of this.brokers) broker.close();
    // Their characters leave with them, or they would linger in a solo game.
    for (const id of this.guestIds) world.players.delete(id);
    this.guestIds.clear();
  }
}

function tidyName(raw: unknown): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name || 'Friend';
}

function clampUnit(n: number): number {
  return Math.max(-1, Math.min(1, n));
}

function isInput(value: unknown): value is PlayerInput {
  if (typeof value !== 'object' || value === null) return false;
  const input = value as PlayerInput;
  return (
    typeof input.move === 'object' &&
    input.move !== null &&
    Number.isFinite(input.move.x) &&
    Number.isFinite(input.move.y) &&
    typeof input.dash === 'boolean' &&
    typeof input.interact === 'boolean'
  );
}
