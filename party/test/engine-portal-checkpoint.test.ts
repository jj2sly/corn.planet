import { describe, expect, test } from "node:test";
import { canOpenDoor, canUsePortal, toggleDoor } from "../server/engine/portal.ts";
import { CheckpointRegistry } from "../server/engine/checkpoint.ts";

describe("portals and checkpoints", () => {
  test("locked doors unlock from completed systems", () => {
    const context = { completedSystems: new Set(["power"]) };
    const door = { id: "door", name: "Power Door", state: "LOCKED" as const, requires: ["power"] };
    expect(canOpenDoor(door, context)).toBe(true);
    expect(toggleDoor(door, context).state).toBe("OPEN");
  });

  test("portals can require a discovery", () => {
    const portal = { id: "rift", from: "storage", to: "deep", requires: ["cold-key"] };
    expect(canUsePortal(portal, { discoveries: new Set() })).toBe(false);
    expect(canUsePortal(portal, { discoveries: new Set(["cold-key"]) })).toBe(true);
  });

  test("checkpoint activation changes the respawn target", () => {
    const registry = new CheckpointRegistry();
    registry.addCheckpoint({ id: "kitchen", name: "Kitchen", active: true, position: { x: 0, y: 0, z: 0 } });
    registry.addCheckpoint({ id: "mine", name: "Mine", active: false, position: { x: 5, y: 0, z: 5 } });
    expect(registry.activeIdValue()).toBe("kitchen");
    expect(registry.activate("mine")).toBe(true);
    expect(registry.activeIdValue()).toBe("mine");
  });
});
