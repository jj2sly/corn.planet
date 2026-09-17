import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCanonService, isRedacted, stripRedactions } from "../server/canon.ts";
import { seededRandom } from "./helpers.ts";

// ------------------------------------------------------------------ Firestore REST fakes

function stringValue(value: string) {
  return { stringValue: value };
}

function arrayValue(values: string[]) {
  return { arrayValue: { values: values.map(stringValue) } };
}

function entityDoc(ref: string, fields: Record<string, unknown>) {
  return { name: `projects/p/databases/(default)/documents/entities/${ref}`, fields };
}

function incidentDoc(ref: string, fields: Record<string, unknown>) {
  return { name: `projects/p/databases/(default)/documents/incidents/${ref}`, fields };
}

function personnelDoc(ref: string, fields: Record<string, unknown>) {
  return { name: `projects/p/databases/(default)/documents/personnel/${ref}`, fields };
}

const ENTITIES = [
  entityDoc("CPE-001", {
    title: stringValue("The Evil Jik"),
    classification: stringValue("COSMIC"),
    containment: stringValue("MAXIMUM"),
    description: stringValue("A long\n\nand rambling   description."),
    containmentProcedures: stringValue("Do not make eye contact."),
  }),
  entityDoc("CPE-002", {
    title: stringValue("Thad Phelps"),
    classification: stringValue("EARTHLY"),
    containment: stringValue("STANDARD"),
    containmentProcedures: stringValue("Give him steam deck."),
  }),
  entityDoc("CPE-004", {
    title: stringValue("Chuck"),
    classification: stringValue("LOCAL"),
    containment: stringValue("MINIMAL"),
    description: stringValue("Chuck is /rvery dangerous/r and also /r!a liar/r!."),
  }),
];

const INCIDENTS = [
  incidentDoc("INC-001", {
    title: stringValue("The Cornfield Breach"),
    severity: stringValue("SEVERE"),
    status: stringValue("CONTAINED"),
    summary: stringValue("Something got out."),
    entitiesInvolved: arrayValue(["CPE-001", "CPE-004"]),
    personnelInvolved: arrayValue(["PER-001"]),
  }),
];

const PERSONNEL = [
  personnelDoc("PER-001", {
    title: stringValue("Agent Kernel"),
    status: stringValue("ACTIVE"),
    clearance: stringValue("LEVEL 3"),
    designation: stringValue("Field Agent"),
    notableIncidents: arrayValue(["INC-001"]),
  }),
];

/** A fetch stand-in that serves the fakes above and counts calls per collection. */
function fakeFetch(options: { fail?: boolean; paginate?: boolean } = {}) {
  const calls: string[] = [];

  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    const collection = url.pathname.split("/").pop()!;
    calls.push(collection);

    if (options.fail) throw new Error("network down");

    const byCollection: Record<string, unknown[]> = {
      entities: ENTITIES,
      incidents: INCIDENTS,
      personnel: PERSONNEL,
    };
    const docs = byCollection[collection] ?? [];

    // With pagination on, entities come back one document per page.
    if (options.paginate && collection === "entities") {
      const token = url.searchParams.get("pageToken");
      const index = token ? Number(token) : 0;
      const next = index + 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          documents: docs.slice(index, next),
          ...(next < docs.length ? { nextPageToken: String(next) } : {}),
        }),
      } as Response;
    }

    return { ok: true, status: 200, json: async () => ({ documents: docs }) } as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

async function makeCanon(options: Parameters<typeof fakeFetch>[0] = {}) {
  const { fetchImpl, calls } = fakeFetch(options);
  const canon = createCanonService({
    projectId: "cpo-9af17",
    siteUrl: "https://example.test/corn.planet/",
    fetchImpl,
  });
  await canon.refresh();
  return { canon, calls };
}

// ------------------------------------------------------------------ tests

describe("canon: redaction handling", () => {
  it("removes redacted spans instead of revealing them, longest marker first", () => {
    assert.equal(stripRedactions("a /rsecret/r b"), "a [REDACTED] b");
    assert.equal(stripRedactions("a /r!secret/r! b"), "a [CLASSIFIED] b");
    assert.equal(stripRedactions("a /r!!secret/r!! b"), "a [COSMIC ERASED] b");
    assert.equal(stripRedactions("plain text"), "plain text");
  });

  it("never leaks the hidden text", () => {
    const cleaned = stripRedactions("The password is /r!!hunter2/r!! exactly.");
    assert.ok(!cleaned.includes("hunter2"));
    assert.ok(isRedacted(cleaned));
  });

  it("flags redacted fields so games can skip them", () => {
    assert.equal(isRedacted("nothing hidden here"), false);
    assert.equal(isRedacted("some [REDACTED] thing"), true);
  });
});

describe("canon: loading records", () => {
  it("parses every collection into records with refs, kinds, titles and deep links", async () => {
    const { canon } = await makeCanon();
    const all = canon.all();

    assert.equal(all.length, 5);

    const jik = canon.get("CPE-001");
    assert.ok(jik);
    assert.equal(jik.kind, "entity");
    assert.equal(jik.title, "The Evil Jik");
    assert.equal(jik.fields.classification, "COSMIC");
    assert.equal(jik.fields.containmentProcedures, "Do not make eye contact.");
    // Whitespace is collapsed so long text fits a host screen.
    assert.equal(jik.fields.description, "A long and rambling description.");
    // The trailing slash on siteUrl is normalised away.
    assert.equal(jik.url, "https://example.test/corn.planet/entry.html?id=CPE-001");
  });

  it("strips redactions out of loaded fields", async () => {
    const { canon } = await makeCanon();
    const chuck = canon.get("CPE-004");
    assert.ok(chuck);
    assert.equal(chuck.fields.description, "Chuck is [REDACTED] and also [CLASSIFIED].");
    assert.ok(!chuck.fields.description.includes("very dangerous"));
  });

  it("keeps cross-references and points them at the right pages", async () => {
    const { canon } = await makeCanon();

    const incident = canon.get("INC-001");
    assert.ok(incident);
    assert.equal(incident.kind, "incident");
    assert.deepEqual(incident.links.entitiesInvolved, ["CPE-001", "CPE-004"]);
    assert.deepEqual(incident.links.personnelInvolved, ["PER-001"]);
    assert.equal(incident.url, "https://example.test/corn.planet/incident-entry.html?id=INC-001");

    const agent = canon.get("PER-001");
    assert.ok(agent);
    assert.deepEqual(agent.links.notableIncidents, ["INC-001"]);
    assert.equal(agent.url, "https://example.test/corn.planet/personnel-entry.html?id=PER-001");
  });

  it("omits empty fields rather than storing blanks", async () => {
    const { canon } = await makeCanon();
    const thad = canon.get("CPE-002");
    assert.ok(thad);
    assert.equal("description" in thad.fields, false);
    assert.deepEqual(thad.links, {});
  });

  it("follows nextPageToken until the collection is exhausted", async () => {
    const { canon, calls } = await makeCanon({ paginate: true });
    const entities = canon.byKind("entity");

    assert.equal(entities.length, 3);
    assert.equal(calls.filter((c) => c === "entities").length, 3);
  });

  it("returns null for a ref that is not canon", async () => {
    const { canon } = await makeCanon();
    assert.equal(canon.get("CPE-999"), null);
    assert.equal(canon.get(""), null);
  });
});

describe("canon: caching and failure", () => {
  it("reads each collection once per refresh, and never on a plain read", async () => {
    const { canon, calls } = await makeCanon();

    canon.all();
    canon.all();
    canon.byKind("entity");
    canon.get("CPE-001");

    assert.deepEqual(calls.sort(), ["entities", "incidents", "personnel"]);
  });

  it("collapses overlapping refreshes into one", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const canon = createCanonService({ projectId: "p", fetchImpl });

    await Promise.all([canon.refresh(), canon.refresh(), canon.refresh()]);

    assert.equal(calls.filter((c) => c === "entities").length, 1);
  });

  it("picks up new canon on the next refresh", async () => {
    const { canon, calls } = await makeCanon();
    assert.equal(calls.filter((c) => c === "entities").length, 1);

    await canon.refresh();

    assert.equal(calls.filter((c) => c === "entities").length, 2);
    assert.equal(canon.byKind("entity").length, 3);
  });

  it("reports empty canon instead of throwing when Firestore is unreachable", async () => {
    const { canon } = await makeCanon({ fail: true });

    const all = canon.all();
    assert.deepEqual(all, []);
    assert.equal(canon.get("CPE-001"), null);

    const status = canon.status();
    assert.equal(status.records, 0);
    assert.ok(status.lastError);
  });

  it("keeps serving the last good snapshot when a later refresh fails", async () => {
    let fail = false;
    const fetchImpl = (async (input: string | URL) => {
      if (fail) throw new Error("network down");
      const collection = new URL(String(input)).pathname.split("/").pop()!;
      const docs = collection === "entities" ? ENTITIES : [];
      return { ok: true, status: 200, json: async () => ({ documents: docs }) } as Response;
    }) as unknown as typeof fetch;

    const canon = createCanonService({ projectId: "p", fetchImpl });
    await canon.refresh();

    assert.equal(canon.all().length, 3);

    fail = true;
    await canon.refresh();
    const afterFailure = canon.all();

    assert.equal(afterFailure.length, 3, "a failed refresh must not empty the cache mid-round");
    assert.ok(canon.status().lastError);
  });

  it("keeps the collections that loaded when only some are unreadable", async () => {
    // Exactly the live situation before the incidents/personnel Firestore rules are applied.
    const fetchImpl = (async (input: string | URL) => {
      const collection = new URL(String(input)).pathname.split("/").pop()!;
      if (collection !== "entities") {
        return { ok: false, status: 403, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ documents: ENTITIES }) } as Response;
    }) as unknown as typeof fetch;

    const canon = createCanonService({ projectId: "p", fetchImpl });
    await canon.refresh();

    assert.equal(canon.byKind("entity").length, 3, "entities must survive a 403 elsewhere");
    assert.equal((canon.byKind("incident")).length, 0);
    assert.match(canon.status().lastError ?? "", /403/);
    assert.equal(canon.status().records, 3);
  });

  it("treats a non-200 response as a failure", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 503, json: async () => ({}) }) as Response) as unknown as typeof fetch;

    const canon = createCanonService({ projectId: "p", fetchImpl });
    await canon.refresh();
    assert.deepEqual(canon.all(), []);
    assert.match(canon.status().lastError ?? "", /503/);
  });
});

describe("canon: sampling", () => {
  it("returns distinct records of the asked-for kind", async () => {
    const { canon } = await makeCanon();
    const picked = canon.sample("entity", 3, seededRandom(7));

    assert.equal(picked.length, 3);
    assert.equal(new Set(picked.map((r) => r.ref)).size, 3);
    assert.ok(picked.every((r) => r.kind === "entity"));
  });

  it("returns everything it has when asked for more than exists", async () => {
    const { canon } = await makeCanon();
    const picked = canon.sample("personnel", 10, seededRandom(7));

    assert.equal(picked.length, 1);
    assert.equal(picked[0]!.ref, "PER-001");
  });

  it("is deterministic for a seeded random, so games are reproducible in tests", async () => {
    const a = (await makeCanon()).canon;
    const b = (await makeCanon()).canon;

    const first = a.sample("entity", 3, seededRandom(99));
    const second = b.sample("entity", 3, seededRandom(99));

    assert.deepEqual(
      first.map((r) => r.ref),
      second.map((r) => r.ref),
    );
  });

  it("does not hand out the shared cache for callers to mutate", async () => {
    const { canon } = await makeCanon();

    const picked = canon.sample("entity", 3, seededRandom(1));
    picked.length = 0;

    assert.equal((canon.byKind("entity")).length, 3);
  });
});
