import test from "node:test";
import assert from "node:assert/strict";
import { PartyRuntime } from "../server/engine/runtime.ts";
import type { GameContext, GameDefinition, GameInstance, Viewer } from "../server/engine/game.ts";

function context(): GameContext {
  return {
    players: () => [], playerName: () => "", setTimer: () => {}, clearTimer: () => {},
    addPoints: () => {}, countStat: () => {}, pickPrompts: () => [], effectLibrary: () => ({}) as never,
    canon: {} as never, saveMoment: () => {}, random: Math.random, paused: () => false,
    changed: () => {}, finish: () => {},
  };
}
function definition(calls: string[]): GameDefinition {
  const instance: GameInstance = {
    start: () => calls.push("start"), handleInput: () => calls.push("input"),
    hostAction: () => calls.push("host"), viewFor: (_viewer: Viewer) => ({ ok: true }),
    playerLeft: () => calls.push("left"), dispose: () => calls.push("dispose"),
  };
  return { id: "runtime-test", name: "Runtime Test", tagline: "", description: "test",
    minPlayers: 1, maxPlayers: 8, defaultSettings: {}, parseSettings: raw => raw, create: () => instance };
}

test("PartyRuntime runs the shared lifecycle", () => {
  const calls: string[] = []; const def = definition(calls);
  const runtime = new PartyRuntime({ games: new Map([[def.id, def]]) });
  assert.equal(runtime.start(def.id, context(), {}), true);
  assert.equal(runtime.snapshot().phase, "RUNNING");
  assert.deepEqual(calls, ["start"]);
  assert.equal(runtime.input("p1", "move", { x: 1 }), true);
  assert.equal(runtime.hostAction("pause", {}), true);
  assert.equal(runtime.pause(), true);
  assert.equal(runtime.snapshot().phase, "PAUSED");
  assert.equal(runtime.resume(), true);
  runtime.playerLeft("p1"); runtime.dispose();
  assert.deepEqual(calls, ["start", "input", "host", "left", "dispose"]);
  assert.equal(runtime.snapshot().phase, "IDLE");
});

test("PartyRuntime rejects unavailable and duplicate starts", () => {
  assert.equal(new PartyRuntime().start("missing", context(), {}), false);
  const def = definition([]);
  const runtime = new PartyRuntime({ games: new Map([[def.id, def]]) });
  assert.equal(runtime.start(def.id, context(), {}), true);
  assert.equal(runtime.start(def.id, context(), {}), false);
});
