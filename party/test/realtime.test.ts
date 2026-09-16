import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import { io as connect, type Socket } from "socket.io-client";
import { createPartyServer, type PartyServer } from "../server/app.ts";
import { createAuthVerifier } from "../server/auth.ts";
import { PartyDb } from "../server/db.ts";
import type { ChaosView } from "./helpers.ts";

interface Ack {
  ok: boolean;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

interface StateView {
  code: string;
  status: string;
  paused: boolean;
  leaderId: string | null;
  players: { id: string; name: string; connected: boolean; score: number }[];
  you: { role: string; playerId?: string; isLeader?: boolean };
  game: ChaosView | null;
  results: { standings: { name: string; score: number; placement: number }[] } | null;
}

class Client {
  readonly socket: Socket;
  readonly states: StateView[] = [];
  readonly ended: { error: string; message: string }[] = [];
  private waiters: { test: (s: StateView) => boolean; resolve: (s: StateView) => void }[] = [];

  constructor(url: string, token?: string) {
    this.socket = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false, auth: token ? { token } : {} });
    this.socket.on("state", (state: StateView) => {
      this.states.push(state);
      this.waiters = this.waiters.filter((w) => (w.test(state) ? (w.resolve(state), false) : true));
    });
    this.socket.on("session:ended", (e) => this.ended.push(e));
  }

  get state(): StateView | undefined {
    return this.states.at(-1);
  }

  connected(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.connected) return resolve();
      this.socket.once("connect", () => resolve());
      this.socket.once("connect_error", (err) => reject(err));
    });
  }

  emit(event: string, payload: object = {}): Promise<Ack> {
    return this.socket.timeout(5000).emitWithAck(event, payload);
  }

  waitFor(test: (s: StateView) => boolean, label = "state"): Promise<StateView> {
    if (this.state && test(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 5000);
      this.waiters.push({ test, resolve: (s) => (clearTimeout(timer), resolve(s)) });
    });
  }

  close() {
    this.socket.close();
  }
}

describe("realtime multiplayer", () => {
  let server: PartyServer;
  let db: PartyDb;
  let url: string;
  let clients: Client[] = [];

  const client = async (token?: string) => {
    const c = new Client(url, token);
    clients.push(c);
    await c.connected();
    return c;
  };

  /** Host + named players, all joined to one room. */
  const lobby = async (names: string[]) => {
    const host = await client();
    const created = await host.emit("host:create");
    assert.equal(created.ok, true);
    const code = created.code as string;
    const players: { c: Client; id: string; token: string }[] = [];
    for (const name of names) {
      const c = await client();
      const joined = await c.emit("player:join", { code: code.toLowerCase(), name });
      assert.equal(joined.ok, true, `join ${name}: ${joined.error}`);
      players.push({ c, id: joined.playerId as string, token: joined.token as string });
    }
    await host.waitFor((s) => s.players.length === names.length, "all players in lobby");
    return { host, code, hostKey: created.hostKey as string, players };
  };

  before(async () => {
    db = new PartyDb(":memory:");
    server = createPartyServer({ db, auth: createAuthVerifier({ mode: "dev" }), authConfig: { mode: "dev" } });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    for (const c of clients) c.close();
    clients = [];
  });

  after(() => server.close());

  it("handles invalid rooms, duplicate names, full rooms and joining mid-game", async () => {
    const stray = await client();
    assert.equal((await stray.emit("player:join", { code: "ZZZZ", name: "Nobody" })).error, "ROOM_NOT_FOUND");
    assert.equal((await stray.emit("player:join", { code: "12", name: "Nobody" })).error, "INVALID_CODE");

    const { host, code, players } = await lobby(["Ann", "Ben", "Cy", "Dee", "Eve", "Fay", "Gus"]);
    const dup = await stray.emit("player:join", { code, name: "ANN" });
    assert.deepEqual([dup.ok, dup.error], [false, "NAME_TAKEN"]);
    assert.equal(typeof dup.message, "string");
    assert.equal((await stray.emit("player:join", { code, name: "Hal" })).ok, true);
    const ninth = await client();
    assert.equal((await ninth.emit("player:join", { code, name: "Ivy" })).error, "ROOM_FULL");

    assert.equal((await players[1]!.c.emit("room:start")).error, "NOT_ALLOWED", "only host or leader");
    assert.equal((await host.emit("room:start")).ok, true);
    await host.waitFor((s) => s.status === "IN_GAME");
    const late = await client();
    assert.equal((await late.emit("player:join", { code, name: "Late" })).error, "GAME_IN_PROGRESS");
  });

  it("plays a full game over sockets without leaking authors during voting", async () => {
    const { host, players } = await lobby(["Alpha", "Bravo", "Charlie", "Delta"]);
    const secrets = [...players.map((p) => p.id), "Alpha", "Bravo", "Charlie", "Delta"];

    assert.equal((await host.emit("room:configure", { settings: { rounds: 1, totalBreach: true }, contentMode: "safe" })).ok, true);
    // The leader (first player) starts from their phone.
    assert.equal(players[0]!.c.state?.you.isLeader, true);
    assert.equal((await players[0]!.c.emit("room:start")).ok, true);
    await host.waitFor((s) => s.game?.phase === "INTRO");

    let verdicts = 0;
    while (host.state!.status === "IN_GAME") {
      const phase = host.state!.game!.phase;
      if (phase === "ANSWERING") {
        for (const p of players) {
          const view = await p.c.waitFor((s) => s.game?.phase === "ANSWERING" && !!s.game.assignments, "assignments");
          for (const a of view.game!.assignments!) {
            const ack = await p.c.emit("game:input", { action: "answer", payload: { incidentId: a.incidentId, text: `report from ${p.id.slice(0, 3)}` } });
            assert.equal(ack.ok, true, ack.error);
          }
        }
        await host.waitFor((s) => s.game?.phase !== "ANSWERING", "answering closed");
      } else if (phase === "VOTING") {
        const incidentId = host.state!.game!.incidentId!;
        for (const p of players) {
          const view = await p.c.waitFor((s) => s.game?.incidentId === incidentId, "voting view");
          if (view.game!.phase !== "VOTING" || !view.game!.canVote) continue;
          const choice = view.game!.reports!.find((r) => r.id !== view.game!.ownReportId)!;
          // A duplicate vote is rejected by the server.
          assert.equal((await p.c.emit("game:input", { action: "vote", payload: { incidentId, reportId: choice.id } })).ok, true);
          const again = await p.c.emit("game:input", { action: "vote", payload: { incidentId, reportId: choice.id } });
          assert.ok(!again.ok);
        }
        await host.waitFor((s) => s.game?.phase !== "VOTING" || s.game.incidentId !== incidentId, "voting closed");
      } else {
        if (phase === "VERDICT") verdicts += 1;
        const before = JSON.stringify(host.state!.game);
        assert.equal((await host.emit("game:host", { action: "skip" })).ok, true);
        await host.waitFor((s) => JSON.stringify(s.game) !== before, "phase advanced");
      }
    }

    const final = await host.waitFor((s) => s.status === "FINAL_RESULTS");
    assert.equal(final.results!.standings.length, 4);
    assert.ok(verdicts >= 5, "4 paired incidents + total breach");

    // Every VOTING-phase payload any client received must be free of authors.
    for (const c of [host, ...players.map((p) => p.c)]) {
      for (const s of c.states) {
        if (s.game?.phase !== "VOTING") continue;
        const json = JSON.stringify(s.game);
        for (const secret of secrets) assert.ok(!json.includes(secret), `voting payload leaked ${secret}`);
      }
    }

    // Replay and return to lobby.
    assert.equal((await host.emit("room:start")).ok, true);
    await host.waitFor((s) => s.status === "IN_GAME");
    assert.equal((await host.emit("room:lobby")).ok, true);
    await host.waitFor((s) => s.status === "LOBBY");
  });

  it("rejects game input from the host and host controls from non-leaders", async () => {
    const { host, players } = await lobby(["A1", "B1", "C1"]);
    await host.emit("room:start");
    assert.equal((await host.emit("game:input", { action: "answer", payload: {} })).error, "NOT_ALLOWED");
    assert.equal((await players[2]!.c.emit("game:host", { action: "skip" })).error, "NOT_ALLOWED");
    assert.equal((await players[2]!.c.emit("room:kick", { playerId: players[0]!.id })).error, "NOT_ALLOWED");
    const outsider = await client();
    assert.equal((await outsider.emit("game:input", { action: "answer", payload: {} })).error, "NOT_IN_ROOM");
  });

  it("recovers a refreshed player and ends the replaced socket's session", async () => {
    const { host, code, players } = await lobby(["Ann2", "Ben2", "Cy2"]);
    await host.emit("room:start");
    await host.emit("game:host", { action: "skip" }); // to ANSWERING
    const ann = players[0]!;
    await ann.c.waitFor((s) => s.game?.phase === "ANSWERING");
    const incidentId = ann.c.state!.game!.assignments![0]!.incidentId;
    await ann.c.emit("game:input", { action: "answer", payload: { incidentId, text: "before refresh" } });

    // "Refresh": the tab reconnects with its stored token.
    ann.c.close();
    await host.waitFor((s) => s.players.find((p) => p.id === ann.id)?.connected === false, "shown disconnected");
    const refreshed = await client();
    const resumed = await refreshed.emit("player:resume", { code, token: ann.token });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.playerId, ann.id);
    const view = await refreshed.waitFor((s) => s.game?.phase === "ANSWERING");
    assert.equal(view.game!.assignments!.find((a) => a.incidentId === incidentId)!.answer, "before refresh");

    // Opening the same seat on a third screen replaces the second.
    const third = await client();
    assert.equal((await third.emit("player:resume", { code, token: ann.token })).ok, true);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(refreshed.ended[0]?.error, "SESSION_REPLACED");
    assert.equal((await refreshed.emit("game:input", { action: "answer", payload: {} })).error, "NOT_IN_ROOM");

    const forged = await client();
    assert.equal((await forged.emit("player:resume", { code, token: "f".repeat(48) })).error, "SESSION_ENDED");
  });

  it("pauses when the host display drops, and resumes on host refresh", async () => {
    const { host, code, hostKey, players } = await lobby(["P1", "P2", "P3"]);
    await host.emit("room:start");
    await players[0]!.c.waitFor((s) => s.status === "IN_GAME" && !s.paused);

    host.close();
    await players[0]!.c.waitFor((s) => s.paused, "paused after host left");

    const wrong = await client();
    assert.equal((await wrong.emit("host:resume", { code, hostKey: "0".repeat(48) })).error, "SESSION_ENDED");

    const host2 = await client();
    assert.equal((await host2.emit("host:resume", { code, hostKey })).ok, true);
    await players[0]!.c.waitFor((s) => !s.paused, "unpaused after host refresh");
    assert.equal((await host2.waitFor((s) => s.status === "IN_GAME")).you.role, "host");

    // The leader can also keep playing without the display.
    host2.close();
    await players[0]!.c.waitFor((s) => s.paused);
    assert.equal((await players[1]!.c.emit("room:resume")).error, "NOT_ALLOWED");
    assert.equal((await players[0]!.c.emit("room:resume")).ok, true);
    await players[0]!.c.waitFor((s) => !s.paused);
  });

  it("lets the host kick players and close the session", async () => {
    const { host, players } = await lobby(["K1", "K2", "K3"]);
    assert.equal((await host.emit("room:kick", { playerId: players[2]!.id })).ok, true);
    await host.waitFor((s) => s.players.length === 2);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(players[2]!.c.ended[0]?.error, "SESSION_ENDED");

    assert.equal((await players[0]!.c.emit("room:close")).error, "NOT_ALLOWED");
    assert.equal((await host.emit("room:close")).ok, true);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(players[0]!.c.ended[0]?.error, "SESSION_ENDED");
  });

  it("verifies logins on connect and gives a logged-in user back their seat", async () => {
    await assert.rejects(new Client(url, "dev:forged").connected(), /AUTH_FAILED/);

    const { host, code } = await lobby(["G1", "G2"]);
    const first = await client("dev:carol:VIEWER");
    const joined = await first.emit("player:join", { code, name: "Carol" });
    assert.equal(joined.ok, true);
    await host.waitFor((s) => s.players.length === 3);

    // Same account on a new device, typing a different name, gets the same seat.
    const second = await client("dev:carol:VIEWER");
    const rejoined = await second.emit("player:join", { code, name: "Someone Else" });
    assert.equal(rejoined.playerId, joined.playerId);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(first.ended[0]?.error, "SESSION_REPLACED");
    assert.equal((await host.waitFor((s) => s.players.length === 3)).players.length, 3);
  });

  it("rate limits event floods from a single socket", async () => {
    const spammer = await client();
    const results = await Promise.all(Array.from({ length: 60 }, () => spammer.emit("state:request")));
    assert.ok(results.some((r) => r.error === "RATE_LIMITED"));
  });
});
