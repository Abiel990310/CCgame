import { BUILD } from './protocol';

/**
 * A running account of what co-op's connections did, for the one case tests
 * cannot reach: a join that fails on someone else's network. The player can
 * open it after a failure and send it on, which shows which service answered,
 * which did not, and how far each got. It holds no keys, tokens or addresses.
 */
const MAX_LINES = 300;
const lines: string[] = [];
let start = 0;

export function netlog(text: string): void {
  const now = performance.now();
  if (lines.length === 0) start = now;
  lines.push(`${((now - start) / 1000).toFixed(1).padStart(6)}s  ${text}`);
  if (lines.length > MAX_LINES) lines.shift();
}

/** Start a fresh account, for a new attempt to host or join. */
export function netlogBegin(what: string): void {
  lines.length = 0;
  netlog(`${what} · build ${BUILD} · ${browserName()} · ${new Date().toISOString().slice(0, 19)}Z`);
}

export function netlogText(): string {
  return lines.length ? lines.join('\n') : 'Nothing has been connected yet.';
}

export function hasNetlog(): boolean {
  return lines.length > 0;
}

function browserName(): string {
  const ua = navigator.userAgent;
  const pick = (re: RegExp): string | null => ua.match(re)?.[0] ?? null;
  const browser = pick(/(Edg|OPR|Firefox|Chrome|CriOS|FxiOS)\/[\d.]+/) ?? (ua.includes('Safari') ? pick(/Version\/[\d.]+/)?.replace('Version', 'Safari') : null) ?? 'browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return `${browser}${os ? ` on ${os}` : ''}`;
}
