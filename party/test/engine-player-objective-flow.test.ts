import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { createPlayerRuntimeState } from "../server/engine/player-state.ts";
import { ObjectiveTracker } from "../server/engine/objective.ts";
import { validateInteraction } from "../server/engine/interaction-flow.ts";
import { type RespawnState, recordDeath } from "../server/engine/checkpoint-state.ts";
import { isNewerSnapshot, makeSnapshot } from "../server/engine/snapshot.ts";

describe("player runtime", () => {
  test("creates shared runtime state", () => {
    const player = createPlayerRuntimeState("p1");
    expect(player.playerId).toBe("p1");
    expect(player.inventory).toBeDefined();
    expect(player.statuses).toBeDefined();
    expect(player.sync.read().state.health.health).toBe(100);
  });
});

describe("objectives", () => {
  test("enforces objective dependencies", () => {
    const tracker = new ObjectiveTracker();
    tracker.add({ id: "power", name: "Power", description: "Restore power", state: "ACTIVE" });
    tracker.add({ id: "cooling", name: "Cooling", description: "Repair cooling", state: "LOCKED", dependencies: ["power"] });
    expect(tracker.activate("cooling")).toBe(false);
    expect(tracker.complete("power")).toBe(true);
    expect(tracker.activate("cooling")).toBe(true);
  });
});

describe("interaction flow", () => {
  test("rejects missing or disabled targets", () => {
    expect(validateInteraction({ playerId: "p1", targetId: "panel", action: "use" }, false).accepted).toBe(false);
    expect(validateInteraction({ playerId: "p1", targetId: "panel", action: "use" }, true, false).accepted).toBe(false);
  });
});

describe("checkpoint state", () => {
  test("records deaths", () => {
    const state: RespawnState = { checkpointId: "cp1", deaths: 0 };
    recordDeath(state);
    expect(state.deaths).toBe(1);
  });
});

describe("snapshots", () => {
  test("compares state versions", () => {
    const a = makeSnapshot(1, { value: 1 }, 100);
    const b = makeSnapshot(2, { value: 2 }, 90);
    expect(isNewerSnapshot(b, a)).toBe(true);
  });
});
