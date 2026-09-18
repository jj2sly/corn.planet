import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CanonRecord } from "../server/canon.ts";
import { PartyDb, type Moment } from "../server/db.ts";
import { momentIdFromMarker, promotionMarker, promotionUrl, reconcilePromotions } from "../server/promotion.ts";
import { stubCanon } from "./helpers.ts";

function momentFixture(overrides: Partial<Moment> = {}): Moment {
  return {
    id: 42,
    gameId: "chaos",
    text: "Filed it under 'not my problem' & left.",
    context: "The cob has escaped containment during lunch.",
    authorUid: null,
    authorName: "Ann",
    votes: 3,
    votesPossible: 4,
    status: "visible",
    promotionStartedAt: null,
    canonRef: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function incident(ref: string, promotedFrom?: string): CanonRecord {
  return {
    ref,
    kind: "incident",
    title: `Incident ${ref}`,
    fields: {},
    links: {},
    url: `https://example.test/corn.planet/incident-entry.html?id=${ref}`,
    ...(promotedFrom ? { promotedFrom } : {}),
  };
}

/** A database holding `count` Hall of Fame moments, with ids 1..count. */
function dbWithMoments(count: number): PartyDb {
  const db = new PartyDb(":memory:");
  db.recordGame({
    gameId: "chaos",
    roomCode: "BCDF",
    rounds: 1,
    startedAt: Date.now() - 60_000,
    endedAt: Date.now(),
    players: [],
    moments: Array.from({ length: count }, (_, i) => ({
      text: `report ${i + 1}`,
      context: `incident ${i + 1}`,
      authorUid: null,
      authorName: "Ann",
      votes: 2,
      votesPossible: 2,
    })),
  });
  return db;
}

describe("promotion: markers", () => {
  it("round-trips a moment id", () => {
    assert.equal(promotionMarker(42), "cpp-moment-42");
    assert.equal(momentIdFromMarker(promotionMarker(42)), 42);
  });

  it("rejects anything that isn't exactly one of our markers", () => {
    for (const bad of [undefined, "", "cpp-moment-", "cpp-moment-0", "cpp-moment-01", "cpp-moment-abc", "cpp-moment-4 ", " cpp-moment-4", "moment-4", "cpp-moment-4-x", "cpp-moment-12345678901"]) {
      assert.equal(momentIdFromMarker(bad), null, JSON.stringify(bad));
    }
  });
});

describe("promotion: the Records Division link", () => {
  it("points at records.html with the incident form prefilled and the marker attached", () => {
    const url = new URL(promotionUrl(momentFixture(), "https://jj2sly.github.io/corn.planet"));

    assert.equal(url.origin + url.pathname, "https://jj2sly.github.io/corn.planet/records.html");
    assert.equal(url.searchParams.get("promote"), "cpp-moment-42");
    assert.equal(url.searchParams.get("title"), "The cob has escaped containment during lunch.");
    assert.equal(url.searchParams.get("summary"), "The cob has escaped containment during lunch.");
    assert.equal(url.searchParams.get("resolution"), "Filed it under 'not my problem' & left.", "special characters survive");
    assert.match(url.searchParams.get("addendum")!, /Ann.*3 of 4.*moment #42/);
  });

  it("shortens a long incident for the title but keeps it whole in the summary", () => {
    const context = "An extremely long incident prompt ".repeat(8).trim();
    const url = new URL(promotionUrl(momentFixture({ context }), "https://example.test/site"));

    assert.ok(url.searchParams.get("title")!.length <= 91);
    assert.ok(url.searchParams.get("title")!.endsWith("…"));
    assert.equal(url.searchParams.get("summary"), context);
  });

  it("copes with a trailing slash on the site URL", () => {
    const url = new URL(promotionUrl(momentFixture(), "https://example.test/site/"));
    assert.equal(url.pathname, "/site/records.html");
  });
});

describe("promotion: linking moments to the records filed from them", () => {
  it("marks a moment as canon once a record carrying its marker exists", () => {
    const db = dbWithMoments(2);
    const canon = stubCanon([incident("INC-001"), incident("INC-002", "cpp-moment-2")]);

    assert.equal(reconcilePromotions(db, canon), 1);
    assert.equal(db.getMoment(2)!.canonRef, "INC-002");
    assert.equal(db.getMoment(1)!.canonRef, null, "no marker, no promotion");
  });

  it("is safe to run on every refresh", () => {
    const db = dbWithMoments(1);
    const canon = stubCanon([incident("INC-001", "cpp-moment-1")]);

    assert.equal(reconcilePromotions(db, canon), 1);
    assert.equal(reconcilePromotions(db, canon), 0);
    assert.equal(db.getMoment(1)!.canonRef, "INC-001");
  });

  it("ignores markers for moments that don't exist and markers that aren't ours", () => {
    const db = dbWithMoments(1);
    const canon = stubCanon([incident("INC-001", "cpp-moment-999"), incident("INC-002", "something-else")]);

    assert.equal(reconcilePromotions(db, canon), 0);
    assert.equal(db.getMoment(1)!.canonRef, null);
  });

  it("does nothing while canon is empty, e.g. before the first refresh lands", () => {
    const db = dbWithMoments(1);
    assert.equal(reconcilePromotions(db, stubCanon([])), 0);
  });
});
