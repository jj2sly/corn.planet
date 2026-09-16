import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PartyDb } from "../server/db.ts";
import { SEED_PROMPTS } from "../server/seed.ts";

const input = (text: string, rating: "safe" | "chaos" = "safe") => ({ text, category: "corn", tags: ["kernel"], rating });

describe("database: seeding and migrations", () => {
  it("seeds the Standard Issue pack once, even across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "cpst-party-"));
    try {
      const path = join(dir, "party.db");
      new PartyDb(path).close();
      const db = new PartyDb(path);
      const packs = db.listPacks();
      assert.equal(packs.length, 1);
      assert.equal(packs[0]!.promptCount, SEED_PROMPTS.length);
      assert.ok(db.listCategories().includes("general"));
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
    const pending = db.createPrompt("u1", input("Pending chaos", "chaos"));
    const pack = db.listPacks()[0]!;
    db.updatePack(pack.id, { enabled: false });
    const picked = db.pickPrompts("chaos", 500, new Set());
    assert.equal(picked.length, 0, "built-ins are in the disabled pack; the only community prompt is pending");

    db.updatePromptAsModerator(pending.id, { status: "approved" });
    assert.deepEqual(db.pickPrompts("chaos", 500, new Set()).map((p) => p.id), [pending.id]);
    assert.deepEqual(db.pickPrompts("safe", 500, new Set()), [], "chaos-rated prompts never appear in safe mode");
  });

  it("prefers the group's own prompts in custom mode and tops up with built-ins", () => {
    const db = new PartyDb(":memory:");
    const own = [db.createPrompt("u1", input("Our prompt one")), db.createPrompt("u2", input("Our prompt two"))];
    const picked = db.pickPrompts("custom", 5, new Set());
    assert.equal(picked.length, 5);
    assert.deepEqual(new Set(picked.slice(0, 2).map((p) => p.id)), new Set(own.map((p) => p.id)));
    assert.equal(new Set(picked.map((p) => p.id)).size, 5, "no duplicates");
    assert.equal(db.pickPrompts("chaos", 3, new Set(picked.map((p) => p.id!))).filter((p) => picked.some((x) => x.id === p.id)).length, 0);
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
