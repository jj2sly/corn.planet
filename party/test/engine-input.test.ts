import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInputMap, normalizeInput, resolveInput } from "../server/engine/input.ts";

describe("engine input mapping", () => {
  const map = createInputMap([
    { action: "MOVE_UP", source: "keyboard", code: "ArrowUp" },
    { action: "MOVE_UP", source: "touch", code: "dpad-up" },
    { action: "INTERACT", source: "mouse", code: "button0" },
  ]);

  it("maps different devices to the same logical action", () => {
    assert.equal(resolveInput(map, "keyboard", "ArrowUp"), "MOVE_UP");
    assert.equal(resolveInput(map, "touch", "dpad-up"), "MOVE_UP");
    assert.equal(resolveInput(map, "keyboard", "Space"), null);
  });

  it("normalizes optional values", () => {
    assert.deepEqual(normalizeInput({ action: "LOOK", source: "touch", x: 0.5, y: -0.25, pressed: true }), { action: "LOOK", source: "touch", x: 0.5, y: -0.25, pressed: true });
  });

  it("rejects invalid physical input", () => {
    assert.throws(() => normalizeInput({ action: "LOOK", source: "touch", x: Number.NaN }));
    assert.throws(() => normalizeInput({ action: "LOOK", source: "touch", pressed: "yes" }));
  });
});