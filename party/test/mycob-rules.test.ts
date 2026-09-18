import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_MYCOB_CONFIG, resolveConfig, type ConfigOverrides, type MyCobConfig, type Outcome, type ResponseTag } from "../server/games/mycob/config.ts";
import { buildDirectorContext, MockIncidentDirector, validateDirectorOutput } from "../server/games/mycob/director.ts";
import { generateIncident, type Incident } from "../server/games/mycob/incident.ts";
import {
  analyzeResponse,
  applyStage,
  checkEnding,
  effectEnvelope,
  planStage,
  roleOf,
  scoreStage,
  specialEventChance,
  successChance,
  type ActionInput,
  type StagePlan,
} from "../server/games/mycob/rules.ts";
import { seededRandom, TEST_CANON } from "./helpers.ts";

function setup(seed = 1, overrides: ConfigOverrides = {}, entityRef = "CPE-002") {
  const config = resolveConfig(DEFAULT_MYCOB_CONFIG, { unknownEntity: { chance: 0 } }, overrides);
  const incident = generateIncident({ entities: TEST_CANON.filter((r) => r.kind === "entity") }, config, seededRandom(seed), {
    mode: "incident_response",
    stages: 5,
    playerCount: 4,
    entityRef,
  });
  return { config, incident };
}

function input(id: string, tag: ResponseTag, text = "Do the thing carefully", role = "commander", extra: Partial<ActionInput> = {}): ActionInput {
  return {
    playerId: id,
    playerName: id.toUpperCase(),
    role: roleOf(DEFAULT_MYCOB_CONFIG, role),
    tag,
    approach: "standard",
    sacrifice: false,
    text,
    previousTags: [],
    ...extra,
  };
}

/** A stage plan with the outcomes forced, so validation/apply/score tests are exact. */
function forcedPlan(incident: Incident, config: MyCobConfig, inputs: ActionInput[], outcomes: Outcome[], stage = 1): StagePlan {
  const plan = planStage(inputs, inputs.map((i) => i.playerId), incident, stage, 5, config, seededRandom(9));
  plan.actions.forEach((a, i) => {
    a.roll.outcome = outcomes[i] ?? "success";
    a.roll.twist = false;
    a.roll.lifeAtRisk = false;
    a.roll.terminationPossible = false;
  });
  plan.interactions = [];
  plan.hazards = [];
  plan.specialEvent = null;
  plan.newProblem = null;
  return plan;
}

const names = (plan: StagePlan) => new Map(plan.actions.map((a) => [a.playerId, a.playerName]));

describe("My Cob Escaped: reading responses", () => {
  it("counts crammed actions and finds references to this incident", () => {
    const { incident, config } = setup();
    const npc = incident.personnel.find((p) => p.source === "generated")!;
    const surname = npc.name.split(" ").at(-1)!;
    const one = analyzeResponse("Lock the doors", incident, config);
    const many = analyzeResponse(`Lock the doors, then call ${surname}. Also fix the generator; and evacuate the cafeteria`, incident, config);
    assert.equal(one.actionCount, 1);
    assert.ok(many.actionCount >= 4, `counted ${many.actionCount}`);
    assert.ok(many.references.includes(`npc:${npc.id}`));
    assert.ok(many.references.includes("sys:power"));
    assert.ok(many.references.includes("loc:cafeteria"));
  });

  it("gives long or keyword-stuffed text no extra reliability", () => {
    const { incident, config } = setup();
    const plain = input("a", "CONTAIN", "Seal the cafeteria doors");
    const padded = input("a", "CONTAIN", "Seal the cafeteria doors " + "very very very carefully and professionally ".repeat(3));
    const stuffed = input("a", "CONTAIN", "cafeteria kitchen medical lab tunnel dock storage power radio alarm door generator camera");
    const chance = (i: ActionInput) => successChance(i, analyzeResponse(i.text, incident, config), 0, incident, config, 0);
    assert.ok(chance(padded) <= chance(plain), "length is not rewarded");
    const groundingCap = config.analysis.groundingMax * config.analysis.groundingBonus;
    assert.ok(chance(stuffed) - chance(input("a", "CONTAIN", "Seal it")) <= groundingCap + 1e-9, "name-dropping is capped");
  });
});

describe("My Cob Escaped: probabilities and randomness", () => {
  it("lets role, entity, state, overload and repetition move the odds", () => {
    const { incident, config } = setup();
    const a = (tag: ResponseTag, role: string, extra: Partial<ActionInput> = {}) => {
      const i = input("a", tag, extra.text ?? "Do it", role, extra);
      return successChance(i, analyzeResponse(i.text, incident, config), 0, incident, config, 0);
    };
    assert.ok(a("CONTAIN", "containment") > a("CONTAIN", "research"), "strong tag beats neutral");
    assert.ok(a("CONTAIN", "research") > a("CONTAIN", "comms"), "neutral beats weak");
    assert.ok(a("CONTAIN", "research", { text: "Lock it. Then gas it. Then call. Then run. Then hide." }) < a("CONTAIN", "research"), "overloading hurts");

    const hard = { ...incident, difficulty: incident.difficulty + 40 };
    const i = input("a", "CONTAIN", "Do it", "research");
    assert.ok(successChance(i, analyzeResponse(i.text, hard, config), 0, hard, config, 0) < a("CONTAIN", "research"), "hard entities are harder");
    const low = { ...incident, stats: { ...incident.stats, containment: 5 } };
    assert.ok(successChance(i, analyzeResponse(i.text, low, config), 0, low, config, 0) < a("CONTAIN", "research"), "state matters");
    assert.ok(successChance(i, analyzeResponse(i.text, incident, config), 2, incident, config, 0) < a("CONTAIN", "research"), "repetition decays");
  });

  it("means great ideas can fail and terrible ones can succeed", () => {
    const { incident, config } = setup();
    const best = input("a", "CONTAIN", "Seal the containment wing doors", "containment", { approach: "careful", sacrifice: true });
    const worst = input("b", "EVACUATE", "Everything. Then more. Then again. Then again. Then run.", "technician", { approach: "reckless" });
    const outcomes = { best: new Set<Outcome>(), worst: new Set<Outcome>() };
    for (let seed = 1; seed <= 200; seed++) {
      const plan = planStage([best, worst], ["a", "b"], incident, 1, 5, config, seededRandom(seed));
      outcomes.best.add(plan.actions[0]!.roll.outcome);
      outcomes.worst.add(plan.actions[1]!.roll.outcome);
    }
    assert.ok(outcomes.best.has("failure") || outcomes.best.has("catastrophe"), "the best idea still fails sometimes");
    assert.ok(outcomes.worst.has("success") || outcomes.worst.has("critical"), "the worst idea still works sometimes");
  });

  it("attempts both conflicting actions and makes them interact", () => {
    const { incident, config } = setup();
    let conflicts = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const plan = planStage([input("a", "CONTAIN"), input("b", "EVACUATE")], ["a", "b"], incident, 1, 5, config, seededRandom(seed));
      assert.equal(plan.actions.length, 2, "neither action is dropped");
      const x = plan.interactions.find((i) => i.kind !== "synergy");
      if (x) {
        conflicts++;
        assert.ok(["sabotage", "help"].includes(x.kind));
        assert.ok(x.affected === plan.actions[0]!.id || x.affected === plan.actions[1]!.id);
      }
    }
    assert.equal(conflicts, 20, "contain vs evacuate always interacts");
    const same = planStage([input("a", "CONTAIN"), input("b", "CONTAIN")], ["a", "b"], incident, 1, 5, config, seededRandom(1));
    assert.equal(same.interactions[0]!.kind, "synergy");
  });

  it("raises special-event odds with chaos", () => {
    assert.ok(specialEventChance(90, DEFAULT_MYCOB_CONFIG) > specialEventChance(10, DEFAULT_MYCOB_CONFIG));
    assert.ok(specialEventChance(100, DEFAULT_MYCOB_CONFIG) <= DEFAULT_MYCOB_CONFIG.specialEvents.max);
  });
});

describe("My Cob Escaped: the director boundary", () => {
  it("rejects non-objects so the caller falls back", () => {
    const { incident, config } = setup();
    const plan = forcedPlan(incident, config, [input("a", "CONTAIN")], ["success"]);
    for (const raw of [null, undefined, "narration", 42, [1, 2]]) assert.equal(validateDirectorOutput(raw, plan, incident, config), null);
  });

  it("fills in whatever a director leaves out", () => {
    const { incident, config } = setup();
    const plan = forcedPlan(incident, config, [input("a", "CONTAIN"), input("b", "INVESTIGATE")], ["success", "failure"]);
    const out = validateDirectorOutput({}, plan, incident, config)!;
    assert.equal(out.interpretations.length, 2);
    assert.ok(out.primaryEffects.some((e) => e.actionId === plan.actions[0]!.id && e.stat === "containment" && e.delta > 0));
    assert.ok(out.primaryEffects.some((e) => e.actionId === plan.actions[1]!.id && e.delta < 0), "a failure costs something");
    assert.ok(out.narration.length > 0);
  });

  it("clamps effects to the outcome the engine rolled", () => {
    const { incident, config } = setup();
    const plan = forcedPlan(incident, config, [input("a", "CONTAIN"), input("b", "DEPLOY")], ["success", "catastrophe"]);
    const [a, b] = plan.actions.map((x) => x.id);
    const out = validateDirectorOutput(
      {
        primaryEffects: [
          { actionId: a, stat: "containment", delta: 999 },
          { actionId: b, stat: "containment", delta: 50 },
          { actionId: a, stat: "chaos", delta: 50 },
          { actionId: "nope", stat: "containment", delta: 5 },
        ],
        chaosEffects: [{ actionId: a, delta: 500 }],
      },
      plan,
      incident,
      config,
    )!;
    const [, successMax] = effectEnvelope("success", 1, config, "primary");
    assert.equal(out.primaryEffects.find((e) => e.actionId === a)!.delta, Math.round(successMax));
    assert.equal(out.primaryEffects.find((e) => e.actionId === b)!.delta, 0, "a catastrophe can't help its main target");
    assert.ok(!out.primaryEffects.some((e) => e.stat === "chaos"), "chaos only moves through chaos effects");
    assert.equal(out.chaosEffects[0]!.delta, config.chaos.directorMax);
  });

  it("never lets a director award points, pick winners or touch lives directly", () => {
    const { incident, config } = setup();
    const plan = forcedPlan(incident, config, [input("a", "CONTAIN"), input("b", "OTHER")], ["success", "success"]);
    const out = validateDirectorOutput(
      { scores: { a: 9999 }, points: 500, winner: "b", lives: { a: 0 }, lifeEvents: [{ playerId: "a", reason: "Because." }] },
      plan,
      incident,
      config,
    )!;
    assert.ok(out.issues.includes("ignored field: scores") && out.issues.includes("ignored field: winner"));
    assert.deepEqual(out.lifeEvents, [], "nobody was at risk, so nobody loses a life");
    assert.ok(out.issues.some((i) => i.startsWith("refused life event")));

    // Scoring only ever reads the validated result: same result, same score, whatever else was sent.
    const result = applyStage(structuredClone(incident), plan, out, config, seededRandom(1));
    const memory = () => ({ creativity: new Map(), sacrifices: new Map() });
    const s1 = scoreStage(plan, result, out, new Map(), ["a", "b"], memory(), config);
    const clean = validateDirectorOutput({}, plan, incident, config)!;
    const s2 = scoreStage(plan, applyStage(structuredClone(incident), plan, clean, config, seededRandom(1)), clean, new Map(), ["a", "b"], memory(), config);
    assert.deepEqual(s1.get("a"), s2.get("a"));
  });

  it("takes exactly the agents the engine put at risk, one life each", () => {
    const { incident, config } = setup();
    const plan = forcedPlan(incident, config, [input("a", "CONTAIN"), input("b", "OTHER")], ["catastrophe", "success"]);
    plan.actions[0]!.roll.lifeAtRisk = true;
    plan.hazards = ["a", "c"];
    const out = validateDirectorOutput({ lifeEvents: [{ playerId: "a", reason: "Got eaten a bit." }, { playerId: "b", reason: "No." }] }, plan, incident, config)!;
    assert.deepEqual(out.lifeEvents.map((l) => l.playerId).sort(), ["a", "c"]);
    assert.equal(out.lifeEvents.find((l) => l.playerId === "a")!.reason, "Got eaten a bit.");
  });

  it("needs a basis for personnel and facility changes", () => {
    const { incident, config } = setup();
    const npc = incident.personnel.find((p) => p.status !== "dead")!;
    npc.status = "active";
    const good = forcedPlan(incident, config, [input("a", "EQUIPMENT")], ["success"]);
    const bad = forcedPlan(incident, config, [input("a", "EQUIPMENT")], ["catastrophe"]);
    const kill = { personnelEffects: [{ npcId: npc.id, status: "dead" }] };
    assert.equal(validateDirectorOutput(kill, good, incident, config)!.personnelEffects.length, 0, "nobody dies when everything went well");
    assert.equal(validateDirectorOutput(kill, bad, incident, config)!.personnelEffects.length, 1);
    incident.systems.power = "offline";
    const fix = { facilityEffects: [{ system: "power", condition: "nominal" }] };
    assert.equal(validateDirectorOutput(fix, bad, incident, config)!.systemEffects.length, 0);
    assert.equal(validateDirectorOutput(fix, good, incident, config)!.systemEffects.length, 1);
  });

  it("budgets reveals and guards the unknown entity's identity", () => {
    const { incident, config } = setup(1, { unknownEntity: { chance: 1, identifyInformationAt: 70, identifyOnCritical: false } });
    incident.stats.information = 20;
    const plan = forcedPlan(incident, config, [input("a", "INVESTIGATE")], ["success"]);
    const all = incident.facts.filter((f) => f.visibility !== "known").map((f) => ({ factId: f.id }));
    const out = validateDirectorOutput({ newInformation: all, revealEntity: true }, plan, incident, config)!;
    assert.ok(!out.reveals.includes("f-identity"), "not enough information to identify it");
    assert.equal(out.reveals.length, 1, "one success, one discovery");
    incident.stats.information = 80;
    assert.ok(validateDirectorOutput({ revealEntity: true }, plan, incident, config)!.reveals.includes("f-identity"));
  });

  it("scrubs anything players can't know yet out of director text", () => {
    const { incident, config } = setup(1, { unknownEntity: { chance: 1 } }, "CPE-005");
    const plan = forcedPlan(incident, config, [input("a", "INVESTIGATE")], ["partial"]);
    const secret = incident.facts.find((f) => f.id === "f-containmentProcedures")!.text;
    const out = validateDirectorOutput(
      {
        narration: `It's Big Yellow (CPE-005)! The file says "${secret}"`,
        actionInterpretations: [{ actionId: plan.actions[0]!.id, summary: "A found Big Yellow." }],
      },
      plan,
      incident,
      config,
    )!;
    assert.doesNotMatch(out.narration + out.interpretations[0]!.summary, /Big Yellow|CPE-005/);
    assert.ok(!out.narration.includes(secret));
  });

  it("gets complete, deterministic output from the mock director that validates cleanly", () => {
    const { incident, config } = setup(4);
    const plan = forcedPlan(incident, config, [input("a", "CONTAIN", "Lock the cafeteria doors"), input("b", "COMMUNICATE"), input("c", "OTHER", "Kill it with fire")], [
      "critical",
      "partial",
      "success",
    ]);
    const ctx = buildDirectorContext(incident, plan, names(plan), [], config);
    const director = new MockIncidentDirector();
    assert.deepEqual(director.resolveSync(ctx), director.resolveSync(ctx), "same context, same output");
    const out = validateDirectorOutput(director.resolveSync(ctx), plan, incident, config)!;
    assert.ok(!out.issues.some((i) => i.startsWith("dropped") || i === "default narration"), out.issues.join(", "));
    assert.equal(out.interpretations.find((i) => i.actionId === plan.actions[2]!.id)!.intent, "terminate");
    assert.ok(out.interpretations.every((i) => !i.summary.includes("Kill it with fire")), "raw responses are never quoted");
  });
});

describe("My Cob Escaped: applying a stage", () => {
  it("caps how far one stage can move any stat", () => {
    const { incident, config } = setup();
    incident.stats.containment = 10;
    const inputs = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => input(id, "CONTAIN", "Seal it", "containment"));
    const plan = forcedPlan(incident, config, inputs, inputs.map(() => "critical"));
    const out = validateDirectorOutput({}, plan, incident, config)!;
    applyStage(incident, plan, out, config, seededRandom(1));
    assert.ok(incident.stats.containment <= 10 + config.severity.maxStatDeltaPerStage);
  });

  it("moves chaos up for disasters and recklessness, down for success", () => {
    const run = (outcome: Outcome, approach: ActionInput["approach"]) => {
      const { incident, config } = setup(2, { chaos: { stageDrift: 0 } });
      const before = incident.stats.chaos;
      const plan = forcedPlan(incident, config, [input("a", "CONTAIN", "x", "commander", { approach })], [outcome]);
      applyStage(incident, plan, validateDirectorOutput({}, plan, incident, config)!, config, seededRandom(1));
      return incident.stats.chaos - before;
    };
    assert.ok(run("catastrophe", "standard") > 0);
    assert.ok(run("critical", "standard") < 0);
    assert.ok(run("partial", "reckless") > run("partial", "standard"), "intentional chaos raises chaos");
  });

  it("only terminates when the director reads a kill attempt and the engine's roll allows it", () => {
    const { incident, config } = setup();
    const plan = forcedPlan(incident, config, [input("a", "DEPLOY", "Shoot it")], ["success"], 3);
    const intent = { actionInterpretations: [{ actionId: plan.actions[0]!.id, intent: "terminate" }] };
    applyStage(incident, plan, validateDirectorOutput(intent, plan, incident, config)!, config, seededRandom(1));
    assert.equal(incident.entity.status, "loose", "no roll, no termination");
    plan.actions[0]!.roll.terminationPossible = true;
    applyStage(incident, plan, validateDirectorOutput(intent, plan, incident, config)!, config, seededRandom(1));
    assert.equal(incident.entity.status, "terminated");
    assert.equal(checkEnding(incident, 3, 5, false, config), "terminated");
  });

  it("ends the incident in exactly the four ways", () => {
    const { incident, config } = setup();
    incident.stats.containment = 95;
    assert.equal(checkEnding(incident, 1, 5, false, config), null, "too early to be over");
    assert.equal(checkEnding(incident, 3, 5, false, config), "contained");
    const b = setup().incident;
    assert.equal(checkEnding(b, 2, 5, true, config), "everyone_dies");
    b.stats.personnel = 0;
    assert.equal(checkEnding(b, 2, 5, false, config), "everyone_dies");
    const c = setup().incident;
    assert.equal(checkEnding(c, 5, 5, false, config), "escaped");
    c.stats.time = 0;
    assert.equal(checkEnding(c, 2, 5, false, config), "escaped");
  });
});

describe("My Cob Escaped: scoring", () => {
  const memory = () => ({ creativity: new Map<string, number>(), sacrifices: new Map<string, number>() });

  it("caps every component and credits roles only when used", () => {
    const { incident, config } = setup();
    const plan = forcedPlan(incident, config, [input("a", "CONTAIN", "x", "containment"), input("b", "CONTAIN", "x", "comms")], ["critical", "critical"]);
    const out = validateDirectorOutput(
      { actionInterpretations: plan.actions.map((a) => ({ actionId: a.id, novelty: "wild" })) },
      plan,
      incident,
      config,
    )!;
    const result = applyStage(incident, plan, out, config, seededRandom(1));
    const lines = scoreStage(plan, result, out, new Map([["a", 99]]), ["a", "b"], memory(), config);
    const a = lines.get("a")!;
    const b = lines.get("b")!;
    const s = config.scoring;
    assert.ok(a.impact <= s.impact.stageCap && a.chaos <= s.chaos.stageCap && a.creativity <= s.creativity.stageCap);
    assert.equal(a.votes, s.votes.stageCap);
    assert.ok(a.role > 0, "Containment Specialist containing uses the role");
    assert.equal(b.role, 0, "Communications containing doesn't");
  });

  it("gives chaos points only for chaos with a real consequence", () => {
    const { incident, config } = setup();
    const plan = forcedPlan(incident, config, [input("a", "OTHER", "x", "commander", { approach: "reckless" })], ["partial"]);
    const out = validateDirectorOutput({ primaryEffects: [{ actionId: plan.actions[0]!.id, stat: "information", delta: 0 }] }, plan, incident, config)!;
    const result = applyStage(incident, plan, out, config, seededRandom(1));
    assert.ok(result.applied[0]!.chaos > 0, "it did raise chaos");
    assert.equal(scoreStage(plan, result, out, new Map(), ["a"], memory(), config).get("a")!.chaos, 0, "but changed nothing, so no chaos points");
  });

  it("limits creativity per game and halves it for repeating yourself", () => {
    const { incident, config } = setup();
    const mem = memory();
    let total = 0;
    for (let stage = 1; stage <= 10; stage++) {
      const plan = forcedPlan(incident, config, [input("a", "OTHER")], ["success"], stage);
      const out = validateDirectorOutput({ actionInterpretations: [{ actionId: plan.actions[0]!.id, novelty: "wild" }] }, plan, incident, config)!;
      total += scoreStage(plan, applyStage(incident, plan, out, config, seededRandom(1)), out, new Map(), ["a"], mem, config).get("a")!.creativity;
    }
    assert.equal(total, config.scoring.creativity.gameCap);
    const repeat = forcedPlan(incident, config, [input("b", "OTHER", "x", "commander", { previousTags: ["OTHER"] })], ["success"]);
    const out = validateDirectorOutput({ actionInterpretations: [{ actionId: repeat.actions[0]!.id, novelty: "wild" }] }, repeat, incident, config)!;
    const line = scoreStage(repeat, applyStage(incident, repeat, out, config, seededRandom(1)), out, new Map(), ["b"], memory(), config).get("b")!;
    assert.equal(line.creativity, config.scoring.creativity.points.wild / 2);
  });

  it("rewards a sacrifice that helped, once per game", () => {
    const { incident, config } = setup();
    const mem = memory();
    const sacrifice = (outcome: Outcome) => {
      const plan = forcedPlan(incident, config, [input("a", "DEPLOY", "x", "field", { sacrifice: true })], [outcome]);
      plan.actions[0]!.roll.lifeAtRisk = true;
      const out = validateDirectorOutput({}, plan, incident, config)!;
      return scoreStage(plan, applyStage(incident, plan, out, config, seededRandom(1)), out, new Map(), ["a"], mem, config).get("a")!.sacrifice;
    };
    assert.equal(sacrifice("failure"), 0, "throwing yourself away for nothing earns nothing");
    assert.equal(sacrifice("success"), config.scoring.sacrifice.points);
    assert.equal(sacrifice("success"), 0, "and it can't be farmed");
  });
});
