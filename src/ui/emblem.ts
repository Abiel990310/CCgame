/**
 * The title's emblem: the island at dusk in a gold ring, drawn on the same
 * 32-pixel grid as the pixel look, so the first thing on screen already
 * looks like the game. Kept as a map rather than an image because the page
 * fetches no assets; each run of one colour becomes one rect.
 */
const ROWS = [
  '..............KKKK..............',
  '..........KKKKOOOOKKKK..........',
  '........KKOOOOooooOOOOKK........',
  '.......KOOOooKKKKKKooOOOK.......',
  '.....KKOOoKKKAAAAAAKKKoOOKK.....',
  '....KKOooKUUAAAAAAAAMMKooOKK....',
  '....KOoKKUUUUAAAAAAAAMAKKoOK....',
  '...KOoKKAUUUUAAAAAAAAAMAKKoOK...',
  '..KOOoKaaaUUaaaaaaaaaMaaaKoOOK..',
  '..KOoKaaaaaaaaaaaaaaaaMaaaKoOK..',
  '.KOOKaaaaaaaaaaaaaaaaabbaaaKOOK.',
  '.KOoKSSSSStSSSSSSSSSSSbbSSSKoOK.',
  '.KOoKSSSSTttSSSSSSSRRRRSSSSKoOK.',
  '.KOKSSSSSTttSttSSSRRRRRRSSSSKOK.',
  'KOoKSSSSTTTtttttSRRRRRRRRSSSKoOK',
  'KOoKSSSSTTTtttttSSRRRRRRSSSSKoOK',
  'KOoKSSSTTTTTTttGGGBBBBMBSSSSKoOK',
  'KOoKssssYGbGGbGGGGBBbBBBssssKoOK',
  '.KOKsssYGGbGGGGGGGBBbBBBYsssKOK.',
  '.KOoKssYGGGGGGGGGGGGGGGGYssKoOK.',
  '.KOoKssYggGGkkOkkkWkkkggYssKoOK.',
  '.KOOKssyYYGgggGGGGgggGYYyssKOOK.',
  '..KOoKssyyyYYYGGGGYYYyyyssKoOK..',
  '..KOOoKssssyyyyyyyyyyssssKoOOK..',
  '...KOoKKwwssssssssssswwsKKoOK...',
  '....KOoKKsssssssswsssssKKoOK....',
  '....KKOooKsssswwssssssKooOKK....',
  '.....KKOOoKKKssssssKKKoOOKK.....',
  '.......KOOOooKKKKKKooOOOK.......',
  '........KKOOOOooooOOOOKK........',
  '..........KKKKOOOOKKKK..........',
  '..............KKKK..............',
];

const INK: Record<string, string> = {
  A: '#f2b872', // dusk sky
  B: '#8c6a4f', // timber
  G: '#78b85c', // grass
  K: '#0d1118', // outline
  M: '#e6e9ee', // smoke
  O: '#f0c257', // gold
  R: '#c4553c', // roof
  S: '#2f7fb0', // sea
  T: '#2e6a3c', // pine
  U: '#ffe7a3', // sun
  W: '#d5dde6', // iron
  Y: '#e6cf8f', // sand
  a: '#c98a6a', // low sky
  b: '#5a4232', // dark timber
  g: '#4f8f47', // grass shade
  k: '#5b6472', // belt
  o: '#a8741e', // gold shade
  s: '#1f5a86', // deep sea
  t: '#5aa352', // leaf
  w: '#8fd0ec', // surf
  y: '#b99a5c', // wet sand
};

export function emblemSvg(): string {
  let rects = '';
  ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      if (c !== '.') rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${INK[c]}"/>`;
      x = end;
    }
  });
  return `<svg class="logo-mark" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
