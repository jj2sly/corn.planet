// The desktop app's Group Night readiness panel and Corn or Shit — Solo talk to the server over
// /api/native. These run against a real HTTP server so routing order bugs (a catch-all in the
// general /api router swallowing /api/native) fail here rather than on game night.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createPartyServer, type PartyServer } from "../server/app.ts";
import { createAuthVerifier } from "../server/auth.ts";
import { PartyDb } from "../server/db.ts";
import { GAMES } from "../server/games/registry.ts";
import { TEST_CANON, stubCanon } from "./helpers.ts";

describe("native HTTP bridge used by the desktop app", () => {
  let server: PartyServer;
  let url = "";

  before(async () => {
    server = createPartyServer({
      db: new PartyDb(":memory:"),
      auth: createAuthVerifier({ mode: "none" }),
      authConfig: { mode: "none" },
      canon: stubCanon(),
    });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });

  after(() => server.close());

  it("answers health with the native protocol", async () => {
    const response = await fetch(`${url}/api/native/health`);
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean; protocol: number };
    assert.equal(body.ok, true);
    assert.ok(body.protocol > 0);
  });

  it("lists all six Group Night games", async () => {
    const response = await fetch(`${url}/api/native/games`);
    assert.equal(response.status, 200);
    const body = await response.json() as { games: { id: string }[] };
    const ids = new Set(body.games.map((game) => game.id));
    for (const id of ["chaos", "cornorshit", "entityauction", "mycob", "steamdeck", "thud"]) {
      assert.ok(ids.has(id), `missing ${id}`);
    }
    assert.equal(ids.size, GAMES.size);
  });

  it("serves read-only canon for readiness and the solo PC game", async () => {
    const response = await fetch(`${url}/api/native/canon`);
    assert.equal(response.status, 200);
    const body = await response.json() as { records: { ref: string; kind: string }[] };
    assert.equal(body.records.length, TEST_CANON.length);

    const entities = await (await fetch(`${url}/api/native/canon?kind=entity`)).json() as { records: { kind: string }[] };
    assert.ok(entities.records.length > 0);
    assert.ok(entities.records.every((record) => record.kind === "entity"));
  });

  it("still routes the general API and its JSON 404", async () => {
    const missing = await fetch(`${url}/api/definitely-not-a-route`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as { error: string }).error, "NOT_FOUND");
    const nativeMissing = await fetch(`${url}/api/native/definitely-not-a-route`);
    assert.equal(nativeMissing.status, 404);
  });
});
