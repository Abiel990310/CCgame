import { BUILDINGS } from '@shared/data/buildings';
import { ITEMS, RESOURCES } from '@shared/data/items';
import { MACHINES, TUNNEL_REACH } from '@shared/data/machines';
import { MOBS } from '@shared/data/mobs';
import { RECIPE_BY_ID } from '@shared/data/recipes';
import { MAP_TILES } from '@shared/sim/constants';
import { beltAt, machineAt, tunnelEntranceOf, tunnelExitOf } from '@shared/sim/factory';
import { buildingAt } from '@shared/sim/building';
import { tileKey, toTile } from '@shared/sim/grid';
import { oreAt } from '@shared/sim/ore';
import { powerNetOf } from '@shared/sim/power';
import { BEACON_BOOST, BEACON_FUEL_CAP, BEACON_STAGES, BEACON_WARD_TILES } from '@shared/data/beacon';
import { beaconStage } from '@shared/sim/beacon';
import { countIn } from '@shared/sim/slots';
import { nearWorkbench } from '@shared/sim/crafting';
import { findNearestNode } from '@shared/sim/systems/gathering';
import type { Machine, OreKind, Player, ToolKind, Vec2, World } from '@shared/sim/types';
import type { Camera } from '../render/camera';
import { isBlocked, outOfFuel } from '../render/factory';
import { itemIconVar } from '../render/items';
import { pieceIconVar } from '../render/pieces';

/**
 * What the world tells you about itself without opening anything: a card by
 * the mouse naming whatever is under it, and a key prompt over the thing the
 * player can gather right now. Before these, an ore patch was a stain nobody
 * could name and a stopped furnace had to be opened to find out why.
 */

const VERB: Record<ToolKind, string> = { axe: 'Chop', pick: 'Mine', hand: 'Pick', rod: 'Fish' };

/** How far above a node's base its prompt floats: over the crown, not the trunk. */
const PROMPT_LIFT: Record<ToolKind, number> = { axe: 70, pick: 34, hand: 30, rod: 22 };

const ORE_HINT: Record<OreKind, string> = {
  ironOre: 'Smelts into iron plates.',
  copperOre: 'Smelts into copper plates.',
  coal: 'Fuel for furnaces, and for steel.',
};

type Tone = 'good' | 'warn' | 'bad' | '';

interface Card {
  title: string;
  icon: string | null;
  status?: { text: string; tone: Tone };
  rows: Array<[string, string]>;
  hint?: string;
  /** 0 to 1, drawn as a bar under the rows. */
  meter?: { value: number; tone: Tone };
}

interface Patch {
  tiles: Set<number>;
  kind: OreKind;
  total: number;
  miners: number;
  at: number;
}

export interface InspectContext {
  world: World;
  self: Player;
  camera: Camera;
  pointer: Vec2;
  /** A mouse over the world, not over a panel and not a touch. */
  hovering: boolean;
  /** A screen or build mode is up; the world is not what is being looked at. */
  busy: boolean;
  touch: boolean;
}

export class Inspector {
  private card = document.createElement('div');
  private prompt = document.createElement('div');
  /** Its own element: standing at the bench and beside a bush are both common. */
  private bench = document.createElement('button');
  private cardKey = '';
  private promptKey = '';
  private patch: Patch | null = null;

  constructor(root: HTMLElement, onBench: () => void) {
    this.card.id = 'tip';
    this.card.hidden = true;
    this.prompt.id = 'prompt';
    this.prompt.hidden = true;
    this.bench.className = 'bench-prompt';
    this.bench.hidden = true;
    // Tappable, since a phone has no C key to open the bench with.
    this.bench.addEventListener('click', onBench);
    root.append(this.card, this.prompt, this.bench);
  }

  update(c: InspectContext): void {
    this.updatePrompt(c);
    this.updateBench(c);
    this.updateCard(c);
  }

  private updateBench(c: InspectContext): void {
    const bench = c.busy ? null : nearWorkbench(c.world, c.self);
    if (!bench) {
      this.bench.hidden = true;
      return;
    }
    const html = `${c.touch ? '' : '<b class="cap">C</b>'}<span>Craft</span>`;
    if (this.bench.innerHTML !== html) this.bench.innerHTML = html;
    const at = c.camera.worldToScreen(bench.pos.x, bench.pos.y - 34);
    this.bench.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
    this.bench.hidden = false;
  }

  private updatePrompt(c: InspectContext): void {
    const node = c.busy || c.self.downed > 0 ? null : findNearestNode(c.world, c.self);
    // Once the swing has started the harvest bar says everything the prompt would.
    if (!node || c.self.gatherNodeId === node.id) {
      this.prompt.hidden = true;
      return;
    }
    const def = RESOURCES[node.kind];
    const key = `${node.id}:${c.touch}`;
    if (key !== this.promptKey) {
      this.promptKey = key;
      const cap = c.touch ? '<b class="cap tap">Hold</b>' : '<b class="cap">E</b>';
      const verb = def.landmark ? 'Search' : VERB[def.tool];
      this.prompt.innerHTML = `${cap}<span>${verb} ${def.name.toLowerCase()}</span>`;
    }
    const at = c.camera.worldToScreen(node.pos.x, node.pos.y - PROMPT_LIFT[def.tool]);
    this.prompt.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`;
    this.prompt.hidden = false;
  }

  private updateCard(c: InspectContext): void {
    if (!c.hovering || c.busy) {
      this.hideCard();
      return;
    }
    const world = c.camera.screenToWorld(c.pointer.x, c.pointer.y);
    const card = this.describe(c.world, world);
    if (!card) {
      this.hideCard();
      return;
    }

    // Rebuilt only when what it says changes: a mouse held still over a
    // working furnace should not churn the DOM sixty times a second.
    const key = JSON.stringify(card);
    if (key !== this.cardKey) {
      this.cardKey = key;
      this.card.innerHTML = render(card);
    }
    this.card.hidden = false;

    // Beside the cursor, flipped to the other side near the screen's edges.
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    let x = c.pointer.x + 18;
    let y = c.pointer.y + 18;
    if (x + w > c.camera.width - 8) x = c.pointer.x - w - 14;
    if (y + h > c.camera.height - 8) y = c.pointer.y - h - 14;
    this.card.style.transform = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(Math.max(8, y))}px)`;
  }

  private hideCard(): void {
    this.card.hidden = true;
    this.cardKey = '';
  }

  /** The thing under a world point, nearest the viewer first. */
  private describe(world: World, pos: Vec2): Card | null {
    for (const mob of world.mobs) {
      const r = MOBS[mob.type].radius + 6;
      if (Math.abs(mob.pos.x - pos.x) < r && pos.y < mob.pos.y + r * 0.6 && pos.y > mob.pos.y - r * 2.4) {
        const def = MOBS[mob.type];
        return {
          title: def.name,
          icon: null,
          status: { text: 'Hostile', tone: 'bad' },
          rows: [['Health', `${Math.ceil(mob.hp)} / ${mob.maxHp}`]],
          meter: { value: mob.hp / mob.maxHp, tone: 'bad' },
        };
      }
    }

    // Trees reach well above their base, so each kind is hit in its own shape.
    for (const node of world.nodes) {
      if (node.charges <= 0) continue;
      const def = RESOURCES[node.kind];
      const up = node.kind === 'tree' ? 78 : def.radius * 1.6;
      const dx = Math.abs(node.pos.x - pos.x);
      if (dx < def.radius + 4 && pos.y < node.pos.y + def.radius * 0.7 && pos.y > node.pos.y - up) {
        if (def.landmark) {
          return {
            title: def.name,
            icon: itemIconVar(def.landmark.cache[0].item),
            status: { text: 'Unsearched', tone: 'good' },
            rows: [
              ['Holds', def.landmark.cache.map((s) => ITEMS[s.item].name).join(', ')],
              ...(def.landmark.boon === 'upgrade' ? [['Also', 'A free upgrade'] as [string, string]] : []),
            ],
            hint: 'Stand close and hold E to search',
          };
        }
        const drops = def.drops.map((d) => ITEMS[d.item].name).join(', ');
        return {
          title: def.name,
          icon: itemIconVar(def.drops[0].item),
          rows: [['Yields', drops]],
          meter: { value: node.charges / node.maxCharges, tone: 'good' },
          hint: `Stand close and hold E to ${VERB[def.tool].toLowerCase()}`,
        };
      }
    }

    const { tx, ty } = toTile(pos);
    const machine = machineAt(world, tx, ty);
    if (machine) return describeMachine(world, machine);

    const belt = beltAt(world, tx, ty);
    if (belt) {
      const carried = belt.items.length
        ? belt.items.map((i) => ITEMS[i.item].name).filter((n, k, all) => all.indexOf(n) === k).join(', ')
        : 'Nothing';
      return {
        title: 'Belt',
        icon: pieceIconVar('belt'),
        rows: [['Carrying', carried]],
        hint: 'Right-click in build mode to pick it up',
      };
    }

    const building = buildingAt(world, pos);
    if (building) {
      const def = BUILDINGS[building.type];
      return {
        title: def.name,
        icon: pieceIconVar(`building:${building.type}`),
        rows: [],
        hint: def.description,
      };
    }

    const ore = oreAt(world.ore, tx, ty);
    if (ore) return this.describeOre(world, tx, ty, ore);
    return null;
  }

  private describeOre(world: World, tx: number, ty: number, kind: OreKind): Card {
    const patch = this.patchAt(world, tx, ty, kind);
    const here = world.oreLeft[tileKey(tx, ty)];
    const name = ITEMS[kind].name;
    const rows: Array<[string, string]> = [
      ['This tile', `${here.toLocaleString()} ore`],
      ['Whole patch', `${patch.total.toLocaleString()} ore in ${patch.tiles.size} tiles`],
    ];
    if (patch.miners > 0) rows.push(['Miners on it', String(patch.miners)]);
    return {
      title: kind === 'coal' ? 'Coal deposit' : `${name} deposit`,
      icon: itemIconVar(kind),
      status: patch.miners > 0 ? { text: 'Being mined', tone: 'good' } : { text: 'Untapped', tone: '' },
      rows,
      hint: `${ORE_HINT[kind]} Build a Miner on it to dig it out for you.`,
    };
  }

  /**
   * The connected tiles of one kind around a tile. Walked again at most once
   * a second, and only when the cursor leaves the patch it last measured.
   */
  private patchAt(world: World, tx: number, ty: number, kind: OreKind): Patch {
    const key = tileKey(tx, ty);
    const cached = this.patch;
    if (cached && cached.kind === kind && cached.tiles.has(key) && world.time - cached.at < 1) return cached;

    const tiles = new Set<number>([key]);
    const queue: Array<[number, number]> = [[tx, ty]];
    let total = 0;
    let miners = 0;
    while (queue.length > 0 && tiles.size < 2000) {
      const [x, y] = queue.pop()!;
      total += world.oreLeft[tileKey(x, y)];
      const m = machineAt(world, x, y);
      if (m && MACHINES[m.type].family === 'miner') miners++;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= MAP_TILES || ny >= MAP_TILES) continue;
        const k = tileKey(nx, ny);
        if (tiles.has(k) || oreAt(world.ore, nx, ny) !== kind) continue;
        tiles.add(k);
        queue.push([nx, ny]);
      }
    }
    this.patch = { tiles, kind, total, miners, at: world.time };
    return this.patch;
  }
}

function describeMachine(world: World, machine: Machine): Card {
  const def = MACHINES[machine.type];
  if (def.family === 'pole' || def.generates) return describePower(world, machine);
  if (def.family === 'beacon') return describeBeacon(machine);
  const rows: Array<[string, string]> = [];
  const recipe = machine.recipe ? RECIPE_BY_ID.get(machine.recipe) : null;
  if (def.family === 'miner' && machine.ore) rows.push(['Mining', ITEMS[machine.ore].name]);
  else if (recipe) rows.push(['Making', recipe.name]);
  else if (def.choosesRecipe) rows.push(['Making', 'Nothing chosen']);

  let status: Card['status'];
  if (def.family === 'tunnel') {
    // Which end pairs with which is decided by the ground between them, so the
    // card names the other end rather than leaving the player to count tiles.
    const other = def.tunnel === 'in' ? tunnelExitOf(world, machine) : tunnelEntranceOf(world, machine);
    const gap = other ? Math.abs(other.tx - machine.tx) + Math.abs(other.ty - machine.ty) - 1 : 0;
    if (other) rows.push([def.tunnel === 'in' ? 'Exit' : 'Entrance', `${gap} ${gap === 1 ? 'tile' : 'tiles'} under`]);
    else if (def.tunnel === 'in') status = { text: `No exit within ${TUNNEL_REACH} tiles`, tone: 'bad' };
    else status = { text: 'No entrance feeding it', tone: 'warn' };
  } else if (def.family !== 'chest' && def.family !== 'splitter' && def.family !== 'merger') {
    if (outOfFuel(machine)) status = { text: 'Out of fuel', tone: 'bad' };
    else if (machine.unpowered) status = { text: powerNetOf(world, machine) ? 'No power' : 'No pole in reach', tone: 'bad' };
    else if (def.choosesRecipe && !recipe) status = { text: 'Pick a recipe', tone: 'warn' };
    else if (machine.stalled && isBlocked(machine, def))
      status = { text: def.family === 'miner' ? 'No ore in reach' : 'Output full', tone: 'bad' };
    else if (machine.stalled) status = { text: 'Waiting for input', tone: 'warn' };
    else status = { text: 'Working', tone: 'good' };
  }
  const net = def.power ? powerNetOf(world, machine) : null;
  if (def.power) {
    const pace = net ? Math.round(net.satisfaction * 100) : 0;
    rows.push(['Power', `${def.power} kW${net && pace < 100 ? `, ${pace}% speed` : ''}`]);
  }
  const held = [...machine.input, ...machine.output].reduce((n, s) => n + (s ? s.count : 0), 0);
  if (def.storage || held > 0) rows.push(['Holding', `${held} ${held === 1 ? 'item' : 'items'}`]);

  return {
    title: def.name,
    icon: pieceIconVar(`machine:${machine.type}`),
    status,
    rows,
    hint: def.inputSlots + def.outputSlots > 0 ? 'Click to open' : undefined,
  };
}

/** A beacon's card is its current stage and how far along each part of it is. */
function describeBeacon(machine: Machine): Card {
  const def = MACHINES[machine.type];
  const current = beaconStage(machine);
  const rows: Array<[string, string]> = current
    ? [
        ['Stage', `${current.index + 1} of ${BEACON_STAGES.length}: ${current.stage.name}`],
        ...current.stage.needs.map((n): [string, string] => [
          ITEMS[n.id].name,
          `${Math.min(n.count, countIn(machine.input, n.id))} / ${n.count}`,
        ]),
      ]
    : [
        ['Island speed', machine.progress > 0 ? `+${Math.round(BEACON_BOOST * 100)}%` : 'none'],
        ['Ward', machine.progress > 0 ? `${BEACON_WARD_TILES} tiles, slows creatures` : 'none'],
        ['Processors', `${countIn(machine.input, 'processor')} / ${BEACON_FUEL_CAP}`],
      ];
  return {
    title: def.name,
    icon: pieceIconVar(`machine:${machine.type}`),
    status: current
      ? { text: 'Being built', tone: 'warn' }
      : machine.progress > 0
        ? { text: 'Burning', tone: 'good' }
        : { text: 'Banked: needs processors', tone: 'warn' },
    rows,
    hint: 'Click to open',
  };
}

/**
 * A pole or an engine is its network: what it can give, what is asked of it,
 * and whether the one is enough for the other.
 */
function describePower(world: World, machine: Machine): Card {
  const def = MACHINES[machine.type];
  const net = powerNetOf(world, machine);
  const rows: Array<[string, string]> = [];
  let status: Card['status'];
  let meter: Card['meter'];

  if (!net) {
    status = def.generates
      ? { text: 'No pole in reach', tone: 'warn' }
      : { text: 'No engine on this line', tone: 'warn' };
  } else {
    const used = Math.min(net.demand, net.supply);
    rows.push(['Supply', `${Math.round(net.supply)} kW`], ['Demand', `${Math.round(net.demand)} kW`]);
    if (def.generates && outOfFuel(machine)) status = { text: 'Out of fuel', tone: 'bad' };
    else if (def.generates && def.fuelSlots === 0 && machine.stalled) status = { text: 'Dark until morning', tone: 'warn' };
    else if (net.supply === 0) status = { text: 'No engine running', tone: 'bad' };
    else if (net.satisfaction < 1) status = { text: `Overloaded: ${Math.round(net.satisfaction * 100)}% speed`, tone: 'bad' };
    else if (net.demand === 0) status = { text: 'Idle', tone: 'warn' };
    else status = { text: 'Powered', tone: 'good' };
    if (net.supply > 0) meter = { value: used / net.supply, tone: net.satisfaction < 1 ? 'bad' : 'good' };
    if (def.family === 'pole') rows.push(['Poles', String(net.poles.length)], ['Machines', String(net.consumers.length)]);
  }
  return {
    title: def.name,
    icon: pieceIconVar(`machine:${machine.type}`),
    status,
    rows,
    meter,
    hint: def.fuelSlots > 0 ? 'Click to add coal' : undefined,
  };
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function render(card: Card): string {
  const icon = card.icon ? `<i class="tip-icon" style="background-image:${card.icon}"></i>` : '';
  const status = card.status ? `<span class="tip-status ${card.status.tone}">${esc(card.status.text)}</span>` : '';
  const rows = card.rows
    .map(([k, v]) => `<div class="tip-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join('');
  const meter = card.meter
    ? `<div class="tip-meter ${card.meter.tone}"><i style="width:${Math.round(card.meter.value * 100)}%"></i></div>`
    : '';
  const hint = card.hint ? `<p class="tip-hint">${esc(card.hint)}</p>` : '';
  return `<header>${icon}<div><h4>${esc(card.title)}</h4>${status}</div></header>${rows}${meter}${hint}`;
}
