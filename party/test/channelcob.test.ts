import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { currentTask, segmentStep, stateLabel } from "../public/js/games/channelcob-task.js";
import type { CobGameView } from "../public/js/games/channelcob-task.js";
import { COB_POINTS, COB_TIMING, ROLES } from "../server/games/channelcob.ts";
import { CHANNEL_COB_TUTORIAL } from "../server/games/tutorial.ts";
import type { Room } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers, seededRandom, stubCanon } from "./helpers.ts";

interface You {
  role: string;
  brief: string[];
  onAir: boolean;
  canHandOff: boolean;
  breaking: { id: number; text: string }[];
  known: string[];
  decision: { id: number; options: string[]; chosen: number | null } | null;
}
interface View {
  phase: string;
  segment: number;
  entity: string;
  totalSegments: number;
  turn: number;
  roster: { playerId: string; role: string }[];
  speaker: { role: string; breaking: boolean } | null;
  incoming: string[];
  ticker: string[];
  panic: number;
  rep: number;
  poll: { options: { id: string; text: string }[] } | null;
  recap: { accuracy: number; coherence: number; reactions: number; stars: number; truth: string } | null;
  finale: { stars: number; awards: { title: string; winner: string }[]; moments: string[] } | null;
  you?: You;
}

const NAMES = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo", "Gus", "Hal"];
const view = (room: Room, pid?: string) => room.viewFor(pid ? { kind: "player", playerId: pid } : { kind: "host" }).game as View;
const skip = (room: Room) => room.hostGameAction("skip", {});

function start(n: number, random = seededRandom(3), settings: object = { tutorial: false }) {
  const rooms = makeRooms({ canon: stubCanon(), random });
  const { room, players } = roomWithPlayers(rooms.manager, NAMES.slice(0, n));
  room.configure({ gameId: "channelcob", settings });
  room.startGame();
  return { ...rooms, room, ids: players.map((p) => p.id) };
}

function toLive(room: Room) {
  assert.equal(view(room).phase, "INTRO");
  skip(room);
  assert.equal(view(room).phase, "PREP");
  skip(room);
  assert.equal(view(room).phase, "LIVE");
}

/** Plays a whole live segment: everyone takes their decisions and goes live with any news. */
function playLive(room: Room, ids: string[], { scoop = true, decide = true } = {}) {
  for (let i = 0; i < 40 && view(room).phase === "LIVE"; i++) {
    for (const id of ids) {
      const y = view(room, id).you!;
      if (decide && y.decision && y.decision.chosen === null) room.gameInput(id, "choose", { id: y.decision.id, option: 0 });
      if (scoop) for (const b of y.breaking) room.gameInput(id, "golive", { id: b.id });
    }
    if (view(room).phase === "LIVE") skip(room);
  }
  assert.equal(view(room).phase, "POLL");
}

function answerPoll(room: Room, ids: string[], pick: (opts: { id: string }[]) => string) {
  for (const [i, id] of ids.entries()) {
    room.gameInput(id, "answer", { id: pick(view(room).poll!.options) });
    if (ids.length > 1) {
      room.gameInput(id, "mvp", { playerId: ids[(i + 1) % ids.length] });
      room.gameInput(id, "lost", { playerId: ids[(i + 1) % ids.length] });
    }
  }
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

describe("Channel Cob", () => {
  for (const n of [2, 4, 8]) {
    it(`plays a full 3-segment broadcast with ${n} agents`, () => {
      const { room, ids, records } = start(n);
      const roles = new Map<string, string[]>();
      for (let seg = 1; seg <= 3; seg++) {
        assert.equal(view(room).segment, seg);
        const v = view(room);
        assert.equal(new Set(v.roster.map((r) => r.role)).size, n, "every agent has a different role");
        assert.ok(v.roster.some((r) => r.role === "anchor"));
        for (const r of v.roster) roles.set(r.playerId, [...(roles.get(r.playerId) ?? []), r.role]);
        toLive(room);
        playLive(room, ids);
        answerPoll(room, ids, (o) => o[0]!.id);
        assert.equal(view(room).phase, "RECAP");
        const r = view(room).recap!;
        assert.ok(r.stars >= 1 && r.stars <= 5);
        skip(room);
      }
      assert.equal(view(room).phase, "FINALE");
      for (const [, rs] of roles) assert.ok(new Set(rs).size >= Math.min(2, n), "roles rotate between segments");
      skip(room);
      assert.equal(room.status, "FINAL_RESULTS");
      assert.equal(records.length, 1);
      assert.ok(room.results!.highlights[0]!.title.startsWith("Channel Cob Rating"));
    });
  }

  it("runs on timers alone with nobody touching a phone", () => {
    const { room } = start(3);
    for (let i = 0; i < 300 && room.status === "IN_GAME"; i++) mock.timers.tick(2_000);
    assert.equal(room.status, "FINAL_RESULTS");
  });

  it("keeps private briefs, breaking news and decisions off the host and other phones", () => {
    const { room, ids } = start(4);
    toLive(room);
    // Walk until somebody holds breaking news.
    let holder: string | null = null;
    for (let i = 0; i < 6 && !holder; i++) {
      holder = ids.find((id) => view(room, id).you!.breaking.length > 0) ?? null;
      if (!holder) skip(room);
    }
    assert.ok(holder, "a development was delivered");
    const secret = view(room, holder).you!.breaking[0]!.text;
    const host = JSON.stringify(view(room));
    assert.ok(!host.includes(secret), "host never sees the private development");
    assert.ok(view(room).incoming.length === 1, "host only knows that someone has news");
    for (const id of ids.filter((x) => x !== holder)) assert.ok(!JSON.stringify(view(room, id)).includes(secret));
    for (const id of ids) for (const line of view(room, id).you!.brief) assert.ok(!host.includes(line), "briefs stay private");
    const spokes = ids.find((id) => view(room, id).you!.role === "spokesperson")!;
    const hidden = view(room, spokes).you!.brief.find((l) => l.startsWith("Keep hidden"))!;
    for (const id of ids.filter((x) => x !== spokes && view(room, x).you!.role !== "investigator")) assert.ok(!JSON.stringify(view(room, id)).includes(hidden.replace("Keep hidden: ", "")));
  });

  it("going live with breaking news cuts to you and scores a scoop", () => {
    const { room, ids } = start(4);
    toLive(room);
    let holder: string | null = null;
    for (let i = 0; i < 6 && !holder; i++) {
      holder = ids.find((id) => view(room, id).you!.breaking.length > 0) ?? null;
      if (!holder) skip(room);
    }
    const before = room.viewFor({ kind: "host" }).players.find((p: { id: string }) => p.id === holder)!.score as number;
    const turn = view(room).turn;
    room.gameInput(holder!, "golive", { id: view(room, holder!).you!.breaking[0]!.id });
    const v = view(room);
    assert.equal(v.speaker!.role, view(room, holder!).you!.role);
    assert.equal(v.speaker!.breaking, true);
    assert.equal(v.turn, turn, "the cut does not eat a scheduled turn");
    assert.ok(v.ticker[0]!.startsWith("BREAKING"));
    const after = room.viewFor({ kind: "host" }).players.find((p: { id: string }) => p.id === holder)!.score as number;
    assert.equal(after - before, COB_POINTS.scoop);
  });

  it("missed breaking news reaches the ticker anyway, and frozen decisions are called out", () => {
    const { room, ids } = start(4);
    toLive(room);
    playLive(room, ids, { scoop: false, decide: false });
    const v = view(room);
    assert.ok(v.ticker.some((t) => t.includes("MISSED IT")) || v.ticker.some((t) => t.includes("FROZE")));
    assert.ok(v.ticker.some((t) => t.includes("FROZE ON AIR")));
  });

  it("decisions move the meters and only the chosen role can make them", () => {
    const { room, ids } = start(8);
    toLive(room);
    let made = false;
    for (let i = 0; i < 6 && !made; i++) {
      const who = ids.find((id) => view(room, id).you!.decision);
      if (who) {
        const d = view(room, who).you!.decision!;
        const other = ids.find((x) => x !== who)!;
        assert.throws(() => room.gameInput(other, "choose", { id: d.id, option: 0 }));
        const { panic, rep } = view(room);
        room.gameInput(who, "choose", { id: d.id, option: 0 });
        assert.equal(view(room, who).you!.decision!.chosen, 0);
        assert.ok(view(room).panic !== panic || view(room).rep !== rep || view(room).ticker.length > 0);
        made = true;
      } else skip(room);
    }
    assert.ok(made);
  });

  it("the speaker can hand off; others cannot", () => {
    const { room, ids } = start(3);
    toLive(room);
    const speaker = ids.find((id) => view(room, id).you!.onAir)!;
    const other = ids.find((id) => !view(room, id).you!.onAir && view(room, id).you!.role !== "production")!;
    assert.throws(() => room.gameInput(other, "handoff", {}));
    room.gameInput(speaker, "handoff", {});
    assert.equal(view(room).turn, 2);
  });

  it("accuracy and coherence come from the room's fact check", () => {
    const { room, ids } = start(4);
    toLive(room);
    playLive(room, ids);
    const truth = (o: { id: string }[]) => o.find((x) => x.id === "t")!.id;
    answerPoll(room, ids, truth);
    const r = view(room).recap!;
    assert.equal(r.accuracy, 100);
    assert.equal(r.coherence, 100);
  });

  it("opens with a skippable tutorial; phones and host see the same card, then the game starts", () => {
    const { room, ids } = start(4, seededRandom(3), {});
    const host = view(room) as View & { tutorial: { total: number; step: { ask: string } } };
    assert.equal(host.phase, "TUTORIAL");
    assert.equal(host.tutorial.total, 4);
    assert.equal(host.tutorial.step.ask, "WHO AM I?");
    const phone = view(room, ids[0]) as View & { tutorial: { step: { ask: string }; ready: boolean } };
    assert.equal(phone.tutorial.step.ask, "WHO AM I?");
    assert.equal(phone.tutorial.ready, false);
    room.gameInput(ids[0]!, "tutorialReady", {});
    assert.equal(view(room).phase, "TUTORIAL", "waits for everyone");
    room.hostGameAction("skipTutorial", {});
    assert.equal(view(room).phase, "INTRO");
    toLive(room);
    playLive(room, ids);
  });

  it("works without any canon", () => {
    const rooms = makeRooms({ canon: stubCanon([]) });
    const { room } = roomWithPlayers(rooms.manager, ["A", "B"]);
    room.configure({ gameId: "channelcob", settings: { tutorial: false } });
    room.startGame();
    assert.ok(view(room).entity.length > 0);
    assert.ok(COB_TIMING.turnsPerSegment > 0);
  });

  it("shows each phone one task: who is on air, who is next, who just got a quick call", () => {
    const { room, ids } = start(4);
    toLive(room);
    // The phone's view of the game, exactly as the server sends it.
    const phone = (id: string) => view(room, id) as unknown as CobGameView;
    const onAir = ids.filter((id) => stateLabel(phone(id)) === "ON AIR");
    assert.equal(onAir.length, 1, "exactly one agent is ON AIR");
    assert.equal(view(room, onAir[0]!).you!.role, view(room).speaker!.role, "and it is the role the TV shows");
    for (const id of ids) {
      const game = phone(id);
      const task = currentTask(game);
      assert.ok(["live", "next", "listen", "breaking", "decision"].includes(task.kind));
      if (stateLabel(game) === "ON AIR" && !game.you.breaking.length && !game.you.decision) assert.equal(task.kind, "live");
      assert.ok(task.text.length > 0);
    }
  });

  it("breaking news replaces the on-air card instead of stacking, and going live hands the task back", () => {
    const { room, ids } = start(4);
    toLive(room);
    let holder: string | null = null;
    for (let i = 0; i < 6 && !holder; i++) {
      holder = ids.find((id) => view(room, id).you!.breaking.length > 0) ?? null;
      if (!holder) skip(room);
    }
    assert.ok(holder);
    const game = () => view(room, holder!) as unknown as CobGameView;
    const secret = view(room, holder!).you!.breaking[0]!.text;
    // A pending quick call comes first; settle it so the update is the task.
    const d = view(room, holder!).you!.decision;
    if (d && d.chosen === null) room.gameInput(holder!, "choose", { id: d.id, option: 0 });
    const task = currentTask(game());
    assert.equal(task.kind, "breaking");
    assert.equal(task.text, secret);
    assert.equal(task.tag, "BREAKING NEWS");
    assert.match(task.job!, /^Go live/);
    // Everyone else is still on their own task, never the secret.
    for (const id of ids.filter((x) => x !== holder)) assert.notEqual(currentTask(view(room, id) as unknown as CobGameView).text, secret);
    room.gameInput(holder!, "golive", { id: task.id });
    const after = currentTask(game());
    assert.equal(after.kind, "live", "now it is your turn on air");
    assert.equal(after.text, "Tell everyone what you just learned.");
  });

  it("an unanswered quick call is the task until it is made", () => {
    const { room, ids } = start(8);
    toLive(room);
    let who: string | null = null;
    for (let i = 0; i < 6 && !who; i++) {
      who = ids.find((id) => view(room, id).you!.decision) ?? null;
      if (!who) skip(room);
    }
    assert.ok(who);
    const task = currentTask(view(room, who!) as unknown as CobGameView);
    assert.equal(task.kind, "decision");
    assert.equal(task.options!.length, view(room, who!).you!.decision!.options.length);
    room.gameInput(who!, "choose", { id: task.id, option: 0 });
    assert.notEqual(currentTask(view(room, who!) as unknown as CobGameView).kind, "decision");
  });

  it("prep and intro lead with the role", () => {
    const { room, ids } = start(3);
    assert.equal(view(room).phase, "INTRO");
    const y = view(room, ids[0]!).you!;
    const intro = currentTask(view(room, ids[0]!) as unknown as CobGameView);
    assert.equal(intro.kind, "intro");
    assert.match(intro.title!, /^YOU ARE THE /);
    assert.equal(intro.title, `YOU ARE THE ${(ROLES.find((r) => r.id === y.role)!.name).toUpperCase()}`);
    skip(room);
    assert.equal(currentTask(view(room, ids[0]!) as unknown as CobGameView).kind, "prep");
    assert.equal(segmentStep("PREP"), 0);
    assert.equal(segmentStep("LIVE"), 1);
    assert.equal(segmentStep("POLL"), 2);
    assert.equal(segmentStep("RECAP"), 3);
  });

  it("keeps what a player reads short: jobs, notes, prompts, the tutorial", () => {
    for (const role of ROLES) {
      assert.ok(role.job.length <= 40, `${role.id}: ${role.job}`);
      for (const prompt of role.prompts) assert.ok(prompt.length <= 60, prompt);
    }
    const { room, ids } = start(8);
    toLive(room);
    for (const id of ids) {
      const brief = view(room, id).you!.brief;
      assert.ok(brief.length >= 1 && brief.length <= 3, `${view(room, id).you!.role}: ${brief.length} notes`);
    }
    assert.ok(CHANNEL_COB_TUTORIAL.length <= 4);
    for (const step of CHANNEL_COB_TUTORIAL) for (const line of step.lines) assert.ok(line.length <= 60, line);
  });

  it("the simplified phone sends only the same server actions", () => {
    const phone = readFileSync(new URL("../public/js/games/channelcob-play.js", import.meta.url), "utf8");
    // Literal sends, plus the MVP / lost-the-story chips that pass their action in.
    const sent = new Set([...phone.matchAll(/send\(tools, note, "([a-z]+)"/g), ...phone.matchAll(/chips\("([a-z]+)"/g)].map((m) => m[1]!));
    assert.deepEqual([...sent].sort(), ["answer", "choose", "golive", "handoff", "lost", "mvp"]);
  });

  it("a phone that reloads mid-segment gets the same task back", () => {
    const { room, ids } = start(4);
    toLive(room);
    const before = ids.map((id) => currentTask(view(room, id) as unknown as CobGameView));
    // Views are pure functions of game state, so a reconnecting phone sees what it saw before.
    const again = ids.map((id) => currentTask(view(room, id) as unknown as CobGameView));
    assert.deepEqual(again, before);
  });
});
