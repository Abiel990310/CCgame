import { pixelIcon } from './pixelicons';

/**
 * The interface's icon set, drawn inline as SVG. Emoji were the icons before
 * this, and they render as a different picture on every platform — a hammer
 * on one phone, a mallet on another, a missing-glyph box on an old desktop —
 * so a HUD built on them never looked like one thing. Inline paths cost no
 * request, keep the zero-fetch promise, and take `currentColor` so the CSS
 * decides their tint.
 */
const PATHS = {
  hammer:
    '<path d="M14.5 4.5l5 5-2.3 2.3-1.6-1.6-8.8 8.8a1.8 1.8 0 01-2.6-2.6l8.8-8.8-1.6-1.6z"/><path d="M13 3.5l3-1 5.5 5.5-1 3"/>',
  bag: '<path d="M5 8h14l-1.2 11.2A2 2 0 0115.8 21H8.2a2 2 0 01-2-1.8z"/><path d="M9 8V6.5a3 3 0 016 0V8"/><path d="M9.5 13h5"/>',
  dash: '<path d="M4 8h9.5a2.5 2.5 0 10-2.5-2.5"/><path d="M3 12h15a3 3 0 11-3 3"/><path d="M5 16h6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  map: '<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5l-5.5 2.5-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
  heart:
    '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z"/>',
  star: '<path d="M12 3.2l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  sort: '<path d="M7 4v16M4 17l3 3 3-3"/><path d="M13 6h7M13 11h5M13 16h3"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate: '<circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M4.5 7.5l2.2 1.3M17.3 15.2l2.2 1.3M4.5 16.5l2.2-1.3M17.3 8.8l2.2-1.3"/><circle cx="12" cy="12" r="7"/>',
  sound:
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  keys: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17 10.5h.01M8 14h8"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  pencil: '<path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z"/><path d="M13.5 7l3.5 3.5"/>',
  leaf: '<path d="M5 19c0-8 5.5-13.5 15-14-.5 9.5-6 15-14 15"/><path d="M5 19c3-4 6.5-7 10-9"/>',
  sword: '<path d="M14.5 4H20v5.5L10.5 19l-5.5-5.5z"/><path d="M4 20l3-3M6.5 13l4.5 4.5"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  bolt: '<path d="M13 2.5L5.5 13.5H12l-1 8 7.5-11H12z"/>',
  users:
    '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0111 0"/><path d="M15.5 5.6a3.2 3.2 0 010 5.8M17.5 14.2a5.5 5.5 0 013 5.3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  arrow: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
  chevron: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.7-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.8-7.5-9.5V6z"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 00.6-7.95A6 6 0 006.4 9.1 4.7 4.7 0 007 18.5z"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-3.8 4-5.8 7.5-5.8s6.5 2 7.5 5.8"/>',
  sprout: '<path d="M12 20v-8"/><path d="M12 12c0-4 2.5-6.5 7-6.5 0 4.5-2.5 6.5-7 6.5z"/><path d="M12 14.5c0-3-2-5-5.5-5 0 3.4 2 5 5.5 5z"/>',
  spell: '<path d="M12 2.5l1.8 6.2 6.2 1.8-6.2 1.8L12 18.5l-1.8-6.2-6.2-1.8 6.2-1.8z"/><path d="M18.5 16l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z"/>',
  flame: '<path d="M12 21.5c-4 0-6.5-2.7-6.5-6.3 0-3.6 2.6-5.6 3.6-8.7 1.4 1.6 1.7 3 1.6 4.4 1.9-1.6 3-4.4 2.5-8.4 3.8 2.6 6.3 6.7 6.3 11.4 0 4.3-3 7.6-7.5 7.6z"/>',
  snow: '<path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5"/><path d="M9.5 3.8L12 6.3l2.5-2.5M9.5 20.2l2.5-2.5 2.5 2.5M3.9 10.6l3.4-.9-.9-3.4M20.1 13.4l-3.4.9.9 3.4M6.4 17.7l.9-3.4-3.4-.9M17.6 6.3l-.9 3.4 3.4.9"/>',
  cross: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Fill-drawn icons; everything else is a 2px round-capped stroke. */
const FILLED = new Set<IconName>(['heart', 'star', 'play', 'bolt', 'spell', 'flame', 'cross']);

/**
 * Both drawings of the icon in one SVG: the line icon for the smooth look and
 * the pixel sprite for the pixel look. The CSS shows one by the body's look,
 * so switching looks needs no re-render of every button that carries one.
 */
export function icon(name: IconName): string {
  const filled = FILLED.has(name);
  const paint = filled
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="ico ico-${name}" viewBox="0 0 24 24" aria-hidden="true"><g class="ln" ${paint}>${PATHS[name]}</g>${pixelIcon(name)}</svg>`;
}

/** Fill every `<i data-icon="…">` placeholder in the static markup. */
export function mountIcons(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-icon]'))) {
    const name = el.dataset.icon as IconName;
    if (name in PATHS) el.innerHTML = icon(name);
  }
}
