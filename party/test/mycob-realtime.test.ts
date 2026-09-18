import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it } from "node:test";
import { io as connect, type Socket } from "socket.io-client";
import { createPartyServer, type PartyServer } from "../server/app.ts";
import { createAuthVerifier } from "../server/auth.ts";
import { PartyDb } from "../server/db.ts";
import { stubCanon } from "./helpers.ts";

/** Views are plain JSON; tests read them loosely. */
type State = { status: string; paused: boolean; step: number; game: any; you: { playerId?: string } };

class Client {
  readonly socket: Socket;
  readonly states: State[] = [];
  private waiters: { test: (s: State) => boolean; resolve: (s: State) => void }[] = [];

  constructor(url: string) {
    this.socket = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
    this.socket.on("state", (state: State) => {
      this.states.push(state);
      this.waiters = this.waiters.filter((w) => (w.test(state) ? (w.resolve(state), false) : true));
    });
  }

  get state(): State {
    return this.states.at(-1)!;
  }

  connected(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.connected) return resolve();
      this.socket.once("connect", () => resolve());
      this.socket.once("connect_error", reject);
    });
  }

  emit(event: string, payload: object = {}): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
    return this.socket.timeout(5000).emitWithAck(event, payload);
  }

  waitFor(test: (s: State) => boolean, label: string): Promise<State> {
    if (this.states.length && test(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 5000);
      this.waiters.push({ test, resolve: (s) => (clearTimeout(timer), resolve(s)) });
    });
  }

  close() {
    this.socket.close();
  }
}

describe("My Cob Escaped over sockets", () => {
  let server: PartyServer;
  let url: string;
  let clients: Client[] = [];

  const client = async () => {
    const c = new Client(url);
    clients.push(c);
    await c.connected();
    return c;
  };

  before(async () => {
    server = createPartyServer({ db: new PartyDb(":memory:"), auth: createAuthVerifier({ mode: "dev" }), authConfig: { mode: "dev" }, canon: stubCanon() });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    for (const c of clients) c.close();
    clients = [];
  });

  after(() => server.close());

  it("keeps every screen in step, keeps responses private, and survives reconnects", async () => {
    const host = await client();
    const created = await host.emit("host:create");
    const code = created.code as string;
    const players: { c: Client; id: string; token: string; secret: string }[] = [];
    for (const name of ["Ann", "Bo", "Cy"]) {
      const c = await client();
      const joined = await c.emit("player:join", { code, name });
      players.push({ c, id: joined.playerId as string, token: joined.token as string, secret: `SECRET-${name}-PLAN` });
    }
    assert.equal((await host.emit("room:configure", { gameId: "mycob", settings: { length: "short" } })).ok, true);
    assert.equal((await host.emit("room:start")).ok, true);

    const all = () => [host, ...players.map((p) => p.c)];
    const skip = async () => {
      const step = host.state.step;
      assert.equal((await host.emit("game:host", { action: "skip", step })).ok, true);
      await host.waitFor((s) => s.step !== step, "next phase");
    };
    const everyoneAt = (phase: string) => Promise.all(all().map((c) => c.waitFor((s) => s.game?.phase === phase, `${phase} everywhere`)));

    await everyoneAt("ALERT");
    const code0 = host.state.game.incident.code;
    assert.ok(all().every((c) => c.state.game.incident.code === code0), "one incident for everyone");

    await skip();
    await skip();
    await everyoneAt("RESPONSE");
    // A phone that is not the leader cannot move the game on.
    assert.equal((await players[1]!.c.emit("game:host", { action: "skip" })).error, "NOT_ALLOWED", "only the host or leader skips");
    for (const p of players) {
      const r = await p.c.emit("game:input", { action: "respond", payload: { tag: "CONTAIN", text: `${p.secret} lock the doors` } });
      assert.equal(r.ok, true);
    }
    await everyoneAt("PROCESSING");
    await skip();
    const consequences = await everyoneAt("CONSEQUENCE");
    const narration = (s: State) => s.game.narration.find((n: { type: string }) => n.type === "consequence").text;
    assert.ok(consequences.every((s) => narration(s) === narration(consequences[0]!)), "the same consequence on every screen");

    // Stage 2: a phone drops out mid-response and comes back with its own response intact.
    await skip();
    await skip();
    await skip();
    await everyoneAt("RESPONSE");
    const [ann] = players as [(typeof players)[number]];
    await ann.c.emit("game:input", { action: "respond", payload: { tag: "OTHER", text: `${ann.secret} two` } });
    ann.c.close();
    await host.waitFor((s) => s.game.incident.crew.some((c: { name: string; connected: boolean }) => c.name === "Ann" && !c.connected), "Ann offline");
    const back = await client();
    const resumed = await back.emit("player:resume", { code, token: ann.token });
    assert.equal(resumed.ok, true);
    const annState = await back.waitFor((s) => s.game?.phase === "RESPONSE", "Ann back");
    assert.equal(annState.game.you.response.text, `${ann.secret} two`);

    // The host screen drops out: the game pauses; it comes back and carries on.
    host.close();
    await back.waitFor((s) => s.paused, "paused without the host");
    const host2 = await client();
    assert.equal((await host2.emit("host:resume", { code, hostKey: created.hostKey })).ok, true);
    await back.waitFor((s) => !s.paused, "resumed");
    assert.equal(host2.state.game.phase, "RESPONSE");

    // Nobody ever received anybody else's raw response.
    for (const p of [...players, { c: back, id: ann.id, secret: ann.secret }]) {
      for (const s of p.c.states) {
        const json = JSON.stringify(s);
        for (const other of players) if (other.id !== p.id) assert.ok(!json.includes(other.secret), `${p.id} saw ${other.secret}`);
      }
    }
    for (const s of [...host.states, ...host2.states]) {
      const json = JSON.stringify(s);
      for (const p of players) assert.ok(!json.includes(p.secret), "the host screen never shows raw responses");
    }
  });
});
