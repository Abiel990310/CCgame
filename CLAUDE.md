# CLAUDE.md

Working guide for agents on CCgame. Read this before changing anything.

- **What the game is** → [DESIGN.md](DESIGN.md)
- **What is built and what is next** → [ROADMAP.md](ROADMAP.md)
- **How to work on it** → this file

## The project in one paragraph

A cozy, persistent island factory game in the browser. You gather by hand at
first, then automate it: miners on ore patches, belts to furnaces, furnaces to
assemblers. Nights bring easy raids you defend against with auto-firing weapons
— or you play a peaceful world where the factory is the whole game. It is built
solo-first, with real-time drop-in multiplayer planned on the same simulation
code. Target: a game that still has things to do after hundreds of hours.

## Commands

```bash
npm install
npm run dev        # dev server, hot reload
npm run build      # typecheck + production bundle to dist/
npm test           # simulation test suite (vitest)
npm run typecheck  # types only
```

Run `npm run typecheck && npm test` before every commit. CI runs both and a
failing test blocks deployment, so a red suite means the live site stops
updating.

## Layout

```
shared/            Deterministic simulation — no DOM, no rendering
  data/            Tuning tables: items, mobs, weapons, buildings, machines,
                   recipes. Content lives here.
  sim/             World state, terrain, ore, grid, and the tick
    systems/       One file per system: movement, gathering, combat, mobs,
                   pickups, cycle, factory
    __tests__/     Simulation tests
src/               Browser client
  render/          Canvas renderer: terrain mesh, entities, factory, lighting,
                   effects, palette, shapes, camera
  ui/              DOM overlay: HUD, build palette, modals
.github/workflows/ CI and Pages deployment
```

## The one rule that matters

**`shared/` must stay deterministic and headless.**

Same world plus same inputs must always produce the same result. That means
inside `shared/`:

- No `Math.random` — use `nextFloat(world)` or a seeded `makeRng`
- No `Date.now`, no wall-clock time — the sim advances only by its `dt`
- No DOM, no `window`, no canvas, no browser APIs
- No imports from `src/`

This is not style. It is what lets the simulation be unit-tested today, and what
will let an authoritative server run the identical code once multiplayer lands,
with the client predicting locally against it. Break it and multiplayer becomes
a rewrite instead of an addition.

`step(world, inputs, dt)` in `shared/sim/step.ts` is the whole simulation.

## Adding content

**Adding depth means adding rows to data tables, not writing systems.** The
engine is deliberately small and generic; the content is data.

| To add | Edit |
| --- | --- |
| A recipe | `shared/data/recipes.ts` |
| A machine | `shared/data/machines.ts` |
| An item | `shared/data/items.ts` and the `ItemId` union in `shared/sim/types.ts` |
| A mob | `shared/data/mobs.ts` |
| A weapon | `shared/data/weapons.ts` |
| A level-up upgrade | `shared/data/upgrades.ts` |
| A camp building | `shared/data/buildings.ts` |
| Balance tuning | `shared/sim/constants.ts` |

If a new feature seems to need a new system, check first whether it is really a
new row. Machines are all one generic type driven by the recipe table; that is
on purpose and should stay true as tiers are added.

## Conventions

- **TypeScript strict**, no `any`. `noUnusedLocals` is on, so dead imports fail
  the build.
- **Comments explain why, not what.** Do not narrate the code.
- **No runtime dependencies.** The bundle currently has zero, and zero external
  network requests. Do not add a font CDN, an analytics snippet, or a UI
  library without asking. Keeping this true is a feature.
- **Imports**: client code uses the `@shared/*` alias; `shared/` uses relative
  paths internally.
- **Rendering**: entities are Y-sorted (painter's algorithm) for the 3/4 view.
  Anything new that sits in the world needs to join that sort or it will draw in
  front of things it should be behind.
- Everything placed in build mode snaps to the tile grid; factory pieces also
  carry a `Direction`. Both cases flow through `GhostPreview`, which is also
  what tells the renderer to draw the grid.
- **Saves must stay backward compatible.** `loadWorld` accepts any version up
  to the current one and defaults the fields that version did not have. Raising
  `VERSION` without that is how you silently delete someone's island.

## Verifying changes

Tests are necessary but not sufficient. **Anything visual or interactive must be
driven in a real browser before it is called done.** Every bug found in this
project so far was found that way, not by tests:

- A fresh island rendered in full darkness while the HUD read "Day"
- The player was completely hidden behind tree canopies by depth sorting
- The fix for that was a solid disc that hid the character it existed to locate
- Ore drawn as flat per-tile tints made hard square edges that read as artefacts

Use Playwright against `npm run preview`, with Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Install it with
`npm install --no-save playwright` so it never lands in `package.json`, and
delete any harness script afterwards. `window.__ccgame` and `window.__ccfactory`
expose live state and the placement API for driving the game.

Report what you actually verified, and say plainly when you could not verify
something.

Simulation behaviour that is not visual belongs in tests, and a production line
is the case to get right: `shared/sim/__tests__/production-line.test.ts` builds
miner → belt → furnace → chest lines through the placement API and asserts on
what reaches the chest. Build on the bench in `__tests__/bench.ts` rather than
searching generated terrain for a spot that fits — a test that gives up when
the seed does not cooperate passes without asserting anything, which is how a
deleted recipe filter once left the whole suite green.

## Deployment

Pushes to `main` build, typecheck, test, and deploy to GitHub Pages at
<https://abiel990310.github.io/CCgame/>. A failing test blocks the deploy and
the live site keeps its last good build.

The `github-pages` environment only accepts deployments from the default
branch, so work must reach `main` to go live. The repository is public
deliberately: a web game's client code is downloadable by every visitor
regardless, so a private repo would buy nothing while blocking free hosting.

## Workflow

- Branch off `main`, one branch per change. A merged PR cannot take new commits.
- Never push to `main` directly without being asked.
- Do not create a PR unless asked.
- Keep [ROADMAP.md](ROADMAP.md) current when a phase moves, and record any
  decision that changes architecture in its decision log.
- **Add to the ROADMAP backlog as you go.** A bug noticed in passing, an idea
  had while doing something else, a change some other work implies — it goes
  into the backlog under Bugs, New features, Changes, Ideas or Needs testing
  in the same session it came up, as one short line. Do not save it for a tidy
  moment and do not wait to be asked: an idea that only lives in a session
  transcript is lost. Items are unticked until the owner approves them.
