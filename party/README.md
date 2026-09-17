# Corn Planet Party

Phone-controlled multiplayer party games from the **Corn Planet Institution**.
One screen hosts (laptop or TV), 3–8 agents play on their phones. The first game is
**Cornlashing**: anonymous incident reports, head-to-head votes, points.

> **Players:** open the site on your phone → enter the 4-letter code → pick a name → play.
> **Host:** open `/host` on the big screen → show the code → start the operation.

Corn Planet Party lives in `party/` and runs next to the existing CPI Database site in the repository
root. The database site does not depend on it and keeps working if Corn Planet Party is down.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together and
[docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) for building the next minigame.

---

## Contents

- [Requirements](#requirements)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Tests and checks](#tests-and-checks)
- [How a session works](#how-a-session-works)
- [Accounts](#accounts)
- [Prompts and moderation](#prompts-and-moderation)
- [Database](#database)
- [Deployment](#deployment)
- [Linking from the CPI Database](#linking-from-the-cpi-database)
- [Troubleshooting](#troubleshooting)

## Requirements

- **Node.js 24 or newer.** TypeScript runs directly (no build step) and SQLite is built in (`node:sqlite`).
- npm (bundled with Node).

Nothing else: no separate database server, no bundler.

## Local development

```bash
cd party
npm install
cp .env.example .env
```

For local testing without real accounts, set `AUTH_MODE=dev` in `.env`. That enables a fake login
on the Account page where you pick any user id and CPI role (the server refuses this mode when
`NODE_ENV=production`). To use the real CPI Database logins, keep `AUTH_MODE=firebase`.

```bash
npm run dev      # restarts on file changes
npm start        # plain start
```

Open `http://localhost:3000/host` for the host screen. Phones can't open `localhost`: with
`HOST=0.0.0.0` the server prints this computer's network addresses at startup
(e.g. `http://192.168.1.20:3000/play`). Phones on the same Wi-Fi use that. Windows may ask
whether to allow Node.js through the firewall the first time.

To try multiplayer on one computer, open the host screen in one tab and each player in its own
tab (each tab keeps its own seat).

| Page | URL |
|---|---|
| Landing page (join form, host link) | `/` |
| Host screen | `/host` |
| Phone controller | `/play` (or `/join/ABCD` to prefill a code) |
| Account, stats, history | `/account` |
| Prompt library and moderation | `/prompts` |
| Health check | `/healthz` |

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Interface to bind. `127.0.0.1` = this machine only |
| `NODE_ENV` | — | `production` in production (refuses `AUTH_MODE=dev`) |
| `DATABASE_PATH` | `./data/party.db` | SQLite file. Must be on persistent storage in production |
| `TRUST_PROXY` | `0` | `1` behind a platform proxy/load balancer, so rate limits see real client IPs |
| `AUTH_MODE` | `firebase` if `FIREBASE_PROJECT_ID` is set, else `none` | `firebase`, `dev` (local only) or `none` (guests only) |
| `FIREBASE_PROJECT_ID` | — | The CPI Database Firebase project (`cpo-9af17`) |
| `FIREBASE_API_KEY` | — | Firebase **web** API key |
| `FIREBASE_AUTH_DOMAIN` | — | e.g. `cpo-9af17.firebaseapp.com` |

The Firebase values are the same public web config already shipped in the database site's pages.
They are not secrets; security comes from server-side token verification and Firestore rules.
**Never commit a `.env` file** (it's git-ignored).

## Tests and checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test
npm run check       # both
```

The suite covers rooms (codes, joining, limits, duplicate names, leaving, disconnects, reconnects,
leader transfer, host pause, cleanup), Cornlashing (assignment, answer validation and editing,
anonymity, vote validation, scoring, full games, replay), the database (moderation policy,
reports, stats), the REST API (auth, ownership, moderator permissions, validation, safe errors)
and real Socket.IO multiplayer (full game over sockets with an author-leak scan, refresh recovery,
session replacement, host refresh, kicks, logins, rate limiting).

## How a session works

**Host (big screen)**
1. Open `/host`. A session code appears.
2. Pick settings: paired rounds (1–3), the Total Breach final round, report/vote timers and the
   humor level (Safe, Chaos, Custom).
3. Start once at least 3 agents are connected. Use **Skip ▸** to move past a phase early,
   **End game** to return to the lobby, **Close session** to end it for everyone. You can remove
   an agent with ✕ in the lobby.
4. After the final debrief: **Replay** or **Return to lobby**.

**Players (phones)**
1. Open the site, enter the code and a name (names are unique per session).
2. The first agent to join is the **session leader** and can start, replay or return to the
   lobby from their phone, so the room never depends on the host screen alone.
3. File reports when incidents arrive, vote when voting opens. Results show on the big screen.

**Refreshes and dropouts**
- A phone that refreshes or loses signal rejoins its seat automatically, including drafts in
  progress. If the tab was closed, the join page offers **Rejoin ABCD as NAME**.
- If the host screen drops, the game pauses (timers freeze) until it reconnects. The session
  leader can choose **Continue without display**.
- Lobby players who stay disconnected for 2 minutes are removed. Sessions with nobody connected
  for 10 minutes, or older than 6 hours, are closed.

**Cornlashing rules**
- Each paired round, every agent gets two incidents; each incident is shared with one other agent.
- Reports are anonymous while the review board (everyone except the two authors) votes.
- Points: `100 × round` per vote, plus a `100 × round` **Unanimous Ruling** bonus for getting every
  vote when at least 2 were cast. If only one agent files, they get `100 × round` by default.
- **Total Breach** (optional final round): everyone answers the same incident, everyone votes
  (not for themselves), multiplier = paired rounds + 1.

## Accounts

Corn Planet Party reuses the **CPI Database Firebase accounts**: same email and password. Guests can play
without an account; logged-in players get statistics and game history on `/account`, and can write
prompts. New registrations start as Viewer, just like on the database site.

- The browser signs in with the Firebase SDK and sends its ID token.
- The server verifies the token against Google's public keys (issuer/audience = the project) and
  reads the user's CPI role from their own `users/{uid}` Firestore document using that same token,
  so the existing Firestore rules still decide what can be read.
- **Corn Planet Party never writes to Firebase.** Display names, prompts and stats are stored in its own
  SQLite database, keyed by Firebase uid. Emails are never stored or shown to other players.
- **Strike Team Overseers and CPI Execs** (roles managed in the database site's admin panel) are
  prompt moderators in Corn Planet Party.

## Prompts and moderation

`/prompts` (login required):

- **File prompt**: 5–150 characters, a category, optional tags, and a rating: *safe* or *chaos*.
  Keep chaos edgy and absurd, never sexual content or graphic violence.
- **My prompts**: edit or delete your own. Edits go back through moderation.
- **Library**: browse approved prompts and report ones that shouldn't be there.
- **Moderation** (Overseer/Exec): pending, reported, disabled and approved queues; approve, disable,
  remove, read report reasons, dismiss reports, assign packs; create/enable/disable prompt packs;
  add/delete categories; and set the policy:
  - *Auto-approve everything*, *Review chaos prompts* (default), or *Review everything*.
  - Prompts reaching the report threshold (default 2) are disabled until a moderator reviews them.

Humor levels chosen by the host: **Safe** uses safe prompts only; **Chaos** adds chaos prompts;
**Custom** uses only prompts written by the group's accounts. Disabled prompts and prompts in disabled
packs never appear in games.

The library **starts empty**: the group writes its own prompts. Until there are enough, games fall back
to a few placeholder incidents, and the host screen's lobby warns when the library is empty or small.
(Databases created before this change had their old built-in prompts cleared once, on upgrade.)

## Database

SQLite at `DATABASE_PATH`, created and migrated automatically on startup (`PRAGMA user_version`).
Tables: `profiles`, `prompts`, `packs`, `categories`, `reports`, `settings`, `games`, `game_players`.

**Migrations**: add a new `if (version < N)` block in `PartyDb.migrate()` (`server/db.ts`) that runs
the schema change and sets `PRAGMA user_version = N`. They run in a transaction on startup.

**Backups**: stop the server and copy `party.db` (plus `party.db-wal`/`party.db-shm` if present).
Rooms are in memory and don't need backing up.

## Deployment

GitHub Pages (where the database site lives) only serves static files, so Corn Planet Party needs a host
that can run **one long-running Node.js process** with **WebSockets** and **persistent disk**:

- Any container platform with a persistent volume (for example Fly.io or Railway volumes, or a
  Render web service with a persistent disk; check each provider's current plans and pricing).
- Or a small VPS running Node 24 (or Docker) behind a TLS reverse proxy such as Caddy or nginx.

Checklist:
1. `NODE_ENV=production`, `AUTH_MODE=firebase` and the three `FIREBASE_*` values.
2. `DATABASE_PATH` on persistent storage (the Docker image uses `/data/party.db`; mount a volume there).
3. `TRUST_PROXY=1` behind the platform's proxy.
4. HTTPS in front (the platform's TLS, or Caddy/nginx). WebSockets must be allowed through.
5. **Run a single instance.** Sessions live in memory; two instances would split rooms.
6. Health check: `GET /healthz`.
7. Logs: the server writes to stdout/stderr (startup info, unexpected errors, failed stat writes).
   Use the platform's log viewer.
8. Room cleanup runs automatically every 15 seconds.

**Railway (the chosen host)**

`party/railway.json` holds the build and health-check settings. One-time setup in the Railway dashboard:

1. Create a project → **Deploy from GitHub repo** → `jj2sly/corn.planet`.
2. In the service's **Settings**:
   - Source branch: `cpst-party` (until it's merged)
   - Root directory: `/party`
   - Railway config file path: `/party/railway.json` (the config path doesn't follow the root directory)
3. **Variables**: none required. The Dockerfile already sets `NODE_ENV`, `HOST`, `DATABASE_PATH`, `TRUST_PROXY`
   and the CPI Firebase login settings (`AUTH_MODE=firebase` plus the public web config); Railway provides `PORT`.
   Set a variable in Railway only to override one of these.
4. Add a **volume** mounted at `/data` (this is where the prompt library, profiles and stats live).
5. **Networking** → generate a public domain, then check `https://YOUR-DOMAIN/healthz`.

Keep it at one replica (Railway doesn't allow replicas with a volume anyway). Every push to the
deployed branch redeploys; sessions in progress end on redeploy, the database survives.

**Docker**

```bash
cd party
docker build -t corn-planet-party .
docker run -p 3000:3000 -v corn-planet-party-data:/data --env-file .env corn-planet-party
```

(The Dockerfile was written for this project but not test-built here, because Docker wasn't
available on the development machine. Build it once locally before relying on it.)

**Without Docker**

```bash
cd party
npm ci --omit=dev
NODE_ENV=production node --env-file=.env server/main.ts
```

**Firebase settings to check once the domain exists**
- If the Firebase web API key has HTTP-referrer restrictions (Google Cloud console → Credentials),
  add the Corn Planet Party domain.
- If sign-in reports an unauthorized domain, add it under Firebase console → Authentication →
  Settings → Authorized domains.

## Linking from the CPI Database

The database site was intentionally left unchanged. Once Corn Planet Party has a public URL, a link can be
added to the database home page, for example next to the existing entries in `index.html`:

```html
<div class="entry">
    <a href="https://YOUR-CORN-PLANET-PARTY-DOMAIN/">CORN PLANET PARTY</a>
    <span>&rarr;</span>
</div>
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phones can't load the page during development | Use the network address printed at startup, not `localhost`; same Wi-Fi; allow Node through the firewall |
| "No active session with that code" | Check the code on the host screen; sessions close after 10 min with nobody connected |
| Game stuck on "HOST DISPLAY OFFLINE" | Reopen `/host` on the host screen (it resumes automatically), or the leader taps **Continue without display** |
| Logged in but stats say guest | The login expired; log in again on `/account` and rejoin |
| Moderation tab missing | Only Strike Team Overseers and CPI Execs moderate; roles are set in the database site's admin panel |
| `AUTH_MODE=dev is refused` on startup | Expected in production; use `firebase` |
