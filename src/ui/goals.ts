import { GOALS } from '@shared/data/goals';
import type { Player, World } from '@shared/sim/types';
import './progress.css';

/**
 * The goal tracker under the vitals: what to do next and how far along it is.
 * It owns its own element so the rest of the HUD does not need to know goals
 * exist, and it goes away for good once the chain is finished.
 */
export class GoalTracker {
  private el: HTMLElement;
  private title: HTMLElement;
  private hint: HTMLElement;
  private count: HTMLElement;
  private fill: HTMLElement;
  private step: HTMLElement;
  private key = '';
  private celebrate = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'goal panel hidden';
    this.el.id = 'goal';
    this.el.innerHTML = `
      <div class="goal-head">
        <span class="goal-step" data-role="step"></span>
        <b class="goal-count" data-role="count"></b>
      </div>
      <strong class="goal-title" data-role="title"></strong>
      <p class="goal-hint" data-role="hint"></p>
      <div class="goal-track"><div class="goal-fill" data-role="fill"></div></div>`;
    const role = (name: string) => this.el.querySelector<HTMLElement>(`[data-role="${name}"]`)!;
    this.title = role('title');
    this.hint = role('hint');
    this.count = role('count');
    this.fill = role('fill');
    this.step = role('step');
    // Tapping folds the hint away for players who have read it.
    this.el.addEventListener('click', () => this.el.classList.toggle('folded'));
    parent.appendChild(this.el);
  }

  /** Flash the tracker as the next goal slides in. */
  completed(): void {
    this.celebrate = 1.2;
    this.el.classList.remove('done');
    // Reflow so the animation restarts when goals land back to back.
    void this.el.offsetWidth;
    this.el.classList.add('done');
  }

  update(world: World, player: Player, dt: number, touch: boolean): void {
    const goal = GOALS[player.goal];
    this.el.classList.toggle('hidden', !goal);
    if (!goal) return;
    if (this.celebrate > 0) {
      this.celebrate -= dt;
      if (this.celebrate <= 0) this.el.classList.remove('done');
    }

    const have = Math.min(goal.have(world, player), goal.need);
    const key = `${player.goal}|${have}|${touch}`;
    if (key === this.key) return;
    this.key = key;

    this.step.textContent = `Goal ${player.goal + 1} of ${GOALS.length}`;
    this.title.textContent = goal.title;
    this.hint.textContent = (touch && goal.touchHint) || goal.hint;
    this.count.textContent = goal.need > 1 ? `${have} / ${goal.need}` : '';
    this.fill.style.transform = `scaleX(${have / goal.need})`;
  }
}
