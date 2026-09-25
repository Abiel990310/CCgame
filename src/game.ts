import { BUILDINGS } from '@shared/data/buildings';
import { applyOrder, type Command } from '@shared/sim/commands';
import { CRAFT_BY_ID } from '@shared/data/crafting';
import { BELT_COST, MACHINES, placementCost } from '@shared/data/machines';
import { ITEMS, RESOURCES } from '@shared/data/items';
import { MOBS } from '@shared/data/mobs';
import { BEACON_STAGES } from '@shared/data/beacon';
import { CAMP, TICK_DT } from '@shared/sim/constants';
import {
  buildingAt,
  placeBuilding,
  placementError,
} from '@shared/sim/building';
import {
  clickSlot,
  gatherStacks,
  machineById,
  quickMove,
  sortArea,
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
  beltAt,
} from '@shared/sim/factory';
import { rotate, step1, tileCenter, tileKey, toTile } from '@shared/sim/grid';
import { TECH_BY_ID, UNLOCKED_BY } from '@shared/data/techs';
import { setResearch } from '@shared/sim/research';
import { GOAL_BY_ID } from '@shared/data/goals';
import { GraphicsPanel } from './ui/graphics';
import { GoalTracker } from './ui/goals';
import { WorldMap, type MapTab } from './ui/worldmap';
import { Ledger, loadLedger, saveLedger } from './ledger';
import { EMPTY_INPUT, step } from '@shared/sim/step';
import { addItem } from '@shared/sim/inventory';
import { craftError, nearWorkbench } from '@shared/sim/crafting';
import type {
  Belt,
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
import { forgetSlot, loadWorld, saveWorld, type LoadNotes } from './save';
import { touchSlot, type SaveSlot } from './saves';
import { SlotLock, type EvictReason } from './tablock';
import { CoopGuest } from './net/guest';
import { GuestBook } from './net/guests';
import { CoopHost } from './net/host';
import { CoopPanel, playerName } from './ui/coop';
import { Hud } from './ui/hud';
import { Inspector } from './ui/inspect';
import { WorkbenchScreen } from './ui/workbench';

/** A finger has no hover and no E key, so its prompts say so. */
const COARSE = matchMedia('(pointer: coarse)');

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
  /** Hand control back to the main menu, with a line to show there if any. */
  onQuit: (notice?: string) => void;
}

export class Game {
  private world: World;
  private selfId = 0;
  /** The save this session is playing into. Null while the menu is up. */
  private slot: SaveSlot | null = null;
  private renderer: Renderer;
  private input: InputManager;
  private hud: Hud;
  private graphics: GraphicsPanel | null = null;
  private goals: GoalTracker;
  private worldMap: WorldMap;
  /** What the factory makes a minute; the island's own, or a blank one off a guest. */
  private ledger = new Ledger();

  private accumulator = 0;
  private readonly interpolator = new Interpolator();
  private lastFrame = 0;
  private saveTimer = SAVE_INTERVAL;
  private running = false;
  /** True while the menu is up and the island drifts past behind it. */
  private showcasing = false;
  private showcaseFocus = { x: 0, y: 0 };
  private lastPhase: World['phase'] = 'day';
  /** Facing applied to the next belt or machine placed. */
  private buildDir: Direction = 0;
  /**
   * The last machine settings copied. It belongs to this player's hands rather
   * than the island, so it is neither saved nor shared.
   */
  private clipboard: MachineSettings | null = null;
  private inspector: Inspector;
  private workbench: WorkbenchScreen;
  /** The line being laid while the button is held: the last tile and what went down. */
  private drag: { tx: number; ty: number; laid: Set<number> } | null = null;
  private lock = new SlotLock((slot, reason) => this.evict(slot, reason));
  /** Set while friends can join this island; the world here is the real one. */
  private host: CoopHost | null = null;
  /** Set while playing on a friend's island; the world here is a copy of theirs. */
  private guest: CoopGuest | null = null;
  private coop: CoopPanel;

  constructor(canvas: HTMLCanvasElement, private callbacks: GameCallbacks) {
    this.renderer = new Renderer(canvas);
    this.input = new InputManager(canvas);
    const graphics = document.getElementById('pause-graphics');
    if (graphics) this.graphics = new GraphicsPanel(graphics, this.renderer);
    const ui = document.getElementById('ui') ?? document.body;
    this.inspector = new Inspector(ui, () => this.toggleCrafting());
    this.workbench = new WorkbenchScreen(ui, {
      onCraft: (id) => this.craftItem(id),
      onClose: () => this.closeCrafting(),
    });
    this.hud = new Hud({
      onChooseUpgrade: (id) => this.chooseUpgrade(id),
      onToggleBuild: () => this.toggleBuild(),
      onTurn: () => (this.buildDir = rotate(this.buildDir)),
      onSelect: () => this.hud.setBuildMode(true),
      onSetRecipe: (machineId, recipeId) => {
        if (this.act({ k: 'recipe', machine: machineId, recipe: recipeId })) this.requestSave();
      },
      onSetResearch: (techId) => {
        if (this.act({ k: 'research', tech: techId })) this.requestSave();
      },
      onSetFilter: (machineId, item) => {
        if (this.act({ k: 'filter', machine: machineId, item })) this.requestSave();
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

    this.goals = new GoalTracker(document.getElementById('ui')!);
    this.worldMap = new WorldMap(document.getElementById('ui')!, () => this.worldMap.setOpen(false));
    document.getElementById('btn-map')!.addEventListener('click', () => this.toggleMap());
    this.coop = new CoopPanel({
      onHost: () => this.startHosting(),
      onStopHosting: () => this.stopHosting('The host stopped inviting.'),
    });

    // A host's tab in the background gets no animation frames, and the island
    // would stop for everyone on it. Timers still run there, if slowly.
    window.setInterval(() => {
      if (!document.hidden || !this.running || !this.host) return;
      const now = performance.now();
      const elapsed = Math.min((now - this.lastFrame) / 1000, 1.5);
      this.lastFrame = now;
      this.simulate(elapsed, EMPTY_INPUT, 50);
    }, 100);

    this.world = createWorld(Date.now() & 0xffff);
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('beforeunload', () => {
      const slot = this.slot;
      this.persist();
      if (slot) this.lock.release(slot.id);
    });
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
  async enter(slot: SaveSlot, peaceful = false): Promise<void> {
    // Another tab playing this island gets to save before it is read, so the
    // island is loaded as that tab left it rather than as of its last autosave.
    await this.lock.claim(slot.id);
    this.slot = slot;
    // Saves skip a section whose text has not changed, so the record of what
    // this tab already wrote has to start empty for whatever slot is opened.
    forgetSlot(slot.id);
    const notes: LoadNotes = {};
    const loaded = loadWorld(slot.id, notes);
    this.ledger = loadLedger(slot.id);

    if (loaded) {
      this.world = loaded;
      const first = this.world.players.values().next().value as Player | undefined;
      this.selfId = first?.id ?? addPlayer(this.world, 'You').id;
      this.hud.toast(
        notes.regenerated
          ? `${slot.name} — the land has been regrown; what you built is where you left it`
          : `${slot.name} — night ${this.world.nightIndex} survived`,
        notes.regenerated ? 'warn' : 'good',
      );
    } else {
      this.world = createWorld(Date.now() & 0xffff, peaceful);
      this.selfId = addPlayer(this.world, 'You').id;
      this.hud.toast(
        peaceful ? `${slot.name}. A peaceful island — build freely.` : `${slot.name}. Go gather.`,
        'good',
      );
    }

    this.begin();
  }

  /** Everything entering an island shares, however it was reached. */
  private begin(): void {
    this.showcasing = false;
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

  /**
   * Draw the island behind the main menu: the one just played, standing where
   * it was left, or the freshly generated one the game boots with. Nothing is
   * simulated — the camera drifts and the scenery sways — so the menu costs a
   * render and never touches a save.
   */
  showcase(): void {
    if (this.running || this.showcasing) return;
    this.showcasing = true;
    const first = this.world.players.values().next().value as Player | undefined;
    this.showcaseFocus = first ? { ...first.pos } : { ...this.world.camp };
    this.renderer.resize();
    requestAnimationFrame((t) => this.showcaseFrame(t));
  }

  private showcaseFrame(now: number): void {
    if (!this.showcasing || this.running) {
      this.showcasing = false;
      return;
    }
    requestAnimationFrame((t) => this.showcaseFrame(t));

    const t = now / 1000;
    const camera = this.renderer.camera;
    // A slow Lissajous loop, so the view never visibly repeats or stops.
    camera.pos = {
      x: this.showcaseFocus.x + Math.cos(t * 0.045) * 150 + 60,
      y: this.showcaseFocus.y + Math.sin(t * 0.063) * 90,
    };
    this.renderer.render(this.world, this.selfId, t, null, null);
  }

  private toggleMap(tab: MapTab = 'map'): void {
    // The other tab's key switches over rather than closing the sheet.
    const open = !this.worldMap.isOpen || this.worldMap.currentTab !== tab;
    // The map is a look, not a mode: it takes the place of whatever screen was up.
    if (open) {
      this.closeCrafting();
      this.closeInventory();
      this.hud.setBuildMode(false);
    }
    this.worldMap.setOpen(open, tab);
    audio.play('click');
  }

  private toggleMute(): void {
    const muted = audio.toggleMute();
    this.hud.refreshSound();
    // Unmuting plays its own confirmation; muting cannot, so the toast is it.
    if (!muted) audio.play('click');
    this.hud.toast(muted ? 'Sound off' : 'Sound on', muted ? 'warn' : 'good');
  }

  private togglePause(): void {
    if (!this.slot && !this.guest) return;
    const open = !this.hud.isPauseOpen;
    if (open) {
      this.closeInventory();
      this.persist();
      this.hud.setBuildMode(false);
      if (this.slot) this.hud.setPauseOpen(true, this.slot.name, `Night ${this.world.nightIndex} · saved just now`);
      else this.hud.setPauseOpen(true, "A friend's island", `Night ${this.world.nightIndex} · the host keeps the save`);
      this.coop.refreshPause();
      this.graphics?.refresh();
    } else {
      // Coming back from a pause must not fast-forward the missed seconds.
      this.lastFrame = performance.now();
      this.hud.setPauseOpen(false);
    }
  }

  private quitToMenu(): void {
    this.persist();
    this.stopHosting('The host closed the island.');
    if (this.guest) {
      this.guest.leave();
      this.guest = null;
    }
    if (this.slot) this.lock.release(this.slot.id);
    this.leave();
    this.callbacks.onQuit();
  }

  /** Open this island to friends, and show the code they join with. */
  private async startHosting(): Promise<string> {
    if (this.host) return this.host.code;
    const slot = this.slot;
    if (!slot) throw new Error('Open an island first');
    const host = await CoopHost.open(new GuestBook(slot.id), {
      onRoster: (names, news) => {
        this.hud.toast(news, 'good');
        this.coop.setRoster(names);
      },
      onTrouble: (reason) => this.hud.toast(`${reason}. Friends already here keep playing.`, 'warn'),
    });
    // The island may have been closed while the room was opening.
    if (this.slot !== slot || !this.running) {
      host.close(this.world, 'The host closed the island.');
      throw new Error('The island was closed');
    }
    this.host = host;
    // Everyone sees a name over each head, so the host needs one too.
    this.self.name = playerName();
    this.coop.setHosting(host.code, host.names(this.world));
    return host.code;
  }

  private stopHosting(reason: string): void {
    const host = this.host;
    if (!host) return;
    this.host = null;
    host.close(this.world, reason);
    this.coop.setSolo();
  }

  /** Step onto a friend's island, as a copy of their world that follows theirs. */
  async joinGame(code: string, name: string): Promise<void> {
    const guest = await CoopGuest.join(code, name, guestToken());
    guest.onEnd = (reason) => {
      if (this.guest !== guest) return;
      this.guest = null;
      this.leave();
      this.callbacks.onQuit(reason);
    };
    if (this.slot) {
      this.persist();
      this.stopHosting('The host closed the island.');
      this.lock.release(this.slot.id);
    }
    this.guest = guest;
    this.slot = null;
    this.world = guest.world!;
    this.selfId = guest.selfId!;
    this.ledger = new Ledger();
    this.accumulator = 0;
    this.interpolator.capture(this.world);
    this.hud.toast('Joined your friend\'s island', 'good');
    this.coop.setGuest(code, [...this.world.players.values()].map((p) => p.name));
    this.begin();
  }

  private leave(): void {
    this.running = false;
    this.slot = null;
    this.coop.setSolo();
    this.hud.setPauseOpen(false);
    this.hud.setBuildMode(false);
    this.hud.closeInventory();
  }

  /**
   * Another tab has opened this island. Save what this one has if it is still
   * allowed to, then step back to the menu: carrying on would mean two copies
   * of one factory, each quietly overwriting the other.
   */
  private evict(slot: string, reason: EvictReason): void {
    if (this.slot?.id !== slot) return;
    const name = this.slot.name;
    if (reason === 'handover') {
      if (this.hud.isInventoryOpen) this.act({ k: 'stow' });
      this.persist();
    }
    this.stopHosting('The host closed the island.');
    this.leave();
    this.callbacks.onQuit(
      reason === 'handover'
        ? `${name} was opened in another tab, so it was saved and closed here.`
        : `${name} was opened in another tab, so it was closed here.`,
    );
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

  /** Open the workbench screen when standing at one, or say what is missing. */
  private toggleCrafting(): void {
    if (this.workbench.isOpen) {
      this.closeCrafting();
      return;
    }
    if (!nearWorkbench(this.world, this.self)) {
      const any = this.world.buildings.some((b) => b.type === 'workbench');
      audio.play('denied');
      this.hud.toast(
        any ? 'Walk up to a workbench to craft' : 'Build a workbench first: Build (B), then Camp',
        'warn',
      );
      return;
    }
    this.hud.setBuildMode(false);
    this.closeInventory();
    audio.play('open');
    this.workbench.show();
  }

  private closeCrafting(): void {
    if (!this.workbench.isOpen) return;
    audio.play('close');
    this.workbench.hide();
  }

  private craftItem(id: string): void {
    const error = craftError(this.world, this.self, id);
    const recipe = CRAFT_BY_ID.get(id);
    if (error === null && recipe && this.act({ k: 'craft', id })) {
      const name = ITEMS[recipe.output].name;
      this.flush();
      this.workbench.pulse(id);
      this.hud.toast(`Crafted ${name}`, 'good');
      this.requestSave();
      return;
    }
    const def = CRAFT_BY_ID.get(id);
    const messages: Record<NonNullable<typeof error>, string> = {
      unknown: 'Nothing to craft there',
      far: 'Walk up to a workbench to craft',
      locked: def?.unlock ? `Research ${UNLOCKED_BY.get(def.unlock)?.name ?? 'more'} first` : 'Locked',
      cost: def ? this.costMessage(def.cost) : 'Missing materials',
      room: 'No room in your bag',
    };
    audio.play('denied');
    this.hud.toast(messages[error ?? 'unknown'], 'warn');
  }

  private toggleBag(): void {
    if (this.hud.isInventoryOpen) this.closeInventory();
    else this.hud.openInventory(null);
  }

  /** Closing always puts the held stack away, so a drag can never lose items. */
  private closeInventory(): void {
    if (!this.hud.isInventoryOpen) return;
    this.act({ k: 'stow' });
    this.hud.closeInventory();
    this.requestSave();
  }

  private moveItems(ref: SlotRef, button: ClickButton, quick: boolean): void {
    const machineId = this.hud.inspecting?.id ?? null;
    if (quick) this.act({ k: 'quick', machine: machineId, ref });
    else this.act({ k: 'click', machine: machineId, ref, button });
  }

  private sortGrid(area: SlotArea): void {
    const machineId = this.hud.inspecting?.id ?? null;
    if (this.act({ k: 'sort', machine: machineId, area })) this.requestSave();
    else this.hud.toast('Already tidy');
  }

  private gatherInto(ref: SlotRef): void {
    const machineId = this.hud.inspecting?.id ?? null;
    if (this.act({ k: 'gather', machine: machineId, ref })) this.requestSave();
  }

  private takeEverything(machineId: number): void {
    if (!this.act({ k: 'takeAll', machine: machineId })) this.hud.toast('No room in your bag', 'warn');
  }

  private chooseUpgrade(id: string): void {
    if (this.act({ k: 'upgrade', id })) this.requestSave();
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
    // A tab that has lost the island must not write it, even once: its copy is
    // older than the one the other tab is now playing and saving.
    if (!this.lock.owns(this.slot.id)) {
      this.evict(this.slot.id, 'taken');
      return;
    }
    const host = this.host;
    // Friends' characters are kept beside the save, not in it, so a solo
    // session never finds them standing idle at camp.
    const own = host
      ? { ...this.world, players: new Map([...this.world.players].filter(([id]) => !host.isGuest(id))) }
      : this.world;
    host?.keep(this.world);
    if (!saveWorld(own, this.slot.id)) return;
    saveLedger(this.slot.id, this.ledger);
    touchSlot(this.slot.id, {
      night: this.world.nightIndex,
      level: this.self.level,
      playSeconds: Math.round(this.world.tick * TICK_DT),
    });
  }

  private handleActions(): void {
    // Build keys must not reach the world through an open screen: pressing X
    // while sorting a chest should not also demolish whatever is behind it.
    const blocked =
      this.hud.isInventoryOpen ||
      this.hud.isPauseOpen ||
      this.hud.isDraftOpen ||
      this.workbench.isOpen ||
      this.worldMap.isOpen;

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
      if (action === 'map' && !this.hud.isPauseOpen && !this.hud.isDraftOpen) this.toggleMap();
      if (action === 'ledger' && !this.hud.isPauseOpen && !this.hud.isDraftOpen) this.toggleMap('ledger');
      if (action === 'build' && !blocked) this.toggleBuild();
      if (action === 'inventory') {
        this.closeCrafting();
        this.toggleBag();
      }
      if (action === 'craft' && !this.hud.isPauseOpen) this.toggleCrafting();
      if (action === 'rotate' && !blocked) this.buildDir = rotate(this.buildDir);
      if (action === 'remove' && !blocked) this.tryRemove();
      if (action === 'copy' && !blocked) this.copyFrom(this.machineUnderCursor());
      if (action === 'paste' && !blocked) this.pasteOnto(this.machineUnderCursor());
      if (action === 'upgrade' && !blocked) this.hud.openDraft();
      if (action === 'cancel') {
        // Esc backs out of whatever is open, and opens the menu when nothing is.
        if (this.worldMap.isOpen) this.worldMap.setOpen(false);
        else if (this.hud.isDraftOpen) this.hud.closeDraft();
        else if (this.hud.isPauseOpen) this.togglePause();
        else if (this.workbench.isOpen) this.closeCrafting();
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

    if (ghost.kind === 'building') {
      this.placeCampBuilding(ghost);
      return;
    }
    const placed = this.placeFactory(ghost);
    if (placed) this.input.cancelHold();
    // A press on a piece already down still starts a line from it, which is
    // how a finished belt gets extended.
    this.drag = { tx: ghost.tx, ty: ghost.ty, laid: placed ? new Set([tileKey(ghost.tx, ghost.ty)]) : new Set() };
  }

  /**
   * Holding the button (or a finger) and sweeping lays a line, one piece per
   * tile crossed. A belt line faces the way it is being drawn, which is also
   * the only way a phone gets to choose a belt's direction.
   */
  private dragPlace(ghost: GhostPreview | null): void {
    const drag = this.drag;
    if (!drag) return;
    if (!this.input.pointerDown || !ghost || ghost.kind !== 'grid') {
      this.drag = null;
      return;
    }
    let dx = ghost.tx - drag.tx;
    let dy = ghost.ty - drag.ty;
    if (dx === 0 && dy === 0) return;

    // Follow one axis at a time, like a belt would, so a diagonal sweep makes
    // a staircase of connected belts instead of a scatter.
    let guard = 0;
    while ((dx !== 0 || dy !== 0) && guard++ < 24) {
      const dir: Direction =
        Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
      if (ghost.what === 'belt') {
        this.buildDir = dir;
        // The belt the line starts from only now learns which way it runs.
        if (drag.laid.has(tileKey(drag.tx, drag.ty)) || beltAt(this.world, drag.tx, drag.ty)) {
          this.act({ k: 'turn', tx: drag.tx, ty: drag.ty, dir });
        }
      }
      const next = step1(drag.tx, drag.ty, dir);
      drag.tx = next.tx;
      drag.ty = next.ty;
      const error = factoryPlacementError(this.world, this.self, ghost.what, next.tx, next.ty);
      if (error === null) {
        this.placeFactory({ ...ghost, tx: next.tx, ty: next.ty });
        drag.laid.add(tileKey(next.tx, next.ty));
      } else if (error === 'cost') {
        this.placeFactory({ ...ghost, tx: next.tx, ty: next.ty });
        this.drag = null;
        return;
      }
      dx = ghost.tx - drag.tx;
      dy = ghost.ty - drag.ty;
    }
    this.requestSave();
  }

  private placeCampBuilding(ghost: Extract<GhostPreview, { kind: 'building' }>): void {
    const error = placementError(this.world, this.self, ghost.type, ghost.pos);
    if (error === null) {
      this.act({ k: 'building', type: ghost.type, x: ghost.pos.x, y: ghost.pos.y });
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

  /** Place the selected piece, or say why not. True when something went down. */
  private placeFactory(ghost: Extract<GhostPreview, { kind: 'grid' }>): boolean {
    const { what, tx, ty } = ghost;
    const error = factoryPlacementError(this.world, this.self, what, tx, ty);

    if (error === null) {
      const replacing = what === 'belt' ? null : upgradeTarget(this.world, what, tx, ty);
      if (what === 'belt') this.act({ k: 'belt', tx, ty, dir: this.buildDir });
      else this.act({ k: 'machine', what, tx, ty, dir: this.buildDir });
      if (replacing) this.hud.toast(`Upgraded to ${MACHINES[replacing.type].name}`, 'good');
      this.requestSave();
      return true;
    }

    // Placing a belt on a belt turns it: to the chosen direction with a mouse,
    // a quarter turn per tap with a finger, which has no R key. A finger turns
    // machines the same way, since it has no other way to reach one already down.
    let existing: Belt | Machine | null = null;
    if (error === 'occupied') {
      if (this.input.isTouch) existing = entityAt(this.world, tx, ty);
      else if (what === 'belt') existing = beltAt(this.world, tx, ty);
    }
    if (existing) {
      const dir = this.input.isTouch ? rotate(existing.dir) : this.buildDir;
      // A finger that stays down removes the belt anyway, so the hold is
      // left armed: turning something about to go costs nothing.
      if (existing.dir !== dir && this.act({ k: 'turn', tx, ty, dir })) {
        this.buildDir = dir;
        this.requestSave();
      }
      return false;
    }
    // A finger resting on a piece is about to remove it, not to be told off.
    if (error === 'occupied' && this.input.isTouch) return false;

    const cost = what === 'belt' ? BELT_COST : placementCost(what);
    const messages: Record<NonNullable<typeof error>, string> = {
      bounds: 'Off the edge of the island',
      occupied: 'Something is already there',
      terrain: "Can't build on water",
      ore: 'A miner has to sit on an ore patch',
      shore: 'A fish trap has to sit on the shoreline',
      locked: what === 'belt' ? '' : `Research ${UNLOCKED_BY.get(what)?.name ?? 'more'} first`,
      scenery: "Clear what's growing there first",
      camp: 'A camp building is in the way',
      cost:
        what !== 'belt' && MACHINES[what].crafted
          ? `Craft a ${MACHINES[what].name} at a workbench first`
          : this.costMessage(cost),
    };
    audio.play('denied');
    this.hud.toast(messages[error], 'warn');
    return false;
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
    // Checked here rather than read off the result, because a guest's removal
    // only happens once the host has applied it.
    if (entityAt(this.world, tx, ty)) {
      this.act({ k: 'remove', tx, ty });
      this.hud.toast('Removed', 'good');
      this.requestSave();
      return;
    }

    // Camp pieces are not on the factory grid, so they need their own pass.
    const target = buildingAt(this.world, pos);
    const damaged = target?.type === 'wall' && target.level < CAMP.wallHp;
    const result = !target ? 'none' : target.type === 'campfire' ? 'campfire' : 'removed';
    if (result === 'removed') {
      this.act({ k: 'removeBuilding', x: pos.x, y: pos.y });
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
    // A pole holds nothing; its hover card already says all there is to know.
    if (machine && MACHINES[machine.type].family === 'pole') return;
    if (machine) {
      this.hud.openInventory(machine);
      return;
    }
    if (buildingAt(this.world, this.cursorWorld)?.type === 'workbench') this.toggleCrafting();
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
    if (this.act({ k: 'paste', machine: machine.id, settings: copied })) {
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

    const paused = this.hud.isDraftOpen || this.hud.isPauseOpen;
    // Inspecting a machine should not also swing the pickaxe at it.
    if (this.hud.isInventoryOpen || this.workbench.isOpen || this.worldMap.isOpen) this.input.takeClick();
    const ghost = this.ghost();
    // Hovering a machine with its next tier selected is an upgrade, not a
    // demolition, so the removal outline would be a false warning.
    const removal = this.isUpgrade(ghost) ? null : this.removalTarget();
    this.input.buildMode = this.hud.isBuildMode;
    this.tryPlace(ghost);
    this.dragPlace(ghost);

    // Placing, removing and anything else driven straight from the UI announces
    // itself outside the tick, and `step` empties the buffer before the loop
    // below ever reads it — so drain what has built up since the last frame.
    this.flush();

    // An open level-up draft freezes the world, so choosing is never a panic.
    // With friends on the island nobody gets to stop the clock for everyone,
    // so it only stops this player.
    const raw = this.input.sample();
    // Building mode repurposes the click, so suppress gathering while placing.
    // An open inventory stops the player entirely: sorting a chest should not
    // also walk you off it. The world keeps ticking behind it either way.
    const playerInput: PlayerInput = paused || this.hud.isInventoryOpen || this.workbench.isOpen || this.worldMap.isOpen
      ? { move: { x: 0, y: 0 }, dash: false, interact: false }
      : this.hud.isBuildMode
        ? { ...raw, interact: false }
        : raw;
    if (this.guest) this.simulateGuest(this.guest, elapsed, playerInput);
    else if (!paused || this.host) this.simulate(elapsed, playerInput, 8);

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
    this.goals.update(this.world, this.self, elapsed, this.input.isTouch);
    this.ledger.advance(this.world.time);
    this.worldMap.update(this.world, this.selfId, elapsed, this.ledger);
    this.hud.updateStick(this.input.stickState);
    this.hud.foldPalette(this.hud.isBuildMode && this.input.hovering);
    // A raid can shove the player off the bench; the screen goes with them.
    if (this.workbench.isOpen && !nearWorkbench(this.world, this.self)) this.closeCrafting();
    this.workbench.update(this.world, this.self);
    this.inspector.update({
      world: this.world,
      self: this.self,
      camera: this.renderer.camera,
      pointer: this.input.pointer,
      hovering: this.input.hovering,
      busy: paused || this.hud.isBuildMode || this.hud.isInventoryOpen || this.workbench.isOpen,
      touch: COARSE.matches,
    });
  }

  /**
   * Run the island forward on this machine: solo, or as the host whose world
   * everyone else follows.
   */
  private simulate(elapsed: number, own: PlayerInput, maxTicks: number): void {
    this.accumulator += elapsed;
    const host = this.host;

    let ticks = 0;
    while (this.accumulator >= TICK_DT && ticks++ < maxTicks) {
      this.accumulator -= TICK_DT;
      this.interpolator.capture(this.world);
      let inputs = new Map<number, PlayerInput>([[this.selfId, own]]);
      for (const id of this.world.players.keys()) {
        if (id !== this.selfId) inputs.set(id, EMPTY_INPUT);
      }
      if (host) {
        host.beforeStep(this.world);
        // Guests' orders announce themselves too, and `step` would clear them.
        this.flush();
        inputs = host.inputs(this.world, inputs);
      }
      step(this.world, inputs);
      // Before the flush: the cosmetic layers empty the buffer.
      this.announceResearch();
      this.announceGoals();
      this.announceDryMiners();
      this.flush();
      this.announcePhase();
      host?.afterStep(this.world, inputs);
    }
    // A host that fell far behind drops the backlog rather than fast-forwarding
    // everyone through it.
    if (ticks > maxTicks) this.accumulator = 0;

    this.saveTimer -= elapsed;
    if (this.saveTimer <= 0) {
      this.saveTimer = SAVE_INTERVAL;
      this.persist();
    }
  }

  /**
   * Play the host's ticks as they arrive. A tick or two queued is the cushion
   * that keeps motion smooth over an uneven connection; more than a few means
   * this copy has fallen behind, and it catches up rather than staying late.
   */
  private simulateGuest(guest: CoopGuest, elapsed: number, own: PlayerInput): void {
    guest.sendInput(own);
    if (guest.world && guest.world !== this.world) {
      // A fresh snapshot replaced the old copy after a mismatch.
      this.world = guest.world;
      this.interpolator.capture(this.world);
    }
    this.accumulator += elapsed;
    let ticks = 0;
    while (guest.backlog > 0 && ticks < 8 && (this.accumulator >= TICK_DT || guest.backlog > 3)) {
      ticks++;
      this.accumulator = Math.max(0, this.accumulator - TICK_DT);
      this.interpolator.capture(this.world);
      guest.advance(() => {
        this.announceResearch();
        this.announceGoals();
        this.announceDryMiners();
        this.flush();
      });
      this.announcePhase();
    }
    if (guest.backlog === 0) this.accumulator = Math.min(this.accumulator, TICK_DT);
  }

  /**
   * Do something to the island. Solo it happens now; a host does it now and
   * owes it to every guest; a guest asks the host, and sees it happen when the
   * host's next tick comes back. The result is only meaningful off a guest.
   */
  private act(command: Command): boolean {
    const order = { p: this.selfId, c: command };
    if (this.guest) {
      this.guest.command(command);
      return true;
    }
    const result = this.host ? this.host.apply(this.world, order) : applyOrder(this.world, order);
    return result === true;
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
      // Only the first level of a tech opens anything.
      if (tech?.unlocks?.length && event.level === 1) {
        const names = tech.unlocks.map((id) => MACHINES[id].name).join(', ');
        this.hud.toast(`New on the build palette: ${names}`, 'good');
      }
      this.requestSave();
    }
  }

  /**
   * A miner that has emptied its reach is otherwise indistinguishable from
   * one whose belt backed up. Several going at once, as a patch's miners
   * tend to, make one toast rather than a column of them.
   */
  private announceDryMiners(): void {
    const dry = this.world.events.filter((e) => e.kind === 'minerDry');
    if (dry.length === 0) return;
    const ore = dry[0].kind === 'minerDry' ? ITEMS[dry[0].ore].name.toLowerCase() : 'ore';
    const how = this.input.isTouch ? 'Open the map' : 'Press M';
    this.hud.toast(
      dry.length === 1
        ? `A miner ran out of ${ore}. ${how} to find it.`
        : `${dry.length} miners ran their patches dry. ${how} to find them.`,
      'warn',
    );
  }

  /** Goals and level-ups are said once, and the tracker makes way for the next goal. */
  private announceGoals(): void {
    for (const event of this.world.events) {
      if (event.kind === 'landmark' && event.playerId === this.selfId) {
        const found = RESOURCES[event.landmark].name;
        this.hud.toast(
          RESOURCES[event.landmark].landmark?.boon === 'upgrade'
            ? `${found} searched. It grants you an upgrade.`
            : `${found} searched`,
          'good',
        );
        continue;
      }
      if (event.kind === 'beacon') {
        const stage = BEACON_STAGES[event.stage - 1];
        const next = BEACON_STAGES[event.stage];
        this.hud.toast(
          event.lit
            ? 'The Skyward Beacon is lit. The whole island can see it.'
            : `Beacon: ${stage.name} raised. Next, the ${next.name.toLowerCase()}.`,
          'good',
        );
        this.requestSave();
        continue;
      }
      if (event.kind === 'boss') {
        this.hud.toast(`${MOBS[event.type].name} is coming for the camp`, 'warn');
        continue;
      }
      // The first level-up in a queue says how to spend it; the ring's badge
      // counts any that follow, so a busy lab does not chatter.
      if (event.kind === 'levelUp' && event.playerId === this.selfId && this.self.pendingUpgrades === 1) {
        const how = this.input.isTouch ? 'Tap your level' : 'Press U';
        this.hud.toast(`Level ${event.level}! ${how} to pick an upgrade`, 'good');
        continue;
      }
      if (event.kind !== 'goal' || event.playerId !== this.selfId) continue;
      const done = GOAL_BY_ID.get(event.goal);
      const next = event.next ? GOAL_BY_ID.get(event.next) : null;
      if (done) this.hud.toast(next ? `Goal done: ${done.title}` : 'Every goal done. The island is yours to grow.', 'good');
      this.goals.completed();
      this.requestSave();
    }
  }

  /** Hand one batch of simulation events to the cosmetic layers, once. */
  private flush(): void {
    if (this.world.events.length === 0) return;
    // A friend's pickups are theirs to hear about; seeing "+2 Wood" float over
    // someone else reads as your own bag filling up.
    const events = this.world.events.filter((e) => e.kind !== 'collected' || e.playerId === this.selfId);
    this.ledger.record(this.world.events, this.world.time);
    this.renderer.effects.consume(events);
    this.renderer.noteEvents(this.world.events);
    audio.consume(events);
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

/**
 * Who this browser is on other people's islands. A host keeps a friend's
 * character under it, so coming back finds the same bag and level.
 */
function guestToken(): string {
  const key = 'ccgame.coop.token';
  try {
    const known = localStorage.getItem(key);
    if (known) return known;
    const token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(key, token);
    return token;
  } catch {
    return 'guest';
  }
}

/** What a family is called, by the name of its first tier. */
function familyName(family: MachineFamily): string {
  const def = Object.values(MACHINES).find((d) => d.family === family && d.tier === 1);
  return def?.name ?? family;
}
