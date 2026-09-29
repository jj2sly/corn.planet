import test from "node:test";
import assert from "node:assert/strict";
import { AssetRegistry } from "../server/engine/assets.ts";
import { WorldStreamer } from "../server/engine/world-streaming.ts";

test("AssetRegistry registers and filters shared assets", () => {
  const registry = new AssetRegistry();
  registry.register({ id: "coldcase.fridge", kind: "mesh", source: "coldcase/fridge.glb", preload: true });
  registry.register({ id: "coldcase.frost", kind: "material", source: "coldcase/frost", preload: false });
  assert.equal(registry.get("coldcase.fridge")?.kind, "mesh");
  assert.equal(registry.list("material").length, 1);
  assert.deepEqual(registry.preload().map(asset => asset.id), ["coldcase.fridge"]);
  assert.throws(() => registry.register({ id: "coldcase.fridge", kind: "mesh", source: "again" }));
});

test("WorldStreamer keeps the active zone and its preload set", () => {
  const stream = new WorldStreamer();
  stream.register({ id: "kitchen", preload: ["fridge"] });
  stream.register({ id: "fridge", preload: ["pantry"], unload: ["kitchen"] });
  stream.register({ id: "pantry" });

  assert.deepEqual(stream.activate("kitchen"), { active: "kitchen", loaded: ["fridge", "kitchen"] });
  assert.deepEqual(stream.activate("fridge"), { active: "fridge", loaded: ["fridge", "pantry"] });
  assert.equal(stream.isLoaded("kitchen"), false);
});
