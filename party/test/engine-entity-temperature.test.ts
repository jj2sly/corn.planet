import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { EntityRegistry } from "../server/engine/entity.ts";
import { setTemperatureTarget, stepTemperature, temperatureState } from "../server/engine/temperature.ts";

describe("world entities", () => {
  test("registers, patches, disables, and snapshots entities", () => {
    const registry = new EntityRegistry<{ powered: boolean }>();
    expect(registry.add({ id: "panel", kind: "machine", name: "Power Panel", enabled: true, state: { powered: false } })).toBe(true);
    expect(registry.patch("panel", { powered: true })?.state.powered).toBe(true);
    expect(registry.setEnabled("panel", false)).toBe(true);
    expect(registry.snapshot()[0]?.enabled).toBe(false);
    expect(registry.add({ id: "panel", kind: "machine", name: "Duplicate", enabled: true, state: { powered: false } })).toBe(false);
  });
});

describe("temperature", () => {
  test("moves toward a target and reports the change", () => {
    const zone = { id: "storage", name: "Storage", temperature: 8, target: -4, min: -30, max: 30, rate: 1 };
    setTemperatureTarget(zone, -4);
    const reading = stepTemperature(zone, 0.5);
    expect(reading.temperature).toBe(2);
    expect(reading.delta).toBe(-6);
    expect(reading.state).toBe("COLD");
  });

  test("classifies extreme temperatures", () => {
    expect(temperatureState(-20)).toBe("EXTREME");
    expect(temperatureState(25)).toBe("EXTREME");
  });
});
