import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createPartyServer, type PartyServer } from "../server/app.ts";
import { createAuthVerifier } from "../server/auth.ts";
import type { AuthConfig } from "../server/config.ts";
import { PartyDb } from "../server/db.ts";
import { stubCanon } from "./helpers.ts";

async function startServer(authConfig: AuthConfig) {
  const db = new PartyDb(":memory:");
  const server = createPartyServer({ db, auth: createAuthVerifier(authConfig), authConfig, canon: stubCanon() });
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  return { db, server, base };
}

const ALICE = "dev:alice:VIEWER";
const BOB = "dev:bob:CORRESPONDENT";
const MOD = "dev:boss:EXEC";

describe("REST API", () => {
  let server: PartyServer;
  let base: string;

  const call = async (method: string, path: string, token?: string, body?: unknown, rawBody?: string) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined || rawBody !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null, text };
  };

  before(async () => {
    ({ server, base } = await startServer({ mode: "dev" }));
  });
  after(() => server.close());

  it("serves public config with the installed games and security headers", async () => {
    const res = await call("GET", "/api/config");
    assert.equal(res.status, 200);
    assert.equal(res.json.auth.mode, "dev");
    assert.equal(res.json.games[0].id, "chaos");
    assert.deepEqual(res.json.contentModes, ["safe", "chaos", "custom"]);
    assert.deepEqual(res.json.promptCounts, { total: 0, safe: 0 }, "the library starts empty");
    assert.match(res.headers.get("content-security-policy")!, /script-src 'self'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  it("requires a valid login for account endpoints", async () => {
    assert.equal((await call("GET", "/api/me")).json.error, "AUTH_REQUIRED");
    const bad = await call("GET", "/api/me", "dev:forged");
    assert.equal(bad.status, 401);
    assert.equal(bad.json.error, "AUTH_FAILED");

    const me = await call("GET", "/api/me", ALICE);
    assert.equal(me.status, 200);
    assert.deepEqual(me.json, { uid: "dev-alice", displayName: "Agent LICE", role: "VIEWER", isModerator: false });
  });

  it("validates and saves display names", async () => {
    assert.equal((await call("PUT", "/api/me", ALICE, { displayName: "" })).json.error, "INVALID_NAME");
    assert.equal((await call("PUT", "/api/me", ALICE, { displayName: "x".repeat(40) })).status, 400);
    assert.equal((await call("PUT", "/api/me", ALICE, { displayName: "Alice the Cob" })).status, 200);
    assert.equal((await call("GET", "/api/me", ALICE)).json.displayName, "Alice the Cob");
  });

  it("returns empty stats and history for a new account", async () => {
    const stats = await call("GET", "/api/me/stats", BOB);
    assert.equal(stats.json.gamesPlayed, 0);
    assert.deepEqual((await call("GET", "/api/me/history", BOB)).json, []);
  });

  it("creates, edits, lists and deletes your own prompts", async () => {
    const invalid = await call("POST", "/api/prompts", ALICE, { text: "hi", category: "corn", rating: "safe" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error, "INVALID_INPUT");
    assert.match(invalid.json.message, /5–150/);
    assert.equal((await call("POST", "/api/prompts", ALICE, { text: "Valid prompt text", category: "nope", rating: "safe" })).status, 400);
    assert.equal((await call("POST", "/api/prompts", ALICE, { text: "Valid prompt text", category: "corn", rating: "spicy" })).status, 400);
    assert.equal((await call("POST", "/api/prompts", ALICE, { text: "Valid prompt text", category: "corn", rating: "safe", tags: "bad tag!" })).status, 400);

    const created = await call("POST", "/api/prompts", ALICE, { text: "The corn silo is humming ____.", category: "corn", rating: "safe", tags: "silo, Hum" });
    assert.equal(created.status, 201);
    assert.equal(created.json.status, "approved");
    assert.deepEqual(created.json.tags, ["silo", "hum"]);
    assert.equal(created.json.mine, true);
    assert.equal(created.json.author, "Alice the Cob");

    const id = created.json.id;
    const edited = await call("PATCH", `/api/prompts/${id}`, ALICE, { rating: "chaos" });
    assert.equal(edited.json.status, "pending", "edits go back through moderation");
    assert.equal((await call("GET", "/api/prompts/mine", ALICE)).json.length, 1);

    // Another user can't edit or delete it, and doesn't see moderation details.
    assert.equal((await call("PATCH", `/api/prompts/${id}`, BOB, { text: "hijacked prompt" })).status, 403);
    assert.equal((await call("DELETE", `/api/prompts/${id}`, BOB)).status, 403);

    assert.equal((await call("DELETE", `/api/prompts/${id}`, ALICE)).status, 204);
    assert.equal((await call("DELETE", `/api/prompts/${id}`, ALICE)).status, 404);
    assert.equal((await call("PATCH", `/api/prompts/abc`, ALICE, {})).status, 404);
  });

  it("hides moderation details of other people's prompts in the library", async () => {
    const created = await call("POST", "/api/prompts", ALICE, { text: "Library visible prompt", category: "science", rating: "safe" });
    const library = await call("GET", "/api/prompts/library?q=Library%20visible", BOB);
    assert.equal(library.json.length, 1);
    const entry = library.json[0];
    assert.equal(entry.id, created.json.id);
    assert.equal(entry.mine, false);
    assert.equal(entry.status, undefined);
    assert.equal(entry.openReports, undefined);
    assert.ok(!("authorUid" in entry));
  });

  it("files reports once per user", async () => {
    const created = await call("POST", "/api/prompts", ALICE, { text: "Reportable prompt here", category: "general", rating: "safe" });
    const id = created.json.id;
    assert.equal((await call("POST", `/api/prompts/${id}/report`, BOB, { reason: "unfunny" })).status, 201);
    const again = await call("POST", `/api/prompts/${id}/report`, BOB, { reason: "still unfunny" });
    assert.equal(again.json.alreadyReported, true);
    assert.equal((await call("POST", `/api/prompts/999999/report`, BOB, {})).status, 404);
    assert.equal((await call("POST", `/api/prompts/${id}/report`, BOB, { reason: "x".repeat(500) })).status, 400);
  });

  it("restricts moderation to Overseers and Execs", async () => {
    assert.equal((await call("GET", "/api/mod/prompts", ALICE)).status, 403);
    assert.equal((await call("GET", "/api/mod/prompts", BOB)).status, 403);
    assert.equal((await call("GET", "/api/mod/prompts", "dev:ov:OVERSEER")).status, 200);

    const pending = await call("POST", "/api/prompts", BOB, { text: "A chaos prompt awaiting review", category: "cosmic", rating: "chaos" });
    assert.equal(pending.json.status, "pending");
    const queue = await call("GET", "/api/mod/prompts?view=pending", MOD);
    assert.ok(queue.json.some((p: { id: number }) => p.id === pending.json.id));

    const approved = await call("PATCH", `/api/prompts/${pending.json.id}`, MOD, { status: "approved" });
    assert.equal(approved.json.status, "approved");
    assert.equal((await call("PATCH", `/api/prompts/${pending.json.id}`, MOD, { status: "vaporized" })).status, 400);
    assert.equal((await call("GET", "/api/mod/prompts?view=everything", MOD)).status, 400);
  });

  it("lets moderators manage categories, packs and settings with validation", async () => {
    assert.ok((await call("POST", "/api/mod/categories", MOD, { name: "Snacks" })).json.includes("snacks"));
    assert.equal((await call("POST", "/api/mod/categories", MOD, { name: "no spaces allowed" })).status, 400);
    assert.equal((await call("DELETE", "/api/mod/categories/general", MOD)).status, 400);
    assert.ok(!(await call("DELETE", "/api/mod/categories/snacks", MOD)).json.includes("snacks"));

    const pack = await call("POST", "/api/mod/packs", MOD, { name: "Friday Night", description: "Late-night nonsense" });
    assert.equal(pack.status, 201);
    assert.equal((await call("POST", "/api/mod/packs", MOD, { name: "Friday Night" })).status, 400);
    const disabled = await call("PATCH", `/api/mod/packs/${pack.json.id}`, MOD, { enabled: false });
    assert.equal(disabled.json.enabled, false);

    assert.equal((await call("PUT", "/api/mod/settings", MOD, { reportThreshold: -1 })).status, 400);
    assert.equal((await call("PUT", "/api/mod/settings", MOD, { moderationPolicy: "yolo" })).status, 400);
    assert.deepEqual((await call("PUT", "/api/mod/settings", MOD, { moderationPolicy: "all", reportThreshold: 3 })).json, {
      moderationPolicy: "all",
      reportThreshold: 3,
    });
  });

  it("returns safe errors for malformed input and unknown routes", async () => {
    const malformed = await call("POST", "/api/prompts", ALICE, undefined, "{not json");
    assert.equal(malformed.status, 400);
    assert.deepEqual(Object.keys(malformed.json).sort(), ["error", "message", "ok"]);
    assert.ok(!malformed.text.includes("SyntaxError") && !malformed.text.includes(" at "));

    const huge = await call("POST", "/api/prompts", ALICE, undefined, JSON.stringify({ text: "x".repeat(50_000) }));
    assert.equal(huge.status, 400);
    assert.equal((await call("GET", "/api/nope")).json.error, "NOT_FOUND");

    const page404 = await fetch(`${base}/no/such/page`);
    assert.equal(page404.status, 404);
    assert.match(await page404.text(), /FILE NOT FOUND/);
    // Path traversal attempts never escape public/.
    const traversal = await fetch(`${base}/..%2fserver%2fdb.ts`);
    assert.equal(traversal.status, 404);
    assert.ok(!(await traversal.text()).includes("CREATE TABLE"));
  });
});

describe("REST API with accounts disabled", () => {
  it("reports accounts as disabled but still serves config", async () => {
    const { server, base } = await startServer({ mode: "none" });
    try {
      const config = (await (await fetch(`${base}/api/config`)).json()) as { auth: { mode: string } };
      assert.equal(config.auth.mode, "none");
      const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${ALICE}` } });
      assert.equal(((await me.json()) as { error: string }).error, "AUTH_DISABLED");
    } finally {
      await server.close();
    }
  });
});

describe("REST API: Hall of Fame and promotion", () => {
  let server: PartyServer;
  let base: string;
  let db: PartyDb;

  const VIEWER = "dev:ann:VIEWER";
  const OVERSEER = "dev:ovi:OVERSEER";

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  };

  before(async () => {
    ({ server, base, db } = await startServer({ mode: "dev" }));
    db.recordGame({
      gameId: "chaos",
      roomCode: "BCDF",
      rounds: 1,
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
      players: [],
      moments: [
        { text: "mine", context: "incident one", authorUid: "dev-ann", authorName: "Ann", votes: 2, votesPossible: 2 },
        { text: "theirs", context: "incident two", authorUid: "dev-bo", authorName: "Bo", votes: 1, votesPossible: 2 },
        { text: "already canon", context: "incident three", authorUid: null, authorName: "Cy", votes: 1, votesPossible: 3 },
      ],
    });
    // CPE-001 is in the stub canon, so this moment gets a deep link to its record.
    db.markMomentPromoted(3, "CPE-001");
  });
  after(() => server.close());

  const texts = async (token: string) =>
    (await call("GET", "/api/moments", token)).json.moments.map((m: { text: string }) => m.text);

  it("requires a login to browse", async () => {
    const res = await call("GET", "/api/moments");
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "AUTH_REQUIRED");
  });

  it("shows agents the Hall of Fame without authors' uids or moderation state", async () => {
    const res = await call("GET", "/api/moments", VIEWER);
    assert.equal(res.status, 200);

    const mine = res.json.moments.find((m: { text: string }) => m.text === "mine");
    assert.equal(mine.mine, true, "an agent's own reports are marked");
    assert.equal(mine.authorName, "Ann");
    assert.equal(mine.context, "incident one");
    assert.deepEqual([mine.votes, mine.votesPossible], [2, 2]);
    assert.equal("authorUid" in mine, false);
    assert.equal("status" in mine, false);
    assert.equal("promotionStartedAt" in mine, false);

    assert.equal(res.json.moments.find((m: { text: string }) => m.text === "theirs").mine, false);
  });

  it("links a canon moment to its record", async () => {
    const res = await call("GET", "/api/moments", VIEWER);
    const canon = res.json.moments.find((m: { text: string }) => m.text === "already canon");
    assert.equal(canon.canonRef, "CPE-001");
    assert.match(canon.canonUrl, /^https:\/\/example\.test\//);
  });

  it("sorts by the share of the board, or by recency", async () => {
    assert.deepEqual(await texts(VIEWER), ["mine", "theirs", "already canon"]);
    assert.equal((await call("GET", "/api/moments?sort=recent", VIEWER)).status, 200);
    assert.equal((await call("GET", "/api/moments?offset=-5", VIEWER)).status, 200, "bad paging is clamped, not an error");
  });

  it("only lets moderators hide moments, and hidden ones leave the public list", async () => {
    assert.equal((await call("PATCH", "/api/mod/moments/2", VIEWER, { status: "hidden" })).status, 403);
    assert.equal((await call("PATCH", "/api/mod/moments/2", OVERSEER, { status: "deleted" })).status, 400);

    const hidden = await call("PATCH", "/api/mod/moments/2", OVERSEER, { status: "hidden" });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.json.moment.status, "hidden");

    assert.ok(!(await texts(VIEWER)).includes("theirs"));
    assert.ok((await texts(OVERSEER)).includes("theirs"), "moderators still see it, to bring it back");

    await call("PATCH", "/api/mod/moments/2", OVERSEER, { status: "visible" });
    assert.ok((await texts(VIEWER)).includes("theirs"));
  });

  it("only lets moderators start a promotion", async () => {
    assert.equal((await call("POST", "/api/mod/moments/1/promote", VIEWER)).status, 403);
  });

  it("hands a moderator a prefilled Records Division link without making anything canon", async () => {
    const res = await call("POST", "/api/mod/moments/1/promote", OVERSEER);
    assert.equal(res.status, 200);

    const url = new URL(res.json.url);
    assert.equal(url.pathname, "/corn.planet/records.html");
    assert.equal(url.searchParams.get("promote"), "cpp-moment-1");
    assert.equal(url.searchParams.get("resolution"), "mine");
    assert.equal(url.searchParams.get("summary"), "incident one");

    assert.ok(res.json.moment.promotionStartedAt, "the Hall of Fame shows the promotion is under way");
    assert.equal(res.json.moment.canonRef, null, "only a filed record makes it canon");
    assert.equal(db.getMoment(1)!.canonRef, null);
  });

  it("refuses to promote a moment that is hidden, already canon, or missing", async () => {
    await call("PATCH", "/api/mod/moments/2", OVERSEER, { status: "hidden" });
    const hidden = await call("POST", "/api/mod/moments/2/promote", OVERSEER);
    assert.equal(hidden.status, 400);
    assert.match(hidden.json.message, /Unhide/);
    await call("PATCH", "/api/mod/moments/2", OVERSEER, { status: "visible" });

    const canon = await call("POST", "/api/mod/moments/3/promote", OVERSEER);
    assert.equal(canon.status, 400);
    assert.match(canon.json.message, /already canon as CPE-001/);

    assert.equal((await call("POST", "/api/mod/moments/999/promote", OVERSEER)).status, 404);
    assert.equal((await call("POST", "/api/mod/moments/abc/promote", OVERSEER)).status, 404);
  });
});
