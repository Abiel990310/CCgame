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
| 5 | Multiplayer: co-op on the host's island (done); accounts, cloud islands and friends (live 2026-09-25); dedicated server worlds | In progress |
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
| Ore depletion | Large but finite | A patch holds hours of mining and then stops. Infinite ore makes the first patch the last one and takes expansion out of the game; a small patch turns the factory into a chore of moving miners. Large enough that running one dry is something you plan for. |
| Miner reach | Its own tile and the ring around it | A miner that drained only the tile under it would have to be moved every quarter of an hour, which is tedium rather than the expansion depletion is for. Nine tiles is a couple of hours of one miner, so the thing you outgrow is the patch. |
| Placement | Everything snaps to the tile grid | Belts cannot align without it, and freeform camp pieces meant a row of walls never came out straight. Build mode draws the grid so it is visible while placing. |
| Camp vs factory | One overlap test, in `shared/sim/building.ts` | Camp pieces are circles in world units and factory pieces own whole tiles, so neither list can see the other by lookup. Both placement checks now go through the same circle-against-tile test, with 4px of slack so a wide piece does not claim the ring of tiles its edge merely grazes. |
| Tile lookup | The grid maps a tile to the entity itself | Belts hand off every tick, so resolving a tile has to be O(1). Storing an id meant scanning every belt and machine, which made a tick O(belts squared). |
| Machine tiers | A tier is a data row: a family plus a speed multiplier | A steel furnace is a furnace that runs faster, so it points at the furnace's recipes rather than duplicating them. Adding a tier costs one row in `machines.ts` and no recipe rows, which is what keeps the engine small as the ladder grows. |
| Inserter reach and filters | Data rows on the machine table, not new machine types | `MachineDef.reach` is what makes the long arm a row rather than a system, and `Machine.filter` sits beside the recipe so both arms take one. A third arm, or a filtered one of any length, costs a table entry. |
| Arm hand size | An inserter's one slot size is its hand | The stack arm is the first arm that carries more than one item, and making the hand the slot's size keeps it a row. It lifts one kind at a time and lets go one by one, and it only shows red after a whole swing's wait with nothing let go, so feeding a belt faster than the belt spaces items is not a blockage. |
| Machine inputs | One input slot reserved per ingredient | A two-ingredient recipe fed by two belts deadlocks forever if whichever ingredient saturates first is allowed to fill the whole grid. The machine refuses the surplus instead, and the belt backs up where a player can see it. |
| Research | Packs belted into labs, owned by the world | Research is the first thing the factory feeds rather than the player, so an unlock is a throughput problem: a second lab is worth exactly what a second furnace is. It belongs to the island, not a player, because a lab is a building and multiplayer will have several people feeding one tree. |
| Tech effects | Multipliers, plus unlocks for the tiers above the first | Every tier-1 machine is there from minute one and a tech still makes the factory you built worth more, but Mk2, Mk3 and the logistics sidegrades are earned. The two repeatable techs stay pure multipliers, so the curve still never ends. |
| Palette gating | Enforced in `placeMachine`, listed as `unlocks` on the tech row | The gate is a data row like everything else, and the simulation refuses a locked piece so a future server does not have to trust the client's palette. Locked pieces stay visible on the palette, showing the tech that opens them. |
| Gated palette on old islands | Grandfathered: an island saved before version 7 keeps every machine | "Nothing is lost" is a pillar. `Research.unlockedAll` records it, so the island stays unlocked after it is saved again. |
| Essence and peaceful worlds | The top tech takes a Resonance Pack (circuit + essence); a researched Fish Trap catches essence on a shoreline | Essence also drops from night wisps, which a peaceful island never sees. The trap rolls the fishing spot's own drop table, so peaceful reaches the top of the tree by fishing alone and raid worlds get a second source. |
| First-hour guidance | A chain of goals in `shared/data/goals.ts`, each a check on the island's state | A new player had no idea what to do first. A goal is met when the island is in that state, so one reached by the player's own route ticks off, and nothing needs a history the save does not keep. Checked once a second in the sim so a server can run it; an older island starts silently at its first unmet goal. |
| Level-up draft | Queued behind a badge, opened by the player | Labs level players up in the background, and a draft that froze the island every few minutes punished building a factory. Only the open draft pauses. |
| Drag to build | Holding the button lays a piece on every tile crossed; a belt faces the drag | Laying belts one click at a time was the most repeated action in the game, and on a phone dragging is the only natural way to say which way a belt runs. |
| Research XP | Every lab cycle levels up every player | Gathering by hand was the only source of XP, so automating the island slowed the character down and a peaceful world barely levelled at all. |
| Item art | One shape name per item, drawn by one function everywhere | An item has no art, so its silhouette *is* its identity. While the bag drew CSS boxes and the world drew a coloured blob, iron and steel plate were the same grey disc on a belt however different they looked in the bag. The names live in `ITEMS`, the drawing in `src/render/items.ts`, and the bag shows the canvas drawing rather than a copy of it. |
| Interface look | One visual language, SVG icons, art baked from the world's own drawings | Emoji icons rendered as a different picture on every platform, so the HUD never looked like one thing. Icons are inline SVG (`src/ui/icons.ts`), and the hotbar and palette show each piece baked from the canvas drawing the world uses (`src/render/pieces.ts`), so a slot looks like what it places. Still zero requests and system fonts only. |
| World art | Outlined, lit, illustrated characters and scenery; ground as a soft colour field plus hand-placed detail | Abiel asked (2026-09-24) for a serious game look rather than flat low-poly blobs. Everything is still procedural canvas, zero requests. Trees, rocks, bushes and camp pieces bake per variant at device scale (`src/render/paint.ts` `blitCached`), so a detailed forest draws faster than the blobs did; characters draw live because they animate. The ground is one small colour bitmap per island, resampled once, with biome edges jittered by noise but the coastline kept within a few pixels of the real shore. |
| Workbench crafting | Tools and every advanced machine are crafted at a workbench into the bag; placing a crafted machine spends that item | Abiel (2026-09-24): buying higher-tier items straight off the build bar made no sense. Belts, tier-1 miners, furnaces, assemblers, chests, inserters and the fish trap are still built from materials so the start stays quick. A crafted machine is one flag on its row (`crafted: true`), its `cost` becomes the recipe, and `placementCost` is the one place that knows; removing it returns the machine, not the materials. Crafting is instant and happens beside a bench (`WORKBENCH_REACH`). |
| Tools | Carried, not equipped: the best tool of a kind in the bag multiplies that kind of gathering | No equip slot to forget and no save field: a tool is an `ITEMS` row with a `tool` entry. |
| Machine art | A static body sprite per type and facing, with only moving parts drawn live | The 3/4-view blocks are a dozen fills each; drawing them per frame cost about 45% more than the flat boxes they replaced on a full screen. Baking shadow, block, deck, port and tier marks once brought it back level with the old art. |
| Saving | Periodic and coalesced, flushed on exit | Serialising the island costs more as the island grows, so a click never writes: it pulls the periodic save forward to 2 seconds. Leaving, pausing or hiding the tab flushes, so nothing a player did is lost by waiting. |
| Save contents | Derive what the seed decides; store only what play changed | Scenery was 109 kB of a 110 kB save and `createWorld` already rebuilds it from the seed, exactly as terrain is. Nodes are regenerated on load and only the chopped and cleared ones are written, which is also why worldgen changing under an existing island would move its scenery. |
| Save layout | One entry per part of the island, grouped by how often it changes | A header, the scenery, and the factory. A section whose text has not moved is not written again, so standing still costs the header alone instead of the whole world. |
| Item storage | Fixed slot grids, sparse, with the held stack in the sim | A bag the player arranges has to keep an empty slot where it is; a compacted list slides every stack left the moment one runs out. The stack on the cursor lives on the player rather than in the DOM so closing, reloading or a lost tab cannot swallow it. |
| Quick slots | Bound in `localStorage`, not in the save | The bar says how one person likes their tools arranged, not what is true of an island. Keeping it out of the world means no save version, and one bar across every island — which is what someone who arranges it once expects. |
| Save format | Old versions load, newer ones are refused | Persistence is the promise the game makes. A field added later defaults; a save from the future cannot be guessed at. |
| Worldgen | Versioned as part of the save contract | Saves hold only differences from what the seed grows, so they mean nothing against a different generator. `WORLDGEN` is recorded in every save and guarded by a fingerprint test; an island from an older generation gets today's ground rather than deltas laid over land they do not describe. |
| Tabs | Last to open an island owns it | Every tab holds the whole island and saves it wholesale, so two writers corrupt each other. An owner record beside the slot is the rule; a broadcast asks the old tab to save before the new one reads. |
| Fuel | A separate fuel grid on burners, spent per recipe-second | Coal is also a steel and battery ingredient, so it could not share the recipe grid without starving one or the other; a burner keeps `FUEL_RESERVE` in hand before letting coal through to the recipe. Burning per unit of work rather than per second makes every craft cost the same coal in every tier. |
| Island size | Per island, fixed by the generator that grew it | New islands are 256 tiles across; islands grown before keep 96 and their own generator, so nobody's factory lands in the sea. `createWorld` sets the live `MAP_*` bindings, which is safe because one process simulates one island. |
| Exploration | A seen-tile mask in the save, as run lengths | A bigger island needs a reason to walk and a way to find your way back. The mask is sim state so co-op guests share it, and costs a few kilobytes. |
| Far ore | Patches get up to 2.2× richer and wider towards the coast | Makes the far side of the island worth a long belt or a second base instead of only more of the same. |
| Power | One network per set of wired poles, balanced every tick; tier 3 runs on it instead of coal | The fuel memo said power should replace tier 3's fuel rather than run beside it. Supply short of demand slows every machine by the same share rather than stopping some, so an overloaded base degrades visibly instead of flickering. The layout is derived from the machines and never saved; a starved machine's `unpowered` flag is, so a guest balances the same demand as the host. |
| Tech added under a finished one | Granted on load | Electricity sits under Resonance; an island that finished Resonance first gets it free, so its electric machines stay buildable. Done generically for any prerequisite added later. |
| Engine shape | Small generic engine, content as data | The only way a small team reaches hundreds of hours. Machines are one type driven by the recipe table. |
| Simulation | Deterministic and headless in `shared/` | Testable now; an authoritative server can run the identical code later. |
| Stack | TypeScript, Vite, canvas, no engine | Fast iteration, tiny bundle, full control of the netcode-facing render path. |
| Dependencies | Zero runtime deps, zero external requests; PixiJS is the one exception (2026-09-25), bundled and loaded from the same site only when the GPU renderer is on | Nothing to leak, nothing to break when a CDN does. |
| Audio | Synthesised in Web Audio, never sampled | A sound pack would be the first file the page ever fetched, and the first thing between a load and a playable island. It also means the music can be generated rather than looped, which matters when someone is on the same island for hours. Sounds are a data table (`src/audio/sounds.ts`) like every other kind of content. |
| Rendering between ticks | Draw moving things blended between their last two tick positions, one tick behind the sim | The sim ticks at 30 Hz and screens refresh at 60 or more; drawing raw positions showed each one for two frames or more, so walking read as 10–15 fps. Lives in `src/render/interpolate.ts`, never in `shared/`. The same blend is what multiplayer needs for other players. |
| Co-op netcode | The host's browser runs the island; guests replay its ticks | Guests send what they press and click; the host applies it between ticks and sends every guest that tick's orders and inputs, so each copy of the deterministic sim takes the same step. A tick costs about 150 bytes where state snapshots would cost tens of kilobytes, and a fingerprint every second replaces a copy that drifts. Every click that changes the island is a `Command` in `shared/sim/commands.ts`. |
| Co-op transport | WebRTC data channels, signalled through the public PeerJS broker | No server to run or pay for, on static hosting. The page talks to the broker only when someone hosts or joins, and speaks its protocol directly so there is still no runtime dependency. Friends' characters are saved on the host's side, beside the island. |
| Accounts | Supabase (Auth plus Postgres), called with plain `fetch`; every call is a function in `docs/cloud/schema.sql`, and the tables grant the browser nothing | The site is static, so accounts need a hosted backend; Supabase's free plan covers sign-in and a database with no server to run. Hand-writing the dozen calls keeps the page free of a second runtime dependency, and putting every rule in SQL functions keeps the security in one file. A cloud island is the local slot bundled as-is, so the save format needs no second migration path, and a per-world lease keeps two devices from overwriting each other. |
| Renderer | PixiJS (WebGL) by default, Canvas as the fallback, both drawing the same art through a Canvas-shaped adapter | Abiel chose it on 2026-09-25 as the engine web games use, so the game can grow on it. The first runtime dependency, loaded only when the GPU renderer is on. The art stays written once against the Canvas API, so the two renderers cannot drift apart while Pixi is proven. |
| Co-op signalling | The game's own Supabase project (Realtime Broadcast) first, the public PeerJS broker second; either can also relay the game when no direct channel opens | 2026-09-26: joins failed on Abiel's Mac with the host never answering through the public broker, which nobody here can fix or see into. The host now listens on both, and a guest tries its own project first. |
| Pixel look | The scene is drawn at one canvas pixel per world unit and the browser scales it up by a whole number of device pixels (`image-rendering: pixelated`); zoom steps are those whole numbers. `?look=smooth` or Esc > Graphics gives the old full-resolution look | 2026-09-26, the "one art style" gap against Cinderhollow: the player sprite, the vector trees and the belts now share one pixel grid, so the whole scene reads as pixel art, and there are far fewer pixels to fill. |
| Colour grade | Three DOM layers the compositor blends over the stage (grey at `saturation`, a tint at `soft-light`, a vignette), in `src/render/grade.ts`; only the vignette without a graphics card | 2026-09-26, from comparing with Cinderhollow: every screen shared one flat palette, so noon, dusk and a raid looked alike. Grading the frame gives the day a mood without repainting any art, and costs the same under Canvas and Pixi. In software each blended layer cost about 10 fps at night, so a browser drawing WebGL on the CPU gets the vignette alone; `?grade=full` or `?grade=lite` overrides the guess. |
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
| 4 | Power (coal → steam) | Everything slows when power runs short | ✅ |
| 5 | Steel, resin, advanced circuits | Chains six or more steps deep | Recipes and machine tiers done; resin ahead |
| 6 | Island logistics: drones, rail | Remote outposts on distant ore | Planned |
| 7 | The Megaproject | An endgame sink with unbounded appetite | ✅ Skyward Beacon |

**Tier 7 is the answer to late game.** A tech tree ends; a structure that always
wants more throughput does not. Factorio has the rocket, Satisfactory has the
space elevator. Without one, players finish the recipes and stop.

## Phase 4 — power and depth (next)

Steel is in: the furnace takes two inputs and smelts 2 iron plate + 1 coal into
a steel plate, and the assembler makes batteries from copper and coal, motors
from steel and gears, and advanced circuits from circuits and batteries. Those
now have somewhere to go: every miner, furnace and assembler has a Mk2 bought
with steel and gears and a Mk3 bought with motors and advanced circuits, at
double and quadruple speed. That is the recipe half of this phase; power is in
too (below).

Research is in too. A **Lab** eats research packs off a belt, and `TECHS` in
`shared/data/techs.ts` is the tree it works through: three packs
(research, logic, power) assembled from the existing chain, eight techs, and
two of them repeatable forever. Every tech is a multiplier on machines that
already exist — mining, crafting, belt and inserter speed, lab speed, research
XP — and the tiers above the first are unlocked by it: automation opens the
steel miner, belt logistics the splitter, merger and long inserter, metallurgy the
steel furnace, assembler Mk2 and steel chest, robotic arms the fast inserter,
angling the fish trap, and resonance, which eats essence, the three electric
machines and the stack inserter. A finished tree still compounds
through the two repeatable techs.
Each lab cycle grants XP to every player on the island, which is what stops
automating your island from slowing your character down, and gives a peaceful
world a levelling curve at last.

- [x] Power as a network. **Steam engines** stand on a shoreline and burn coal
  only as fast as their load asks; **power poles** power machines within four
  tiles and wire to poles within eight. Every tier 3 machine (electric miner,
  electric furnace, industrial assembler, stack inserter) now draws power instead
  of burning coal, and a network short of supply slows every machine on it by
  the same share. The **Electricity** tech (research + logic packs, after
  Metallurgy) unlocks it and sits under Resonance.
- Steel and resin: recipes six or more steps from raw ore.
- Belt tiers or not (see open questions).
- Production statistics, so a player can find their own bottleneck. This is a
  core factory-game affordance, not a nicety. **Done 2026-09-25:** the
  Production tab beside the map (L).

## Phase 5 — multiplayer

**Co-op is live.** The host opens their pause menu and chooses *Invite
friends*; up to three friends choose *Join a friend* on the main menu and type
the five-letter code, or open the invite link. The host's browser runs the
island and owns the save; guests replay its ticks (see the decision log). What
follows is the dedicated-server version the co-op path grows into.

**Accounts are live** (2026-09-25, Supabase project `qidagnlgbndteepzkjzt`). With
an account, islands are kept in the cloud and play on any device; friends add
each other by name; and an owner who sets an island to *My friends* has co-op
open itself while they play, so friends see it in their menu and join with one
click. `docs/cloud/README.md` has the steps to turn it on and how it works.

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

- ~~**Do ore patches deplete?**~~ Answered: large but finite, in the decision
  log above. Revisit only if play shows the numbers are wrong.
- ~~**How is the tech tree gated?**~~ Answered: by producing research packs and
  belting them into labs, in the decision log above.
- **Do belts get tiers** (faster belts), or does throughput scale only by adding
  parallel lines?
- **How early do blueprints arrive?** They remove enormous tedium, but also
  remove the learning that early tedium teaches.
- ~~**How are private world invite lists managed**~~ Answered: accounts and a
  friends list, with share codes still working underneath (2026-09-25).
- **Does the camp stay freeform** or move to slot-based upgrade tiers?

## Backlog

Everything found or proposed, grouped so it can be skimmed and approved a few
items at a time. **Every session adds here as it goes** — a bug noticed in
passing, an idea while doing something else, a change a design pass implies.
Nothing waits for a tidy moment. Tick an item to approve it for building; the
detail behind the factory entries is in
[CCgame late game progression](https://claude.ai/code/artifact/261951ca-ed94-49d6-aee9-3fc4e49346ca).

### Bugs

- [ ] Co-op: when a guest's direct channel fails mid-game it switches to the
      relay and says hello again, so the host treats it as a new arrival
      (a fresh snapshot, and on a gone host 30 s before the guest is told).

- [x] Night 15 in headless Chromium with the GPU renderer showed no night
      darkness: the island was lit like day while the HUD read Night. The
      darkness curve ran each twilight twice, on both sides of the change of
      phase, so every dusk darkened to 68%, snapped back to 5% as night began
      and darkened again; dawn did the reverse. Both renderers. Twilight now
      straddles the change, half each side. (Headless also only paints when
      something asks for a frame, so a screenshot is needed to see a change.)
- [x] Spitters and the Swarm Queen faced away from the player while they
      backed off, because a creature faced the way it moved. They now face
      what they are shooting at.
- [x] A piercing shot (bow, thornburst) spent its pierce hitting the same mob
      again on the next tick, so it rarely reached a second target. Each shot
      now remembers what it went through.

- [x] The game gets very laggy near the campfire. Not the campfire: the
      island's centre is its thickest forest, and each tree was blitted at a
      fractional pixel, so the rasteriser filtered every one. Sprites now land
      on whole device pixels and night lights are gathered at quarter
      resolution. Headless, 2x screen: a fresh camp by day went from 37 to 98
      fps, a camp with 12 lamps at night from 20 to 47. Full notes under
      Changes, "Move drawing to PixiJS".
- [x] Walking stuttered: scrolling the one big ground cache copied it onto
      itself and painted the incoming strip, 35 to 95 ms a few times a second
      on a 2x screen. The ground is now fixed 4-tile chunks (`groundcache.ts`)
      painted once and a couple ahead of the view each frame; walking went from
      about 15 frames over 33 ms per 12 s to none.
- [x] On a phone held sideways (iPhone 13 landscape, 750×342) the day panel
      covers the right half of the health and XP bars. Sideways phones up to
      900px wide now get compact vitals and a narrower phase panel. The five
      action buttons take two rows there, where the Map button had pushed Build
      under the hotbar. On a portrait tablet they climb the right edge, and the
      palette stays clear of them. Surveyed clean at 16 sizes.
- [x] On a portrait tablet (810px) the build palette squeezes six category
      columns into the width, so names wrap and "Workbench" is clipped on the
      Lab card. Groups now wrap onto a second row once a column would drop
      under 124px, and the palette stops short of the goal tracker.
- [x] On a portrait phone a toast can land on the top edge of an open build
      palette. Toasts wrap instead of running into the buttons, and in build
      mode they sit under the goal, clear of the palette.
- [x] Toasts still landed on an open palette on a portrait phone once two or
      three stacked up, since each wraps to three lines there. With the palette
      open a phone shows only the newest toast.
- [x] Machines could not be turned on a touchscreen: there is no R key, and
      tapping a placed machine did nothing. A tap on any placed piece in build
      mode now turns it a quarter, as belts already did, and the build bar has
      a turn button for the piece about to go down. Checked at 320, 390 and
      810px wide.
- [x] On a 320px phone the build bar's second card in each row is cut off by
      the palette edge; it scrolls sideways, but nothing says so. A row with
      more cards now fades at its edge and shows an arrow that steps one card
      along, and swipes snap to a card. Checked at 320, 390 and 800x360.
- [ ] The Lab's "Workbench" note in the desktop build palette runs 5px past
      its card's right edge at 1280px.
- [x] The overlapping HUD panels are still showing after the UI revamp. The
      co-op code chip sat on the resource pouch at every screen size, and on
      a 320px phone the phase panel wrapped into it. The top-right corner is
      now one stack, the chip is compact on phones, and phone toasts stay
      clear of the button column. Surveyed clean at 11 sizes from 320px to 1920px.
- [x] Co-op: "Lost the matchmaking service" when the broker's socket dropped,
      which also threw a guest out of a game that no longer needed it. The
      broker now reconnects quietly, and guests let go of it once they are in.
- [x] Co-op: when the host's tab goes to the background, browsers throttle its
      timers and the island slows or stutters for everyone on it. A covered
      host tab got one frame a second, so friends got 7.5 ticks a second in
      one lump each second. A worker now keeps the host's beat whenever frames
      stall: friends get 30 even ticks a second, hidden or not.

- [x] The first click on a machine after closing another machine's screen with
      Esc sometimes opened nothing. A mouse moving over an open screen never
      told the island where it went, so the click aimed at the old spot. A
      press now updates the cursor itself, which also fixes shift-click paste.
- [x] The main menu's Sign in button sat beside the title and pushed "The
      Island" onto two lines on every screen. It now sits in the screen's
      top-right corner. A sideways phone also cut the top of the menu off with
      no way to scroll to it; the menu now centres only while it fits.
- [x] Hover cards after closing a screen stayed off, or described the old
      spot, until the mouse moved. The canvas now takes the cursor's place
      from the pointerenter a closing screen sends.
- [x] On a phone the build palette covers the column of action buttons, so
      Build and Bag cannot be pressed while it is open. The palette is now
      narrower than the screen and the buttons stay beside it.
- [x] On a portrait tablet (810px) the vitals, phase and pouch panels overlapped.
      Between 641px and 900px the phase moves right and the pouch becomes a
      strip under the top row. A landscape phone's palette also sat 2px over the
      hotbar.
- [x] `npm run preview` was reported to 404 the module bundle in the cloud
      container. It did not reproduce on 2026-09-25 (Chromium launched plainly
      loads it; through `HTTPS_PROXY` localhost gets 405). CLAUDE.md now says
      so and gives the `python3 -m http.server` fallback.
- [x] Two tabs open on the same island overwrote each other, and the
      skipped-write cache could make one skip a section the other had already
      replaced. Now whoever opens an island last owns it: the other tab saves,
      hands it over and returns to the menu saying why, and never writes to it
      again unless it is opened there once more.
- [x] In a browser without `BroadcastChannel` the tab losing an island could
      autosave underneath the new tab in the instant before it saw the new
      owner. When nobody hands the island over, the new tab now records itself
      and waits 0.8s before reading, so that last save is loaded, not buried.
- [x] Touch had no way to remove anything. In build mode, holding a finger
      still on a piece for half a second now removes it.
- [x] Tapping the canvas placed nothing, so a phone could not build or inspect
      a machine. A tap now places in build mode and opens a machine outside it.
- [x] Touch had no rotate. A belt line faces the way it is dragged, and tapping
      a placed belt turns it a quarter.
- [x] On desktop at 1280x800 the build palette stays open over most of the
      screen while placing, so there is little ground left to click on. It now
      folds to its tabs and the selected piece while the mouse is out over the
      island, and opens again when the mouse comes back.
- [x] The goal tracker overlapped the resource strip on a phone and a portrait
      tablet, and an open palette on a laptop. The goal now sits under the
      strip, and the palette stops short of it.
- [x] The phase bar and the vitals panel overlap on a phone. At 390px wide the
      vitals card covers the Day/Night readout entirely. No longer overlapping
      at 390px as of 2026-09-24 (measured in Chromium at iPhone 13 size).
- [x] Shift-clicking a large stack into a two-slot machine fills **both** input
      slots with one ingredient, so the second ingredient can never get in and
      the machine deadlocks until you take some back out by hand. Shift-click
      now keeps to the same per-ingredient share a belt does (labs too); the
      rest stays in the bag. Placing a stack on a chosen slot is still free.


### New features

- [ ] Co-op: a TURN server (Cloudflare or Metered free tier) so friends on
      strict networks get a direct connection rather than the slower relay.
- [x] Co-op: signal through the Supabase project as well as the PeerJS broker,
      so joining still works if the public broker is down. Done 2026-09-26.
- [x] Co-op: a connection log on a failed join, the host's co-op panel and a
      dropped game, so a friend can send exactly which route got how far.
      Done 2026-09-26.
- [ ] Tell a player on an old tab that a new version is out, before a join
      finds out the hard way.

- [ ] Accounts: friends can open a shared island while its owner is away, not
      only join while someone is on it. Needs the save lease to allow a
      friend, and the owner's character to wait at camp.
- [ ] Accounts: a per-island list of who may drop in, beside "Only me" and
      "My friends".
- [ ] Accounts: see which friends are online and on which island, not only
      islands open to you.
- [ ] Accounts: invite a friend straight to your island from the friends list,
      as a notice in their menu.
- [ ] Accounts: sign in with Google or Discord as well as email.
- [ ] Accounts: a way to change email or password, and to delete the account.
- [ ] Accounts: the host checks a joining friend's sign-in, so a leaked room
      code cannot pass for an account. Today the code alone lets anyone in,
      as it always has.

- [x] **Landmarks** on new mainlands: buried caches, old ruins, crashed supply
      pods and essence shrines, placed so the rarer ones lie further from camp.
      Hold E to search one; it spills a cache that grows with distance, and a
      shrine also grants an upgrade. They show on the map once explored.
      Islands grown before this (worldgen 2 and older) have none.
- [x] Guarded landmarks: ruins wake three crawlers, supply pods two spitters
      and a brute, shrines two shellbacks and three wisps, when a player first
      comes within seven tiles. They hold their post day and night, chase no
      further than about ten tiles from it, and are not cleared at dawn.
      Peaceful islands have none. A reload puts them back, since mobs are not
      saved.
- [x] A count of landmarks found and left on the island map: beside the
      explored share it reads "3 to search · 30 undiscovered", and on a phone
      it takes its own line under the tabs.
- [ ] Searched landmarks leave the island, so the map cannot say how many
      you have searched. A count kept on the world (or per player) would let
      it read "5 of 34 searched" and could feed an exploration goal.
- [x] A late-game megaproject: the **Skyward Beacon**. Research it (logic,
      power and engineering packs, after Solar Power and High-Pressure
      Steam), craft it, and raise it in five stages: foundation, spire,
      wiring, lens and ignition. Each stage is fed by arm or by hand from
      the whole tree, including three new tier-4 parts: **Processors**,
      **Steel Frames** and **Resonant Lenses** (which take essence). The
      spire grows a section per stage and throws a sweeping beam once lit.
      Three goals follow the chain to it.
- [ ] A lit beacon should light the night like the campfire does. Left for
      after the engine thread's night-layer rework (PR #47), which owns
      the lighting code.
- [x] What a lit beacon gives back beyond the XP: it burns processors, one a
      minute, from a reserve of up to 20, and while it burns every machine,
      miner and lab on the island works 30% faster. Out of fuel it banks to an
      ember and the boost stops, so running it for good needs a processor line.
- [x] The beacon screen labels its slots "Fuel" once lit, not "Delivered".
- [x] A burning beacon wards the ground within 10 tiles of it: creatures there
      move at 60% pace, so a camp built round it holds better at night.
- [ ] Draw the beacon's ward on the ground at night, a faint ring the raiders
      visibly wade into. Waits for the engine thread's lighting layer, since a
      ring drawn in the Y-sort would cross the sprites north of the beacon.
- [x] Around fifty level-up upgrades (49): 26 perks you can stack up to a
      cap (range, crits, armour, thorns, lifesteal, pierce, knockback, a
      finisher, night and camp damage, dash, revive, day speed, map sight,
      double harvests, per-resource gathering, more essence, a fourth
      choice) and a mastery for each weapon once it is at its last level.
      Rarer perks turn up less often; a perk taken again shows its numeral.
- [x] A small list of the perks you hold, in the bag screen, so a build is
      readable after thirty levels. "Your build" under the bag shows each
      weapon and perk as a chip in its card colour with level pips, and the
      plain boosts as totals (+32% damage, +40 max health).
- [ ] Plain stat boosts (Sharpened, Hearty and the rest) are folded into
      `stats` rather than counted, so the build list can show only their
      totals, not which boosts were taken or how often.

- [x] More to fight: the **Spitter** (night 4) keeps its distance and spits,
      the armoured **Shellback** (night 5) shrugs off weak hits, the **Mother
      Slime** (night 6) bursts into four slimes, and every fifth night a
      **Stone Warden** boss walks in and drops a heap of orbs and essence if
      it falls before dawn. Three new weapons: the long-reach **Harpoon**,
      the splash-damage **Ember Pot**, and the slowing **Frost Shard**. You
      can carry five weapons instead of four.

- [x] A longer tech tree: Toolmaking (hand gathering), Firebox Design (every
      coal does more), Weaponsmithing and repeatable Ballistics (damage),
      High-Pressure Steam and repeatable Grid Capacity (generator output),
      and Solar Power. A new Engineering Pack (plate → pipe → engine unit +
      circuit) drives the power-era techs. Solar panels make 60 kW by day with
      no fuel. The goal chain runs on past tier 2 through steel, logic packs,
      Electricity, a steam engine, a powered machine and engineering packs.

- [x] A much bigger map, so the island feels like an open world rather than one
      screen of forest. New islands are a 256-tile mainland (seven times the
      area) with lakes, highlands and richer ore towards the coast; islands
      from before keep their 96 tiles. Exploration fog and an island map (M,
      or the Map button) show what you have seen.
- [ ] A rich ore vein guarded by a nest, as a landmark kind of its own.
- [ ] Map pins: let the player mark a spot on the island map.
- [ ] A big content pass across every system (recipes, machines, techs, goals,
      mobs, camp) aimed at tens to hundreds of hours of play over the next
      weeks. *Hold lifted 2026-09-24; planned across the week to 2026-10-01:
      power, a longer tech tree, more tiers, creatures and weapons, ~50
      upgrades, a megaproject.*
- [ ] Co-op: predict a guest's own movement locally. A guest sees their own
      steps one round trip late (under a tenth of a second on a good line).
- [ ] Co-op: a TURN relay fallback, so friends on strict networks (some mobile
      carriers, offices) can still connect. Needs a paid or self-hosted relay.
- [ ] Co-op: a short chat line and a ping marker ("over here").
- [ ] Co-op: a colour per player, so friends are told apart by more than name tags.

- [x] **Splitter** — one input, two outputs, alternating, with an optional
      filter per side. Built as a T: whatever feeds it goes out to the tiles on
      its left and right, turn by turn, skipping a side that is full or
      filtered against. A side is set by dropping an item on it in the machine
      screen, and a splitter with both sides filtered is a sorter — it refuses
      what it cannot route rather than jamming on it.
- [x] **Merger** — two belts into one, the splitter read backwards. Built:
      a crafted `merger` row, unlocked with the splitter by Belt Logistics.
      Belts on its left, behind and right run into it and it sends one line
      out of its front. It takes from the feeding belts turn by turn rather
      than being pushed into, so with the line ahead full each feed still gets
      an even share; plain side-loading hands every gap to whichever belt
      ticks first. The turn is saved.
- [x] **Long inserter** — an arm that reaches two tiles instead of one, so a
      machine can be loaded from across a belt. Built: a `MACHINES` row with
      `reach: 2`, slower than the short arm.
- [x] **Inserter filter** — an inserter set to a single item, so a mixed chest
      can feed a line that only wants plates. Built: set from the arm's screen,
      and anything else rides past it on a belt.
- [x] **Inserter tiers** — `MachineDef.speed` already multiplies the swing
      time, so a faster arm is a data row and nothing else. `reach` is now a
      data row too, so a longer one is as well. Built: a fast inserter (2.5x,
      about four items a second) and a stack inserter that lifts four at once.
- [x] **Filtered chest slots** — the same filter idea on a chest, so a buffer
      reserves room for what a line needs rather than filling with one item.
      Built: `Filter slots` in the chest screen, then the splitter's gesture on
      a slot. A kept slot shows its item faintly while empty, is filled first,
      refuses anything else from a belt or a hand, and keeps its place on Sort.
- [x] **Copy settings between machines** — a bank of filtered arms means
      setting the same filter a dozen times by hand. Built: shift+right-click
      copies, shift+click pastes, or the buttons in the machine screen. Works
      across tiers of one family: recipe, arm filter, splitter sides, chest
      slot filters.
- [x] **Fuel slots** — tier-2 furnaces and assemblers burn coal off a belt.
      Every furnace bank then needs two input belts, which roughly doubles the
      interest of a layout. Tier 3 burns coal too until power exists; one coal
      pays for 8 recipe-seconds in every tier, so four plates. `fuelSlots` and
      `FUEL_VALUE` in `machines.ts` are the whole knob.
- [x] **Storage and logistics tiers** — a steel chest with more slots and a fast
      inserter. Miners, furnaces and assemblers have three tiers each now;
      `MachineDef.speed` already multiplies an inserter's swing, so both are a
      row apiece. Built: a 16-slot steel chest, twice a wooden one.
- [ ] **A third chest tier** — a warehouse bigger than one tile, or a chest
      that reserves slots per item, once a steel chest stops being enough.
- [x] **Upgrade in place** — placing a Mk2 over a Mk1 swaps it, keeping its
      recipe, its contents and its facing. Built: any higher tier of the same
      family can go over a lower one (Mk1 straight to Mk3 too), the old machine
      is refunded as removing it would be, and the ghost takes the old facing.
- [ ] **Modules** — a slotted item for +speed, +output or −power in a tier-3
      machine. A sink that never saturates.
- [ ] **Belt tiers Mk2 and Mk3** (3.2 and 6.4 tiles/s), pending the open
      question on whether belts get tiers at all.
- [x] **Underground belts** — a placed pair passing items beneath up to 6
      tiles. What makes a large factory readable. One crafted item (Belt
      Logistics); the second placed facing the same way becomes the exit.
- [ ] **Long-haul transport** — a bound pair of ports, items entering one
      arriving at the other after a delay. Matches the tier-6 drone decision
      and costs a fraction of rails.
- [ ] **Belt-fed turrets** — ammo becomes a production line and the factory
      starts defending itself. The cleanest way to make the two halves of the
      game touch.
- [x] **Production ledger** — items per minute per item, with a graph and a
      personal best. A Production tab beside the island map (L on desktop):
      ten minutes of island time per item, the busiest first, and the best
      whole minute each has reached, kept per island beside the save.
- [x] **Dry-miner warning** — a miner that pulls up the last ore in reach
      raises a toast once, and shows as a red ring on the map until moved; the
      Production tab counts them and links to the map.
- [ ] **Second island via a bridge** — a new generated region with its own ore
      tier and tech branch. Multiplies content instead of ending it.
- [x] **Mob voices** — each of the nine creatures dies to its own sound: a
      slime pops, crawlers click, a wisp rises away, a brute thuds, a spitter
      gurgles, a shellback cracks, the Warden crumbles and the Queen shrieks.
- [ ] Mob voices for attacks and hurt, not only deaths, so a brute winding up
      behind you is audible before it lands.
- [ ] **Footsteps keyed to terrain** — sand, grass and rock each sounding like
      themselves. Movement is the verb the player does most and it is silent.
- [ ] **A pitch per item on production sounds**, so a bank of furnaces reads as
      a chord and a stalled one is audible as a gap.
- [ ] **Muffle the world behind an open modal** — a lowpass on the master bus
      while the pause or inventory screen is up, so the interface sits in front
      of the island rather than inside it.
- [ ] **A sound for a finished research cycle**, and a different one for a
      finished tech. A lab is the one machine whose output is invisible.
- [x] **Bag upgrades** — three bags at the workbench, sewn on in order, each a
      row of 8 more slots: a Woven Satchel (fibre and wood, 32), an Iron-Frame
      Pack (iron plate, 40) and a Steel Rucksack (steel and gears, 48). Sewn on
      rather than carried, so a bag can never be put in a chest out from under
      what it holds. Saved per player; older islands load at 24.
- [ ] On a phone the bag grid is 6 wide, so 32 and 40 slots leave a short last
      row. Either the bag rows go to 6 on a narrow screen or the grid picks
      its width from the slot count.
- [ ] A goal for the first satchel, so the first-hour chain points at it
      once the bag starts to fill.
- [x] A frame-time overlay behind a debug flag, so performance regressions show
      up while playing rather than only under a profiler. F3 (or `?perf=1`,
      which sticks) shows fps, the 95th-percentile and worst frame over two
      seconds, sim and draw time, and what is on the island; on GPU also how
      many sprites and shapes were drawn.

### Changes

- [x] **Nights keep getting harder.** A scripted player showed nights 6 to 9
      costing less health than night 5, and night 20 barely scratched: the
      wave budget grew in a straight line while player power compounds. The
      budget now has a quadratic term, creatures toughen by 8% a night from
      night 7 (and pay out XP in proportion), and the Warden carries 60% more
      health each time it returns. Measured with the same bot, health lost per
      night now climbs steadily from about 10 at night 6 to about 170 at 25.
- [x] A second boss, the **Swarm Queen**, on nights 13, 18, 23 and on, off
      the Warden's nights. She hovers at range, spits, and calls in three
      crawlers every nine seconds; the crawlers she calls are worth no XP or
      orbs, so leaving her alive is not a farm. The scripted player loses
      about 120 to 150 health on her nights, the hardest of each stretch.
- [x] **The Crystal Bulwark**, a third boss on nights 26, 31 and 36 (off the
      Warden's and the Queen's nights). A slow shelled walker with a crystal on
      its back: every other creature within about six tiles of it takes only a
      third of each hit, drawn as a cold bubble round each one it covers. The
      night is won by getting to it. Its death is a crystal shattering.
- [ ] A burrowing boss that surfaces under the player, the other shape the
      thirties could take.
- [ ] Needs testing: nights 26 and on with a Bulwark in the raid. A shielded
      mother slime or brute pack may make those nights a wall; if so, shrink
      the ward's radius before its strength.
- [ ] Mob damage does not scale with nights, only health. If late nights
      read as sponge fights, trade some of the health for bite.
- [x] Belts, machine bodies and belt items are baked sprites copied to whole
      pixels (belts at 16 tread phases per facing). A dense factory, 300
      machines and 600 belts on a 2x screen, went from 17 to 29 fps headless.
      What is left in a factory frame is each machine's live parts (drill,
      gears, smoke, lamp), traced every frame.
- [x] Night is laid over the stage by the browser's compositor: a dark
      sheet, the quarter-resolution light map added on with `plus-lighter`,
      and small canvases for eyes and name tags that are hidden when empty.
      A camp with 12 lamps at night went from 48 to 80 fps headless. Browsers
      without `plus-lighter` still paint the night into the canvas.
- [x] Night firelight washed everything inside it out like fog, the player
      included, because lights were added on top of the dark sheet. Lights
      now cut the dark sheet away (`destination-out`) and add only a faint
      warm tint on a separate layer, so what a campfire lights keeps its own
      colours. Same on Canvas, Pixi and the no-`plus-lighter` fallback.
- [x] Brutes are baked per stride phase (24 a cycle), facing and hit flash:
      forty on screen went from 27 to 133 fps headless. Crawlers (about
      0.3 ms each on a CPU canvas) and slimes are still traced live.
- [ ] **Move drawing to PixiJS** (Abiel, 2026-09-25: "just use the one
      everyone use for web gaming so we can expand"). First step done: a Pixi
      renderer, the default since Abiel found it smoother on his PC
      (2026-09-25) except where the browser runs WebGL in software; Pause →
      Graphics switches back to Canvas, as does `?renderer=canvas`. Pixi is
      loaded as its own file, so Canvas players never download it. `src/render/gpu/context.ts` takes the Canvas 2D calls the
      art already makes and turns them into Pixi sprites and graphics in the
      same order, so every painter is shared and the 3/4 depth sort is
      untouched; baked sprites and ground chunks become textures. It matches
      the Canvas look in side-by-side screenshots. Speed is unproven: headless
      Chromium has no GPU (its software WebGL spends seconds a frame filling
      pixels), and with the pixels taken out Pixi's main-thread work is 11 to
      19 ms a frame against Canvas's 2 to 8 ms, over half of it uploading
      vertex buffers that rebuild every frame. Next: keep static Graphics
      (machine live parts that did not change) between frames, pack baked
      sprites into an atlas so they batch, then move night and lights into a
      shader pass so the DOM layers go. Those are for weaker machines now that
      Pixi is the default.
      Measured since: at a 300-machine factory the Pixi path uploads about
      860 KB of vertices a frame in 127 buffer writes, nearly all from the
      Graphics that machines' live parts, lamps and bars are rebuilt into
      every frame. Fine for a real GPU; if Abiel's numbers disappoint, keep
      those Graphics between frames or bake the live parts per phase.
- [x] Machine live parts are baked per phase: status lamps, fuel and power
      signs, gears (12 steps a tooth), miner drills (16 a blade), furnace
      mouths, lab domes, and inserter bases, arms (24 swing steps) and filter
      chips. A frozen 1,000-machine factory on Pixi, pixels taken out, went
      from 99 to 14 ms a frame (10 to 45 fps headless); screenshots against
      main match in both renderers. Progress bars (48 fill steps) and the
      assembler's working arm (8 reach steps each way) followed. Still live:
      furnace smoke and lab bubbles. Belt items are already sprites.
      History: the first plan was hand-written WebGL (2026-09-24), rejecting
      PixiJS as a dependency for a few hundred lines; the Canvas fixes in PR
      #47 then took every measured scene to 2 to 3 times its frame rate.
- [x] Spitters (per facing, sac fill and speckle pattern), shellbacks (per
      heading and stride, like crawlers) and wisps' bodies (per look) are
      baked; a mother slime is baked in two layers with her brood live
      between. An 80-creature night raid on Pixi, pixels taken out, went from
      21 to 4 ms a frame (8 to 33 fps headless). Still live: the wisp's tail,
      aura and motes, the warden, health bars and spit.
- [x] An island's first frame froze while its ground was prepared: the
      colour field was enlarged to 4096² (64 MB) and blurred there, about a
      second headless, and its sea shading called cos and sin 32 times a
      sample. The blur now runs on the small field and bilinear does the
      rest (940 to 19 ms), the sea's eight directions are worked out once
      (800 to 460 ms), and the big copy is gone. The ground looks the same,
      with slightly softer beach edges. Headless on GPU the menu came up in 4
      to 6 s instead of 12, its longest freeze 2 s instead of 8.
      Then open sea stopped searching for land it could not reach: a running
      count of land tiles answers for a whole neighbourhood, and the field
      build fell from about 445 to 330 ms with a bit-identical result.
- [x] Crawlers and slimes are baked like the brute: crawlers per heading (16)
      and stride phase (12), slimes per hop phase (12) and the way they look
      (8), both per hit flash. 76 of them around the camp went from 41 to 78
      fps headless on a 2x screen. The sprite cache now drops what was drawn
      least recently, so creature frames cannot push the forest out. A mother
      slime still draws live, since her brood moves inside her.
- [x] Level-up choices were plain text boxes. Each card now carries its kind
      (weapon, mastery, attack, survival, explore, growth) as a colour and an
      icon, pips for how far a stacking perk has gone, and a New or Rare flag.
- [x] The island map drew explored ground as flat tile squares, so a start
      was one bright green blob with a hard pixel edge. It is now painted like
      a chart: grain and broad light and shade, shallows and a surf line on
      the coast, ore as speckles, trees and rocks, a faint grid, and a soft
      edge to the fog. Painted once per island; only the fog is redone, and
      only when more ground is known.
- [x] The island map showed the whole island at one size, so the first hour
      was a small lit disc in a dark square. It now zooms (wheel, pinch, or
      + and - buttons) and pans by dragging, opens fitted to what you have
      explored and centred on you, and has a button to find yourself again.
- [x] Number keys pick a level-up card on desktop (1 to 4), with the key
      shown in each card's corner. Touch screens do not show the keys.
- [ ] HUD panels are still placed with hand-tuned `top` offsets per breakpoint
      (goal, toasts, left column). Turning the left column into a stack like
      the top-right one would stop the next new panel colliding.
- [x] Loot popups ("+2 Wood") show for every player's pickups. Filter them by
      the event's `playerId` when multiplayer lands. Done with co-op.
- [ ] Co-op: the menu behind a guest who left still shows the friend's island
      rather than one of their own.
- [ ] A bench prompt shows whenever a player stands within reach of a
      workbench, which at a busy camp may be most of the time. Consider hiding
      it after the first few uses.

- [x] Saving serialised the whole island every 8 seconds — about 110 kB of JSON
      on a barely-built one. Scenery is now regenerated from the seed and only
      its differences stored, the factory is packed into arrays, and the save is
      split into a header, scenery and factory so a section that has not moved
      is not rewritten. A 101 kB island measured in a browser now writes 1.4 kB,
      and standing still writes only the 1 kB header.
- [x] Nothing on the factory grid blocks movement. `collideBuildings` in
      `shared/sim/systems/movement.ts` walks `world.buildings` only, so players
      and mobs pass straight through furnaces, chests and miners. Walking over
      a belt is fine; walking through an assembler is not, and a mob taking the
      shortcut through a machine bank ignores the wall line entirely. Fixed:
      a `solid` flag on each machine row; every machine blocks players and
      mobs over its whole tile, belts and splitters stay walkable.
- [ ] The campfire stands on the map's exact centre, which is a tile corner, so
      it now blocks the four tiles that meet there rather than one. Snapping it
      to a tile centre on world creation would hand three of them back, but it
      moves the camp for every existing save.
- [x] Regenerating scenery from the seed meant a change to worldgen could
      silently move the trees on existing islands. Saves now record `WORLDGEN`,
      a fingerprint test fails if what a seed grows changes without raising it,
      and an island from an older generation takes the new ground whole and
      keeps only what was built, with a toast saying so.
- [ ] Raising `WORLDGEN` still resets the trees and ore of every older island.
      Keeping the old generator callable by generation would let them keep
      their ground; worth doing the first time worldgen actually changes.
- [ ] A busy factory still rewrites every belt and machine each save, because
      one belt item moving makes the whole section's text differ. Fine at a few
      hundred belts; if the section gets big, split it per chunk of the map.
- [ ] Scale `waveBudget` off the highest research tier completed rather than
      the night index alone. Researching is a choice, so difficulty stays
      opt-in and building freely never punishes you.
- [ ] Move `BELT_SPEED` from a module constant onto the `Belt` record. Needed
      for belt tiers, and it touches the save format.
- [x] An inserter will not take from or give to another inserter, so items
      cannot cross a gap without a belt tile between them. Deliberate — it is
      what stops two facing arms passing one item back and forth forever. The
      long inserter is the answer as intended: it reaches straight over an arm
      standing in the way.
- [x] A pending level-up froze the whole world, so a lab levelling you up
      interrupted the factory every few minutes. Level-ups now queue on a
      glowing badge on the level ring, opened with U or a tap; only the open
      draft pauses the island.
- [x] Level-ups queued for a long time piled up unspent. At three waiting the
      ring pulses harder and a toast says so once, the prompt counts them
      ("Pick 4 upgrades"), and the dawn toast mentions any still waiting.
- [ ] The lab's body is nearly the assembler's blue-grey; the lit dome is what
      tells them apart. Fine beside each other, worth a second look in a dense
      base.
- [x] Now that ore runs out, research could raise **ore per tile**, not only how
      fast a drill works. Done: Prospecting (+20%), Flotation Cells (+25%) and
      the repeatable Mining Productivity (+10% a level) raise ore per tile.
- [x] Research auto-advances to the first available tech when one finishes, so a
      lab never idles. Done: the lab screen has a queue the player orders; the
      old guess only fills in when the queue runs empty.
- [ ] A miner's "ore left within reach" counts tile ore, not what yield
      research will actually bring up from it; it could show both.
- [ ] A repeatable tech can only sit in the research queue once. Queueing
      "Mining Productivity ×3" would let a player plan several levels ahead.
- [ ] The research queue lives in the lab screen only. The HUD research bar
      could open it, since that bar is where players look for research.
- [ ] The world sizes every item the same: 5.2 for a belt or an inserter hand,
      6 for a ground drop. A wood log and a circuit board are not the same size
      in life, and `ItemDef` could carry a scale the way it carries a colour.
- [ ] A filtered arm reads only the front item of the belt it watches, so a
      full belt of the wrong item parks it even when its item is two places
      back. Correct for one lane; worth revisiting if belts ever carry sides.
- [x] Weapons only ever fire at the nearest mob, so a forty-mob night sounds
      exactly like a one-mob night. Now each weapon has a targeting rule
      (sling nearest, bow toughest, spark scatter, thorn most crowded line),
      shots skip mobs already doomed by damage in flight, and multishot gives
      each projectile its own target.
- [ ] The factory hum counts machines within earshot every 0.3s by scanning
      every machine and belt on the island. Fine at hundreds; if a base ever
      reaches thousands it wants the same spatial index the renderer will need.
- [ ] Measure late-game goals as a rate held over time, never a total
      delivered. A total is farmed by leaving the game open; a rate can only be
      met by a factory that is genuinely good.
- [ ] The inventory screen leaves the world running behind it, which is right
      for watching a furnace but means a night can start while you sort a
      chest. Worth deciding deliberately rather than by default.
- [x] A wall chipped to 1 hit point refunds its full cost, so taking it down
      and putting it back is a free repair. Settled by scaling the refund with
      the hit points left, rounded down: a wall on its last point gives back
      one wood and no stone.
- [ ] Walls could take a repair action in build mode that spends the missing
      share of their cost, so a chipped line is fixed in place rather than
      pulled and rebuilt one wall at a time.
- [x] The removal highlight only shows in build mode, so a right-click on the
      open island is still aimed blind. Settled by making removal a build-mode
      action: outside it the cursor opens a machine, so a demolition outline on
      the chest you are about to click would read as a warning. `X` and
      right-click outside build mode now say where removal lives instead of
      taking a piece the player never saw outlined.
- [ ] A splitter is a T, so a line that wants to continue straight while
      tapping off one side costs two extra belt tiles to turn back. Fine for
      feeding two furnace rows, awkward on a bus; whether a forward-and-side
      variant is wanted is a play question, not a code one.
- [ ] Filters are set two different ways: an inserter picks from a row of item
      chips, a splitter takes an item dropped on each side. They landed the
      same day in parallel. One gesture for both would be less to learn; the
      drop suits two sides, the chips suit browsing an unfamiliar item.
      Chest slots took the splitter's drop, so the inserter's chips are now the
      odd one out.
- [ ] Copy and paste are shift-clicks with a mouse only. A touch player has the
      buttons in the machine screen, which means opening every machine in a row.
- [ ] Dragging now lays any piece in a line, one per tile crossed, so a row of
      inserters or furnaces is one gesture. Worth checking that nobody lays a
      row of miners by accident with a shaky click.
- [ ] Paste one machine at a time is still a click per arm. Shift-dragging across
      a row to paste onto each machine the pointer crosses would make a bank one
      gesture.
- [ ] A chest slot kept for coal shows a dark ghost on a dark slot and is hard to
      read. The ghost wants an outline or a lighter backdrop for dark items.
- [ ] A splitter's sides cannot be filtered before it is placed, so every one
      is placed, opened and then set. A filter carried on the build selection
      would make a row of sorters one pass instead of two.
- [ ] A fast or stack inserter placed over a long inserter upgrades it, since
      all arms are one family and the long arm is tier 1, and the reach is
      lost. A long arm probably wants its own family or no upgrade path.
- [ ] A long name truncates in a quick slot (`Storag…`). A short display name on
      each machine and building would read better in an eight-wide bar.
- [x] A Mk3 machine runs four times a Mk1, but an inserter still swings at one
      speed — about 1.7 items a second, against an electric furnace that eats
      two ore a second (more with Metallurgy). Fixed by the fast inserter; the
      first arm still starves an electric furnace, on purpose.
- [ ] A machine row added without naming it in some tech's `unlocks` is on the
      palette from minute one. The safe default, but a new tier should be
      given a tech on purpose; the unlock tests fail if a tier-2 or tier-3
      row is left open.
- [ ] The machine screen lists every recipe its machine can run, and the
      assembler is already at six. It needs grouping or a filter before the
      steel tier doubles it again.
- [ ] The camp `Chest` and the factory `Storage Chest` are different things
      with nearly the same name, in the same palette, two tabs apart.
- [ ] Camp placement keeps scenery away with a fixed 14px clearance while
      regrowth uses each node's real radius. Two numbers for one question.
- [ ] The ground cache keeps the chunks in view plus two rings around it,
      roughly 40 MB at `devicePixelRatio` 2 on a 1280×800 viewport. One ring
      would halve it at the cost of more painting while walking; worth tuning
      against a real phone.
- [ ] The camera now snaps to whole device pixels, which is what lets the
      ground cache blit without resampling. Walking advances it in 4- and
      5-pixel steps where it used to be a continuous 4.29, so motion is
      quantised by well under a pixel. If it ever reads as judder on a
      high-refresh screen, this is the reason.
      Checked with interpolation in place: at 60 fps the scene now advances
      5, 5, 5, 6 device pixels per frame, a one-pixel wobble, so it stays.
- [ ] `resize()` caps `devicePixelRatio` at 2, so a retina display rasterises
      four times the pixels every frame. Worth revisiting if lag is reported on
      one.
- [ ] The render loop allocates an object and a closure per visible entity each
      frame to feed the depth sort. Pooling them would cut the GC churn.

- [x] **Mood through the day.** A colour grade: gold after dawn, amber to rose
      at dusk, cold blue at night, a vignette always. Nights are darker (0.84
      shade, was 0.74), so the fire's pool is the brightest thing on screen.
- [x] **Title cards.** The island's name on arrival, and "Night N" / "Day N"
      at the turn of the day, set large in a book face instead of toasts.
- [x] **Arrival.** On a new island the camera starts over the land and settles
      onto the player over 2.6 s.
- [x] **Zoom.** Scroll or +/− steps the camera through five fixed zooms,
      remembered; the default stands about 12% closer than before.

#### Gap list against Cinderhollow (2026-09-26), most visible first

- [ ] 1. **Character and creature art.** His player is a pixel-art sprite
      sheet with 549 hand-timed frames over 30+ moves; ours is a procedural
      figure with a few poses. Seen every second of play. *2026-09-26: the
      player is now a pixel sprite (8-step walk in 3 views, 16-step chop,
      dash, hit flash) generated in `src/render/pixelplayer.ts`. Creatures,
      a run cycle with more frames, and a death pose are still to do.*
- [ ] 2. **The player does not fight.** His combat is pressed buttons (light,
      heavy, roll, parry, spells); ours auto-fires. "Action" is mostly this.
      *2026-09-26: a pressed three-hit melee combo with knockback, slash
      arcs, swing sounds and hit-stop (`stepStrike` in combat.ts). Still
      missing: a heavy or charged attack, parry, and enemies with attacks
      you read and dodge.*
- [ ] Melee in the level-up upgrades: reach, combo speed, a finisher that
      stuns, lifesteal on the blade.
- [ ] A touch Attack button beside Dash (touch players now attack by holding
      the right side near a creature, which also gathers).
- [ ] Creatures telegraph their attacks (a wind-up flash) so the dash and
      the combo become reading a fight, not trading hits.
- [ ] The drawn (`?sprites=vector`) player does not show the blade swing.
- [x] 3. **One art style end to end.** Fixed low resolution, 1px outlines, one
      palette; ours mixes smooth vector art, web UI and pixel-free icons.
      *2026-09-26: the scene is drawn on one pixel grid (the pixel look). The
      web UI and icons are still smooth; that is gap 4.*
- [ ] Pixel creatures: slimes, crawlers, brutes and bosses as generated
      sprites like the player, so they step between poses too.
- [ ] Downed player pose as a pixel frame (it still uses the drawn figure).
- [ ] Floating damage numbers and name tags are drawn at the pixel grid and
      look soft; a small bitmap digit font would keep them crisp.
- [ ] Needs testing: the pixel look on a real phone and a 4K screen, and
      whether the default pixel scale shows enough of the factory.
- [ ] 4. **Menus look like a game.** Framed pixel panels, a serif face,
      tabbed Status / Equipment / Inventory / Charms / Map; ours are web
      cards in a system font.
- [ ] 5. **Character screen and gear.** Weapons, charms and spells to equip
      and swap; our bag holds materials and the build is a row of chips.
- [ ] 6. **Bosses as events.** Intro cutscene, name card, phase change; our
      Stone Warden walks in with a toast.
- [ ] 7. **Movement verbs.** Jump, roll, wall-jump, hook, air dash; ours is
      walk and one dash.
- [ ] 8. **Story framing.** Illustrated story cards and portraits; ours has
      none.

### Ideas

- [ ] Underground belts carry items across instantly; a transit delay equal to
      the belt time over the gap would feel truer on long lines.
- [ ] A way to place an underground exit on purpose (a key to flip in/out),
      for the rare layout where the automatic pairing guesses wrong.
- [ ] An Mk2 underground belt reaching 10 tiles, once belts get tiers.

- [ ] A merger with a priority side, draining one feed first and topping up
      from the other, for a main line that should never starve.
- [ ] Splitters and mergers draw no status light, so one jammed on a full line
      looks the same as one working. A small light on a stalled one would help.
- [ ] Power: an accumulator that stores daytime solar surplus for the night.
- [ ] Power: a production-stats panel per network (supply, demand, coal per
      minute over time).
- [ ] A fourth pack tier whose ingredients need three lines into one
      Mk2 assembler, so the jump from Mk1 assemblers is forced by a recipe.
- [ ] Research effects on the player: max health, move speed.
- [ ] The test bench fills the bag nearly full, so a test that refunds items
      can find no room; give the bench a bigger bag or fewer stacks.

- [ ] A corner minimap on the HUD, drawn from the same image as the island map.
- [ ] Index scenery nodes by tile bucket. The mainland has 6–9k nodes and
      gathering, collision and mobs still scan the whole list.
- [ ] The coal swatch on the island map is nearly invisible against the dark
      fog; give coal a lighter outline on the map.

- [ ] Co-op: let the host hand the island to a guest when leaving, so the others
      can keep playing (host migration).

- [ ] The player swings the same plain axe and pick whatever tier is in the
      bag. Tint the head by the best tool carried, so an upgrade shows.
- [ ] Crafting is instant. A short craft time with a queue at the bench would
      make a big order of machines feel like work being done.
- [ ] Tools never wear out. Durability would make tools a steady sink for
      iron and steel instead of a one-off purchase.
- [ ] Hover cards could show a machine's rate (items a minute) now that the
      production ledger exists.
- [ ] The ledger counts what is made, not what is used. A consumed column
      beside it would name a shortfall outright instead of leaving the player
      to compare two lines.
- [ ] A dry miner looks the same in the world as a blocked one (a red light).
      A distinct mark on the machine itself would save opening the map.
- [ ] A goal for the resonance pack, the one late step the goal chain skips.
- [ ] Goals could pay in items as well as XP, such as a stack of belts for
      the belt goal, which would also speed up a first factory.
- [ ] A goal log in the pause menu listing goals done, so a returning player
      can see how far the island has come.

- [ ] Fish trap tiers, or a trap that catches more essence at night, so the
      essence line scales like the ore lines do instead of by sheer count.
- [ ] Wood as a weak fuel (a row in `FUEL_VALUE`), so a steel furnace can be
      lit before the first coal miner is down.
- [ ] Inserters that feed a burner's fuel from a neighbouring burner, the way
      Factorio chains burner inserters, so a furnace row needs one coal belt
      at the end rather than one past every furnace.
- [ ] Save cards on the menu show a generic island badge. A tiny minimap of
      the actual island, rendered once on save, would make islands tell apart.
- [ ] A second player is drawn in a rust jacket; a small outfit picker (jacket,
      scarf, cap colours) would let friends tell each other apart and cost
      nothing but a few rows.
- [ ] Footstep dust on sand and splashes in the shallows, drawn from the
      ground under the player, would make walking feel grounded.
- [ ] The surf is a still band baked into the ground. A thin animated foam
      line that washes in and out along the same coastline would bring the
      shore to life.
- [ ] Ore patches are still the scattered pebbles and flat halos from before
      the ground was repainted, and now read as the least finished thing on
      the ground.
- [ ] The menu could open on a short scripted flyover of your factory rather
      than a slow drift around where you stood.
- [ ] Machine status lights distinguish working, waiting and blocked in the
      renderer only. A "show me every blocked machine" toggle would use the
      same rule to find the bottleneck in a big base.
- [ ] Drag to upgrade a whole row: hold the click with a Mk2 selected and every
      lower-tier machine of that family the cursor crosses is swapped.
- [ ] Show an upgrade's net cost in the palette tooltip (new cost minus the
      refund), since the refund is what makes Mk1 to Mk2 cheaper than it looks.
- [ ] Mobs only bite players and walls, and have no pathing, so a raid that
      meets a machine bank presses against it and slides along. Letting them
      chew on machines would make the factory part of the defence line.
- [ ] Inserters block movement like every other machine. If a dense build
      makes that feel cramped, an inserter is the one to make walkable next.
- [ ] A splitter that prefers the emptier side over strict alternation. Turn
      by turn is right while both sides flow; when one backs up the rotation
      still offers it first every other item and only then falls through.
- [ ] Deep mining as a late unlock: spend to keep working an exhausted patch at
      a worse rate. An answer to an island that has been emptied, and a sink
      that never stops asking.
- [ ] Miner tiers could widen the reach as well as the speed. `ORE.minerReach`
      is one number and a wider arm is a genuinely different machine, not just
      a faster one. It matters more now that ore is finite: the electric miner
      is four times as fast, so it empties the same nine tiles in a quarter of
      the time and has to be moved four times as often.
- [ ] The starting island has a fixed amount of ore in it, which is now a real
      number rather than an infinity. Whether that number is a wall or a nudge
      toward a second island is the question phase 6 has to answer.
- [ ] The save header is written every 8 seconds even when nothing happened,
      since `tick` always moves. Skipping it while the player is idle and
      nothing is running would make a paused island cost nothing at all.
- [ ] Research is already per world rather than per player, which is what will
      make another player arriving unambiguously good. Worth revisiting whether
      XP from a cycle should scale with how many people are on the island.
- [ ] Item shapes could carry a second colour — a gear's bore, a battery's
      terminal — instead of deriving every tone from one hex. Worth it only if
      a tier adds items a single hue cannot keep apart.
- [ ] Trains as a later flourish on top of port logistics, for the spectacle
      rather than the function.
- [ ] Fluids — oil, pipes, refineries. Deliberately deferred: a second belt
      system with its own network solving, for less return than anything above.
      Worth revisiting only after the second island exists.
- [ ] Blueprints — enormous tedium removed, but also the learning that early
      tedium teaches. Timing is the whole question.
- [ ] Quick slots that can hold an item as well as a build piece, once there is
      something worth using from the bag.
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

- [x] Weapons lead their target: each shot is aimed where the creature will be
      when it lands, from its current velocity, capped at 1.2 seconds ahead.
      A crawler running across the sling's path used to be missed and is now
      hit. Measured over 70-second night-9 fights (standing still and circling),
      hits and kills barely moved (738 against 745 hits), because raids mostly
      run straight at the player; it matters for creatures crossing, not charging.
- [ ] Let the player pick a weapon's targeting rule, or offer a rule change as
      a level-up upgrade (a "Hunter's eye" that turns the sling to toughest).

- [ ] Hand-authored sprite sheets for the player and creatures, with real
      anticipation, strike and recovery frames. Cinderhollow's player has 549
      frames over 30 moves; ours has a few poses. The biggest gap left, and it
      means deciding whether art stays procedural or ships baked PNG sheets.
- [ ] Hitstop: freeze a few frames on a melee hit and longer on a kill or a
      boss stagger, so hits land instead of passing through.
- [ ] A painted title screen with a logo lockup, in place of the menu that
      reads like a web form.
- [ ] Two or three illustrated story cards before a new island's first day,
      saying why you are here.
- [ ] A display face for titles and headings, bundled from the same site.
      Needs Abiel's OK: it would be the page's first fetched asset.
- [ ] A boss entrance: name card and a beat of camera for the Stone Warden.
- [ ] Grade by biome: colder in snow, warmer on sand, greener in the marsh.
- [ ] Parallax sea and sky beyond the coast, so the island's edge has depth.
- [ ] Pinch to zoom on phones; zoom is wheel and keys only so far.

- [x] **Game feel pass.** Swings wind up, hold, strike and follow through;
      trees and rocks shudder and throw chips with a thunk on every hit; dash
      puffs dust with a whoosh; footsteps kick dust; kills and hits freeze the
      frame for a beat (solo only); mobs squash when shot; the screen edge
      flashes red when hurt; level-ups burst gold; drops arc out; bag slots
      are bevelled wells and a stack bumps when it grows.
- [ ] Knockback that shows: mobs slide back a step when hit (sim change).
- [ ] Hotbar and palette slots in the same well style as the bag.
- [ ] Item tooltips in the bag with what the item is for and where it comes from.
- [ ] Hitstop for co-op: a host-side freeze all guests replay.
- [ ] Drop arcs are stepped at the 30 Hz tick; interpolate `settle` too.

### Needs testing

- [ ] Underground belts by touch: the pairing preview was driven with a mouse
      only, and a finger has no hover to show the exit's dashed link first.

- [ ] Joining through the real Supabase Realtime service. Signalling and the
      relay through the project were driven against a local stand-in for
      Realtime Broadcast (`docs/cloud/gateway.mjs`), not the real one, which
      the sandbox cannot reach. If "Allow public access" is off in the
      project's Realtime settings, joins quietly fall back to the broker.
- [ ] Joining through the relay on two real networks. When a direct connection
      does not open within 6 seconds, the game now carries the session through
      the PeerJS broker instead. That was driven locally with WebRTC blocked on
      the guest, not over the public broker, which may throttle heavy use.

- [ ] Landmark keepers on day one. A shrine's shellbacks take 3 off every
      hit, so a first-day sling does half damage; whether a player who walks
      out early reads that as "come back later" or as unfair is unplayed.
- [ ] Accounts against the real Supabase project once it exists. Everything was
      driven against the same services run locally (Supabase Auth, PostgREST,
      Postgres 16), not supabase.co itself; the new "publishable" keys in
      particular were not tried.
- [ ] Pushing a cloud island when the tab is closed rather than quit. Only the
      local save is certain then; the push waits for the next open on that
      device, and the lease takes 45 seconds to lapse.

- [ ] Frame rate near the camp on Abiel's own machine. Every number so far is
      headless Chromium without a GPU, which rasterises canvas on the CPU.
- [ ] Walking on the 256-tile map with full scenery, headless on a 2x
      screen, has no frame over 7 ms of drawing work (p99 4.5 ms, ground
      chunks at most 4 ms); the few 33 ms frames left come from rasterising,
      not from the game's code. Worth feeling on a real machine.
- [x] The GPU (PixiJS) renderer on a real machine: Abiel found it smoother
      than Canvas on his PC (2026-09-25), so it is now the default.
- [ ] The GPU renderer on a phone and on a laptop with built-in graphics.
- [ ] Co-op with the host's tab in the background for over five minutes, and
      in Firefox and Safari. Tested in Chromium for 30 s; Chrome rations a
      page's own timers harder after five minutes, which the worker should
      dodge, and a phone may suspend a background tab outright.
- [ ] Landmark cache sizes against the walk. A far shrine takes a few minutes
      to reach on foot on day one; whether its essence and upgrade feel worth
      it, and whether caches near camp break the early goal pace, is unplayed.
- [ ] The hover card says "hold E" on phones too, where the prompt says Hold;
      the tree and rock cards share the wording.
- [ ] Stone Warden pacing on a real run. A scripted player that kites and
      picks upgrades at random killed the night-5 Warden on four islands out
      of six; standing still, it was downed three or four times that night.
      A player who picks weapons on purpose should do better; unplayed.

- [ ] Co-op across two real networks through the public PeerJS broker. It was
      driven with two browsers on one machine through a local copy of the same
      broker, because the test sandbox cannot reach `0.peerjs.com`.
- [ ] Co-op between different browsers (Chrome host, Safari or Firefox guest).
      Engines may round `Math.sin` and friends differently; the fingerprint
      check should catch the drift and resend the island, but how often it
      fires is unmeasured.

- [ ] Opening the workbench by tapping its Craft prompt on a real phone (it was
      only driven with Playwright's iPhone emulation).

- [ ] Ground repaint cost on a real phone. A full repaint (a zoom, a resize)
      takes about 13 ms longer than the old triangle mesh in headless
      Chromium; walking only repaints a strip about once a second, and steady
      frames are faster than before. The ground's blur relies on canvas
      `filter`, which older Safari ignores: edges there are a little crisper.

- [ ] Resonance pacing: 40 cycles of one essence each, and a trap lands essence
      about one catch in six, every 6 seconds. One trap is about 24 minutes of
      essence, which is untested against how the rest of that tier feels.
- [ ] Old islands load with every machine unlocked, verified in the browser on
      a rewritten version 6 save. Not yet tried against a real island saved on
      the live site before this change.
- [ ] Dry-miner toasts on a big patch: its miners empty at different moments,
      so each says so on its own. Fine for a handful; unknown for forty.
- [ ] Coal cost of burners. One coal per four plates means a Mk2 furnace bank
      eats a quarter as much coal as it makes plates; nobody has played a coal
      patch dry against it yet.
- [ ] Old islands: Steel and Electric furnaces and assemblers built before fuel
      existed load with an empty fuel slot and stop until coal reaches them.
- [ ] The UI revamp was verified in headless Chromium at 1440x900, iPhone 13
      portrait and landscape. Real phones (notch, safe areas, iOS Safari's
      backdrop blur) and a small laptop screen have not been tried.
- [ ] Whether the new targeting rules feel right on a real night: the bow now
      ignores slimes while a brute is in range, and spark picks at random.
- [ ] Movement smoothing was measured at 60 fps in headless Chromium (the player
      now moves every frame instead of every other one). Not yet watched on a
      120 Hz screen or a phone, where the old stutter would have been worst.
- [ ] Research rates are guesses. The first tech is 20 cycles at 4s, packs cost
      a gear and a copper plate each, and the repeatable techs double in price
      per level. None of it has been played, only driven.
- [ ] Whether a lab is worth its cost (20 iron plate, 10 gears, 5 circuits) at
      the point in a run where a player can first afford one.
- [ ] Whether 800 ore in a patch's richest tile is the right number. It works
      out at roughly two hours of one miner over a nine-tile reach and hours
      for a whole patch, but no one has played far enough to feel it.
- [ ] Ore thinning is drawn in four steps, and the ground cache is repainted a
      tile at a time as a tile crosses one. Driven in headless Chromium against
      a single miner; a base with twenty miners crossing steps at once has not
      been watched for frame cost.
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
- [ ] Whether a long inserter's 0.8 speed is the right price for its reach. It
      moves about 1.3 items a second against the short arm's 1.7, which is a
      guess rather than something a real furnace bank has argued with.
- [ ] Whether 1 → 2 → 4 is the right speed curve, and whether the tier costs
      land at the moment a player wants the upgrade, has never been played.
      A tier 3 line was driven in a browser and does deliver four times the
      plates; that it is *fun* at that point is a guess.
- [ ] Tier pips. Tiers share a silhouette and differ by accent colour and one
      or two marks on the top edge, which reads at a 4x zoom in a screenshot.
      Whether a bank of Mk2s is tellable from a bank of Mk3s while playing at
      normal zoom has not been checked by eye.
- [ ] The ground cache now scrolls: on a rebuild it slides what is still in
      view and paints only the strip that came in. Driven in headless Chromium,
      where the rebuild frame went from ~43ms to ~28ms and the scrolled cache
      matches a full repaint pixel for pixel bar faint facet-edge antialiasing.
      Software rasterising exaggerates both numbers; it wants a look on real
      hardware, and on a phone especially.
- [ ] Item silhouettes at the lowest zoom. They were driven in headless
      Chromium at 1280x800 and read clearly there, but a belt item is about ten
      device pixels wide at the minimum zoom and a phone has never shown one.
- [ ] Baking each silhouette to a sprite held a screen full of belts (3,800
      items) at ~41ms a frame against ~37ms for the flat blob it replaced;
      tracing the paths per item was 67ms. Software rasterising exaggerates all
      three, so the real cost on a GPU wants a look on real hardware.
- [ ] Clearing land is now permanent: build on a chopped node and it never
      returns. Whether an island can be stripped bare over hundreds of hours,
      and whether that matters, has not been played out.
- [ ] Splitter filters as a sorter on a real mixed line. One miner through a
      splitter into two chests was driven in a browser, and sorting iron from
      copper is covered by tests, but a saturated mixed bus has never been
      played.
- [ ] Inserter throughput has not been balanced by play. One arm moves about
      1.7 items a second against a belt's 1.6 tiles a second, so a single
      inserter roughly keeps pace with one belt. Whether that is the right
      ratio for feeding a furnace bank is a guess.
- [ ] Whether a stack inserter's four-item hand is too strong. At about sixteen
      items a second it outruns a belt (6.4), so out of a chest the belt sets
      the pace; into a machine it is four times a fast arm for Mk3 parts.
- [ ] The full colour grade on a real graphics card. It was only measured in
      software, where it cost about 20 fps at night and so is switched to the
      vignette alone there; on a GPU it should cost nothing.
