import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CheckpointTracker, DownedPlayer, Inventory } from "../server/engine/survival.ts";

describe("engine survival primitives", () => {
  it("supports downed and revive without owning game timing", () => {
    const player = new DownedPlayer();
    assert.equal(player.state, "ALIVE");
    assert.equal(player.down(), true);
    assert.equal(player.down(), false);
    assert.equal(player.revive(), true);
    assert.equal(player.revive(), false);
  });

  it("keeps the latest activated checkpoint", () => {
    const checkpoints = new CheckpointTracker<{ x: number; y: number }>();
    assert.equal(checkpoints.checkpoint, null);
    assert.equal(checkpoints.activate({ id: "a", value: { x: 10, y: 20 } }), true);
    assert.equal(checkpoints.activate({ id: "a", value: { x: 99, y: 99 } }), false);
    assert.deepEqual(checkpoints.checkpoint, { id: "a", value: { x: 10, y: 20 } });
    assert.equal(checkpoints.activate({ id: "b", value: { x: 50, y: 60 } }), true);
    assert.deepEqual(checkpoints.checkpoint, { id: "b", value: { x: 50, y: 60 } });
  });

  it("enforces a small inventory capacity", () => {
    const inventory = new Inventory<"wrench" | "fuse" | "thermometer">(2);
    assert.equal(inventory.add("wrench"), true);
    assert.equal(inventory.add("fuse"), true);
    assert.equal(inventory.add("thermometer"), false);
    assert.equal(inventory.add("fuse"), false);
    assert.equal(inventory.has("wrench"), true);
    assert.equal(inventory.remove("wrench"), true);
    assert.deepEqual(inventory.list(), ["fuse"]);
  });
