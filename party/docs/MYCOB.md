# My Cob Escaped, What Do I Do Now???

An incident-response party game. A random entity from the CPI Database has escaped; 3–8 agents on
phones are handed temporary roles and three lives, and each stage every agent types what they do —
anything at all. The **Incident Director** interprets all the responses together, the **engine**
decides what mechanically happens, and the room sees one narrated consequence and votes
anonymously for the best move. At the end the agents invent the awards.

Game id `mycob`. Code in `server/games/mycob/` and `server/games/awards.ts`; screens in
`public/js/games/mycob-*.js`.

## 1. Principles

| | Owns |
|---|---|
| **CPI Database** | Canon: the entity, real personnel files, prior incidents. Read-only here. |
| **Incident Director** | The world and the narrative: what each action *meant*, which stats it moved (within limits), who got hurt (among those at risk), what was found, new problems, the narration. |
| **Engine** | The rules: rolls, lives, hidden stats, caps, timers, roles, objectives, reveal budgets, endings, votes, scores, winners, persistence. |

- The director never awards points, decides a winner or touches lives. It returns structured
  effects; `validateDirectorOutput()` checks every one against the engine's rolls and drops,
  clamps or refuses whatever isn't mechanically justified.
- Everything the game makes up is **generated content**: never canon, never written to Firebase.
- Players only ever receive what the game has revealed. Hidden state stays in the game instance.

## 2. Flow

```
ALERT (roles dealt)
  └─ per stage: UPDATE → RESPONSE → PROCESSING → CONSEQUENCE → STAGE_VOTE → [scoring]
OUTCOME (ending, entity revealed, score breakdown) → AWARD_SUBMIT → AWARD_VOTE → AWARD_RESULTS
→ room FINAL_RESULTS
```

| Phase | Default | Closes early when |
|---|---|---|
| ALERT | 20 s | — (host/leader skip) |
| UPDATE | 20 s × length scale | — |
| RESPONSE | 45 s × length scale | every agent has filed (editable until then) |
| PROCESSING | 4–10 s (Claude: 4–21 s) | director answered and 4 s passed; falls back to the built-in director at the limit |
| CONSEQUENCE | 30 s × length scale | — |
| STAGE_VOTE | 20 s | every eligible agent voted; skipped if nobody acted |
| OUTCOME / AWARDS | 20 / 45 / 40 / 15 s | everyone has submitted / voted |

Lengths: **Short** 3 stages, **Standard** 5, **Long** 7 (timers × 0.9 / 1 / 1.15); the host can
also pick any 3–7 stages. So a Standard game gives 45 s to respond, 30 s for the consequence and
20 s to vote; a Short one 40.5 s / 27 s / 20 s and a Long one about 52 s / 35 s / 20 s (the vote isn't
scaled). Standard is about 13 minutes at full timers including awards, less when everyone files and
votes quickly (tune `timing` in `config.ts`). All timers are the
room's single pausable server timer; they freeze while the host display is away.

The incident can end early — contained or terminated (from stage 3), or everyone dead (any time) —
and ends when fewer than 2 agents remain.

## 3. Modules

| File | What |
|---|---|
| `config.ts` | **Every tunable**: stages, lengths, timers, roles, lives, stat labels and thresholds, difficulty tables, randomness, approaches, chaos, events, reveals, objectives, endings, scoring weights and caps, voting, awards. Plus `MODES` and `resolveConfig()` (deep-merge overrides). |
| `content.ts` | World data: facility systems, locations, breach types, starting problems, staff names and departments, objective templates, special events and anomalies, new problems, **entity rules**, ending text. |
| `incident.ts` | The incident model, `generateIncident()`, facts and reveals, objectives and their evaluation, qualitative status mapping, `scrubHidden()`. |
| `rules.ts` | Engine mechanics: `analyzeResponse`, `planStage` (rolls, interactions, hazards, events), `effectEnvelope`, `applyStage`, `scoreStage`, `checkEnding`. |
| `director.ts` | The `IncidentDirector` interface, `DirectorContext`, `validateDirectorOutput()`, and `MockIncidentDirector`. |
| `claude.ts` | `ClaudeIncidentDirector`: the Claude-backed director, its prompt and output schema (§7). |
| `narration.ts` | Typed narration events (`NarrationLog`). |
| `game.ts` | The `GameInstance`: phases, timers, input validation, views, persistence record. `createMyCobGame({ director?, config? })`; `myCobGame` is the registered default. |
| `../awards.ts` | `AwardCeremony`, player-created awards, reusable by any game. |
| `scripts/mycob-sim.ts` | Balance simulator (see §11). |

## 4. The incident generator

`generateIncident(sources, config, random, options)` combines, all at random and data-driven:

1. **Entity**: any canon entity (`ctx.canon.list("entity")`). None → the game refuses to start (`NO_CANON`).
2. **Entity rules** (`ENTITY_RULES`): each rule matches by id, classification, containment level, text
   in the entity's description/procedures, or a non-redacted field being present, then fires with its
   `chance`. A rule can add an **entity-specific breach type** (e.g. *Termination Protocol Misfire*
   for TERMINATION containment, *Procedure Violation* that quotes the entity's own procedures), an
   **environmental effect** ("The sprinkler system is armed and twitchy" for anything that mustn't
   get wet), a difficulty bump, or a higher chance of starting unknown. No entity is hard-coded in
   the engine; rules are data. While the entity is unknown, an entity-specific breach shows as the
   general breach named by its `cover` (a *Termination Protocol Misfire* would say TERMINATION), and
   an environment line from a rule that matched by id, classification or containment level waits
   until it is identified (its stat effects apply either way).
3. **Breach type**: general types (standard failure, security, power, unauthorized access, transport,
   malfunction, unknown) plus the fired rules' own, weighted.
4. **Unknown entity**: `unknownEntity.chance` (25%), nudged by the breach and rules; 0 and 1 are absolute.
5. **Location**: built-in facility areas, or `sources.locations` once canon has location records.
6. **Starting problem**: preferred by the breach, filled with the location, a staff member and the entity.
7. **Difficulty** = classification + containment level + procedure length + breach + location + problem
   + rules + noise (±14), then a 12% *lucky break* (×0.3) or 12% *bad day* (+20). Dangerous entities
   are harder on average but not always; harmless ones sometimes have a terrible day.
8. **Facility systems** (power, security, comms, containment, doors, alarms, equipment, safety):
   forced by the breach/problem, otherwise damaged more often the harder it is.
9. **Personnel**: up to 2 real personnel files (ones linked to the entity's past incidents first;
   DECEASED/REDACTED skipped; MIA → missing) plus 2–4 generated, game-only staff, each with a public
   relationship to the incident and one private piece of knowledge. While the entity is unknown,
   staff linked to it are left out: their public file would lead straight to it.
10. **Starting stats** (hidden, 0–100): containment, facility, personnel, resources, information,
    time, chaos — defaults, noise, difficulty, and every generated effect.
11. **Objectives**: one primary (contain / identify-and-contain / survive) and 1–3 secondaries that fit
    (rescue whoever the problem trapped, restore an offline system, discover what someone knows…).

## 5. Information model

Every piece of information is a `Fact` with `visibility` `known` or `discoverable`, a `source`
(`canon`/`generated`), a `redacted` flag and the `revealedStage`.

- **Known to the engine and director**: all facts, stats, rolls, personnel knowledge.
- **Known to players**: `known` facts only (the entity's file header when it's identified; anything
  discovered). Views are built from these and nothing else.
- **Discoverable**: entity identity/classification/containment (when unknown), procedures,
  description, addendum, prior canon incidents, what each staff member knows.
- **Redacted**: canon fields still hiding something. `canon.ts` already strips the hidden text when
  it loads canon, so neither the server nor the director ever holds it; revealing such a fact shows
  the `[REDACTED]` markers the database site shows at low clearance.
- **Revealed during play**: a validated director reveal (budget: one per action that went somewhere,
  max 3 per stage). The **unknown entity's identity** needs information ≥ 40 plus a successful
  investigation, a critical inquiry, or information ≥ 75. Each discovery adds information. Revealing
  the identity also reveals the file header (classification, containment level) and anything the
  breach quotes from the file; the real breach name and environment lines then show too.
- **Database ids**: no canon id or link reaches players while the entity is unknown — not the
  entity's, not a staff member's, not a prior incident's — and fact ids and labels never contain one
  (`f-prior-1`, "Personnel file: Agent Kernel"). They appear once it is identified.

`scrubHidden()` (`incident.ts`) is deterministic and runs on everything players see. While the
entity is unidentified it cuts its name (any case, spacing or punctuation, with or without "The"), its
id however it's written ("cpe 5", "CPE005"), its database link and the ids of prior incidents tied to
it; always, it cuts exact or near-exact quotes (any 5 words in a row, or a whole short text) of
undiscovered facts. With `{ partialNames: true }` — used for director text and canon text, never the
engine's own templates, where a cut would itself give the name away — it also cuts single distinctive
words of the name ("Yellow" from "Big Yellow", minus common and in-world words and words this
incident's staff and places use) and an undiscovered classification or containment label written as
the database writes it (NEUTRALIZED). Research leads name *what* can be found, never its content or
canon id. Canon text discovered in play is shown (name and ids cut); searching the public CPI Database
for it is the intended way to work the entity out.

## 6. Responses, rolls and consequences

A response is a **tag** (CONTAIN, EVACUATE, INVESTIGATE, COMMUNICATE, DEPLOY, EQUIPMENT, STRATEGIZE,
OTHER) plus **free text** (≤ 200 chars), with an optional **approach** (careful / standard / reckless)
and an optional **"put myself in harm's way"** (sacrifice). The text is never scored.

`planStage()` runs before the director is asked:

- **Success chance** = 0.5 + role (strong +0.15, weak −0.07) − difficulty × 0.003 + the tag's related
  stat vs 50 + approach + sacrifice − overload (0.05 per extra action crammed in) + grounding (0.03 per
  reference to this incident's people/places/systems, max 2) − repetition + anomalies + synergy,
  clamped to 8–90%. Great ideas fail; terrible ones work.
- **Outcome**: critical / success / partial / failure / catastrophe. Chaos and the Intern widen the spread.
- **Interactions**: the same tag twice is *synergy*; conflicting pairs (contain vs evacuate, careful vs
  reckless, …) both happen and one ends up *sabotaged* or accidentally *helped* by a tier.
- **Life risk** by outcome, approach and sacrifice, plus **hazards** for everyone (worse when personnel
  is low, chaos high, or you did nothing).
- **Special event** (10% + 45% × chaos, max 70%) and **new problem** (15% + 25% × chaos, more when a stat is low).
- **Termination** is pre-rolled per action, so the director can narrate it honestly.

`applyStage()` then applies the **validated** result: per-action stat changes (clamped to the
outcome's envelope: a success can't hurt its main target, a catastrophe can't help it), stage caps (±30
per stat), chaos, personnel and facility changes (only with a basis in what happened), reveals, new
and resolved objectives, the special event, and termination.

## 7. The Incident Director

```ts
interface IncidentDirector {
  readonly id: string;
  resolveStage(context: DirectorContext): Promise<unknown>; // untrusted; always validated
}
```

`DirectorContext` carries the full hidden incident, the last three narrations, each action (raw text,
role, tag, approach, references, the **engine-rolled outcome**, twist, life risk, termination roll and
the allowed stat range), idle agents, hazards, interactions, the special event, the new problem and
limits. It is deep-copied, server-side only, and never sent to a client.

Expected output (every field optional; anything else is ignored):

```jsonc
{
  "actionInterpretations": [{ "actionId", "summary", "usesRole": true, "novelty": "standard|inventive|wild", "intent": "terminate" }],
  "primaryEffects":   [{ "actionId", "stat", "delta" }],   // clamped to the outcome's range
  "secondaryEffects": [{ "actionId"?, "stat", "delta" }],  // smaller side effects, either way
  "chaosEffects":     [{ "actionId"?, "delta" }],          // ±8
  "personnelEffects": [{ "npcId", "status" }],
  "facilityEffects":  [{ "system", "condition" }],
  "lifeEvents":       [{ "playerId", "reason" }],          // reasons only, for agents the engine put at risk
  "newInformation":   [{ "factId" } | { "label", "text" }], "revealEntity": true,
  "newObjectives":    [{ "text" }],
  "objectiveUpdates": [{ "objectiveId", "status" }],       // director-made objectives only
  "specialEvents":    [{ "text" }],                        // narrates the engine's event
  "threatLocation":   "location id | null",
  "narration": "…"
}
```

- `points`, `score(s)`, `winner(s)`, `lives`, `stats` are recorded as ignored and never read.
- Invalid or missing output falls back field by field (default effects, default summaries); a
  non-object, an exception, a rejection or no answer within 10 s falls back to the built-in director
  for the whole stage. A late answer is discarded.
- **Built-in director** (`MockIncidentDirector`): deterministic per stage, templates only, no network.
  It reads the engine's references to aim actions (a rescue targets the staff member you named) and
  never quotes raw responses. It reads a response as a kill attempt (`readsAsKillAttempt()`) only when
  a killing word is aimed at the entity in the same clause and isn't negated: "shoot it", "terminate
  the entity", "execute the termination protocol", "use lethal force", the entity's name; not
  "execute the evacuation plan", "kill the lights", "don't shoot it". "Execute" and "eliminate" need
  an explicit target, never just "it".
- While the entity is unknown, every director gets the breach and environment players were shown, not
  the real ones; it still gets the entity and every fact.
- **Claude director** (`claude.ts`, `MYCOB_DIRECTOR=claude` + `ANTHROPIC_API_KEY`): one call per stage
  to `claude-opus-5` through the official SDK, with the answer bound to `DIRECTOR_SCHEMA` by structured
  outputs, `effort: "low"` for speed, the system prompt cached (stages are ~90 s apart, well inside the
  5-minute cache), server-side refusal fallbacks (`fallbacks: "default"`), a 20 s timeout and no retries.
  The processing window becomes 21 s; anything slower, refused, truncated or malformed falls back to
  the built-in director for that stage. It receives the hidden incident and the agents' own words; the
  validator additionally cuts any response it quotes verbatim. **Measured (2026-09-19, two live
  4-agent games, 6 stages):** 11.6–16.4 s per stage, ~3.3k cached prompt tokens plus 2.8–3.7k input
  and 0.9–1.2k output tokens, about $0.05 per stage (~$0.16 for 3 stages, ~$0.25 for 5). No stage fell
  back and the validator dropped nothing; an unknown entity stayed hidden in all 45 views checked.
- **Opening and closing report**: a director may also implement `narrate({ kind, context })`. The
  Claude director writes a 2–3 sentence opening (added to the alert if it arrives while the alert is
  up; an unknown entity's identity is never sent) and the closing report (shown as "The final report is
  being filed…" until it arrives, and it must match the engine's ending). Both fall back to the
  template lines on any failure. A director that fails outright falls back after the 4 s minimum
  rather than the whole processing window.

## 8. Roles and lives

Eight configurable roles (`config.roles`): each has strong tags (more reliable; counts as *using the
role*), weak tags, and **role intel** only its holder's phone shows — command priorities, containment
readout, research leads, diagnostics, staff tracker, entity tracking, the incident log, or an
unverified rumor (the Intern, who also has the widest outcome spread). Roles are shuffled at the start
and **each agent keeps theirs for the whole incident**, so they can learn it and use it; there is no
trading. The only role change is reassignment after going down (below).

Everyone starts with **3 lives**. A consequence takes **at most one**, and the agent's phone says so
immediately (red alert, vibration, private narration line). At 0 an agent is **down**; next stage they
come back as one of the incident's staff (or a replacement intern) with a new role and 1 life. Nobody is
eliminated. Everyone down at once, or personnel at ≤ 5, is the *everyone dies* ending.

## 9. Scoring

Scored per stage after the vote, kept hidden, committed at the end (breakdown shown in OUTCOME):

| Component | Rule (defaults) |
|---|---|
| Participation | 8 for acting |
| Impact | +1.6 per point of team stats improved, −0.8 per point harmed, +1 per point of chaos removed; cap 45 |
| Chaos | 0.8 per chaos point caused, **only if the action changed something** (≥ 6 stat points, a twist or an interaction); cap 20 |
| Creativity | director's bounded `novelty` → 0/10/18, halved per repeat of your last tag; cap 18 per stage, 60 per game |
| Role | 2–15 by outcome, only when the role was actually used; cap 15 |
| Votes | 15 per anonymous vote; cap 45 |
| Sacrifice | 30 once per game, only if you lost a life on an action that didn't fail |
| Team | everyone: ending (contained 120 / terminated 100 / escaped 30 / everyone dies 0) + primary 50 + 20 per secondary |

Chaos Mode adds an optional flat bonus for ending a stage in high chaos.

**Where the director still has influence** (documented 2026-09-23; not yet redesigned). The engine
owns every roll, cap and formula, but these inputs come from the director (the Claude director when
enabled, otherwise the built-in one's templates and guesses):

| Director output | What it moves | Bound |
|---|---|---|
| `novelty` (standard / inventive / wild) | Creativity points | 0/10/18 per stage, halved per repeat, ≤ 60 per game |
| `usesRole` | Role points | 2–15 by the engine's outcome; ≤ 15 per stage |
| Size of `primaryEffects` / `secondaryEffects` | Hidden stats, so Impact points and whether Chaos points count | Within the rolled outcome's envelope; ±30 per stat per stage; Impact ≤ 45 per stage |
| `chaosEffects` | Chaos, so Chaos points | ±8 per action; Chaos ≤ 20 per stage |
| `intent: "terminate"` | The *terminated* ending (team score 100) | Only on an action whose engine pre-roll allows it |
| `newObjectives` / `objectiveUpdates` | Its own narrative objectives, which count as secondaries (+20 team each) | ≤ 1 new per stage; completion needs a success this stage |
| `personnelEffects` / `facilityEffects` / reveals | Staff and systems (so objectives and stats), discoveries (+information) | Each needs a mechanical basis this stage; reveal budget |

In the simulator's averages that is roughly 40% of an agent's individual points (impact, role and
creativity). The director never sets points, lives, winners, timers, roles or phases. No part of the score reads
the response text; long or keyword-stuffed responses gain nothing. The simulator (§11) checks that
careful, standard and reckless play finish within a fraction of a place of each other.

## 10. Awards

`AwardCeremony` (reusable): each agent creates one award (name ≤ 40, description ≤ 100, optional);
duplicates by normalized name and spam over the per-agent limit are refused; authors can edit and stay
anonymous. Then every agent votes **who receives each award** (not themselves, one vote per award).
Winners (ties shared) are shown and become final-debrief highlights. Awards carry no points.

## 11. Configuration and tuning

Everything in §2–§10 is a number in `config.ts`. Modes are `{ id, name, available, overrides }`;
Chaos Mode is Incident Response with a partial config override (more chaos, events, unknown entities,
the high-chaos bonus). Tests and experiments pass overrides to `createMyCobGame({ config })`.

After changing numbers, run the simulator (scripted agents, fixture canon, ~7 s for 300 games):

```bash
node scripts/mycob-sim.ts 300
```

It prints ending shares, outcome shares, lives lost per agent-stage, unknown-entity identification,
chaos by stage, good endings by classification, average placement by playstyle and average points per
component. Defaults at time of writing: contained 26% · escaped 62% · terminated 13% · everyone dies
<1%; 0.17 lives lost per agent per stage; 65% of unknown entities identified; placements careful
2.91 · standard 3.02 · reckless 2.68.

## 12. Persistence

Rooms stay in memory. At the end the game passes `details: { kind: "mycob.v1", data }` to
`ctx.finish()`; the room stores it in `game_details` (migration 6), one JSON row per game, next to the
usual `games`/`game_players` rows, `game_canon_refs` (the entity, canon personnel and canon incidents
drawn on, all at round 1) and at most one Hall of Fame moment (the most-voted move, promotable by a
moderator like any other). `PartyDb.listGameDetails("mycob.v1")` reads them back.

A game cut short — the host sends the room back to the lobby, the room is closed or abandoned, the
server shuts down or redeploys, or the game errors — is saved instead to `aborted_games` (migration
7): game id, room, reason (`RETURNED_TO_LOBBY`, `CLOSED_BY_HOST`, `ABANDONED`, `SERVER_SHUTDOWN`,
`GAME_ERROR`), times, players (uid, name, score, left), canon refs, and the same `mycob.v1` record so
far plus `aborted: { phase, stage, pendingResponses }` (the current stage's responses if they were
never processed). It never becomes a `games` row, so it doesn't count in anyone's stats, and no moment
is saved. `PartyDb.listAbortedGames(gameId?)` reads them back; no API serves either table. A hard
crash (OOM, kill -9) still loses the game in progress.

`data` holds (`canon: false`): mode, length, stages, director id, the effective config, the incident
at start and end (entity, unknown/identified stage, breach, location, problem, environment, rules,
difficulty, notes, stats, systems, personnel, objectives, facts), players (roles, current lives, lives lost, downs,
reassignments), and per stage: raw responses with analysis and rolls, interactions, special
event, new problem, director id / fallback / validation issues, interpretations, applied effects,
life losses, personnel and system changes, reveals, objectives, narration, ballots and the score
breakdown; then MVPs, the ending, totals and the awards with their ballots. This is the dataset for
tuning prompts, probabilities and balance later. Nothing learns from it automatically.

## 13. Narration and voice

Every narrator line is a `NarrationEvent { id, type, stage, text, playerId }` (types: incident_alert,
stage_transition, consequence, life_loss, discovery, objective_update, special_event, ending, award).
Views send the current beat; private lines (your life loss) only to you. On the host screen,
`public/js/games/mycob-voice.js` hands each new event, once, to a voice provider registered with
`setVoiceProvider({ speak(event) })`. None is registered: the game is text-first, and a slow or broken
provider can only skip lines, never hold up play.

## 14. Modes and extension points

| Mode | State |
|---|---|
| 🚨 Incident Response | Playable (default) |
| 🔀 Chaos Mode | Playable (config overrides) |
| 💥 You Made It Worse, 📋 Incident Report, 🎯 Choose Your Response, 🥽 CPST Field Operative | Listed as "coming later"; `available: false` |

A mode that needs more than config (a different response form, a different stage loop) adds its hooks
in `game.ts` keyed by mode id and its screens in the renderers; the incident, director, rules, awards
and persistence are shared.

Other extension points: new locations/equipment/organizations from canon (`IncidentSources`), more
entity rules and content in `content.ts`, entity-specific fields once canon stores them (add them to
`canon.ts`'s entity spec, then to a rule's `match`), a language-model director, and a voice provider.

## 15. Known limitations

- The built-in director cannot understand free text: it uses the tag, approach, outcome and which
  incident elements a response names. Narration is template-driven and repeats over many games. The
  Claude director fixes that, at a cost and with up to ~20 s of processing per stage.
- The Claude director's prompt was tuned on a few scripted test games, not real play; `claude.ts`
  holds both prompts.
- Redacted canon text is stripped before the server sees it, so the director can't use it either.
- Hidden-information scrubbing is deterministic: it catches the name, its words, ids, links and
  near-quotes, not a genuinely reworded description of an undiscovered fact.
- No per-stage feedback from players beyond votes and awards.
- Balance numbers come from simulated agents, not real playtests.
