import { describe, expect, test } from "node:test";
import { findInteraction, interactionAction } from "../server/engine/interactable.ts";
import { makeAabb } from "../server/engine/world.ts";

describe("interaction targeting", () => {
  test("selects the nearest enabled object in the look ray", () => {
    const hit = findInteraction({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, [
      { id: "far", name: "far door", bounds: makeAabb({ x: 0, y: 0, z: 4 }, { x: 1, y: 1, z: 0.1 }) },
      { id: "near", name: "near door", bounds: makeAabb({ x: 0, y: 0, z: 2 }, { x: 1, y: 1, z: 0.1 }) },
      { id: "off", name: "disabled", enabled: false, bounds: makeAabb({ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 0.1 }) },
    ]);
    expect(hit?.id).toBe("near");
  });

  test("turns a targeted interaction into a validated logical action", () => {
    const hit = findInteraction({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, [
      { id: "panel", name: "panel", action: "REPAIR", bounds: makeAabb({ x: 0, y: 0, z: 2 }, { x: 1, y: 1, z: 0.1 }) },
    ]);
    expect(interactionAction(hit, "REPAIR")).toEqual({ id: "panel", action: "REPAIR" });
    expect(interactionAction(hit, "OPEN")).toBeNull();
  });
});
