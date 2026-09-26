import { cloudConfig } from '../account/config';
import type { BrokerEvents, RelayType, Signaller } from './broker';
import { netlog } from './netlog';

/**
 * Signalling through the game's own Supabase project, as a second route beside
 * the public PeerJS broker. The public broker is shared by every PeerJS app on
 * the internet and nothing about it is ours to fix when it drops messages, so
 * a build with accounts signals here first and keeps the broker as the backup.
 *
 * It uses Realtime Broadcast: a WebSocket speaking the Phoenix channel
 * protocol, where anything pushed to a topic reaches everyone else on it. It
 * stores nothing and touches no table. Each guest gets a topic of its own,
 * named by its unguessable id, and the host joins it on hearing the guest
 * knock on the room's topic, so one friend's traffic never reaches another.
 */

const HEARTBEAT_MS = 20_000;
const JOIN_TIMEOUT_MS = 8_000;
/** How often a guest knocks until the host answers. */
const KNOCK_EVERY_MS = 1_500;
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];
const QUIET_RETRIES = 3;

/** What rides inside a broadcast. `dst` lets a topic carry both directions. */
interface Envelope {
  t: RelayType | 'KNOCK' | 'HI';
  src: string;
  dst: string;
  p?: unknown;
}

interface PhoenixMessage {
  topic: string;
  event: string;
  payload: unknown;
  ref: string | null;
  join_ref?: string | null;
}

/** Whether this build can signal through its own project. `?signal=broker` turns it off, to test the other route. */
export function realtimeAvailable(): boolean {
  try {
    if (new URLSearchParams(location.search).get('signal') === 'broker') return false;
  } catch {
    // Not a page; fall through to the build's config.
  }
  return cloudConfig() !== null;
}

function socketUrl(): string {
  const config = cloudConfig();
  if (!config) throw new Error('This build has no online service');
  const base = config.url.replace(/^http/, 'ws');
  return `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(config.key)}&vsn=1.0.0`;
}

export class RealtimeBroker implements Signaller {
  private socket: WebSocket | null = null;
  private ref = 0;
  /** Topic name to the ref it was joined under, once the server has said yes. */
  private joined = new Map<string, string>();
  /** Topics wanted, including ones not joined yet, so a reconnect rejoins them. */
  private wanted = new Set<string>();
  private replies = new Map<string, (ok: boolean, detail?: string) => void>();
  private heartbeat = 0;
  private retryTimer = 0;
  private retries = 0;
  private closed = false;
  private knocking = new Map<string, () => void>();

  constructor(
    readonly id: string,
    /** A host listens for knocks and joins each guest's topic; a guest writes on its own. */
    private role: 'host' | 'guest',
    private events: BrokerEvents,
  ) {}

  /** Resolves once our own topic is joined, and rejects if the service says no. */
  async open(): Promise<void> {
    await this.connect();
    await this.join(this.id);
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl());
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not reach the online service'));
        return;
      }
      this.socket = socket;
      let opened = false;
      netlog(`${this.tag}: connecting to ${new URL(socketUrl()).host}`);
      socket.onopen = () => {
        opened = true;
        netlog(`${this.tag}: connected`);
        this.retries = 0;
        window.clearInterval(this.heartbeat);
        this.heartbeat = window.setInterval(
          () => this.push({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.nextRef() }),
          HEARTBEAT_MS,
        );
        resolve();
      };
      socket.onmessage = (event) => this.receive(String(event.data));
      socket.onclose = (event) => {
        if (!this.closed) netlog(`${this.tag}: socket closed (code ${event.code}${event.reason ? `, ${event.reason}` : ''})`);
        window.clearInterval(this.heartbeat);
        this.joined.clear();
        for (const reply of this.replies.values()) reply(false);
        this.replies.clear();
        if (this.closed || this.socket !== socket) return;
        this.socket = null;
        if (!opened) reject(new Error('Could not reach the online service'));
        else this.retry();
      };
    });
  }

  private readonly tag = 'online service';

  private retry(): void {
    if (this.closed) return;
    this.retries++;
    netlog(`${this.tag}: reconnecting (try ${this.retries})`);
    if (this.retries === QUIET_RETRIES + 1) this.events.onFail('Lost the online service, still trying');
    const wait = RETRY_MS[Math.min(this.retries - 1, RETRY_MS.length - 1)];
    this.retryTimer = window.setTimeout(() => {
      this.connect()
        .then(() => {
          for (const topic of this.wanted) void this.join(topic).catch(() => undefined);
        })
        .catch(() => this.retry());
    }, wait);
  }

  private nextRef(): string {
    return String(++this.ref);
  }

  /** Join a topic; it stays wanted, so a dropped socket joins it again. */
  private join(name: string): Promise<void> {
    this.wanted.add(name);
    const ref = this.nextRef();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        netlog(`${this.tag}: join ${short(name)} got no reply`);
        this.replies.delete(ref);
        reject(new Error('The online service did not answer'));
      }, JOIN_TIMEOUT_MS);
      this.replies.set(ref, (ok, detail) => {
        window.clearTimeout(timer);
        netlog(`${this.tag}: join ${short(name)} ${ok ? 'ok' : `refused${detail ? `: ${detail}` : ''}`}`);
        if (!ok) {
          reject(new Error('The online service turned the connection away'));
          return;
        }
        this.joined.set(name, ref);
        resolve();
      });
      this.push({
        topic: `realtime:${name}`,
        event: 'phx_join',
        payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, postgres_changes: [], private: false } },
        ref,
        join_ref: ref,
      });
    });
  }

  private receive(raw: string): void {
    let message: PhoenixMessage;
    try {
      message = JSON.parse(raw) as PhoenixMessage;
    } catch {
      return;
    }
    if (message.event === 'phx_reply' && message.ref && this.replies.has(message.ref)) {
      const body = message.payload as { status?: string; response?: unknown } | null;
      const reply = this.replies.get(message.ref)!;
      this.replies.delete(message.ref);
      reply(body?.status === 'ok', body?.status === 'ok' ? undefined : JSON.stringify(body?.response ?? body).slice(0, 200));
      return;
    }
    const topic = message.topic.replace(/^realtime:/, '');
    if (message.event === 'phx_error' || message.event === 'phx_close') {
      // The server dropped us from one topic; ask again unless we meant to leave.
      netlog(`${this.tag}: ${message.event} on ${short(topic)} ${JSON.stringify(message.payload).slice(0, 160)}`);
      this.joined.delete(topic);
      if (!this.closed && this.wanted.has(topic)) {
        window.setTimeout(() => void this.join(topic).catch(() => undefined), 1000);
      }
      return;
    }
    if (message.event === 'system') {
      netlog(`${this.tag}: system ${JSON.stringify(message.payload).slice(0, 160)}`);
      return;
    }
    if (message.event !== 'broadcast') return;
    const envelope = (message.payload as { payload?: Envelope } | null)?.payload;
    if (!envelope || typeof envelope.src !== 'string' || envelope.dst !== this.id) return;
    switch (envelope.t) {
      case 'KNOCK':
        if (this.role !== 'host') return;
        if (!this.joined.has(envelope.src)) netlog(`${this.tag}: knock from ${short(envelope.src)}`);
        // Answer on the guest's topic once it is ours to write on.
        void this.join(envelope.src)
          .then(() => this.write(envelope.src, { t: 'HI', src: this.id, dst: envelope.src }))
          .catch(() => undefined);
        return;
      case 'HI':
        if (this.knocking.has(envelope.src)) netlog(`${this.tag}: host answered the knock`);
        this.knocking.get(envelope.src)?.();
        return;
      case 'OFFER':
      case 'ANSWER':
      case 'CANDIDATE':
      case 'LEAVE':
        this.events.onRelay(envelope.t, envelope.src, envelope.p);
        return;
      default:
        return;
    }
  }

  /**
   * A guest's first step: say we are here until the host answers. Rejects when
   * nobody holds that room here, which may only mean the host is on a build
   * without this route, so the caller tries the public broker next.
   */
  async knock(host: string, wait: number): Promise<void> {
    await this.join(host);
    await new Promise<void>((resolve, reject) => {
      let knocks = 0;
      const send = (): void => {
        if (!this.joined.has(host)) return;
        knocks++;
        this.write(host, { t: 'KNOCK', src: this.id, dst: host });
      };
      send();
      const every = window.setInterval(send, KNOCK_EVERY_MS);
      const give = window.setTimeout(() => {
        netlog(`${this.tag}: no answer after ${knocks} knocks`);
        finish();
        reject(new Error('No answer from the host through the online service'));
      }, wait);
      const finish = (): void => {
        window.clearInterval(every);
        window.clearTimeout(give);
        this.knocking.delete(host);
      };
      this.knocking.set(host, () => {
        finish();
        resolve();
      });
    });
    // Only the knocks went there; everything else rides our own topic.
    this.leave(host);
  }

  private leave(name: string): void {
    this.wanted.delete(name);
    const ref = this.joined.get(name);
    this.joined.delete(name);
    if (ref) this.push({ topic: `realtime:${name}`, event: 'phx_leave', payload: {}, ref: this.nextRef(), join_ref: ref });
  }

  relay(type: RelayType, dst: string, payload: unknown): void {
    this.write(this.role === 'host' ? dst : this.id, { t: type, src: this.id, dst, p: payload });
  }

  /** A guest's topic the host no longer needs, once that guest has gone. */
  forget(peer: string): void {
    if (this.role === 'host' && peer !== this.id) this.leave(peer);
  }

  private write(topic: string, envelope: Envelope): void {
    const ref = this.joined.get(topic);
    if (!ref) return;
    this.push({
      topic: `realtime:${topic}`,
      event: 'broadcast',
      payload: { type: 'broadcast', event: 'ccgame', payload: envelope },
      ref: this.nextRef(),
      join_ref: ref,
    });
  }

  private push(message: PhoenixMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.heartbeat);
    window.clearTimeout(this.retryTimer);
    for (const topic of [...this.joined.keys()]) this.leave(topic);
    this.socket?.close();
    this.socket = null;
  }
}

/** Ids are long and alike; their tail is enough to tell them apart in the log. */
function short(id: string): string {
  return id.length > 18 ? `…${id.slice(-8)}` : id;
}
