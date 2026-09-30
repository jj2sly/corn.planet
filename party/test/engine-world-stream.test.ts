import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { chunkCoord, chunkId, nearbyChunkCoords, WorldChunkRegistry } from "../server/engine/world-stream.ts";

describe("world streaming primitives", () => {
  test("maps positions to stable chunk coordinates", () => {
    expect(chunkCoord({ x: 19, y: 0, z: -1 }, 10)).toEqual({ x: 1, z: -1 });
    expect(chunkId({ x: 1, z: -1 })).toBe("1:-1");
  });

  test("returns a bounded neighborhood", () => {
    expect(nearbyChunkCoords({ x: 0, y: 0, z: 0 }, 10, 1)).toHaveLength(9);
  });

  test("tracks loaded chunks and filters active chunks", () => {
    const registry = new WorldChunkRegistry();
    registry.add({ id: "0:0", origin: { x: 0, y: 0, z: 0 }, size: 10, colliders: [], interactableIds: [] });
    registry.add({ id: "5:5", origin: { x: 50, y: 0, z: 50 }, size: 10, colliders: [], interactableIds: [] });
    expect(registry.active({ x: 0, y: 0, z: 0 }, 10, 1).map(c => c.id)).toEqual(["0:0"]);
  });
});
