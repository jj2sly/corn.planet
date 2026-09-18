# Project state — corn.planet

Read this first in a fresh session, then `party/docs/ARCHITECTURE.md` if you need detail.
Last updated: 2026-09-17.

> **Naming (decided and applied 2026-09-17):** **CPI — Corn Planet Institution** is the umbrella org.
> **CPST — Corn Planet Strike Team** is the team inside it (still used for role labels like "Strike
> Team Overseer" and in-fiction prompt text). Renamed throughout: "CPST Party" → **Corn Planet
> Party**, "CPST Chaos" → **Cornlashing**, "CPST Database" → **CPI Database**.
> **Internal identifiers were deliberately NOT renamed** — the game id is still `chaos`
> (`games/chaos.ts`, `js/games/chaos-*.js`, and `games.game_id` rows in SQLite; `account.js` maps the
> id to the display name), browser storage keys are still `cpst-party:*` (renaming them would drop
> players' in-progress seats), the branch is still `cpst-party`, and `CPE-###` entity IDs never change.

## 1. What this repo is

Two things in one repository:

| Part | Where | What |
|---|---|---|
| **CPI Database** site | repo root (`*.html`, `style.css`, `roles.js`, `nav-auth.js`, …) | Static site on GitHub Pages (`jj2sly.github.io/corn.planet`, served from `main`). Vanilla JS, no build step. Firebase Auth + Firestore (project `cpo-9af17`, Spark plan — no Cloud Functions). Collections: `entities` (`CPE-001`…), `artifacts` (`ART-001`…), `incidents` (`INC-001`…), `personnel` (`PER-001`…), `classifications`, `users/{uid}`. Roles: VIEWER(0) → CPI_EMPLOYEE(1) → CORRESPONDENT(2) → OVERSEER(3) → EXEC(4), enforced by Firestore rules (configured in the Firebase console, **not** in this repo). Admin: `admin.html` (EXEC assigns roles), `records.html` (CORRESPONDENT+ creates records). |
| **Corn Planet Party** | `party/` | Phone-controlled multiplayer party-game server. Node 24 + TypeScript run directly (no bundler, no compile step), Express 5, Socket.IO 4, SQLite via built-in `node:sqlite`. One long-running process, rooms in memory. Games: **Cornlashing** and **Corn or Shit** (canon-driven). |

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
npm run check      # typecheck + tests   -> 68 tests, 20 suites, all passing (2026-09-17)
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
`games/{types,registry,chaos,claims,cornorshit}.ts`. Browser code in `public/` (vanilla ES modules,
`el()` helper, `games/chaos-{host,play}.js`, `games/cornorshit-{host,play}.js`). Adding a game:
`party/docs/ADDING_A_GAME.md`. Canon rules: `party/docs/CANON.md`.

Server is authoritative for state, timers, scores, votes and authorship. All user text is cleaned
server-side and rendered with `textContent`. CSP allows no inline scripts.

## 8. Status

- Corn Planet Party has **two games** and is documented. **Pushed and verified live on 2026-09-17**:
  Railway serves Cornlashing and Corn or Shit and loaded 21 canon records in production
  (`/healthz` → `canon.degraded: true` until the Firestore rules below are applied).
- The CPI Database site on `main` (GitHub Pages) has the rename plus the incident and personnel
  pages, cherry-picked from `cpst-party` (`9dfd76b`, `1b9aae5`). Verified live.
- Tests: **145 passing** (`party/test/`: rooms, chaos, cornorshit, claims, canon, promotion, db, api,
  realtime, framework). `tsc --noEmit` clean.
- **Hall of Fame + promotion to canon** (built 2026-09-17, not yet pushed at the time of writing):
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

### ⚠ Blocking action, not doable from here

**The `incidents` and `personnel` Firestore rules must be applied in the Firebase console.**
Until then both collections are default-deny: the new database pages show "Could not reach the
database", creating a record fails, and the party server logs
`canon partially unavailable: incidents: HTTP 403; personnel: HTTP 403` (it degrades to entities
only, which is why Corn or Shit still works). `firestore.rules` is now the real console rules
(pasted in by the user on 2026-09-17) plus the `incidents` and `personnel` blocks, so the whole
file can be pasted into console.firebase.google.com → project `cpo-9af17` → Firestore Database →
Rules → Publish.

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
7. Planned-but-unbuilt games: Entity Auction, My Cob Escaped What Do I Do Now???, Draw, Trivia,
   Gamble, Hidden roles, Prediction.
8. Promotion to canon only produces **incidents** (a Cornlashing prompt is an incident, the report
   its resolution). Promoting as an entity or personnel file isn't supported.
9. A game ended early saves no moments (same as stats). Corn or Shit saves none by design — its best
   line is a fabrication about a real record.

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

## 10. Next task

1. **Apply the Firestore rules** (see the blocking action in §8), then write a few incidents and
   personnel in the Records Division so Corn or Shit can use more than entities. Verify the new
   pages load and `/healthz` stops reporting `degraded: true`.
2. Play Corn or Shit with real people on real phones. It has been played end to end from browser
   tabs against live canon, and the deployed build serves it, but not yet on actual phones.
3. Promote one real Hall of Fame moment end to end with a Correspondent+ login: check the incident
   form prefills after the login detour, file it, and confirm `/hall` shows it as canon within ~10 min.
   (Needs the Firestore rules first — incidents can't be created until then.)
4. Then: Entity Auction, or My Cob Escaped.

Optional later: renaming the internal game id `chaos` → `cornlashing` would mean renaming 3 files,
the registry entry, and a SQLite migration for existing `games.game_id` rows. Not worth it unless asked.
