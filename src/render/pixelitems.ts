import { ITEMS, type ItemShape } from '@shared/data/items';
import type { ItemId } from '@shared/sim/types';
import { OUTLINE, PixelGrid, ramp, type Rgb } from './pixel';
import { blitGrid } from './pixelmachines';

/**
 * Items as 12-pixel sprites, one per shape, painted in each item's own
 * colour so a new row in `ITEMS` still needs no art. They ride the pixel
 * belts, lie on the ground and fill the bag's slots in the pixel look, where
 * the smooth silhouettes were the last soft thing on a crisp belt.
 *
 * Letters: `h`, `#`, `s` are the item colour's light, mid and shade, `H` a
 * glint and `k` a deep line in it. The rest are fixed materials: `w`/`W`/`v`
 * wood, `m`/`M` steel, `y`/`Y` brass, `g`/`G` glass, `x` fishing line.
 * Anything left `.` is empty, and the outline is traced round the rest.
 */
const ART: Record<ItemShape, readonly string[]> = {
  chunk: [
    '............',
    '....hhh.....',
    '...h###h#...',
    '..h##Hh###s.',
    '.h##h####ss.',
    '.h#####s##s.',
    '.h##s####ss.',
    '..###s###s..',
    '..s####sss..',
    '...sss.ss...',
    '............',
    '............',
  ],
  nugget: [
    '............',
    '............',
    '............',
    '....hhhh....',
    '...hH###h...',
    '..h#H####s..',
    '..h######s..',
    '..#s####ss..',
    '...ssssss...',
    '............',
    '............',
    '............',
  ],
  log: [
    '............',
    '............',
    '..hhhhhh....',
    '.h######vvv.',
    '.h####h#vWwv',
    '.###h###vwWv',
    '.#######vWwv',
    '.ssssssssvv.',
    '..ssssss....',
    '............',
    '............',
    '............',
  ],
  strand: [
    '............',
    '..h..h..h...',
    '..h..h.h....',
    '...h.h.h....',
    '...#.#h.....',
    '....###.....',
    '....yyY.....',
    '....###.....',
    '...#.#.#....',
    '..s..s..s...',
    '..s..s...s..',
    '............',
  ],
  orb: [
    '............',
    '............',
    '....hhh.....',
    '...hHH##....',
    '..hHh####s..',
    '..h######s..',
    '..h#####ss..',
    '..##s##sss..',
    '...sssss....',
    '....sss.....',
    '............',
    '............',
  ],
  fish: [
    '............',
    '............',
    '............',
    '....hhhh..h.',
    '..hh####hh#.',
    '.hk#h####s#.',
    '.h#######ss.',
    '..s#s###s.s.',
    '...ssss..s..',
    '............',
    '............',
    '............',
  ],
  plate: [
    '............',
    '............',
    '...hhhhhhh..',
    '..hH######..',
    '..h#######..',
    '..h#######..',
    '..h######s..',
    '..ssssssss..',
    '..kkkkkkkk..',
    '............',
    '............',
    '............',
  ],
  ingot: [
    '............',
    '............',
    '............',
    '...hhhhhh...',
    '..hH######..',
    '.h#######s..',
    '.h########s.',
    '.ssssssssss.',
    '.kkkkkkkkkk.',
    '............',
    '............',
    '............',
  ],
  gear: [
    '............',
    '.....hh.....',
    '..h.h##h.s..',
    '..hh####ss..',
    '...h#ss#s...',
    '.hh#s..s#ss.',
    '.hh#s..s#ss.',
    '...##hh##s..',
    '..ss####ss..',
    '..s.s##s.s..',
    '.....ss.....',
    '............',
  ],
  coil: [
    '............',
    '....hhhh....',
    '...hH###h...',
    '..h#k#k##s..',
    '..h#s..s#s..',
    '..h#s..s#s..',
    '..h##ss##s..',
    '...s####s.#.',
    '....ssss.#..',
    '.........#..',
    '............',
    '............',
  ],
  board: [
    '............',
    '............',
    '.hhhhhhhhhh.',
    '.h#y##y##y#.',
    '.h#yyyk#y##.',
    '.h####kk#y#.',
    '.h#y#kkkyy#.',
    '.h#yy####y#.',
    '.ssssssssss.',
    '..y.y..y.y..',
    '............',
    '............',
  ],
  chip: [
    '............',
    '............',
    '...y.y.y....',
    '..kkkkkkk...',
    '.ykhhhhhky..',
    '..kh###skk..',
    '.ykh#H#sky..',
    '..kh###skk..',
    '.ykssssskky.',
    '..kkkkkkk...',
    '...y.y.y....',
    '............',
  ],
  cell: [
    '............',
    '....mm......',
    '...hmmh.....',
    '..h####h....',
    '..hH###s....',
    '..h####s....',
    '..kkkkkk....',
    '..h####s....',
    '..h####s....',
    '..s####s....',
    '...ssss.....',
    '............',
  ],
  motor: [
    '............',
    '............',
    '...hhhhh....',
    '..hH####hm..',
    '.mh#k#k#smmm',
    '.mh#k#k#smmm',
    '.mh#k#k#sm..',
    '..ss####s...',
    '...sssss....',
    '...M...M....',
    '............',
    '............',
  ],
  flask: [
    '............',
    '....ww......',
    '....gG......',
    '....gG......',
    '...gghG.....',
    '..gH###G....',
    '.gh####sG...',
    '.g######G...',
    '.gs####sG...',
    '..GGGGGG....',
    '............',
    '............',
  ],
  axe: [
    '............',
    '......hh....',
    '.....h##h...',
    '....hwH##...',
    '.....w###s..',
    '....w.s##s..',
    '...w...ss...',
    '..w.........',
    '.w..........',
    '............',
    '............',
    '............',
  ],
  pick: [
    '............',
    '...hhhhh....',
    '..h##w###s..',
    '.h#s.w..s#s.',
    '.h...w....s.',
    '.....w......',
    '.....w......',
    '.....w......',
    '.....W......',
    '............',
    '............',
    '............',
  ],
  rod: [
    '........w...',
    '.......w.x..',
    '......w...x.',
    '.....w....x.',
    '....w.....x.',
    '...W......h.',
    '..W......h#.',
    '.W.......s..',
    '............',
    '............',
    '............',
    '............',
  ],
  basket: [
    '............',
    '............',
    '...wwwwww...',
    '..w......w..',
    '..w......w..',
    '.hhhhhhhhhh.',
    '.h#s#s#s#s#.',
    '.#s#s#s#s#s.',
    '.s#s#s#s#ss.',
    '..ssssssss..',
    '............',
    '............',
  ],
  hook: [
    '............',
    '.....hh.....',
    '..h..##..h..',
    '..#.h##..#..',
    '..#h.##h.#..',
    '..s#h##h#s..',
    '...ss##ss...',
    '.....##.....',
    '.....ww.....',
    '......w.....',
    '.......w....',
    '............',
  ],
  pack: [
    '............',
    '....wwww....',
    '...w....w...',
    '..hhhhhhhh..',
    '..hH######..',
    '..h#kkkk#s..',
    '..h#k##k#s..',
    '..h######s..',
    '..h######s..',
    '..ssssssss..',
    '............',
    '............',
  ],
  crate: [
    '............',
    '............',
    '..hhhhhhhh..',
    '..hwwwwwwW..',
    '..hw#ww#wW..',
    '..hww##wwW..',
    '..hww##wwW..',
    '..hw#ww#wW..',
    '..hwwwwwwW..',
    '..WWWWWWWW..',
    '............',
    '............',
  ],
};

const SIZE = 12;

const hex = (h: string): Rgb => ramp(h)[1];

const FIXED: Record<string, Rgb> = {
  w: hex('#8a5a32'),
  W: hex('#5e3b20'),
  v: hex('#c89a62'),
  m: hex('#b4bcc6'),
  M: hex('#6e7784'),
  y: hex('#e8c050'),
  Y: hex('#a07a28'),
  g: hex('#d8eef4'),
  G: hex('#8fb0bc'),
  x: hex('#e8e8e8'),
};

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as unknown as Rgb;
}

function makeItem(item: ItemId): PixelGrid {
  const def = ITEMS[item];
  const [light, mid, dark] = ramp(def.color);
  const ink: Record<string, Rgb> = {
    ...FIXED,
    h: light,
    '#': mid,
    s: dark,
    H: mix(light, [255, 255, 255], 0.5),
    k: mix(dark, [0, 0, 0], 0.4),
  };
  const g = new PixelGrid(SIZE, SIZE);
  ART[def.shape].forEach((row, y) => {
    for (let x = 0; x < SIZE; x++) {
      const c = ink[row[x]];
      if (c) g.set(x, y, c);
    }
  });
  g.outline(OUTLINE);
  return g;
}

/** An item in the world, centred on (x, y) at one pixel per world unit. */
export function drawPixelItem(ctx: CanvasRenderingContext2D, x: number, y: number, item: ItemId): void {
  blitGrid(ctx, `pitem:${item}`, x, y, SIZE / 2, SIZE / 2, () => makeItem(item));
}

/** The same sprite as a data URL, for the bag's slots. */
export function pixelItemUrl(item: ItemId): string {
  return makeItem(item).toCanvas(1).toDataURL();
}
