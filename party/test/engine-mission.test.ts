import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missionStatus, type MissionRecord } from "../server/engine/mission.ts";

describe("engine mission contracts", () => {
  it("keeps debrief data game-neutral", () => {
    const record: MissionRecord = {
      kind: "coldcase.v1",
      status: "STABILIZED",
      elapsedMs: 12_500,
      checkpointsReached: [{ id: "power", name: "Power Room" }],
      systemsCompleted: ["power"],
      discoveries: ["chuck"],
      playerEvents: { revived: 2, downed: 1 },
      notesFound: 3,
      secretsFound: 1,
    };
    assert.equal(missionStatus(record.status), "STABILIZED");
    assert.equal(record.kind, "coldcase.v1");
    assert.equal(record.systemsCompleted.length, 1);
  });
});
