import { describe, expect, test } from "node:test";
import { applyDamage, createHealth, heal, revive, StatusTracker } from "../server/engine/status.ts";
import { AuthoritativeState } from "../server/engine/sync.ts";
import { addResource, createResource, spendResource } from "../server/engine/resource.ts";

describe("status and health", () => {
  test("tracks temporary statuses", () => {
    const tracker = new StatusTracker();
    tracker.apply("COLD", 0.8, 3);
    expect(tracker.has("COLD")).toBe(true);
    tracker.tick(3);
    expect(tracker.has("COLD")).toBe(false);
  });

  test("supports damage, downing, healing and revival", () => {
    const health = createHealth(100);
    applyDamage(health, 100);
    expect(health.downed).toBe(true);
    expect(revive(health, 25)).toBe(true);
    expect(health.health).toBe(25);
    expect(heal(health, 10)).toBe(10);
  });
});

describe("authoritative state", () => {
  test("versions state changes", () => {
    const state = new AuthoritativeState({ powered: false });
    expect(state.getVersion()).toBe(0);
    state.update(value => ({ ...value, powered: true }));
    expect(state.getVersion()).toBe(1);
    expect(state.changedSince(0)).toBe(true);
    expect(state.read().state.powered).toBe(true);
  });
});

describe("resources", () => {
  test("spends and restores bounded resources", () => {
    const resource = createResource("parts", "Parts", 5, 10);
    expect(spendResource(resource, 3)).toBe(true);
    expect(resource.amount).toBe(2);
    addResource(resource, 20);
    expect(resource.amount).toBe(10);
    expect(spendResource(resource, 11)).toBe(false);
  });
});
