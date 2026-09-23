import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CanonRecord } from "../server/canon.ts";
import { DEFAULT_MYCOB_CONFIG, resolveConfig, type MyCobConfig } from "../server/games/mycob/config.ts";
import { BREACHES, ENTITY_RULES, LOCATIONS, PROBLEMS, type LocationDef } from "../server/games/mycob/content.ts";
import {
  describeStat,
  entityDifficulty,
  evaluateObjectives,
  generateIncident,
  revealFact,
  ruleMatches,
  scrubHidden,
  type Incident,
  type IncidentSources,
} from "../server/games/mycob/incident.ts";
import { seededRandom, TEST_CANON } from "./helpers.ts";

function record(ref: string, kind: CanonRecord["kind"], title: string, fields: Record<string, string>, links: Record<string, string[]> = {}): CanonRecord {
  return { ref, kind, title, fields, links, url: `https://example.test/${ref}` };
}

const ENTITIES = TEST_CANON.filter((r) => r.kind === "entity");
const PERSONNEL = [
  record("PER-001", "personnel", "Agent Kernel", { status: "ACTIVE", designation: "Field Agent", description: "Has seen things." }),
  record("PER-002", "personnel", "Dr. Deceased", { status: "DECEASED", designation: "Researcher" }),
  record("PER-003", "personnel", "Agent Missing", { status: "MIA", designation: "Field Agent" }, { notableIncidents: ["INC-001"] }),
];
const INCIDENTS = [record("INC-001", "incident", "The Great Husk Spill", { summary: "Big Yellow was watered." }, { entitiesInvolved: ["CPE-005"] })];

function generate(seed: number, options: { config?: MyCobConfig; entityRef?: string; sources?: Partial<IncidentSources>; players?: number } = {}): Incident {
  return generateIncident(
    { entities: ENTITIES, personnel: PERSONNEL, incidents: INCIDENTS, ...options.sources },
    options.config ?? DEFAULT_MYCOB_CONFIG,
    seededRandom(seed),
    { mode: "incident_response", stages: 5, playerCount: options.players ?? 4, entityRef: options.entityRef },
  );
}

const many = (n: number, fn: (seed: number) => Incident) => Array.from({ length: n }, (_, i) => fn(i + 1));
const withConfig = (overrides: Parameters<typeof resolveConfig>[1]) => resolveConfig(DEFAULT_MYCOB_CONFIG, overrides);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("My Cob Escaped: incident generation", () => {
  it("picks the entity at random from canon, and every entity can come up", () => {
    const refs = new Set(many(80, (s) => generate(s)).map((i) => i.entity.ref));
    assert.deepEqual([...refs].sort(), ENTITIES.map((e) => e.ref).sort());
    for (const i of many(20, (s) => generate(s))) assert.ok(i.canonRefs.includes(i.entity.ref));
  });

  it("draws different breach types, locations and problems", () => {
    const incidents = many(80, (s) => generate(s));
    assert.ok(new Set(incidents.map((i) => i.breach.id)).size >= 5, "several breach types");
    assert.ok(new Set(incidents.map((i) => i.location.id)).size >= 6, "several locations");
    assert.ok(new Set(incidents.map((i) => i.problem.id)).size >= 6, "several starting problems");
    for (const i of incidents) {
      assert.ok(LOCATIONS.some((l) => l.id === i.location.id));
      assert.ok(PROBLEMS.some((p) => p.id === i.problem.id));
      assert.doesNotMatch(`${i.breach.text} ${i.problem.text}`, /\{\w+\}/, "every template placeholder is filled");
    }
  });

  it("turns the same entity into substantially different incidents", () => {
    const incidents = many(30, (s) => generate(s, { entityRef: "CPE-002" }));
    assert.ok(incidents.every((i) => i.entity.ref === "CPE-002"));
    const shapes = new Set(incidents.map((i) => `${i.breach.id}/${i.location.id}/${i.problem.id}`));
    assert.ok(shapes.size >= 20, `only ${shapes.size} distinct incidents`);
    assert.ok(new Set(incidents.map((i) => i.difficulty)).size >= 10, "difficulty varies for one entity");
  });

  it("adds entity-specific incident types and effects from general rules", () => {
    const termination = record("CPE-900", "entity", "The Unkillable", { classification: "NEUTRALIZED", containment: "TERMINATION", containmentProcedures: "Burn it." });
    const incidents = many(60, (s) => generate(s, { sources: { entities: [termination] } }));
    const specific = incidents.filter((i) => i.breach.entitySpecific);
    assert.ok(specific.length > 0, "entity-specific breaches happen");
    assert.ok(specific.some((i) => i.breach.id === "termination_misfire" || i.breach.id === "neutralization_reversal"));
    assert.ok(incidents.some((i) => !i.breach.entitySpecific), "but not always");

    // Big Yellow's own file ("Do not water.") triggers the water rule by text, not by id.
    const yellow = many(40, (s) => generate(s, { entityRef: "CPE-005" }));
    assert.ok(yellow.some((i) => i.rulesApplied.includes("water_sensitive")));
    assert.ok(yellow.every((i) => i.rulesApplied.every((id) => ENTITY_RULES.some((r) => r.id === id))));
  });

  it("matches rules by id, classification, containment, file text and field presence", () => {
    const e = record("CPE-777", "entity", "Test", { classification: "COSMIC", containment: "MAXIMUM", description: "It stares.", containmentProcedures: "/r x /r" });
    const clean = { ...e, fields: { ...e.fields, containmentProcedures: "Do not stare." } };
    assert.equal(ruleMatches({ id: "a", match: { refs: ["CPE-777"] }, chance: 1 }, e), true);
    assert.equal(ruleMatches({ id: "b", match: { refs: ["CPE-001"] }, chance: 1 }, e), false);
    assert.equal(ruleMatches({ id: "c", match: { classifications: ["COSMIC"], containment: ["MAXIMUM"] }, chance: 1 }, e), true);
    assert.equal(ruleMatches({ id: "d", match: { textIncludes: ["stare"] }, chance: 1 }, e), true);
    // A field still hiding something ([REDACTED]) doesn't count as present.
    const redacted = { ...e, fields: { ...e.fields, containmentProcedures: "[REDACTED]" } };
    assert.equal(ruleMatches({ id: "e", match: { hasField: "containmentProcedures" }, chance: 1 }, redacted), false);
    assert.equal(ruleMatches({ id: "e", match: { hasField: "containmentProcedures" }, chance: 1 }, clean), true);
  });

  it("makes harder containment and classification harder on average, but never deterministic", () => {
    const easy = record("CPE-801", "entity", "Easy", { classification: "LOCAL", containment: "MINIMAL" });
    const hard = record("CPE-802", "entity", "Hard", { classification: "LOCAL", containment: "MAXIMUM", containmentProcedures: "One. Two. Three. Four." });
    const cosmic = record("CPE-803", "entity", "Cosmic", { classification: "COSMIC", containment: "MINIMAL" });
    assert.ok(entityDifficulty(hard, DEFAULT_MYCOB_CONFIG) > entityDifficulty(easy, DEFAULT_MYCOB_CONFIG));
    assert.ok(entityDifficulty(cosmic, DEFAULT_MYCOB_CONFIG) > entityDifficulty(easy, DEFAULT_MYCOB_CONFIG));

    const run = (e: CanonRecord) => many(120, (s) => generate(s, { sources: { entities: [e] } }));
    const [e, h, c] = [run(easy), run(hard), run(cosmic)];
    assert.ok(avg(h.map((i) => i.difficulty)) > avg(e.map((i) => i.difficulty)) + 8, "containment raises difficulty");
    assert.ok(avg(c.map((i) => i.difficulty)) > avg(e.map((i) => i.difficulty)) + 8, "classification raises difficulty");
    assert.ok(avg(h.map((i) => i.stats.containment)) < avg(e.map((i) => i.stats.containment)), "and lowers starting containment");
    // Unpredictable: some cosmic incidents start easier than some local ones.
    assert.ok(Math.min(...c.map((i) => i.difficulty)) < Math.max(...e.map((i) => i.difficulty)));
    assert.ok(c.some((i) => i.notes.includes("lucky break")) && e.some((i) => i.notes.includes("bad day")));
  });

  it("starts some incidents with the entity unknown, as often as configured", () => {
    const always = withConfig({ unknownEntity: { chance: 1 } });
    for (const i of many(10, (s) => generate(s, { config: always }))) {
      assert.equal(i.entity.identityKnown, false);
      assert.equal(i.entity.initiallyUnknown, true);
      assert.equal(i.facts.find((f) => f.about === "identity")!.visibility, "discoverable");
      assert.equal(i.objectives.find((o) => o.kind === "primary")!.text, "Identify and contain the unknown entity");
      assert.doesNotMatch(i.problem.text + i.breach.text, new RegExp(i.entity.title, "i"));
    }
    const never = withConfig({ unknownEntity: { chance: 0 } });
    assert.ok(many(30, (s) => generate(s, { config: never })).every((i) => i.entity.identityKnown));
    const share = many(200, (s) => generate(s)).filter((i) => i.entity.initiallyUnknown).length / 200;
    assert.ok(share > 0.12 && share < 0.5, `default unknown share ${share}`);
  });

  it("uses real location records when given them", () => {
    const vault: LocationDef = { id: "vault", name: "The Vault", description: "Canon place.", difficulty: 1, keywords: ["vault"], source: "canon", ref: "LOC-001" };
    const i = generate(3, { sources: { locations: [vault] } });
    assert.equal(i.location.id, "vault");
  });

  it("generates facility state, forced by the breach and worse when it's harder", () => {
    const incidents = many(120, (s) => generate(s));
    for (const i of incidents.filter((x) => x.breach.id === "power_failure")) assert.equal(i.systems.power, "offline");
    const damage = (i: Incident) => Object.values(i.systems).filter((c) => c !== "nominal").length;
    const hardest = [...incidents].sort((a, b) => b.difficulty - a.difficulty).slice(0, 30);
    const easiest = [...incidents].sort((a, b) => a.difficulty - b.difficulty).slice(0, 30);
    assert.ok(avg(hardest.map(damage)) > avg(easiest.map(damage)));
    for (const i of incidents) {
      for (const [id, v] of Object.entries(i.stats)) assert.ok(v >= 0 && v <= 100, `${id}=${v}`);
      assert.ok(i.stats.containment < DEFAULT_MYCOB_CONFIG.endings.containedAt, "never starts contained");
    }
  });

  it("mixes real personnel files with generated, game-only staff", () => {
    for (const i of many(20, (s) => generate(s))) {
      const canon = i.personnel.filter((p) => p.source === "canon");
      const generated = i.personnel.filter((p) => p.source === "generated");
      assert.ok(canon.length <= DEFAULT_MYCOB_CONFIG.personnel.canonMax);
      assert.ok(canon.every((p) => p.ref && p.ref !== "PER-002"), "deceased canon personnel are never pulled in");
      assert.ok(generated.length >= DEFAULT_MYCOB_CONFIG.personnel.generatedMin);
      assert.ok(generated.every((p) => p.ref === null && p.url === null), "generated staff never carry a canon id");
      assert.ok(new Set(i.personnel.map((p) => p.name)).size === i.personnel.length, "no duplicate names");
      for (const p of canon) assert.ok(i.canonRefs.includes(p.ref!));
    }
    // A canon MIA file becomes a missing staff member; files tied to a known entity's past are preferred.
    const withYellow = many(20, (s) => generate(s, { entityRef: "CPE-005", config: withConfig({ unknownEntity: { chance: 0 } }) }));
    assert.ok(withYellow.every((i) => i.personnel.some((p) => p.ref === "PER-003")), "related personnel preferred");
    assert.ok(withYellow.some((i) => i.personnel.find((p) => p.ref === "PER-003")?.status === "missing"));
    assert.ok(withYellow.every((i) => i.facts.some((f) => f.ref === "INC-001" && f.visibility === "discoverable")), "prior incidents are discoverable");

    const noCanon = generate(5, { sources: { personnel: [], incidents: [] } });
    assert.ok(noCanon.personnel.length >= 2 && noCanon.personnel.every((p) => p.source === "generated"));
  });

  it("creates a primary objective and secondaries that fit the situation", () => {
    for (const i of many(40, (s) => generate(s))) {
      const primary = i.objectives.filter((o) => o.kind === "primary");
      assert.equal(primary.length, 1);
      const secondary = i.objectives.filter((o) => o.kind === "secondary");
      assert.ok(secondary.length >= 1 && secondary.length <= DEFAULT_MYCOB_CONFIG.objectives.secondaryMax);
      const trapped = i.personnel.find((p) => p.status === "trapped");
      if (trapped) assert.ok(i.objectives.some((o) => o.goal.type === "rescue" && o.goal.npcId === trapped.id), "someone trapped means a rescue");
    }
  });
});

describe("My Cob Escaped: state, statuses and information", () => {
  it("maps numbers to qualitative statuses with configurable thresholds", () => {
    assert.equal(describeStat("containment", 85, DEFAULT_MYCOB_CONFIG).value, "SECURE");
    assert.equal(describeStat("containment", 45, DEFAULT_MYCOB_CONFIG).value, "UNSTABLE");
    assert.equal(describeStat("containment", 0, DEFAULT_MYCOB_CONFIG).value, "BREACHED");
    assert.equal(describeStat("personnel", 60, DEFAULT_MYCOB_CONFIG).value, "AT RISK");
    assert.equal(describeStat("chaos", 65, DEFAULT_MYCOB_CONFIG).tone, "danger");
    const custom = withConfig({ stats: { labels: { ...DEFAULT_MYCOB_CONFIG.stats.labels, time: [{ min: 50, label: "PLENTY", tone: "ok" }, { min: 0, label: "GONE", tone: "danger" }] } } });
    assert.equal(describeStat("time", 51, custom).value, "PLENTY");
    assert.equal(describeStat("time", 49, custom).value, "GONE");
  });

  it("scrubs an unidentified entity's name and undiscovered facts from text", () => {
    const i = generate(1, { config: withConfig({ unknownEntity: { chance: 1 } }), entityRef: "CPE-005" });
    const hidden = i.facts.find((f) => f.id === "f-description")!;
    const text = `Big Yellow (CPE-005) says: ${hidden.text} ... and "big yellow" again.`;
    const scrubbed = scrubHidden(text, i);
    assert.doesNotMatch(scrubbed, /big yellow|CPE-005/i);
    revealFact(i, "f-identity", 2);
    assert.match(scrubHidden("Big Yellow", i), /Big Yellow/);
  });

  it("reveals the identity with the file header, and only once", () => {
    const i = generate(2, { config: withConfig({ unknownEntity: { chance: 1 } }) });
    const revealed = revealFact(i, "f-identity", 3);
    assert.deepEqual(revealed.map((f) => f.id).sort(), ["f-classification", "f-containment", "f-identity"]);
    assert.equal(i.entity.identityKnown, true);
    assert.equal(i.entity.revealedStage, 3);
    assert.deepEqual(revealFact(i, "f-identity", 4), []);
  });

  it("evaluates objectives: completion, deadlines and impossibility", () => {
    const i = generate(7);
    const npc = i.personnel[0]!;
    i.objectives.push(
      { id: "o-r", kind: "secondary", text: "Rescue", goal: { type: "rescue", npcId: npc.id }, status: "active", createdStage: 0, resolvedStage: null, source: "generated" },
      { id: "o-s", kind: "secondary", text: "Stat", goal: { type: "stat", stat: "facility", atLeast: 101, byStage: 2 }, status: "active", createdStage: 0, resolvedStage: null, source: "generated" },
    );
    npc.status = "dead";
    evaluateObjectives(i, 2, false);
    assert.equal(i.objectives.find((o) => o.id === "o-r")!.status, "impossible");
    assert.equal(i.objectives.find((o) => o.id === "o-s")!.status, "failed");
    i.stats.containment = 99;
    evaluateObjectives(i, 3, false);
    const primary = i.objectives.find((o) => o.kind === "primary")!;
    if (primary.goal.type === "contain") assert.equal(primary.status, "completed");
  });

  it("only ever has built-in breach types plus the rules' own", () => {
    const ids = new Set([...BREACHES.map((b) => b.id), ...ENTITY_RULES.flatMap((r) => (r.breach ? [r.breach.id] : []))]);
    for (const i of many(50, (s) => generate(s))) assert.ok(ids.has(i.breach.id));
  });
});
