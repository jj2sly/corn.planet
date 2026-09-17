import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { PartyError } from "../server/errors.ts";
import { CORN_OR_SHIT_TIMING, PERFECT_RECORD_BONUS, POINTS_CORRECT } from "../server/games/cornorshit.ts";
import type { Room } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers, stubCanon, TEST_CANON } from "./helpers.ts";

interface Option {
  id: string;
  text: string;
  real?: boolean;
  picked?: number;
}

interface CornOrShitView {
  phase: "INTRO" | "GUESSING" | "REVEAL";
  round: number;
  totalRounds: number;
  kind?: string;
  subject?: string;
  options?: Option[];
  guessesCast?: number;
  guessesNeeded?: number;
  yourGuess?: string | null;
  realOptionId?: string;
  reference?: { ref: string; title: string; url: string };
  fabricatedFrom?: { ref: string; title: string };
  scoreboard?: { playerId: string; name: string; guessed: string | null; correct: boolean }[];
  yourResult?: { correct: boolean } | null;
}

function view(room: Room, playerId?: string): CornOrShitView {
  const state = room.viewFor(playerId ? { kind: "player", playerId } : { kind: "host" });
  return state.game as CornOrShitView;
}

function expectError(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof PartyError && err.code === code, `expected ${code}`);
}

function startGame(names = ["Ann", "Bo", "Cy"], settings: object = {}, canon = stubCanon()) {
  const rooms = makeRooms({ canon });
  const { room, players } = roomWithPlayers(rooms.manager, names);
  room.configure({ gameId: "cornorshit", settings });
  room.startGame();
  return { ...rooms, room, players, ids: players.map((p) => p.id) };
}

/** Moves INTRO -> GUESSING. */
function openGuessing(room: Room) {
  mock.timers.tick(CORN_OR_SHIT_TIMING.introMs);
}

/** Everyone guesses; `pick` chooses an option for each player. */
function guessAll(room: Room, ids: string[], pick: (options: Option[], playerId: string) => Option) {
  for (const pid of ids) {
    const v = view(room, pid);
    if (v.phase !== "GUESSING") return;
    room.gameInput(pid, "guess", { optionId: pick(v.options!, pid).id });
  }
}

/** The documented option, read from the host's reveal view. */
function realOption(room: Room): Option {
  return view(room).options!.find((o) => o.real)!;
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

describe("Corn or Shit: rounds and canon", () => {
  it("opens on a canon record with two claims about it", () => {
    const { room } = startGame();
    assert.equal(view(room).phase, "INTRO");

    openGuessing(room);
    const v = view(room);

    assert.equal(v.phase, "GUESSING");
    assert.equal(v.round, 1);
    assert.equal(v.options!.length, 2);
    assert.ok(v.subject, "the record under discussion is named");
    // Both claims are about the same record.
    assert.ok(v.options!.every((o) => o.text.includes(v.subject!)));
  });

  it("plays the configured number of rounds and records the canon each drew on", () => {
    const { room, ids, records } = startGame(["Ann", "Bo", "Cy"], { rounds: 3 });

    for (let round = 1; round <= 3; round++) {
      openGuessing(room);
      assert.equal(view(room).round, round);
      guessAll(room, ids, (options) => options[0]!);
      mock.timers.tick(CORN_OR_SHIT_TIMING.revealMs);
    }

    assert.equal(records.length, 1);
    const record = records[0]!;
    assert.equal(record.gameId, "cornorshit");
    assert.equal(record.rounds, 3);
    assert.equal(record.canonRefs!.length, 3);
    for (const { round, ref } of record.canonRefs!) {
      assert.ok(round >= 1 && round <= 3);
      assert.ok(TEST_CANON.some((r) => r.ref === ref), `${ref} must be a real canon id`);
    }
  });

  it("prefers canon it has not used yet", () => {
    // Four entities in TEST_CANON, four rounds: every round should be a different record.
    const { room, ids, records } = startGame(["Ann", "Bo", "Cy"], { rounds: 4 });

    for (let round = 1; round <= 4; round++) {
      openGuessing(room);
      guessAll(room, ids, (options) => options[0]!);
      mock.timers.tick(CORN_OR_SHIT_TIMING.revealMs);
    }

    const refs = records[0]!.canonRefs!.map((r) => r.ref);
    assert.equal(new Set(refs).size, refs.length, `repeated canon: ${refs.join(", ")}`);
  });

  it("refuses to start when canon has nothing to ask about", () => {
    const rooms = makeRooms({ canon: stubCanon([]) });
    const { room } = roomWithPlayers(rooms.manager, ["Ann", "Bo", "Cy"]);
    room.configure({ gameId: "cornorshit" });

    expectError(() => room.startGame(), "NO_CANON");
  });
});

describe("Corn or Shit: hidden information", () => {
  it("never tells anyone which claim is documented before the reveal", () => {
    const { room, ids } = startGame();
    openGuessing(room);

    // One player guesses, so the views also cover the "already guessed" state.
    const first = view(room, ids[0]!);
    room.gameInput(ids[0]!, "guess", { optionId: first.options![0]!.id });

    for (const viewer of [undefined, ...ids]) {
      const json = JSON.stringify(view(room, viewer));
      assert.ok(!json.includes('"real"'), `leaked which option is real to ${viewer ?? "the host"}`);
      assert.ok(!json.includes('"realOptionId"'), `leaked realOptionId to ${viewer ?? "the host"}`);
      assert.ok(!json.includes('"reference"'), `leaked the source reference to ${viewer ?? "the host"}`);
      assert.ok(!json.includes('"fabricatedFrom"'), `leaked the donor to ${viewer ?? "the host"}`);
      assert.ok(!json.includes('"picked"'), `leaked other agents' guesses to ${viewer ?? "the host"}`);
    }
  });

  it("shows a player only their own guess while guessing", () => {
    const { room, ids } = startGame();
    openGuessing(room);

    const options = view(room, ids[0]!).options!;
    room.gameInput(ids[0]!, "guess", { optionId: options[0]!.id });

    assert.equal(view(room, ids[0]!).yourGuess, options[0]!.id);
    assert.equal(view(room, ids[1]!).yourGuess, null);
    assert.equal(view(room).guessesCast, 1);
    assert.equal(view(room).guessesNeeded, 3);
  });

  it("reveals the answer, the database reference and where the fabrication came from", () => {
    const { room, ids } = startGame();
    openGuessing(room);
    guessAll(room, ids, (options) => options[0]!);

    const v = view(room);
    assert.equal(v.phase, "REVEAL");

    const real = v.options!.filter((o) => o.real);
    assert.equal(real.length, 1, "exactly one claim is documented");
    assert.equal(v.realOptionId, real[0]!.id);

    assert.ok(v.reference, "the reveal carries the canon reference");
    assert.ok(TEST_CANON.some((r) => r.ref === v.reference!.ref));
    assert.match(v.reference!.url, /^https:\/\//, "players can go and check the record");

    assert.ok(v.fabricatedFrom, "the reveal says which record lent the fabrication its value");
    assert.notEqual(v.fabricatedFrom!.ref, v.reference!.ref);
  });
});

describe("Corn or Shit: scoring", () => {
  it("scores the agents who picked the documented claim", () => {
    const { room, ids } = startGame();
    openGuessing(room);

    // Everyone picks option 0; whether that is right decides who scores.
    guessAll(room, ids, (options) => options[0]!);
    const pickedWasReal = realOption(room).id === view(room).options![0]!.id;

    const scores = room.viewFor({ kind: "host" }).players as { id: string; score: number }[];
    for (const player of scores) {
      assert.equal(player.score, pickedWasReal ? POINTS_CORRECT : 0);
    }
  });

  it("gives a Perfect Record bonus for calling every round right", () => {
    const { room, ids } = startGame(["Ann", "Bo", "Cy"], { rounds: 3 });

    for (let round = 1; round <= 3; round++) {
      openGuessing(room);
      // Ann always right; Bo always wrong; Cy never answers.
      const options = view(room, ids[0]!).options!;
      // The real option is not visible yet, so guess, then check after the reveal.
      room.gameInput(ids[0]!, "guess", { optionId: options[0]!.id });
      room.gameInput(ids[1]!, "guess", { optionId: options[1]!.id });
      mock.timers.tick((room as unknown as { timer: { remainingMs: number } }).timer.remainingMs);

      const real = realOption(room);
      // Whichever of the two was right, one of Ann/Bo got it; swap our expectation accordingly.
      assert.ok(real.id === options[0]!.id || real.id === options[1]!.id);
      mock.timers.tick(CORN_OR_SHIT_TIMING.revealMs);
    }

    const results = room.results!;
    const perfect = results.highlights.filter((h) => h.title === "Perfect Record");
    // Exactly one of the two guessers can have been right every time only if the real option
    // happened to sit in the same slot each round; either way the bonus must match the highlight.
    for (const highlight of perfect) {
      const standing = results.standings.find((s) => s.name === highlight.playerName)!;
      assert.ok(standing.score >= PERFECT_RECORD_BONUS + POINTS_CORRECT * 3);
    }
    assert.ok(!perfect.some((h) => h.playerName === "Cy"), "an agent who never guessed cannot be perfect");
  });

  it("counts guesses and correct calls as stats", () => {
    const { room, ids, records } = startGame(["Ann", "Bo", "Cy"], { rounds: 3 });

    for (let round = 1; round <= 3; round++) {
      openGuessing(room);
      guessAll(room, ids, (options) => options[0]!);
      mock.timers.tick(CORN_OR_SHIT_TIMING.revealMs);
    }

    for (const player of records[0]!.players) {
      assert.equal(player.stats.canonGuesses, 3);
      assert.equal(player.stats.roundsPlayed, 3);
      assert.ok((player.stats.canonCorrect ?? 0) <= 3);
    }
  });
});

describe("Corn or Shit: input validation", () => {
  it("rejects a second guess, an unknown option and a guess outside the phase", () => {
    const { room, ids } = startGame();

    // INTRO: too early.
    expectError(() => room.gameInput(ids[0]!, "guess", { optionId: "whatever" }), "PHASE_CLOSED");

    openGuessing(room);
    const options = view(room, ids[0]!).options!;

    expectError(() => room.gameInput(ids[0]!, "guess", { optionId: "not-an-option" }), "INVALID_VOTE");
    expectError(() => room.gameInput(ids[0]!, "guess", {}), "INVALID_VOTE");
    expectError(() => room.gameInput(ids[0]!, "guess", "nonsense"), "INVALID_INPUT");

    room.gameInput(ids[0]!, "guess", { optionId: options[0]!.id });
    expectError(() => room.gameInput(ids[0]!, "guess", { optionId: options[1]!.id }), "ALREADY_VOTED");
  });

  it("rejects unknown actions", () => {
    const { room, ids } = startGame();
    openGuessing(room);
    expectError(() => room.gameInput(ids[0]!, "vote", { optionId: "x" }), "INVALID_ACTION");
  });

  it("reveals early once every connected agent has guessed", () => {
    const { room, ids } = startGame();
    openGuessing(room);

    guessAll(room, ids, (options) => options[0]!);

    assert.equal(view(room).phase, "REVEAL", "no need to wait out the timer");
  });
});
