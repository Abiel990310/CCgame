import type { ItemStack } from '../sim/types';

/**
 * The Skyward Beacon: the island's last project. It is built in stages, and
 * each stage is fed by belt or by hand like any other machine, so finishing it
 * is a question of throughput across the whole tree rather than of one rare
 * item. Stage ids live in the machine's `recipe`, which is already saved.
 */
export interface BeaconStage {
  id: string;
  name: string;
  /** What this stage needs delivered, all of it, before it is raised. */
  needs: ItemStack[];
}

export const BEACON_STAGES: BeaconStage[] = [
  {
    id: 'beacon:foundation',
    name: 'Foundation',
    needs: [
      { id: 'steelPlate', count: 150 },
      { id: 'pipe', count: 100 },
      { id: 'frame', count: 10 },
    ],
  },
  {
    id: 'beacon:spire',
    name: 'Spire',
    needs: [
      { id: 'frame', count: 40 },
      { id: 'motor', count: 40 },
      { id: 'engineUnit', count: 40 },
    ],
  },
  {
    id: 'beacon:wiring',
    name: 'Wiring',
    needs: [
      { id: 'wire', count: 600 },
      { id: 'advancedCircuit', count: 60 },
      { id: 'battery', count: 60 },
    ],
  },
  {
    id: 'beacon:lens',
    name: 'Lens',
    needs: [
      { id: 'lens', count: 30 },
      { id: 'processor', count: 30 },
    ],
  },
  {
    id: 'beacon:ignition',
    name: 'Ignition',
    needs: [
      { id: 'processor', count: 60 },
      { id: 'engineeringPack', count: 100 },
      { id: 'powerPack', count: 100 },
      { id: 'essence', count: 30 },
    ],
  },
];

/** Where a finished beacon's `recipe` ends up. */
export const BEACON_LIT = 'beacon:lit';

/** XP every player on the island gets when a beacon is lit. */
export const BEACON_XP = 400;

/**
 * A lit beacon keeps burning only while it is fed. Each processor keeps it
 * alight this many seconds, so an island running it for good needs a steady
 * processor line, the last thing the tree teaches, rather than a stockpile.
 */
export const BEACON_BURN_SECONDS = 60;
/** Most processors a lit beacon holds in reserve. */
export const BEACON_FUEL_CAP = 20;
/** What a burning beacon adds to every machine, miner and lab on the island, as a share. */
export const BEACON_BOOST = 0.3;

export const BEACON_STAGE_BY_ID = new Map(BEACON_STAGES.map((s, i) => [s.id, { stage: s, index: i }]));
