import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { checkRows, defaultRows, SOUND_SCOPES } from "../public/js/sound-catalog.js";
import { chooseSound, CUES, hasTone, setSoundScope } from "../public/js/games/mycob-sound.js";
import { createPartyServer, type PartyServer } from "../server/app.ts";
import { createAuthVerifier } from "../server/auth.ts";
import { PartyDb } from "../server/db.ts";
import { createSoundService, soundFiles, soundManifest } from "../server/sounds.ts";
import { stubCanon } from "./helpers.ts";

const MOD = "dev:boss:EXEC";
const PLAYER = "dev:alice:VIEWER";
const files = soundFiles();
const manifest = soundManifest();

describe("sound catalog", () => {
  it("gives every game a sound (or tone) for every trigger it uses, from the real sounds.json", () => {
    for (const [id, scope] of Object.entries(SOUND_SCOPES)) {
      const rows = defaultRows(id, manifest);
      for (const tag of scope.tags) assert.ok(rows.some((r) => r.tag === tag), `${id} has ${tag}`);
      for (const r of rows) if (r.source.startsWith("file:")) assert.ok(files.has(r.source.slice(5)), `${r.source} exists`);
      assert.equal(typeof checkRows(id, rows, files), "object", `${id} defaults pass their own checks`);
    }
    // Game-specific tags start from their base tag's sounds.
    const bc = defaultRows("budgetcuts", manifest);
    assert.ok(bc.some((r) => r.tag === "budget_approved" && r.source === "file:outcomes/correct.mp3"));
    assert.equal(bc.filter((r) => r.tag === "incident_failed").length, 3, "a list in sounds.json becomes several rows, one picked at random");
    for (const tag of Object.values(SOUND_SCOPES).flatMap((s) => s.tags)) assert.ok(CUES.includes(tag), `${tag} is a known cue`);
    assert.ok(hasTone("budget_approved"), "new tags fall back to their base tone");
  });

  it("rejects triggers a game doesn't use, missing files and path tricks", () => {
    const row = { id: "x", source: "file:outcomes/correct.mp3", tag: "success", enabled: true, volume: 1 };
    assert.match(String(checkRows("channelcob", [row], files)), /isn't a trigger/);
    assert.match(String(checkRows("thud", [{ ...row, source: "file:nope.mp3" }], files)), /No sound file/);
    assert.match(String(checkRows("thud", [{ ...row, source: "file:../../server/db.ts" }], files)), /No sound file/);
    assert.match(String(checkRows("thud", [row, row], files)), /own id/);
    assert.equal(typeof checkRows("thud", [row], files), "object");
  });
});

describe("sound settings storage", () => {
  it("persists across a restart, keeps games apart, and drops a deleted file silently", () => {
    const dir = mkdtempSync(join(tmpdir(), "cpp-sounds-"));
    try {
      mkdirSync(join(dir, "sfx"));
      writeFileSync(join(dir, "sfx", "a.mp3"), "x");
      writeFileSync(join(dir, "sfx", "b.mp3"), "x");
      writeFileSync(join(dir, "sounds.json"), JSON.stringify({ success: ["sfx/a.mp3"], alert: ["sfx/b.mp3"] }));
      const path = join(dir, "party.db");

      let db = new PartyDb(path);
      let svc = createSoundService(db, dir);
      const thudBefore = svc.rows("thud").rows;
      const cob = svc.rows("channelcob").rows.map((r) => (r.tag === "segment_good" ? { ...r, tag: "segment_end", enabled: false } : r));
      assert.equal(typeof svc.save("channelcob", cob), "object");
      db.close();

      db = new PartyDb(path);
      svc = createSoundService(db, dir);
      const after = svc.rows("channelcob");
      assert.equal(after.customised, true);
      assert.ok(after.rows.some((r) => r.tag === "segment_end" && !r.enabled), "change survived the restart");
      assert.deepEqual(svc.rows("thud").rows, thudBefore, "Angry Thud's sounds are untouched");
      assert.equal(svc.rows("thud").customised, false);

      // The file behind a saved row is deleted: that row drops out, the rest still play.
      rmSync(join(dir, "sfx", "a.mp3"));
      const kept = createSoundService(db, dir).rows("channelcob");
      assert.ok(kept.customised);
      assert.ok(!kept.rows.some((r) => r.source === "file:sfx/a.mp3"));

      svc.reset("channelcob");
      assert.equal(svc.rows("channelcob").customised, false);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sound moderation API", () => {
  let server: PartyServer;
  let base: string;
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  };
  before(async () => {
    server = createPartyServer({ db: new PartyDb(":memory:"), auth: createAuthVerifier({ mode: "dev" }), authConfig: { mode: "dev" }, canon: stubCanon() });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  it("lists the registry's sound-using games and the GLOBAL menus", async () => {
    const res = await call("GET", "/api/mod/sounds", MOD);
    assert.equal(res.status, 200);
    const ids = res.json.scopes.map((s: { id: string }) => s.id);
    for (const id of ["lobby", "mycob", "steamdeck", "thud", "budgetcuts", "channelcob"]) assert.ok(ids.includes(id), id);
    assert.ok(!ids.includes("chaos"), "games without sounds aren't listed");
    assert.equal(res.json.scopes.find((s: { id: string }) => s.id === "lobby").global, true);
    assert.ok(res.json.files.includes("outcomes/correct.mp3"));
  });

  it("only moderators can change sounds; players read the result", async () => {
    const current = (await call("GET", "/api/sounds/budgetcuts")).json;
    assert.equal(current.customised, false);
    const next = current.rows.map((r: { tag: string }) => (r.tag === "budget_approved" ? { ...r, tag: "final_results" } : r));
    assert.equal((await call("PUT", "/api/mod/sounds/budgetcuts", PLAYER, { rows: next })).status, 403);
    assert.equal((await call("PUT", "/api/mod/sounds/budgetcuts", undefined, { rows: next })).status, 401);
    assert.equal((await call("PUT", "/api/mod/sounds/budgetcuts", MOD, { rows: [{ ...next[0], tag: "made_up" }] })).status, 400);
    const saved = await call("PUT", "/api/mod/sounds/budgetcuts", MOD, { rows: next });
    assert.equal(saved.status, 200);
    const pub = (await call("GET", "/api/sounds/budgetcuts")).json;
    assert.equal(pub.customised, true);
    assert.ok(!pub.rows.some((r: { tag: string }) => r.tag === "budget_approved"));
    assert.equal((await call("DELETE", "/api/mod/sounds/budgetcuts", MOD)).json.customised, false);
    assert.equal((await call("GET", "/api/sounds/nope")).status, 404);
  });
});

describe("sound playback choices", () => {
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
    setSoundScope(null);
  });

  it("plays the game's own list: retagged, disabled and missing sounds behave", async () => {
    const rows = [
      { id: "1", source: "file:outcomes/correct.mp3", tag: "segment_end", enabled: true, volume: 0.5 },
      { id: "2", source: "file:outcomes/fahhh.mp3", tag: "segment_bad", enabled: false, volume: 1 },
      { id: "3", source: "synth:alert", tag: "breaking_news", enabled: true, volume: 1 },
    ];
    globalThis.fetch = (async (url: string) => (String(url).startsWith("/api/sounds/channelcob") ? new Response(JSON.stringify({ rows })) : new Response("", { status: 404 }))) as typeof fetch;
    setSoundScope("channelcob");
    assert.deepEqual(await chooseSound("segment_end"), { url: "/sounds/mycob/outcomes/correct.mp3", volume: 0.5 }, "retagged sound is used");
    assert.equal(await chooseSound("segment_bad"), null, "disabled: silent");
    assert.equal(await chooseSound("final_results"), null, "no sounds left on a tag: silent");
    assert.deepEqual(await chooseSound("breaking_news"), { synth: "alert", volume: 1 });
    assert.equal(await chooseSound("thud_boom"), undefined, "tags outside this game use the defaults");

    // The list can't be loaded: everything falls back to the defaults, nothing throws.
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    setSoundScope("budgetcuts");
    assert.equal(await chooseSound("budget_approved"), undefined);
  });
});
