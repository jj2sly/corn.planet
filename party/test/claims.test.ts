import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CanonRecord } from "../server/canon.ts";
import { buildClaimPair, claimableFields } from "../server/games/claims.ts";
import { seededRandom, TEST_CANON } from "./helpers.ts";

function entity(ref: string, title: string, fields: Record<string, string>): CanonRecord {
  return { ref, kind: "entity", title, fields, links: {}, url: `https://example.test/${ref}` };
}

const ENTITIES = TEST_CANON.filter((r) => r.kind === "entity");

describe("claims: which fields can carry a claim", () => {
  it("offers the templated fields a record actually has", () => {
    const fields = claimableFields(ENTITIES[0]!);
    assert.deepEqual(fields.sort(), ["classification", "containment", "containmentProcedures", "description"]);
  });

  it("skips fields that are missing, empty or too short to be interesting", () => {
    const thin = entity("CPE-900", "Thin", { classification: "LOCAL", containment: "", description: "x" });
    assert.deepEqual(claimableFields(thin), ["classification"]);
  });

  it("skips redacted fields, so a claim never turns on hidden text", () => {
    const hidden = entity("CPE-901", "Hidden", {
      classification: "COSMIC",
      description: "Mostly [CLASSIFIED] really.",
      containmentProcedures: "Contains [REDACTED] material.",
    });
    assert.deepEqual(claimableFields(hidden), ["classification"]);
  });

  it("ignores fields with no template, so new canon fields never make clumsy claims", () => {
    const extra = entity("CPE-902", "Extra", { classification: "LOCAL", somethingNew: "a value nobody templated" });
    assert.deepEqual(claimableFields(extra), ["classification"]);
  });
});

describe("claims: building a true/false pair", () => {
  it("states the record's real value and attributes someone else's to it", () => {
    const pair = buildClaimPair(ENTITIES[0]!, ENTITIES, seededRandom(3));
    assert.ok(pair);

    const realValue = pair.source.fields[pair.field]!;
    const donorValue = pair.donor.fields[pair.field]!;

    assert.ok(pair.real.includes(realValue), "the true claim must quote the record's own value");
    assert.ok(pair.fake.includes(donorValue), "the false claim must quote the donor's value");
    assert.ok(pair.real.includes(pair.source.title));
    assert.ok(pair.fake.includes(pair.source.title), "both claims are about the same record");
    assert.notEqual(pair.donor.ref, pair.source.ref);
  });

  it("never lets the fabrication accidentally be true", () => {
    // Every source, every seed: the borrowed value must differ from the real one.
    for (let seed = 1; seed <= 40; seed++) {
      for (const source of ENTITIES) {
        const pair = buildClaimPair(source, ENTITIES, seededRandom(seed));
        if (!pair) continue;
        const realValue = pair.source.fields[pair.field]!.trim().toLowerCase();
        const fakeValue = pair.donor.fields[pair.field]!.trim().toLowerCase();
        assert.notEqual(fakeValue, realValue, `seed ${seed}, ${source.ref}.${pair.field}`);
        assert.notEqual(pair.fake, pair.real);
      }
    }
  });

  it("only ever borrows from the same kind of record", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const pair = buildClaimPair(ENTITIES[1]!, TEST_CANON, seededRandom(seed));
      assert.ok(pair);
      assert.equal(pair.donor.kind, "entity");
    }
  });

  it("returns null rather than inventing a claim when no donor fits", () => {
    const lonely = entity("CPE-903", "Lonely", { classification: "LOCAL" });
    assert.equal(buildClaimPair(lonely, [lonely], seededRandom(1)), null);

    // A donor that agrees on every usable field cannot supply a falsehood.
    const twin = entity("CPE-904", "Twin", { classification: "LOCAL" });
    assert.equal(buildClaimPair(lonely, [lonely, twin], seededRandom(1)), null);
  });

  it("falls back to another field when the obvious one has no usable donor", () => {
    const source = entity("CPE-905", "Source", { classification: "LOCAL", containment: "MAXIMUM" });
    // Same classification (no falsehood available there), different containment.
    const donor = entity("CPE-906", "Donor", { classification: "LOCAL", containment: "MINIMAL" });

    const pair = buildClaimPair(source, [source, donor], seededRandom(5));
    assert.ok(pair);
    assert.equal(pair.field, "containment");
  });

  it("cuts very long values so a claim still fits a screen", () => {
    const long = "word ".repeat(200).trim();
    const source = entity("CPE-907", "Long", { description: long });
    const donor = entity("CPE-908", "Other", { description: "short and sweet enough to use" });

    const pair = buildClaimPair(source, [source, donor], seededRandom(1));
    assert.ok(pair);
    assert.ok(pair.real.length < 260, `claim was ${pair.real.length} chars`);
    assert.ok(pair.real.includes("…"), "a cut value is marked as cut");
  });

  it("is deterministic for a seeded random", () => {
    const a = buildClaimPair(ENTITIES[0]!, ENTITIES, seededRandom(11));
    const b = buildClaimPair(ENTITIES[0]!, ENTITIES, seededRandom(11));
    assert.deepEqual([a?.field, a?.real, a?.fake], [b?.field, b?.real, b?.fake]);
  });
});
