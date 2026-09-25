# Adding a minigame to Corn Planet Party

Rooms, joining, reconnects, host/leader controls, pausing, timers, scoring, final results and stats
persistence are all generic. A new game only defines its own rules, phases and views.

A complete working example lives in [`test/framework.test.ts`](../test/framework.test.ts):
**Corn Planet Coin Toss**, a second game that runs through the unchanged room system in the test suite.

## 1. Server: implement the game

Create `server/games/<id>.ts` exporting a `GameDefinition` (see `server/games/types.ts`):

```ts
export const myGame: GameDefinition<MySettings> = {
  id: "draw",                       // stable id, stored in game history
  name: "Corn Planet Draw",
  tagline: "Sketch the entity. Survive the critique.",
  description: "…shown on the host screen and landing page…",
  minPlayers: 3,
  maxPlayers: 8,
  defaultSettings: { rounds: 3 },
  parseSettings(raw) { /* clamp untrusted host input, never throw */ },
  create(ctx, settings) { return new MyGame(ctx, settings); },
};
```

The `GameInstance` it creates must implement:

| Method | Responsibility |
|---|---|
| `start()` | Set up round 1 and call `ctx.setTimer(...)` for the first phase |
| `handleInput(playerId, action, payload)` | Validate **everything** (phase, ownership, payload shape, duplicates). Throw `PartyError(code)` when invalid |
| `hostAction(action, payload)` | Host/leader actions such as `"skip"`. Throw `PartyError("INVALID_ACTION")` if unsupported |
| `viewFor(viewer)` | Return only what that viewer may see *right now*. Recomputed on every update and every reconnect |
| `playerLeft(playerId)` | Re-check "everyone is done" conditions |
| `dispose()` | Drop references; the room already cancels the timer |

Use the `GameContext` instead of your own infrastructure:

| Context call | Use it for |
|---|---|
| `ctx.players()` | Current (not-left) players in join order |
| `ctx.playerName(id)` | Names for reveals, including players who left |
| `ctx.setTimer(ms, fn)` / `ctx.clearTimer()` | The single phase timer. It pauses automatically with the room, and each call starts a new "step" so stale host skips are ignored |
| `ctx.addPoints(id, n)` | Scores. Final standings and ties are computed by the room |
| `ctx.countStat(id, key, n?)` | Per-player counters saved with the game. Keys `answersSubmitted`, `votesCast`, `votesReceived`, `roundsPlayed`, `unanimousRulings` and `category:<name>` feed the account page |
| `ctx.pickPrompts(count)` | Prompts for the room's humor level, without repeats in the room |
| `ctx.effectLibrary()` | The enabled hidden modifiers and events moderators manage (Entity Auction's, but any game may use them) |
| `ctx.saveMoment(moment)` | Keep a memorable moment (author, text, what it answered, votes) for the Hall of Fame. Saved when the game finishes. Moments are never canon unless a moderator promotes one |
| `ctx.canon` | Read-only CPI Database access: `list(kind)`, `sample(kind, n)`, `get(ref)`, and `used(round, ref)` to note which record a round came from. See [CANON.md](CANON.md) |
| `ctx.random()` | Randomness (seeded in tests) |
| `ctx.changed()` | Push fresh views to every screen |
| `ctx.finish({ rounds, highlights, details? })` | End the game: rank, record stats, show the final debrief. `details: { kind, data }` saves a structured JSON record of the game to `game_details` (read back with `PartyDb.listGameDetails(kind)`) |
| `abortDetails()` (optional, on the instance) | The record so far, if the game is cut short (back to lobby, room closed, server shutdown, game error). The room saves it to `aborted_games` (read back with `PartyDb.listAbortedGames(gameId)`), apart from finished games and stats. Without it an aborted game still gets a row with players and reason |

If the game uses canon, read [CANON.md](CANON.md) first. In short: canon is read-only, anything the
game invents is generated content and never becomes canon, redacted fields are skipped, and the
game must cope with canon being empty or small (refuse to start with `NO_CANON` or
`INSUFFICIENT_CANON`, or finish early). Throwing from `create()` leaves the room untouched in the lobby.

Rules of thumb:
- **The server decides everything.** Never accept scores, winners, timers or other players' data from a client.
- **Hidden information stays in the instance** and only appears in `viewFor` for the right viewer in the right phase.
  Add a test that serializes every view during the secret phase and asserts nothing leaks, as `test/chaos.test.ts` does.
- Throw the existing error codes from `server/errors.ts` where they fit. Add new codes (with a player-facing message) if needed.

## 2. Register it

Add it to `INSTALLED` in `server/games/registry.ts`. It then appears in `/api/config`, on the landing page
and in the host screen's game list. `room:configure` with `{ gameId }` selects it.

If the game needs lobby settings, add an entry to `SETTINGS_FORMS` in `public/js/host.js` keyed by
your game id. Choices the form needs from the server (modes, presets) can go in the definition's
optional `catalog`, which `/api/config` publishes with the game. Without one the game simply shows no settings. The operation picker, the game card and
the minimum-player check all follow the selected game automatically.

## 3. Client: render it

Add two ES modules and register them next to Cornlashing:

- `public/js/games/<id>-host.js` → `export function render(mount, state)`, registered in `RENDERERS` in `public/js/host.js`
- `public/js/games/<id>-play.js` → `export function render(mount, state, tools)`, registered in `RENDERERS` in `public/js/play.js`

`state` is the room view: `status`, `players` (with scores), `leaderId`, `timer`, `you`, `step` and
`game` (your `viewFor` output). Send input with `tools.request("game:input", { action, payload })`.

Call `mount(key, build, state)`. `build(state)` returns `{ node, update? }`. The DOM is rebuilt only when
`key` changes; otherwise `update(state)` runs. Put the phase (and anything that should reset the
screen, such as a round or item id) in the key, so text boxes keep their contents while other
players' actions stream in.

Always create elements with `el()` from `public/js/common.js`, which uses `textContent`. Never use
`innerHTML` with player text. Scripts must be files (the CSP blocks inline scripts), and styles belong
in `public/css/party.css`.

If a game needs new input types (for example Corn Planet Draw's canvas strokes), keep payloads small and
validate them server-side; Socket.IO messages are capped at 64 KB. For drawings, use the CPI Drawing
System (`public/js/drawing.js`: validated compact strokes, per-tool interpretation rules; see
`docs/STEAMDECK.md`) rather than a new format.

**Reusable visuals** (`public/js/cpi/`, see `docs/STEAMDECK.md` for a full example): `character.js`
gives every player a consistent CPI agent (same look on every screen, from their id and colour; pass
`appearance` overrides for cosmetics), `animation.js` animates characters from positions you already
send, `particles.js` does bounded effects, and `handheld.js` frames a game in the CPI KERNEL handheld
with notifications and skippable boot/title sequences. Sounds go through `mycob-sound.js` (`playCue`
for cues, `playSfx` for short effects): don't add another audio system.

**Realtime games** (movement, tilt): send frequent input with `tools.stream(payload)`, which emits
`game:stream` (no ack, dropped while offline, 30/s per socket) and reaches `handleInput` as the `stream`
action. Send on change plus a heartbeat, validate leniently (ignore bad values), run your own
`setInterval` tick, stop simulating while `ctx.paused()`, and call `ctx.changed()` once per tick.

## 4. Test it

- Unit-test the rules through a real `Room` (see `test/framework.test.ts` and `test/chaos.test.ts`),
  using `mock.timers` for phases.
- Add a Socket.IO test if the game adds new realtime behavior (see `test/realtime.test.ts`).
- Play it in real browsers: a host tab plus 3 player tabs, phone-sized, including a refresh mid-phase.
