import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PartyError } from "../server/errors.ts";
import { AwardCeremony } from "../server/games/awards.ts";

const rules = { nameMax: 40, descriptionMax: 100, perPlayer: 1, allowSelfVote: false };

function expectError(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof PartyError && err.code === code, `expected ${code}`);
}

describe("player-created awards", () => {
  it("accepts any award name within the limits, with an optional description", () => {
    const c = new AwardCeremony(rules);
    c.submit("a", { name: "WHY WOULD YOU DO THAT" });
    c.submit("b", { name: "  Bro   Had a Plan ", description: "For the plan." });
    assert.deepEqual(
      c.publicList().map(({ name, description }) => ({ name, description })),
      [
        { name: "WHY WOULD YOU DO THAT", description: "" },
        { name: "Bro Had a Plan", description: "For the plan." },
      ],
    );
    expectError(() => c.submit("c", { name: "" }), "INVALID_INPUT");
    expectError(() => c.submit("c", { name: "!!!" }), "INVALID_INPUT");
    expectError(() => c.submit("c", { name: "x".repeat(41) }), "INVALID_INPUT");
    expectError(() => c.submit("c", { name: "Fine", description: "y".repeat(101) }), "INVALID_INPUT");
    expectError(() => c.submit("c", { name: 42 }), "INVALID_INPUT");
  });

  it("refuses duplicates and spam, but lets authors edit their own", () => {
    const c = new AwardCeremony(rules);
    c.submit("a", { name: "OSHA Would Like a Word" });
    expectError(() => c.submit("b", { name: "osha would like a word!!" }), "AWARD_DUPLICATE");
    expectError(() => c.submit("a", { name: "Another one" }), "AWARD_LIMIT");
    const [mine] = c.byAuthor("a");
    c.submit("a", { awardId: mine!.id, name: "OSHA Would Like Two Words" });
    assert.equal(c.byAuthor("a")[0]!.name, "OSHA Would Like Two Words");
    expectError(() => c.submit("b", { awardId: mine!.id, name: "Hijack" }), "NOT_FOUND");
  });

  it("keeps authors anonymous in what players see", () => {
    const c = new AwardCeremony(rules);
    c.submit("secret-author", { name: "Most Questionable Decision" });
    assert.doesNotMatch(JSON.stringify(c.publicList()), /secret-author/);
  });

  it("takes one vote per award per agent, never for yourself, only for eligible agents", () => {
    const c = new AwardCeremony(rules);
    c.submit("a", { name: "Award A" });
    const [award] = c.publicList();
    const eligible = ["a", "b", "c"];
    expectError(() => c.vote("a", award!.id, "a", eligible), "CANNOT_VOTE_OWN");
    expectError(() => c.vote("a", award!.id, "zz", eligible), "INVALID_VOTE");
    expectError(() => c.vote("a", "no-such-award", "b", eligible), "INVALID_VOTE");
    c.vote("a", award!.id, "b", eligible);
    expectError(() => c.vote("a", award!.id, "c", eligible), "ALREADY_VOTED");
    assert.deepEqual(c.votesBy("a"), { [award!.id]: "b" });
    assert.equal(c.doneVoting("a"), true);
    assert.equal(c.doneVoting("b"), false);
  });

  it("gives each award to whoever got the most votes, sharing ties", () => {
    const c = new AwardCeremony(rules);
    c.submit("a", { name: "One" });
    c.submit("b", { name: "Two" });
    const [one, two] = c.publicList();
    const eligible = ["a", "b", "c", "d"];
    c.vote("a", one!.id, "c", eligible);
    c.vote("b", one!.id, "c", eligible);
    c.vote("c", one!.id, "d", eligible);
    c.vote("a", two!.id, "b", eligible);
    c.vote("b", two!.id, "a", eligible);
    const results = c.results((id) => id.toUpperCase());
    assert.deepEqual(results[0]!.winners, [{ playerId: "c", name: "C", votes: 2 }]);
    assert.deepEqual(results[1]!.winners.map((w) => w.playerId).sort(), ["a", "b"]);
    assert.equal(results[1]!.totalVotes, 2);
  });

  it("forgets an agent who leaves, as voter and as recipient", () => {
    const c = new AwardCeremony(rules);
    c.submit("a", { name: "One" });
    const [one] = c.publicList();
    c.vote("b", one!.id, "c", ["a", "b", "c"]);
    c.vote("a", one!.id, "b", ["a", "b", "c"]);
    c.forget("b");
    assert.deepEqual(c.results((id) => id)[0]!.winners, [], "b's vote and the vote for b are gone");
  });
});
