# Canon and generated content

The CPI Database is the source of truth for the Corn Planet Institution. Corn Planet Party reads
from it and never writes to it. This document is the rule everything else follows.

## 1. The two kinds of content

| | **Canon** | **Generated content** |
|---|---|---|
| Lives in | Firestore, in the CPI Database | A room in memory, and a game's history in SQLite |
| Examples | `CPE-002` exists; it is classified `EARTHLY`; its containment procedure is "Give him steam deck." | A fabricated Corn or Shit claim; a Cornlashing incident report; a player's answer; a score |
| Who can create it | CPI Correspondent and above, in the Records Division | Anyone in a game session |
| Is it true in the fiction? | Yes | No, unless an administrator deliberately makes it so |
| Can Corn Planet Party write it? | **Never** | Yes, to its own SQLite database |

**Generated content is never canon.** Not when it is funny, not when everyone voted for it, not
when it sounds exactly like a real record. The only way something becomes canon is a person
creating a record in the Records Division on the database site.

## 2. Why the server never writes to Firebase

The CPI Database enforces who may write through Firestore security rules, which live in the Firebase
console. `firestore.rules` in the repo root is a copy of them (taken 2026-09-17); nothing deploys it,
so keep it in step with the console by hand. Those rules let CPI Correspondents and above write
canon, and nobody else.

If the party server could write to Firestore, every player in a session — including guests with no
CPI account — would effectively be writing canon through it. So it does not. `server/canon.ts`
contains no write path at all, and `server/auth.ts` only ever reads `users/{uid}` to find a
player's role.

## 3. How games read canon

```
CPI Database (Firestore)          world-readable collections
        │                          entities · incidents · personnel
        ▼
server/canon.ts                   CanonService: fetch, cache, strip redactions
        │
        ▼
GameContext.canon                 list / sample / get / used
        │
        ▼
a game                            Corn or Shit, and whatever comes next
```

`CanonService` keeps a warm in-memory snapshot, refreshed by `main.ts` at startup and every ten
minutes. Reads are synchronous because a game's `start()` and `viewFor()` are synchronous.

Three deliberate behaviours:

- **Redactions are removed, never revealed.** The database site hides text behind `/r…/r`,
  `/r!…/r!` and `/r!!…/r!!` markers by clearance. The party server is public, so canon.ts replaces
  those spans with `[REDACTED]`, `[CLASSIFIED]` and `[COSMIC ERASED]` rather than showing what is
  inside. `isRedacted()` lets a game skip a field that is still hiding something.
- **Collections fail independently.** One unreadable collection never discards the ones that
  loaded. Today `incidents` and `personnel` return 403 until their Firestore rules are applied, and
  games run on `entities` regardless.
- **A failed refresh keeps the last good snapshot.** Firestore trouble costs a game variety, not
  the round in progress.

Reads carry no token. The canon collections are world-readable, which is what lets a guest with no
CPI account play a canon-driven game.

## 4. Record types

| Kind | IDs | Collection | Detail page |
|---|---|---|---|
| Entity | `CPE-001`… | `entities` | `entry.html` |
| Artifact | `ART-001`… | `artifacts` | `artifact-entry.html` |
| Incident | `INC-001`… | `incidents` | `incident-entry.html` |
| Personnel | `PER-001`… | `personnel` | `personnel-entry.html` |

`CPE-###` ids are load-bearing in live Firestore data and **must never be renamed**.

Artifacts are intentionally not in `canon.ts`: the collection is empty, so fetching it would cost a
request per refresh for nothing. Add a spec to `COLLECTIONS` once it has content.

### Adding a new record type

1. Add a `match` block for the collection to `firestore.rules` (copy the `incidents` block) and
   **publish it in the Firebase console**, or every read and write will be denied.
2. Add a creation form to `records.html` (follow the incident/personnel panels).
3. Add a listing page and a detail page. The detail page should be a thin spec over
   `record-view.js` rather than another copy of `artifact-entry.html`.
4. Add a `CollectionSpec` to `COLLECTIONS` in `server/canon.ts`, listing the fields games may quote.
5. Add claim templates to `TEMPLATES` in `server/games/claims.ts` if the type should appear in Corn
   or Shit. Fields with no template are never used, so this step is opt-in.

## 5. How generated content is produced

Corn or Shit needs a believable false claim. It builds one **by template**, not with a language
model: take a real field value from one canon record and attribute it to another record of the same
kind (`server/games/claims.ts`).

This is deliberate. It costs nothing, needs no API key, runs offline, is deterministic under a
seeded random in tests, and is in-universe by construction — every fabrication is made of real CPI
Database prose, just attached to the wrong record.

Its guarantees:

- The borrowed value is compared against the real one, so **the lie can never accidentally be
  true**.
- Values are only ever moved between records of the **same kind**.
- Redacted fields are skipped entirely.
- A field with no template is never used.
- When no honest pair can be built, it returns `null` and the caller picks a different record. It
  never invents text of its own.

If an AI generator is ever added, the same rule applies: canon may be used as context, and the
output is still generated content.

## 6. Recording which canon a round used

`GameContext.canon.used(round, ref)` notes that a round was built from a canon record. Those rows
go to `game_canon_refs` when the game finishes:

```sql
CREATE TABLE game_canon_refs (
  game_row_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round       INTEGER NOT NULL,
  ref         TEXT    NOT NULL
);
```

`used()` checks the ref against the loaded snapshot first, so **only ids that exist in the CPI
Database are ever recorded**. Nothing a game generated can end up in this table.

`PartyDb.canonUsage()` reports how often each record has been used.

Note what is *not* recorded: in Corn or Shit, the record that lent its value to the fabrication (the
"donor") is shown at the reveal but is not stored as a source of the round, because it was not what
the round was about.

## 7. Showing a reference to players

Every `CanonRecord` carries a `url` pointing at its page on the CPI Database site
(`CPI_DATABASE_URL`, default `https://jj2sly.github.io/corn.planet`). Games show the `ref` on the
host screen and a tappable link on phones, so anyone can go and check the record after a round.

Do not show a reference before the round's rules allow it — in Corn or Shit the reference is part
of the reveal, because naming the record early would give the answer away.

## 8. The Hall of Fame, and promoting a moment to canon

Games keep memorable moments through `ctx.saveMoment()`. They are saved with the game's history in
the `moments` table and listed at `/hall`. Cornlashing saves the report(s) the review board accepted
for each incident (not default rulings). Corn or Shit deliberately saves nothing: its best line is a
fabrication about a real record, and making that canon would contradict the record it lied about.

A moment is generated content. Promoting one works like this:

```
a moderator presses "Promote to canon" in the Hall of Fame           (party server)
        ↓
POST /api/mod/moments/:id/promote → a Records Division link, prefilled:
  records.html?promote=cpp-moment-42&title=…&summary=…&resolution=…&addendum=…
        ↓
records.html parks it in sessionStorage (it survives the login detour),     (CPI Database site)
then fills the incident form: the prompt as the incident, the report as its resolution
        ↓
a person reviews it, writes the incident report, and presses Create Incident
        ↓
the incident is filed with  promotedFrom: "cpp-moment-42"                  (Firestore)
        ↓
the next canon refresh sees the marker; reconcilePromotions() sets         (party server)
moments.canon_ref = "INC-007", and the Hall of Fame shows it as canon
```

Why it is built this way:

- **The party server still never writes to Firebase.** Promotion ends with a person filing the record
  under their own account and their own Firestore permissions (Correspondent and above).
- **A moment is only ever shown as canon once the record really exists.** "Promote" only marks a
  promotion as *started*; `canon_ref` is set from what the server reads back from the CPI Database.
- **Nothing is promoted automatically, ever.** No vote count, rating or timer makes something canon.
- The first record filed for a moment wins if it is filed twice. Hidden moments can't be promoted.

Allow up to 10 minutes (one canon refresh) between filing the record and the Hall of Fame showing it.

## 9. Checklist for a new canon-driven game

- [ ] Read canon only through `ctx.canon`; never fetch Firestore from a game.
- [ ] Cope with an empty or small canon — refuse to start (`NO_CANON`) or finish early, rather than
      showing a broken round.
- [ ] Skip redacted fields when quoting canon.
- [ ] Call `ctx.canon.used(round, ref)` for the record a round was actually about.
- [ ] Label generated content as generated wherever a player sees it.
- [ ] Keep the reference out of `viewFor` until the round's rules allow it, and add a test that
      serializes every view during the secret phase and asserts nothing leaks.
