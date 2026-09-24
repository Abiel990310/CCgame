/**
 * Signalling through a public PeerJS broker.
 *
 * Two browsers cannot open a WebRTC channel until they have swapped an offer,
 * an answer and some network candidates, and something both can reach has to
 * carry those. The broker is that something: a WebSocket relay that forwards
 * a message to whoever registered under the `dst` id. It never sees gameplay;
 * once the channel is open, the game talks browser to browser.
 *
 * This speaks the PeerJS server's wire protocol directly rather than pulling
 * in the PeerJS client, so the page keeps its zero runtime dependencies, and
 * nothing is fetched at all until someone hosts or joins.
 */

const DEFAULT_BROKER = 'wss://0.peerjs.com:443/peerjs?key=peerjs';
const HEARTBEAT_MS = 5000;

/** The relay types the PeerJS server forwards to `dst`. Anything else it drops. */
export type RelayType = 'OFFER' | 'ANSWER' | 'CANDIDATE' | 'LEAVE';

export interface BrokerEvents {
  onRelay: (type: RelayType, src: string, payload: unknown) => void;
  /** The broker has been unreachable for a while; it keeps trying. */
  onFail: (reason: string) => void;
  /** A message we sent was never collected: nobody holds that id. */
  onExpire?: () => void;
}

/**
 * Where to signal through. `?broker=ws://…` overrides the public one, for a
 * self-hosted PeerJS server or for testing offline.
 */
function brokerUrl(): string {
  const override = new URLSearchParams(location.search).get('broker');
  return override ?? DEFAULT_BROKER;
}

/** Waits between reconnection attempts, then the last one repeats. */
const RETRY_MS = [1000, 2000, 4000, 8000, 15000];
/** Attempts that may fail quietly before anyone is told. */
const QUIET_RETRIES = 3;

export class Broker {
  private socket: WebSocket | null = null;
  private heartbeat = 0;
  private retryTimer = 0;
  private retries = 0;
  private closed = false;
  /**
   * Kept for the life of the id: the broker hands an id back to whoever shows
   * the same token, which is what lets a dropped socket reconnect as itself.
   */
  private readonly token = Math.random().toString(36).slice(2, 12);

  constructor(
    readonly id: string,
    private events: BrokerEvents,
  ) {}

  /** Resolves once the broker has accepted our id. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => this.connect(resolve, reject));
  }

  /**
   * One socket. Before the first OPEN a failure rejects; after it, a dropped
   * socket reconnects on its own. Hosted brokers drop idle-looking sockets,
   * and a tab in the background sends its heartbeat late enough to look idle.
   */
  private connect(resolve?: () => void, reject?: (error: Error) => void): void {
    const first = resolve !== undefined;
    const url = `${brokerUrl()}&id=${encodeURIComponent(this.id)}&token=${this.token}&version=1.5.4`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      if (first) reject?.(new Error('Could not reach the matchmaking service'));
      else this.retry();
      return;
    }
    this.socket = socket;
    let opened = false;

    socket.onmessage = (event) => {
      let message: { type?: string; src?: string; payload?: unknown };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      switch (message.type) {
        case 'OPEN':
          opened = true;
          this.retries = 0;
          window.clearInterval(this.heartbeat);
          this.heartbeat = window.setInterval(() => this.send({ type: 'HEARTBEAT' }), HEARTBEAT_MS);
          resolve?.();
          break;
        case 'ID-TAKEN':
          if (first) {
            reject?.(new Error('That room code is already in use'));
            this.close();
          }
          break;
        case 'ERROR':
          if (first && !opened) reject?.(new Error('The matchmaking service refused the connection'));
          break;
        case 'EXPIRE':
          // Sent back when a message's `dst` never showed up to collect it.
          this.events.onExpire?.();
          break;
        case 'OFFER':
        case 'ANSWER':
        case 'CANDIDATE':
        case 'LEAVE':
          if (message.src) this.events.onRelay(message.type, message.src, message.payload);
          break;
        default:
          break;
      }
    };
    socket.onclose = () => {
      window.clearInterval(this.heartbeat);
      if (this.closed || this.socket !== socket) return;
      this.socket = null;
      if (first && !opened) reject?.(new Error('Could not reach the matchmaking service'));
      else this.retry();
    };
  }

  private retry(): void {
    if (this.closed) return;
    this.retries++;
    if (this.retries === QUIET_RETRIES + 1) this.events.onFail('Lost the matchmaking service, still trying');
    const wait = RETRY_MS[Math.min(this.retries - 1, RETRY_MS.length - 1)];
    this.retryTimer = window.setTimeout(() => this.connect(), wait);
  }

  relay(type: RelayType, dst: string, payload: unknown): void {
    this.send({ type, dst, payload });
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.heartbeat);
    window.clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
  }
}
