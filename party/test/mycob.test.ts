import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { CanonRecord } from "../server/canon.ts";
import { PartyError } from "../server/errors.ts";
import { DEFAULT_MYCOB_CONFIG, type ConfigOverrides } from "../server/games/mycob/config.ts";
import { MockIncidentDirector, type DirectorContext, type IncidentDirector } from "../server/games/mycob/director.ts";
import { createMyCobGame } from "../server/games/mycob/game.ts";
import type { GameDefinition } from "../server/games/types.ts";
import type { Room } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers, seededRandom, stubCanon, TEST_CANON } from "./helpers.ts";

/** Views are plain JSON; tests read them loosely. */
type View = any;

const T = DEFAULT_MYCOB_CONFIG.timing;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

interface StartOptions {
  names?: string[];
  settings?: object;
  config?: ConfigOverrides;
  director?: IncidentDirector;
  canon?: readonly CanonRecord[];
  seed?: number;
}

function start(options: StartOptions = {}) {
  const game = createMyCobGame({ director: options.director, config: options.config });
  const rooms = makeRooms({
    games: new Map([["mycob", game as GameDefinition]]),
    canon: stubCanon(options.canon ?? TEST_CANON),
    random: seededRandom(options.seed ?? 42),
  });
  const { room, players } = roomWithPlayers(rooms.manager, options.names ?? ["Ann", "Bo", "Cy"]);
  room.configure({ gameId: "mycob", settings: options.settings ?? {} });
  room.startGame();
  return { ...rooms, room, players, ids: players.map((p) => p.id) };
}

const view = (room: Room, playerId?: string): View => room.viewFor(playerId ? { kind: "player", playerId } : { kind: "host" }).game;
const phase = (room: Room) => view(room)?.phase ?? room.status;

/** Lets the room's current phase timer run out. */
async function step(room: Room) {
  const timer = room.viewFor({ kind: "host" }).timer;
  mock.timers.tick(timer ? timer.remainingMs : 0);
  await settle();
}

async function until(room: Room, target: string, limit = 60) {
  for (let i = 0; i < limit && phase(room) !== target; i++) await step(room);
  assert.equal(phase(room), target);
}

function expectError(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof PartyError && err.code === code, `expected ${code}`);
}

const TAGS = ["CONTAIN", "EVACUATE", "INVESTIGATE", "COMMUNICATE", "DEPLOY", "EQUIPMENT", "STRATEGIZE", "OTHER"];

/** Plays the whole game with every agent taking part. `onView` sees every view at every step. */
async function playThrough(room: Room, ids: string[], onView?: (v: View, viewer: string | null) => void, text = (id: string, stage: number) => `Plan ${stage} from ${id}`) {
  const phases: string[] = [];
  for (let guard = 0; guard < 300 && room.status === "IN_GAME"; guard++) {
    const host = view(room);
    if (phases.at(-1) !== host.phase) phases.push(host.phase);
    if (onView) {
      onView(host, null);
      for (const id of ids) onView(view(room, id), id);
    }
    if (host.phase === "RESPONSE") {
      ids.forEach((id, i) => {
        if (phase(room) === "RESPONSE") room.gameInput(id, "respond", { tag: TAGS[(i + host.stage) % TAGS.length], text: text(id, host.stage) });
      });
      await settle();
      continue;
    }
    if (host.phase === "STAGE_VOTE") {
      for (const id of ids) {
        const v = view(room, id);
        if (v?.phase === "STAGE_VOTE" && v.you.canVote && !v.you.yourVote) room.gameInput(id, "vote", { playerId: v.vote.candidates[0].playerId });
      }
      continue;
    }
    if (host.phase === "AWARD_SUBMIT") {
      ids.forEach((id, i) => phase(room) === "AWARD_SUBMIT" && room.gameInput(id, "award:submit", { name: `Award number ${i}` }));
      continue;
    }
    if (host.phase === "AWARD_VOTE") {
      for (const id of ids) {
        const v = view(room, id);
        if (v?.phase !== "AWARD_VOTE") break;
        for (const a of v.awards.list) if (!v.you.awards.votes[a.id] && phase(room) === "AWARD_VOTE") room.gameInput(id, "award:vote", { awardId: a.id, playerId: v.awards.recipients[0].playerId });
      }
      continue;
    }
    await step(room);
  }
  return phases;
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

describe("My Cob Escaped: a whole incident", () => {
  it("plays three agents from the alert to the awards and the final debrief", async () => {
    const { room, ids, records, db } = start();
    const phases = await playThrough(room, ids);
    assert.equal(room.status, "FINAL_RESULTS");
    assert.deepEqual(phases.slice(0, 7), ["ALERT", "UPDATE", "RESPONSE", "PROCESSING", "CONSEQUENCE", "STAGE_VOTE", "UPDATE"]);
    assert.deepEqual(phases.slice(-4), ["OUTCOME", "AWARD_SUBMIT", "AWARD_VOTE", "AWARD_RESULTS"]);

    const results = room.results!;
    assert.equal(results.gameId, "mycob");
    assert.ok(["ENTITY CONTAINED", "ENTITY TERMINATED", "ENTITY AT LARGE", "NO SURVIVORS"].includes(results.highlights[0]!.title));
    assert.ok(results.highlights.some((h) => h.title.startsWith("Award number")), "player-created awards are highlights");
    assert.ok(results.standings.every((s) => s.score > 0));

    const record = records[0]!;
    assert.ok(record.canonRefs!.length > 0 && record.canonRefs!.every((r) => TEST_CANON.some((c) => c.ref === r.ref)), "only real canon ids");
    const saved = db.listGameDetails("mycob.v1");
    assert.equal(saved.length, 1);
    const data = saved[0]!.data as View;
    assert.equal(data.canon, false);
    assert.equal(data.stages.length, data.stagesPlayed);
    assert.ok(data.stages[0].responses.length === 3 && data.stages[0].responses[0].text.startsWith("Plan 1"));
    assert.ok(data.stages[0].interpretations.length === 3 && data.stages[0].scores);
    assert.equal(data.awards.length, 3);
    assert.ok(["contained", "terminated", "escaped", "everyone_dies"].includes(data.ending.id));
  });

  it("runs a full eight-agent incident with a distinct role for everyone", async () => {
    const names = ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"];
    const { room, ids } = start({ names });
    const roles = view(room).incident.crew.map((c: View) => c.role);
    assert.equal(new Set(roles).size, 8);
    await playThrough(room, ids);
    assert.equal(room.status, "FINAL_RESULTS");
    assert.equal(room.results!.standings.length, 8);
  });

  it("runs the stage loop in order on server timers, even if nobody responds", async () => {
    const { room } = start({ settings: { length: "standard" } });
    assert.equal(phase(room), "ALERT");
    assert.equal(room.viewFor({ kind: "host" }).timer!.totalMs, T.alertMs);
    await step(room);
    assert.equal(phase(room), "UPDATE");
    assert.equal(view(room).stage, 1);
    await step(room);
    assert.equal(phase(room), "RESPONSE");
    assert.equal(room.viewFor({ kind: "host" }).timer!.totalMs, T.responseMs);
    await step(room);
    assert.equal(phase(room), "PROCESSING");
    assert.equal(room.viewFor({ kind: "host" }).timer!.totalMs, T.processingMinMs, "the director answered, so only the minimum wait");
    await step(room);
    assert.equal(phase(room), "CONSEQUENCE");
    assert.deepEqual(view(room).consequence.actions, []);
    await step(room);
    assert.equal(phase(room), "UPDATE", "nobody acted, so there is nothing to vote on");
    assert.equal(view(room).stage, 2);
  });

  it("gives agents 45 s to respond, 30 s to read the consequence and 20 s to vote", async () => {
    assert.deepEqual([T.responseMs, T.consequenceMs, T.voteMs], [45_000, 30_000, 20_000]);
    const { room, ids } = start({ settings: { length: "standard" } });
    // The server's deadline, as the host screen and every phone receive it.
    const deadlines = () => [room.viewFor({ kind: "host" }), ...ids.map((id) => room.viewFor({ kind: "player", playerId: id }))].map((v) => v.timer!.totalMs);
    await until(room, "RESPONSE");
    assert.deepEqual(new Set(deadlines()), new Set([45_000]));
    for (const id of ids) room.gameInput(id, "respond", { tag: "CONTAIN", text: "Lock it" });
    await until(room, "CONSEQUENCE");
    assert.deepEqual(new Set(deadlines()), new Set([30_000]));
    await until(room, "STAGE_VOTE");
    assert.deepEqual(new Set(deadlines()), new Set([20_000]));
  });

  it("closes responses once everyone has filed, and keeps them editable until then", async () => {
    const { room, ids, records, db } = start();
    await until(room, "RESPONSE");
    room.gameInput(ids[0]!, "respond", { tag: "CONTAIN", text: "First draft" });
    room.gameInput(ids[0]!, "respond", { tag: "OTHER", text: "Second draft", approach: "reckless", sacrifice: true });
    assert.deepEqual(view(room, ids[0]).you.response, { tag: "OTHER", text: "Second draft", approach: "reckless", sacrifice: true });
    assert.equal(view(room).progress.submitted, 1);
    room.gameInput(ids[1]!, "respond", { tag: "CONTAIN", text: "Lock it" });
    room.gameInput(ids[2]!, "respond", { tag: "EVACUATE", text: "Run" });
    assert.equal(phase(room), "PROCESSING");
    await playThrough(room, ids);
    const stats = records[0]!.players.find((p) => p.name === "Ann")!.stats;
    const played = (db.listGameDetails("mycob.v1")[0]!.data as View).stagesPlayed;
    assert.equal(stats.answersSubmitted, played, "an edit is not a second answer");
  });

  it("validates every response on the server", async () => {
    const { room, ids } = start();
    const [a] = ids as [string];
    expectError(() => room.gameInput(a, "respond", { tag: "CONTAIN", text: "Too early" }), "PHASE_CLOSED");
    await until(room, "RESPONSE");
    expectError(() => room.gameInput(a, "respond", { tag: "PANIC", text: "x" }), "INVALID_INPUT");
    expectError(() => room.gameInput(a, "respond", { text: "No tag" }), "INVALID_INPUT");
    expectError(() => room.gameInput(a, "respond", { tag: "CONTAIN", text: "   " }), "ANSWER_EMPTY");
    expectError(() => room.gameInput(a, "respond", { tag: "CONTAIN", text: "x".repeat(DEFAULT_MYCOB_CONFIG.response.textMax + 1) }), "ANSWER_TOO_LONG");
    expectError(() => room.gameInput(a, "respond", { tag: "CONTAIN", text: "x", approach: "yolo" }), "INVALID_INPUT");
    expectError(() => room.gameInput(a, "respond", { tag: "CONTAIN", text: "x", sacrifice: "yes" }), "INVALID_INPUT");
    expectError(() => room.gameInput(a, "respond", "CONTAIN everything"), "INVALID_INPUT");
    expectError(() => room.gameInput(a, "win", {}), "INVALID_ACTION");
    // Multiple actions in one response are allowed.
    room.gameInput(a, "respond", { tag: "CONTAIN", text: "Seal the doors, then call security, then evacuate the cafeteria." });
  });
});

describe("My Cob Escaped: roles and lives", () => {
  it("assigns roles at random and keeps each agent's role for the whole incident", async () => {
    const firstRoles = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const { room, ids } = start({ seed });
      firstRoles.add(view(room, ids[0]).you.role.id);
    }
    assert.ok(firstRoles.size > 2, "roles are random");

    // Nobody goes down and nothing ends it early, so every stage is a normal one.
    const noLosses = { critical: 0, success: 0, partial: 0, failure: 0, catastrophe: 0, hazardBase: 0, hazardPersonnel: 0, hazardChaos: 0, idleExtra: 0 };
    const { room, ids } = start({ names: ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"], config: { lifeRisk: noLosses, endings: { minStage: 99 } } });
    const roleId = (id: string) => view(room, id).you.role.id;
    const dealt = new Map(ids.map((id) => [id, roleId(id)]));
    const commander = ids.find((id) => roleId(id) === "commander");
    assert.ok(commander, "eight agents: every role is dealt");
    // There is no way to swap roles.
    for (const action of ["trade:offer", "trade:accept", "trade:cancel", "trade:decline"]) {
      expectError(() => room.gameInput(ids[0]!, action, { to: ids[1], from: ids[1] }), "INVALID_ACTION");
    }

    const stages = new Set<number>();
    for (let guard = 0; guard < 300 && room.status === "IN_GAME" && view(room).phase !== "OUTCOME"; guard++) {
      const v = view(room);
      stages.add(v.stage);
      for (const id of ids) {
        const you = view(room, id).you;
        assert.equal(you.role.id, dealt.get(id), `${id} changed role in stage ${v.stage} (${v.phase})`);
        assert.equal(you.trades, undefined, "no trade offers on the phone");
      }
      assert.equal(view(room, commander).you.role.name, "Incident Commander");
      assert.ok(v.incident.crew.every((c: View) => c.role === view(room, c.playerId).you.role.name), "the host screen shows the same roles");
      if (v.phase === "RESPONSE") {
        for (const id of ids) if (phase(room) === "RESPONSE") room.gameInput(id, "respond", { tag: "CONTAIN", text: "Hold the line" });
        await settle();
        continue;
      }
      await step(room);
    }
    assert.deepEqual([...stages].filter((s) => s > 0), [1, 2, 3, 4, 5], "all five stages, same roles throughout");
  });

  it("starts at 3 lives, tells an agent at once when they lose one, and takes at most one per consequence", async () => {
    const certain = { lifeRisk: { critical: 1, success: 1, partial: 1, failure: 1, catastrophe: 1, hazardBase: 1 } };
    const { room, ids } = start({ config: certain });
    for (const id of ids) assert.equal(view(room, id).you.lives, 3);
    await until(room, "RESPONSE");
    for (const id of ids) room.gameInput(id, "respond", { tag: "OTHER", text: "Dangerous things", sacrifice: true });
    await until(room, "CONSEQUENCE");
    for (const id of ids) {
      const v = view(room, id);
      assert.equal(v.you.lives, 2, "both at risk from the action and a hazard, still only one life");
      assert.equal(v.you.lostLife, true);
      assert.ok(v.you.notices.some((n: View) => n.kind === "life" && n.text.startsWith("You lost a life")));
      assert.ok(v.narration.some((n: View) => n.type === "life_loss" && n.text.startsWith("You lost a life")), "narrated to them privately");
    }
    assert.equal(view(room).consequence.lifeLosses.length, 3);
    assert.ok(!view(room).narration.some((n: View) => n.text.startsWith("You lost")), "private lines stay private");
  });

  it("puts an agent at zero lives down, then back in as someone else", async () => {
    const config = { lives: { start: 1 }, lifeRisk: { critical: 1, success: 1, partial: 1, failure: 1, catastrophe: 1, hazardBase: 0, hazardPersonnel: 0, hazardChaos: 0, idleExtra: 0 } };
    const { room, ids } = start({ config });
    const [a] = ids as [string];
    await until(room, "RESPONSE");
    const roleBefore = view(room, a).you.role.id;
    room.gameInput(a, "respond", { tag: "DEPLOY", text: "Go in alone" });
    await until(room, "CONSEQUENCE");
    assert.equal(view(room, a).you.lives, 0);
    assert.equal(view(room, a).you.down, true);
    assert.ok(view(room).incident.crew.find((c: View) => c.playerId === a).down);
    await until(room, "UPDATE");
    const back = view(room, a).you;
    assert.equal(back.down, false);
    assert.equal(back.lives, DEFAULT_MYCOB_CONFIG.lives.afterReassignment);
    assert.ok(back.identity, "playing a staff member now");
    assert.notEqual(back.role.id, roleBefore);
    assert.ok(view(room).incident.personnel.some((p: View) => p.name === back.identity && p.controlledBy === "Ann"));
    await until(room, "RESPONSE");
    room.gameInput(a, "respond", { tag: "OTHER", text: "Still here" });
    assert.equal(view(room, a).you.response.text, "Still here");
  });

  it("ends with no survivors when every agent goes down at once", async () => {
    const { room, ids, db } = start({ config: { lives: { start: 1 }, lifeRisk: { critical: 1, success: 1, partial: 1, failure: 1, catastrophe: 1, hazardBase: 1 } } });
    await playThrough(room, ids);
    assert.equal((db.listGameDetails("mycob.v1")[0]!.data as View).ending.id, "everyone_dies");
    assert.equal(room.results!.highlights[0]!.title, "NO SURVIVORS");
  });
});

describe("My Cob Escaped: voting", () => {
  it("runs an anonymous vote each stage: no self-votes, one each, and it closes when everyone has voted", async () => {
    const { room, ids } = start();
    const [a, b, c] = ids as [string, string, string];
    await until(room, "RESPONSE");
    for (const id of ids) room.gameInput(id, "respond", { tag: "CONTAIN", text: "Lock it" });
    await until(room, "STAGE_VOTE");
    const mine = view(room, a);
    assert.ok(mine.vote.candidates.every((x: View) => x.playerId !== a), "you can't see yourself as an option");
    expectError(() => room.gameInput(a, "vote", { playerId: a }), "CANNOT_VOTE_OWN");
    expectError(() => room.gameInput(a, "vote", { playerId: "nobody" }), "INVALID_VOTE");
    room.gameInput(a, "vote", { playerId: b });
    expectError(() => room.gameInput(a, "vote", { playerId: c }), "ALREADY_VOTED");
    const host = JSON.stringify(view(room));
    assert.equal(view(room).vote.cast, 1);
    assert.doesNotMatch(host, new RegExp(`"voter"|"${a}":"${b}"`), "ballots are secret");
    room.gameInput(b, "vote", { playerId: a });
    room.gameInput(c, "vote", { playerId: b });
    assert.equal(phase(room), "UPDATE");
    assert.match(view(room).narration[0].text, /commendation: Bo/);
  });
});

describe("My Cob Escaped: secrecy", () => {
  const yellow = TEST_CANON.find((r) => r.ref === "CPE-005")!;
  const FORBIDDEN_KEYS = ["stats", "difficulty", "chance", "roll", "lifeAtRisk", "terminationPossible", "issues", "fields", "heldBy", "knowledgeFactId", "ballots"];

  function keysOf(value: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(value)) for (const v of value) keysOf(v, out);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        out.add(k);
        keysOf(v, out);
      }
    }
    return out;
  }

  it("never leaks raw responses, hidden state, the unknown entity or undiscovered canon", async () => {
    const neverIdentified = { unknownEntity: { chance: 1, identifyInformationAt: 101, identifyOnCritical: false, autoIdentifyAt: 101 } };
    const { room, ids } = start({ config: neverIdentified, canon: [yellow, ...TEST_CANON.filter((r) => r.kind === "personnel")], names: ["Ann", "Bo", "Cy", "Di"] });
    const marker = (id: string) => `SECRET-${id}`;
    let checked = 0;

    await playThrough(
      room,
      ids,
      (v, viewer) => {
        if (!v) return;
        const json = JSON.stringify(v);
        checked++;
        // Raw responses: only ever your own.
        for (const id of ids) {
          if (id === viewer) continue;
          assert.ok(!json.includes(marker(id)), `${viewer ?? "host"} saw ${id}'s response in ${v.phase}`);
        }
        // Hidden numbers, rolls and director internals.
        for (const key of keysOf(v)) assert.ok(!FORBIDDEN_KEYS.includes(key), `leaked key "${key}" in ${v.phase}`);
        for (const s of v.incident.statuses) assert.equal(typeof s.value, "string");
        // The unknown entity, until the incident is over.
        const over = ["OUTCOME", "AWARD_SUBMIT", "AWARD_VOTE", "AWARD_RESULTS"].includes(v.phase);
        if (!over) {
          assert.ok(!/Big Yellow|CPE-005/i.test(json), `entity identity leaked in ${v.phase}`);
          assert.deepEqual(v.incident.entity, { known: false });
        }
        // Undiscovered canon text only once it has been discovered.
        const known = new Set<string>(v.incident.facts.map((f: View) => f.text));
        for (const secret of [yellow.fields.containmentProcedures!, yellow.fields.description!]) {
          if (json.includes(secret)) assert.ok(known.has(secret), `"${secret}" shown before it was discovered (${v.phase})`);
        }
      },
      (id, stage) => `${marker(id)} does thing ${stage}`,
    );
    assert.ok(checked > 50);
  });

  it("keeps the director's full context on the server", async () => {
    const seen: DirectorContext[] = [];
    const spy: IncidentDirector = { id: "spy", resolveStage: async (ctx) => (seen.push(ctx), new MockIncidentDirector().resolveSync(ctx)) };
    const { room, ids } = start({ director: spy });
    await until(room, "RESPONSE");
    for (const id of ids) room.gameInput(id, "respond", { tag: "INVESTIGATE", text: "Read the file" });
    await until(room, "CONSEQUENCE");
    assert.equal(seen.length, 1);
    const ctx = seen[0]!;
    assert.ok(ctx.incident.facts.some((f) => f.visibility === "discoverable"), "the director sees what players can't");
    assert.equal(typeof ctx.incident.stats.containment, "number");
    assert.equal(ctx.actions[0]!.text, "Read the file", "and the raw responses");
    for (const viewer of [undefined, ...ids]) {
      const json = JSON.stringify(view(room, viewer));
      assert.ok(!json.includes(`"difficulty":${ctx.incident.difficulty}`));
      assert.ok(!json.includes("primaryRange"));
    }
  });
});

describe("My Cob Escaped: the Incident Director", () => {
  async function stageWith(director: IncidentDirector, skipProcessing = false) {
    const out = start({ director });
    await until(out.room, "RESPONSE");
    for (const id of out.ids) out.room.gameInput(id, "respond", { tag: "CONTAIN", text: "Lock it" });
    // The director is asked the moment responses close; give its promise a turn to settle.
    if (!skipProcessing) await settle();
    if (skipProcessing) out.room.hostGameAction("skip", {});
    else await until(out.room, "CONSEQUENCE");
    assert.equal(phase(out.room), "CONSEQUENCE");
    return out;
  }

  it("uses a director's structured result when it arrives in time", async () => {
    const director: IncidentDirector = {
      id: "scripted",
      resolveStage: async (ctx) => ({
        narration: "THE DIRECTOR SPEAKS.",
        actionInterpretations: ctx.actions.map((a) => ({ actionId: a.actionId, summary: `${a.playerName} did a scripted thing.`, novelty: "inventive" })),
      }),
    };
    const { room, ids, db } = await stageWith(director);
    assert.ok(view(room).narration.some((n: View) => n.text === "THE DIRECTOR SPEAKS."));
    assert.equal(view(room, ids[0]).you.action.summary, "Ann did a scripted thing.");
    await playThrough(room, ids);
    const first = (db.listGameDetails("mycob.v1")[0]!.data as View).stages[0];
    assert.equal(first.director.id, "scripted");
    assert.equal(first.director.fallback, false);
  });

  for (const [label, director] of [
    ["throws", { id: "thrower", resolveStage: () => { throw new Error("boom"); } }],
    ["rejects", { id: "rejecter", resolveStage: async () => { throw new Error("boom"); } }],
    ["returns garbage", { id: "garbage", resolveStage: async () => "lol" }],
    ["never answers", { id: "silent", resolveStage: () => new Promise(() => {}) }],
  ] as [string, IncidentDirector][]) {
    it(`falls back to the built-in director when a director ${label}`, async () => {
      const errors = mock.method(console, "error", () => {});
      const { room, ids, db } = await stageWith(director);
      errors.mock.restore();
      assert.ok(view(room).consequence.actions.length === 3);
      assert.ok(view(room).narration[0].text.length > 0);
      await playThrough(room, ids);
      assert.equal((db.listGameDetails("mycob.v1")[0]!.data as View).stages[0].director.fallback, true);
    });
  }

  it("falls back after the minimum wait when a director fails fast, not the whole window", async () => {
    const errors = mock.method(console, "error", () => {});
    const { room, ids } = start({ director: { id: "dead-key", resolveStage: async () => { throw new Error("401"); } } });
    await until(room, "RESPONSE");
    for (const id of ids) room.gameInput(id, "respond", { tag: "CONTAIN", text: "Lock it" });
    await settle();
    errors.mock.restore();
    assert.equal(room.viewFor({ kind: "host" }).timer!.totalMs, T.processingMinMs);
    await step(room);
    assert.equal(phase(room), "CONSEQUENCE");
  });

  it("ignores a director that answers after the phase was skipped", async () => {
    let answer: (v: unknown) => void = () => {};
    const late: IncidentDirector = { id: "late", resolveStage: () => new Promise((resolve) => (answer = resolve)) };
    const { room } = await stageWith(late, true);
    const before = JSON.stringify(view(room));
    answer({ narration: "TOO LATE" });
    await settle();
    assert.equal(JSON.stringify(view(room)), before);
  });

  it("records, but never applies, a director trying to hand out points", async () => {
    const greedy: IncidentDirector = { id: "greedy", resolveStage: async (ctx) => ({ ...new MockIncidentDirector().resolveSync(ctx), points: { Ann: 10_000 }, winner: "Ann" }) };
    const { room, ids, db } = await stageWith(greedy);
    await playThrough(room, ids);
    const first = (db.listGameDetails("mycob.v1")[0]!.data as View).stages[0];
    assert.ok(first.director.issues.includes("ignored field: points"));
    assert.ok(room.results!.standings.every((s) => s.score < 10_000));
  });
});

describe("My Cob Escaped: room lifecycle", () => {
  it("lets the host skip every phase to the end", async () => {
    const { room } = start();
    for (let i = 0; i < 100 && room.status === "IN_GAME"; i++) room.hostGameAction("skip", {});
    assert.equal(room.status, "FINAL_RESULTS");
  });

  it("carries on when an agent leaves, and ends early when too few remain", async () => {
    const { room, ids } = start({ names: ["Ann", "Bo", "Cy", "Di"] });
    const [a, b, c, d] = ids as [string, string, string, string];
    await until(room, "RESPONSE");
    for (const id of [a, b, c]) room.gameInput(id, "respond", { tag: "CONTAIN", text: "Lock it" });
    room.removePlayer(d);
    assert.equal(phase(room), "PROCESSING", "the last one out counts as everyone filing");
    await until(room, "UPDATE");
    room.removePlayer(c);
    room.removePlayer(b);
    await until(room, "OUTCOME");
    await step(room);
    assert.equal(room.status, "FINAL_RESULTS", "one agent left: no awards, straight to results");
    assert.equal(room.results!.standings.length, 4, "everyone who played keeps a score");
  });

  it("pauses while the host display is away and resumes where it was", async () => {
    const { room } = start();
    await until(room, "RESPONSE");
    room.detachHost("host-socket");
    mock.timers.tick(10 * 60_000);
    await settle();
    assert.equal(phase(room), "RESPONSE");
    room.attachHost("host-socket-2");
    await step(room);
    assert.equal(phase(room), "PROCESSING");
  });

  it("gives a reconnecting agent back their own response and nothing else", async () => {
    const { room, ids } = start();
    const [a] = ids as [string];
    await until(room, "RESPONSE");
    room.gameInput(a, "respond", { tag: "EQUIPMENT", text: "Fix the power" });
    room.detachPlayerSocket("socket-0");
    room.attachPlayer(room.players[0]!, "socket-new");
    assert.equal(view(room, a).you.response.text, "Fix the power");
  });

  it("saves the record so far when a game is cut short, apart from finished games", async () => {
    const { room, ids, db, records } = start();
    await until(room, "RESPONSE");
    for (const id of ids) room.gameInput(id, "respond", { tag: "CONTAIN", text: "Lock it" });
    await until(room, "UPDATE");
    await until(room, "RESPONSE");
    room.gameInput(ids[0]!, "respond", { tag: "INVESTIGATE", text: "Half-finished thought" });
    const code = view(room).incident.code;
    room.returnToLobby();
    assert.equal(room.status, "LOBBY");

    const [aborted, ...more] = db.listAbortedGames("mycob");
    assert.equal(more.length, 0);
    assert.equal(aborted!.reason, "RETURNED_TO_LOBBY");
    assert.equal(aborted!.roomCode, room.code);
    assert.deepEqual(aborted!.players.map((p) => p.name).sort(), ["Ann", "Bo", "Cy"]);
    assert.ok(aborted!.canonRefs.length > 0 && aborted!.canonRefs.every((r) => TEST_CANON.some((c) => c.ref === r.ref)));
    assert.equal(aborted!.kind, "mycob.v1");
    const data = aborted!.data as View;
    assert.equal(data.canon, false);
    assert.equal(data.incident.code, code);
    assert.deepEqual(data.aborted, {
      phase: "RESPONSE",
      stage: 2,
      pendingResponses: [{ playerId: ids[0], tag: "INVESTIGATE", text: "Half-finished thought", approach: "standard", sacrifice: false }],
    });
    assert.equal(data.stages.length, 1, "the finished stage, in full");
    assert.equal(data.stages[0].responses.length, 3);
    assert.ok(data.players.every((p: View) => p.finalRole && typeof p.lives === "number"));
    assert.equal(data.ending, null);
    // Never counted as a played game.
    assert.equal(records.length, 0);
    assert.deepEqual(db.listGameDetails("mycob.v1"), []);
  });

  it("records why a game was cut short, and nothing for a game that finished", async () => {
    for (const reason of ["CLOSED_BY_HOST", "ABANDONED", "SERVER_SHUTDOWN"]) {
      const { room, manager, db } = start();
      await until(room, "PROCESSING");
      manager.close(room, reason);
      const saved = db.listAbortedGames();
      assert.deepEqual(saved.map((a) => a.reason), [reason]);
      assert.equal((saved[0]!.data as View).aborted.phase, "PROCESSING");
    }
    const { room, ids, db } = start();
    await playThrough(room, ids);
    room.returnToLobby();
    assert.deepEqual(db.listAbortedGames(), []);
    assert.equal(db.listGameDetails("mycob.v1").length, 1);
  });

  it("refuses to start without any entity in canon and leaves the room in the lobby", () => {
    const rooms = makeRooms({ games: new Map([["mycob", createMyCobGame() as GameDefinition]]), canon: stubCanon(TEST_CANON.filter((r) => r.kind !== "entity")) });
    const { room } = roomWithPlayers(rooms.manager, ["Ann", "Bo", "Cy"]);
    room.configure({ gameId: "mycob" });
    expectError(() => room.startGame(), "NO_CANON");
    assert.equal(room.status, "LOBBY");
  });
});

describe("My Cob Escaped: settings and modes", () => {
  const game = createMyCobGame();

  it("parses modes, lengths and stage counts, never trusting the input", () => {
    assert.deepEqual(game.parseSettings({}), { mode: "incident_response", length: "standard", stages: 5 });
    assert.equal(game.parseSettings({ mode: "chaos_mode" }).mode, "chaos_mode");
    assert.equal(game.parseSettings({ mode: "made_it_worse" }).mode, "incident_response", "unavailable modes can't be picked");
    assert.equal(game.parseSettings({ mode: "<script>" }).mode, "incident_response");
    assert.equal(game.parseSettings({ length: "long", stages: null }).stages, 7);
    assert.equal(game.parseSettings({ length: "short", stages: null }).stages, 3);
    assert.equal(game.parseSettings({ length: "short", stages: 6 }).stages, 6);
    assert.equal(game.parseSettings({ stages: 99 }).stages, 7);
    assert.equal(game.parseSettings({ stages: 1 }).stages, 3);
  });

  it("plays the configured number of stages, with the length's pacing", async () => {
    const { room, ids, db } = start({ settings: { length: "long", stages: 3 }, config: { endings: { containedAt: 101 } } });
    await until(room, "RESPONSE");
    assert.equal(room.viewFor({ kind: "host" }).timer!.totalMs, Math.round(T.responseMs * DEFAULT_MYCOB_CONFIG.lengths.long.timerScale));
    await playThrough(room, ids);
    assert.equal((db.listGameDetails("mycob.v1")[0]!.data as View).stagesPlayed, 3);
  });

  it("starts Chaos Mode with more chaos", async () => {
    const chaosAt = async (mode: string) => {
      let chaos = -1;
      const spy: IncidentDirector = { id: "spy", resolveStage: async (ctx) => ((chaos = ctx.incident.stats.chaos), new MockIncidentDirector().resolveSync(ctx)) };
      const { room, ids } = start({ settings: { mode }, director: spy });
      await until(room, "RESPONSE");
      for (const id of ids) room.gameInput(id, "respond", { tag: "CONTAIN", text: "x" });
      await settle();
      return chaos;
    };
    assert.ok((await chaosAt("chaos_mode")) > (await chaosAt("incident_response")) + 20);
  });
});

describe("My Cob Escaped: the opening and the closing report", () => {
  const withNarration = (narrate: IncidentDirector["narrate"]): IncidentDirector => {
    const mock = new MockIncidentDirector();
    return { id: "narrator", resolveStage: (ctx) => mock.resolveStage(ctx), narrate };
  };

  it("adds the director's opening to the alert and uses its closing report", async () => {
    const director = withNarration(async (request) => (request.kind === "opening" ? "A HUSH FALLS OVER THE CORN." : "IT IS OVER, MORE OR LESS."));
    const { room, ids } = start({ director });
    await settle();
    const alert = view(room).narration.map((n: View) => n.text);
    assert.equal(alert.length, 2, "the template alert, then the director's opening");
    assert.equal(alert[1], "A HUSH FALLS OVER THE CORN.");
    await playThrough(room, ids, (v) => {
      if (v?.phase === "OUTCOME" && v.outcome.narration !== null) assert.equal(v.outcome.narration, "IT IS OVER, MORE OR LESS.");
    });
    assert.equal(room.results!.highlights[0]!.text, "IT IS OVER, MORE OR LESS.");
  });

  it("drops an opening that arrives after the alert", async () => {
    let answer: (text: string) => void = () => {};
    const director = withNarration((request) => (request.kind === "opening" ? new Promise((resolve) => (answer = resolve)) : Promise.resolve("END")));
    const { room } = start({ director });
    await until(room, "UPDATE");
    const before = JSON.stringify(view(room).narration);
    answer("TOO LATE");
    await settle();
    assert.equal(JSON.stringify(view(room).narration), before);
  });

  it("falls back to the template ending when the director fails, and uses it for the built-in director", async () => {
    const errors = mock.method(console, "error", () => {});
    const failing = withNarration(async () => {
      throw new Error("down");
    });
    for (const director of [failing, undefined]) {
      const { room } = start({ director });
      for (let i = 0; i < 100 && phase(room) !== "OUTCOME"; i++) room.hostGameAction("skip", {});
      await settle();
      const v = view(room);
      assert.equal(v.phase, "OUTCOME");
      assert.ok(v.outcome.narration && v.outcome.narration.length > 10, "the template closing report");
      assert.ok(v.narration.some((n: View) => n.text === v.outcome.narration), "and it reached the screen");
    }
    errors.mock.restore();
  });

  it("scrubs an unidentified entity out of the opening", async () => {
    const yellow = TEST_CANON.find((r) => r.ref === "CPE-005")!;
    const director = withNarration(async () => "Big Yellow is loose again.");
    const { room } = start({ director, canon: [yellow], config: { unknownEntity: { chance: 1 } } });
    await settle();
    assert.doesNotMatch(JSON.stringify(view(room)), /Big Yellow/);
  });
});
