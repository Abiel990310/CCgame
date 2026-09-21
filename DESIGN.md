# CCgame — Design Document

*A cozy, always-online island survival game for the browser.*

## Pitch

You wash up on a shared island. By day you fish, mine, chop and forage in peace.
By night, easy creatures wander in from the dark and your weapons fire themselves
while you reposition and dash. You level up, upgrade your camp, and the island
keeps everything you build — forever.

Other players can drop in at any second and help. If nobody ever does, it is
still a complete game.

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

## Systems

### Progression — fully persistent
Everything saves: island, camp, buildings, inventory, gear, levels, collections.
You log out, come back tomorrow, it is all exactly where you left it.

### Inventory
Real grid inventory. Stackable resources. Tools and weapons with tiers.
Equipment slots. Storage chests at camp for overflow.

### Combat
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

1. **Phase 1 — Solo prototype, no server.** Movement, island, gathering, day/night
   cycle, auto-attack combat, dash, XP and level-up picks, inventory, a camp you
   can build. Runs entirely in the browser. *This is the game — it has to be fun
   here, before any netcode exists.*
2. **Phase 2 — Persistence.** Save/load. Locally first, then server-side.
3. **Phase 3 — Multiplayer.** Stand up the authoritative server against the
   shared sim. Other players appear. Prediction and interpolation.
4. **Phase 4 — Depth.** More fish, ores, mobs, recipes, camp tiers, villager
   bots, collection log, automation.

## Open questions

- Island: one fixed hand-made map, or procedurally generated?
- Camp: freeform placement, or slot-based upgrade tiers?
- Does a world keep producing while its players are offline (idle gathering)?
- How are private worlds' invite lists managed — accounts, or share codes?
