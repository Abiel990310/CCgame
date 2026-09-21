import { BUILDINGS } from '@shared/data/buildings';
import { BELT_COST, MACHINES } from '@shared/data/machines';
import { ITEMS } from '@shared/data/items';
import { TICK_DT } from '@shared/sim/constants';
import { placeBuilding, placementError, removeBuildingAt } from '@shared/sim/building';
import {
  clickSlot,
  quickMove,
  stowCursor,
  takeAll,
  type ClickButton,
  type SlotRef,
} from '@shared/sim/containers';
import {
  factoryPlacementError,
  machineAt,
  placeBelt,
  placeMachine,
  removeAt,
  setRecipe,
} from '@shared/sim/factory';
import { rotate, tileCenter, toTile } from '@shared/sim/grid';
import { chooseUpgrade } from '@shared/sim/progression';
import { EMPTY_INPUT, step } from '@shared/sim/step';
import { addItem } from '@shared/sim/inventory';
import type {
  Direction,
  ItemStack,
  Machine,
  Player,
  PlayerInput,
  World,
} from '@shared/sim/types';
import { addPlayer, createWorld } from '@shared/sim/world';
import { InputManager } from './input';
import { Renderer, type GhostPreview } from './render/renderer';
import { loadWorld, saveWorld } from './save';
import { touchSlot, type SaveSlot } from './saves';
import { Hud } from './ui/hud';

const SAVE_INTERVAL = 8;
/** Never simulate more than this much wall time in one frame after a stall. */
const MAX_CATCHUP = 0.25;

export interface GameCallbacks {
  /** Hand control back to the main menu. */
  onQuit: () => void;
}

export class Game {
  private world: World;
  private selfId = 0;
  /** The save this session is playing into. Null while the menu is up. */
  private slot: SaveSlot | null = null;
  private renderer: Renderer;
  private input: InputManager;
  private hud: Hud;

  private accumulator = 0;
  private lastFrame = 0;
  private saveTimer = SAVE_INTERVAL;
  private running = false;
  private lastPhase: World['phase'] = 'day';
  /** Facing applied to the next belt or machine placed. */
  private buildDir: Direction = 0;

  constructor(canvas: HTMLCanvasElement, private callbacks: GameCallbacks) {
    this.renderer = new Renderer(canvas);
    this.input = new InputManager(canvas);
    this.hud = new Hud({
      onChooseUpgrade: (id) => this.chooseUpgrade(id),
      onToggleBuild: () => this.toggleBuild(),
      onSelect: () => this.hud.setBuildMode(true),
      onSetRecipe: (machineId, recipeId) => {
        if (setRecipe(this.world, machineId, recipeId)) this.persist();
      },
      onToggleBag: () => this.toggleBag(),
      onDash: () => this.input.triggerDash(),
      onTogglePause: () => this.togglePause(),
      onQuitToMenu: () => this.quitToMenu(),
      onSlotAction: (ref, button, quick) => this.moveItems(ref, button, quick),
      onTakeAll: (machineId) => this.takeEverything(machineId),
      onCloseInventory: () => this.closeInventory(),
    });

    this.world = createWorld(Date.now() & 0xffff);
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('beforeunload', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });

    this.renderer.resize();

    // Debug handles: let tooling (and you, in the console) inspect live state
    // and drive the factory through the same API the UI uses.
    const debug = window as unknown as { __ccgame: Game; __ccfactory: unknown };
    debug.__ccgame = this;
    debug.__ccfactory = {
      placeBelt,
      placeMachine,
      removeAt,
      setRecipe,
      machineAt,
      clickSlot,
      quickMove,
      takeAll,
      addItem,
      openInventory: (machine: Machine | null) => this.hud.openInventory(machine),
    };
  }

  /** Open a save slot: load its island, or generate one the first time. */
  enter(slot: SaveSlot, peaceful = false): void {
    this.slot = slot;
    const loaded = loadWorld(slot.id);

    if (loaded) {
      this.world = loaded;
      const first = this.world.players.values().next().value as Player | undefined;
      this.selfId = first?.id ?? addPlayer(this.world, 'You').id;
      this.hud.toast(`${slot.name} — night ${this.world.nightIndex} survived`, 'good');
    } else {
      this.world = createWorld(Date.now() & 0xffff, peaceful);
      this.selfId = addPlayer(this.world, 'You').id;
      this.hud.toast(
        peaceful ? `${slot.name}. A peaceful island — build freely.` : `${slot.name}. Go gather.`,
        'good',
      );
    }

    // Whatever was pressed on the menu is not a move order.
    this.input.drainActions();
    this.hud.setPauseOpen(false);
    this.hud.setBuildMode(false);
    this.hud.closeInventory();
    this.lastPhase = this.world.phase;
    this.renderer.camera.pos = { ...this.self.pos };
    this.lastFrame = performance.now();

    if (!this.running) {
      this.running = true;
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  private togglePause(): void {
    if (!this.slot) return;
    const open = !this.hud.isPauseOpen;
    if (open) {
      this.closeInventory();
      this.persist();
      this.hud.setBuildMode(false);
      this.hud.setPauseOpen(true, this.slot.name, `Night ${this.world.nightIndex} · saved just now`);
    } else {
      // Coming back from a pause must not fast-forward the missed seconds.
      this.lastFrame = performance.now();
      this.hud.setPauseOpen(false);
    }
  }

  private quitToMenu(): void {
    this.persist();
    this.running = false;
    this.slot = null;
    this.hud.setPauseOpen(false);
    this.callbacks.onQuit();
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
    if (on) this.closeInventory();
  }

  private toggleBag(): void {
    if (this.hud.isInventoryOpen) this.closeInventory();
    else this.hud.openInventory(null);
  }

  /** Closing always puts the held stack away, so a drag can never lose items. */
  private closeInventory(): void {
    if (!this.hud.isInventoryOpen) return;
    stowCursor(this.world, this.self);
    this.hud.closeInventory();
    this.persist();
  }

  private moveItems(ref: SlotRef, button: ClickButton, quick: boolean): void {
    const machineId = this.hud.inspecting?.id ?? null;
    if (quick) quickMove(this.world, this.self, machineId, ref);
    else clickSlot(this.world, this.self, machineId, ref, button);
  }

  private takeEverything(machineId: number): void {
    const moved = takeAll(this.world, this.self, machineId);
    if (moved === 0) this.hud.toast('No room in your bag', 'warn');
  }

  private chooseUpgrade(id: string): void {
    if (chooseUpgrade(this.world, this.self, id)) this.persist();
  }

  private persist(): void {
    if (!this.running || !this.slot) return;
    if (!saveWorld(this.world, this.slot.id)) return;
    touchSlot(this.slot.id, {
      night: this.world.nightIndex,
      level: this.self.level,
      playSeconds: Math.round(this.world.tick * TICK_DT),
    });
  }

  private handleActions(): void {
    // Build keys must not reach the world through an open screen: pressing X
    // while sorting a chest should not also demolish whatever is behind it.
    const blocked = this.hud.isInventoryOpen || this.hud.isPauseOpen;

    for (const action of this.input.drainActions()) {
      if (action === 'build' && !blocked) this.toggleBuild();
      if (action === 'inventory') this.toggleBag();
      if (action === 'rotate' && !blocked) this.buildDir = rotate(this.buildDir);
      if (action === 'remove' && !blocked) this.removeUnderCursor();
      if (action === 'cancel') {
        // Esc backs out of whatever is open, and opens the menu when nothing is.
        if (this.hud.isPauseOpen) this.togglePause();
        else if (this.hud.isBuildMode || this.hud.isInventoryOpen) {
          this.hud.setBuildMode(false);
          this.closeInventory();
        } else this.togglePause();
      }
    }
  }

  private get cursorWorld(): { x: number; y: number } {
    return this.renderer.camera.screenToWorld(this.input.pointer.x, this.input.pointer.y);
  }

  /** Where the selected piece would land, and whether it is legal there. */
  private ghost(): GhostPreview | null {
    if (!this.hud.isBuildMode) return null;

    const selection = this.hud.selected;
    const pos = this.cursorWorld;

    const { tx, ty } = toTile(pos);

    if (selection.kind === 'building') {
      // Camp pieces snap to the same lattice the factory uses. A wall is meant
      // to stack into a line, which free placement never quite let it do.
      const snapped = tileCenter(tx, ty);
      const valid = placementError(this.world, this.self, selection.id, snapped) === null;
      return { kind: 'building', type: selection.id, pos: snapped, valid };
    }

    const what = selection.kind === 'belt' ? 'belt' : selection.id;
    const valid = factoryPlacementError(this.world, this.self, what, tx, ty) === null;
    return { kind: 'grid', what, tx, ty, dir: this.buildDir, valid };
  }

  private tryPlace(ghost: GhostPreview | null): void {
    if (!this.input.takeClick()) return;

    // A click outside build mode inspects whatever machine is under the cursor.
    if (!ghost) {
      this.inspectUnderCursor();
      return;
    }

    if (ghost.kind === 'building') this.placeCampBuilding(ghost);
    else this.placeFactory(ghost);
  }

  private placeCampBuilding(ghost: Extract<GhostPreview, { kind: 'building' }>): void {
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
      cost: this.costMessage(BUILDINGS[ghost.type].cost),
    };
    this.hud.toast(messages[error], 'warn');
  }

  private placeFactory(ghost: Extract<GhostPreview, { kind: 'grid' }>): void {
    const { what, tx, ty } = ghost;
    const error = factoryPlacementError(this.world, this.self, what, tx, ty);

    if (error === null) {
      if (what === 'belt') placeBelt(this.world, this.self, tx, ty, this.buildDir);
      else placeMachine(this.world, this.self, what, tx, ty, this.buildDir);
      this.persist();
      return;
    }

    const cost = what === 'belt' ? BELT_COST : MACHINES[what].cost;
    const messages: Record<NonNullable<typeof error>, string> = {
      bounds: 'Off the edge of the island',
      occupied: 'Something is already there',
      terrain: "Can't build on water",
      ore: 'A miner has to sit on an ore patch',
      scenery: "Clear what's growing there first",
      cost: this.costMessage(cost),
    };
    this.hud.toast(messages[error], 'warn');
  }

  private costMessage(cost: ItemStack[]): string {
    return `Need ${cost.map((c) => `${c.count} ${ITEMS[c.id].name}`).join(', ')}`;
  }

  private removeUnderCursor(): void {
    const pos = this.cursorWorld;
    const { tx, ty } = toTile(pos);
    if (removeAt(this.world, this.self, tx, ty)) {
      this.hud.toast('Removed', 'good');
      this.persist();
      return;
    }

    // Camp pieces are not on the factory grid, so they need their own pass.
    const result = removeBuildingAt(this.world, this.self, pos);
    if (result === 'removed') {
      this.hud.toast('Removed', 'good');
      this.persist();
      return;
    }
    if (result === 'campfire') {
      this.hud.toast('The campfire stays — the camp is built around it', 'warn');
      return;
    }
    // Silence here reads as a broken key, so say plainly that nothing was hit.
    this.hud.toast('Nothing to remove there', 'warn');
  }

  private inspectUnderCursor(): void {
    const { tx, ty } = toTile(this.cursorWorld);
    const machine = machineAt(this.world, tx, ty);
    if (machine) this.hud.openInventory(machine);
  }

  private frame(now: number): void {
    if (!this.running) return;
    requestAnimationFrame((t) => this.frame(t));

    const elapsed = Math.min((now - this.lastFrame) / 1000, MAX_CATCHUP);
    this.lastFrame = now;

    this.handleActions();

    const paused = this.self.pendingUpgrades > 0 || this.hud.isPauseOpen;
    // Inspecting a machine should not also swing the pickaxe at it.
    if (this.hud.isInventoryOpen) this.input.takeClick();
    const ghost = this.ghost();
    this.tryPlace(ghost);

    // A pending level-up freezes the world, so the draft is never a panic.
    if (!paused) {
      this.accumulator += elapsed;
      const raw = this.input.sample();
      // Building mode repurposes the click, so suppress gathering while placing.
      // An open inventory stops the player entirely: sorting a chest should not
      // also walk you off it. The world keeps ticking behind it either way.
      const playerInput: PlayerInput = this.hud.isInventoryOpen
        ? { move: { x: 0, y: 0 }, dash: false, interact: false }
        : this.hud.isBuildMode
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
