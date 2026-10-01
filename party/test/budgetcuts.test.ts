import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { PartyError } from "../server/errors.ts";
import { BUDGET_TIMING, MAX_VOTES, START_STABILITY, tierFor } from "../server/games/budgetcuts.ts";
import type { Room } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers, seededRandom, stubCanon } from "./helpers.ts";

interface Dept {
  id: string;
  name: string;
  request: number;
  health: number;
  allocated: number | null;
  tier: number | null;
}
interface View {
  phase: string;
  cycle: number;
  totalCycles: number;
  stability: number;
  pool: number;
  depts: Dept[];
  proposals: { id: string; alloc: Record<string, number>; backers: string[] }[];
  leadingId: string;
  voteAttempt: number;
  lastVote: { passed: boolean } | null;
  forced: { id: string } | null;
  incidents: { outcome: string; blamed: string | null; funding: { id: string; tier: number }[] }[];
  summary: { healthChanges: { dept: string; from: number; to: number }[]; deals: { honored: boolean }[] } | null;
  collapsed: boolean;
  audit: { survived: boolean; rows: { dept: string; objectiveMet: boolean }[] } | null;
  you?: { dept: Dept; objective: string; intel: string[]; vote: boolean | null; dealsAccepted: string[] };
}

const NAMES = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo", "Gus", "Hal"];

function view(room: Room, playerId?: string): View {
  return room.viewFor(playerId ? { kind: "player", playerId } : { kind: "host" }).game as View;
}

function start(count: number, random = seededRandom(7), settings: object = {}) {
  const rooms = makeRooms({ canon: stubCanon(), random });
  const { room, players } = roomWithPlayers(rooms.manager, NAMES.slice(0, count));
  room.configure({ gameId: "budgetcuts", settings });
  room.startGame();
  return { ...rooms, room, ids: players.map((p) => p.id) };
}

const skip = (room: Room) => room.hostGameAction("skip", {});

/** BRIEFING → NEGOTIATE. */
function toNegotiate(room: Room) {
  assert.equal(view(room).phase, "BRIEFING");
  skip(room);
  assert.equal(view(room).phase, "NEGOTIATE");
}

function voteAll(room: Room, ids: string[], approve: boolean) {
  for (const id of ids) room.gameInput(id, "vote", { approve });
}

/** Runs incidents and consequences until the next BRIEFING or AUDIT. */
function playOut(room: Room) {
  for (let i = 0; i < 20; i++) {
    const p = view(room).phase;
    if (p === "BRIEFING" || p === "AUDIT" || room.status !== "IN_GAME") return;
    skip(room);
  }
  throw new Error("stuck");
}

/** One full approved cycle, with player 0's plan going to the vote. */
function approvedCycle(room: Room, ids: string[], plan?: (v: View) => Record<string, number>) {
  toNegotiate(room);
  if (plan) {
    room.gameInput(ids[0]!, "propose", { alloc: plan(view(room)) });
    for (const id of ids) room.gameInput(id, "back", { proposalId: ids[0] });
  }
  for (const id of ids) room.gameInput(id, "lock", {});
  assert.equal(view(room).phase, "VOTE");
  voteAll(room, ids, true);
  assert.equal(view(room).phase, "VERDICT");
  assert.equal(view(room).lastVote?.passed, true);
  skip(room);
  assert.equal(view(room).phase, "INCIDENTS");
  playOut(room);
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

describe("Budget Cuts", () => {
  for (const n of [2, 4, 8]) {
    it(`plays a full 3-cycle game with ${n} agents`, () => {
      const { room, ids, records } = start(n);
      const v0 = view(room);
      assert.equal(v0.depts.length, n);
      assert.equal(new Set(v0.depts.map((d) => d.id)).size, n, "every agent runs a different department");
      for (let c = 1; c <= 3 && room.status === "IN_GAME" && view(room).phase === "BRIEFING"; c++) {
        assert.equal(view(room).cycle, c);
        approvedCycle(room, ids);
      }
      if (room.status === "IN_GAME") {
        assert.equal(view(room).phase, "AUDIT");
        assert.equal(view(room).audit!.rows.length, n);
        skip(room);
      }
      assert.equal(room.status, "FINAL_RESULTS");
      assert.equal(records.length, 1);
      assert.ok(room.results!.highlights.some((h) => /CPI Survived|Catastrophic/.test(h.title)));
    });
  }

  it("runs on timers alone, with nobody touching a phone", () => {
    const { room } = start(3);
    for (let i = 0; i < 200 && room.status === "IN_GAME"; i++) mock.timers.tick(5_000);
    assert.equal(room.status, "FINAL_RESULTS");
  });

  it("keeps hidden priorities and intel off the host and other phones", () => {
    const { room, ids } = start(4);
    const host = JSON.stringify(view(room));
    const mine = view(room, ids[0]);
    assert.ok(mine.you!.objective.length > 0);
    assert.ok(!host.includes(mine.you!.objective));
    assert.ok(!host.includes('"objective"'));
    assert.notEqual(view(room, ids[1]).you!.objective, mine.you!.objective);
  });

  it("validates proposals against the pool", () => {
    const { room, ids } = start(3);
    toNegotiate(room);
    const v = view(room);
    const tooMuch = Object.fromEntries(v.depts.map((d) => [d.id, v.pool]));
    assert.throws(() => room.gameInput(ids[0]!, "propose", { alloc: tooMuch }), (e: unknown) => e instanceof PartyError && e.code === "INVALID_INPUT");
    const fine = Object.fromEntries(v.depts.map((d, i) => [d.id, i === 0 ? v.pool : 0]));
    room.gameInput(ids[0]!, "propose", { alloc: fine });
    assert.equal(view(room).leadingId, ids[0]);
  });

  it("rejected budget goes back to renegotiation, then a second rejection forces Emergency Allocation", () => {
    const { room, ids } = start(4);
    toNegotiate(room);
    for (const id of ids) room.gameInput(id, "lock", {});
    voteAll(room, ids, false);
    assert.equal(view(room).lastVote?.passed, false);
    skip(room);
    assert.equal(view(room).phase, "NEGOTIATE");
    assert.equal(view(room).voteAttempt, 1);
    skip(room); // renegotiation timer
    assert.equal(view(room).phase, "VOTE");
    assert.equal(view(room).voteAttempt, MAX_VOTES);
    // A split vote fails too.
    room.gameInput(ids[0]!, "vote", { approve: true });
    room.gameInput(ids[1]!, "vote", { approve: true });
    room.gameInput(ids[2]!, "vote", { approve: false });
    room.gameInput(ids[3]!, "vote", { approve: false });
    skip(room);
    const forced = view(room);
    assert.equal(forced.phase, "FORCED");
    assert.ok(forced.forced);
    assert.equal(forced.stability, START_STABILITY - 4);
    const total = forced.depts.reduce((s, d) => s + (d.allocated ?? 0), 0);
    assert.equal(total, forced.pool, "forced allocation hands out the whole pool");
    skip(room);
    assert.equal(view(room).phase, "INCIDENTS");
  });

  it("a timed-out vote with no votes counts as rejected, and cannot stall", () => {
    const { room } = start(2);
    toNegotiate(room);
    skip(room); // negotiation ends
    assert.equal(view(room).phase, "VOTE");
    mock.timers.tick(20_000);
    assert.equal(view(room).lastVote?.passed, false);
  });

  it("starving a department damages it; funding it well brings it back", () => {
    // Incidents always succeed, so only funding moves health.
    const { room, ids } = start(3, () => 0.01);
    const victim = view(room).depts[1]!.id;
    const starve = (v: View) => Object.fromEntries(v.depts.map((d) => [d.id, d.id === victim ? 0 : Math.floor(v.pool / 2 / 5) * 5]));
    approvedCycle(room, ids, starve);
    let v = view(room);
    assert.equal(v.depts.find((d) => d.id === victim)!.health, 1, "severely underfunded → Strained");
    const rich = (vv: View) => {
      const req = vv.depts.find((d) => d.id === victim)!.request;
      const give = Math.min(vv.pool, Math.ceil((req * 1.3) / 5) * 5);
      return Object.fromEntries(vv.depts.map((d) => [d.id, d.id === victim ? give : 0]));
    };
    approvedCycle(room, ids, rich);
    v = view(room);
    assert.equal(v.depts.find((d) => d.id === victim)!.health, 0, "well funded → recovers");
  });

  it("all-failing incidents collapse the CPI early, with hidden priorities halved", () => {
    const { room, ids } = start(4, () => 0.995);
    const starveAll = (v: View) => Object.fromEntries(v.depts.map((d) => [d.id, 0]));
    let cycles = 0;
    while (room.status === "IN_GAME" && view(room).phase === "BRIEFING") {
      approvedCycle(room, ids, starveAll);
      cycles++;
    }
    const v = view(room);
    assert.equal(v.phase, "AUDIT");
    assert.equal(v.collapsed, true);
    assert.equal(v.stability, 0);
    assert.equal(v.audit!.survived, false);
    assert.ok(cycles <= 3);
    skip(room);
    assert.ok(room.results!.highlights.some((h) => h.title === "Catastrophic Bureaucratic Failure"));
  });

  it("an accepted deal pays both sides when both are adequately funded", () => {
    const { room, ids } = start(2, () => 0.01);
    toNegotiate(room);
    const v = view(room);
    const [a, b] = [view(room, ids[0]).you!.dept.id, view(room, ids[1]).you!.dept.id];
    room.gameInput(ids[0]!, "deal", { dept: b });
    room.gameInput(ids[1]!, "deal", { dept: a });
    assert.deepEqual(view(room, ids[0]).you!.dealsAccepted, [b]);
    const each = Math.floor(v.pool / 2 / 5) * 5;
    room.gameInput(ids[0]!, "propose", { alloc: { [a]: each, [b]: each } });
    room.gameInput(ids[1]!, "back", { proposalId: ids[0] });
    for (const id of ids) room.gameInput(id, "lock", {});
    voteAll(room, ids, true);
    skip(room);
    while (view(room).phase === "INCIDENTS") skip(room);
    const s = view(room).summary!;
    assert.equal(s.deals.length, 1);
    assert.equal(s.deals[0]!.honored, true);
  });

  it("each incident's stability change lands the moment it is shown", () => {
    const { room, ids } = start(3, () => 0.995);
    toNegotiate(room);
    for (const id of ids) room.gameInput(id, "lock", {});
    voteAll(room, ids, true);
    skip(room);
    const v = view(room) as View & { incidents: { stabilityDelta: number }[] };
    assert.equal(v.phase, "INCIDENTS");
    assert.equal(v.incidents.length, 1);
    assert.equal(v.stability, START_STABILITY + v.incidents[0]!.stabilityDelta);
    assert.equal(v.incidents[0]!.outcome, "FAILED");
    assert.ok(v.incidents[0]!.blamed);
  });

  it("funding tiers read as words", () => {
    assert.equal(tierFor(0, 100), 0);
    assert.equal(tierFor(60, 100), 1);
    assert.equal(tierFor(100, 100), 2);
    assert.equal(tierFor(140, 100), 3);
    assert.equal(tierFor(300, 100), 4);
  });

  it("later cycles squeeze harder: smaller pool share, bigger requests", () => {
    const { room, ids } = start(4, () => 0.01);
    const v1 = view(room);
    const share1 = v1.pool / v1.depts.reduce((s, d) => s + d.request, 0);
    approvedCycle(room, ids);
    const v2 = view(room);
    const share2 = v2.pool / v2.depts.reduce((s, d) => s + d.request, 0);
    assert.ok(v2.depts.reduce((s, d) => s + d.request, 0) > v1.depts.reduce((s, d) => s + d.request, 0));
    assert.ok(share2 < share1);
    assert.equal(BUDGET_TIMING.incidentMs > 0, true);
  });
});
