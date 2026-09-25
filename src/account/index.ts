import { CloudApi } from './api';
import { Cloud, type Profile } from './cloud';
import { cloudConfig } from './config';

/**
 * The player's account, when this build has somewhere to keep one. Null means
 * accounts are off: `config.ts` has no server, and the game makes no request
 * to anyone about them.
 */
export class Account {
  readonly api: CloudApi;
  readonly cloud: Cloud;
  private profileCache: Profile | null = null;
  private listeners = new Set<() => void>();

  constructor(api: CloudApi) {
    this.api = api;
    this.cloud = new Cloud(api);
    api.onChange((session) => {
      if (!session || session.userId !== this.profileCache?.id) this.profileCache = null;
      this.emit();
    });
  }

  get signedIn(): boolean {
    return this.api.current !== null;
  }

  get userId(): string | null {
    return this.api.current?.userId ?? null;
  }

  get email(): string {
    return this.api.current?.email ?? '';
  }

  /** The profile as last fetched; `loadProfile` fetches it. */
  get profile(): Profile | null {
    return this.profileCache;
  }

  async loadProfile(): Promise<Profile | null> {
    if (!this.signedIn) return null;
    this.profileCache = await this.cloud.myProfile();
    this.emit();
    return this.profileCache;
  }

  setProfile(profile: Profile): void {
    this.profileCache = profile;
    this.emit();
  }

  /** Signed in, signed out, or the profile changed. */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const config = cloudConfig();
export const account: Account | null = config ? new Account(new CloudApi(config)) : null;
