import { audio, type Bus } from '../audio';

interface Row {
  bus: Bus;
  label: string;
  hint: string;
}

const ROWS: Row[] = [
  { bus: 'master', label: 'Master', hint: 'Everything at once' },
  { bus: 'sfx', label: 'Effects', hint: 'Tools, weapons, building' },
  { bus: 'ambience', label: 'Ambience', hint: 'Wind, surf, the factory humming' },
  { bus: 'music', label: 'Music', hint: 'The island plays itself' },
];

/**
 * The sound sliders, rendered into whatever panel asks for them. The main menu
 * and the pause screen both want them, and a player who turns the music down
 * on one should not find it back up on the other — so both mount this, and it
 * reads its values from the one mixer every time it opens.
 */
export class SoundPanel {
  private sliders = new Map<Bus, HTMLInputElement>();
  private mute: HTMLButtonElement;

  constructor(private root: HTMLElement) {
    root.classList.add('sound-panel');
    root.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'sound-head';
    title.innerHTML = '<b>Sound</b>';

    this.mute = document.createElement('button');
    this.mute.className = 'mini-btn';
    this.mute.addEventListener('click', () => {
      audio.toggleMute();
      this.refresh();
      audio.play('click');
    });
    title.appendChild(this.mute);
    root.appendChild(title);

    for (const row of ROWS) root.appendChild(this.slider(row));
    this.refresh();
  }

  private slider(row: Row): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'sound-row';
    wrap.title = row.hint;

    const name = document.createElement('span');
    name.textContent = row.label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.addEventListener('input', () => {
      audio.setVolume(row.bus, Number(input.value) / 100);
      this.paint();
    });
    // A slider you cannot hear is a slider you cannot set, so preview on release.
    input.addEventListener('change', () => audio.play('click'));

    const value = document.createElement('em');
    value.dataset.bus = row.bus;

    wrap.append(name, input, value);
    this.sliders.set(row.bus, input);
    return wrap;
  }

  /** Pull the current mixer state back onto the controls. */
  refresh(): void {
    const volumes = audio.volumes;
    for (const [bus, input] of this.sliders) input.value = String(Math.round(volumes[bus] * 100));
    this.paint();
  }

  private paint(): void {
    const volumes = audio.volumes;
    this.mute.textContent = volumes.muted ? 'Unmute' : 'Mute';
    this.root.classList.toggle('muted', volumes.muted);
    for (const el of Array.from(this.root.querySelectorAll('em[data-bus]'))) {
      const bus = (el as HTMLElement).dataset.bus as Bus;
      el.textContent = `${Math.round(volumes[bus] * 100)}`;
    }
  }
}
