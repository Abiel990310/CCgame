# CCgame — The Island

A cozy, persistent island survival game that runs in the browser.

Gather by day. Survive the night. The island keeps everything you build.

![day](docs/day.png)

## What it is

You wash up on a procedurally generated island. By day you fish, mine, chop and
forage in peace. At night, easy creatures wander in from the dark — your weapons
fire themselves while you reposition and dash. You level up, draft an upgrade,
build up the camp, and the island remembers all of it.

Designed so it is fully enjoyable alone, with drop-in multiplayer layered on
later. See [DESIGN.md](DESIGN.md) for the full design and roadmap.

## Playing

| Action | Key |
| --- | --- |
| Move | `WASD` / arrow keys |
| Dash | `Space` |
| Gather | `E`, or hold the mouse button |
| Build mode | `B` |
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

## Status

**Phase 1 (solo prototype) and Phase 2 (persistence) are done.** The game is
playable start to finish and saves to `localStorage`.

Still to come: the multiplayer server, worlds you can host and invite friends
to, crafting, and more content. Roadmap in [DESIGN.md](DESIGN.md).
