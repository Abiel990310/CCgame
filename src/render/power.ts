import { MACHINES } from '@shared/data/machines';
import { TILE } from '@shared/sim/constants';
import { tileCenter } from '@shared/sim/grid';
import { powerNetOf, powerWires } from '@shared/sim/power';
import type { MachineId, World } from '@shared/sim/types';
import { poleTip } from './factory';
import { UI, rgba } from './palette';

interface View {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Wires between poles, strung over everything on the ground. Two per link,
 * one from each insulator, sagging a little under their own weight; a wire on
 * a dead network is drawn dark, which is the whole island's power status at a
 * glance.
 */
export function drawPowerWires(ctx: CanvasRenderingContext2D, world: World, view: View): void {
  const wires = powerWires(world);
  if (wires.length === 0) return;

  ctx.save();
  ctx.lineWidth = 1;
  for (const [a, b] of wires) {
    const ax = tileCenter(a.tx, a.ty).x;
    const bx = tileCenter(b.tx, b.ty).x;
    const ay = tileCenter(a.tx, a.ty).y;
    const by = tileCenter(b.tx, b.ty).y;
    if (Math.max(ax, bx) < view.minX - TILE || Math.min(ax, bx) > view.maxX + TILE) continue;
    if (Math.max(ay, by) < view.minY - TILE * 2 || Math.min(ay, by) > view.maxY + TILE) continue;

    const live = (powerNetOf(world, a)?.supply ?? 0) > 0;
    ctx.strokeStyle = live ? 'rgba(40, 34, 30, 0.85)' : 'rgba(40, 34, 30, 0.45)';
    for (const side of [-1, 1] as const) {
      const p = poleTip(a, side);
      const q = poleTip(b, side);
      const sag = Math.hypot(q.x - p.x, q.y - p.y) * 0.08;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo((p.x + q.x) / 2, (p.y + q.y) / 2 + sag * 2, q.x, q.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * While a pole or an electric machine is in hand, show every pole's reach as
 * a soft square, and the one about to be placed: what it will power is the
 * question every placement asks.
 */
export function drawPowerCoverage(
  ctx: CanvasRenderingContext2D,
  world: World,
  holding: MachineId,
  ghost: { tx: number; ty: number },
): void {
  const def = MACHINES[holding];
  if (def.family !== 'pole' && !def.power && !def.generates) return;

  ctx.save();
  const square = (tx: number, ty: number, r: number, alpha: number): void => {
    const { x, y } = tileCenter(tx, ty);
    const half = (r + 0.5) * TILE;
    ctx.fillStyle = rgba(UI.gold, alpha);
    ctx.fillRect(x - half, y - half, half * 2, half * 2);
    ctx.strokeStyle = rgba(UI.gold, alpha * 3);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - half, y - half, half * 2, half * 2);
  };
  for (const m of world.machines) {
    const md = MACHINES[m.type];
    if (md.family === 'pole') square(m.tx, m.ty, md.supply ?? 0, 0.1);
  }
  if (def.family === 'pole') square(ghost.tx, ghost.ty, def.supply ?? 0, 0.12);
  ctx.restore();
}
