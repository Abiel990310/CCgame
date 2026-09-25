/**
 * A steady beat that survives the tab going into the background.
 *
 * Browsers hold a hidden page's own timers to about once a second, and after a
 * few minutes Chrome stretches that to once a minute. A host ticking on that
 * would hand its friends a whole second of island in one lump, then nothing.
 * A dedicated worker's timers are not held back that way, and its messages
 * still reach the hidden page as they are sent, so the worker keeps the time
 * and the page does the work.
 *
 * The worker is built from a string rather than a bundled file so it costs no
 * request: the page still fetches nothing it did not load at the start.
 */
const SOURCE = `let timer = 0;
onmessage = (event) => {
  clearInterval(timer);
  timer = event.data > 0 ? setInterval(() => postMessage(0), event.data) : 0;
};`;

export class Ticker {
  private worker: Worker | null = null;
  private fallback = 0;
  private running = false;

  constructor(private readonly onBeat: () => void) {}

  start(intervalMs: number): void {
    this.stop();
    this.running = true;
    try {
      if (!this.worker) {
        this.worker = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' })));
        this.worker.onmessage = () => {
          if (this.running) this.onBeat();
        };
      }
      this.worker.postMessage(intervalMs);
    } catch {
      // No workers here (or blob workers are refused): a throttled beat still
      // beats a frozen island.
      this.worker = null;
      this.fallback = window.setInterval(() => this.onBeat(), intervalMs);
    }
  }

  stop(): void {
    this.running = false;
    this.worker?.postMessage(0);
    window.clearInterval(this.fallback);
    this.fallback = 0;
  }
}
