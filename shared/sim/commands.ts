import { BUILDINGS } from '../data/buildings';
import { CRAFT_BY_ID } from '../data/crafting';
import { ITEMS } from '../data/items';
import { MACHINES } from '../data/machines';
import { RECIPE_BY_ID } from '../data/recipes';
import { SPELLS } from '../data/spells';
import { TECH_BY_ID } from '../data/techs';
import { placeBuilding, removeBuildingAt } from './building';
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
} from './containers';
import { craft } from './crafting';
import {
  pasteSettings,
  placeBelt,
  placeMachine,
  removeAt,
  setFilter,
  setRecipe,
  turnAt,
  type MachineSettings,
} from './factory';
import { chooseUpgrade } from './progression';
import { isQueueOp, orderResearch, setResearch, type QueueOp } from './research';
import { decode, encode } from './snapshot';
import { readySpell } from './systems/spells';
import type { BuildingId, Direction, ItemId, MachineId, Player, SpellId, World } from './types';

/**
 * Everything a player can do to the island outside of moving, as data.
 *
 * In a solo game the client applies these on the spot. In co-op the host
 * applies them between two ticks and ships them to every guest alongside that
 * tick's inputs, so each copy of the world takes exactly the same changes at
 * exactly the same point — which is all a deterministic sim needs to stay in
 * step. Anything that mutates the world from a click has to be a row here, or
 * guests will quietly drift away from the host.
 */
export type Command =
  | { k: 'belt'; tx: number; ty: number; dir: Direction }
  | { k: 'machine'; what: MachineId; tx: number; ty: number; dir: Direction }
  | { k: 'building'; type: BuildingId; x: number; y: number }
  | { k: 'turn'; tx: number; ty: number; dir: Direction }
  | { k: 'remove'; tx: number; ty: number }
  | { k: 'removeBuilding'; x: number; y: number }
  | { k: 'recipe'; machine: number; recipe: string }
  | { k: 'research'; tech: string | null }
  | { k: 'queue'; tech: string; op: QueueOp }
  | { k: 'filter'; machine: number; item: ItemId | null }
  | { k: 'paste'; machine: number; settings: MachineSettings }
  | { k: 'click'; machine: number | null; ref: SlotRef; button: ClickButton }
  | { k: 'quick'; machine: number | null; ref: SlotRef }
  | { k: 'sort'; machine: number | null; area: SlotArea }
  | { k: 'gather'; machine: number | null; ref: SlotRef }
  | { k: 'takeAll'; machine: number }
  | { k: 'stow' }
  | { k: 'upgrade'; id: string }
  | { k: 'craft'; id: string }
  /** Readies a learned spell for Q. */
  | { k: 'spell'; id: SpellId }
  /** Host only: a player arrives, whole, carrying whatever they had last time. */
  | { k: 'join'; player: Player }
  /** Host only: a player leaves; their character is lifted off the island. */
  | { k: 'leave' };

/** A command and the player it acts for. */
export interface Order {
  p: number;
  c: Command;
}

/** Commands only the host may issue. A guest sending one is ignored. */
export function isHostOnly(command: Command): boolean {
  return command.k === 'join' || command.k === 'leave';
}

/**
 * Apply one order. Returns whether it changed anything; for a camp removal,
 * what happened. Every argument is checked first, because in co-op the order
 * may have come off the wire from someone else's browser and the host must
 * not crash, or be talked into anything, by a malformed one.
 */
export function applyOrder(world: World, order: Order): boolean | 'campfire' {
  const c = order.c;
  if (c.k === 'join') {
    // A copy, so the order itself can still be sent on as it was when applied.
    const player = decode<Player>(encode(c.player));
    world.players.set(player.id, player);
    // A fresh arrival's id was taken from the host's counter; a returning one
    // is older. Either way nothing minted later may reuse it.
    world.nextId = Math.max(world.nextId, player.id + 1);
    return true;
  }

  const player = world.players.get(order.p);
  if (!player) return false;

  switch (c.k) {
    case 'leave':
      return world.players.delete(player.id);
    case 'belt':
      return isTile(c.tx, c.ty) && isDir(c.dir) && placeBelt(world, player, c.tx, c.ty, c.dir) !== null;
    case 'machine':
      return (
        isTile(c.tx, c.ty) &&
        isDir(c.dir) &&
        Object.hasOwn(MACHINES, c.what) &&
        placeMachine(world, player, c.what, c.tx, c.ty, c.dir) !== null
      );
    case 'building':
      return isPoint(c.x, c.y) && Object.hasOwn(BUILDINGS, c.type) && placeBuilding(world, player, c.type, { x: c.x, y: c.y });
    case 'turn':
      return isTile(c.tx, c.ty) && isDir(c.dir) && turnAt(world, c.tx, c.ty, c.dir);
    case 'remove':
      return isTile(c.tx, c.ty) && removeAt(world, player, c.tx, c.ty);
    case 'removeBuilding': {
      if (!isPoint(c.x, c.y)) return false;
      const result = removeBuildingAt(world, player, { x: c.x, y: c.y });
      return result === 'campfire' ? 'campfire' : result === 'removed';
    }
    case 'recipe':
      return isId(c.machine) && RECIPE_BY_ID.has(c.recipe) && setRecipe(world, c.machine, c.recipe);
    case 'research':
      return (c.tech === null || TECH_BY_ID.has(c.tech)) && setResearch(world, c.tech);
    case 'queue':
      return typeof c.tech === 'string' && isQueueOp(c.op) && orderResearch(world, c.tech, c.op);
    case 'filter':
      return isId(c.machine) && isItemOrNull(c.item) && setFilter(world, c.machine, c.item);
    case 'paste':
      return isId(c.machine) && isSettings(c.settings) && pasteSettings(world, c.machine, c.settings);
    case 'click':
      return (
        (c.button === 'left' || c.button === 'right') &&
        isSlot(world, player, c.machine, c.ref) &&
        clickSlot(world, player, c.machine, c.ref, c.button)
      );
    case 'quick':
      return isSlot(world, player, c.machine, c.ref) && quickMove(world, player, c.machine, c.ref);
    case 'sort':
      return isArea(c.area) && isIdOrNull(c.machine) && sortArea(world, player, c.machine, c.area);
    case 'gather':
      return isSlot(world, player, c.machine, c.ref) && gatherStacks(world, player, c.machine, c.ref);
    case 'takeAll':
      return isId(c.machine) && takeAll(world, player, c.machine) > 0;
    case 'stow':
      stowCursor(world, player);
      return true;
    case 'upgrade':
      return typeof c.id === 'string' && chooseUpgrade(world, player, c.id);
    case 'craft':
      return typeof c.id === 'string' && CRAFT_BY_ID.has(c.id) && craft(world, player, c.id);
    case 'spell':
      return typeof c.id === 'string' && c.id in SPELLS && readySpell(player, c.id);
    default:
      return false;
  }
}

const AREAS: readonly SlotArea[] = ['bag', 'input', 'output', 'filter', 'fuel'];

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

function isTile(tx: unknown, ty: unknown): boolean {
  return isInt(tx) && isInt(ty);
}

function isDir(dir: unknown): dir is Direction {
  return dir === 0 || dir === 1 || dir === 2 || dir === 3;
}

function isPoint(x: unknown, y: unknown): boolean {
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y);
}

function isId(id: unknown): id is number {
  return isInt(id);
}

function isIdOrNull(id: unknown): id is number | null {
  return id === null || isInt(id);
}

function isItemOrNull(item: unknown): item is ItemId | null {
  return item === null || (typeof item === 'string' && Object.hasOwn(ITEMS, item));
}

function isArea(area: unknown): area is SlotArea {
  return AREAS.includes(area as SlotArea);
}

/**
 * A slot that exists. The container code indexes straight into its grids, so
 * an index past the end would grow a machine's grid rather than fail.
 */
function isSlot(world: World, player: Player, machineId: unknown, ref: unknown): ref is SlotRef {
  if (!isIdOrNull(machineId) || typeof ref !== 'object' || ref === null) return false;
  const { area, index } = ref as SlotRef;
  if (!isArea(area) || !isInt(index) || index < 0) return false;
  if (area === 'bag') return index < player.inventory.length;
  const machine = machineById(world, machineId);
  if (!machine) return false;
  const size =
    area === 'input'
      ? machine.input.length
      : area === 'output'
        ? machine.output.length
        : area === 'fuel'
          ? (machine.fuel?.length ?? 0)
          : Math.max(machine.filters?.length ?? 0, machine.input.length);
  return index < size;
}

function isSettings(settings: unknown): settings is MachineSettings {
  if (typeof settings !== 'object' || settings === null) return false;
  const s = settings as MachineSettings;
  if (typeof s.family !== 'string') return false;
  if (s.recipe !== null && !(typeof s.recipe === 'string' && RECIPE_BY_ID.has(s.recipe))) return false;
  if (!isItemOrNull(s.filter)) return false;
  if (s.filters === null) return true;
  return Array.isArray(s.filters) && s.filters.length <= 64 && s.filters.every(isItemOrNull);
}
