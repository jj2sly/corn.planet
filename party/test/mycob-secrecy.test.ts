// My Cob Escaped: an unidentified entity must not be identifiable from anything players are sent.
// Every test here plays or generates unknown-entity incidents on SECRET_CANON, which is built to
// trip each way the entity could leak, and checks the generated incident, the public views, and
// what reaches the director and the narrator.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { CanonRecord } from "../server/canon.ts";
import { DEFAULT_MYCOB_CONFIG, resolveConfig, type ConfigOverrides } from "../server/games/mycob/config.ts";
import { ENTITY_RULES } from "../server/games/mycob/content.ts";
import { validateDirectorOutput, type DirectorContext, type IncidentDirector, type NarrationRequest } from "../server/games/mycob/director.ts";
import { createMyCobGame } from "../server/games/mycob/game.ts";
import { generateIncident, publicBreach, publicEnvironment, revealFact, scrubHidden, type Incident } from "../server/games/mycob/incident.ts";
import { planStage, roleOf } from "../server/games/mycob/rules.ts";
import type { GameDefinition } from "../server/games/types.ts";
import type { Room } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers, SECRET_CANON, secretCanon, seededRandom, stubCanon, UNKNOWN_ENTITY_LEAKS } from "./helpers.ts";

type View = any;

const NEVER_IDENTIFIED: ConfigOverrides = { unknownEntity: { chance: 1, identifyInformationAt: 101, identifyOnCritical: false, autoIdentifyAt: 101 } };
const ENTITY_SPECIFIC_BREACHES = ENTITY_RULES.filter((r) => r.breach).map((r) => r.breach!.name);
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function generate(entity: CanonRecord, seed: number, overrides: ConfigOverrides = NEVER_IDENTIFIED): Incident {
  const canon = secretCanon(entity === SECRET_CANON.gatekeeper ? "gatekeeper" : "howler");
  return generateIncident(
    { entities: [entity], personnel: canon.filter((r) => r.kind === "personnel"), incidents: canon.filter((r) => r.kind === "incident") },
    resolveConfig(DEFAULT_MYCOB_CONFIG, overrides),
    seededRandom(seed),
    { mode: "incident_response", stages: 5, playerCount: 4 },
  );
}

/** Every leak pattern `json` matches, with where it matched. */
const leaks = (json: string) =>
  UNKNOWN_ENTITY_LEAKS.flatMap(({ label, pattern }) => {
    const at = json.search(pattern);
    return at === -1 ? [] : [`${label}: …${json.slice(Math.max(0, at - 80), at + 40)}…`];
  });

/** Leaks in a room payload, apart from facts players have discovered in play (a discovered classification may be shown). */
function leaksIn(payload: View): string[] {
  let json = JSON.stringify(payload);
  for (const f of payload.game?.incident.facts ?? []) json = json.split(JSON.stringify(f.text).slice(1, -1)).join("");
  return leaks(json);
}

describe("My Cob Escaped secrecy: the generated incident", () => {
  it("keeps entity-specific breaches, classification lines, quoted procedures and related staff out of public reach", () => {
    let entitySpecific = 0;
    let identifyingEnvironment = 0;
    let quoting = 0;
    for (const entity of [SECRET_CANON.gatekeeper, SECRET_CANON.howler]) {
      for (let seed = 1; seed <= 60; seed++) {
        const i = generate(entity, seed);
        assert.equal(i.entity.identityKnown, false);
        if (i.breach.entitySpecific) entitySpecific++;
        if (i.environment.some((e) => e.identifying)) identifyingEnvironment++;
        if (i.breach.revealsFields?.length) quoting++;

        const breach = publicBreach(i);
        assert.ok(!ENTITY_SPECIFIC_BREACHES.includes(breach.name), `breach "${breach.name}" gives it away`);
        assert.equal(breach.entitySpecific, false);
        assert.deepEqual(leaks(JSON.stringify(breach)), []);
        assert.deepEqual(leaks(JSON.stringify(publicEnvironment(i))), []);
        assert.ok(!i.personnel.some((p) => p.ref === "PER-013"), "nobody tied to the entity is on the scene");
        assert.ok(i.facts.every((f) => f.about === "incident" || f.visibility === "discoverable" || f.source === "generated"), "no canon fact starts known");
        assert.ok(i.facts.every((f) => !/\b(?:CPE|INC|PER)-\d/.test(f.label)), "no database id in a fact label");
      }
    }
    // The canon really does trigger every path, so the checks above were exercised.
    assert.ok(entitySpecific >= 10, `entity-specific breaches: ${entitySpecific}`);
    assert.ok(identifyingEnvironment >= 10, `classification-keyed environments: ${identifyingEnvironment}`);
    assert.ok(quoting >= 3, `procedure-quoting breaches: ${quoting}`);
  });

  it("shows the real breach, environment and file quote once the entity is identified", () => {
    let checked = 0;
    for (let seed = 1; seed <= 80 && checked < 3; seed++) {
      const i = generate(SECRET_CANON.gatekeeper, seed);
      if (i.breach.id !== "procedure_violation") continue;
      checked++;
      assert.equal(publicBreach(i).name, "Standard Containment Failure");
      assert.doesNotMatch(publicBreach(i).text, /gate shut/i);
      assert.equal(i.facts.find((f) => f.id === "f-containmentProcedures")!.visibility, "discoverable");
      revealFact(i, "f-identity", 2);
      assert.equal(publicBreach(i).name, "Procedure Violation");
      assert.match(publicBreach(i).text, /Keep the gate shut at all times/);
      assert.equal(i.facts.find((f) => f.id === "f-containmentProcedures")!.visibility, "known", "the quote comes with the identity");
    }
    assert.equal(checked, 3);
    for (let seed = 1; seed <= 20; seed++) {
      const i = generate(SECRET_CANON.howler, seed);
      const hidden = i.environment.filter((e) => e.identifying).length;
      revealFact(i, "f-identity", 2);
      assert.equal(publicEnvironment(i).length, i.environment.length, `and every environment line (${hidden} were hidden)`);
    }
  });

  it("still puts staff tied to a known entity on the scene, with their history", () => {
    const i = generate(SECRET_CANON.gatekeeper, 1, { unknownEntity: { chance: 0 } });
    const handler = i.personnel.find((p) => p.ref === "PER-013");
    assert.ok(handler);
    assert.equal(handler.relationship, "has dealt with this entity before");
  });
});

describe("My Cob Escaped secrecy: scrubbing", () => {
  const i = generate(SECRET_CANON.gatekeeper, 3);
  const scrub = (text: string, partialNames = true) => scrubHidden(text, i, undefined, { partialNames });

  it("cuts the name however it is written, the id however it is formatted, and the link", () => {
    for (const text of ["The Spooky Gatekeeper", "the spooky gatekeeper", "SPOOKY-GATEKEEPER's", "Spooky  Gatekeeper", "SpookyGatekeeper"]) {
      assert.doesNotMatch(scrub(text, false), /spooky|gatekeeper/i, text);
    }
    for (const text of ["CPE-013", "cpe 013", "CPE13", "cpe_13", "CPE.013"]) assert.doesNotMatch(scrub(text, false), /cpe/i, text);
    assert.equal(scrub("see https://example.test/CPE-013 now", false), "see [UNIDENTIFIED ENTITY] now");
    assert.doesNotMatch(scrub("as in INC-013 and inc 13", false), /inc[\s-]*0*13/i, "records tied to it");
  });

  it("cuts a single word of the name, and its file labels, from the director's text only", () => {
    assert.equal(scrub("The gatekeeper's back and it's NEUTRALIZED."), "The [UNIDENTIFIED ENTITY] back and it's [DATA WITHHELD].");
    assert.doesNotMatch(scrub("It is under TERMINATION orders"), /TERMINATION/);
    // The engine's own templates are never cut word by word: a cut would itself give the name away.
    assert.equal(scrub("A gatekeeper would help.", false), "A gatekeeper would help.");
  });

  it("cuts near-quotes of undiscovered facts, not just exact ones", () => {
    const out = scrub("Apparently you should KEEP THE GATE shut, at all times — says the file.");
    assert.doesNotMatch(out, /gate shut/i);
    assert.match(out, /\[DATA WITHHELD\]/);
    assert.doesNotMatch(scrub("It guards a door that is not there, apparently."), /door that is not there/i);
    // Ordinary words that happen to share a couple with the file stay.
    assert.equal(scrub("Keep the doors shut."), "Keep the doors shut.");
  });

  it("stops cutting once the entity is identified", () => {
    const known = generate(SECRET_CANON.gatekeeper, 3);
    revealFact(known, "f-identity", 1);
    assert.equal(scrubHidden("The Spooky Gatekeeper (CPE-013)", known, undefined, { partialNames: true }), "The Spooky Gatekeeper (CPE-013)");
  });

  it("scrubs a director that tries every trick at once", () => {
    const config = resolveConfig(DEFAULT_MYCOB_CONFIG, NEVER_IDENTIFIED);
    const input = { playerId: "a", playerName: "Ann", role: roleOf(config, "commander"), tag: "INVESTIGATE" as const, approach: "standard" as const, sacrifice: false, text: "Read the file", previousTags: [] };
    const plan = planStage([input], ["a"], i, 1, 5, config, seededRandom(1));
    const trick = "The Spooky-Gatekeeper's file (cpe 13, https://example.test/CPE-013) says keep THE GATE shut, at all times! It is NEUTRALIZED; the gatekeeper hates INC-013.";
    const out = validateDirectorOutput(
      {
        narration: trick,
        actionInterpretations: [{ actionId: plan.actions[0]!.id, summary: trick.slice(0, 150) }],
        newInformation: [{ label: "Gatekeeper lore", text: trick }],
        newObjectives: [{ text: "Calm the gatekeeper down" }],
      },
      plan,
      i,
      config,
    )!;
    assert.deepEqual(leaks(JSON.stringify(out)), []);
    assert.doesNotMatch(JSON.stringify(out), /gate shut/i);
  });
});

describe("My Cob Escaped secrecy: what players are sent", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
  afterEach(() => mock.timers.reset());

  function start(canon: CanonRecord[], seed: number, options: { config?: ConfigOverrides; director?: IncidentDirector } = {}) {
    const game = createMyCobGame({ director: options.director, config: options.config ?? NEVER_IDENTIFIED });
    const rooms = makeRooms({ games: new Map([["mycob", game as GameDefinition]]), canon: stubCanon(canon), random: seededRandom(seed) });
    const { room, players } = roomWithPlayers(rooms.manager, ["Ann", "Bo", "Cy"]);
    room.configure({ gameId: "mycob", settings: { length: "short" } });
    room.startGame();
    return { ...rooms, room, ids: players.map((p) => p.id) };
  }

  const view = (room: Room, playerId?: string): View => room.viewFor(playerId ? { kind: "player", playerId } : { kind: "host" });

  /** Plays a whole game, checking the full room payload of every screen at every step until the outcome. */
  async function playChecked(room: Room, ids: string[], entity: CanonRecord) {
    const secrets = [entity.fields.containmentProcedures!, entity.fields.description!];
    let checked = 0;
    for (let guard = 0; guard < 200 && room.status === "IN_GAME"; guard++) {
      const phase = view(room).game.phase;
      if (["OUTCOME", "AWARD_SUBMIT", "AWARD_VOTE", "AWARD_RESULTS"].includes(phase)) break;
      for (const viewer of [undefined, ...ids]) {
        const payload = view(room, viewer);
        const json = JSON.stringify(payload);
        assert.deepEqual(leaksIn(payload), [], `${viewer ?? "host"} in ${phase}: ${json.slice(0, 400)}`);
        assert.deepEqual(payload.game.incident.entity, { known: false });
        // The entity's own file text only once it has been discovered in play.
        const known = new Set(payload.game.incident.facts.map((f: View) => f.text));
        for (const secret of secrets) if (json.includes(secret)) assert.ok(known.has(secret), `"${secret}" before it was discovered`);
        checked++;
      }
      if (phase === "RESPONSE") {
        ids.forEach((id, n) => view(room).game.phase === "RESPONSE" && room.gameInput(id, "respond", { tag: ["INVESTIGATE", "COMMUNICATE", "CONTAIN"][n], text: `Agent ${n} reads the file and asks around` }));
        await settle();
        continue;
      }
      room.hostGameAction("skip", {});
      await settle();
    }
    return checked;
  }

  it("never identifies the entity in any screen's payload, through a whole game", async () => {
    const records: View[] = [];
    let checked = 0;
    for (const which of ["gatekeeper", "howler"] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const { room, ids, db } = start(secretCanon(which), seed);
        checked += await playChecked(room, ids, SECRET_CANON[which]);
        room.returnToLobby();
        records.push(db.listAbortedGames("mycob")[0]!.data);
      }
    }
    assert.ok(checked > 300, `checked ${checked} payloads`);
    // The games really did hit the dangerous cases.
    assert.ok(records.some((r) => r.incident.breach.entitySpecific), "an entity-specific breach");
    assert.ok(records.some((r) => r.incident.environment.some((e: View) => e.identifying)), "a classification-keyed environment");
    assert.ok(
      records.some((r) => r.incident.final.facts.some((f: View) => f.source === "canon" && f.id !== "f-identity" && f.revealedStage !== null)),
      "canon discovered while the entity was still unknown",
    );
  });

  it("scrubs a director and narrator that try to leak it", async () => {
    const trick = "The Spooky-Gatekeeper's file (cpe 13, https://example.test/CPE-013) says keep THE GATE shut, at all times! It is NEUTRALIZED under TERMINATION rules, and the gatekeeper hates INC-013.";
    const contexts: DirectorContext[] = [];
    const requests: NarrationRequest[] = [];
    const leaky: IncidentDirector = {
      id: "leaky",
      async resolveStage(ctx) {
        contexts.push(ctx);
        return {
          narration: trick,
          actionInterpretations: ctx.actions.map((a) => ({ actionId: a.actionId, summary: trick.slice(0, 150), usesRole: true, novelty: "wild" })),
          lifeEvents: [...ctx.actions.filter((a) => a.lifeAtRisk), ...ctx.hazards].map((a) => ({ playerId: a.playerId, reason: "The Spooky Gatekeeper got them." })),
          newInformation: [{ label: "Gatekeeper lore", text: trick }],
          newObjectives: [{ text: "Calm the gatekeeper down" }],
          specialEvents: [{ text: trick }],
        };
      },
      async narrate(request) {
        requests.push(request);
        return trick;
      },
    };
    const { room, ids } = start(secretCanon("gatekeeper"), 5, { director: leaky });
    await settle();
    assert.ok((await playChecked(room, ids, SECRET_CANON.gatekeeper)) > 20);
    assert.ok(contexts.length > 0);

    // The director is still told the entity (it needs it), but not a breach or environment players weren't shown.
    for (const ctx of contexts) {
      assert.equal(ctx.incident.entity.title, "The Spooky Gatekeeper");
      assert.deepEqual(leaks(JSON.stringify({ breach: ctx.incident.breach, environment: ctx.incident.environment })), []);
    }
    // The opening is asked for without the entity at all.
    const opening = requests.find((r) => r.kind === "opening")!;
    assert.deepEqual(leaks(JSON.stringify(opening)), []);
  });

  it("makes the entity visible through the identification reveal, and only then", async () => {
    const config: ConfigOverrides = { unknownEntity: { chance: 1, identifyInformationAt: 0 }, randomness: { baseSuccess: 0.9, maxSuccess: 0.95 } };
    const { room, ids, db } = start(secretCanon("gatekeeper"), 2, { config });
    let identifiedAt: number | null = null;
    for (let guard = 0; guard < 200 && room.status === "IN_GAME" && identifiedAt === null; guard++) {
      const v = view(room).game;
      if (v.incident.entity.known) {
        identifiedAt = v.stage;
        assert.equal(v.incident.entity.title, "The Spooky Gatekeeper");
        assert.ok(v.narration.some((n: View) => /Discovered — Entity identity/.test(n.text)), "announced as a discovery");
        break;
      }
      assert.deepEqual(leaksIn(view(room)), []);
      if (v.phase === "RESPONSE") {
        for (const id of ids) if (view(room).game.phase === "RESPONSE") room.gameInput(id, "respond", { tag: "INVESTIGATE", text: "Read every file we have" });
        await settle();
        continue;
      }
      room.hostGameAction("skip", {});
      await settle();
    }
    assert.ok(identifiedAt !== null, "identified in play");
    // From then on it's in the open: the real breach, and database links.
    const v = view(room).game;
    room.returnToLobby();
    const saved = db.listAbortedGames("mycob")[0]!.data as View;
    assert.equal(v.incident.breach.name, saved.incident.breach.name);
    assert.equal(saved.incident.identifiedAtStage, identifiedAt);
  });
});
