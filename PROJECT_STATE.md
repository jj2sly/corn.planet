# Project state — corn.planet

Read this first in a fresh session, then `party/docs/ARCHITECTURE.md` if you need detail.
Last updated: 2026-09-18 (My Cob Escaped).

> **Naming (decided and applied 2026-09-17):** **CPI — Corn Planet Institution** is the umbrella org.
> **CPST — Corn Planet Strike Team** is the team inside it (still used for role labels like "Strike
> Team Overseer" and in-fiction prompt text). Renamed throughout: "CPST Party" → **Corn Planet
> Party**, "CPST Chaos" → **Cornlashing**, "CPST Database" → **CPI Database**.
> **Internal identifiers were deliberately NOT renamed** — the game id is still `chaos`
> (`games/chaos.ts`, `js/games/chaos-*.js`, and `games.game_id` rows in SQLite; `account.js` names
> games from `/api/config`), browser storage keys are still `cpst-party:*` (renaming them would drop
> players' in-progress seats), the branch is still `cpst-party`, and `CPE-###` entity IDs never change.

## 1. What this repo is

Two things in one repository:

| Part | Where | What |
|---|---|---|
| **CPI Database** site | repo root (`*.html`, `style.css`, `roles.js`, `nav-auth.js`, …) | Static site on GitHub Pages (`jj2sly.github.io/corn.planet`, served from `main`). Vanilla JS, no build step. Firebase Auth + Firestore (project `cpo-9af17`, Spark plan — no Cloud Functions). Collections: `entities` (`CPE-001`…), `artifacts` (`ART-001`…), `incidents` (`INC-001`…), `personnel` (`PER-001`…), `classifications`, `users/{uid}`. Roles: VIEWER(0) → CPI_EMPLOYEE(1) → CORRESPONDENT(2) → OVERSEER(3) → EXEC(4), enforced by Firestore rules (configured in the Firebase console, **not** in this repo). Admin: `admin.html` (EXEC assigns roles), `records.html` (CORRESPONDENT+ creates records). |
| **Corn Planet Party** | `party/` | Phone-controlled multiplayer party-game server. Node 24 + TypeScript run directly (no bundler, no compile step), Express 5, Socket.IO 4, SQLite via built-in `node:sqlite`. One long-running process, rooms in memory. Games: **Cornlashing**, and the canon-driven **Corn or Shit**, **Entity Auction** and **My Cob Escaped, What Do I Do Now???**. |

The database site does **not** depend on `party/`. `index.html` links to Corn Planet Party.

**Do not**: rename `CPE-###`/`INC-###`/`PER-###` IDs (breaks live Firestore data), change the
Firestore schema, or write to Firebase from the party server (it is read-only there by design —
see `party/docs/CANON.md`, which is the rule the whole canon integration rests on).

## 2. Git

- Branches: `main` (production, GitHub Pages) → `cpst-party` (**all party work happens here**; it is
  what Railway deploys). Decided 2026-09-17: no separate `cpi-party` branch.
- **Never merge `cpst-party` into `main` (decided 2026-09-17).** Database-site changes reach `main`
  by `git cherry-pick -x` only, so `party/` never lands on the Pages branch. When a commit mixes site
  and party files, cherry-pick with `-n` and `git rm` the party-only paths before committing (done
  for `0b1daa6` → `1b9aae5`). Afterwards, check the site files match:
  `git diff --stat cpst-party main -- . ':(exclude)party' ':(exclude)PROJECT_STATE.md' ':(exclude).gitignore'`
  should print nothing.
- Tags: `cpst-database-backup` (site before party work), `cpst-party-pre-tooling` (2026-09-17, code
  state before dev tooling was added).
- Remote: `https://github.com/jj2sly/corn.planet.git`. No SSH configured — git clones must use HTTPS.
- `.claude/` is listed in `.git/info/exclude`, so project-scoped Claude settings are **not tracked**.

Never: force-push, delete `main`, commit a `.env`, or push to the deployed branch without asking.

## 3. Development environment (Windows 11)

| Tool | State |
|---|---|
| Node.js | v24.19.0, portable install at `C:\Users\jdhj0\AppData\Local\Programs\node-v24`. **Added to the user PATH on 2026-09-17** — works in any terminal opened after that (the app must be restarted once to pick it up). In an older session, prefix it: `export PATH="$LOCALAPPDATA/Programs/node-v24:$PATH"`. |
| Python | 3.14.7 on PATH (`pip` works). User-installed scripts land in `%APPDATA%\Roaming\Python\Python314\Scripts`, which is **not** on PATH (this is where `graphify.exe` lives). |
| git | 2.55.0. `bash` is on PATH (Git for Windows). |
| Claude Code CLI | bundled with the desktop app: `%APPDATA%\Claude\claude-code\2.1.271\claude.exe` (not on PATH). |
| Not installed | `gh`, `docker`, `uv`, `pipx`, `railway` CLI. |

## 4. Commands

```bash
export PATH="$LOCALAPPDATA/Programs/node-v24:$PATH"   # every new bash session
cd party
npm run dev        # watch mode          npm start    # plain start
npm run typecheck  # tsc --noEmit        npm test     # node --test
npm run check      # typecheck + tests   -> 250 tests, 60 suites, all passing (2026-09-18)
node scripts/mycob-sim.ts 300   # My Cob Escaped balance simulator (offline, ~7s)
```

Pages: `/` join, `/host` big screen, `/play` phone, `/account`, `/prompts`, `/healthz`.
Phones need the LAN address the server prints at startup, not `localhost`.

## 5. Deployment

- **Database site**: GitHub Pages from `main`. Static, no build.
- **Corn Planet Party**: Railway, Docker build from `party/Dockerfile`, config `party/railway.json`,
  source branch `cpst-party`, root directory `/party`, volume mounted at `/data`, health check
  `/healthz`. **One replica only** (rooms are in memory). The Dockerfile bakes in the *public*
  Firebase web config; no secret env vars are required. Docker is not installed locally, so the
  image has never been built on this machine.
- Every push to the deployed branch redeploys and ends sessions in progress; the SQLite DB survives.

## 6. AI/dev tooling installed (2026-09-17)

| Tool | Scope | Notes |
|---|---|---|
| **Ponytail** 4.10.0 | Claude Code plugin, project scope | Anti-overengineering ruleset (YAGNI ladder) + `/ponytail`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`. ~676 tokens always-on. Its 3 lifecycle hooks run plain `node`; PATH was fixed on 2026-09-17, so they work from the first app restart after that. |
| **agent-skills** 0.6.9 (addyosmani) | Claude Code plugin, project scope | 25 lifecycle skills + `/spec /plan /build /test /review /code-simplify /ship` + 4 subagents. ~2.8k tokens always-on. Installed with an HTTPS clone override; repeat for updates: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="url.https://github.com/.insteadOf" GIT_CONFIG_VALUE_0="git@github.com:" claude plugin update agent-skills`. Its SessionStart hook is POSIX shell (+ needs `jq`) and does not run on Windows PowerShell — harmless, skills still work. |
| **Graphify** 0.9.63 | Python CLI, user install | `graphify.exe` in `C:\Users\jdhj0\AppData\Roaming\Python\Python314\Scripts` (**not on PATH**). Skill registered at `~/.claude/skills/graphify`; it also created `~/.claude/CLAUDE.md`. Local tree-sitter AST only — no code leaves the machine, no API key with `--code-only`. |
| **OmniRoute** | **excluded (decided 2026-09-17)** | Multi-provider LLM gateway (v3.8.50, MIT, 452 MB unpacked, port 20128). No runtime role — the app makes zero LLM calls — and it cannot change model routing for a session running inside the Claude desktop app. Revisit only if usage limits bite or an AI feature is added; it would stay a dev-only tool, never an app dependency. |

Graphify usage (graph lives in `graphify-out/`, git-ignored):

```bash
export PATH="/c/Users/jdhj0/AppData/Roaming/Python/Python314/Scripts:$PATH"
graphify extract . --code-only     # rebuild (18s, no API key)
graphify update .                  # incremental after code changes
graphify query "how does X reach Y?" --budget 1500
graphify explain "RoomManager"  |  graphify god-nodes  |  graphify affected "PartyDb"
```

Current graph: 516 nodes, 1334 edges, 39 code files, built at commit `24e0dd2`.
Hubs: `el()`, `PartyDb`, `Room`, `PartyError`, `$`, `ChaosGame`, `createRealtime()`, `createApi()`.
**Limitation:** `.html` and `.css` are not parsed, so the database site's inline `<script>` logic
(most of `records.html`, `entry.html`) is invisible to the graph; only `.js`/`.ts` files are in it.

## 7. Architecture quick map (party/)

`main.ts` → `app.ts` (`createPartyServer`) wires Express + Socket.IO + rooms.
`config.ts` env · `db.ts` all SQL + migrations (`PRAGMA user_version`) · `auth.ts` Firebase ID-token
verification (jose + Google JWKS) and role lookup · `api.ts` REST · `rooms.ts` room/player lifecycle
· `realtime.ts` socket handlers · `text.ts` input cleaning · `ratelimit.ts` ·
`canon.ts` read-only CPI Database access (warm snapshot, redactions stripped) ·
`games/{types,registry,chaos,claims,cornorshit,entityauction,auctioneffects,awards}.ts`,
`games/mycob/{config,content,incident,rules,director,narration,game}.ts`. Browser code in `public/`
(vanilla ES modules, `el()` helper, `games/<id>-{host,play}.js`). Adding a game:
`party/docs/ADDING_A_GAME.md`. Canon rules: `party/docs/CANON.md`. My Cob Escaped: `party/docs/MYCOB.md`.

Server is authoritative for state, timers, scores, votes and authorship. All user text is cleaned
server-side and rendered with `textContent`. CSP allows no inline scripts.

## 8. Status

- **My Cob Escaped, What Do I Do Now???** (built 2026-09-18, **pushed to `cpst-party` and
  live on Railway 2026-09-18** — `/api/config` lists `mycob`, `/healthz` ok with 21 canon records; not
  yet played on the live site): incident-response game on a shared incident engine. Random canon entity (sometimes unknown),
  data-driven breach/location/facility/problem/personnel/objectives, entity-specific rules, hidden
  0–100 stats shown as qualitative statuses, roles with trades and private intel, 3 lives with
  reassignment at 0, chaos, stage votes, hidden stage scoring, player-created awards, text narration
  with a voice hook, one `game_details` JSON record per game (migration 6). The Incident Director is an
  interface; the only implementation is the built-in template director (no LLM, no API key). Modes:
  Incident Response and Chaos Mode playable; four more listed as coming later. Played end to end in
  the browser (host + phone tab + bots, fixture canon), not on real phones or live canon. See
  `party/docs/MYCOB.md`.
- Corn Planet Party has **two games** and is documented. **Pushed and verified live on 2026-09-17**:
  Railway serves Cornlashing and Corn or Shit and loaded 21 canon records in production.
- The CPI Database site on `main` (GitHub Pages) has the rename plus the incident and personnel
  pages, cherry-picked from `cpst-party` (`9dfd76b`, `1b9aae5`). Verified live.
- Tests: **250 passing** (`party/test/`: rooms, chaos, cornorshit, entityauction, claims, canon,
  promotion, db, api, realtime, framework, mycob, mycob-incident, mycob-rules, mycob-realtime,
  awards). `tsc --noEmit` clean.
- **Entity Auction** (built 2026-09-18, on `origin/cpst-party` by 2026-09-18; live deploy not checked): agents bid Kernels on sealed
  containment bays, each hiding a real entity; doors open when the server's timer ends; hidden
  modifiers and random global events in the Action Round; highest net worth wins. Moderators manage
  modifiers/events at `/prompts` → Moderation → Entity Auction (`auction_effects`, migration 5).
  Played end to end in the browser (host + phone + bots) against fixture canon, not live canon or
  real phones. See `party/README.md` and `party/docs/ARCHITECTURE.md` §7e.
- Fixed in passing (2026-09-18): a game refusing to start (`NO_CANON`) used to leave the room stuck
  "in game" with no game; `Room.startGame` now creates the game before changing any room state.
- **Hall of Fame + promotion to canon** (built 2026-09-17):
  Cornlashing keeps each incident's accepted report(s) in `moments`; `/hall` lists them; moderators
  hide or promote. Promotion hands a prefilled incident to the Records Division
  (`records.html?promote=cpp-moment-N`); the filed record carries `promotedFrom` and the party server
  links the moment to it on its next canon read. Verified in the browser as far as the Records
  Division login; **the prefilled form itself has not been seen by a real Correspondent+ login yet.**
- The CPI Database has **incidents** and **personnel** record types (`INC-###`, `PER-###`) alongside
  entities and artifacts, with cross-references between them.
- Canon integration is live: the party server reads 21 entity records from Firestore at startup and
  Corn or Shit was played end to end against them.
- Prompt library intentionally **starts empty**; Cornlashing falls back to placeholder incidents.
  Corn or Shit does not need prompts at all — it runs on canon.

### Firestore rules

Published by the user on 2026-09-17 with the `incidents` and `personnel` blocks; verified the same
day (both collections readable signed out, `users` still 403). `firestore.rules` is a copy of the
console rules; nothing deploys it, so any change must be published in the console by hand and
mirrored in the file.

### Known issues / gaps
1. `graphify.exe` is not on PATH (see §3) — prefix it or add that Scripts directory too.
2. `.claude/` is git-excluded locally, so plugin config is not reproducible for a fresh clone.
3. Graphify cannot see inline-script HTML (§6) and community labels are placeholders
   (`Community N`) because no LLM backend was configured for labelling.
4. Docker image never built locally (no Docker).
5. `CPE-011` is titled "TEST" and is real content as far as the games are concerned — it shows up
   in Corn or Shit rounds. Delete it in the Records Division if it is junk.
6. `artifacts` is empty, so it is deliberately left out of `canon.ts`. Add a spec there once it has
   content.
7. Planned-but-unbuilt games: Draw, Trivia, Gamble, Hidden roles, Prediction. My Cob Escaped's
   other four modes (You Made It Worse, Incident Report, Choose Your Response, CPST Field Operative)
   are listed in the lobby but not playable.
8. Promotion to canon only produces **incidents** (a Cornlashing prompt is an incident, the report
   its resolution). Promoting as an entity or personnel file isn't supported.
9. A game ended early saves no moments (same as stats). Corn or Shit saves none by design — its best
   line is a fabrication about a real record.
10. Entity Auction with 21 entities: 8 agents × 3 needs 24, so the lobby warns and the server refuses;
    7 agents × 3 (21) or 8 agents × 2 (16) work.
11. Entity Auction's score is net worth in Kernels (~10–30k per game), so it dominates the account
    page's "Total points" next to Cornlashing/Corn or Shit scores (hundreds).
12. Entity Auction has no anti-snipe: a bid in the last second wins outright. Add a "bid extends the
    timer to N seconds" rule to `DEFAULT_ENTITY_AUCTION_RULES` if that feels bad in play.
13. Implemented effect types: change/multiply value, lose/duplicate entity, pay owner, pay everyone,
    trigger modifiers. Transfer, swap and protect are not built; add them to `EFFECT_TYPES` in
    `party/server/games/auctioneffects.ts` when a modifier needs them.
14. My Cob Escaped's built-in director can't read free text (it uses tags, approach, outcome and the
    incident elements a response names), so narration is template-driven. A model-backed
    `IncidentDirector` is the intended upgrade; nothing else would need to change.

## 9. Decisions

**2026-09-17 (naming and tooling)**
1. **Branding**: applied — see the note at the top. Display names only; internal ids kept.
2. **Branch**: stay on `cpst-party`; no `cpi-party` branch.
3. **Node on PATH**: done (user PATH; the previous value is backed up in the session scratchpad).
4. **OmniRoute**: excluded (see §6).

**2026-09-17 (canon integration)**
5. **Record types added**: incidents and personnel, ids `INC-###` and `PER-###` — matching the
   existing short-prefix convention (`CPE-`, `ART-`) rather than the longer `CPI-INCIDENT-###` form.
6. **Canon is world-readable**: incidents and personnel are public-read like entities, so the party
   server reads them with no token and **guests with no CPI account can play canon-driven games**.
7. **The party server never writes to Firebase.** Canon is read-only; generated game content is
   never canon. This is the load-bearing rule — `party/docs/CANON.md`.
8. **Fabricated claims are built by template, not by an LLM**: a real field value from one record
   attributed to another of the same kind. No API key, no cost, deterministic in tests, in-universe
   by construction, and checked so the lie can never accidentally be true.
9. **Canon promotion will be a handoff**, not a server-side Firestore write: a moderator reviews a
   candidate and creates the record themselves in the Records Division, under their own account.
10. **Shipping order**: Corn or Shit first, then reassess before building Entity Auction and
    My Cob Escaped.
11. **Branches are never merged.** Site changes go to `main` by cherry-pick only (see §2).
12. **Hall of Fame visibility**: any logged-in account can browse it; only moderators (Overseer/Exec)
    hide or promote. Author display names are kept with each moment; author uids never leave the
    server.
13. **What counts as a moment** in Cornlashing: each incident's winning report(s) with at least one
    vote. Default rulings don't count.

**2026-09-18 (My Cob Escaped)**
19. **No LLM yet**: the Incident Director is an interface with a deterministic built-in director.
    Adding a model provider (and an API key / cost) is a separate decision.
20. **Engine rolls first, director narrates within the rolls**; directors can't award points or take
    lives. Invalid, failing or late (>10 s) directors fall back to the built-in one.
21. **Responses get an optional approach (careful/standard/reckless) and "put myself in harm's way"**,
    so chaos and sacrifice are explicit choices, never inferred from wording. Text is never scored.
22. **Awards**: players invent one award each, then vote on who receives each (no self-votes); no points.
23. **Persistence**: one generic `game_details` JSON row per game rather than per-game tables.
24. **Redacted canon stays stripped**: the director never sees `/r…/r` content either.

**2026-09-18 (Entity Auction)**
14. **Unbid bays** go free to an agent with the emptiest collection, so every agent ends the auction
    with exactly `entitiesPerPlayer` entities. Opening bid minimum is 0, raises at least 100.
15. **Every entity carries a modifier** drawn from the enabled library (neutral ones exist so not
    every one matters). After the events, a final audit reveals and applies every modifier left
    (`actionRound.revealEffects`).
16. **Events are global**: each applies to every agent or every entity (optionally one
    classification), never to one randomly chosen player.
17. **Base values**: COSMIC 8,000, EARTHLY 4,000, LOCAL 2,000, anything else 2,500 — the three
    classifications the Records Division offers today. All in `DEFAULT_ENTITY_AUCTION_RULES`.
18. **Moderator UI** lives in the existing moderation console on `/prompts`, not a new page.

## 10. Next task

1. Write a few incidents and personnel files in the Records Division, so Corn or Shit can use more
   than entities (both collections are empty so far).
2. Play Corn or Shit with real people on real phones. It has been played end to end from browser
   tabs against live canon, and the deployed build serves it, but not yet on actual phones.
3. Promote one real Hall of Fame moment end to end with a Correspondent+ login: check the incident
   form prefills after the login detour, file it, and confirm `/hall` shows it as canon within ~10 min.
4. Play Entity Auction with real people on real phones, against live canon. Watch whether 30s per
   bay and 5 events feel right.
5. Play My Cob Escaped with real people on real phones (it has only been played from browser tabs
   with bots). Tune `party/server/games/mycob/config.ts` from what feels off and re-run
   `node scripts/mycob-sim.ts`. Decide whether to add a model-backed Incident Director.

Optional later: renaming the internal game id `chaos` → `cornlashing` would mean renaming 3 files,
the registry entry, and a SQLite migration for existing `games.game_id` rows. Not worth it unless asked.
