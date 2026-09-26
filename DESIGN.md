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
- **Weapons auto-fire** at anything in range, so a fight never needs aiming...
- ...plus a **pressed melee combo** (F, or click near a creature) and a
  **dash** for agency and escapes. Both are optional: standing still and
  letting the weapons work is always enough on the easy nights.
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
- A three-hit melee combo the player presses, the last hit heavier and
  throwing creatures back (2026-09-26, from the Cinderhollow comparison).
  Holding the button winds up a slam all around; a swing timed as a blow
  lands parries it, dazing the attacker and knocking spit out of the air.
- One movement ability (dash) with its own cooldown. It is a forward roll:
  a bite or glob that lands mid-roll passes through, and the next swing
  within a second is a counter, hitting as hard as the combo's finisher.
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

**Illustrated, outlined and lit**, drawn procedurally to canvas: every
character, creature, tree and building carries a dark ink outline, is lit from
the upper left and shaded on the far side, and stands on a soft contact
shadow. The ground is painted rather than faceted: soft biome colour with
grass, flowers, leaf litter, pebbles and a shelving sea over it. Characters
animate (walk cycles, tool swings, hops, gaits). No sprite sheets, no image
assets, no generated art — every shape is code, so it stays consistent and
re-themeable. This replaced the original flat low-poly look in September 2026,
when that read as cheap.

Fallback if it does not read well in motion: hand-made pixel art.

## Sound direction

Same principle as the art: **every sound is generated, none is a file.** Tools,
weapons and machines are short synthesised blips built from a data table, so a
new sound is a row rather than an asset.

Under them sits a bed that describes the island back to you — wind and surf that
thicken at dusk, a drone that leans in as a raid builds, and a hum that grows
with the machines running around you. Building a bigger factory makes the island
louder, which is the cheapest way to make hours of work audible.

The music is generated too: a sparse pentatonic walk, major and unhurried by day,
lower and thinner at night. A loop would be the wrong shape for a game someone
plays for hundreds of hours on one island.

Four sliders, on the main menu and the pause screen: master, effects, ambience
and music, plus `M` to mute. Nothing plays before the first click, because that
is both the browser's rule and good manners.

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
