import { TICK_DT } from './constants';
import type { PlayerInput, World } from './types';
import { stepCycle, stepPlayerUpkeep } from './systems/cycle';
import { stepGathering, stepNodeRegrowth } from './systems/gathering';
import { stepProjectiles, stepWeapons } from './systems/combat';
import { stepMobs, stepWaves } from './systems/mobs';
import { stepPlayerMovement } from './systems/movement';
import { stepPickups } from './systems/pickups';
import { stepBelts, stepMachines } from './systems/factory';

export const EMPTY_INPUT: PlayerInput = {
  move: { x: 0, y: 0 },
  dash: false,
  interact: false,
};

/**
 * One deterministic simulation tick. Same inputs plus same world in, same world
 * out — this is what lets a client predict locally and a server stay authoritative
 * over the exact same code.
 */
export function step(world: World, inputs: Map<number, PlayerInput>, dt = TICK_DT): void {
  world.events.length = 0;
  world.tick += 1;
  world.time += dt;

  stepCycle(world, dt);

  for (const player of world.players.values()) {
    const input = inputs.get(player.id) ?? EMPTY_INPUT;
    if (player.downed > 0) continue;
    stepPlayerMovement(world, player, input, dt);
    stepGathering(world, player, input, dt);
    stepWeapons(world, player, dt);
  }

  // The factory runs every tick, day or night — it is the constant of the game.
  stepMachines(world, dt);
  stepBelts(world, dt);

  stepWaves(world, dt);
  stepMobs(world, dt);
  stepProjectiles(world, dt);
  stepPickups(world, dt);
  stepNodeRegrowth(world, dt);
  stepPlayerUpkeep(world, dt);
}
