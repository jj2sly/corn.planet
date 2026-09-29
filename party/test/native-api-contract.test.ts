import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("native bridge exposes the expected session endpoints", async () => {
  const source = await readFile(new URL("../server/native-api.ts", import.meta.url), "utf8");
  const getRoutes = ['"/health"', '"/auth-config"', '"/games"', '"/me"', '"/me/stats"', '"/state"', '"/canon"', '"/canon/:ref"'];
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
  assert.match(source, /identitytoolkit\.googleapis\.com\/v1\/accounts:signInWithPassword/);
  assert.match(source, /securetoken\.googleapis\.com\/v1\/token/);
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


test("native registry maps friendly IDs to authoritative server IDs", async () => {
  const source = await readFile(new URL("../godot/scripts/app/app_registry.gd", import.meta.url), "utf8");
  for (const mapping of [
    ['"id": "cornlashing"', '"server_game_id": "chaos"'],
    ['"id": "corn-or-shit"', '"server_game_id": "cornorshit"'],
    ['"id": "entity-auction"', '"server_game_id": "entityauction"'],
    ['"id": "my-cob-escaped"', '"server_game_id": "mycob"'],
    ['"id": "steam-my-deck"', '"server_game_id": "steamdeck"'],
    ['"id": "angry-thuds-revenge"', '"server_game_id": "thud"'],
  ]) {
    const [friendly, server] = mapping;
    const friendlyIndex = source.indexOf(friendly);
    const serverIndex = source.indexOf(server, friendlyIndex);
    assert.ok(friendlyIndex >= 0, `missing native id ${friendly}`);
    assert.ok(serverIndex > friendlyIndex, `missing server mapping ${server}`);
  }
});


test("native app exposes group-play bridge for complete browser games", async () => {
  const app = await readFile(new URL("../godot/scripts/cpi_app.gd", import.meta.url), "utf8");
  const shell = await readFile(new URL("../godot/scripts/app/app_shell.gd", import.meta.url), "utf8");
  const host = await readFile(new URL("../public/js/host.js", import.meta.url), "utf8");

  assert.match(shell, /launch_group_game_requested/);
  assert.match(shell, /GROUP PLAY/);
  assert.match(app, /\/host\?game=/);
  assert.match(app, /OS\.shell_open/);
  assert.match(host, /new URLSearchParams\(location\.search\)\.get\("game"\)/);
  assert.match(host, /room:configure/);
});
