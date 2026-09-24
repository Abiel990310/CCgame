import { BUILDINGS } from '@shared/data/buildings';
import { BELT_COST, MACHINES } from '@shared/data/machines';
import { ITEMS } from '@shared/data/items';
import { CAMP, TICK_DT } from '@shared/sim/constants';
import {
  buildingAt,
  placeBuilding,
  placementError,
  removeBuildingAt,
} from '@shared/sim/building';
import {
  clickSlot,
  gatherStacks,
  machineById,
  quickMove,
  sortArea,
  stowCursor,
  takeAll,
  type ClickButton,
  type SlotArea,
  type SlotRef,
} from '@shared/sim/containers';
import {
  copySettings,
  entityAt,
  factoryPlacementError,
  hasSettings,
  pasteSettings,
  setSlotFilter,
  type MachineSettings,
  machineAt,
  placeBelt,
  placeMachine,
  removeAt,
  setFilter,
  setRecipe,
  setSideFilter,
  upgradeTarget,
} from '@shared/sim/factory';
import { rotate, tileCenter, toTile } from '@shared/sim/grid';
import { chooseUpgrade } from '@shared/sim/progression';
import { TECH_BY_ID } from '@shared/data/techs';
import { setResearch } from '@shared/sim/research';
import { EMPTY_INPUT, step } from '@shared/sim/step';
import { addItem } from '@shared/sim/inventory';
import type {
  Direction,
  MachineFamily,
  ItemStack,
  Machine,
  Player,
  PlayerInput,
  World,
} from '@shared/sim/types';
import { addPlayer, createWorld } from '@shared/sim/world';
import { audio } from './audio';
import { InputManager } from './input';
import { Renderer, type GhostPreview, type RemovalPreview } from './render/renderer';
import { Interpolator } from './render/interpolate';
import { forgetSlot, loadWorld, saveWorld } from './save';
import { touchSlot, type SaveSlot } from './saves';
import { Hud } from './ui/hud';

const SAVE_INTERVAL = 8;
/**
 * Serialising the island is proportional to its size, so an explicit action
 * does not write on the spot: it pulls the periodic save this close instead,
 * which coalesces a dragged-out belt line into one write.
 */
const SAVE_DEBOUNCE = 2;
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
  private readonly interpolator = new Interpolator();
  private lastFrame = 0;
  private saveTimer = SAVE_INTERVAL;
  private running = false;
  private lastPhase: World['phase'] = 'day';
  /** Facing applied to the next belt or machine placed. */
  private buildDir: Direction = 0;
  /**
   * The last machine settings copied. It belongs to this player's hands rather
   * than the island, so it is neither saved nor shared.
   */
  private clipboard: MachineSettings | null = null;

  constructor(canvas: HTMLCanvasElement, private callbacks: GameCallbacks) {
    this.renderer = new Renderer(canvas);
    this.input = new InputManager(canvas);
    this.hud = new Hud({
      onChooseUpgrade: (id) => this.chooseUpgrade(id),
      onToggleBuild: () => this.toggleBuild(),
      onSelect: () => this.hud.setBuildMode(true),
      onSetRecipe: (machineId, recipeId) => {
        if (setRecipe(this.world, machineId, recipeId)) this.requestSave();
      },
      onSetResearch: (techId) => {
        if (setResearch(this.world, techId)) this.requestSave();
      },
      onSetFilter: (machineId, item) => {
        if (setFilter(this.world, machineId, item)) this.requestSave();
      },
      onToggleBag: () => this.toggleBag(),
      onDash: () => this.input.triggerDash(),
      onTogglePause: () => this.togglePause(),
      onQuitToMenu: () => this.quitToMenu(),
      onSlotAction: (ref, button, quick) => this.moveItems(ref, button, quick),
      onCopySettings: (machineId) => this.copyFrom(machineById(this.world, machineId)),
      onPasteSettings: (machineId) => this.pasteOnto(machineById(this.world, machineId)),
      onTakeAll: (machineId) => this.takeEverything(machineId),
      onSort: (area) => this.sortGrid(area),
      onGather: (ref) => this.gatherInto(ref),
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
    const debug = window as unknown as { __ccgame: Game; __ccfactory: unknown; __ccaudio: unknown };
    debug.__ccgame = this;
    debug.__ccaudio = audio;
    debug.__ccfactory = {
      placeBelt,
      placeMachine,
      placeBuilding,
      placementError,
      factoryPlacementError,
      removeAt,
      setRecipe,
      setFilter,
      setSideFilter,
      setSlotFilter,
      copySettings,
      pasteSettings,
      machineAt,
      clickSlot,
      quickMove,
      takeAll,
      sortArea,
      gatherStacks,
      addItem,
      setResearch: (techId: string | null) => setResearch(this.world, techId),
      openInventory: (machine: Machine | null) => this.hud.openInventory(machine),
    };
  }

  /** Open a save slot: load its island, or generate one the first time. */
  enter(slot: SaveSlot, peaceful = false): void {
    this.slot = slot;
    // Saves skip a section whose text has not changed, so the record of what
    // this tab already wrote has to start empty for whatever slot is opened.
    forgetSlot(slot.id);
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

  private toggleMute(): void {
    const muted = audio.toggleMute();
    this.hud.refreshSound();
    // Unmuting plays its own confirmation; muting cannot, so the toast is it.
    if (!muted) audio.play('click');
    this.hud.toast(muted ? 'Sound off' : 'Sound on', muted ? 'warn' : 'good');
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
    this.requestSave();
  }

  private moveItems(ref: SlotRef, button: ClickButton, quick: boolean): void {
    const machineId = this.hud.inspecting?.id ?? null;
    if (quick) quickMove(this.world, this.self, machineId, ref);
    else clickSlot(this.world, this.self, machineId, ref, button);
  }

  private sortGrid(area: SlotArea): void {
    const machineId = this.hud.inspecting?.id ?? null;
    if (sortArea(this.world, this.self, machineId, area)) this.requestSave();
    else this.hud.toast('Already tidy');
  }

  private gatherInto(ref: SlotRef): void {
    const machineId = this.hud.inspecting?.id ?? null;
    if (gatherStacks(this.world, this.self, machineId, ref)) this.requestSave();
  }

  private takeEverything(machineId: number): void {
    const moved = takeAll(this.world, this.self, machineId);
    if (moved === 0) this.hud.toast('No room in your bag', 'warn');
  }

  private chooseUpgrade(id: string): void {
    if (chooseUpgrade(this.world, this.self, id)) this.requestSave();
  }

  /**
   * Note that an action worth keeping happened. The frame loop's save timer
   * does the writing, so a burst of placements costs one serialisation rather
   * than one each; anything that ends the session flushes with `persist`.
   */
  private requestSave(): void {
    if (!this.running || !this.slot) return;
    this.saveTimer = Math.min(this.saveTimer, SAVE_DEBOUNCE);
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
      // A quick slot picks what to place, so it also turns build mode on; the
      // keys stay dead behind an open screen, like every other build key.
      if (action.startsWith('hotbar') && !blocked) {
        this.hud.useHotbar(Number(action.slice(6)) - 1);
        continue;
      }
      if (action.startsWith('bind') && !blocked) {
        this.hud.bindHotbar(Number(action.slice(4)) - 1);
        continue;
      }

      if (action === 'mute') this.toggleMute();
      if (action === 'build' && !blocked) this.toggleBuild();
      if (action === 'inventory') this.toggleBag();
      if (action === 'rotate' && !blocked) this.buildDir = rotate(this.buildDir);
      if (action === 'remove' && !blocked) this.tryRemove();
      if (action === 'copy' && !blocked) this.copyFrom(this.machineUnderCursor());
      if (action === 'paste' && !blocked) this.pasteOnto(this.machineUnderCursor());
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
    // An upgrade keeps the facing of the machine it replaces, so the ghost does too.
    const replacing = what === 'belt' ? null : upgradeTarget(this.world, what, tx, ty);
    const dir = replacing ? replacing.dir : this.buildDir;
    return { kind: 'grid', what, tx, ty, dir, valid };
  }

  private isUpgrade(ghost: GhostPreview | null): boolean {
    if (ghost?.kind !== 'grid' || ghost.what === 'belt') return false;
    return upgradeTarget(this.world, ghost.what, ghost.tx, ghost.ty) !== null;
  }

  /**
   * What `X` or right-click would take, so removal is aimed at something rather
   * than at wherever the cursor happens to be. Only drawn in build mode, which
   * is also the only mode that removes: outside it the cursor opens a machine,
   * and a demolition outline on the chest you are about to click reads as a
   * warning rather than as the hint it is meant to be.
   */
  private removalTarget(): RemovalPreview | null {
    return this.hud.isBuildMode ? this.targetUnderCursor() : null;
  }

  /** The piece the cursor is over, whatever mode the game is in. */
  private targetUnderCursor(): RemovalPreview | null {
    const pos = this.cursorWorld;
    const { tx, ty } = toTile(pos);

    const entity = entityAt(this.world, tx, ty);
    if (entity) return { kind: 'grid', tx, ty, fixed: false };

    const building = buildingAt(this.world, pos);
    if (building) {
      return {
        kind: 'building',
        pos: building.pos,
        radius: BUILDINGS[building.type].radius,
        // The campfire is the one piece that does not come back down.
        fixed: building.type === 'campfire',
      };
    }
    return null;
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
      this.requestSave();
      return;
    }

    const messages: Record<NonNullable<typeof error>, string> = {
      range: 'Too far from camp',
      terrain: "Can't build there",
      overlap: 'Something is in the way',
      factory: 'A belt or machine is in the way',
      cost: this.costMessage(BUILDINGS[ghost.type].cost),
    };
    audio.play('denied');
    this.hud.toast(messages[error], 'warn');
  }

  private placeFactory(ghost: Extract<GhostPreview, { kind: 'grid' }>): void {
    const { what, tx, ty } = ghost;
    const error = factoryPlacementError(this.world, this.self, what, tx, ty);

    if (error === null) {
      const replacing = what === 'belt' ? null : upgradeTarget(this.world, what, tx, ty);
      if (what === 'belt') placeBelt(this.world, this.self, tx, ty, this.buildDir);
      else placeMachine(this.world, this.self, what, tx, ty, this.buildDir);
      if (replacing) this.hud.toast(`Upgraded to ${MACHINES[replacing.type].name}`, 'good');
      this.requestSave();
      return;
    }

    const cost = what === 'belt' ? BELT_COST : MACHINES[what].cost;
    const messages: Record<NonNullable<typeof error>, string> = {
      bounds: 'Off the edge of the island',
      occupied: 'Something is already there',
      terrain: "Can't build on water",
      ore: 'A miner has to sit on an ore patch',
      scenery: "Clear what's growing there first",
      camp: 'A camp building is in the way',
      cost: this.costMessage(cost),
    };
    audio.play('denied');
    this.hud.toast(messages[error], 'warn');
  }

  private costMessage(cost: ItemStack[]): string {
    return `Need ${cost.map((c) => `${c.count} ${ITEMS[c.id].name}`).join(', ')}`;
  }

  /**
   * Removal is a build-mode action, so `X` and right-click outside it say where
   * removal lives rather than silently taking a piece the player never saw
   * outlined. Silence when the cursor is over nothing removable: right-clicking
   * open grass should not nag.
   */
  private tryRemove(): void {
    if (this.hud.isBuildMode) {
      this.removeUnderCursor();
      return;
    }
    const target = this.targetUnderCursor();
    if (target && !target.fixed) this.hud.toast('Open build mode (B) to remove', 'warn');
  }

  private removeUnderCursor(): void {
    const pos = this.cursorWorld;
    const { tx, ty } = toTile(pos);
    if (removeAt(this.world, this.self, tx, ty)) {
      this.hud.toast('Removed', 'good');
      this.requestSave();
      return;
    }

    // Camp pieces are not on the factory grid, so they need their own pass.
    const target = buildingAt(this.world, pos);
    const damaged = target?.type === 'wall' && target.level < CAMP.wallHp;
    const result = removeBuildingAt(this.world, this.self, pos);
    if (result === 'removed') {
      // Say why the refund came up short, or it reads as materials going missing.
      this.hud.toast(damaged ? 'Removed. Damaged walls refund only what is left of them' : 'Removed', 'good');
      this.requestSave();
      return;
    }
    if (result === 'campfire') {
      audio.play('denied');
      this.hud.toast('The campfire stays — the camp is built around it', 'warn');
      return;
    }
    // Silence here reads as a broken key, so say plainly that nothing was hit.
    audio.play('denied');
    this.hud.toast('Nothing to remove there', 'warn');
  }

  private inspectUnderCursor(): void {
    const machine = this.machineUnderCursor();
    if (machine) this.hud.openInventory(machine);
  }

  private machineUnderCursor(): Machine | null {
    const { tx, ty } = toTile(this.cursorWorld);
    return machineAt(this.world, tx, ty);
  }

  private copyFrom(machine: Machine | null): void {
    if (!machine) return;
    const name = MACHINES[machine.type].name;
    if (!hasSettings(machine)) {
      this.hud.toast(`A ${name} has no settings to copy`, 'warn');
      return;
    }
    this.clipboard = copySettings(machine);
    this.hud.setClipboard(this.clipboard.family);
    audio.play('click');
    this.hud.toast(`Copied ${name} settings — shift-click to paste`, 'good');
  }

  private pasteOnto(machine: Machine | null): void {
    const copied = this.clipboard;
    if (!machine) return;
    if (!copied) {
      this.hud.toast('Nothing copied yet — shift-right-click a machine first', 'warn');
      return;
    }
    if (MACHINES[machine.type].family !== copied.family) {
      audio.play('denied');
      this.hud.toast(`Those are ${familyName(copied.family)} settings`, 'warn');
      return;
    }
    if (pasteSettings(this.world, machine.id, copied)) {
      audio.play('click');
      this.hud.toast('Settings pasted', 'good');
      this.requestSave();
    } else this.hud.toast('Already set the same way');
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
    // Hovering a machine with its next tier selected is an upgrade, not a
    // demolition, so the removal outline would be a false warning.
    const removal = this.isUpgrade(ghost) ? null : this.removalTarget();
    this.tryPlace(ghost);

    // Placing, removing and anything else driven straight from the UI announces
    // itself outside the tick, and `step` empties the buffer before the loop
    // below ever reads it — so drain what has built up since the last frame.
    this.flush();

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
        this.interpolator.capture(this.world);
        step(this.world, inputs);
        // Before the flush: the cosmetic layers empty the buffer.
        this.announceResearch();
        this.flush();
        this.announcePhase();
      }

      this.saveTimer -= elapsed;
      if (this.saveTimer <= 0) {
        this.saveTimer = SAVE_INTERVAL;
        this.persist();
      }
    }

    this.renderer.effects.update(elapsed);
    // Everything from here to `restore` sees positions blended between the
    // last two ticks, the camera included: following the raw position would
    // put the tick rate straight back into the scroll.
    const alpha = Math.min(this.accumulator / TICK_DT, 1);
    this.interpolator.apply(this.world, alpha);
    try {
      this.renderer.camera.follow(this.self.pos, elapsed);
      // The ear rides the camera, not the player: what you can see is what you
      // should be able to hear.
      audio.listenFrom(this.renderer.camera.pos, this.renderer.camera.width / this.renderer.camera.zoom);
      const time = this.world.time - (1 - alpha) * TICK_DT;
      this.renderer.render(this.world, this.selfId, time, ghost, removal);
    } finally {
      this.interpolator.restore();
    }
    audio.update(this.world, elapsed);
    this.hud.update(this.world, this.self);
  }

  /** A finished tech is a milestone, and the only sign a lab gives of one. */
  private announceResearch(): void {
    for (const event of this.world.events) {
      if (event.kind !== 'research') continue;

      const tech = TECH_BY_ID.get(event.tech);
      const name = tech?.repeatable ? `${tech.name} ${event.level}` : (tech?.name ?? event.tech);
      const next = event.next ? TECH_BY_ID.get(event.next) : null;
      this.hud.toast(
        next ? `Researched ${name}. Labs moved to ${next.name}.` : `Researched ${name}`,
        'good',
      );
      this.requestSave();
    }
  }

  /** Hand one batch of simulation events to the cosmetic layers, once. */
  private flush(): void {
    if (this.world.events.length === 0) return;
    this.renderer.effects.consume(this.world.events);
    this.renderer.noteEvents(this.world.events);
    audio.consume(this.world.events);
    this.world.events.length = 0;
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

/** What a family is called, by the name of its first tier. */
function familyName(family: MachineFamily): string {
  const def = Object.values(MACHINES).find((d) => d.family === family && d.tier === 1);
  return def?.name ?? family;
}
