import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionRecord, booleanValue, finiteNumber, requiredString } from "../server/engine/action.ts";

describe("engine action helpers", () => {
  it("accepts structured action payloads", () => {
    const payload = actionRecord({ systemId: "power", temperature: -12, confirmed: true });
    assert.equal(requiredString(payload, "systemId"), "power");
    assert.equal(finiteNumber(payload, "temperature"), -12);
    assert.equal(booleanValue(payload, "confirmed"), true);
  });

  it("rejects malformed payloads", () => {
    assert.throws(() => actionRecord(null));
    const payload = actionRecord({});
    assert.throws(() => requiredString(payload, "systemId"));
    assert.throws(() => finiteNumber(payload, "temperature"));
    assert.throws(() => booleanValue(payload, "confirmed"));
  });
});
