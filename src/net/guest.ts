import { applyOrder, type Command } from '@shared/sim/commands';
import { checksum, decode, encode, restoreSnapshot } from '@shared/sim/snapshot';
import { step } from '@shared/sim/step';
import type { PlayerInput, World } from '@shared/sim/types';
import { Broker, type Signaller } from './broker';
import { Link } from './link';
import { netlog, netlogBegin } from './netlog';
import { RealtimeBroker, realtimeAvailable } from './realtime';
import { BUILD, olderBuild, peerId, type GuestMessage, type HostMessage, type TickMessage } from './protocol';

const JOIN_TIMEOUT_MS = 20_000;
/** How long the host gets to answer a knock on the game's own service before the public broker is tried. */
const KNOCK_WAIT_MS = 6_000;

/** The host answered and said no, so another route would only hear the same. */
class Refused extends Error {}

/** How far one route got, for the message when every route fails. */
type Reach = 'unreachable' | 'no-answer' | 'dropped';
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

  /** Which service carried the signalling, for diagnosing a friend's trouble. */
  route: 'own' | 'public' = 'public';
  /** Whether the host was ever heard from on this attempt. */
  private heard = false;

  private constructor(
    private broker: Signaller,
    private code: string,
    token: string,
    name: string,
  ) {
    this.link = new Link(broker, peerId(code), {
      onOpen: () => {
        netlog('saying hello to the host');
        this.send({ t: 'hello', build: BUILD, token, name });
      },
      onMessage: (text) => {
        this.heard = true;
        this.receive(text);
      },
      onClose: () => this.end(this.arrived ? 'The connection to the host closed while joining.' : 'Lost the connection to the host.'),
    });
  }

  /**
   * Connect to a room and wait until our character is standing on the island.
   * Tries the game's own online service first, when this build has one, then
   * the public broker, so one service having a bad day does not keep friends
   * apart. Only the host saying no, or every route failing, ends the attempt.
   */
  static async join(code: string, name: string, token: string): Promise<CoopGuest> {
    netlogBegin(`Joining ${code}`);
    const tried: [string, Reach][] = [];
    const routes: ('own' | 'public')[] = realtimeAvailable() ? ['own', 'public'] : ['public'];
    for (const route of routes) {
      try {
        return await CoopGuest.attempt(route, code, name, token);
      } catch (error) {
        if (error instanceof Refused) throw error;
        const reach = (error as { reach?: Reach }).reach ?? 'unreachable';
        netlog(`${route === 'own' ? 'online service' : 'public relay'} route failed (${reach}): ${error instanceof Error ? error.message : String(error)}`);
        tried.push([route === 'own' ? 'online service' : 'public relay', reach]);
        // A code nobody holds anywhere is not worth a second route's wait.
        if (error instanceof Error && error.message === NO_ROOM && route === 'public') throw error;
      }
    }
    throw new Error(explain(tried));
  }

  private static async attempt(route: 'own' | 'public', code: string, name: string, token: string): Promise<CoopGuest> {
    netlog(`trying the ${route === 'own' ? 'online service' : 'public relay'}`);
    let guest: CoopGuest | null = null;
    // The broker only matters until we are in; after that its trouble is not ours.
    const fail = (reason: string): void => {
      if (guest?.joining) guest.end(reason);
    };
    // A broker id of our own, unguessable, so nobody else can answer as us.
    // A fresh one per route, so a host that half-heard the first try is not confused.
    const self = `${peerId(code)}-${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
    const events = {
      onRelay: (type: string, _src: string, payload: unknown) => guest?.link.signal(type, payload),
      onFail: fail,
      onExpire: () => fail(NO_ROOM),
    };
    let broker: Signaller;
    if (route === 'own') {
      const own = new RealtimeBroker(self, 'guest', events);
      try {
        await own.open();
      } catch (error) {
        own.close();
        throw reached(error, 'unreachable');
      }
      try {
        await own.knock(peerId(code), KNOCK_WAIT_MS);
      } catch (error) {
        own.close();
        throw reached(error, 'no-answer');
      }
      broker = own;
    } else {
      const peer = new Broker(self, events);
      try {
        await peer.open();
      } catch (error) {
        throw reached(error, 'unreachable');
      }
      broker = peer;
    }
    guest = new CoopGuest(broker, code, token, name);
    guest.route = route;
    // The knock was answered, so the host is there even before it says a word.
    if (route === 'own') guest.heard = true;
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
        reject(error instanceof Refused ? error : reached(error, joined.heard ? 'dropped' : 'no-answer'));
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
    if (this.arrived && message.t !== 'tick') netlog(`host sent ${message.t}${message.t === 'reject' ? `: ${message.reason}` : ''}`);
    switch (message.t) {
      case 'reject':
        // Once only: if even a fresh load is still older (a stale cache in
        // between), a loop of reloads would help nobody.
        if (message.build && olderBuild(BUILD, message.build) && !new URLSearchParams(location.search).has('fresh')) {
          // This page is the out-of-date one: fetch the host's version and come
          // straight back to the same island.
          this.end(message.reason, true);
          reloadInto(this.code);
          return;
        }
        this.end(message.reason, true);
        return;
      case 'bye':
        this.end(message.reason, true);
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
      netlog(`on the island (${this.link.relayed ? 'relayed' : 'direct'})`);
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

  /** `final` when it was the host who said so, which no other route would change. */
  private end(reason: string, final = false): void {
    if (this.ended) return;
    this.ended = true;
    this.link.close();
    this.broker.close();
    if (this.failed) this.failed(final ? new Refused(reason) : new Error(reason));
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

const NO_ROOM = 'No game is open with that code';

function reached(error: unknown, reach: Reach): Error {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  return Object.assign(wrapped, { reach });
}

/** One message for every route failing, worded by the furthest any of them got. */
function explain(tried: [string, Reach][]): string {
  const detail = tried.map(([route, reach]) => `${route}: ${REACH_TEXT[reach]}`).join('; ');
  if (tried.some(([, reach]) => reach === 'dropped')) {
    return `Found the host, but the connection kept dropping before you got in. Try again in a moment. (${detail})`;
  }
  if (tried.every(([, reach]) => reach === 'unreachable')) {
    return `Could not reach the game's online services from this network. Check your connection and try again. (${detail})`;
  }
  return `The host's game did not answer. Check that it is still open, then try again. (${detail})`;
}

const REACH_TEXT: Record<Reach, string> = {
  unreachable: 'could not connect',
  'no-answer': 'host did not answer',
  dropped: 'connection dropped',
};
