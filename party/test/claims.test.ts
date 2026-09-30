import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CanonRecord } from "../server/canon.ts";
import { borrowValue, buildClaimPair, claimableFields, nameVariants } from "../server/games/claims.ts";
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
    assert.ok(pair.fake.includes(borrowValue(pair.donor, pair.source, pair.field)), "the false claim must quote the donor's value");
    assert.ok(donorValue.length > 0);
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

describe("claims: a borrowed value never names where it came from", () => {
  it("knows the ways canon text names a record", () => {
    assert.deepEqual(nameVariants("Jack “Snaggletooth” Cummins"), ["Jack “Snaggletooth” Cummins", "Jack Snaggletooth Cummins", "Jack Cummins", "Cummins", "Jack"]);
    assert.ok(nameVariants("The Evil Jik").includes("Jik"));
    assert.ok(nameVariants('Trevor "Rainbow" N.').includes("Trevor N."));
    assert.ok(nameVariants("Baby (Two Heart Emoji)").includes("Baby"));
  });

  it("re-points the donor's names and designation at the source record", () => {
    const donor = entity("CPE-022", "The King of Burgers", { description: "CPE-22 or “The King of Burgers” kidnaps fries. The King hates salad." });
    const source = entity("CPE-009", "Spike", { description: "A rabbit." });
    const borrowed = borrowValue(donor, source, "description");
    assert.equal(borrowed, "CPE-009 or “Spike” kidnaps fries. The Spike hates salad.");
    for (const name of ["Burgers", "King", "CPE-22", "CPE-022"]) assert.ok(!borrowed.includes(name), `still names ${name}`);
  });

  it("inserts the plain name and never re-matches an inserted name", () => {
    const donor = entity("CPE-101", "Chuck", { description: "Chuck is a dog. Chuck barks." });
    const source = entity("CPE-102", "Chuck Norris (Unrelated)", { description: "Different." });
    assert.equal(borrowValue(donor, source, "description"), "Chuck Norris is a dog. Chuck Norris barks.");
  });

  it("leaves ordinary words alone", () => {
    const donor = entity("CPE-103", "Big Yellow", { description: "A big yellow problem. Big Yellow sulks." });
    const source = entity("CPE-104", "Spike", { description: "A rabbit." });
    assert.equal(borrowValue(donor, source, "description"), "A big yellow problem. Spike sulks.");
  });

  it("skips a donor whose text already mentions the source", () => {
    const source = entity("CPE-201", "Primate", { description: "An ape of unknown origin." });
    const cohort = entity("CPE-202", "Amy", { description: "A close cohort of Primate, and a menace." });
    assert.equal(buildClaimPair(source, [source, cohort], seededRandom(1)), null);
  });

  it("builds fakes from the test canon that never name the donor", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const source of ENTITIES) {
        const pair = buildClaimPair(source, ENTITIES, seededRandom(seed));
        if (!pair || pair.donor.title === pair.source.title) continue;
        for (const name of nameVariants(pair.donor.title)) {
          if (nameVariants(pair.source.title).some((own) => own.includes(name))) continue;
          assert.ok(!new RegExp(`\\b${name}\\b`).test(pair.fake), `seed ${seed}: fake about ${pair.source.title} names ${name}`);
        }
      }
    }
  });
});

describe("claims: both sides of a pair read the same way", () => {
  it("uses the short form only when both values are level-like", () => {
    const source = entity("CPE-301", "Jik", { containment: "cannot be contained" });
    const donor = entity("CPE-302", "Spike", { containment: "MINIMAL" });
    const mixed = buildClaimPair(source, [source, donor], seededRandom(1));
    assert.ok(mixed);
    assert.equal(mixed.real, 'Containment on file for Jik: "cannot be contained"');
    assert.equal(mixed.fake, 'Containment on file for Jik: "MINIMAL"');

    const levelled = buildClaimPair(entity("CPE-303", "Chuck", { containment: "STANDARD" }), [donor], seededRandom(1));
    assert.ok(levelled);
    assert.equal(levelled.real, "Chuck is held under STANDARD containment.");
    assert.equal(levelled.fake, "Chuck is held under MINIMAL containment.");
  });
});
