# Roadmap

Status, plan, and the decisions behind both. Updated as phases move.

- **What the game is** → [DESIGN.md](DESIGN.md)
- **How to work on it** → [CLAUDE.md](CLAUDE.md)

## Where things stand

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Solo prototype: movement, island, gathering, day/night, combat, XP, inventory, camp | ✅ Done |
| 2 | Persistence in `localStorage` | ✅ Done |
| 3 | Factory tiers 1–3: ore, miners, belts, furnaces, assemblers, chests | ✅ Done |
| 4 | Factory tiers 4–5: power, steel, deeper chains, tech tree | Next |
| 5 | Multiplayer: authoritative server, hostable worlds | Planned |
| 6 | The long game: logistics, megaproject, blueprints, statistics | Planned |

Live at <https://abiel990310.github.io/CCgame/>.

## The vision, in the user's own terms

Collected from the conversations that shaped the project, so intent is not lost
between sessions.

- **Multiplayer, but never lobby-gated.** "Not like lobby cuz then you can't
  play alone." You join instantly, alone, into a world already running.
- **Chill, with a goal.** "Just chill relax but still have a goal" — easy mobs,
  inventory, levelling up. Low-stress moment-to-moment; the reward comes from
  progression, not execution.
- **Reference points:** Brotato (waves, auto-attack, upgrade drafts),
  Satisfactory (persistent base, self-set goals, no fail state), How to Fish
  (calm gathering, a collection ladder).
- **A factory game for the long run.** "Tens and hundreds of hours and still
  have things to do late game."
- **Worlds like Minecraft servers.** An official public world, player-hosted
  public worlds, and private friend worlds that boot when someone joins.
- **Art:** low-poly but smooth and clean. Pixel art is the agreed fallback if it
  ever stops reading well.

## Decision log

Decisions that shape the architecture. Revisit deliberately, not by accident.

| Decision | Choice | Why |
| --- | --- | --- |
| Progression | Fully persistent | The island only ever grows. No wiped saves, no run resets. |
| Combat | Auto-firing weapons plus one manual dash | Chill baseline with a moment of agency; no aiming skill required. |
| Combat per world | Peaceful or raids, chosen at world creation | Lets the factory be the whole game for players who want that. |
| Gathering | Mixed: fish, mine, chop, forage | Feeds crafting breadth rather than a single resource. |
| Logistics | Real belts now, drones and rail at tier 6 | Belts are where the spatial puzzle lives. Drones remove late tedium without replacing the puzzle. |
| Offline production | None | Every hour of progress is an hour someone played; the economy never has to be balanced around absence. |
| Ore | Discrete patches, not noise | A patch is a thing a player can point at, and outgrowing one is what drives expansion. |
| Placement | Everything snaps to the tile grid | Belts cannot align without it, and freeform camp pieces meant a row of walls never came out straight. Build mode draws the grid so it is visible while placing. |
| Tile lookup | The grid maps a tile to the entity itself | Belts hand off every tick, so resolving a tile has to be O(1). Storing an id meant scanning every belt and machine, which made a tick O(belts squared). |
| Save format | Old versions load, newer ones are refused | Persistence is the promise the game makes. A field added later defaults; a save from the future cannot be guessed at. |
| Engine shape | Small generic engine, content as data | The only way a small team reaches hundreds of hours. Machines are one type driven by the recipe table. |
| Simulation | Deterministic and headless in `shared/` | Testable now; an authoritative server can run the identical code later. |
| Stack | TypeScript, Vite, canvas, no engine | Fast iteration, tiny bundle, full control of the netcode-facing render path. |
| Dependencies | Zero runtime deps, zero external requests | Nothing to leak, nothing to break when a CDN does. |
| Repository | Public | Client code is downloadable by every visitor anyway; private would block free hosting and protect nothing. |
| Server repo (future) | Private, separate | Infrastructure and configuration are worth keeping private — though validation, not secrecy, is what protects a server. |

## What "hundreds of hours" actually requires

Depth in the recipe graph, and throughput as the puzzle. The question is never
"do I have enough iron" but "can I make enough iron per minute, and where is my
bottleneck". Each tier multiplies demand on every tier below it, so you are
always rebuilding something you built an hour ago.

### Tier ladder

| Tier | Unlocks | The new problem it creates | Status |
| --- | --- | --- | --- |
| 0 | Hand gathering | — | ✅ |
| 1 | Miner, belt, chest | Things move without you | ✅ |
| 2 | Furnace, plates | Ratios: several miners feed one furnace | ✅ |
| 3 | Assembler: gears, wire, circuits | Multi-input recipes, sub-factories | ✅ |
| 4 | Power (coal → steam) | Everything stops when power dies | Next |
| 5 | Steel, resin, advanced circuits | Chains six or more steps deep | Planned |
| 6 | Island logistics: drones, rail | Remote outposts on distant ore | Planned |
| 7 | The Megaproject | An endgame sink with unbounded appetite | Planned |

**Tier 7 is the answer to late game.** A tech tree ends; a structure that always
wants more throughput does not. Factorio has the rocket, Satisfactory has the
space elevator. Without one, players finish the recipes and stop.

## Phase 4 — power and depth (next)

- Power as a network: generators, poles, consumption per machine. Machines stop
  when supply runs short, which makes power a system rather than a cost.
- Steel and resin: recipes six or more steps from raw ore.
- A tech tree gated by **producing** items, not by killing things — production
  is the verb this game rewards.
- Belt tiers or not (see open questions).
- Production statistics, so a player can find their own bottleneck. This is a
  core factory-game affordance, not a nicety.

## Phase 5 — multiplayer

Architecture is already in place: `shared/` is deterministic and headless so the
server can run the identical simulation.

- **Server:** Node and TypeScript, authoritative, fixed ~20Hz tick, `ws`
  WebSockets. Clients send **inputs only** — never positions, never scores.
- **Client:** prediction and reconciliation for your own movement, entity
  interpolation for everyone else.
- **Worlds:** official public, player-hosted public, and private friend worlds.
  Worlds boot when a player joins and hibernate when empty, so cost scales with
  use rather than with world count.
- **Hosting:** client stays on static hosting; the server goes on Fly.io or
  Cloudflare Durable Objects. Durable Objects fit the per-world hibernation
  model closely and run near each player.
- **Anti-cheat is architectural.** The server simulating authoritatively and
  never trusting client claims is the protection. A cheater can lie about which
  direction they are holding; they cannot teleport or mint items.

## Phase 6 — the long game

Island logistics, the megaproject, blueprints, deeper production statistics,
and the content breadth that makes the hour count real.

## Open questions

Unresolved, and worth a deliberate answer rather than a default.

- **Do ore patches deplete?** Currently infinite. Depletion forces expansion but
  can feel punishing. Factorio chose finite; Satisfactory chose infinite.
- **How is the tech tree gated** — by producing science items, or by cumulative
  output?
- **Do belts get tiers** (faster belts), or does throughput scale only by adding
  parallel lines?
- **How early do blueprints arrive?** They remove enormous tedium, but also
  remove the learning that early tedium teaches.
- **How are private world invite lists managed** — accounts, or share codes?
- **Does the camp stay freeform** or move to slot-based upgrade tiers?

## Backlog

Everything noticed and not yet done, grouped so it can be triaged. Add to it as
things are found — an idea, a gap, or something spotted while fixing something
else all belong here.

### Bugs

- Placing a piece writes the whole island to `localStorage` synchronously, so
  every click while dragging out a belt line serialises the entire world. It
  costs ~2.6 ms at 550 belts and grows with the base. It should be debounced to
  the existing 8-second save timer instead.
- Removing a belt or machine scans `world.belts` / `world.machines` linearly to
  find it, although `world.grid` already resolves the tile. Cheap today, the
  same shape as the tick bug that was already fixed.
- The baked island canvas is `MAP_SIZE` square — 3072×3072, about 38 MB of
  backing store. On a phone that is enough to push the canvas into software
  rendering, which is exactly where frame time hurts.
- The core loop has not been playtested by a human yet. Day length (3 min),
  night length (1 min), gather rates and belt speed are all unvalidated guesses.
- Touch controls are implemented but have never been tested on real hardware.

### Changes

- Ore is baked into the island canvas on the assumption that `world.ore` never
  changes after generation. If patches ever deplete (see open questions), the
  island has to be re-baked on change or ore has to move back to a live layer.
- Blitting the baked island is the largest remaining per-frame cost when the
  canvas is not GPU-accelerated: about 3.6 ms of a 5–8 ms frame, because the
  static image is resampled to the camera zoom every frame. On an accelerated
  canvas it is close to free. Caching a pre-scaled screen-sized tile would fix
  it, at the cost of a rebuild whenever the camera pans past the margin.
- `resize()` caps `devicePixelRatio` at 2, so a retina display rasterises four
  times the pixels every frame. Worth revisiting if lag is reported on one.
- The render loop allocates an object and a closure per visible entity each
  frame to feed the depth sort. Pooling them would cut the GC churn.

### New features

- No audio.
- No production statistics, so bottlenecks currently have to be found by eye.
- A frame-time overlay behind a debug flag, so performance regressions show up
  while playing rather than only under a profiler.

### Ideas

- Canvas 2D records draw calls and flushes them lazily, so `performance.now()`
  around a drawing call measures recording, not rasterising, and time lands in
  whatever call triggers the flush. Measure the render path by removing work and
  comparing, not by timing segments — the segment timings say the wrong thing.
