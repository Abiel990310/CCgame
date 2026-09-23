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
| Machine inputs | One input slot reserved per ingredient | A two-ingredient recipe fed by two belts deadlocks forever if whichever ingredient saturates first is allowed to fill the whole grid. The machine refuses the surplus instead, and the belt backs up where a player can see it. |
| Saving | Periodic and coalesced, flushed on exit | Serialising the island costs more as the island grows, so a click never writes: it pulls the periodic save forward to 2 seconds. Leaving, pausing or hiding the tab flushes, so nothing a player did is lost by waiting. |
| Item storage | Fixed slot grids, sparse, with the held stack in the sim | A bag the player arranges has to keep an empty slot where it is; a compacted list slides every stack left the moment one runs out. The stack on the cursor lives on the player rather than in the DOM so closing, reloading or a lost tab cannot swallow it. |
| Quick slots | Bound in `localStorage`, not in the save | The bar says how one person likes their tools arranged, not what is true of an island. Keeping it out of the world means no save version, and one bar across every island — which is what someone who arranges it once expects. |
| Save format | Old versions load, newer ones are refused | Persistence is the promise the game makes. A field added later defaults; a save from the future cannot be guessed at. |
| Engine shape | Small generic engine, content as data | The only way a small team reaches hundreds of hours. Machines are one type driven by the recipe table. |
| Simulation | Deterministic and headless in `shared/` | Testable now; an authoritative server can run the identical code later. |
| Stack | TypeScript, Vite, canvas, no engine | Fast iteration, tiny bundle, full control of the netcode-facing render path. |
| Dependencies | Zero runtime deps, zero external requests | Nothing to leak, nothing to break when a CDN does. |
| Audio | Synthesised in Web Audio, never sampled | A sound pack would be the first file the page ever fetched, and the first thing between a load and a playable island. It also means the music can be generated rather than looped, which matters when someone is on the same island for hours. Sounds are a data table (`src/audio/sounds.ts`) like every other kind of content. |
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
| 1 | Miner, belt, chest, inserter | Things move without you | ✅ |
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

Steel is in: the furnace takes two inputs and smelts 2 iron plate + 1 coal into
a steel plate, and the assembler makes batteries from copper and coal, motors
from steel and gears, and advanced circuits from circuits and batteries. That is
the recipe half of this phase; power itself is still ahead.

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


### New features

- [ ] **Splitter** — one input, two outputs, alternating, with an optional
      filter per side. Best value per line of code in the factory layer: until
      it exists a belt feeds exactly one machine.
- [ ] **Long inserter** — an arm that reaches two tiles instead of one, so a
      machine can be loaded from across a belt. The one-tile inserter is built;
      this is the other half of that entry.
- [ ] **Inserter filter** — an inserter set to a single item, so a mixed chest
      can feed a line that only wants plates. Unloading a chest is possible
      now, which is what makes a mixed buffer worth having.
- [ ] **Inserter tiers** — `MachineDef.speed` already multiplies the swing
      time, so a faster arm is a data row and nothing else.
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
- [ ] **Mob voices** — every mob dies to the same sound. One row per mob in
      `src/audio/sounds.ts` would make a wisp and a brute distinguishable with
      your eyes on the belt you are laying.
- [ ] **Footsteps keyed to terrain** — sand, grass and rock each sounding like
      themselves. Movement is the verb the player does most and it is silent.
- [ ] **A pitch per item on production sounds**, so a bank of furnaces reads as
      a chord and a stalled one is audible as a gap.
- [ ] **Muffle the world behind an open modal** — a lowpass on the master bus
      while the pause or inventory screen is up, so the interface sits in front
      of the island rather than inside it.
- [ ] **Something to spend steel, motors and advanced circuits on.** They are
      made but nothing consumes them: every machine still costs wood, stone and
      iron plate. Machine tiers, the lab or the megaproject are all candidates,
      and until one lands the new chain is a collection rather than a sink.
- [ ] **Bag upgrades** — `INVENTORY_SLOTS` is a fixed 24 with no way to grow it.
      A crafted satchel is an obvious early sink and a reason to build a
      workbench.
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
- [ ] An inserter will not take from or give to another inserter, so items
      cannot cross a gap without a belt tile between them. Deliberate — it is
      what stops two facing arms passing one item back and forth forever — but
      the long inserter is the intended answer and this should be revisited
      with it.
- [ ] The miner's 1.2s cycle is written as a literal in `src/render/factory.ts`
      as well as `MINE_TIME` in the sim. Two places for one number.
- [ ] Weapons only ever fire at the nearest mob, so a forty-mob night sounds
      exactly like a one-mob night. Noticed while balancing combat audio; it is
      a combat-feel question, not an audio one.
- [ ] The factory hum counts machines within earshot every 0.3s by scanning
      every machine and belt on the island. Fine at hundreds; if a base ever
      reaches thousands it wants the same spatial index the renderer will need.
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
- [ ] The removal highlight only shows in build mode, so a right-click on the
      open island is still aimed blind. Either highlight outside build mode too,
      or make removal a build-mode action.
- [ ] A long name truncates in a quick slot (`Storag…`). A short display name on
      each machine and building would read better in an eight-wide bar.
- [ ] Steel plate and iron plate are both grey discs on a belt, so a mixed line
      cannot be read at a glance. Item shapes in the world would tell them apart.
- [ ] The machine screen lists every recipe its machine can run, and the
      assembler is already at six. It needs grouping or a filter before the
      steel tier doubles it again.
- [ ] The camp `Chest` and the factory `Storage Chest` are different things
      with nearly the same name, in the same palette, two tabs apart.
- [ ] Camp placement keeps scenery away with a fixed 14px clearance while
      regrowth uses each node's real radius. Two numbers for one question.
- [ ] Ore is drawn from `world.ore` whenever the ground cache is painted, so
      depleting a patch no longer means re-baking the island — but the cache
      still has to be told. Whatever makes ore finite needs to invalidate the
      ground cache on the tiles that change (setting `groundScale = 0` repaints
      it, and a tile-level version counter would be tidier).
- [ ] The ground cache is still the biggest allocation in the client: 29 MB at
      `devicePixelRatio` 2 on a 1280×800 viewport, set by `GROUND_MARGIN`. A
      smaller margin shrinks it but makes the cache scroll more often; worth
      tuning against a real phone rather than by guesswork.
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
- [ ] Quick slots that can hold an item as well as a build piece, once there is
      something worth using from the bag.
- [ ] Sorting discards the arrangement a player chose. A pinned or filtered slot
      would let a chest keep its shape while still tidying around it.
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
      **With one exception, found since:** shapes that tile the screen with no
      gaps have nothing wasted in that bounding box, and there batching wins
      outright. Grouping the ground mesh's triangles into one path per shade
      took a full repaint from 112ms to 32ms. Sparse, no; solid, yes.
- [ ] Stroking a path costs roughly three times filling it. The ground mesh
      stroked each triangle in its own fill colour to close the hairline
      between facets; growing the triangle about its centroid by 6% instead
      draws the same picture for a third of the cost.

### Needs testing

- [ ] **Nobody has actually listened to the game.** The audio layer was verified
      in headless Chromium by tapping the master bus with an analyser — which
      proves sound is rendered, that mute silences it and that gameplay drives
      it, but says nothing about whether it is pleasant. The mix, the default
      volumes and the generative music all want a human with headphones.
- [ ] Audio on a phone. iOS needs a gesture before a context will start (the
      menu click is one) and honours the hardware mute switch, neither of which
      has been tried on real hardware.
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
- [ ] Whether a coal patch now pulls its weight in a real base. The steel and
      battery lines were built and run in a browser, but the ratios (a coal
      miner outruns steel demand several times over) have never been played.
- [ ] Motor and advanced circuit are covered by simulation tests only; neither
      has been built as a line in a browser.
- [ ] The ground cache now scrolls: on a rebuild it slides what is still in
      view and paints only the strip that came in. Driven in headless Chromium,
      where the rebuild frame went from ~43ms to ~28ms and the scrolled cache
      matches a full repaint pixel for pixel bar faint facet-edge antialiasing.
      Software rasterising exaggerates both numbers; it wants a look on real
      hardware, and on a phone especially.
- [ ] Clearing land is now permanent: build on a chopped node and it never
      returns. Whether an island can be stripped bare over hundreds of hours,
      and whether that matters, has not been played out.
- [ ] Inserter throughput has not been balanced by play. One arm moves about
      1.7 items a second against a belt's 1.6 tiles a second, so a single
      inserter roughly keeps pace with one belt. Whether that is the right
      ratio for feeding a furnace bank is a guess.
