import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const GAMES = [
  ["budgetcuts", "budgetcuts-host.js", "budgetcuts-play.js"],
  ["chaos", "chaos-host.js", "chaos-play.js"],
  ["cornorshit", "cornorshit-host.js", "cornorshit-play.js"],
  ["entityauction", "entityauction-host.js", "entityauction-play.js"],
  ["mycob", "mycob-host.js", "mycob-play.js"],
  ["steamdeck", "steamdeck-host.js", "steamdeck-play.js"],
  ["thud", "thud-host.js", "thud-play.js"],
] as const;

test("every Friday group game has host and phone renderers", async () => {
  const host = await readFile(new URL("../public/js/host.js", import.meta.url), "utf8");
  const play = await readFile(new URL("../public/js/play.js", import.meta.url), "utf8");

  for (const [id, hostFile, playFile] of GAMES) {
    await access(new URL(`../public/js/games/${hostFile}`, import.meta.url));
    await access(new URL(`../public/js/games/${playFile}`, import.meta.url));
    assert.match(host, new RegExp(`\\b${id}\\b`), `host renderer missing ${id}`);
    assert.match(play, new RegExp(`\\b${id}\\b`), `phone renderer missing ${id}`);
  }
});

test("native CPI library maps every browser group game", async () => {
  const registry = await readFile(new URL("../godot/scripts/app/app_registry.gd", import.meta.url), "utf8");
  for (const [id] of GAMES) {
    assert.ok(registry.includes(`"server_game_id": "${id}"`), `native library missing mapping for ${id}`);
  }
});

test("host deep links can preselect a requested group game", async () => {
  const host = await readFile(new URL("../public/js/host.js", import.meta.url), "utf8");
  assert.match(host, /URLSearchParams\(location\.search\)/);
  assert.match(host, /requestedGame/);
  assert.match(host, /room:configure/);
});
