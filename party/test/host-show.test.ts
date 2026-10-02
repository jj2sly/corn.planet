// The host screen as a show: the shared launch stays short (and shorter on repeats and with reduced
// motion), the final debrief leads with the right thing for every kind of game, and Cornlashing's
// cob scoreboard lights the right kernels. Browser code, run here without a browser: these parts
// are plain logic.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LAUNCH_PACES } from "../public/js/deck/casefile.js";
import { headline, teamOutcome } from "../public/js/deck/debrief.js";
import { COB_COLUMNS, cobRowsPerLane, cobStandings } from "../public/js/games/chaos-cob.js";

describe("the case-file launch", () => {
  it("runs 2.5–4 s the first time, quicker on repeat games, and briefly with reduced motion", () => {
    const total = (p: { exit: number; leave: number }) => p.exit + p.leave;
    assert.ok(total(LAUNCH_PACES.full) >= 2500 && total(LAUNCH_PACES.full) <= 4000, `full: ${total(LAUNCH_PACES.full)} ms`);
    assert.ok(total(LAUNCH_PACES.quick) < total(LAUNCH_PACES.full), "repeat launches are brisker");
    assert.ok(total(LAUNCH_PACES.calm) <= 1600, "reduced motion is a short still frame");
    for (const [name, p] of Object.entries(LAUNCH_PACES)) {
      // Each beat lands before the next one starts, and the reveal is on screen before the exit.
      assert.ok(p.stamp <= p.declass && p.declass <= p.pop && p.pop < p.exit, `${name}: beats in order`);
      assert.ok(p.exit - p.pop >= 600, `${name}: the revealed title stays up long enough to read`);
    }
  });
});

describe("the final debrief", () => {
  const standing = (playerId: string, score: number, placement: number) => ({ playerId, name: playerId.toUpperCase(), score, placement });

  it("leads with a team result when the game has one, and only then", () => {
    const team = { title: "TEAM VICTORY", playerName: null, text: null, detail: "Corruption 0%" };
    const quote = { title: "Most Convincing Fabrication", playerName: null, text: "A claim", detail: "Fooled 2 agents" };
    const award = { title: "Most convincing report", playerName: "Ann", text: "lol", detail: "3 votes" };
    assert.equal(teamOutcome({ gameId: "thud", standings: [], highlights: [team, award] }), team);
    assert.equal(teamOutcome({ gameId: "chaos", standings: [], highlights: [award, team] }), null, "a later no-name note isn't the outcome");
    assert.equal(teamOutcome({ gameId: "cornorshit", standings: [], highlights: [quote] }), null, "a quote is a highlight, not a result");
    const ending = { title: "CONTAINED", playerName: null, text: "Narration", detail: "Incident" };
    assert.equal(teamOutcome({ gameId: "mycob", standings: [], highlights: [ending] }), ending, "My Cob Escaped's ending leads");
    assert.equal(teamOutcome({ gameId: "chaos", standings: [], highlights: [] }), null);
  });

  it("names a winner, joint winners, a dead heat or an MVP, and nobody when nobody scored", () => {
    const results = (scores: [string, number, number][], highlights = [] as { title: string; playerName: string | null; text: string | null; detail: string }[]) => ({
      gameId: "chaos",
      standings: scores.map(([id, score, placement]) => standing(id, score, placement)),
      highlights,
    });
    assert.deepEqual(headline(results([["a", 900, 1], ["b", 300, 2]]))?.label, "WINNER");
    const joint = headline(results([["a", 900, 1], ["b", 900, 1], ["c", 100, 3]]));
    assert.equal(joint?.label, "JOINT WINNERS");
    assert.deepEqual(joint?.top.map((t) => t.playerId), ["a", "b"]);
    assert.equal(headline(results([["a", 500, 1], ["b", 500, 1]]))?.label, "DEAD HEAT");
    const team = [{ title: "TEAM DEFEAT", playerName: null, text: null, detail: "Red Cow 100%" }];
    assert.equal(headline(results([["a", 400, 1], ["b", 100, 2]], team))?.label, "MVP");
    assert.equal(headline(results([["a", 0, 1], ["b", 0, 1]], team)), null, "no points: the outcome speaks alone");
  });
});

describe("Cornlashing's cob scoreboard", () => {
  const agent = (id: string, score: number) => ({ id, name: id.toUpperCase(), score });

  it("fills lanes in proportion to the leader and pops this round's points on top", () => {
    const cob = cobStandings([agent("a", 1200), agent("b", 600), agent("c", 0)], new Map([["a", 400], ["b", 600], ["c", 0]]));
    const [a, b, c] = cob.rows;
    assert.deepEqual(cob.rows.map((r) => r.id), ["a", "b", "c"]);
    assert.deepEqual([a!.kernelsBefore, a!.kernelsAfter, a!.gain], [8, COB_COLUMNS, 800], "the leader's lane is full");
    assert.deepEqual([b!.kernelsBefore, b!.kernelsAfter, b!.gain], [12, 12, 0]);
    assert.deepEqual([c!.kernelsBefore, c!.kernelsAfter], [0, 0]);
    // Rank changes: B led going in, A leads now.
    assert.deepEqual(cob.previousOrder.map((r) => r.id), ["b", "a", "c"]);
    assert.equal(cob.moved, true);
    assert.deepEqual([a!.move, b!.move, c!.move], [1, -1, 0]);
  });

  it("starts round one dark, with nobody moving", () => {
    const cob = cobStandings([agent("a", 300), agent("b", 500)], new Map([["a", 0], ["b", 0]]));
    assert.equal(cob.known, false);
    assert.equal(cob.moved, false, "no meaningful order before anyone scored");
    assert.ok(cob.rows.every((r) => r.kernelsBefore === 0 && r.move === 0));
    assert.deepEqual(cob.rows.map((r) => r.gain), [500, 300]);
  });

  it("shows a screen that missed the round's start the cob as it stands, without a reveal", () => {
    const cob = cobStandings([agent("a", 900), agent("b", 300)], null);
    assert.ok(cob.rows.every((r) => r.gain === 0 && r.kernelsBefore === r.kernelsAfter && r.move === 0));
  });

  it("gives anyone with points at least one kernel, shares places on ties, and never lights more than now", () => {
    const cob = cobStandings([agent("a", 2400), agent("b", 10), agent("c", 2400), agent("d", 0)], new Map([["a", 9999]]));
    const byId = new Map(cob.rows.map((r) => [r.id, r]));
    assert.equal(byId.get("b")!.kernelsAfter, 1, "a sliver of points still shows");
    assert.equal(byId.get("d")!.kernelsAfter, 0);
    assert.deepEqual([byId.get("a")!.placement, byId.get("c")!.placement, byId.get("b")!.placement], [1, 1, 3]);
    assert.equal(byId.get("a")!.previous, 2400, "a bad snapshot can't make a lane shrink");
    assert.deepEqual(cobStandings([agent("a", 0), agent("b", 0)], new Map()).rows.map((r) => r.kernelsAfter), [0, 0]);
  });

  it("gives small rooms thicker lanes so it still looks like a cob", () => {
    assert.deepEqual([2, 3, 4, 5, 8].map(cobRowsPerLane), [3, 2, 2, 1, 1]);
    const thick = cobStandings([agent("a", 800), agent("b", 400)], new Map(), { kernels: COB_COLUMNS * 3 });
    assert.deepEqual(thick.rows.map((r) => r.kernelsAfter), [72, 36]);
  });
});
