import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../server/config.ts";
import { ClaudeIncidentDirector, DIRECTOR_SCHEMA, toDirectorOutput } from "../server/games/mycob/claude.ts";
import { DEFAULT_MYCOB_CONFIG, resolveConfig } from "../server/games/mycob/config.ts";
import { buildDirectorContext, validateDirectorOutput } from "../server/games/mycob/director.ts";
import { createMyCobGame } from "../server/games/mycob/game.ts";
import { generateIncident } from "../server/games/mycob/incident.ts";
import { planStage, roleOf } from "../server/games/mycob/rules.ts";
import type { GameDefinition } from "../server/games/types.ts";
import { makeRooms, roomWithPlayers, seededRandom, stubCanon, TEST_CANON } from "./helpers.ts";

/** A stand-in for the SDK client: records the request and returns a canned message. */
function fakeClient(reply: (params: any) => { stop_reason: string; text?: string; stop_details?: unknown }) {
  const calls: { params: any; options: any }[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: any, options: any) => {
          calls.push({ params, options });
          const r = reply(params);
          return {
            stop_reason: r.stop_reason,
            stop_details: r.stop_details ?? null,
            content: r.text === undefined ? [] : [{ type: "text", text: r.text }],
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

function stage() {
  const config = resolveConfig(DEFAULT_MYCOB_CONFIG, { unknownEntity: { chance: 0 } });
  const incident = generateIncident({ entities: TEST_CANON.filter((r) => r.kind === "entity") }, config, seededRandom(3), {
    mode: "incident_response",
    stages: 5,
    playerCount: 2,
    entityRef: "CPE-005",
  });
  const input = (id: string, tag: "CONTAIN" | "OTHER", text: string) => ({
    playerId: id,
    playerName: id,
    role: roleOf(config, "containment"),
    tag,
    approach: "standard" as const,
    sacrifice: false,
    text,
    previousTags: [],
  });
  const plan = planStage(
    [input("Ann", "CONTAIN", "Seal the containment wing doors behind it"), input("Bo", "OTHER", "Offer it a very large bucket of popcorn")],
    ["Ann", "Bo"],
    incident,
    1,
    5,
    config,
    seededRandom(1),
  );
  for (const a of plan.actions) a.roll.lifeAtRisk = false;
  plan.hazards = [];
  const ctx = buildDirectorContext(incident, plan, new Map([["Ann", "Ann"], ["Bo", "Bo"]]), [], config);
  return { config, incident, plan, ctx };
}

function answer(plan: ReturnType<typeof stage>["plan"], extra: Record<string, unknown> = {}) {
  const [a, b] = plan.actions;
  return {
    narration: "Ann bolted the wing shut while Bo tried bribery by snack. The entity considered both offers.",
    actionInterpretations: [
      { actionId: a!.id, summary: "Ann sealed the wing.", usesRole: true, novelty: "standard", intent: "none" },
      { actionId: b!.id, summary: "Bo tried to buy it off with popcorn.", usesRole: false, novelty: "inventive", intent: "none" },
    ],
    primaryEffects: [{ actionId: a!.id, stat: "containment", delta: 1 }],
    secondaryEffects: [{ actionId: null, stat: "facility", delta: -2 }],
    chaosEffects: [{ actionId: b!.id, delta: 2 }],
    personnelEffects: [],
    facilityEffects: [],
    lifeEvents: [],
    newInformation: [{ factId: null, label: "Snack preference", text: "It likes popcorn more than doors." }],
    revealEntity: false,
    newObjectives: [],
    objectiveUpdates: [],
    specialEventText: null,
    threatLocation: "unchanged",
    ...extra,
  };
}

describe("My Cob Escaped: the Claude Incident Director", () => {
  it("asks claude-opus-5 for schema-bound JSON, with fallbacks, caching and a hard timeout", async () => {
    const { plan, ctx } = stage();
    const { client, calls } = fakeClient(() => ({ stop_reason: "end_turn", text: JSON.stringify(answer(plan)) }));
    await new ClaudeIncidentDirector({ client, timeoutMs: 12_345 }).resolveStage(ctx);

    const { params, options } = calls[0]!;
    assert.equal(params.model, "claude-opus-5");
    assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(params.fallbacks, "default");
    assert.equal(params.output_config.effort, "low");
    assert.deepEqual(params.output_config.format, { type: "json_schema", schema: DIRECTOR_SCHEMA });
    assert.deepEqual(params.system[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(options, { timeout: 12_345, maxRetries: 0 });
    const sent = params.messages[0].content as string;
    assert.match(sent, /Offer it a very large bucket of popcorn/, "the director sees the agents' own words");
    assert.doesNotMatch(sent, /"url"/, "links are left out to keep the call small");
  });

  it("reshapes the answer for the validator, which accepts it whole", async () => {
    const { incident, config, plan, ctx } = stage();
    const reply = answer(plan, { specialEventText: "Sprinklers.", threatLocation: "cafeteria" });
    const { client } = fakeClient(() => ({ stop_reason: "end_turn", text: JSON.stringify(reply) }));
    const raw = (await new ClaudeIncidentDirector({ client }).resolveStage(ctx)) as Record<string, unknown>;
    assert.deepEqual(raw.specialEvents, [{ text: "Sprinklers." }]);
    assert.equal(raw.threatLocation, "cafeteria");

    const out = validateDirectorOutput(raw, plan, incident, config)!;
    assert.equal(out.narration, reply.narration);
    assert.equal(out.interpretations[1]!.novelty, "inventive");
    assert.deepEqual(out.generatedFacts, [{ label: "Snack preference", text: "It likes popcorn more than doors." }]);
    assert.equal(out.threatLocation, "cafeteria");
    assert.ok(!out.issues.some((i) => i.startsWith("dropped") || i.startsWith("default")), out.issues.join(", "));

    assert.equal(toDirectorOutput({ threatLocation: "unknown" }).threatLocation, null);
    assert.ok(!("threatLocation" in toDirectorOutput({ threatLocation: "unchanged" })));
  });

  it("throws on a refusal, a truncated answer or bad JSON, so the built-in director takes over", async () => {
    const { ctx } = stage();
    const run = (r: { stop_reason: string; text?: string }) => new ClaudeIncidentDirector({ client: fakeClient(() => r).client }).resolveStage(ctx);
    await assert.rejects(run({ stop_reason: "refusal" }), /declined/);
    await assert.rejects(run({ stop_reason: "max_tokens", text: '{"narration": "Half' }), /ran out of tokens/);
    await assert.rejects(run({ stop_reason: "end_turn", text: "not json" }), SyntaxError);
    await assert.rejects(run({ stop_reason: "end_turn" }), /no answer/);
  });

  it("uses a schema structured outputs accepts: every object closed, every field required, no numeric limits", () => {
    const walk = (node: any, path: string) => {
      if (!node || typeof node !== "object") return;
      for (const banned of ["minimum", "maximum", "minLength", "maxLength", "multipleOf"]) assert.ok(!(banned in node), `${path} uses ${banned}`);
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false, `${path} must be closed`);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} must require every field`);
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(DIRECTOR_SCHEMA, "schema");
  });

  it("cuts an agent's response out of director text if it is quoted word for word", () => {
    const { incident, config, plan } = stage();
    const out = validateDirectorOutput(
      { narration: 'Bo said "Offer it a very large bucket of popcorn" and meant it.' },
      plan,
      incident,
      config,
    )!;
    assert.doesNotMatch(out.narration, /Offer it a very large bucket of popcorn/);
  });

  describe("in a game", () => {
    beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
    afterEach(() => mock.timers.reset());

    it("narrates a stage from Claude's answer", async () => {
      const { client } = fakeClient((params) => {
        const ctx = JSON.parse((params.messages[0].content as string).split("\n")[1]!);
        return {
          stop_reason: "end_turn",
          text: JSON.stringify({
            narration: "CLAUDE NARRATES.",
            actionInterpretations: ctx.actions.map((a: any) => ({ actionId: a.actionId, summary: `${a.playerName} acted.`, usesRole: false, novelty: "standard", intent: "none" })),
            primaryEffects: [],
            secondaryEffects: [],
            chaosEffects: [],
            personnelEffects: [],
            facilityEffects: [],
            lifeEvents: [],
            newInformation: [],
            revealEntity: false,
            newObjectives: [],
            objectiveUpdates: [],
            specialEventText: null,
            threatLocation: "unchanged",
          }),
        };
      });
      const game = createMyCobGame({ director: new ClaudeIncidentDirector({ client }) });
      const rooms = makeRooms({ games: new Map([["mycob", game as GameDefinition]]), canon: stubCanon(), random: seededRandom(5) });
      const { room, players } = roomWithPlayers(rooms.manager, ["Ann", "Bo", "Cy"]);
      room.configure({ gameId: "mycob" });
      room.startGame();
      const view = () => room.viewFor({ kind: "host" }).game as any;
      const tick = async () => {
        mock.timers.tick(room.viewFor({ kind: "host" }).timer!.remainingMs);
        await new Promise((r) => setImmediate(r));
      };
      while (view().phase !== "RESPONSE") await tick();
      for (const p of players) room.gameInput(p.id, "respond", { tag: "CONTAIN", text: "Lock it down" });
      await new Promise((r) => setImmediate(r));
      await tick();
      assert.equal(view().phase, "CONSEQUENCE");
      assert.equal(view().narration[0].text, "CLAUDE NARRATES.");
    });
  });
});

describe("configuration: the Incident Director", () => {
  it("defaults to the built-in director and accepts claude", () => {
    assert.equal(loadConfig({}).incidentDirector, "builtin");
    assert.equal(loadConfig({ MYCOB_DIRECTOR: "claude" }).incidentDirector, "claude");
    assert.throws(() => loadConfig({ MYCOB_DIRECTOR: "gpt" }), /MYCOB_DIRECTOR/);
  });
});
