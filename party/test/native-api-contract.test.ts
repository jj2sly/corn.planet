import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("native bridge exposes the expected session endpoints", async () => {
  const source = await readFile(new URL("../server/native-api.ts", import.meta.url), "utf8");
  const getRoutes = ['"/health"', '"/games"', '"/state"', '"/canon"', '"/canon/:ref"'];
  const postRoutes = ['"/host"', '"/player"', '"/configure"', '"/start"', '"/input"', '"/host-action"', '"/leave"'];

  for (const route of getRoutes) {
    assert.ok(source.includes(`api.get(${route}`), `missing GET ${route}`);
  }
  for (const route of postRoutes) {
    assert.ok(source.includes(`api.post(${route}`), `missing POST ${route}`);
  }
});

test("Godot client uses the native session bridge and catalog", async () => {
  const source = await readFile(new URL("../godot/scripts/runtime/network_client.gd", import.meta.url), "utf8");
  assert.match(source, /X-CPI-Session/);
  assert.match(source, /\/api\/native\/health/);
  assert.match(source, /\/api\/native\/games/);
  assert.match(source, /\/api\/native\/state/);
  assert.match(source, /\/api\/native\/canon/);
});
