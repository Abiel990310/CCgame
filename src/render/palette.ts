import type { Terrain } from '@shared/sim/types';

/**
 * Flat-shaded palette. Each terrain gets a lit face and a shadowed face; the
 * mesh picks between them per triangle to fake a single light direction.
 */
export interface TerrainShade {
  lit: string;
  shade: string;
  /** Slight per-triangle hue drift keeps large areas from banding. */
  vary: number;
}

export const TERRAIN_COLORS: Record<Terrain, TerrainShade> = {
  deep: { lit: '#1d4a6b', shade: '#163b57', vary: 4 },
  water: { lit: '#2f7fa8', shade: '#276a8d', vary: 6 },
  sand: { lit: '#e2cf9c', shade: '#cdb884', vary: 6 },
  grass: { lit: '#7fb469', shade: '#6a9c58', vary: 8 },
  forest: { lit: '#5d9455', shade: '#4d7d47', vary: 8 },
  rock: { lit: '#9aa0a8', shade: '#828992', vary: 7 },
};

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
