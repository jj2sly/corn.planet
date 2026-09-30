import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { applyExposure, createEnvironmentZone, hasEffect } from "../server/engine/environment.ts";
import { EntityRegistry } from "../server/engine/entity.ts";
import { defeatFood, foodTemperatureResponse } from "../server/engine/food.ts";
import { EventLog } from "../server/engine/event.ts";

describe("environment", () => {
  test("tracks zone effects and exposure", () => {
    const zone = createEnvironmentZone("freezer", "Freezer", ["COLD"], 0.8);
    expect(hasEffect(zone, "COLD")).toBe(true);
    const exposure = applyExposure(null, "COLD", 0.8, 2);
    expect(exposure.seconds).toBe(2);
  });
});

describe("food", () => {
  test("responds to temperature and can be defeated", () => {
    const state = { behavior: "IDLE" as const, preferredMin: 2, preferredMax: 8, extremeThreshold: 10, defeated: false, threat: 0.7 };
    expect(foodTemperatureResponse(state, 30)).toBe("MUTATE");
    const registry = new EntityRegistry<typeof state>();
    registry.add({ id: "milk", kind: "food", name: "Milk", enabled: true, state });
    expect(defeatFood(registry, "milk")).toBe(true);
    expect(registry.get("milk")?.state.defeated).toBe(true);
  });
});

describe("event log", () => {
  test("emits and reads events by id", () => {
    const log = new EventLog<{ value: number }>();
    const first = log.emit("repair.completed", { value: 1 }, 100);
    log.emit("temperature.changed", { value: 2 }, 101);
    expect(log.since(first.id)).toHaveLength(1);
    expect(log.recent(2)).toHaveLength(2);
  });
});
