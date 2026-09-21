import { BUILDINGS } from '@shared/data/buildings';
import { TICK_DT } from '@shared/sim/constants';
import { placeBuilding, placementError } from '@shared/sim/building';
import { chooseUpgrade } from '@shared/sim/progression';
import { EMPTY_INPUT, step } from '@shared/sim/step';
import type { BuildingId, Player, PlayerInput, World } from '@shared/sim/types';
import { addPlayer, createWorld } from '@shared/sim/world';
import { InputManager } from './input';
import { Renderer, type GhostPreview } from './render/renderer';
import { clearSave, hasSave, loadWorld, saveWorld } from './save';
import { Hud } from './ui/hud';

const SAVE_INTERVAL = 8;
/** Never simulate more than this much wall time in one frame after a stall. */
const MAX_CATCHUP = 0.25;

export class Game {
  private world: World;
  private selfId = 0;
  private renderer: Renderer;
  private input: InputManager;
  private hud: Hud;

  private accumulator = 0;
  private lastFrame = 0;
  private saveTimer = SAVE_INTERVAL;
  private running = false;
  private lastPhase: World['phase'] = 'day';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new InputManager(canvas);
    this.hud = new Hud({
      onChooseUpgrade: (id) => this.chooseUpgrade(id),
      onToggleBuild: () => this.toggleBuild(),
      onSelectBuilding: () => this.hud.setBuildMode(true),
      onToggleBag: () => this.toggleBag(),
      onDash: () => this.input.triggerDash(),
      onStart: (fresh) => this.start(fresh),
    });

    this.world = createWorld(Date.now() & 0xffff);
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('beforeunload', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });

    this.renderer.resize();
    this.hud.showStart(hasSave());

    // Debug handle: lets tooling (and you, in the console) inspect live state.
    (window as unknown as { __ccgame: Game }).__ccgame = this;
  }

  private start(fresh: boolean): void {
    if (fresh) clearSave();

    const loaded = fresh ? null : loadWorld();
    if (loaded) {
      this.world = loaded;
      const first = this.world.players.values().next().value as Player | undefined;
      this.selfId = first?.id ?? addPlayer(this.world, 'You').id;
      this.hud.toast(`Welcome back — night ${this.world.nightIndex} survived`, 'good');
    } else {
      this.world = createWorld(Date.now() & 0xffff);
      this.selfId = addPlayer(this.world, 'You').id;
      this.hud.toast('A new island. Go gather.', 'good');
    }

    this.lastPhase = this.world.phase;
    this.renderer.camera.pos = { ...this.self.pos };
    this.lastFrame = performance.now();

    if (!this.running) {
      this.running = true;
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  /** Read-only access for the debug handle above. */
  get debugWorld(): World {
    return this.world;
  }

  get debugSelfId(): number {
    return this.selfId;
  }

  private get self(): Player {
    const player = this.world.players.get(this.selfId);
    if (!player) throw new Error('Local player missing from world');
    return player;
  }

  private toggleBuild(): void {
    const on = !this.hud.isBuildMode;
    this.hud.setBuildMode(on);
    if (on) this.hud.setBagOpen(false);
  }

  private toggleBag(): void {
    const open = !document.getElementById('bag')?.classList.contains('hidden');
    this.hud.setBagOpen(!open);
  }

  private chooseUpgrade(id: string): void {
    if (chooseUpgrade(this.world, this.self, id)) this.persist();
  }

  private persist(): void {
    if (this.running) saveWorld(this.world);
  }

  private handleActions(): void {
    for (const action of this.input.drainActions()) {
      if (action === 'build') this.toggleBuild();
      if (action === 'inventory') this.toggleBag();
      if (action === 'cancel') {
        this.hud.setBuildMode(false);
        this.hud.setBagOpen(false);
      }
    }
  }

  /** Where a building would land right now, and whether it is legal there. */
  private ghost(): GhostPreview | null {
    if (!this.hud.isBuildMode) return null;
    const type: BuildingId = this.hud.building;
    const pos = this.renderer.camera.screenToWorld(this.input.pointer.x, this.input.pointer.y);
    return { type, pos, valid: placementError(this.world, this.self, type, pos) === null };
  }

  private tryPlace(ghost: GhostPreview | null): void {
    if (!this.input.takeClick() || !ghost) return;

    const error = placementError(this.world, this.self, ghost.type, ghost.pos);
    if (error === null) {
      placeBuilding(this.world, this.self, ghost.type, ghost.pos);
      this.persist();
      return;
    }

    const messages: Record<NonNullable<typeof error>, string> = {
      range: 'Too far from camp',
      terrain: "Can't build there",
      overlap: 'Something is in the way',
      cost: `Need ${BUILDINGS[ghost.type].cost.map((c) => `${c.count} ${c.id}`).join(', ')}`,
    };
    this.hud.toast(messages[error], 'warn');
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));

    const elapsed = Math.min((now - this.lastFrame) / 1000, MAX_CATCHUP);
    this.lastFrame = now;

    this.handleActions();

    const paused = this.self.pendingUpgrades > 0;
    const ghost = this.ghost();
    this.tryPlace(ghost);

    // A pending level-up freezes the world, so the draft is never a panic.
    if (!paused) {
      this.accumulator += elapsed;
      const raw = this.input.sample();
      // Building mode repurposes the click, so suppress gathering while placing.
      const playerInput: PlayerInput = this.hud.isBuildMode
        ? { ...raw, interact: false }
        : raw;

      const inputs = new Map<number, PlayerInput>([[this.selfId, playerInput]]);
      for (const id of this.world.players.keys()) {
        if (id !== this.selfId) inputs.set(id, EMPTY_INPUT);
      }

      let ticks = 0;
      while (this.accumulator >= TICK_DT && ticks++ < 8) {
        this.accumulator -= TICK_DT;
        step(this.world, inputs);
        this.renderer.effects.consume(this.world.events);
        this.announcePhase();
      }

      this.saveTimer -= elapsed;
      if (this.saveTimer <= 0) {
        this.saveTimer = SAVE_INTERVAL;
        this.persist();
      }
    }

    this.renderer.effects.update(elapsed);
    this.renderer.camera.follow(this.self.pos, elapsed);
    this.renderer.render(this.world, this.selfId, this.world.time, ghost);
    this.hud.update(this.world, this.self);
  }

  private announcePhase(): void {
    if (this.world.phase === this.lastPhase) return;
    this.lastPhase = this.world.phase;

    if (this.world.phase === 'night') {
      this.hud.toast(`Night ${this.world.nightIndex} — get to camp`, 'warn');
      this.hud.setBuildMode(false);
    } else {
      this.hud.toast('Dawn. The island is yours again.', 'good');
      this.persist();
    }
  }
}
