/**
 * Where accounts live. Empty means the game has no accounts at all: no sign-in
 * button, no request to anyone, exactly the offline game it has always been.
 *
 * The anon key is public by design. It lets a browser call the functions in
 * `docs/cloud/schema.sql` and nothing else; what each call may do is decided
 * there, by who is signed in.
 *
 * A build can point somewhere else with `VITE_CLOUD_URL` and `VITE_CLOUD_KEY`,
 * which is how a local test backend is used without touching this file.
 */
const LIVE_URL = '';
const LIVE_KEY = '';

export interface CloudConfig {
  url: string;
  key: string;
}

export function cloudConfig(): CloudConfig | null {
  const url = (import.meta.env.VITE_CLOUD_URL as string | undefined) || LIVE_URL;
  const key = (import.meta.env.VITE_CLOUD_KEY as string | undefined) || LIVE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key };
}
