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
| Saving | Periodic and coalesced, flushed on exit | Serialising the island costs more as the island grows, so a click never writes: it pulls the periodic save forward to 2 seconds. Leaving, pausing or hiding the tab flushes, so nothing a player did is lost by waiting. |
| Item storage | Fixed slot grids, sparse, with the held stack in the sim | A bag the player arranges has to keep an empty slot where it is; a compacted list slides every stack left the moment one runs out. The stack on the cursor lives on the player rather than in the DOM so closing, reloading or a lost tab cannot swallow it. |
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

Everything found or proposed, grouped so it can be skimmed and approved a few
items at a time. **Every session adds here as it goes** — a bug noticed in
passing, an idea while doing something else, a change a design pass implies.
Nothing waits for a tidy moment. Tick an item to approve it for building; the
detail behind the factory entries is in
[CCgame late game progression](https://claude.ai/code/artifact/261951ca-ed94-49d6-aee9-3fc4e49346ca).

### Bugs

- [ ] Ore never depletes. `shared/sim/ore.ts` says in a comment that a finite
      patch is what pushes a player outward, but the grid stores only a kind
      index and `stepMiner` never decrements it. One miner supplies an island
      forever. (The design question is under Open questions; the code
      contradicting its own comment is the bug.)
- [ ] Coal is mined but nothing consumes it. No row in `recipes.ts` takes it as
      an input, so a third of the island's ore is dead weight.
- [ ] Touch has no way to remove anything. Removal is the `X` key and
      right-click only, so on a phone a misplaced belt is permanent.
- [ ] Tapping the canvas in build mode places nothing. The `pointerdown`
      handler in `src/input.ts` returns early for `pointerType === 'touch'`, so
      `takeClick()` never fires and a phone cannot build or inspect a machine.
- [ ] Touch has no rotate, so every belt placed on a phone would face one way.
- [ ] The phase bar and the vitals panel overlap on a phone. At 390px wide the
      vitals card covers the Day/Night readout entirely.
- [ ] Camp pieces are invisible to factory placement. Walls and turrets live in
      `world.buildings` by radius, not in `world.grid`, and
      `factoryPlacementError` only checks the grid — so a belt or a machine can
      be placed straight through a wall.
- [ ] Islands built before scenery blocked placement can still have a living
      tree standing inside a belt. It clears itself the first time it is
      chopped, but until then it is in the way.
- [ ] A chest still cannot feed a belt. The player can take items out by hand
      now, but nothing automated can, so a chest is a buffer only in one
      direction. The inserter under New features is the other half.

- [ ] The baked island canvas is `MAP_SIZE` square — 3072×3072, about 38 MB of
      backing store, and the pre-scaled ground cache adds roughly 11 MB more at
      `devicePixelRatio` 1 and 29 MB at 2. On a phone that total is enough to
      push the canvas into software rendering, which is exactly where frame
      time hurts. Drawing the ground cache straight from the terrain data would
      let the 38 MB one go.

### New features

- [ ] **Splitter** — one input, two outputs, alternating, with an optional
      filter per side. Best value per line of code in the factory layer: until
      it exists a belt feeds exactly one machine.
- [ ] **Inserter and long inserter** — move items between a belt and a machine
      or chest it does not directly face. Also what lets a chest feed a line
      rather than only receive from one; the player can now take items out of a
      chest by hand, but nothing automated can.
- [ ] **Lab and a `TECHS` table** — research consumed as a belt-fed item flow
      rather than bought from a shop, so every unlock is a throughput problem.
- [ ] **Tech gating on the build palette** — start with miner, furnace and
      belt; everything else is earned. Today all four machines are available at
      minute one.
- [ ] **Fuel slots** — tier-2 furnaces and assemblers burn coal off a belt.
      Every furnace bank then needs two input belts, which roughly doubles the
      interest of a layout.
- [ ] **Generator and power radius** — tier-3 machines draw power instead of
      fuel; a brown-out slows machines proportionally rather than stopping them.
- [ ] **Machine tiers 2 and 3** — steel furnace, assembler Mk2, electric miner,
      electric furnace, industrial assembler. `MachineDef.speed` already exists
      and is `1` everywhere, so the multipliers are free.
- [ ] **Modules** — a slotted item for +speed, +output or −power in a tier-3
      machine. A sink that never saturates.
- [ ] **Steel and 8–10 new recipes** — gives research something worth gating.
- [ ] **Belt tiers Mk2 and Mk3** (3.2 and 6.4 tiles/s), pending the open
      question on whether belts get tiers at all.
- [ ] **Underground belts** — a placed pair passing items beneath up to 6
      tiles. What makes a large factory readable.
- [ ] **Long-haul transport** — a bound pair of ports, items entering one
      arriving at the other after a delay. Matches the tier-6 drone decision
      and costs a fraction of rails.
- [ ] **Belt-fed turrets** — ammo becomes a production line and the factory
      starts defending itself. The cleanest way to make the two halves of the
      game touch.
- [ ] **Production ledger** — items per minute per item, with a graph and a
      personal best. Already listed as a Phase 4 need; this is the concrete
      shape of it.
- [ ] **The Beacon megaproject** — five stages at camp, each a sustained
      delivery rate, the tower visibly growing. A progress bar standing in the
      world.
- [ ] **Second island via a bridge** — a new generated region with its own ore
      tier and tech branch. Multiplies content instead of ending it.
- [ ] **Audio** — there is none.
- [ ] **A hotbar** — now that the bag is a real slot grid, a row of quick slots
      that selects what build mode places is a small addition with a large
      effect on how it feels to play.
- [ ] **Bag upgrades** — `INVENTORY_SLOTS` is a fixed 24 with no way to grow it.
      A crafted satchel is an obvious early sink and a reason to build a
      workbench.

- [ ] **A real inventory screen.** The bag and the chest inspector are both
      plain text lists — no grid, no dragging a stack, no way to move anything
      from a chest back into your bag. Pairs with the write-only chest bug
      above: together they are why storage reads as a label rather than a place
      to put things.
- [ ] A frame-time overlay behind a debug flag, so performance regressions show
      up while playing rather than only under a profiler.

### Changes

- [ ] Saving still serialises the whole island every 8 seconds — about 110 kB of
      JSON on a barely-built one, most of it nodes and players, and it grows
      with the base. Now that placements coalesce onto that timer it is the only
      save cost left, so the next step is writing only what changed, or a
      compact format.
- [ ] Lab consumption should grant XP to every player on the island. `grantXp`
      fires only from gathering and mob kills today, which means automating
      your island *slows your character down*. This also gives peaceful worlds
      a levelling curve, which they currently lack.
- [ ] Scale `waveBudget` off the highest research tier completed rather than
      the night index alone. Researching is a choice, so difficulty stays
      opt-in and building freely never punishes you.
- [ ] Move `BELT_SPEED` from a module constant onto the `Belt` record. Needed
      for belt tiers, and it touches the save format.
- [ ] Grow `UPGRADES` from 9 stat entries and 4 weapons to 40–60 entries with
      rarity tiers. Once labs feed XP continuously a player sees hundreds of
      level-ups, and three cards drawn from the same nine is thin within an
      hour.
- [ ] Measure late-game goals as a rate held over time, never a total
      delivered. A total is farmed by leaving the game open; a rate can only be
      met by a factory that is genuinely good.
- [ ] The inventory screen leaves the world running behind it, which is right
      for watching a furnace but means a night can start while you sort a
      chest. Worth deciding deliberately rather than by default.
- [ ] A wall chipped to 1 hit point refunds its full cost, so taking it down
      and putting it back is a free repair. Walls want a repair action, or a
      refund that scales with the damage taken.
- [ ] Build mode gives no hover highlight for what `X` or right-click will
      take, so removal is aimed blind at whatever the cursor happens to cover.
- [ ] The camp `Chest` and the factory `Storage Chest` are different things
      with nearly the same name, in the same palette, two tabs apart.
- [ ] Camp placement keeps scenery away with a fixed 14px clearance while
      regrowth uses each node's real radius. Two numbers for one question.

- [ ] Ore is baked into the island canvas on the assumption that `world.ore`
      never changes after generation. **This blocks depleting ore** (first item
      under Bugs): if patches start depleting, the island has to be re-baked on
      change or ore has to move back to a live per-frame layer.
- [ ] The camera now snaps to whole device pixels, which is what lets the
      ground cache blit without resampling. Walking advances it in 4- and
      5-pixel steps where it used to be a continuous 4.29, so motion is
      quantised by well under a pixel. If it ever reads as judder on a
      high-refresh screen, this is the reason.
- [ ] `resize()` caps `devicePixelRatio` at 2, so a retina display rasterises
      four times the pixels every frame. Worth revisiting if lag is reported on
      one.
- [ ] The render loop allocates an object and a closure per visible entity each
      frame to feed the depth sort. Pooling them would cut the GC churn.

### Ideas

- [ ] Peaceful worlds need a fishing-only route to the top research tier, since
      `essence` also drops from wisps at night. Otherwise peaceful is locked
      out of the endgame it suits best.
- [ ] Research shared per world rather than per player once multiplayer lands —
      it is what makes another player arriving unambiguously good.
- [ ] Grandfather existing saves as fully unlocked when the palette becomes
      tech-gated. "Nothing is lost" is a stated pillar.
- [ ] Trains as a later flourish on top of port logistics, for the spectacle
      rather than the function.
- [ ] Fluids — oil, pipes, refineries. Deliberately deferred: a second belt
      system with its own network solving, for less return than anything above.
      Worth revisiting only after the second island exists.
- [ ] Blueprints — enormous tedium removed, but also the learning that early
      tedium teaches. Timing is the whole question.
- [ ] A sort button on a container, and a click that gathers every loose stack
      of one item into full ones. Cheap, and the first thing anyone asks for
      once a chest has eight slots.
- [ ] Item icons are CSS shapes in the UI and flat discs in the world. Drawing
      both from one shape table would make an item look like itself everywhere.

- [ ] **Measure the render path by frame rate, never by timing draw calls.**
      Canvas 2D records draw calls and rasterises them later, so
      `performance.now()` around drawing measures recording only. On a full
      base the recorded time read 7ms while the game actually ran at 30fps.
      Count frames over a wall clock, with a layer removed, and compare.
- [ ] `ctx.clip()` is the expensive canvas call, not the number of draw calls.
      One clip per tree was the whole difference between 30 and 60fps on a full
      island. Where a shape needs clipping to a simple outline, work the clipped
      polygon out in code instead.
- [ ] Batching many small shapes into one big path is *slower*, not faster. One
      path holding every belt on screen measured 7.4ms against 17.1ms — the
      rasteriser works over the whole path's bounding box, so a path spanning
      the screen costs the screen. Batch within one object, never across them.

### Needs testing

- [ ] The core loop has never been playtested by a human. Day length (3 min),
      night length (1 min), gather rates and belt speed are all unvalidated
      guesses.
- [ ] Touch controls are implemented but have never been run on real hardware.
      Driven on an emulated iPhone: the page loads, the canvas sizes correctly
      in both orientations, and the movement stick works; placing, rotating and
      removing do not (see Bugs).
- [ ] Dragging items on a touchscreen. The inventory screen is built on pointer
      events so a tap-then-tap should work, but it has only been driven with a
      mouse.
- [ ] Clearing land is now permanent: build on a chopped node and it never
      returns. Whether an island can be stripped bare over hundreds of hours,
      and whether that matters, has not been played out.
