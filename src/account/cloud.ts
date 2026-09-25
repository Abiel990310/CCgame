import type { CloudApi } from './api';

/**
 * The account features as the game sees them. Each method is one function in
 * `docs/cloud/schema.sql`, and the names match so either side can be found
 * from the other.
 */

export interface Profile {
  id: string;
  name: string;
}

export interface FriendsOverview {
  friends: (Profile & { since: string })[];
  incoming: Profile[];
  outgoing: Profile[];
}

export type FriendRequestResult = 'sent' | 'friends' | 'already' | 'self' | 'not_found' | 'too_many';

export type WorldAccess = 'private' | 'friends';

/** What the menu card needs, copied from the save registry's summary. */
export interface WorldSummary {
  night: number;
  level: number;
  playSeconds: number;
}

export interface CloudWorld {
  id: string;
  owner: string;
  ownerName: string;
  mine: boolean;
  name: string;
  access: WorldAccess;
  summary: Partial<WorldSummary>;
  rev: number;
  updatedAt: number;
  /** Someone is playing it right now. */
  live: boolean;
  /** The co-op code to join them with, when they have one open. */
  room: string | null;
}

export type ClaimResult =
  | { ok: true; rev: number; access: WorldAccess }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'busy'; seenSecondsAgo: number };

/** A name the schema accepts: what `ccg_valid_name` checks, checked early. */
export function validName(name: string): boolean {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

export class Cloud {
  constructor(readonly api: CloudApi) {}

  get signedIn(): boolean {
    return this.api.current !== null;
  }

  get userId(): string | null {
    return this.api.current?.userId ?? null;
  }

  nameAvailable(name: string): Promise<boolean> {
    return this.api.rpc<boolean>('name_available', { p_name: name }, false);
  }

  myProfile(): Promise<Profile | null> {
    return this.api.rpc<Profile | null>('my_profile');
  }

  setName(name: string): Promise<'ok' | 'invalid' | 'taken'> {
    return this.api.rpc('set_name', { p_name: name });
  }

  friends(): Promise<FriendsOverview> {
    return this.api.rpc<FriendsOverview>('friends_overview');
  }

  addFriend(name: string): Promise<FriendRequestResult> {
    return this.api.rpc('send_friend_request', { p_name: name });
  }

  answerRequest(from: string, accept: boolean): Promise<void> {
    return this.api.rpc('answer_friend_request', { p_from: from, p_accept: accept });
  }

  cancelRequest(to: string): Promise<void> {
    return this.api.rpc('cancel_friend_request', { p_to: to });
  }

  removeFriend(friend: string): Promise<void> {
    return this.api.rpc('remove_friend', { p_friend: friend });
  }

  async listWorlds(): Promise<CloudWorld[]> {
    return (await this.api.rpc<CloudWorld[] | null>('list_worlds')) ?? [];
  }

  createWorld(name: string, access: WorldAccess, summary: WorldSummary, data: string): Promise<{ id: string; rev: number }> {
    return this.api.rpc('create_world', { p_name: name, p_access: access, p_summary: summary, p_data: data });
  }

  updateWorld(id: string, changes: { name?: string; access?: WorldAccess }): Promise<void> {
    return this.api.rpc('update_world', { p_id: id, p_name: changes.name ?? null, p_access: changes.access ?? null });
  }

  deleteWorld(id: string): Promise<void> {
    return this.api.rpc('delete_world', { p_id: id });
  }

  loadWorld(id: string): Promise<{ data: string; rev: number; name: string; access: WorldAccess } | null> {
    return this.api.rpc('load_world', { p_id: id });
  }

  claimWorld(id: string, lease: string, force = false): Promise<ClaimResult> {
    return this.api.rpc('claim_world', { p_id: id, p_lease: lease, p_force: force });
  }

  beatWorld(id: string, lease: string, room: string | null): Promise<boolean> {
    return this.api.rpc('beat_world', { p_id: id, p_lease: lease, p_room: room });
  }

  releaseWorld(id: string, lease: string): Promise<void> {
    return this.api.rpc('release_world', { p_id: id, p_lease: lease });
  }

  /** The new revision, or null when another device has taken the world. */
  saveWorld(id: string, lease: string, summary: WorldSummary, data: string): Promise<number | null> {
    return this.api.rpc('save_world', { p_id: id, p_lease: lease, p_summary: summary, p_data: data });
  }
}
