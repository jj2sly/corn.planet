import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PartyDb } from "../server/db.ts";

const input = (text: string, rating: "safe" | "chaos" = "safe") => ({ text, category: "corn", tags: ["kernel"], rating });

describe("database: seeding and migrations", () => {
  it("starts with an empty prompt library and the default categories", () => {
    const db = new PartyDb(":memory:");
    assert.deepEqual(db.listPacks(), []);
    assert.deepEqual(db.countPlayablePrompts(), { total: 0, safe: 0 });
    assert.ok(db.listCategories().includes("general"));
  });

  it("clears the old library once when upgrading, and never touches prompts added afterwards", () => {
    const dir = mkdtempSync(join(tmpdir(), "cpst-party-"));
    try {
      const path = join(dir, "party.db");
      // Recreate a version-1 database that still has the old built-in pack and a reported prompt.
      let db = new PartyDb(path);
      const pack = db.createPack("Standard Issue", "old built-ins")!;
      const old = db.createPrompt("u1", input("An old prompt"));
      db.updatePromptAsModerator(old.id, { packId: pack.id });
      db.reportPrompt(old.id, "u2", "meh");
      db.createPack("Friday Night", "kept");
      db.close();
      const raw = new DatabaseSync(path);
      raw.exec("PRAGMA user_version = 1");
      raw.close();

      db = new PartyDb(path);
      assert.deepEqual(db.countPlayablePrompts(), { total: 0, safe: 0 });
      assert.deepEqual(db.listPacks().map((p) => p.name), ["Friday Night"]);
      const fresh = db.createPrompt("u1", input("A brand new prompt"));
      db.close();

      db = new PartyDb(path);
      assert.equal(db.getPrompt(fresh.id)?.text, "A brand new prompt", "the cleanup only runs once");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("database: prompts and moderation policy", () => {
  it("auto-approves safe prompts and holds chaos prompts under the default policy", () => {
    const db = new PartyDb(":memory:");
    assert.equal(db.createPrompt("u1", input("A perfectly safe prompt")).status, "approved");
    assert.equal(db.createPrompt("u1", input("A spicy chaos prompt", "chaos")).status, "pending");

    db.updateSettings({ moderationPolicy: "none" });
    assert.equal(db.createPrompt("u1", input("Needs review now")).status, "pending");
    db.updateSettings({ moderationPolicy: "all" });
    assert.equal(db.createPrompt("u1", input("Anything goes", "chaos")).status, "approved");
  });

  it("sends author edits back through moderation and never self-re-enables disabled prompts", () => {
    const db = new PartyDb(":memory:");
    const prompt = db.createPrompt("u1", input("Original safe text"));
    assert.equal(db.updatePromptAsAuthor(prompt.id, input("Now it is chaos", "chaos")).status, "pending");

    db.updatePromptAsModerator(prompt.id, { status: "disabled" });
    assert.equal(db.updatePromptAsAuthor(prompt.id, input("Pretty please, safe")).status, "pending");
  });

  it("only offers approved prompts from enabled packs to games", () => {
    const db = new PartyDb(":memory:");
    const pack = db.createPack("Friday Night", "")!;
    const packed = db.createPrompt("u1", input("A prompt in a pack"));
    db.updatePromptAsModerator(packed.id, { packId: pack.id });
    const pending = db.createPrompt("u1", input("Pending chaos", "chaos"));
    db.updatePack(pack.id, { enabled: false });
    assert.equal(db.pickPrompts("chaos", 500, new Set()).length, 0, "the pack is disabled and the other prompt is pending");
    assert.deepEqual(db.countPlayablePrompts(), { total: 0, safe: 0 });

    db.updatePromptAsModerator(pending.id, { status: "approved" });
    assert.deepEqual(db.pickPrompts("chaos", 500, new Set()).map((p) => p.id), [pending.id]);
    assert.deepEqual(db.pickPrompts("safe", 500, new Set()), [], "chaos-rated prompts never appear in safe mode");
    assert.deepEqual(db.countPlayablePrompts(), { total: 1, safe: 0 });
  });

  it("picks random prompts without duplicates and respects exclusions", () => {
    const db = new PartyDb(":memory:");
    const own = Array.from({ length: 6 }, (_, i) => db.createPrompt(`u${i}`, input(`Group prompt number ${i}`)));
    const picked = db.pickPrompts("custom", 4, new Set());
    assert.equal(picked.length, 4);
    assert.equal(new Set(picked.map((p) => p.id)).size, 4, "no duplicates");
    const rest = db.pickPrompts("chaos", 10, new Set(picked.map((p) => p.id!)));
    assert.equal(rest.length, 2);
    assert.ok(rest.every((p) => !picked.some((x) => x.id === p.id)));
    assert.equal(own.length, 6);
  });

  it("disables a prompt automatically at the report threshold, once per reporter", () => {
    const db = new PartyDb(":memory:");
    const prompt = db.createPrompt("author", input("Report me maybe"));
    assert.deepEqual(db.reportPrompt(prompt.id, "r1", "not funny"), { created: true, autoDisabled: false });
    assert.deepEqual(db.reportPrompt(prompt.id, "r1", "again"), { created: false, autoDisabled: false });
    assert.deepEqual(db.reportPrompt(prompt.id, "r2", ""), { created: true, autoDisabled: true });
    assert.equal(db.getPrompt(prompt.id)!.status, "disabled");
    assert.deepEqual(db.listForModeration("reported").map((p) => p.id), [prompt.id]);

    // Re-approving is the review: open reports are resolved.
    db.updatePromptAsModerator(prompt.id, { status: "approved" });
    assert.equal(db.getPrompt(prompt.id)!.openReports, 0);
    assert.equal(db.listReports(prompt.id).length, 2);
  });

  it("moves prompts to general when their category is deleted", () => {
    const db = new PartyDb(":memory:");
    db.addCategory("temp");
    const prompt = db.createPrompt("u1", { ...input("Temporary category"), category: "temp" });
    assert.equal(db.deleteCategory("temp"), true);
    assert.equal(db.getPrompt(prompt.id)!.category, "general");
    assert.equal(db.deleteCategory("general"), false);
  });

  it("escapes LIKE wildcards in library search", () => {
    const db = new PartyDb(":memory:");
    db.createPrompt("u1", input("100% corn guaranteed"));
    assert.equal(db.listLibrary({ search: "100%", limit: 50, offset: 0 }).length, 1);
    assert.equal(db.listLibrary({ search: "%", limit: 50, offset: 0 }).length, 1);
    // Unescaped, "_" would match any character and "c_rn" would find every corn prompt.
    assert.equal(db.listLibrary({ search: "c_rn", limit: 50, offset: 0 }).length, 0);
  });
});

describe("database: statistics", () => {
  it("aggregates stats, wins, favorite categories and prompt usage for one user only", () => {
    const db = new PartyDb(":memory:");
    const prompt = db.createPrompt("u1", input("My own creation"));
    db.incrementUsage([prompt.id, prompt.id]);

    const game = (scores: [string | null, number, number][]) => ({
      gameId: "chaos",
      roomCode: "BCDF",
      rounds: 2,
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
      players: scores.map(([uid, score, placement]) => ({
        uid,
        name: uid ?? "guest",
        score,
        placement,
        stats: { answersSubmitted: 4, votesCast: 3, votesReceived: 2, roundsPlayed: 2, "category:corn": 3, "category:cosmic": 1 },
      })),
    });
    db.recordGame(game([["u1", 900, 1], ["u2", 400, 2], [null, 100, 3]]));
    db.recordGame(game([["u2", 900, 1], ["u1", 400, 2]]));

    const stats = db.getUserStats("u1");
    assert.equal(stats.gamesPlayed, 2);
    assert.equal(stats.wins, 1);
    assert.equal(stats.bestPlacement, 1);
    assert.equal(stats.totalPoints, 1300);
    assert.equal(stats.answersSubmitted, 8);
    assert.equal(stats.promptsCreated, 1);
    assert.equal(stats.promptUses, 2);
    assert.deepEqual(stats.favoriteCategories, [{ category: "corn", count: 6 }, { category: "cosmic", count: 2 }]);

    assert.equal(db.getUserHistory("u1").length, 2);
    assert.equal(db.getUserStats("nobody").gamesPlayed, 0);
  });
});

describe("database: canon references", () => {
  const game = (canonRefs?: { round: number; ref: string }[]) => ({
    gameId: "cornorshit",
    roomCode: "BCDF",
    rounds: 2,
    startedAt: Date.now() - 60_000,
    endedAt: Date.now(),
    players: [{ uid: "u1", name: "u1", score: 100, placement: 1, stats: {} }],
    canonRefs,
  });

  it("records which canon a game drew on, and counts repeat use", () => {
    const db = new PartyDb(":memory:");

    db.recordGame(game([{ round: 1, ref: "CPE-002" }, { round: 2, ref: "CPE-004" }]));
    db.recordGame(game([{ round: 1, ref: "CPE-002" }]));

    assert.deepEqual(db.canonUsage(), [
      { ref: "CPE-002", uses: 2 },
      { ref: "CPE-004", uses: 1 },
    ]);
  });

  it("copes with games that used no canon at all", () => {
    const db = new PartyDb(":memory:");

    db.recordGame(game());
    db.recordGame(game([]));

    assert.deepEqual(db.canonUsage(), []);
  });

  it("drops a game's canon references when the game row goes", () => {
    const db = new PartyDb(":memory:");
    db.recordGame(game([{ round: 1, ref: "CPE-002" }]));

    const raw = db as unknown as { db: { exec(sql: string): void } };
    raw.db.exec("DELETE FROM games");

    assert.deepEqual(db.canonUsage(), [], "the ON DELETE CASCADE must reach game_canon_refs");
  });
});

describe("database: Hall of Fame moments", () => {
  const moment = (text: string, votes: number, votesPossible: number) => ({
    text,
    context: `Incident for ${text}`,
    authorUid: text === "mine" ? "u1" : null,
    authorName: `Author of ${text}`,
    votes,
    votesPossible,
  });

  function withMoments(...moments: ReturnType<typeof moment>[]) {
    const db = new PartyDb(":memory:");
    db.recordGame({
      gameId: "chaos",
      roomCode: "BCDF",
      rounds: 1,
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
      players: [{ uid: "u1", name: "u1", score: 100, placement: 1, stats: {} }],
      moments,
    });
    return db;
  }

  const list = (db: PartyDb, sort: "top" | "recent" = "top", includeHidden = false) =>
    db.listMoments({ includeHidden, sort, limit: 50, offset: 0 });

  it("saves moments with their game, visible and not yet canon", () => {
    const db = withMoments(moment("mine", 2, 2));
    const [saved] = list(db);

    assert.equal(saved!.text, "mine");
    assert.equal(saved!.context, "Incident for mine");
    assert.equal(saved!.authorUid, "u1");
    assert.equal(saved!.gameId, "chaos");
    assert.equal(saved!.status, "visible");
    assert.equal(saved!.canonRef, null);
    assert.equal(saved!.promotionStartedAt, null);
  });

  it("ranks by the share of the board that backed a moment, not the raw count", () => {
    const db = withMoments(moment("three of seven", 3, 7), moment("four of four", 4, 4), moment("one of two", 1, 2));
    assert.deepEqual(
      list(db).map((m) => m.text),
      ["four of four", "one of two", "three of seven"],
    );
  });

  it("hides moments from the public list but keeps them for moderators", () => {
    const db = withMoments(moment("keep", 2, 2), moment("hide me", 2, 2));
    const target = list(db).find((m) => m.text === "hide me")!;

    assert.equal(db.setMomentStatus(target.id, "hidden")!.status, "hidden");
    assert.deepEqual(list(db).map((m) => m.text), ["keep"]);
    assert.equal(list(db, "top", true).length, 2);

    db.setMomentStatus(target.id, "visible");
    assert.equal(list(db).length, 2);
  });

  it("notes a started promotion without touching canon", () => {
    const db = withMoments(moment("promote me", 2, 2));
    const [m] = list(db);

    const started = db.startPromotion(m!.id, "mod-uid")!;
    assert.ok(started.promotionStartedAt);
    assert.equal(started.canonRef, null, "starting a promotion is not the same as it being canon");
  });

  it("marks a moment as canon once, and the first record wins", () => {
    const db = withMoments(moment("promote me", 2, 2));
    const [m] = list(db);

    assert.equal(db.markMomentPromoted(m!.id, "INC-004"), true);
    assert.equal(db.markMomentPromoted(m!.id, "INC-004"), false, "repeat reconciliation changes nothing");
    assert.equal(db.markMomentPromoted(m!.id, "INC-009"), false, "a duplicate filing doesn't steal it");
    assert.equal(db.getMoment(m!.id)!.canonRef, "INC-004");
  });

  it("ignores a promotion for a moment that doesn't exist", () => {
    const db = withMoments(moment("x", 1, 1));
    assert.equal(db.markMomentPromoted(9999, "INC-001"), false);
    assert.equal(db.getMoment(9999), null);
  });

  it("pages through long lists", () => {
    const db = withMoments(...Array.from({ length: 5 }, (_, i) => moment(`m${i}`, 1, 1)));
    const first = db.listMoments({ includeHidden: false, sort: "recent", limit: 2, offset: 0 });
    const second = db.listMoments({ includeHidden: false, sort: "recent", limit: 2, offset: 2 });
    assert.equal(first.length, 2);
    assert.equal(second.length, 2);
    assert.equal(new Set([...first, ...second].map((m) => m.id)).size, 4);
  });

  it("drops a game's moments when the game row goes", () => {
    const db = withMoments(moment("gone", 1, 1));
    (db as unknown as { db: { exec(sql: string): void } }).db.exec("DELETE FROM games");
    assert.deepEqual(list(db, "top", true), []);
  });
});

describe("database: structured game records", () => {
  const game = (gameId: string, details?: { kind: string; data: unknown }) => ({
    gameId,
    roomCode: "BCDF",
    rounds: 3,
    startedAt: Date.now() - 60_000,
    endedAt: Date.now(),
    players: [{ uid: "u1", name: "u1", score: 100, placement: 1, stats: {} }],
    ...(details ? { details } : {}),
  });

  it("stores a game's details as JSON and lists them by kind, newest first", () => {
    const db = new PartyDb(":memory:");
    db.recordGame(game("mycob", { kind: "mycob.v1", data: { ending: { id: "contained" }, stages: [1, 2, 3] } }));
    db.recordGame(game("chaos"));
    db.recordGame(game("mycob", { kind: "mycob.v1", data: { ending: { id: "escaped" }, stages: [] } }));
    const saved = db.listGameDetails("mycob.v1");
    assert.equal(saved.length, 2);
    assert.deepEqual(saved.map((d) => (d.data as { ending: { id: string } }).ending.id), ["escaped", "contained"]);
    assert.ok(saved.every((d) => d.gameId === "mycob"));
    assert.deepEqual(db.listGameDetails("other.v1"), []);
  });

  it("drops a game's details when the game row goes", () => {
    const db = new PartyDb(":memory:");
    db.recordGame(game("mycob", { kind: "mycob.v1", data: {} }));
    (db as unknown as { db: { exec(sql: string): void } }).db.exec("DELETE FROM games");
    assert.deepEqual(db.listGameDetails("mycob.v1"), []);
  });

  it("keeps games that ended without finishing apart, and adds their table to a version-6 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "cpst-party-"));
    try {
      const path = join(dir, "party.db");
      new PartyDb(path).close();
      const raw = new DatabaseSync(path);
      raw.exec("DROP TABLE aborted_games; PRAGMA user_version = 6");
      raw.close();
      const db = new PartyDb(path);
      const aborted = (reason: string, details: { kind: string; data: unknown } | null) => ({
        gameId: "mycob",
        roomCode: "BCDF",
        reason,
        startedAt: Date.now() - 60_000,
        endedAt: Date.now(),
        players: [{ uid: "u1", name: "u1", score: 0, left: false }],
        canonRefs: [{ round: 1, ref: "CPE-002" }],
        details,
      });
      db.recordAbortedGame(aborted("ABANDONED", null));
      db.recordAbortedGame(aborted("SERVER_SHUTDOWN", { kind: "mycob.v1", data: { aborted: { stage: 2 } } }));
      const saved = db.listAbortedGames("mycob");
      assert.deepEqual(saved.map((a) => a.reason), ["SERVER_SHUTDOWN", "ABANDONED"]);
      assert.deepEqual(saved[0]!.data, { aborted: { stage: 2 } });
      assert.equal(saved[1]!.data, null);
      assert.deepEqual(saved[0]!.canonRefs, [{ round: 1, ref: "CPE-002" }]);
      assert.deepEqual(db.listAbortedGames("chaos"), []);
      assert.equal(db.getUserStats("u1").gamesPlayed, 0, "never counted as a played game");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds the table to an existing version-5 database", () => {
    const dir = mkdtempSync(join(tmpdir(), "cpst-party-"));
    try {
      const path = join(dir, "party.db");
      new PartyDb(path).close();
      const raw = new DatabaseSync(path);
      raw.exec("DROP TABLE game_details; PRAGMA user_version = 5");
      raw.close();
      const db = new PartyDb(path);
      db.recordGame(game("mycob", { kind: "mycob.v1", data: { ok: true } }));
      assert.deepEqual(db.listGameDetails("mycob.v1")[0]!.data, { ok: true });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
