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
  /** The broker refused us or the socket went away. */
  onFail: (reason: string) => void;
}

/**
 * Where to signal through. `?broker=ws://…` overrides the public one, for a
 * self-hosted PeerJS server or for testing offline.
 */
function brokerUrl(): string {
  const override = new URLSearchParams(location.search).get('broker');
  return override ?? DEFAULT_BROKER;
}

export class Broker {
  private socket: WebSocket | null = null;
  private heartbeat = 0;
  private closed = false;

  constructor(
    readonly id: string,
    private events: BrokerEvents,
  ) {}

  /** Resolves once the broker has accepted our id. */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = Math.random().toString(36).slice(2, 12);
      const url = `${brokerUrl()}&id=${encodeURIComponent(this.id)}&token=${token}&version=1.5.4`;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        reject(new Error('Could not reach the matchmaking service'));
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
            this.heartbeat = window.setInterval(() => this.send({ type: 'HEARTBEAT' }), HEARTBEAT_MS);
            resolve();
            break;
          case 'ID-TAKEN':
            reject(new Error('That room code is already in use'));
            this.close();
            break;
          case 'ERROR':
            if (!opened) reject(new Error('The matchmaking service refused the connection'));
            else this.events.onFail('The matchmaking service reported an error');
            break;
          case 'EXPIRE':
            // Sent back when a message's `dst` never showed up to collect it.
            this.events.onFail('No game is open with that code');
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
      socket.onerror = () => {
        if (!opened) reject(new Error('Could not reach the matchmaking service'));
      };
      socket.onclose = () => {
        window.clearInterval(this.heartbeat);
        if (!opened) reject(new Error('Could not reach the matchmaking service'));
        else if (!this.closed) this.events.onFail('Lost the matchmaking service');
      };
    });
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
    this.socket?.close();
    this.socket = null;
  }
}
