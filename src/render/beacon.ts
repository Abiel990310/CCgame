import { BEACON_STAGES } from '@shared/data/beacon';
import { MACHINES } from '@shared/data/machines';
import { tileCenter } from '@shared/sim/grid';
import { TILE } from '@shared/sim/constants';
import type { Machine } from '@shared/sim/types';
import { rgba, shift } from './palette';

/**
 * The Skyward Beacon grows as it is built: a plinth, then a lattice spire a
 * section per stage, then a lamp that throws a slow beam once it is lit. It
 * is the one piece taller than a tile, so it reads from across the island.
 */
export function drawBeacon(ctx: CanvasRenderingContext2D, machine: Machine, time: number): void {
  const def = MACHINES[machine.type];
  const { x, y } = tileCenter(machine.tx, machine.ty);
  const stage = stageOf(machine);
  const lit = stage >= BEACON_STAGES.length;
  const foot = y + TILE * 0.38;

  // Shadow and a stepped stone plinth.
  ctx.fillStyle = 'rgba(12, 14, 22, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 3, foot + 2, TILE * 0.5, TILE * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [w, h, dy] of [
    [0.9, 0.22, 0],
    [0.7, 0.18, -0.2],
  ] as const) {
    ctx.fillStyle = shift(def.color, -30);
    ctx.fillRect(x - (TILE * w) / 2, foot - TILE * (dy + h), TILE * w, TILE * h);
    ctx.fillStyle = shift(def.color, 12);
    ctx.fillRect(x - (TILE * w) / 2, foot - TILE * (dy + h), TILE * w, 2);
  }
  const base = foot - TILE * 0.38;

  // One lattice section per stage raised, each a little narrower.
  const section = TILE * 0.62;
  let top = base;
  for (let i = 0; i < Math.min(stage, BEACON_STAGES.length); i++) {
    const w0 = TILE * (0.5 - i * 0.06);
    const w1 = TILE * (0.5 - (i + 1) * 0.06);
    const y0 = top;
    const y1 = top - section;
    ctx.fillStyle = shift(def.color, -12 + i * 4);
    ctx.beginPath();
    ctx.moveTo(x - w0 / 2, y0);
    ctx.lineTo(x - w1 / 2, y1);
    ctx.lineTo(x + w1 / 2, y1);
    ctx.lineTo(x + w0 / 2, y0);
    ctx.closePath();
    ctx.fill();
    // Cross-bracing, so it reads as a built frame rather than a block.
    ctx.strokeStyle = shift(def.color, -46);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - w0 / 2 + 1, y0);
    ctx.lineTo(x + w1 / 2 - 1, y1);
    ctx.moveTo(x + w0 / 2 - 1, y0);
    ctx.lineTo(x - w1 / 2 + 1, y1);
    ctx.stroke();
    ctx.fillStyle = shift(def.color, 30);
    ctx.fillRect(x - w1 / 2, y1, w1, 1.6);
    top = y1;
  }

  // Scaffold poles standing ready while it is still being built.
  if (!lit) {
    ctx.strokeStyle = rgba('#b08850', 0.9);
    ctx.lineWidth = 1.4;
    const next = top - section;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * TILE * 0.36, base);
      ctx.lineTo(x + side * TILE * 0.3, next);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - TILE * 0.3, next + 2);
    ctx.lineTo(x + TILE * 0.3, next + 2);
    ctx.stroke();
    return;
  }

  // The lamp housing and its light.
  const lampY = top - 6;
  ctx.fillStyle = shift(def.color, -40);
  ctx.fillRect(x - 6, top - 2, 12, 3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.85 + Math.sin(time * 2) * 0.15;
  const glow = ctx.createRadialGradient(x, lampY, 0, x, lampY, TILE * 2.2);
  glow.addColorStop(0, rgba(def.accent, 0.75 * pulse));
  glow.addColorStop(0.3, rgba(def.accent, 0.25 * pulse));
  glow.addColorStop(1, rgba(def.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(x - TILE * 2.2, lampY - TILE * 2.2, TILE * 4.4, TILE * 4.4);

  // A slow sweeping beam, foreshortened because the view looks down on it.
  const a = time * 0.6;
  const reach = TILE * 7;
  const spread = 0.16;
  const beam = ctx.createLinearGradient(x, lampY, x + Math.cos(a) * reach, lampY + Math.sin(a) * reach * 0.5);
  beam.addColorStop(0, rgba(def.accent, 0.4));
  beam.addColorStop(1, rgba(def.accent, 0));
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(x, lampY);
  ctx.lineTo(x + Math.cos(a - spread) * reach, lampY + Math.sin(a - spread) * reach * 0.5);
  ctx.lineTo(x + Math.cos(a + spread) * reach, lampY + Math.sin(a + spread) * reach * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#fff6d8';
  ctx.beginPath();
  ctx.arc(x, lampY, 4.2, 0, Math.PI * 2);
  ctx.fill();
}

/** Stages raised so far: 0 while the foundation is still being fed, 5 once lit. */
function stageOf(machine: Machine): number {
  const index = BEACON_STAGES.findIndex((s) => s.id === machine.recipe);
  return index >= 0 ? index : machine.recipe ? BEACON_STAGES.length : 0;
}
