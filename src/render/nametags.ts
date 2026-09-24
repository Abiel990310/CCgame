import type { Vec2, World } from '@shared/sim/types';

const FONT = "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif";

/**
 * Names over other players' heads. Everyone but you wears the same outfit, so
 * with friends on the island the name is what tells them apart. Your own is
 * left off: you always know which one you are.
 */
export function drawNameTags(
  ctx: CanvasRenderingContext2D,
  world: World,
  selfId: number,
  visible: (p: Vec2, pad?: number) => boolean,
): void {
  if (world.players.size < 2) return;
  ctx.save();
  ctx.font = `800 9px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const player of world.players.values()) {
    if (player.id === selfId || !visible(player.pos, 40)) continue;
    const x = player.pos.x;
    const y = player.pos.y - 30;
    const width = ctx.measureText(player.name).width + 10;
    ctx.fillStyle = 'rgba(12, 16, 22, 0.62)';
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - 6.5, width, 13, 6.5);
    ctx.fill();
    ctx.fillStyle = player.downed > 0 ? '#ef6171' : '#f5f0e6';
    ctx.fillText(player.name, x, y + 0.5);
  }
  ctx.restore();
}
