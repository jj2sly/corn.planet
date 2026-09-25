# Corn Planet Party — Architecture

Corn Planet Party is a phone-controlled multiplayer party game platform for the Corn Planet
Institution. A host screen (laptop/TV) shows the shared game; players use their phones as
controllers. The games are **Cornlashing**, **Corn or Shit**, **Entity Auction** and **My Cob
Escaped, What Do I Do Now???**.

It lives entirely in `party/` and **coexists** with the existing CPI Database site in the
repository root. Nothing in the existing site depends on it.

## 1. What already existed (inspected before building)

| Area | Existing CPI Database |
|---|---|
| Frontend | Static HTML pages + one shared `style.css`, vanilla JS, no build step |
| Hosting | GitHub Pages, served from `main` (`jj2sly.github.io/corn.planet`) |
| Backend | None of its own. Firebase (project `cpo-9af17`, Spark plan — no Cloud Functions) |
| Database | Firestore collections: `entities` (IDs `CPE-001`…), `artifacts` (`ART-001`…), `classifications` (name/color/description/order), `users/{uid}` (email, role, createdAt) |
| Auth | Firebase Auth, email + password (`login.html`, `signup.html`) |
| Roles | `roles.js`: VIEWER(0) → CPI_EMPLOYEE(1) → CORRESPONDENT(2) → OVERSEER(3) → EXEC(4). Enforced server-side by Firestore rules configured in the Firebase console (not in this repo) |
| Admin | `admin.html` (EXEC: assign roles), `records.html` (CORRESPONDENT+: create entities/artifacts; OVERSEER+: manage classifications) |
| Images | Cloudinary unsigned upload preset |
| Tests / tooling | None |

## 2. Why a separate server

GitHub Pages only serves static files, and the Firebase project has no Cloud Functions, so
there is nowhere in the existing stack to run an **authoritative** game server. Corn Planet Party
therefore runs as its own small Node.js process that also serves its own pages.

```
 Phones / TV browser                         Corn Planet Party server (Node 24)
 ───────────────────                         ─────────────────────────────────────
 party/public/*.html  ── HTTP /api/* ──────▶ Express  ── node:sqlite ──▶ party.db
                      ── Socket.IO ────────▶ RoomManager ─▶ Game (Cornlashing)
        │                                         │
        └── Firebase Auth (email/password) ──┐    └── verifies Firebase ID tokens (jose + Google JWKS)
                                             ▼        reads users/{uid}.role via Firestore REST
                                   Firebase project cpo-9af17   (read-only; never writes)

 Existing CPI Database (GitHub Pages) ── Firebase Auth + Firestore   ← unchanged
```

## 3. Stack decisions (and the simpler options chosen)

| Need | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 LTS, TypeScript run directly (type stripping) | No compile step; `tsc --noEmit` for type checking |
| HTTP | Express 5 | Small, standard |
| Real-time | Socket.IO 4 | Reconnects, rooms, fallbacks |
| Database | SQLite via built-in `node:sqlite` | Rooms are in-memory in one process anyway; zero native deps; one file to back up |
| Accounts | **Reuse existing Firebase Auth** | Same login as the database site; CPI roles carry over. Server verifies ID tokens itself |
| Frontend | Static vanilla JS modules, no bundler | Matches the existing site |
| Tests | `node --test` + `socket.io-client` | No test framework dependency |

Deliberately **not** used: Postgres/Prisma (no need at friend-group scale), Redis, microservices,
a frontend framework, firebase-admin (heavy; token verification only needs public keys).

## 4. Server modules (`party/server/`)

| File | Responsibility |
|---|---|
| `main.ts` | Entry point: config, DB, server, cleanup timer, graceful shutdown |
| `app.ts` | `createPartyServer()` — wires Express, Socket.IO, rooms (used by tests too) |
| `config.ts` | Environment variables |
| `db.ts` | Schema, migrations, all SQL |
| `auth.ts` | Firebase ID token verification + role lookup; dev-only fake auth for local testing |
| `api.ts` | REST API: profile, stats, history, prompts, reports, moderation |
| `rooms.ts` | Room + player lifecycle, codes, reconnect tokens, leader transfer, pause, cleanup |
| `realtime.ts` | Socket.IO event handlers, per-socket state views, rate limits |
| `text.ts` | Input cleaning/validation shared by API and sockets |
| `ratelimit.ts` | Tiny fixed-window rate limiter |
| `canon.ts` | Read-only access to the CPI Database: fetch, cache, strip redactions ([CANON.md](CANON.md)) |
| `promotion.ts` | Hall of Fame → canon: the prefilled Records Division link, and linking moments to the records filed from them |
| `games/types.ts` | The minigame contract |
| `games/registry.ts` | List of installed games |
| `games/chaos.ts` | Cornlashing |
| `games/claims.ts` | Turning a canon record into one true and one fabricated claim |
| `games/cornorshit.ts` | Corn or Shit |
| `games/entityauction.ts` | Entity Auction: rules, bays, bidding, Action Round, net worth |
| `games/auctioneffects.ts` | Entity Auction's effect engine: modifier/event types, validation, starting library |
| `games/mycob/*.ts` | My Cob Escaped: `config` (every tunable, modes), `content` (world data, entity rules), `incident` (generator, facts, objectives), `rules` (rolls, effects, scoring, endings), `director` (Incident Director contract, validation, built-in director), `claude` (Claude-backed director, `MYCOB_DIRECTOR=claude`), `narration`, `game` |
| `games/awards.ts` | Player-created awards (create, dedupe, vote, results), usable by any game |

### Browser code (`party/public/`)

| File | Responsibility |
|---|---|
| `index.html`, `js/index.js` | Landing page: join form, host link, installed games |
| `host.html`, `js/host.js` | Host screen: session create/resume, lobby + settings, results, game renderer dispatch |
| `play.html`, `js/play.js` | Phone controller: join/rejoin, lobby, pause banner, results, game renderer dispatch |
| `js/games/chaos-host.js`, `js/games/chaos-play.js` | Cornlashing views for the host screen and phones |
| `js/games/cornorshit-host.js`, `js/games/cornorshit-play.js` | Corn or Shit views |
| `js/games/entityauction-{host,play}.js`, `js/games/entityauction-bay.js` | Entity Auction views; the containment doors are in `-bay.js` |
| `js/games/mycob-{host,play,shared}.js`, `js/games/mycob-voice.js` | My Cob Escaped views; `-voice.js` is where a future narrator voice plugs in |
| `js/games/mycob-sound.js` | The party's one sound manager (cues, placeholders, mute/volume, `playSfx` for short game effects), mapped in `sounds/mycob/sounds.json` |
| `js/games/steamdeck-{host,play,world,scenery,ui,tilt,rules}.js` | Steam My Deck: screens, the canvas renderer, level art, shared presentation, Thad's tilt, the plank rule (see `docs/STEAMDECK.md`) |
| `js/drawing.js`, `js/drawing-canvas.js` | CPI Drawing System: stroke data model (shared with the server) and capture/rendering |
| `js/cpi/character.js` | CPI characters: deterministic per-player look from slots (hat, face, suit, accessory; overridable for future cosmetics), drawn procedurally in any pose |
| `js/cpi/animation.js` | Animation states and moments (jump, land, die, escape…) inferred from sampled positions only: no extra network data |
| `js/cpi/particles.js` | Fixed-pool particle effects (dust, sparks, confetti, debris, rings, pop-up text) |
| `js/cpi/handheld.js` | The CPI KERNEL handheld: a device frame any game can run inside (status bar, notifications, edge flashes, real or decorative controls, skippable boot/title sequences) |
| `hall.html`, `js/hall.js` | Hall of Fame: accepted reports, moderator hide and promote |
| `account.html`, `js/account.js` | Login/register (Firebase), display name, stats, history |
| `prompts.html`, `js/prompts.js` | Prompt writing, library, reports, moderation console |
| `js/common.js` | `el()` (textContent-only DOM helper), API client, countdowns, keyed mounting |
| `js/auth.js`, `js/connection.js` | Firebase/dev login and the Socket.IO connection |
| `css/party.css` | The Corn Planet look, responsive and TV-scaled |

## 5. Rooms

- **Codes**: 4 letters from a consonant-only alphabet (no accidental words, no 0/O confusion).
- **Roles in a room**
  - *Host display* — the screen that created the room. Holds a secret `hostKey`.
  - *Players* — 3–8 phones. Each gets a secret reconnect `token` on join.
  - *Leader* — the earliest-joined connected player. Can use host controls from their phone,
    so the room is never stuck if the host display disappears.
- **Room status**: `LOBBY → IN_GAME → FINAL_RESULTS → (LOBBY | IN_GAME replay)`.
- **Joining** in `LOBBY` or between games (`FINAL_RESULTS`), not mid-game. Errors: `ROOM_NOT_FOUND`, `ROOM_FULL`, `GAME_IN_PROGRESS`, `NAME_TAKEN`, `INVALID_NAME`.
- **Reconnect**: the phone keeps `{code, token}` in `sessionStorage` (survives refresh, per-tab) and
  offers a one-tap rejoin from `localStorage` if the tab was closed. A logged-in user rejoining the
  same room reclaims their seat by account. State is always re-rendered from the server's current
  per-player view, so reconnecting never reveals hidden information.
- **Host display disconnect**: game timers pause until the display returns; the leader can resume
  without it. **Leader disconnect**: leadership passes to the next connected player.
- **Cleanup**: lobby players who stay disconnected for 2 min are removed; rooms with nobody connected
  for 10 min, or older than 6 h, are deleted.

### Realtime protocol (Socket.IO)

Every client event is `socket.emit(event, payload, ack)` and gets `{ ok: true, ... }` or
`{ ok: false, error, message }`. The server pushes `state` (that socket's personal view),
`session:ended` (`{ error, message }`) and `hello` (login status).

| Event | Who | Payload | Effect |
|---|---|---|---|
| `host:create` | host | – | New room; ack has `code`, `hostKey` |
| `host:resume` | host | `code`, `hostKey` | Re-attach a host screen |
| `player:join` | phone | `code`, `name` | Join (or reclaim seat by account); ack has `playerId`, `token` |
| `player:resume` | phone | `code`, `token` | Re-attach after refresh/disconnect |
| `room:leave` | either | – | Player leaves; host screen detaches |
| `room:configure` | host/leader | `gameId?`, `contentMode?`, `settings?` | Lobby settings |
| `room:start` | host/leader | – | Start or replay |
| `room:lobby` | host/leader | – | End game / back to lobby |
| `room:resume` | host/leader | – | Continue while the host screen is away |
| `room:kick` | host/leader | `playerId` | Remove a player |
| `room:close` | host | – | Close the session for everyone |
| `game:host` | host/leader | `action`, `payload?`, `step?` | Game host action (e.g. `skip`), ignored if `step` is stale |
| `game:input` | player | `action`, `payload` | Game input (Chaos: `answer`, `vote`; My Cob Escaped: `respond`, `vote`, `award:submit`, `award:vote`) |
| `state:request` | either | – | Resend current state |

## 6. Minigame framework

A game is a `GameDefinition` (id, name, description, min/max players, settings parser, `create`)
that produces a `GameInstance`:

```ts
interface GameInstance {
  start(): void;
  handleInput(playerId, action, payload): ActionResult; // server-side validation lives here
  hostAction(action, payload): ActionResult;           // e.g. "skip"
  viewFor(viewer): unknown;  // viewer = host display or a player; MUST only include what they may see
  playerLeft(playerId): void;
  dispose(): void;
}
```

The room gives the game a `GameContext`: player list, a single pausable phase timer, scoring
(`addPoints`), per-player stat counters, the prompt source, a `changed()` signal to push new views,
and `finish()` which records results (plus, optionally, a structured JSON record of the game saved
to `game_details`) and moves the room to `FINAL_RESULTS`. A game cut short (back to the lobby, room
closed or abandoned, server shutdown, game error) is saved to `aborted_games` instead, with the
game's `abortDetails()` record if it has one, and never counts towards stats. A definition may also publish a `catalog`
of lobby choices (My Cob Escaped's modes and lengths) through `/api/config`. Rooms, networking,
reconnects, pausing, scoreboards and stats persistence are all generic — a new game only
implements its own phases and views, plus host/phone renderers in `public/js/games/<id>-*.js`.
`test/framework.test.ts` runs a second, unrelated game through the same rooms to keep this true;
[ADDING_A_GAME.md](ADDING_A_GAME.md) is the step-by-step guide.

Games reach CPI canon through `ctx.canon` (list / sample / get / used). It is read-only: a game can
read the CPI Database and note which records a round used, and can never write to it. The rules are
in [CANON.md](CANON.md), which every canon-driven game should follow.

Planned future games (not built): Corn Planet Draw, Trivia, Gamble, Hidden roles, Prediction.

## 7a. Canon

`canon.ts` reads the CPI Database's world-readable `entities`, `incidents` and `personnel`
collections over the Firestore REST API, with no token, and keeps a warm in-memory snapshot
(refreshed by `main.ts` at startup and every 10 minutes). Reads are synchronous so games stay
synchronous. Redaction markers are stripped rather than revealed, collections fail independently,
and a failed refresh keeps the last good snapshot. `game_canon_refs` records which records a game
drew on. Full rules, including canon vs generated content: [CANON.md](CANON.md).

## 7b. Cornlashing

Theme: every prompt is an **incident**; players are field agents filing **incident reports**; the
rest of the room is the **review board**.

Phases per round: `INTRO → ANSWERING → (VOTING → VERDICT) per incident → STANDINGS`,
then after the last round `FINAL_RESULTS` (room level).

- **Rounds 1..N (default 2) — Paired incidents.** With P players there are P incidents. Players are
  shuffled into a ring; incident *i* goes to players *i* and *i+1*, so everyone answers exactly two
  and no pair repeats. Authors do not vote on their own incident.
- **Final round — Total Breach** (optional, default on). One incident for everyone; everyone votes
  for any report except their own.
- **Scoring** (all server-side, shown on screen):
  - `100 × round multiplier` per vote received (multiplier = round number; Total Breach = N+1).
  - **Unanimous Ruling**: +`100 × multiplier` for receiving every vote cast, when ≥ 2 votes were cast.
  - **Default ruling**: if only one agent filed, they get `100 × multiplier` and voting is skipped.
- **Anonymity**: reports get random ids and a shuffled order; authors are attached to a view only
  in the `VERDICT` phase. A phone sees which report is its *own* (to block self-votes) and nothing else.
- **Validation**: 1–80 characters after cleaning, editable until the deadline, rejected after it;
  one vote per voter per incident, no self-votes, no votes for unknown reports.

## 7c. Corn or Shit

Two claims about one CPI Database record: one quoted from the record, one fabricated by moving a
real field value from another record of the same kind onto it (`claims.ts`). Phases per round:
`INTRO → GUESSING → REVEAL`. Correct calls score `100`; calling every round right over at least 3
rounds adds a `200` Perfect Record bonus. The reveal shows which claim is documented, the `CPE-###`
reference with a link to its page on the database site, and which record the fabrication borrowed
from. Which option is real never appears in any view before the reveal.

The fabrication is built by template, not by a model — no API key, no cost, deterministic in tests,
and the borrowed value is checked against the real one so the lie can never accidentally be true.

## 7e. Entity Auction

Agents bid Kernels on sealed containment bays; each bay secretly holds one real entity. Phases:
`BRIEFING → (BIDDING → OPENING → REVEALED) per bay → ACTION_INTRO → EVENT × n → AUDIT → TALLY`.

- **Setup** samples *agents × entitiesPerPlayer* distinct entities through `ctx.canon` and refuses to
  start (`NO_CANON` / `INSUFFICIENT_CANON`) rather than reuse one. Each bay also draws a hidden
  modifier from the enabled library (`ctx.effectLibrary()`).
- **Secrecy**: a bay's entity is only in a view once its status is `revealed`; a won entity joins its
  owner's collection when the lot closes but stays out of every view (and every net worth shown)
  until its door is open. A modifier is only in a view once revealed — not even whether one exists.
- **Bidding** is server-authoritative: phase, membership, free collection slot, whole-number amount,
  minimum opening bid / minimum raise, no raising your own bid, enough Kernels. Nothing is escrowed
  because only one bay is ever open; a departed agent's bids are dropped and the one below stands.
- **Door states** (`sealed → active → opening → revealed → collected`) are all the server says about
  a door. The renderers animate between them; "unlocking" is the first beat of the client's
  opening animation. Redesigning the facility means editing `entityauction-bay.js` and the `.bay`
  CSS only.
- **Effects** (`auctioneffects.ts`): a modifier applies its effect to its own entity; an event applies
  to every entity still in play (optionally one classification) or to every agent. Types: change or
  multiply value, lose or duplicate the entity, pay the owner, pay every agent, trigger hidden
  modifiers. Moderators pick a type and numbers; adding a type is one entry in `EFFECT_TYPES`.
- **Library**: `auction_effects` table (migration 5, seeded once). Managed at `/api/mod/auction`
  (moderators only). Games copy the enabled entries at start.
- **Score** = net worth (Kernels left + value of active entities), so the room's standings are the
  final ranking. `game_canon_refs` gets one row per opened bay (round = bay number).

## 7f. My Cob Escaped, What Do I Do Now???

An incident-response game on a shared incident engine; full design in [MYCOB.md](MYCOB.md). Phases:
`ALERT → (UPDATE → RESPONSE → PROCESSING → CONSEQUENCE → STAGE_VOTE) × stages → OUTCOME →
AWARD_SUBMIT → AWARD_VOTE → AWARD_RESULTS`.

- **Split of power**: the *Incident Director* (an `IncidentDirector`; the built-in one is template-driven
  and offline) interprets responses and narrates; the *engine* rolls outcomes first, then validates and
  applies whatever the director proposes within those rolls. The director can't award points, pick
  winners or take lives on its own; invalid, late or failing directors fall back to the built-in one.
- **Hidden state** (numeric stats, difficulty, rolls, undiscovered facts, an unknown entity's identity,
  raw responses, director context) stays in the instance; views carry qualitative statuses and
  discovered facts only, and director text is scrubbed before it is stored.
- **Canon**: the entity, and any real personnel and prior incidents, are read through `ctx.canon` and
  recorded in `game_canon_refs`; everything else is generated. Refuses to start without entities.
- **Persistence**: one `game_details` row (`kind: "mycob.v1"`) per game for tuning and review.
- **Tuning**: every number is in `games/mycob/config.ts`; `scripts/mycob-sim.ts` simulates games.

## 7d. Hall of Fame

Games keep memorable moments with `ctx.saveMoment()`; the room saves them with the game's history in
`moments`. Cornlashing keeps each incident's accepted report(s). `/hall` lists them; moderators can
hide one or promote it to canon. Promotion is a handoff to the Records Division, never a write from
this server: the filed record carries `promotedFrom: "cpp-moment-<id>"`, and after each canon refresh
`reconcilePromotions()` links the moment to it. See [CANON.md](CANON.md) §8.

## 8. Prompts and moderation

- Tables: `prompts` (text, author, category, tags, rating `safe|chaos`, status
  `pending|approved|disabled`, pack, usage count, timestamps), `categories`, `packs`, `reports`,
  `settings`.
- The library starts empty and is written by the group. Migration 2 cleared the original built-in
  prompts once; if a game needs more prompts than exist, placeholder incidents fill the gap and the
  host lobby shows a warning (from `promptCounts` in `/api/config`).
- **Room content modes**: *Safe* (safe prompts), *Chaos* (safe + chaos), *Custom* (only prompts
  written by the group's accounts).
- **Moderation policy** (admin setting): auto-approve `all`, `safe` (chaos-rated prompts wait for
  review — default), or `none`. Prompts reaching the report threshold (default 2) are disabled
  automatically until reviewed.
- **Moderators** = CPI roles `OVERSEER` and `EXEC` from the existing `users/{uid}` Firestore docs.

## 9. Statistics

`games` + `game_players` (score, placement, per-game counters as JSON), and `game_details` (one JSON
record per game, for games that keep a structured history). Games that ended without finishing go to
`aborted_games`, which no stat reads. A user's stats are
aggregated from their rows: games played, wins, rounds, answers submitted, votes cast/received,
total points, best placement, prompts created and how often they were used, favourite categories,
and recent history. Stats are only returned to their owner. Emails are never stored by Corn Planet Party.

## 10. Security summary

- Server is authoritative for state, timers, scores, votes, winners and authorship.
- **Corn Planet Party never writes to the CPI Database.** Canon is read-only here, so a game can
  never turn a player's invention into lore ([CANON.md](CANON.md)).
- Firebase ID tokens verified (RS256, issuer/audience = project) against Google's public keys.
- Host actions require the `hostKey` socket or the current leader; player actions require the
  bound player socket.
- All user text is cleaned server-side and rendered with `textContent` client-side.
- Rate limits on connections, room creation, join attempts, socket events, API reads and prompt/report writes.
- Host skips carry the phase step they target, so a tap racing a timer can't skip two phases.
- Security headers + a Content-Security-Policy with no inline scripts.
- Errors are sent as short codes + friendly messages; no stack traces.
- No secrets in git: `.env` is ignored; the Firebase *web* config is public by design.
