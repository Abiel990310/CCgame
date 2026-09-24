import { BUILDINGS } from '@shared/data/buildings';
import { MACHINES } from '@shared/data/machines';
import { TILE } from '@shared/sim/constants';
import { tileCenter } from '@shared/sim/grid';
import type { BuildingId, MachineId } from '@shared/sim/types';
import { drawBuilding } from './entities';
import { drawBeltAt, drawMachine, previewMachine } from './factory';

/**
 * Icons for everything the player can build, baked from the very drawing the
 * world uses — the same idea as the item icons in `items.ts`. A hotbar slot
 * that says "Furnace" in text is a word to read; one that shows the furnace
 * standing on the ground is something the eye matches without reading.
 *
 * Each is baked once into a `--piece-<key>` custom property, so a hotbar or
 * palette repaint sets one `var()` rather than inlining a data URL.
 */
const ICON_PX = 112;
let installed = false;

/** A palette selection key (`belt`, `machine:furnace`) as a CSS-safe name. */
function cssName(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '-');
}

export function pieceIconVar(key: string): string {
  installPieceIcons();
  return `var(--piece-${cssName(key)})`;
}

export function installPieceIcons(): void {
  if (installed) return;
  installed = true;

  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const lines: string[] = [];
  const bake = (key: string, draw: () => void): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ICON_PX, ICON_PX);
    draw();
    lines.push(`--piece-${cssName(key)}: url(${canvas.toDataURL()});`);
  };

  // A tile fills most of the icon; the block's front face hangs below its
  // centre, so the view is nudged down to keep the whole machine in frame.
  const tileScale = (ICON_PX * 0.78) / TILE;
  const onTile = (): { x: number; y: number } => {
    const c = tileCenter(0, 0);
    ctx.setTransform(tileScale, 0, 0, tileScale, ICON_PX / 2 - c.x * tileScale, ICON_PX / 2 - (c.y - 1) * tileScale);
    return c;
  };

  bake('belt', () => {
    const c = onTile();
    drawBeltAt(ctx, c.x, c.y, 0, 0.1);
  });

  for (const id of Object.keys(MACHINES) as MachineId[]) {
    bake(`machine:${id}`, () => {
      onTile();
      // Facing right: the output port is on the side a reader expects.
      drawMachine(ctx, previewMachine(id, 0, 0, 0), 0.3, false);
    });
  }

  for (const id of Object.keys(BUILDINGS) as BuildingId[]) {
    bake(`building:${id}`, () => {
      const def = BUILDINGS[id];
      // Camp art rises well above its footprint, so fit on its radius and
      // leave headroom above rather than centring the footprint.
      const s = (ICON_PX * 0.4) / Math.max(def.radius, 12);
      ctx.setTransform(s, 0, 0, s, ICON_PX / 2, ICON_PX * 0.68);
      drawBuilding(ctx, { id: 7, type: id, pos: { x: 0, y: 0 }, level: 4 }, 0.4);
    });
  }

  const style = document.createElement('style');
  style.textContent = `:root {\n${lines.join('\n')}\n}`;
  document.head.appendChild(style);
}
