import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("native bridge exposes the expected session endpoints", async () => {
  const source = await readFile(new URL("../server/native-api.ts", import.meta.url), "utf8");
  for (const route of [
    '"/host"',
    '"/player"',
    '"/state"',
    '"/configure"',
    '"/start"',
    '"/input"',
    '"/host-action"',
    '"/leave"',
  ]) {
    assert.ok(source.includes(`api.${route === '"/state"' ? "get" : "post"}(${route}`), `missing ${route}`);
  }
});

test("Godot client uses the native session header", async () => {
  const source = await readFile(new URL("../godot/scripts/runtime/network_client.gd", import.meta.url), "utf8");
  assert.match(source, /X-CPI-Session/);
  assert.match(source, /\/api\/native\/state/);
});
