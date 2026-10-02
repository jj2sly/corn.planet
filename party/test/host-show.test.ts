// The host screen as a show: the shared launch stays short (and shorter on repeats and with reduced
// motion), and the final debrief leads with the right thing for every kind of game. Browser code,
// run here without a browser: these parts are plain logic.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LAUNCH_PACES } from "../public/js/deck/casefile.js";
import { headline, teamOutcome } from "../public/js/deck/debrief.js";

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
