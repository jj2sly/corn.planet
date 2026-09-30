import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { createFixedStepClock } from "../server/engine/tick.ts";
import { MissionSession } from "../server/engine/session.ts";
import { deserializeState, serializeState } from "../server/engine/serialize.ts";
import { ZoneGraph } from "../server/engine/zone.ts";
import { TriggerRegistry } from "../server/engine/trigger.ts";
import { RepairEffectRegistry } from "../server/engine/repair-effects.ts";

describe("runtime clock", () => {
  test("runs fixed simulation steps", () => {
    const clock = createFixedStepClock(0.05);
    let steps = 0;
    expect(clock.tick(0.11, () => steps++)).toBe(2);
    expect(steps).toBe(2);
  });
});

describe("mission session", () => {
  test("follows briefing, active, extraction and complete", () => {
    const session = new MissionSession();
    expect(session.start(100)).toBe(true);
    session.tick(2);
    expect(session.read().elapsed).toBe(2);
    expect(session.beginExtraction()).toBe(true);
    expect(session.complete()).toBe(true);
  });
});

describe("serialization", () => {
  test("round trips plain state", () => {
    const value = { zone: "freezer", repaired: true };
    expect(deserializeState<typeof value>(serializeState(value))).toEqual(value);
  });
});

describe("zone graph", () => {
  test("connects refrigerator areas", () => {
    const graph = new ZoneGraph();
    graph.add({ id: "storage", name: "Storage", tags: ["food"], connections: [] });
    graph.add({ id: "freezer", name: "Freezer", tags: ["cold"], connections: [] });
    expect(graph.connect("storage", "freezer")).toBe(true);
    expect(graph.neighbors("storage")[0]?.id).toBe("freezer");
  });
});

describe("triggers", () => {
  test("fires a one-shot event", () => {
    const registry = new TriggerRegistry();
    let count = 0;
    registry.add({ id: "power", once: true, fired: false, condition: ctx => ctx.values.powered === true, action: () => count++ });
    expect(registry.evaluate({ values: { powered: true } })).toEqual(["power"]);
    registry.evaluate({ values: { powered: true } });
    expect(count).toBe(1);
  });
});

describe("repair effects", () => {
  test("applies registered consequences", () => {
    const registry = new RepairEffectRegistry();
    let changed = false;
    registry.add({ id: "open-route", description: "Open route", apply: () => { changed = true; } });
    expect(registry.apply("open-route", {})).toBe(true);
    expect(changed).toBe(true);
  });
});
