import type { Command, Order } from '@shared/sim/commands';
import type { Snapshot } from '@shared/sim/snapshot';
import type { PlayerInput } from '@shared/sim/types';

/**
 * Stamped into the bundle at build time. Host and guest replay one another's
 * ticks, so they must be running the very same simulation code; two builds
 * that differ by a single balance number would drift apart within seconds.
 */
declare const __BUILD__: string;
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

/** A host plus this many friends. */
export const MAX_GUESTS = 3;

/** How often, in ticks, the host sends a fingerprint of its world to check against. */
export const CHECK_EVERY = 30;

/** Every broker id this game registers starts with this, so codes never collide with other apps. */
export function peerId(code: string): string {
  return `ccgame-island-${code.toLowerCase()}`;
}

/**
 * Room codes skip letters and digits that read alike (0/O, 1/I/L), because
 * they get read out loud and typed on phones.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** What someone typed, tidied into a code, or null if it cannot be one. */
export function cleanCode(text: string): string | null {
  const code = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

export type GuestMessage =
  | { t: 'hello'; build: string; token: string; name: string }
  | { t: 'input'; input: PlayerInput }
  | { t: 'cmd'; c: Command }
  | { t: 'resync' };

export interface TickMessage {
  t: 'tick';
  /** The tick this is: a guest's world must be one tick short of it. */
  n: number;
  /** Orders applied just before this tick, in the order they were applied. */
  o: Order[];
  i: [number, PlayerInput][];
  /** The host's fingerprint after this tick, on every `CHECK_EVERY`th. */
  h?: number;
}

export type HostMessage =
  | { t: 'reject'; reason: string }
  | { t: 'snapshot'; snap: Snapshot }
  | { t: 'welcome'; id: number }
  | { t: 'bye'; reason: string }
  | TickMessage;
