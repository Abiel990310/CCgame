import { WebGLRenderer } from 'pixi.js';
import { PixiContext2D } from './context';

/**
 * The WebGL stage the Pixi renderer draws into. It is loaded on its own, only
 * when the Pixi renderer is switched on, so the Canvas build never downloads
 * PixiJS.
 */
export class GpuStage {
  readonly ctx = new PixiContext2D();

  private constructor(private renderer: WebGLRenderer) {}

  static async create(): Promise<GpuStage> {
    const renderer = new WebGLRenderer();
    await renderer.init({
      width: 1,
      height: 1,
      resolution: 1,
      autoDensity: false,
      antialias: true,
      background: '#12232e',
      powerPreference: 'high-performance',
    });
    return new GpuStage(renderer);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  /** Size in device pixels; the page stretches the canvas over the window. */
  resize(width: number, height: number): void {
    if (this.renderer.width !== width || this.renderer.height !== height) this.renderer.resize(width, height);
  }

  present(): void {
    this.renderer.render(this.ctx.root);
  }

  destroy(): void {
    this.canvas.remove();
    // The renderer first, so it lets go of the textures before they are freed.
    this.renderer.destroy();
    this.ctx.destroy();
  }
}
