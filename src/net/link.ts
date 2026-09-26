import type { Signaller } from './broker';

/**
 * STUN lets two browsers behind home routers find the addresses to reach each
 * other by. Some pairs of networks never let traffic through directly (many
 * mobile carriers, strict offices and school networks, some routers), and
 * there is no TURN server to fall back on, so a link that has not opened
 * directly in time carries on through the broker instead; see `relay`.
 */
const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

/**
 * Chrome will not deliver a data channel message much over 256 KiB, and an
 * island snapshot can be bigger than that, so long messages go in pieces.
 */
const CHUNK = 60_000;
/** Give up entirely if neither a direct channel nor the relay is up by then. */
const CONNECT_TIMEOUT_MS = 20_000;
/** How long the direct channel gets before the caller switches to the relay. */
export const DIRECT_WAIT_MS = 6_000;
/**
 * Through the relay nothing tells us the other end has gone, so silence does:
 * a host sends ticks 30 times a second and a guest its input four times.
 */
const RELAY_SILENCE_MS = 12_000;
/**
 * Relayed messages wait this long and go out together. Thirty ticks a second
 * as thirty separate messages is what gets a client throttled by a shared
 * service; ten bundles a second costs a little latency and stays well inside it.
 */
const RELAY_BATCH_MS = 100;

/**
 * Tests and diagnosis: `?relay=1` skips the direct channel, so the relay path
 * can be driven on one machine where a direct channel would always open.
 */
function forceRelay(): boolean {
  try {
    return new URLSearchParams(location.search).get('relay') === '1';
  } catch {
    return false;
  }
}

/** A relayed game message rides a candidate, the one type the broker forwards freely. */
interface RelayPayload {
  /** `start` asks the other end to switch to the relay; `m` is a framed message, `b` several. */
  relay: 'start' | 'm' | 'b';
  data?: string | string[];
}

function isRelay(payload: unknown): payload is RelayPayload {
  return typeof payload === 'object' && payload !== null && 'relay' in payload;
}

export interface LinkEvents {
  onOpen: () => void;
  onMessage: (text: string) => void;
  onClose: () => void;
}

/**
 * One reliable, ordered channel to one other browser: a WebRTC data channel
 * when the two networks allow one, otherwise the broker relaying each message.
 * The relay is slower and leans on a public service, but a game that plays a
 * little laggy beats one that cannot start.
 */
export class Link {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private partial = '';
  private closed = false;
  private timer = 0;
  private fallbackTimer = 0;
  /** True once messages go through the broker rather than a data channel. */
  relayed = false;
  private relayOpen = false;
  private lastHeard = 0;
  private watchdog = 0;
  private outbox: string[] = [];
  private flushTimer = 0;

  constructor(
    private broker: Signaller,
    /** The broker id at the other end. */
    readonly remote: string,
    private events: LinkEvents,
  ) {
    try {
      const pc = new RTCPeerConnection(ICE);
      pc.onicecandidate = (event) => {
        if (event.candidate) this.broker.relay('CANDIDATE', remote, { candidate: event.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        // A direct attempt that fails is not the end: the relay may still carry us.
        if (state === 'failed' && !this.relayed && this.caller) this.startRelay();
        else if ((state === 'failed' || state === 'closed') && !this.relayed) this.close();
      };
      pc.ondatachannel = (event) => this.attach(event.channel);
      this.pc = pc;
    } catch {
      // No WebRTC here at all (disabled, or a locked-down browser): relay only.
      this.pc = null;
    }
    this.timer = window.setTimeout(() => {
      if (!this.open) this.close();
    }, CONNECT_TIMEOUT_MS);
  }

  /** Set on the joining side, which is the one that decides to fall back. */
  private caller = false;

  /** The joining side opens the channel and makes the offer. */
  async call(): Promise<void> {
    this.caller = true;
    const pc = this.pc;
    if (!pc || forceRelay()) {
      this.startRelay();
      return;
    }
    this.fallbackTimer = window.setTimeout(() => {
      if (!this.open) this.startRelay();
    }, DIRECT_WAIT_MS);
    this.attach(pc.createDataChannel('ccgame', { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.broker.relay('OFFER', this.remote, { sdp: pc.localDescription?.toJSON() });
  }

  /**
   * Give up on the direct channel and carry everything through the broker.
   * Only the caller starts this; the other end follows when the request lands.
   */
  private startRelay(): void {
    if (this.relayed || this.closed) return;
    this.relayed = true;
    window.clearTimeout(this.fallbackTimer);
    this.broker.relay('CANDIDATE', this.remote, { relay: 'start' } satisfies RelayPayload);
    this.becomeRelayed();
  }

  private becomeRelayed(): void {
    this.relayed = true;
    // Whatever direct attempt is still going would only race the relay.
    this.channel?.close();
    this.channel = null;
    this.pc?.close();
    this.pc = null;
    if (this.relayOpen) return;
    this.relayOpen = true;
    this.lastHeard = performance.now();
    this.watchdog = window.setInterval(() => {
      if (performance.now() - this.lastHeard > RELAY_SILENCE_MS) this.close();
    }, 1000);
    window.clearTimeout(this.timer);
    this.events.onOpen();
  }

  /**
   * Whatever the broker carried in from the other end. Handled strictly in
   * arrival order: a candidate added before the offer has finished applying is
   * rejected, and would be lost.
   */
  signal(type: string, payload: unknown): void {
    if (isRelay(payload)) {
      // Relayed messages must not wait behind a slow description being applied.
      this.receiveRelayed(payload);
      return;
    }
    this.signals = this.signals.then(() => this.handle(type, payload));
  }

  private receiveRelayed(payload: RelayPayload): void {
    if (this.closed) return;
    if (payload.relay === 'start') {
      this.becomeRelayed();
      return;
    }
    if (!this.relayed) this.becomeRelayed();
    this.lastHeard = performance.now();
    if (typeof payload.data === 'string') this.deliver(payload.data);
    else if (Array.isArray(payload.data)) {
      for (const item of payload.data) if (typeof item === 'string') this.deliver(item);
    }
  }

  private signals: Promise<void> = Promise.resolve();

  private async handle(type: string, payload: unknown): Promise<void> {
    const data = payload as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    if (type === 'LEAVE') {
      this.close();
      return;
    }
    const pc = this.pc;
    if (!pc || this.relayed) return;
    try {
      if (type === 'OFFER' && data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.broker.relay('ANSWER', this.remote, { sdp: pc.localDescription?.toJSON() });
      } else if (type === 'ANSWER' && data.sdp) {
        await pc.setRemoteDescription(data.sdp);
      } else if (type === 'CANDIDATE' && data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch {
      // A candidate that arrives for a connection already given up on is noise.
    }
  }

  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => {
      // The relay won the race; a late direct channel is not wanted.
      if (this.relayed) {
        channel.close();
        return;
      }
      window.clearTimeout(this.timer);
      window.clearTimeout(this.fallbackTimer);
      this.events.onOpen();
    };
    channel.onclose = () => {
      if (!this.relayed) this.close();
    };
    channel.onmessage = (event) => this.deliver(String(event.data));
  }

  /** One character of framing: whole, a piece to come, or the last piece. */
  private deliver(text: string): void {
    const tag = text[0];
    const body = text.slice(1);
    if (tag === 'W') this.events.onMessage(body);
    else if (tag === 'P') this.partial += body;
    else if (tag === 'E') {
      const whole = this.partial + body;
      this.partial = '';
      this.events.onMessage(whole);
    }
  }

  get open(): boolean {
    if (this.closed) return false;
    return this.relayed ? this.relayOpen : this.channel?.readyState === 'open';
  }

  send(text: string): void {
    if (!this.open) return;
    const put = (framed: string): void => {
      if (this.relayed) {
        this.outbox.push(framed);
        this.flushTimer ||= window.setTimeout(() => this.flush(), RELAY_BATCH_MS);
      } else this.channel?.send(framed);
    };
    if (text.length <= CHUNK) {
      put(`W${text}`);
      return;
    }
    for (let i = 0; i < text.length; i += CHUNK) {
      const last = i + CHUNK >= text.length;
      put(`${last ? 'E' : 'P'}${text.slice(i, i + CHUNK)}`);
    }
  }

  /** Everything waiting for the relay, in bundles no bigger than one chunk. */
  private flush(): void {
    window.clearTimeout(this.flushTimer);
    this.flushTimer = 0;
    let batch: string[] = [];
    let size = 0;
    const send = (): void => {
      if (batch.length === 0) return;
      const payload: RelayPayload = batch.length === 1 ? { relay: 'm', data: batch[0] } : { relay: 'b', data: batch };
      this.broker.relay('CANDIDATE', this.remote, payload);
      batch = [];
      size = 0;
    };
    for (const framed of this.outbox) {
      if (size + framed.length > CHUNK) send();
      batch.push(framed);
      size += framed.length;
    }
    send();
    this.outbox = [];
  }

  close(): void {
    if (this.closed) return;
    // A refusal or goodbye still waiting for the relay goes before the line does.
    if (this.relayed) this.flush();
    this.closed = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.fallbackTimer);
    window.clearInterval(this.watchdog);
    // Tell a relayed partner at once rather than leaving it to notice the silence.
    if (this.relayed) this.broker.relay('LEAVE', this.remote, {});
    this.broker.forget?.(this.remote);
    this.channel?.close();
    this.pc?.close();
    this.events.onClose();
  }
}
