import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("native bridge exposes the expected session endpoints", async () => {
  const source = await readFile(new URL("../server/native-api.ts", import.meta.url), "utf8");
  const getRoutes = ['"/health"', '"/games"', '"/me"', '"/me/stats"', '"/state"', '"/canon"', '"/canon/:ref"'];
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
  assert.match(source, /\/api\/native\/me/);
  assert.match(source, /\/api\/native\/state/);
  assert.match(source, /\/api\/native\/canon/);
});


test("native router is mounted before browser fallback", async () => {
  const source = await readFile(new URL("../server/app.ts", import.meta.url), "utf8");
  const nativeIndex = source.indexOf('app.use("/api/native"');
  const staticIndex = source.indexOf("app.use(express.static");
  const fallbackIndex = source.indexOf('app.use((_req, res) => res.status(404)');
  assert.ok(nativeIndex >= 0, "native router is not mounted");
  assert.ok(staticIndex > nativeIndex, "static middleware must follow the native router");
  assert.ok(fallbackIndex > nativeIndex, "404 fallback must follow the native router");
});
