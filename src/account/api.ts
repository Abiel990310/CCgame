import type { CloudConfig } from './config';

/**
 * A hand-written client for the two services a Supabase project exposes:
 * sign-in (`/auth/v1`) and the functions in `docs/cloud/schema.sql`
 * (`/rest/v1/rpc`). It is small on purpose. The official client would be the
 * page's second runtime dependency, and the game only ever needs a handful of
 * calls, all of them plain JSON over `fetch`.
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  userId: string;
  email: string;
}

/** Somewhere to keep the session between visits; localStorage in the browser. */
export interface SessionStore {
  load(): Session | null;
  save(session: Session | null): void;
}

const SESSION_KEY = 'ccgame.account';

export const browserSessionStore: SessionStore = {
  load() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  save(session) {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // Signed in for this visit only.
    }
  },
};

/** A failure worth showing the player, already worded for them. */
export class CloudError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the request never got an answer. */
    readonly status: number,
  ) {
    super(message);
  }

  /** True when the network, not the request, was the problem. */
  get offline(): boolean {
    return this.status === 0;
  }
}

/** Refresh this long before the token runs out, so a call never races expiry. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * What the sign-up call leaves you with: signed in, or waiting on a
 * confirmation email when the project is set to send one.
 */
export type SignUpResult = { kind: 'signed-in'; session: Session } | { kind: 'confirm-email' };

export class CloudApi {
  private session: Session | null;
  private refreshing: Promise<Session | null> | null = null;
  private listeners = new Set<(session: Session | null) => void>();

  constructor(
    private config: CloudConfig,
    private store: SessionStore = browserSessionStore,
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.session = store.load();
  }

  get current(): Session | null {
    return this.session;
  }

  /** Called whenever someone signs in or out, here or by a refresh failing. */
  onChange(listener: (session: Session | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async signUp(email: string, password: string, name: string): Promise<SignUpResult> {
    const body = await this.auth('/signup', { email, password, data: { name } });
    const session = toSession(body);
    if (!session) return { kind: 'confirm-email' };
    this.adopt(session);
    return { kind: 'signed-in', session };
  }

  async signIn(email: string, password: string): Promise<Session> {
    const session = toSession(await this.auth('/token?grant_type=password', { email, password }));
    if (!session) throw new CloudError('Sign-in did not return a session', 500);
    this.adopt(session);
    return session;
  }

  /** Ask for a password-reset email. */
  async recover(email: string): Promise<void> {
    await this.auth('/recover', { email });
  }

  async signOut(): Promise<void> {
    const session = this.session;
    this.adopt(null);
    if (!session) return;
    try {
      await this.request('/auth/v1/logout', {}, session.accessToken);
    } catch {
      // The token is forgotten here either way; the server lets it expire.
    }
  }

  /** Call one of the schema's functions as the signed-in player. */
  async rpc<T>(name: string, args: Record<string, unknown> = {}, signedIn = true): Promise<T> {
    let token: string | null = null;
    if (signedIn) {
      const session = await this.fresh();
      if (!session) throw new CloudError('Sign in first', 401);
      token = session.accessToken;
    }
    try {
      return (await this.request(`/rest/v1/rpc/${name}`, args, token)) as T;
    } catch (error) {
      // A token revoked early (signed out everywhere, say) is only found out
      // by using it. One refresh tells a dead session from a stale token.
      if (!signedIn || !(error instanceof CloudError) || error.status !== 401) throw error;
      const session = await this.refresh();
      if (!session) throw new CloudError('Signed out — sign in again', 401);
      return (await this.request(`/rest/v1/rpc/${name}`, args, session.accessToken)) as T;
    }
  }

  /** The session, refreshed first if it is about to run out. */
  async fresh(): Promise<Session | null> {
    // Another tab may have refreshed (and so rotated the token) since.
    const stored = this.store.load();
    if (stored && this.session && stored.userId === this.session.userId && stored.expiresAt > this.session.expiresAt) {
      this.session = stored;
    }
    const session = this.session;
    if (!session) return null;
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session;
    return this.refresh();
  }

  private refresh(): Promise<Session | null> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async doRefresh(): Promise<Session | null> {
    const session = this.session;
    if (!session) return null;
    try {
      const next = toSession(await this.auth('/token?grant_type=refresh_token', { refresh_token: session.refreshToken }));
      if (next) {
        this.adopt(next);
        return next;
      }
    } catch (error) {
      // Offline is not signed out: keep the session and try again later.
      if (error instanceof CloudError && error.offline) throw error;
      // A token already used by another tab is fine if that tab stored the new one.
      const stored = this.store.load();
      if (stored && stored.refreshToken !== session.refreshToken && stored.userId === session.userId) {
        this.session = stored;
        return stored;
      }
    }
    this.adopt(null);
    return null;
  }

  private adopt(session: Session | null): void {
    this.session = session;
    this.store.save(session);
    for (const listener of this.listeners) listener(session);
  }

  private auth(path: string, body: unknown): Promise<unknown> {
    return this.request(`/auth/v1${path}`, body, null);
  }

  /**
   * `token` is the player's, or null for a call anyone may make. Those carry
   * the project key alone: Supabase's newer publishable keys are not tokens,
   * and sending one as a bearer is refused where the key header is not.
   */
  private async request(path: string, body: unknown, token: string | null): Promise<unknown> {
    const headers: Record<string, string> = { apikey: this.config.key, 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await this.fetcher(this.config.url + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new CloudError('Could not reach the server — check your connection', 0);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!response.ok) throw new CloudError(describeError(parsed, response.status), response.status);
    return parsed;
  }
}

/** Turn a sign-in answer into a session, or null when it carried none. */
function toSession(body: unknown): Session | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    expires_at?: number;
    user?: { id?: string; email?: string };
  };
  if (!b.access_token || !b.refresh_token || !b.user?.id) return null;
  const expiresAt = b.expires_at ? b.expires_at * 1000 : Date.now() + (b.expires_in ?? 3600) * 1000;
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresAt,
    userId: b.user.id,
    email: b.user.email ?? '',
  };
}

/** The sign-in service and the database word their errors differently; this reads both. */
function describeError(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const b = body as { msg?: string; message?: string; error_description?: string; error?: string; error_code?: string };
    const code = b.error_code ?? '';
    if (code === 'invalid_credentials') return 'That email and password do not match';
    if (code === 'user_already_exists' || code === 'email_exists') return 'That email already has an account — sign in instead';
    if (code === 'weak_password') return 'Choose a longer password (at least 6 characters)';
    if (code === 'email_not_confirmed') return 'Confirm your email first — the link is in your inbox';
    if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'Too many tries — wait a minute';
    const text = b.msg ?? b.message ?? b.error_description ?? b.error;
    if (text) return text;
  }
  if (status >= 500) return 'The server had a problem — try again shortly';
  return `Request failed (${status})`;
}
