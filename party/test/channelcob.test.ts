import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { COB_POINTS, COB_TIMING } from "../server/games/channelcob.ts";
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

function start(n: number, random = seededRandom(3)) {
  const rooms = makeRooms({ canon: stubCanon(), random });
  const { room, players } = roomWithPlayers(rooms.manager, NAMES.slice(0, n));
  room.configure({ gameId: "channelcob", settings: {} });
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

  it("works without any canon", () => {
    const rooms = makeRooms({ canon: stubCanon([]) });
    const { room } = roomWithPlayers(rooms.manager, ["A", "B"]);
    room.configure({ gameId: "channelcob", settings: {} });
    room.startGame();
    assert.ok(view(room).entity.length > 0);
    assert.ok(COB_TIMING.turnsPerSegment > 0);
  });
});
