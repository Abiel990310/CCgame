import { ITEMS } from '@shared/data/items';
import type { ItemId } from '@shared/sim/types';
import { LEDGER_BUCKET, LEDGER_HISTORY, type Ledger, type LedgerRow } from '../ledger';
import { itemIconVar } from '../render/items';

const LINE = '#f0b94a';
const BEST = 'rgba(127, 216, 154, 0.85)';

/**
 * The production ledger: every item the factory makes, how many a minute it
 * makes now, and the most it has ever made. A line running well under its
 * own best is the one to go and look at, which is how a bottleneck is found
 * without standing next to every furnace.
 */
export class LedgerView {
  private root: HTMLElement;
  private chart: HTMLCanvasElement;
  private title: HTMLElement;
  private stats: HTMLElement;
  private list: HTMLElement;
  private empty: HTMLElement;
  private dry: HTMLElement;
  private selected: ItemId | null = null;
  private listKey = '';

  constructor(parent: HTMLElement, onShowDry: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'ledger';
    this.root.innerHTML = `
      <button class="ledger-dry hidden" data-role="dry"></button>
      <p class="ledger-empty hidden" data-role="empty">
        Nothing made yet. Everything a machine puts out is counted here, a minute at a time.
      </p>
      <section class="ledger-focus" data-role="focus">
        <div class="ledger-focus-head">
          <strong data-role="title"></strong>
          <span data-role="stats"></span>
        </div>
        <canvas class="ledger-chart" data-role="chart"></canvas>
        <div class="ledger-axis"><span>${(LEDGER_HISTORY * LEDGER_BUCKET) / 60} min ago</span><span>now</span></div>
      </section>
      <div class="ledger-list" data-role="list"></div>
      <p class="ledger-hint">Per minute of island time. A line far under its best is starved or backed up.</p>`;
    const role = <T extends HTMLElement>(name: string) => this.root.querySelector<T>(`[data-role="${name}"]`)!;
    this.chart = role<HTMLCanvasElement>('chart');
    this.title = role('title');
    this.stats = role('stats');
    this.list = role('list');
    this.empty = role('empty');
    this.dry = role('dry');
    this.dry.addEventListener('click', onShowDry);
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
      if (!row) return;
      this.selected = row.dataset.item as ItemId;
      this.listKey = '';
    });
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    this.listKey = '';
  }

  update(ledger: Ledger, dryMiners: number): void {
    const rows = ledger.rows();
    this.dry.classList.toggle('hidden', dryMiners === 0);
    this.dry.textContent =
      dryMiners === 1 ? '1 miner has run its patch dry. Show on map ›' : `${dryMiners} miners have run their patches dry. Show on map ›`;

    this.empty.classList.toggle('hidden', rows.length > 0);
    this.root.querySelector('[data-role="focus"]')!.classList.toggle('hidden', rows.length === 0);
    if (rows.length === 0) {
      this.list.innerHTML = '';
      return;
    }
    const focus = rows.find((r) => r.item === this.selected) ?? rows[0];
    this.selected = focus.item;

    this.title.textContent = ITEMS[focus.item].name;
    this.stats.innerHTML = `<b>${fmt(focus.rate)}</b>/min now · best <b>${fmt(focus.best)}</b>`;
    this.drawChart(focus);
    this.drawList(rows);
  }

  private drawList(rows: LedgerRow[]): void {
    // Rebuilt only when a number shown actually changes, which is every ten
    // seconds at most, so a tap on a row is never lost to a repaint under it.
    const key = rows.map((r) => `${r.item}:${r.rate}:${r.best}:${r.series.join(',')}`).join('|') + this.selected;
    if (key === this.listKey) return;
    this.listKey = key;

    this.list.innerHTML = rows
      .map((r) => {
        const share = r.best > 0 ? r.rate / r.best : 0;
        const tone = r.best === 0 ? '' : share >= 0.9 ? 'good' : share < 0.5 ? 'low' : '';
        return `
        <button class="ledger-row ${r.item === this.selected ? 'on' : ''}" data-item="${r.item}">
          <i class="ledger-icon" style="background-image:${itemIconVar(r.item)}"></i>
          <span class="ledger-name">${ITEMS[r.item].name}</span>
          <svg class="ledger-spark" viewBox="0 0 ${LEDGER_HISTORY} 20" preserveAspectRatio="none">
            <polyline points="${spark(r.series, Math.max(r.best, 1))}" />
          </svg>
          <span class="ledger-rate ${tone}">${fmt(r.rate)}</span>
          <span class="ledger-best">${fmt(r.best)}</span>
        </button>`;
      })
      .join('');
    this.list.insertAdjacentHTML(
      'afterbegin',
      '<div class="ledger-row ledger-cols"><i></i><span></span><span></span><span>/min</span><span>best</span></div>',
    );
  }

  private drawChart(row: LedgerRow): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.chart.clientWidth * dpr);
    const h = Math.round(this.chart.clientHeight * dpr);
    if (w <= 0 || h <= 0) return;
    if (this.chart.width !== w || this.chart.height !== h) {
      this.chart.width = w;
      this.chart.height = h;
    }
    const ctx = this.chart.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const top = Math.max(row.best, ...row.series, 1) * 1.15;
    const pad = 4 * dpr;
    const x = (i: number) => pad + (i / (LEDGER_HISTORY - 1)) * (w - pad * 2);
    const y = (v: number) => h - pad - (v / top) * (h - pad * 2);

    // Bars rather than a line alone: a ten-second gap where nothing came out
    // is exactly the stutter a starved machine makes, and a line smooths it.
    const bar = Math.max(1, (w - pad * 2) / LEDGER_HISTORY - dpr);
    ctx.fillStyle = 'rgba(240, 185, 74, 0.28)';
    row.series.forEach((v, i) => {
      if (v <= 0) return;
      ctx.fillRect(x(i) - bar / 2, y(v), bar, h - pad - y(v));
    });

    // The rolling minute, which is the number quoted beside it.
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < row.series.length; i++) {
      const from = Math.max(0, i - 5);
      const minute = row.series.slice(from, i + 1).reduce((a, b) => a + b, 0) / (i + 1 - from);
      if (!started) ctx.moveTo(x(i), y(minute));
      else ctx.lineTo(x(i), y(minute));
      started = true;
    }
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = 'round';
    ctx.stroke();

    if (row.best > 0) {
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.strokeStyle = BEST;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(pad, y(row.best));
      ctx.lineTo(w - pad, y(row.best));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function spark(series: number[], top: number): string {
  return series.map((v, i) => `${i},${(20 - (Math.min(v, top) / top) * 18 - 1).toFixed(1)}`).join(' ');
}

function fmt(n: number): string {
  return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}
