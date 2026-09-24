import { decode, encode } from '@shared/sim/snapshot';
import type { Player } from '@shared/sim/types';
import { GUESTS_SUFFIX, slotKey } from '../saves';

/**
 * The characters friends have played on this island, kept by the host.
 *
 * A guest's bag, level and upgrades belong to the host's island, so they live
 * beside its save rather than in the guest's browser; the guest brings only a
 * token that says who they are. They are kept apart from the island's own
 * players so a solo session never finds a friend's character standing idle
 * at camp.
 */
export class GuestBook {
  private players: Record<string, Player>;

  constructor(private slot: string) {
    this.players = read(slot);
  }

  /** A copy of this friend's character, or null the first time they visit. */
  get(token: string): Player | null {
    const player = this.players[token];
    return player ? decode<Player>(encode(player)) : null;
  }

  /** Remember a character as it is now, and write it out. */
  put(token: string, player: Player): void {
    this.players[token] = decode<Player>(encode(player));
    this.write();
  }

  write(): void {
    try {
      localStorage.setItem(slotKey(this.slot) + GUESTS_SUFFIX, encode(this.players));
    } catch {
      // A full disk loses a friend's latest few minutes, not the island.
    }
  }
}

function read(slot: string): Record<string, Player> {
  try {
    const raw = localStorage.getItem(slotKey(slot) + GUESTS_SUFFIX);
    return raw ? decode<Record<string, Player>>(raw) : {};
  } catch {
    return {};
  }
}
