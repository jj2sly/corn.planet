# Corn Planet Party — Architecture

Corn Planet Party is a phone-controlled multiplayer party game platform for the Corn Planet
Institution. A host screen (laptop/TV) shows the shared game; players use their phones as
controllers. The first game is **Cornlashing**.

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
| `games/types.ts` | The minigame contract |
| `games/registry.ts` | List of installed games |
| `games/chaos.ts` | Cornlashing |

### Browser code (`party/public/`)

| File | Responsibility |
|---|---|
| `index.html`, `js/index.js` | Landing page: join form, host link, installed games |
| `host.html`, `js/host.js` | Host screen: session create/resume, lobby + settings, results, game renderer dispatch |
| `play.html`, `js/play.js` | Phone controller: join/rejoin, lobby, pause banner, results, game renderer dispatch |
| `js/games/chaos-host.js`, `js/games/chaos-play.js` | Cornlashing views for the host screen and phones |
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
| `game:input` | player | `action`, `payload` | Game input (Chaos: `answer`, `vote`) |
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
and `finish()` which records results and moves the room to `FINAL_RESULTS`. Rooms, networking,
reconnects, pausing, scoreboards and stats persistence are all generic — a new game only
implements its own phases and views, plus host/phone renderers in `public/js/games/<id>-*.js`.
`test/framework.test.ts` runs a second, unrelated game through the same rooms to keep this true;
[ADDING_A_GAME.md](ADDING_A_GAME.md) is the step-by-step guide.

Planned future games (not built): Corn Planet Draw, Trivia, Gamble, Hidden roles, Prediction. The
existing CPI Database could later supply flavor (entity names, classifications) by reading its
public Firestore collections from the server, without the database depending on Corn Planet Party.

## 7. Cornlashing

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

`games` + `game_players` (score, placement, per-game counters as JSON). A user's stats are
aggregated from their rows: games played, wins, rounds, answers submitted, votes cast/received,
total points, best placement, prompts created and how often they were used, favourite categories,
and recent history. Stats are only returned to their owner. Emails are never stored by Corn Planet Party.

## 10. Security summary

- Server is authoritative for state, timers, scores, votes, winners and authorship.
- Firebase ID tokens verified (RS256, issuer/audience = project) against Google's public keys.
- Host actions require the `hostKey` socket or the current leader; player actions require the
  bound player socket.
- All user text is cleaned server-side and rendered with `textContent` client-side.
- Rate limits on connections, room creation, join attempts, socket events, API reads and prompt/report writes.
- Host skips carry the phase step they target, so a tap racing a timer can't skip two phases.
- Security headers + a Content-Security-Policy with no inline scripts.
- Errors are sent as short codes + friendly messages; no stack traces.
- No secrets in git: `.env` is ignored; the Firebase *web* config is public by design.
