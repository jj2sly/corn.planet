import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RepairTracker } from "../server/engine/repair.ts";

describe("engine repair tracker", () => {
  it("opens dependent systems after repair completion", () => {
    const tracker = new RepairTracker([
      { id: "power", name: "Power", state: "AVAILABLE" },
      { id: "cooling", name: "Cooling", state: "LOCKED", dependencies: ["power"] },
      { id: "core", name: "Core", state: "LOCKED", dependencies: ["cooling"] },
    ]);
    assert.equal(tracker.start("power"), true);
    assert.equal(tracker.complete("power"), true);
    assert.equal(tracker.get("cooling")?.state, "AVAILABLE");
    assert.equal(tracker.start("core"), false);
    assert.equal(tracker.start("cooling"), true);
    assert.equal(tracker.complete("cooling"), true);
    assert.equal(tracker.get("core")?.state, "AVAILABLE");
  });

  it("does not allow a generic progress-bar shortcut", () => {
    const tracker = new RepairTracker([{ id: "power", name: "Power", state: "AVAILABLE" }]);
    assert.equal(tracker.complete("power"), false);
    assert.equal(tracker.get("power")?.state, "AVAILABLE");
  });
});
