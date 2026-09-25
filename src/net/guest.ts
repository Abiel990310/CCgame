import { applyOrder, type Command } from '@shared/sim/commands';
import { checksum, decode, encode, restoreSnapshot } from '@shared/sim/snapshot';
import { step } from '@shared/sim/step';
import type { PlayerInput, World } from '@shared/sim/types';
import { Broker } from './broker';
import { Link } from './link';
import { BUILD, olderBuild, peerId, type GuestMessage, type HostMessage, type TickMessage } from './protocol';

const JOIN_TIMEOUT_MS = 20_000;
/** Resend an unchanged input this often, so a lost-and-found host still hears it. */
const INPUT_REFRESH_MS = 250;

export interface GuestEvents {
  /** The game ended for us: the host left, dropped, or turned us away. */
  onEnd: (reason: string) => void;
}

/**
 * A guest's side of co-op. It holds a copy of the host's world and moves it
 * forward only on the host's say-so: each tick message carries the orders and
 * inputs the host used, and applying them to the same world with the same code
 * lands on the same state. What the player does here goes to the host and
 * comes back in a later tick, the same as everyone else's.
 */
export class CoopGuest {
  world: World | null = null;
  selfId: number | null = null;
  private queue: TickMessage[] = [];
  private link: Link;
  private ended = false;
  private resyncing = false;
  private arrived: (() => void) | null = null;
  private failed: ((error: Error) => void) | null = null;
  /** Times this copy has had to be replaced; anything above zero in normal play is a determinism bug. */
  resyncs = 0;
  private lastInput = '';
  private lastInputAt = 0;
  onEnd: GuestEvents['onEnd'] = () => {};

  private constructor(
    private broker: Broker,
    private code: string,
    token: string,
    name: string,
  ) {
    this.link = new Link(broker, peerId(code), {
      onOpen: () => this.send({ t: 'hello', build: BUILD, token, name }),
      onMessage: (text) => this.receive(text),
      onClose: () =>
        this.end(
          this.arrived
            ? 'Could not connect to the host. Their network or yours may not allow a direct connection.'
            : 'Lost the connection to the host.',
        ),
    });
  }

  /** Connect to a room and wait until our character is standing on the island. */
  static async join(code: string, name: string, token: string): Promise<CoopGuest> {
    let guest: CoopGuest | null = null;
    // The broker only matters until we are in; after that its trouble is not ours.
    const fail = (reason: string): void => {
      if (guest?.joining) guest.end(reason);
    };
    // A broker id of our own, unguessable, so nobody else can answer as us.
    const self = `${peerId(code)}-${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
    const broker = new Broker(self, {
      onRelay: (type, _src, payload) => guest?.link.signal(type, payload),
      onFail: fail,
      onExpire: () => fail('No game is open with that code'),
    });
    await broker.open();
    guest = new CoopGuest(broker, code, token, name);
    const joined = guest;

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => joined.end('The host did not answer. Check the code, and that their game is still open.'),
        JOIN_TIMEOUT_MS,
      );
      joined.arrived = () => {
        window.clearTimeout(timer);
        resolve();
      };
      joined.failed = (error) => {
        window.clearTimeout(timer);
        reject(error);
      };
      joined.link.call().catch(() => joined.end('Could not start a connection.'));
    });
    return joined;
  }

  private send(message: GuestMessage): void {
    this.link.send(encode(message));
  }

  private receive(text: string): void {
    let message: HostMessage;
    try {
      message = decode<HostMessage>(text);
    } catch {
      return;
    }
    switch (message.t) {
      case 'reject':
        // Once only: if even a fresh load is still older (a stale cache in
        // between), a loop of reloads would help nobody.
        if (message.build && olderBuild(BUILD, message.build) && !new URLSearchParams(location.search).has('fresh')) {
          // This page is the out-of-date one: fetch the host's version and come
          // straight back to the same island.
          this.end(message.reason);
          reloadInto(this.code);
          return;
        }
        this.end(message.reason);
        return;
      case 'bye':
        this.end(message.reason);
        return;
      case 'snapshot': {
        const world = restoreSnapshot(message.snap);
        this.world = world;
        this.queue = this.queue.filter((tick) => tick.n > world.tick);
        this.resyncing = false;
        break;
      }
      case 'welcome':
        this.selfId = message.id;
        break;
      case 'tick':
        this.queue.push(message);
        break;
      default:
        return;
    }
    this.tryArrive();
  }

  /**
   * Until our character exists the game has no one to follow, so ticks are
   * applied here, straight away, until the one carrying our arrival has run.
   */
  private tryArrive(): void {
    if (!this.arrived || !this.world || this.selfId === null) return;
    while (!this.world.players.has(this.selfId) && this.queue.length > 0) {
      this.advance(() => {
        if (this.world) this.world.events.length = 0;
      });
    }
    if (this.world.players.has(this.selfId)) {
      const arrived = this.arrived;
      this.arrived = null;
      this.failed = null;
      // Once a direct channel is open the game runs browser to browser, and
      // keeping the broker would only let its hiccups end a game that no longer
      // needs it. A relayed game runs through the broker, so it stays.
      if (!this.link.relayed) this.broker.close();
      arrived();
    }
  }

  /** True until our character is on the island. */
  get joining(): boolean {
    return this.arrived !== null;
  }

  /** Ticks received and not yet played. */
  get backlog(): number {
    return this.queue.length;
  }

  /**
   * Play the next tick. `flush` runs after the orders and again after the
   * step, because `step` clears the event buffer the orders wrote into.
   */
  advance(flush: () => void): boolean {
    const world = this.world;
    const tick = this.queue.shift();
    if (!world || !tick) return false;
    if (tick.n <= world.tick) return true;
    if (tick.n !== world.tick + 1) {
      // A gap means this copy can no longer be trusted; wait for a fresh one.
      this.requestResync();
      return false;
    }
    for (const order of tick.o) applyOrder(world, order);
    flush();
    step(world, new Map(tick.i));
    flush();
    if (tick.h !== undefined && checksum(world) !== tick.h) this.requestResync();
    return true;
  }

  private requestResync(): void {
    if (this.resyncing) return;
    this.resyncing = true;
    this.resyncs++;
    this.send({ t: 'resync' });
  }

  /** Tell the host what is held down. Only changes are sent, plus a heartbeat. */
  sendInput(input: PlayerInput): void {
    const key = encode(input);
    const now = performance.now();
    if (key === this.lastInput && now - this.lastInputAt < INPUT_REFRESH_MS && !input.dash) return;
    this.lastInput = key;
    this.lastInputAt = now;
    this.send({ t: 'input', input });
  }

  command(c: Command): void {
    this.send({ t: 'cmd', c });
  }

  leave(): void {
    this.ended = true;
    this.link.close();
    this.broker.close();
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.link.close();
    this.broker.close();
    if (this.failed) this.failed(new Error(reason));
    else this.onEnd(reason);
  }
}

/** Reload onto the newest build, landing back on the join screen for this code. */
function reloadInto(code: string): void {
  const url = new URL(location.href);
  url.searchParams.set('join', code);
  // A new query string also skips a cached copy of the page, which GitHub
  // Pages lets browsers keep for ten minutes.
  url.searchParams.set('fresh', Date.now().toString(36));
  location.replace(url.toString());
}
