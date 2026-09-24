export const UI = {
  ink: '#f2ede2',
  inkDim: '#a9a294',
  panel: 'rgba(24, 27, 33, 0.82)',
  gold: '#e8b64c',
  danger: '#e0576b',
  good: '#7fd89a',
  xp: '#6fc6f0',
} as const;

/** Nudge a hex colour's lightness by ±amount (0-255), keeping it in range. */
export function shift(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
