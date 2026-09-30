import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { PlayerSpawnRegistry } from "../server/engine/spawn.ts";
import { SceneGraph, identityTransform } from "../server/engine/scene.ts";
import { createEnvironmentZone } from "../server/engine/environment.ts";
import { createHealth, StatusTracker } from "../server/engine/status.ts";
import { processHazard } from "../server/engine/hazard.ts";
import { MemoryMissionPersistence } from "../server/engine/persistence.ts";
import { EventLog } from "../server/engine/event.ts";
import { processInteraction, type InteractionEventPayload } from "../server/engine/interaction-event.ts";
import { PlayerSessionRegistry } from "../server/engine/player-session.ts";
import { SceneAssetManifest } from "../server/engine/client-scene.ts";

describe("spawns and scenes", () => {
  test("cycles spawns and stores reusable scene nodes", () => {
    const spawns = new PlayerSpawnRegistry();
    spawns.add({ id: "s1", zoneId: "kitchen", x: 0, y: 0, z: 0, yaw: 0 });
    expect(spawns.next("kitchen")?.id).toBe("s1");
    const scene = new SceneGraph();
    scene.add({ id: "fridge", kind: "mesh", transform: identityTransform(), visible: true, properties: {} });
    expect(scene.get("fridge")?.kind).toBe("mesh");
  });
});

describe("hazards", () => {
  test("applies cold exposure and damage", () => {
    const zone = createEnvironmentZone("freezer", "Freezer", ["COLD"], 0.9);
    const health = createHealth();
    const statuses = new StatusTracker();
    const result = processHazard(zone, 1, health, statuses);
    expect(result.effects).toContain("COLD");
    expect(statuses.has("COLD")).toBe(true);
  });
});

describe("persistence", () => {
  test("round trips mission checkpoint state", () => {
    const persistence = new MemoryMissionPersistence();
    persistence.save({ missionId: "cold-case", checkpointId: "cp1", elapsed: 10, state: { power: true } });
    expect(persistence.load("cold-case")?.checkpointId).toBe("cp1");
  });
});

describe("interaction events", () => {
  test("records accepted interaction", () => {
    const log = new EventLog<InteractionEventPayload>();
    const event = processInteraction(log, { playerId: "p1", targetId: "door", action: "open" }, true);
    expect(event.type).toBe("interaction.accepted");
  });
});

describe("player sessions", () => {
  test("tracks connection state", () => {
    const sessions = new PlayerSessionRegistry();
    sessions.join("p1", "kitchen", 1);
    sessions.leave("p1", 2);
    expect(sessions.connected()).toHaveLength(0);
    sessions.heartbeat("p1", 3);
    expect(sessions.connected()).toHaveLength(1);
  });
});

describe("scene assets", () => {
  test("tracks preload assets", () => {
    const assets = new SceneAssetManifest();
    assets.add({ id: "fridge", url: "/assets/fridge.glb", kind: "model", preload: true });
    expect(assets.preload()).toHaveLength(1);
  });
});
