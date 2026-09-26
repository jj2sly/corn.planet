# Angry Thud's Revenge

Game id `thud`, 2–8 agents, co-operative. It runs inside Steam My Deck's CPI KERNEL handheld: the
host screen boots the Deck, opens its library and launches the game. The team launches birds at a
Corn Piggy fortress to drive the **Corruption Meter** from 100% to 0% before the piggies finish the
**Red Cow**, a giant statue behind their walls.

An original CPI game in the slingshot genre. No characters, levels, UI, names or sounds from any
existing game: CPI birds, Corn Piggies, CPI humour. Everything is drawn in code.

Code: `server/games/thud/{config,levels,world,game}.ts` on the server, reusable pieces in
`server/games/kit/`, screens in `public/js/games/thud-*.js`, birds in `public/js/cpi/bird.js`.
Tuning: **`server/games/thud/config.ts`** (and per-level numbers in `levels.ts`).

## The loop

1. **SELECT** (45 s, ends when everyone is ready). Each agent picks a **bird** (how it plays) and a
   **skin** (looks only). Everyone starts with 3 of their bird.
2. **LAUNCH** (8 s, skippable). Boot, the Deck's library, the title, the level card.
3. Then turns, until the team wins or loses:
   - **BUILD** (120 s, or until a majority votes to skip). Spend the team's shared kernels.
   - **ACTION**. Every agent launches exactly one bird, in join order: that's a turn. Aim 25 s; an agent
     who doesn't shoot keeps the bird. An agent with no birds waits 15 s for someone to donate one,
     then is skipped.
   - **PROCESS** (a few seconds per step): piggies repair, piggies lob cob bombs at your buildings, the
     weather strikes (if it's that turn), then upkeep (Corruptors corrupt, reinforcements parachute
     in, nests hatch, lightning wears off).
   - **COW** (4.5 s cutscene) every 2 completed turns: the Red Cow advances.
4. **OVER** (40 s): team result, final corruption, Red Cow, per-agent scores, destruction, birds used,
   kernels earned and spent, awards, shot of the game. Then the party's final scoreboard.

**Win:** corruption reaches 0%. **Lose:** the Red Cow reaches 100%.

## Controls

| | Keyboard | Touch / mouse (the handheld's own buttons) |
|---|---|---|
| Aim | ← → angle, ↑ ↓ power | drag back on the screen like a slingshot, or the d-pad |
| Launch | Space / Enter | A, or let go of the drag |
| Ability in flight | Space / Enter (hold ← → for the gull) | tap the screen or A (hold ◀ ▶ for the gull) |
| Next bird | X | X, or tap one in "Your birds" |
| Build | ← → move, Enter place, Esc cancel | pick a card, drag on the screen or ◀ ▶, PLACE |
| Map | M | Y |

No motion sensors, gamepad or Steam Deck needed. Portrait phones get the controls under the screen,
landscape phones and laptops get grips either side, and wide screens put the panel beside the device.

## Birds (`public/js/games/thud-birds.js`)

Data-driven. Add a bird with a new `ability.kind` and handle it in `ThudWorld.ability()`.

| Bird | Role | Ability | Rule |
|---|---|---|---|
| Poppy, the Popcorn Hen | Explosive | tap: blast (radius 150, push, damage) | one use |
| Blitz, Afterburner Finch | Acceleration | tap: ×1.65 speed, hits ×1.7 harder for 0.45 s | 2 charges |
| Auger, Drill Sergeant Woodpecker | Piercing | bores through blocks up to 150 hp, slowing | always on |
| Trey, the Tripartite Quail | Splitting | tap: three smaller Treys | one use |
| Boing, the Rubber Grouse | Ricochet | bouncy (+35% damage per bounce); tap: ricochet at the nearest piggy | always on + one use |
| Chonk, the Anvil Pigeon | Heavy impact | tap: straight down, ×3 mass, ×1.8 damage | one use |
| Memo, the Memo Gull | Midair control | hold ◀ ▶: steer and glide | 1.6 s of fuel |
| Magnus, the Magnet Magpie | Structure manipulation | tap: hover and pull blocks in | one use, 1.1 s |
| Bunker, the Husk Bunker Crow | Defensive | tap: become a 56-unit husk-steel block (170 hp) | one use |

A bunker that lands on your side is a free wall; on theirs it's a heavy brick.

## Economy (`ECONOMY`, `BUILDINGS`, `NEST`, `SHIELD`)

One shared pool, starting at **60 kernels**. Kernels are only earned by shots: +2 per piggy hit, per
kill by kind (10–45), per block broken by material (1–5), +4 for anything broken by debris rather
than the bird (a chain reaction), +10 for three piggies in one shot, and specials (Kernel Vault +30,
Corruption Totem +12). The weather and the piggies' own bombs can break things too; that helps the
meter but earns nothing.

| Spend | Cost | Why you'd want it |
|---|---|---|
| Bird Nest | 45 | a bird every 1.5 turns (to whoever has fewest); a target for bombs and weather |
| Husk Wall | 12 | cheap, tall, stops cob bombs |
| Stone Barricade | 25 | heavy, shrugs off bombs and weather |
| Kernel Shield | 35 | soaks 90 damage a turn for everything within 150 of it |
| Clone Tank | 30 | one use: copies your selected bird |
| Weather Machine | 20, then 30 / 45 / 60 | forecasts (below) |
| Bird crate | 30 | one of your bird, now |
| Breeding | 10 | two agents at one nest in a build phase: one extra bird (once per nest per phase) |
| Weather Machine repair | half its tier's price | when lightning (or anything) breaks it |

A nest pays for itself after about 3 turns if it survives; crates are dearer but instant; defences
only matter once the piggies start lobbing (from turn 1, more every few turns). No single buy
dominates: that's the intent, and the first thing to check in playtests.

Placement: on the ground, inside the two marked zones either side of the sling's rock, not overlapping
anything (`thud-rules.js placement()`, the same rule on phones and the server). Permanent once placed.
Buildings are real bodies: bombs knock them about, tornadoes throw them.

**Production modes** (`NEST.production.mode`): `"turn"` (default, `perTurn: 1/1.5`) or `"time"`
(`everyMs` of build and action time). Same nests either way.

**Donation:** any agent can give any of their birds to an agent with none, in the build or the action
phase. The turn waits for it (15 s) when the shooter has none. Everyone sees who needed one, who gave
which bird, and how many each has left.

## Corruption (`CORRUPTION`, `PIGS`, `MATERIALS`)

Starts at 100%. Every change is scaled by team size so smaller teams (fewer birds a turn) still have
a chance: × clamp(3.5 / agents, 0.55, 1.3).

- Piggy eliminated: −8 (basic) · −11 (armored) · −10 (builder, shield) · −15 (corruptor) · −28 (THUD).
- Block broken: −0.25 (glass) to −1.1 (metal); Kernel Vault −3, Corruption Totem −7.
- Piggy repairs put back what they rebuild (same value). Specials are never rebuilt.
- Each Corruptor alive: +2.5% at the end of every turn.
- Each reinforcement that lands brings half its value (`reinforcementShare`); killing it takes all of it off.

## Piggies (`PIGS`)

Basic (lobs), Armored (tough, lobs), Builder (+10% repair each, reinforces one block a turn), Shield
(piggies within 170 take half damage; a dashed bubble shows it), Corruptor (raises the meter),
**THUD** the boss (420 hp, lobs twice, summons a piggy every turn). Piggies take ×1.5 damage (they're
soft); ones knocked out of the world (the Thudplex moat) are eliminated.

**Repair** (`REPAIR.pct` 0.75, +10% per living Builder): after every turn the piggies spend that share
of the turn's structural damage (hp) rebuilding lost blocks bottom-up where there's room *and something
underneath*, then patching damaged ones.

## Red Cow (`levels.ts cow`)

Behind the fortress, drawn only (not in the physics): it can't be hit or targeted. It advances `step`
every `everyTurns` completed turns (levels 1–4: 20% per 2 turns = 10 turns; the Thudplex: 25% = 8).
Each advance is a 4.5 s cutscene: every camera pans to it, piggy builders hammer on the scaffold, the
statue fills in from the ground, and a band reads "RED COW CONSTRUCTION: 40% → 60%".

## Weather (`WEATHER`, `WEATHER_RULES`, per-level `weather`)

A seeded schedule drawn at the start (`kit/weather.ts drawSchedule`): each turn from `firstTurn` has
a `chance` of an event from the level's pool, with a severity (LOW / MEDIUM / HIGH, heavier later) and
sometimes a secondary. An event is **on** for its turn's action phase and **strikes** after it.

| Type | Action phase | Strike |
|---|---|---|
| Wind / Strong Wind | pushes birds and bombs sideways | |
| Tornado | | a funnel on either side: lifts, throws, damages |
| Dust Storm | light wind, brown haze bands | |
| Acid Rain | green rain | damages every exposed building |
| Heavy Rain | slippery blocks | soaks and weakens wood |
| Hailstorm | | many small hits on exposed things (glass ×2) |
| Flood | | water rises for 2 turns: things float, nests are waterlogged |
| Lightning Storm | | 2–4 bolts, prefer the Weather Machine; struck buildings go offline a turn |
| Thunderstorm | darkness and flashes | a bolt or two |
| Fog | you can't see past a line; the aim arc shortens | |
| Heat Wave | | melts ice, withers wood, dries floods |
| Earthquake | | the ground shakes everything, both sides |

Levels use different pools (the Construction Site: wind and rain; the Weather Station: everything nasty).

### Weather Machines (`WEATHER_TIERS`)

| Tier | Name | Shows | Accuracy |
|---|---|---|---|
| 1 | Weather Radio | the next event's category and a range of turns ("TURNS 3–4: RAIN") | 55% |
| 2 | Weather Scanner | type, estimated turn (±1), severity | 80% |
| 3 | Forecasting Array | type, exact turn, severity, secondary | 92% |
| 4 | CPI Weather Management System | the next 3 turns, each exact | 97% |

A wrong guess is deterministic per game, event and tier (no flicker; an upgrade can change its mind).
A machine at 0 hp doesn't vanish: it stands **BROKEN** (no forecast) until someone pays to repair it.
Lightning can also knock it offline for a turn. Each tier has a `mitigation` field (0 for now): the hook
for later tiers that soften or redirect what they predict.

## Scoring and awards (`SCORING`)

Personal points never touch the meter: piggy hit +10, kill by kind (100–600), block by material
(8–200), ×1.5 for chain reactions, +150 three-kill shot, +75 long-shot kill, +40 per bounce on a kill,
+25 ability that did something, and small teamwork points (donate +40, breed +20, clone +10, build +5).

Awards are computed from recorded numbers only: **Most Destructive** (hp of fortress removed), **Most
Questionable Trajectory** (path length vs distance travelled, bounces, U-turns, odd angle, low power;
doubled if it hit anything), **Biggest Team Save** (corruption removed personally), **Worst Shot That
Somehow Worked** (low power, odd angle, bounces, U-turns on a shot that killed), **Most Generous**,
**Chief Architect**. They're also the party's end-of-game highlights. The whole game is saved as
`thud.v1` (level, result, per-agent stats, every shot).

## Levels (`levels.ts`)

| # | Level | New here |
|---|---|---|
| 1 | CPI Construction Site | wood and glass, a Builder, a Kernel Vault, one barrel; wind and rain |
| 2 | Containment Facility | stone and metal, Armored guards, a Shield Piggy, a Totem; fog, lightning, acid rain |
| 3 | Corn Refinery | corn-oil barrels everywhere (chain reactions), a Corruptor; heat, dust, a tornado |
| 4 | Weather Station | a plateau (height), ice, tall masts; the nastiest weather pool, weather from turn 1 |
| 5 | The Thudplex | a moat, THUD himself, every piggy variant; floods and earthquakes; a faster Red Cow |

Every level must stand up on its own; `test/thud.test.ts` checks nothing moves, breaks or dies before
the first bird.

**Balance check:** `node scripts/thud-sim.ts [games per level] [agents]` plays whole games with bots
that fire un-aimed shots and buy crates. It shows relative difficulty and catches changes that let
idle or random play win. Tune with real players; bots can't aim.

## How it's built

- **Server authority.** The server runs the physics for real (`world.ts` on `kit/rigid.ts`) while
  anything moves: a shot, bombs, a tornado. Everything that matters (hits, breaks, kills, corruption,
  kernels, scores, weather, the Red Cow, the result) is decided there. Screens only draw.
- **Traffic.** While something moves, the game pushes a compact snapshot 20 times a second: one row per
  body (id, kind, position, angle, size, crack stage, flags), cached once per change for every
  viewer. When nothing moves (building, aiming), it only sends on changes; the shooter's aim streams at
  ~15 Hz over `game:stream`. Screens smooth between snapshots (70 ms behind) so 20 Hz looks fluid.
- **Determinism.** `kit/rigid.ts` is fixed-step (120 Hz), order-stable and seeded through the room's
  randomness: the same inputs give the same result (tested).
- **Reconnects** are the room's: a returning agent gets the whole current view (their birds, the
  world, the forecast) and carries on.

### Reusable pieces

| File | What any CPI game can use it for |
|---|---|
| `server/games/kit/rigid.ts` | 2D rigid bodies: rotating boxes and circles, stacking, sleeping islands, wind, water, impact reports, blasts |
| `server/games/kit/destructible.ts` | material health by size, impact damage, crack stages |
| `server/games/kit/weather.ts` | seeded hostile-weather schedules and tiered forecasts with accuracy |
| `server/games/kit/economy.ts` | a shared team wallet with a per-agent ledger |
| `public/js/cpi/bird.js` | CPI bird characters (look + pose), badges and animation |
| `public/js/games/thud-rules.js` | placement against zones and bodies; the aiming arc; pull-back aiming |

## Custom skins

Gameplay and looks are separate: any skin on any bird. A skin is `{ id, name, identity, look }` in
`thud-birds.js`. The built-in skins are "Classic" (each bird's own look) and one per Steam My Deck cast
member, derived from their person look (`birdLookFromPerson`: hair → crest, top → body and wing,
glasses, cap or bicorne, beard), so a cast member looks like themselves in both games.

To add a friend from a photo: the photo is only a reference. Describe them as an original CPI bird
look (body, belly and wing colours, crest style and colour, brow, eyes or glasses, an accessory) and
add it to `CUSTOM_SKINS` with a stable `identity` (reuse it in future games). Don't copy an existing
commercial bird. An optional `art` path (e.g. `/skins/<identity>/`) is reserved for hand-made sprite art
later; screens draw the procedural look until a renderer for it exists. Nothing here generates images.

## Sound

The party's one sound manager (`mycob-sound.js`). The server sends cues the host plays (the start,
weather warnings, hatchings, donations, the Red Cow, victory, defeat); screens play short effects
from what happens in the world (launch, stretch, impacts, breaks, piggy hits and pops, booms, ability,
lightning, tornado, repairs, building, clone tank, kernels, corruption dropping). Victory and defeat use
existing meme clips; the rest are synthesized placeholders until someone maps files in
`sounds/mycob/sounds.json` (no code change needed).

## Known gaps

- Balance is untested with people. Start with the kernel economy, the 75% repair, and Red Cow speed.
- Not yet played on real phones or a real TV (browser-checked at 320–1920 px wide, portrait and
  landscape).
- Skins have no picker for custom art yet (the data slot exists).
