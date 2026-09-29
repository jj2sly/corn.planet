import { describe, expect, test } from "node:test";
import { addFridgeModule, buildRoomScene, createFridgeRoom, makeTransform } from "../server/engine/fridge-kit.ts";
import { createRepairPuzzle, advanceRepairPuzzle } from "../server/engine/repair-puzzle.ts";
import { adjustTemperature } from "../server/engine/temperature-control.ts";
import { spawnFood } from "../server/engine/food-spawn.ts";
import { EntityRegistry } from "../server/engine/entity.ts";
import { chooseFoodBehavior } from "../server/engine/food-behavior.ts";
import { LIGHT_PRESETS } from "../server/engine/light-kit.ts";

describe("fridge kit", () => {
  test("builds a room from refrigerator modules", () => {
    const room = createFridgeRoom("storage", "Food Storage", "storage");
    addFridgeModule(room, { id: "shelf-1", type: "shelf", zoneId: "storage", transform: makeTransform(1, 2, 3) });
    expect(buildRoomScene(room).get("shelf-1")).not.toBeNull();
  });
});

describe("repair puzzles", () => {
  test("advances in order", () => {
    const puzzle = createRepairPuzzle("power", "SEQUENCE", ["switch", "fuse"]);
    expect(advanceRepairPuzzle(puzzle, "switch")).toBe(true);
    expect(advanceRepairPuzzle(puzzle, "fuse")).toBe(true);
    expect(puzzle.completed).toBe(true);
  });
});

describe("temperature controls", () => {
  test("adjusts zone target", () => {
    const zone = { id: "freezer", name: "Freezer", temperature: 8, target: 8, min: -30, max: 20, rate: 1 };
    expect(adjustTemperature({ id: "control", zoneId: "freezer", enabled: true, minTarget: -20, maxTarget: 10, step: 2 }, zone, -1)).toBe(6);
  });
});

describe("food spawning", () => {
  test("creates food entities", () => {
    const registry = new EntityRegistry<any>();
    expect(spawnFood(registry, { idPrefix: "milk", name: "Milk", zoneId: "storage", count: 2, state: { behavior: "IDLE", preferredMin: 2, preferredMax: 8, extremeThreshold: 10, defeated: false, threat: 0.5 } })).toHaveLength(2);
  });
});

describe("food behavior", () => {
  test("selects a target", () => {
    const state = { behavior: "IDLE" as const, preferredMin: 2, preferredMax: 8, extremeThreshold: 10, defeated: false, threat: 0.5 };
    expect(chooseFoodBehavior(state, ["p1"], 5).targetPlayerId).toBe("p1");
  });
});

describe("lighting", () => {
  test("provides presets", () => {
    expect(LIGHT_PRESETS.freezer.temperature).toBeGreaterThan(LIGHT_PRESETS.kitchen.temperature);
  });
});
