import type { Broker } from './broker';

/**
 * STUN lets two browsers behind home routers find the addresses to reach each
 * other by. There is no TURN relay: a pair of networks that will not let
 * traffic through directly (some mobile carriers, strict offices) cannot
 * connect, and says so rather than hanging.
 */
const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

/**
 * Chrome will not deliver a data channel message much over 256 KiB, and an
 * island snapshot can be bigger than that, so long messages go in pieces.
 */
const CHUNK = 60_000;
const CONNECT_TIMEOUT_MS = 15_000;

export interface LinkEvents {
  onOpen: () => void;
  onMessage: (text: string) => void;
  onClose: () => void;
}

/** One reliable, ordered channel to one other browser. */
export class Link {
  private pc = new RTCPeerConnection(ICE);
  private channel: RTCDataChannel | null = null;
  private partial = '';
  private closed = false;
  private timer = 0;

  constructor(
    private broker: Broker,
    /** The broker id at the other end. */
    readonly remote: string,
    private events: LinkEvents,
  ) {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) this.broker.relay('CANDIDATE', remote, { candidate: event.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'failed' || state === 'closed') this.close();
    };
    this.pc.ondatachannel = (event) => this.attach(event.channel);
    this.timer = window.setTimeout(() => {
      if (this.channel?.readyState !== 'open') this.close();
    }, CONNECT_TIMEOUT_MS);
  }

  /** The joining side opens the channel and makes the offer. */
  async call(): Promise<void> {
    this.attach(this.pc.createDataChannel('ccgame', { ordered: true }));
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.broker.relay('OFFER', this.remote, { sdp: this.pc.localDescription?.toJSON() });
  }

  /**
   * Whatever the broker carried in from the other end. Handled strictly in
   * arrival order: a candidate added before the offer has finished applying is
   * rejected, and would be lost.
   */
  signal(type: string, payload: unknown): void {
    this.signals = this.signals.then(() => this.handle(type, payload));
  }

  private signals: Promise<void> = Promise.resolve();

  private async handle(type: string, payload: unknown): Promise<void> {
    const data = payload as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    try {
      if (type === 'OFFER' && data.sdp) {
        await this.pc.setRemoteDescription(data.sdp);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.broker.relay('ANSWER', this.remote, { sdp: this.pc.localDescription?.toJSON() });
      } else if (type === 'ANSWER' && data.sdp) {
        await this.pc.setRemoteDescription(data.sdp);
      } else if (type === 'CANDIDATE' && data.candidate) {
        await this.pc.addIceCandidate(data.candidate);
      } else if (type === 'LEAVE') {
        this.close();
      }
    } catch {
      // A candidate that arrives for a connection already given up on is noise.
    }
  }

  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.onopen = () => {
      window.clearTimeout(this.timer);
      this.events.onOpen();
    };
    channel.onclose = () => this.close();
    channel.onmessage = (event) => {
      const text = String(event.data);
      // One character of framing: whole, a piece to come, or the last piece.
      const tag = text[0];
      const body = text.slice(1);
      if (tag === 'W') this.events.onMessage(body);
      else if (tag === 'P') this.partial += body;
      else if (tag === 'E') {
        const whole = this.partial + body;
        this.partial = '';
        this.events.onMessage(whole);
      }
    };
  }

  get open(): boolean {
    return this.channel?.readyState === 'open';
  }

  send(text: string): void {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') return;
    if (text.length <= CHUNK) {
      channel.send(`W${text}`);
      return;
    }
    for (let i = 0; i < text.length; i += CHUNK) {
      const last = i + CHUNK >= text.length;
      channel.send(`${last ? 'E' : 'P'}${text.slice(i, i + CHUNK)}`);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.timer);
    this.channel?.close();
    this.pc.close();
    this.events.onClose();
  }
}
