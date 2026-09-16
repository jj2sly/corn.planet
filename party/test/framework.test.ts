// Proves the minigame framework is generic: a second, unrelated game plugs into the same
// room system without any changes to rooms, networking or persistence.
// docs/ADDING_A_GAME.md walks through this example.

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { PartyError } from "../server/errors.ts";
import type { GameContext, GameDefinition, GameInstance, Viewer } from "../server/games/types.ts";
import { makeRooms, roomWithPlayers, seededRandom } from "./helpers.ts";

interface CoinSettings {
  rounds: number;
}

/** CPST Coin Toss: everyone calls heads or tails, the server flips, correct calls score. */
class CoinToss implements GameInstance {
  private readonly ctx: GameContext;
  private readonly settings: CoinSettings;
  private round = 0;
  private phase: "CALLING" | "REVEAL" = "CALLING";
  private calls = new Map<string, "heads" | "tails">();
  private result: "heads" | "tails" | null = null;

  constructor(ctx: GameContext, settings: CoinSettings) {
    this.ctx = ctx;
    this.settings = settings;
  }

  start(): void {
    this.nextRound();
  }

  private nextRound(): void {
    this.round += 1;
    this.phase = "CALLING";
    this.calls.clear();
    this.result = null;
    this.ctx.setTimer(15_000, () => this.reveal());
    this.ctx.changed();
  }

  private reveal(): void {
    this.phase = "REVEAL";
    this.result = this.ctx.random() < 0.5 ? "heads" : "tails";
    for (const [playerId, call] of this.calls) {
      if (call === this.result) this.ctx.addPoints(playerId, 100);
      this.ctx.countStat(playerId, "callsMade");
    }
    this.ctx.setTimer(5_000, () =>
      this.round >= this.settings.rounds ? this.ctx.finish({ rounds: this.round, highlights: [] }) : this.nextRound(),
    );
    this.ctx.changed();
  }

  handleInput(playerId: string, action: string, payload: unknown): void {
    if (action !== "call" || this.phase !== "CALLING") throw new PartyError("PHASE_CLOSED");
    const side = (payload as { side?: unknown } | null)?.side;
    if (side !== "heads" && side !== "tails") throw new PartyError("INVALID_INPUT");
    if (this.calls.has(playerId)) throw new PartyError("ALREADY_VOTED");
    this.calls.set(playerId, side);
    if (this.ctx.players().every((p) => this.calls.has(p.id))) this.reveal();
    else this.ctx.changed();
  }

  hostAction(): void {
    throw new PartyError("INVALID_ACTION");
  }

  viewFor(viewer: Viewer) {
    return {
      phase: this.phase,
      round: this.round,
      callsIn: this.calls.size,
      result: this.result,
      // Other players' calls stay hidden until the reveal.
      yourCall: viewer.kind === "player" ? (this.calls.get(viewer.playerId) ?? null) : undefined,
      calls: this.phase === "REVEAL" ? Object.fromEntries(this.calls) : undefined,
    };
  }

  playerLeft(): void {}
  dispose(): void {}
}

const coinToss: GameDefinition<CoinSettings> = {
  id: "coin",
  name: "CPST Coin Toss",
  tagline: "Heads, tails, or containment breach.",
  description: "Call the flip. Be right.",
  minPlayers: 3,
  maxPlayers: 8,
  defaultSettings: { rounds: 2 },
  parseSettings: (raw) => ({ rounds: Math.min(5, Math.max(1, Number((raw as CoinSettings | null)?.rounds) || 2)) }),
  create: (ctx, settings) => new CoinToss(ctx, settings),
};

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

describe("minigame framework", () => {
  it("runs a second, unrelated game through the same rooms, scoring and stats", () => {
    const { manager, records } = makeRooms({
      games: new Map([[coinToss.id, coinToss as GameDefinition]]),
      random: seededRandom(7),
    });
    const { room, players } = roomWithPlayers(manager, ["A", "B", "C"], ["uid-a", null, null]);
    room.configure({ gameId: "coin", settings: { rounds: 2 } });
    room.startGame();

    for (let round = 1; round <= 2; round++) {
      const view = room.viewFor({ kind: "host" }).game as ReturnType<CoinToss["viewFor"]>;
      assert.deepEqual([view.phase, view.round], ["CALLING", round]);
      room.gameInput(players[0]!.id, "call", { side: "heads" });
      assert.throws(() => room.gameInput(players[0]!.id, "call", { side: "tails" }), /ALREADY_VOTED/);
      assert.equal((room.viewFor({ kind: "player", playerId: players[1]!.id }).game as { calls?: unknown }).calls, undefined);
      room.gameInput(players[1]!.id, "call", { side: "tails" });
      room.gameInput(players[2]!.id, "call", { side: "heads" });
      assert.equal((room.viewFor({ kind: "host" }).game as { phase: string }).phase, "REVEAL");
      mock.timers.tick(5_000);
    }

    assert.equal(room.status, "FINAL_RESULTS");
    const results = room.viewFor({ kind: "host" }).results!;
    assert.equal(results.gameName, "CPST Coin Toss");
    assert.equal(results.standings.reduce((sum, s) => sum + s.score, 0) % 100, 0);
    assert.equal(records[0]!.gameId, "coin");
    assert.equal(records[0]!.players.find((p) => p.uid === "uid-a")!.stats.callsMade, 2);
  });
});
