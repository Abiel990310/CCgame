/** What the graphics row needs from the renderer. */
export interface GraphicsSource {
  readonly backend: 'pixi' | 'canvas';
  readonly fps: number;
  setBackend(kind: 'pixi' | 'canvas'): Promise<'pixi' | 'canvas'>;
}

/**
 * The pause screen's graphics row: which renderer is drawing, how fast, and a
 * switch between them. The Pixi renderer is new, so it is offered as something
 * to try, with the frame rate beside it so the difference can be seen.
 */
export class GraphicsPanel {
  private status: HTMLElement;
  private toggle: HTMLButtonElement;
  private busy = false;

  constructor(
    root: HTMLElement,
    private source: GraphicsSource,
  ) {
    root.classList.add('sound-panel');
    root.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'sound-head';
    head.innerHTML = '<b>Graphics</b>';

    this.toggle = document.createElement('button');
    this.toggle.className = 'mini-btn';
    this.toggle.addEventListener('click', () => void this.flip());
    head.appendChild(this.toggle);

    this.status = document.createElement('div');
    this.status.className = 'graphics-status';

    root.append(head, this.status);
    this.refresh();
  }

  refresh(): void {
    const pixi = this.source.backend === 'pixi';
    const fps = Math.round(this.source.fps);
    const name = pixi ? 'GPU (PixiJS, testing)' : 'Canvas';
    this.status.textContent = fps > 0 ? `Drawing with ${name} · ${fps} fps` : `Drawing with ${name}`;
    this.toggle.textContent = this.busy ? 'Switching…' : pixi ? 'Use Canvas' : 'Try GPU';
    this.toggle.disabled = this.busy;
  }

  private async flip(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refresh();
    const want = this.source.backend === 'pixi' ? 'canvas' : 'pixi';
    const got = await this.source.setBackend(want);
    this.busy = false;
    this.refresh();
    if (got !== want) this.status.textContent = 'The GPU renderer could not start on this device.';
  }
}
