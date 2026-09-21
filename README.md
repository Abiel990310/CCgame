# CCgame — The Island

A cozy, persistent island survival game that runs in the browser.

Automate an island. Gather by hand, then stop doing it by hand.

![day](docs/day.png)

## What it is

You wash up on a procedurally generated island. You gather by hand at first,
then you automate it: miners on ore patches, belts carrying ore to furnaces,
furnaces feeding assemblers. The factory grows, and throughput becomes the
puzzle — not "do I have enough iron" but "can I make enough iron per minute".

At night, easy creatures wander in from the dark while your weapons fire
themselves and you reposition and dash. Or start a **peaceful** world, where the
factory is the whole game. Either way the island keeps everything you build.

Designed so it is fully enjoyable alone, with drop-in multiplayer layered on
later. See [DESIGN.md](DESIGN.md) for the full design and roadmap.

## Playing

| Action | Key |
| --- | --- |
| Move | `WASD` / arrow keys |
| Dash | `Space` |
| Gather | `E`, or hold the mouse button |
| Build mode | `B` |
| Rotate the piece you are placing | `R` |
| Remove what is under the cursor | `X` or right-click |
| Inspect a machine | Click it outside build mode |
| Bag | `Tab` |
| Close panel | `Esc` |

On touch devices: drag the left half of the screen to move, tap the right half
to gather, and use the on-screen buttons.

## Running it

```bash
npm install
npm run dev        # dev server with hot reload
```

Other scripts:

```bash
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production build
npm test           # simulation test suite
npm run typecheck  # types only
```

The production bundle is ~47 KB (17 KB gzipped) with no runtime dependencies,
and the whole thing is a static site — it can be hosted anywhere.

## How the code is laid out

```
shared/            Deterministic simulation — no DOM, no rendering
  data/            Tuning tables: items, mobs, weapons, buildings, upgrades
  sim/             World state, terrain generation, and the tick
    systems/       One file per system: movement, gathering, combat, mobs, …
    __tests__/     Simulation tests
src/               Browser client
  render/          Canvas renderer: terrain mesh, entities, lighting, effects
  ui/              DOM overlay: HUD, modals, build bar
```

The important boundary is `shared/` ⇄ `src/`. Everything in `shared/` is a pure
function of state plus inputs — it never touches `Math.random`, the DOM, or
wall-clock time. That is what makes the simulation unit-testable today, and what
will let an authoritative server run the exact same code once multiplayer
arrives, with the client predicting locally against it.

`step(world, inputs, dt)` is the whole simulation. Same world plus same inputs
always produces the same result.

## The factory

Place a **miner** on an ore patch, run a **belt** from it to a **furnace**, and
point the furnace at a **chest**. That is the whole idea; everything later is
the same idea with more steps.

Adding depth means adding rows to `shared/data/recipes.ts` — machines are driven
generically by that table, so new content needs no new systems.

## Status

**Phases 1–3 are done.** Solo play, persistence, and the first three factory
tiers: ore, miners, belts, furnaces, assemblers, chests, and a per-world
peaceful mode.

Next: power and deeper chains, then the multiplayer server and hostable worlds.
Roadmap in [DESIGN.md](DESIGN.md).
