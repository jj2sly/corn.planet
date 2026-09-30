import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { makeAabb, overlaps, pointInside, rayAabb, resolveCharacterCollision } from "../server/engine/world.ts";

describe("world primitives", () => {
  test("creates and tests axis-aligned boxes", () => {
    const box = makeAabb({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 1 });
    expect(pointInside({ x: 0, y: 1, z: 0 }, box)).toBe(true);
    expect(overlaps(box, makeAabb({ x: 1.5, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }))).toBe(true);
  });

  test("resolves a character onto a floor", () => {
    const floor = { id: "floor", min: { x: -5, y: -1, z: -5 }, max: { x: 5, y: 0, z: 5 } };
    const result = resolveCharacterCollision({ x: 0, y: -0.2, z: 0 }, { radius: 0.3, height: 1.8 }, [floor], 0.1);
    expect(result.position.y).toBe(0);
    expect(result.grounded).toBe(true);
    expect(result.hitIds).toEqual(["floor"]);
  });

  test("raycasts against a box and respects max distance", () => {
    const box = makeAabb({ x: 0, y: 0, z: 5 }, { x: 1, y: 1, z: 1 });
    expect(rayAabb({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, box, 10)).toBe(4);
    expect(rayAabb({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, box, 3)).toBeNull();
  });
});
