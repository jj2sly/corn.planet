import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameStateMachine } from "../server/engine/state-machine.ts";

describe("engine state machine", () => {
  it("tracks a game's current phase without owning game lifecycle", () => {
    const phases = new GameStateMachine<"briefing" | "active" | "complete">("briefing");
    assert.equal(phases.state, "briefing");
    assert.equal(phases.is("briefing"), true);
    phases.transition("active");
    assert.equal(phases.is("briefing"), false);
    assert.equal(phases.is("active"), true);
    phases.transition("complete");
    assert.equal(phases.state, "complete");
  });
});
