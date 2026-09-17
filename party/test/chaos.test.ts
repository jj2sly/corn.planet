import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { CHAOS_TIMING, chaosGame } from "../server/games/chaos.ts";
import { PartyError } from "../server/errors.ts";
import type { Room } from "../server/rooms.ts";
import { gameView, makeRooms, roomWithPlayers } from "./helpers.ts";

function expectError(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof PartyError && err.code === code, `expected ${code}`);
}

function startGame(names: string[], settings: object = {}, uids: (string | null)[] = []) {
  const rooms = makeRooms();
  const { room, players } = roomWithPlayers(rooms.manager, names, uids);
  room.configure({ settings });
  room.startGame();
  return { ...rooms, room, players, ids: players.map((p) => p.id) };
}

function answerAll(room: Room, ids: string[], text = (pid: string, i: number) => `report ${pid.slice(0, 4)}-${i}`) {
  for (const pid of ids) {
    const view = gameView(room, pid);
    if (view.phase !== "ANSWERING") return;
    view.assignments!.forEach((a, i) => room.gameInput(pid, "answer", { incidentId: a.incidentId, text: text(pid, i) }));
  }
}

/** During VOTING, every eligible player votes for the first report they are allowed to. */
function voteFirstAllowed(room: Room, ids: string[]) {
  const incidentId = gameView(room).incidentId!;
  for (const pid of ids) {
    const view = gameView(room, pid);
    if (view.phase !== "VOTING" || view.incidentId !== incidentId || !view.canVote) continue;
    const choice = view.reports!.find((r) => r.id !== view.ownReportId)!;
    room.gameInput(pid, "vote", { incidentId, reportId: choice.id });
  }
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

describe("CPST Chaos: prompt assignment", () => {
  it("gives every agent exactly two incidents, each shared by two different agents, no pair twice", () => {
    for (const count of [3, 4, 5, 8]) {
      const names = Array.from({ length: count }, (_, i) => `Agent${i}`);
      const { room, ids } = startGame(names);
      assert.equal(gameView(room).phase, "INTRO");
      mock.timers.tick(CHAOS_TIMING.introMs);
      assert.equal(gameView(room).phase, "ANSWERING");

      const authorsByIncident = new Map<string, string[]>();
      for (const pid of ids) {
        const assignments = gameView(room, pid).assignments!;
        assert.equal(assignments.length, 2, `${count} players: two incidents each`);
        for (const a of assignments) authorsByIncident.set(a.incidentId, [...(authorsByIncident.get(a.incidentId) ?? []), pid]);
      }
      assert.equal(authorsByIncident.size, count);
      const pairs = new Set<string>();
      for (const authors of authorsByIncident.values()) {
        assert.equal(authors.length, 2);
        assert.notEqual(authors[0], authors[1]);
        pairs.add([...authors].sort().join("|"));
      }
      if (count > 3) assert.equal(pairs.size, count, "no pair of agents meets twice");
      assert.equal(gameView(room).assignments, undefined, "the host screen never sees assignments");
      room.returnToLobby();
    }
  });

  it("uses safe prompts only in safe mode and does not repeat prompts within a room", () => {
    const { room, ids, db } = startGame(["A", "B", "C", "D", "E", "F", "G", "H"], { rounds: 3 });
    room.returnToLobby();
    db.updateSettings({ moderationPolicy: "all" });
    for (let i = 0; i < 40; i++) db.createPrompt("writer", { text: `Safe incident number ${i}`, category: "corn", tags: [], rating: "safe" });
    for (let i = 0; i < 20; i++) db.createPrompt("writer", { text: `Chaos incident number ${i}`, category: "corn", tags: [], rating: "chaos" });
    room.configure({ contentMode: "safe" });
    const seen = new Set<string>();
    for (let game = 0; game < 3; game++) {
      room.startGame();
      mock.timers.tick(CHAOS_TIMING.introMs);
      for (const a of ids.flatMap((pid) => gameView(room, pid).assignments!)) seen.add(a.prompt);
      room.returnToLobby();
    }
    assert.equal(seen.size, 24, "8 fresh incidents per game");
    const chaosTexts = new Set(db.listLibrary({ rating: "chaos", limit: 500, offset: 0 }).map((p) => p.text));
    for (const text of seen) assert.ok(!chaosTexts.has(text), `safe mode used a chaos prompt: ${text}`);
  });
});

describe("CPST Chaos: answering", () => {
  it("validates, cleans and allows editing reports until the deadline", () => {
    const { room, ids } = startGame(["A", "B", "C"]);
    const [a, b] = ids as [string, string];
    expectError(() => room.gameInput(a, "answer", { incidentId: "x", text: "early" }), "PHASE_CLOSED");
    mock.timers.tick(CHAOS_TIMING.introMs);

    const mine = gameView(room, a).assignments![0]!;
    const notMine = gameView(room, b).assignments!.find((x) => !gameView(room, a).assignments!.some((m) => m.incidentId === x.incidentId))!;

    expectError(() => room.gameInput(a, "answer", { incidentId: mine.incidentId, text: "   " }), "ANSWER_EMPTY");
    expectError(() => room.gameInput(a, "answer", { incidentId: mine.incidentId, text: "x".repeat(81) }), "ANSWER_TOO_LONG");
    expectError(() => room.gameInput(a, "answer", { incidentId: notMine.incidentId, text: "sneaky" }), "NOT_YOUR_PROMPT");
    expectError(() => room.gameInput(a, "answer", "not an object"), "INVALID_INPUT");
    expectError(() => room.gameInput(a, "dance", {}), "INVALID_ACTION");

    room.gameInput(a, "answer", { incidentId: mine.incidentId, text: "  first‮draft  " });
    assert.equal(gameView(room, a).assignments![0]!.answer, "firstdraft");
    room.gameInput(a, "answer", { incidentId: mine.incidentId, text: "final draft" });
    assert.equal(gameView(room, a).assignments![0]!.answer, "final draft");
    assert.deepEqual(gameView(room).progress!.find((p) => p.playerId === a), { playerId: a, done: 1, needed: 2 });

    mock.timers.tick(90_000);
    assert.notEqual(gameView(room).phase, "ANSWERING");
    expectError(() => room.gameInput(a, "answer", { incidentId: mine.incidentId, text: "too late" }), "PHASE_CLOSED");
  });

  it("closes answering as soon as every agent has filed everything", () => {
    const { room, ids } = startGame(["A", "B", "C"]);
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids);
    assert.equal(gameView(room).phase, "VOTING");
  });

  it("closes answering early when the last missing agent leaves", () => {
    const { room, ids } = startGame(["A", "B", "C", "D"]);
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids.slice(0, 3));
    assert.equal(gameView(room).phase, "ANSWERING");
    room.removePlayer(ids[3]!);
    assert.notEqual(gameView(room).phase, "ANSWERING");
  });
});

describe("CPST Chaos: anonymity", () => {
  it("never reveals authors to anyone while voting, including after reconnecting", () => {
    const { room, ids, players } = startGame(["Alpha", "Bravo", "Charlie", "Delta"]);
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids);
    assert.equal(gameView(room).phase, "VOTING");

    const secrets = [...ids, ...players.map((p) => p.name)];
    const check = (label: string, value: unknown) => {
      const json = JSON.stringify(value);
      for (const s of secrets) assert.ok(!json.includes(s), `${label} leaked ${s}`);
    };
    check("host view", gameView(room));
    for (const pid of ids) check(`player view`, gameView(room, pid));

    room.detachPlayerSocket("socket-0");
    room.attachPlayer(players[0]!, "socket-reconnected");
    check("reconnected player view", gameView(room, ids[0]));

    for (const r of gameView(room).reports!) assert.deepEqual(Object.keys(r).sort(), ["id", "text"]);
  });

  it("reveals authors, votes and points in the verdict", () => {
    const { room, ids, players } = startGame(["Alpha", "Bravo", "Charlie", "Delta"]);
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids);
    voteFirstAllowed(room, ids);
    const view = gameView(room);
    assert.equal(view.phase, "VERDICT");
    for (const entry of view.verdict!.entries) {
      assert.ok(ids.includes(entry.authorId));
      assert.equal(entry.authorName, players.find((p) => p.id === entry.authorId)!.name);
    }
  });
});

describe("CPST Chaos: voting", () => {
  it("rejects author votes, unknown reports, duplicates and stale incidents", () => {
    const { room, ids } = startGame(["A", "B", "C", "D"]);
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids);

    const host = gameView(room);
    const authors = ids.filter((pid) => !gameView(room, pid).canVote);
    const voters = ids.filter((pid) => gameView(room, pid).canVote);
    assert.equal(authors.length, 2);
    assert.equal(voters.length, 2);
    assert.equal(host.votesNeeded, 2);

    const reportId = host.reports![0]!.id;
    expectError(() => room.gameInput(authors[0]!, "vote", { incidentId: host.incidentId, reportId }), "NOT_ELIGIBLE");
    expectError(() => room.gameInput(voters[0]!, "vote", { incidentId: host.incidentId, reportId: "nope" }), "INVALID_VOTE");
    expectError(() => room.gameInput(voters[0]!, "vote", { incidentId: "old-incident", reportId }), "PHASE_CLOSED");

    room.gameInput(voters[0]!, "vote", { incidentId: host.incidentId, reportId });
    assert.equal(gameView(room, voters[0]).yourVote, reportId);
    assert.equal(gameView(room).votesCast, 1);
    expectError(() => room.gameInput(voters[0]!, "vote", { incidentId: host.incidentId, reportId }), "ALREADY_VOTED");
  });

  it("prevents voting for your own report in Total Breach", () => {
    const { room, ids } = startGame(["A", "B", "C"], { rounds: 1, totalBreach: true });
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids);
    // Play out round 1 by letting every phase time out.
    while (gameView(room).round === 1) mock.timers.tick(60_000);
    assert.equal(gameView(room).breach, true);
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids);
    const view = gameView(room, ids[0]);
    assert.equal(view.phase, "VOTING");
    assert.equal(view.canVote, true);
    assert.ok(view.ownReportId);
    expectError(() => room.gameInput(ids[0]!, "vote", { incidentId: view.incidentId, reportId: view.ownReportId }), "CANNOT_VOTE_OWN");
  });
});

describe("CPST Chaos: scoring", () => {
  it("awards 100 × round per vote plus a unanimous bonus", () => {
    const { room, ids } = startGame(["A", "B", "C", "D"], { rounds: 1, totalBreach: false });
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids);

    const host = gameView(room);
    const voters = ids.filter((pid) => gameView(room, pid).canVote);
    const winning = host.reports![0]!.id;
    for (const pid of voters) room.gameInput(pid, "vote", { incidentId: host.incidentId, reportId: winning });

    const verdict = gameView(room).verdict!;
    const winner = verdict.entries.find((e) => e.reportId === winning)!;
    const loser = verdict.entries.find((e) => e.reportId !== winning)!;
    assert.deepEqual([winner.votes, winner.points, winner.unanimous], [2, 300, true]);
    assert.deepEqual([loser.votes, loser.points, loser.unanimous], [0, 0, false]);
    assert.deepEqual(verdict.winningReportIds, [winning]);
    assert.equal(room.viewFor({ kind: "host" }).players.find((p) => p.id === winner.authorId)!.score, 300);
    assert.equal(gameView(room, winner.authorId).yourPoints, 300);
  });

  it("splits a tied incident without a unanimous bonus", () => {
    const { room, ids } = startGame(["A", "B", "C", "D"], { rounds: 1, totalBreach: false });
    mock.timers.tick(CHAOS_TIMING.introMs);
    answerAll(room, ids);
    const host = gameView(room);
    const voters = ids.filter((pid) => gameView(room, pid).canVote);
    room.gameInput(voters[0]!, "vote", { incidentId: host.incidentId, reportId: host.reports![0]!.id });
    room.gameInput(voters[1]!, "vote", { incidentId: host.incidentId, reportId: host.reports![1]!.id });
    const verdict = gameView(room).verdict!;
    assert.deepEqual(verdict.entries.map((e) => [e.votes, e.points, e.unanimous]), [[1, 100, false], [1, 100, false]]);
    assert.equal(verdict.winningReportIds.length, 2);
  });

  it("gives a default ruling (100 × round) when only one agent files, with no vote", () => {
    const { room, ids } = startGame(["A", "B", "C"], { rounds: 1, totalBreach: false });
    mock.timers.tick(CHAOS_TIMING.introMs);
    const [only] = gameView(room, ids[0]).assignments!;
    room.gameInput(ids[0]!, "answer", { incidentId: only!.incidentId, text: "I alone filed" });
    mock.timers.tick(90_000); // answering deadline

    // Walk verdicts until we find the default ruling for that incident.
    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      const view = gameView(room);
      if (view.phase === "VERDICT" && view.incidentId === only!.incidentId) {
        assert.equal(view.verdict!.defaulted, true);
        assert.deepEqual(view.verdict!.entries.map((e) => [e.text, e.points]), [["I alone filed", 100]]);
        found = true;
      } else {
        room.hostGameAction("skip", undefined);
      }
    }
    assert.ok(found, "default ruling shown");
  });

  it("doubles points in round 2 and triples them in a Total Breach after two rounds", () => {
    const { room, ids } = startGame(["A", "B", "C", "D"], { rounds: 2, totalBreach: true });
    const multipliers: number[] = [];
    while (room.status === "IN_GAME") {
      const view = gameView(room);
      if (view.phase === "ANSWERING") answerAll(room, ids);
      else if (view.phase === "VOTING") {
        multipliers.push(view.multiplier);
        voteFirstAllowed(room, ids);
      } else room.hostGameAction("skip", undefined);
    }
    assert.ok(multipliers.includes(1) && multipliers.includes(2) && multipliers.at(-1) === 3);
  });
});

describe("CPST Chaos: full game and results", () => {
  it("plays to final results, ranks with ties, and records per-player stats", () => {
    const { room, ids, records, db } = startGame(["A", "B", "C", "D"], { rounds: 1, totalBreach: true }, ["uid-a", null, null, null]);
    const phases = new Set<string>();
    while (room.status === "IN_GAME") {
      const view = gameView(room);
      phases.add(view.phase);
      if (view.phase === "ANSWERING") answerAll(room, ids);
      else if (view.phase === "VOTING") voteFirstAllowed(room, ids);
      else mock.timers.tick(CHAOS_TIMING.breachVerdictMs);
    }
    assert.deepEqual([...phases].sort(), ["ANSWERING", "INTRO", "STANDINGS", "VERDICT", "VOTING"]);
    assert.equal(room.status, "FINAL_RESULTS");

    const results = room.viewFor({ kind: "host" }).results!;
    assert.equal(results.rounds, 2);
    assert.equal(results.standings.length, 4);
    for (let i = 1; i < results.standings.length; i++) {
      const prev = results.standings[i - 1]!;
      const cur = results.standings[i]!;
      assert.ok(prev.score >= cur.score);
      assert.equal(cur.placement, prev.score === cur.score ? prev.placement : i + 1);
    }
    assert.ok(results.highlights.length >= 1);

    assert.equal(records.length, 1);
    const recordA = records[0]!.players.find((p) => p.uid === "uid-a")!;
    assert.equal(recordA.stats.answersSubmitted, 3, "two paired incidents + one breach");
    assert.equal(recordA.stats.roundsPlayed, 2);
    assert.ok((recordA.stats.votesCast ?? 0) >= 1);

    const stats = db.getUserStats("uid-a");
    assert.equal(stats.gamesPlayed, 1);
    assert.equal(stats.answersSubmitted, 3);
    assert.equal(stats.totalPoints, recordA.score);
    assert.equal(db.getUserHistory("uid-a")[0]!.placement, recordA.placement);
  });

  it("can replay from final results and return to the lobby", () => {
    const { room, ids } = startGame(["A", "B", "C"], { rounds: 1, totalBreach: false });
    while (room.status === "IN_GAME") {
      if (gameView(room).phase === "ANSWERING") answerAll(room, ids);
      else room.hostGameAction("skip", undefined);
    }
    assert.equal(room.status, "FINAL_RESULTS");
    room.startGame();
    assert.equal(room.status, "IN_GAME");
    assert.ok(room.viewFor({ kind: "host" }).players.every((p) => p.score === 0), "scores reset on replay");
    room.returnToLobby();
    assert.equal(room.status, "LOBBY");
  });

  it("skip advances every phase and is refused outside a game", () => {
    const { room } = startGame(["A", "B", "C"], { rounds: 1, totalBreach: false });
    assert.equal(gameView(room).phase, "INTRO");
    room.hostGameAction("skip", undefined);
    assert.equal(gameView(room).phase, "ANSWERING");
    room.hostGameAction("skip", undefined); // nobody answered: straight to standings
    assert.equal(gameView(room).phase, "STANDINGS");
    room.hostGameAction("skip", undefined);
    assert.equal(room.status, "FINAL_RESULTS");
    expectError(() => room.hostGameAction("skip", undefined), "INVALID_ACTION");
  });
});

describe("CPST Chaos: settings", () => {
  it("clamps untrusted settings", () => {
    assert.deepEqual(chaosGame.parseSettings({ rounds: -4, answerSeconds: 1e9, voteSeconds: "abc", totalBreach: "yes" }), {
      rounds: 1,
      answerSeconds: 180,
      voteSeconds: 25,
      totalBreach: true,
    });
    assert.deepEqual(chaosGame.parseSettings(null), chaosGame.defaultSettings);
  });
});
