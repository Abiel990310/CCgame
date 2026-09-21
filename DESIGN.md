# CCgame — Design Document

*A cozy, always-online island survival game for the browser.*

## Pitch

You wash up on a shared island. You gather by hand at first, then you stop doing
it by hand: miners on ore patches, belts carrying ore to furnaces, furnaces
feeding assemblers. The factory grows, and so does what it demands of you.

By night, easy creatures wander in from the dark and your weapons fire
themselves while you reposition and dash — or you play a peaceful world, where
the factory is the whole game. The island keeps everything you build, forever.

Other players can drop in at any second and help. If nobody ever does, it is
still a complete game.

**The long game is a factory game.** Throughput is the puzzle: not "do I have
enough iron" but "can I make enough iron per minute, and where is my
bottleneck". That single shift is what turns five hours of play into hundreds.

**Inspirations:** Brotato (waves, auto-attack, upgrade picks), Satisfactory
(persistent base, self-set goals, no fail state), How to Fish (chill gathering,
collection ladder).

## Design pillars

1. **Chill baseline, goal on a timer.** Day is relaxed and pressure-free. Night
   is a short, easy, winnable objective. Neither outstays its welcome.
2. **Progression over execution.** You never need to be *good*. Keep playing,
   numbers go up. Skill is optional expression, never a gate.
3. **Never empty.** No lobby, no matchmaking, no waiting. Join instantly, alone,
   into a world already running. Other humans are a bonus layered on top.
4. **Nothing is lost.** No death penalty worth fearing, no wiped saves. The
   island only ever grows.
5. **The engine is small, the content is data.** Machines, belts and recipes are
   written once and driven generically by tables. Adding depth means adding rows
   to `shared/data/recipes.ts`, not writing new systems. This is the only way a
   two-person project reaches hundreds of hours of content.

## Core loop

### Day — ~3 minutes, ~70% of playtime
- Roam the island freely. No threats.
- Gather: **fish** (minigame + collection log), **mine** (ore nodes), **chop**
  (trees), **forage** (berries, herbs, surface pickups).
- Haul resources back to camp. Craft, build, upgrade.

### Night — ~1 minute
- Easy mobs path toward the camp from the map edges.
- **Weapons auto-fire** at anything in range. You control movement only...
- ...plus **one manual ability** (dash, on a key) for agency and escapes.
- Survive to dawn. Mobs drop XP and materials.

### Between
- **Level up:** pick 1 of 3 upgrades (Brotato-style draft).
- Camp visibly grows: campfire → tents → walls → workshops → automation.

## The factory

The spine of the long game.

### Tier ladder

| Tier | Unlocks | The new problem it creates |
| --- | --- | --- |
| 0 | Hand gathering | — |
| 1 | Miner, belt, chest | Things move without you |
| 2 | Furnace, plates | Ratios: several miners feed one furnace |
| 3 | Assembler: gears, wire, circuits | Multi-input recipes, sub-factories |
| 4 | Power (coal → steam) | Everything stops when power dies |
| 5 | Steel, resin, advanced circuits | Chains six or more steps deep |
| 6 | Island logistics: drones, rail | Remote outposts on distant ore |
| 7 | The Megaproject | An endgame sink with unbounded appetite |

Tiers 0–3 are built. Everything above is content on top of the same engine.

### Why a megaproject

Late game needs a reason to keep scaling. A tech tree ends; a structure that
always wants more throughput does not. Without one, players finish the recipes
and stop. With one, every hour of factory growth still has somewhere to go.

### Belts

Items ride belt tiles as an ordered front-to-back list, each one clamped behind
the item ahead of it. That keeps a belt O(items) rather than O(items²), which
matters because a mature factory has tens of thousands of items in motion.
Drones and rail arrive at tier 6 to remove the tedium of very long hauls — not
to replace belts, which stay the heart of the puzzle.

### Ore

Ore is placed as discrete patches, not smooth noise. A patch is the unit a
player reasons about — "that iron patch over there" — and a patch that runs low
is what eventually pushes expansion outward, which is the long game working.

## Systems

### Progression — fully persistent
Everything saves: island, camp, factory, inventory, gear, levels, collections.
You log out, come back tomorrow, it is all exactly where you left it.

Each island is its own save. The game opens on a main menu listing them, so
starting a new island never costs you the one you were playing, and *Join a
game* sits there as the seam multiplayer drops into.

The factory does **not** run while you are away. Every hour of progress is an
hour someone actually played, and the economy never has to be balanced around
absence.

### Inventory
Real grid inventory. Stackable resources. Tools and weapons with tiers.
Equipment slots. Storage chests at camp for overflow.

### Combat — optional per world
Each world is created either **peaceful** (no raids; the factory is the whole
game) or with **night raids**. The choice is made once, when the world is
created, and is saved with it.

- Weapons auto-target and auto-fire on their own cooldowns.
- One manual ability (dash) with its own cooldown.
- Mobs are *easy* by default. Difficulty scales with player count and camp tier,
  never to the point of stress.

### Multiplayer — worlds, not lobbies
Modelled on Minecraft servers rather than matchmaking. There is no lobby and no
queue; you pick a world and you are in it.

- **Official public world** — always running, always joinable, the default
  front door for a brand new player.
- **Player-hosted public worlds** — anyone can spin one up and list it publicly.
- **Private worlds** — invite-only, for a friend group. Whoever is on the invite
  list can join.
- Worlds **boot when their owner (or an invited player) joins** and hibernate
  when empty, so hosting cost scales with actual use rather than world count.
- Within a world: instant join, no lobby. Other players appear and disappear as
  they come and go. More players → more mobs, but more hands; company is always
  net-positive.
- **Villager bots** wander and help a little when a world is quiet, so it never
  reads as dead.

## Art direction

**Low-poly inspired flat vector**, drawn procedurally to canvas: angular
polygonal silhouettes, flat shading with a single implied light direction, soft
gradients for ground and water, generous rounded UI. No sprite sheets, no image
assets, no generated art — every shape is code, so it stays consistent and
re-themeable.

Fallback if it does not read well in motion: hand-made pixel art.

## Technical architecture

- **Client:** TypeScript + Vite + HTML5 canvas. No engine.
- **Server:** Node + TypeScript, authoritative, fixed ~20Hz tick, `ws` WebSockets.
  Clients send *inputs*, never positions. Server broadcasts snapshots.
- **Shared:** a `shared/` package holding types and the deterministic simulation
  step, used by both sides — this is what makes client-side prediction sane and
  the whole sim unit-testable.
- **Netcode:** client-side prediction + reconciliation for your own movement,
  entity interpolation for everyone else.
- **Persistence:** SQLite (via better-sqlite3) to start — one file, zero ops,
  trivially upgradeable to Postgres if it ever matters.
- **Tests:** Vitest over the pure simulation logic. The sim is deterministic and
  headless, so it is genuinely testable.
- **Hosting:** static client on GitHub Pages / Cloudflare Pages; server on
  Fly.io or Render.

## Build order

Phase status, the tier ladder, the decision log and the open questions live in
[ROADMAP.md](ROADMAP.md). Agent-facing working notes are in [CLAUDE.md](CLAUDE.md).
