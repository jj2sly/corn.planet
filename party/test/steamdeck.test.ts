import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { io as connect, type Socket } from "socket.io-client";
import { addPoint, createDrawing, createStroke, serialize } from "../public/js/drawing.js";
import { createPartyServer } from "../server/app.ts";
import { createAuthVerifier } from "../server/auth.ts";
import { PartyDb } from "../server/db.ts";
import { PartyError } from "../server/errors.ts";
import { CAST, dealCast } from "../public/js/games/steamdeck-cast.js";
import { PLANK, SHAKE, TIMING } from "../server/games/steamdeck/game.ts";
import { LEVELS, type Level } from "../server/games/steamdeck/levels.ts";
import { jolt, newBody, PHYS, stepBody, type Arena } from "../server/games/steamdeck/physics.ts";
import type { Room } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers, stubCanon } from "./helpers.ts";
import { checkReach } from "../scripts/steamdeck-reach.ts";

type View = any;

const view = (room: Room, playerId?: string): View => room.viewFor(playerId ? { kind: "player", playerId } : { kind: "host" }).game;
const pos = (room: Room, id: string) => view(room).world.runners.find((r: View) => r[0] === id) as [string, number, number, number, number];
const ticks = (n: number) => mock.timers.tick(TIMING.tickMs * n);

function start(names = ["Thad", "Ann", "Bo"], rounds = 1) {
  const rooms = makeRooms();
  const { room, players } = roomWithPlayers(rooms.manager, names);
  room.configure({ gameId: "steamdeck", settings: { rounds } });
  room.startGame();
  return { ...rooms, room, ids: players.map((p) => p.id), players };
}

function until(room: Room, phase: string) {
  for (let i = 0; i < 12 && view(room)?.phase !== phase; i++) room.hostGameAction("skip", {});
  assert.equal(view(room).phase, phase);
}

function plankDrawing(points: [number, number][]) {
  const d = createDrawing(null, 390, 219);
  const s = createStroke({ tool: "plank", width: 0.01 });
  for (const [x, y] of points) addPoint(s, x, y);
  d.strokes.push(s);
  return serialize(d);
}

const expectError = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof PartyError && e.code === code, code);

describe("Escape Thad's Steam Deck", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("makes the first agent Thad and everyone else a runner, then walks the phases", () => {
    const { room, ids } = start();
    const g = view(room);
    assert.equal(g.phase, "ASSIGNMENT");
    assert.equal(g.thad.id, ids[0]);
    assert.deepEqual(view(room, ids[0]).you.role, "thad");
    assert.deepEqual([view(room, ids[1]).you.role, view(room, ids[2]).you.role], ["runner", "runner"]);
    assert.deepEqual(g.roster.map((r: View) => r.id), ids.slice(1));
    assert.equal(room.viewFor({ kind: "host" }).timer!.totalMs, TIMING.assignmentMs);
    for (const phase of ["INTRO", "ESCAPE", "ESCALATION", "FINAL", "RESULTS"]) {
      mock.timers.tick(room.viewFor({ kind: "host" }).timer!.remainingMs);
      assert.equal(view(room).phase, phase);
    }
  });

  it("moves runners from their streamed buttons, and Thad's tilt shoves everyone", () => {
    const { room, ids } = start();
    until(room, "ESCAPE");
    ticks(10); // settle onto the floor
    const [, ann, bo] = ids as [string, string, string];
    const annStart = pos(room, ann)[1];
    const boStart = pos(room, bo)[1];
    room.gameInput(ann, "stream", { l: 0, r: 1, j: 0 });
    ticks(10);
    assert.ok(pos(room, ann)[1] > annStart + 80, "Ann ran right");
    assert.equal(pos(room, bo)[1], boStart, "Bo stood still");

    room.gameInput(bo, "stream", { tilt: 1 }); // a runner can't tilt
    ticks(5);
    assert.equal(view(room).world.tilt, 0);
    room.gameInput(ids[0]!, "stream", { tilt: 1 });
    ticks(20);
    assert.ok(view(room).world.tilt > 0.9);
    assert.ok(pos(room, bo)[1] > boStart + 20, "the Deck leaned and Bo slid");
    room.gameInput(ids[0]!, "stream", { tilt: 99 });
    ticks(5);
    assert.ok(view(room).world.tilt <= 1, "clamped");
  });

  it("jumps once per press", () => {
    const { room, ids } = start();
    until(room, "ESCAPE");
    ticks(10);
    const ann = ids[1]!;
    const floor = pos(room, ann)[2];
    room.gameInput(ann, "stream", { l: 0, r: 0, j: 1 });
    ticks(4);
    assert.ok(pos(room, ann)[2] < floor - 60, "in the air");
    ticks(30);
    assert.equal(pos(room, ann)[2], floor, "landed");
    room.gameInput(ann, "stream", { l: 0, r: 0, j: 1 }); // same press again: no new jump
    ticks(4);
    assert.equal(pos(room, ann)[2], floor);
  });

  it("stops simulating while the room is paused", () => {
    const { room, ids } = start();
    until(room, "ESCAPE");
    ticks(10);
    room.gameInput(ids[1]!, "stream", { r: 1, j: 0 });
    room.detachHost("host-socket");
    const frozen = pos(room, ids[1]!)[1];
    ticks(20);
    assert.equal(pos(room, ids[1]!)[1], frozen);
    room.attachHost("host-socket");
    ticks(5);
    assert.ok(pos(room, ids[1]!)[1] > frozen);
  });

  it("turns a runner's drawing into a plank: validated, one each, with a cooldown", () => {
    const { room, ids } = start();
    const flat = { drawing: plankDrawing([[0.3, 0.7], [0.4, 0.71], [0.5, 0.7]]) };
    expectError(() => room.gameInput(ids[1]!, "plank", flat), "PHASE_CLOSED");
    until(room, "ESCAPE");
    expectError(() => room.gameInput(ids[0]!, "plank", flat), "NOT_ALLOWED");
    expectError(() => room.gameInput(ids[1]!, "plank", { drawing: { v: 1, w: 1, h: 1, s: [["plank", 100, 0, 0, [1, 2, 3]]] } }), "INVALID_INPUT");
    expectError(() => room.gameInput(ids[1]!, "plank", { drawing: plankDrawing([[0.5, 0.2], [0.5, 0.8]]) }), "INVALID_INPUT");
    expectError(() => room.gameInput(ids[1]!, "plank", { drawing: { ...plankDrawing([[0.1, 0.5], [0.3, 0.5]]), s: [["wall", 100, 0, 0, [0, 0, 5000, 5000]]] } }), "INVALID_INPUT");
    room.gameInput(ids[1]!, "plank", flat);
    const [plank] = view(room).world.planks;
    assert.deepEqual(plank.slice(0, 4), [480, 800, 633, ids[1]]);
    expectError(() => room.gameInput(ids[1]!, "plank", flat), "INVALID_ACTION");
    assert.ok(view(room, ids[1]).you.plankReadyMs > 0);
    ticks(PLANK.cooldownMs / TIMING.tickMs + 1);
    room.gameInput(ids[1]!, "plank", { drawing: plankDrawing([[0.1, 0.5], [0.2, 0.5]]) });
    assert.equal(view(room).world.planks.filter((p: View) => p[3] === ids[1]).length, 1, "the new one replaced the old");
    ticks(PLANK.lifetimeMs / TIMING.tickMs + 1);
    assert.equal(view(room).world.planks.length, 0, "planks don't last");
  });

  it("ends the round early when everyone is out, scores it, rotates Thad and records the game", () => {
    const { room, ids, records } = start(["Thad", "Ann", "Bo"], 2);
    until(room, "ESCAPE");
    const game = (room as any).game;
    game.taken = game.taken.map(() => true); // a level with items to find keeps its exit shut until then
    for (const r of game.runners.values()) Object.assign(r.body, { x: game.level.exit[0] + 5, y: game.level.exit[1] + 10, vx: 0, vy: 0 });
    ticks(1);
    const g = view(room);
    assert.equal(g.phase, "RESULTS", "no reason to wait");
    assert.equal(g.results.escaped, 2);
    assert.ok(g.results.points[ids[1]!] > 100, "escaping pays");
    assert.equal(g.results.points[ids[0]!], undefined, "a Thad who trapped nobody gets nothing");

    room.hostGameAction("skip", {});
    assert.equal(view(room).round, 2);
    assert.equal(view(room).thad.id, ids[1], "Thad rotates");
    until(room, "RESULTS");
    room.hostGameAction("skip", {});
    assert.equal(room.status, "FINAL_RESULTS");
    const record = records.at(-1)!;
    assert.equal(record.gameId, "steamdeck");
    assert.equal(record.details?.kind, "steamdeck.v1");
    assert.equal((record.details!.data as View).rounds.length, 2);
    assert.ok((record.details!.data as View).rounds[1].points[ids[1]!] > 0, "round 2's Thad scored for the runners still inside");
  });

  it("keeps a runner where they were across a reconnect, and levels the Deck when Thad drops out", () => {
    const { room, ids, players } = start();
    until(room, "ESCAPE");
    ticks(10);
    room.gameInput(ids[0]!, "stream", { tilt: -1 });
    ticks(10);
    assert.ok(view(room).world.tilt < -0.9);
    const before = pos(room, ids[2]!);
    room.detachPlayerSocket("socket-2");
    room.detachPlayerSocket("socket-0");
    ticks(20);
    assert.ok(Math.abs(view(room).world.tilt) < 0.05, "no Thad, no tilt");
    room.attachPlayer(players[2]!, "socket-2b");
    assert.equal(pos(room, ids[2]!)[0], before[0]);
    assert.equal(view(room, ids[2]).you.role, "runner");
  });
});

describe("Escape Thad's Steam Deck: the cast and Thad's shake", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("deals every runner a different character, and Thad none", () => {
    const { room, ids } = start(["Thad", "Ann", "Bo", "Cy", "Dee", "Eve", "Fay", "Gus"]);
    const roster = view(room).roster as View[];
    const dealt = roster.map((r) => r.character);
    assert.equal(roster.length, 7);
    assert.equal(new Set(dealt).size, 7, "no repeats until the cast runs out");
    for (const id of dealt) assert.ok(CAST.some((c) => c.id === id), id);
    assert.ok(!roster.some((r) => r.id === ids[0]), "Thad holds the Deck: not a character");
    for (const r of roster) assert.ok(Number.isInteger(r.build) && r.build >= 0);
  });

  it("deals from a reshuffled cast once there are more runners than characters", () => {
    let n = 0;
    const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const dealt = dealCast(CAST.length + 3, random).map((d) => d.id);
    assert.equal(new Set(dealt.slice(0, CAST.length)).size, CAST.length);
    assert.equal(dealt.length, CAST.length + 3);
  });

  it("lets only Thad shake, only in play, then not again until it has recharged", () => {
    const { room, ids } = start();
    const [thad, ann] = ids as [string, string];
    expectError(() => room.gameInput(thad, "shake", {}), "PHASE_CLOSED");
    until(room, "ESCAPE");
    ticks(10);
    expectError(() => room.gameInput(ann, "shake", {}), "NOT_ALLOWED");
    const floor = pos(room, ann)[2];
    room.gameInput(thad, "shake", {});
    assert.deepEqual(view(room).world.shake, [SHAKE.cooldownMs, SHAKE.warnMs], "a rumble first");
    expectError(() => room.gameInput(thad, "shake", {}), "INVALID_ACTION");
    ticks(SHAKE.warnMs / TIMING.tickMs - 1);
    assert.equal(pos(room, ann)[2], floor, "nothing moves during the warning");
    ticks(3);
    assert.ok(pos(room, ann)[2] < floor - 10, "then everyone standing is thrown up");
    assert.equal(view(room).world.shake[1], -1);
    ticks(SHAKE.cooldownMs / TIMING.tickMs);
    assert.equal(view(room).world.shake[0], 0);
    room.gameInput(thad, "shake", {});
  });
});

describe("Escape Thad's Steam Deck: the games' own rules", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }));
  afterEach(() => mock.timers.reset());

  /** Swaps this round's level (the order is random) and puts everyone back at its spawn. */
  function useLevel(room: Room, id: string) {
    const game = (room as any).game;
    game.level = LEVELS.find((l) => l.id === id);
    game.taken = (game.level.items ?? []).map(() => false);
    game.stalker = null;
    game.stalkerNext = Number.POSITIVE_INFINITY;
    for (const r of game.runners.values()) Object.assign(r.body, newBody(game.level.spawn));
    return game;
  }

  it("keeps SLIM's dock shut until the team has found every part", () => {
    const { room, ids } = start();
    until(room, "ESCAPE");
    const game = useLevel(room, "slim");
    const ann = game.runners.get(ids[1]);
    const exit = game.level.exit;
    Object.assign(ann.body, { x: exit[0] + 5, y: exit[1] + 10, vx: 0, vy: 0 });
    ticks(2);
    assert.equal(view(room).world.exitOpen, false);
    assert.equal(pos(room, ids[1]!)[4], 0, "the dock is locked: still inside");
    // Touch every part: each is found once, for everyone.
    for (const item of game.level.items) {
      Object.assign(ann.body, { x: item.at[0] - 14, y: item.at[1] - 18, vx: 0, vy: 0 });
      ticks(1);
    }
    assert.deepEqual(view(room).world.taken, game.level.items.map(() => 1));
    assert.equal(view(room).world.exitOpen, true);
    Object.assign(ann.body, { x: exit[0] + 5, y: exit[1] + 10, vx: 0, vy: 0 });
    ticks(1);
    assert.equal(pos(room, ids[1]!)[4], 2, "out");
  });

  it("lets SLIM's stalker take a runner who lingers, and spares one who moves away", () => {
    const { room, ids } = start(["Thad", "Ann", "Bo"]);
    until(room, "ESCAPE");
    const game = useLevel(room, "slim");
    ticks(5);
    const [ann, bo] = [game.runners.get(ids[1]), game.runners.get(ids[2])];
    Object.assign(bo.body, { x: 1400, y: 744 });
    game.stalker = { x: ann.body.x + 40, y: ann.body.y - 74 };
    ticks(5);
    assert.ok(view(room, ids[1]).you.near > 0, "static builds");
    assert.equal(view(room, ids[2]).you.near, 0, "not for someone far away");
    ticks(game.level.stalker.killMs.ESCAPE / TIMING.tickMs);
    assert.equal(pos(room, ids[1]!)[4], 1, "taken");
    assert.equal(view(room).roster.find((r: View) => r.id === ids[1]).deaths, 1);
    assert.equal(game.stalker, null, "and he's gone for a moment");
  });
});

describe("Escape Thad's Steam Deck: physics", () => {
  const arena = (extra: Partial<Arena> = {}): Arena => ({ spawn: [100, 100], exit: [1500, 0, 50, 50], platforms: [[0, 500, 1600, 100]], hazards: [], planks: [], ...extra });
  const idle = { left: false, right: false, jumpSeq: 0 };
  const run1 = (b: ReturnType<typeof newBody>, a: Arena, seconds: number, input = idle, stats = { run: 1, jump: 1 }) => {
    for (let t = 0; t < seconds; t += 1 / 80) stepBody(b, input, a, 0, 1 / 80, stats);
  };
  const run = (b: ReturnType<typeof newBody>, a: Arena, seconds: number, input = idle, tilt = 0) => {
    const events: string[] = [];
    for (let t = 0; t < seconds; t += 1 / 80) events.push(...stepBody(b, input, a, tilt, 1 / 80));
    return events;
  };

  it("lands on platforms and planks from above, and passes up through planks", () => {
    const b = newBody([100, 100]);
    run(b, arena(), 1);
    assert.deepEqual([b.y, b.grounded], [500 - PHYS.height, true]);
    const onPlank = newBody([100, 100]);
    run(onPlank, arena({ planks: [{ x1: 50, x2: 250, y: 300 }] }), 1);
    assert.equal(onPlank.y, 300 - PHYS.height);
    const below = newBody([100, 400]);
    below.grounded = true;
    below.coyote = PHYS.coyoteS;
    run(below, arena({ platforms: [[0, 480, 1600, 100]], planks: [{ x1: 50, x2: 250, y: 380 }] }), 1, { ...idle, jumpSeq: 1 });
    assert.equal(below.y, 380 - PHYS.height, "jumped up through the plank and landed on it");
  });

  it("moves each character at their own speed and jump", () => {
    const top = (run: number) => {
      const b = newBody([100, 464]);
      run1(b, arena(), 1, { ...idle, right: true }, { run, jump: 1 });
      return b.vx;
    };
    assert.equal(top(1), PHYS.maxRunSpeed);
    assert.ok(Math.abs(top(0.84) - PHYS.maxRunSpeed * 0.84) < 1e-9, "a slow character tops out lower");
    const peak = (jump: number) => {
      const b = newBody([100, 464]);
      run1(b, arena(), 0.2);
      let top = b.y;
      for (let t = 0; t < 1; t += 1 / 80) {
        stepBody(b, { ...idle, jumpSeq: 1 }, arena(), 0, 1 / 80, { run: 1, jump });
        top = Math.min(top, b.y);
      }
      return 464 - top;
    };
    assert.ok(peak(0.86) < peak(1) * 0.8, "and jumps lower");
  });

  it("swims: sinks slowly, strokes up on jump, leaps out at the surface, and drowns if it stays under", () => {
    const pool = arena({ platforms: [[0, 500, 1600, 100]], water: [[0, 300, 1600, 200]] });
    const b = newBody([100, 400]);
    run(b, pool, 0.5);
    assert.equal(b.wet, true);
    assert.ok(b.vy <= PHYS.waterMaxFall, "sinks slowly");
    const deep = b.y;
    run(b, pool, 0.05, { ...idle, jumpSeq: 1 });
    assert.ok(b.y < deep, "a stroke up");
    // Head out at the surface: the next press leaps.
    Object.assign(b, { y: 290, vy: 0 });
    run(b, pool, 0.05, { ...idle, jumpSeq: 2 });
    assert.ok(b.vy < -PHYS.swimStroke, "a leap, not a stroke");
    const diver = newBody([100, 460]);
    const events = run(diver, pool, PHYS.breathS + 0.5);
    assert.ok(events.includes("died"), "drowned");
  });

  it("won't let anyone out through a locked exit", () => {
    const locked = newBody([1500, 0]);
    assert.ok(!run(locked, arena({ exitOpen: false }), 0.1).includes("escaped"));
    assert.ok(run(locked, arena({ exitOpen: true }), 0.1).includes("escaped"));
  });

  it("throws only a runner who is standing, with the shake", () => {
    const b = newBody([100, 100]);
    run(b, arena(), 1);
    assert.equal(jolt(b, 200, 500), true);
    assert.equal(b.grounded, false);
    assert.ok(b.vy < 0 && b.vx >= 200);
    assert.equal(jolt(b, 200, 500), false, "not again in the air");
  });

  it("kills on hazards and falls, respawns at the spawn, and escapes at the exit", () => {
    const b = newBody([100, 100]);
    assert.ok(run(b, arena({ hazards: [[0, 480, 1600, 20]] }), 1).includes("died"));
    run(b, arena(), PHYS.respawnS + 0.1);
    assert.deepEqual([b.deadFor, b.x], [0, 100]);
    const faller = newBody([100, 100]);
    assert.ok(run(faller, arena({ platforms: [] }), 2).includes("died"));
    const out = newBody([1500, 0]);
    assert.ok(run(out, arena(), 0.1).includes("escaped"));
    assert.equal(out.escaped, true);
  });
});

describe("Escape Thad's Steam Deck: the reachability checker", () => {
  const box = (over: Partial<Level> = {}): Level => ({
    id: "box",
    name: "Box",
    tagline: "",
    intro: [],
    spawn: [100, 800],
    exit: [1400, 780, 60, 80],
    platforms: [[0, 860, 1600, 40]],
    hazards: [],
    ...over,
  });

  it("finds the exit and items on an open floor, and flags a wall nobody can jump", () => {
    const open = checkReach(box({ items: [{ id: "gem", name: "Gem", at: [700, 840] }] }), "FINAL", { run: 1, jump: 1 });
    assert.deepEqual([open.exit, open.missingItems], [true, []]);
    const walled = checkReach(box({ platforms: [[0, 860, 1600, 40], [1000, 400, 40, 460]] }), "FINAL", { run: 1, jump: 1 });
    assert.equal(walled.exit, false);
  });

  it("flags a ledge only a stronger jump can make", () => {
    const ledge = box({ exit: [1400, 620, 60, 80], platforms: [[0, 860, 1600, 40], [1300, 700, 300, 200]] });
    assert.equal(checkReach(ledge, "ESCAPE", { run: 1, jump: 1.2 }).exit, true);
    assert.equal(checkReach(ledge, "ESCAPE", { run: 1, jump: 0.8 }).exit, false);
  });
});

describe("Escape Thad's Steam Deck over Socket.IO", () => {
  /** A real server, a host and `names` players (the first is Thad), already in the ESCAPE phase. */
  async function escapeRound(names: string[]) {
    const db = new PartyDb(":memory:");
    const server = createPartyServer({ db, auth: createAuthVerifier({ mode: "dev" }), authConfig: { mode: "dev" }, canon: stubCanon() });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
    const sockets: Socket[] = [];
    const latest = new Map<Socket, View>();
    const open = async () => {
      const s = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
      sockets.push(s);
      s.on("state", (st) => latest.set(s, st));
      await new Promise<void>((resolve) => s.once("connect", () => resolve()));
      return s;
    };
    const ask = (s: Socket, event: string, payload: object = {}) => s.timeout(5000).emitWithAck(event, payload);
    const wait = async (test: () => boolean, label: string) => {
      for (let i = 0; i < 150 && !test(); i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(test(), label);
    };
    const host = await open();
    const { code } = await ask(host, "host:create");
    const players: { s: Socket; id: string; token: string }[] = [];
    for (const name of names) {
      const s = await open();
      const joined = await ask(s, "player:join", { code, name });
      players.push({ s, id: joined.playerId, token: joined.token });
    }
    assert.equal((await ask(host, "room:configure", { gameId: "steamdeck", settings: { rounds: 1 } })).ok, true);
    assert.equal((await ask(host, "room:start")).ok, true);
    for (let i = 0; i < 2; i++) assert.equal((await ask(host, "game:host", { action: "skip" })).ok, true);
    await wait(() => latest.get(host)?.game?.phase === "ESCAPE", "escape phase");
    await new Promise((r) => setTimeout(r, 300));
    const runner = (s: Socket, id: string) => latest.get(s)?.game.world.runners.find((r: View) => r[0] === id);
    const close = () => {
      for (const s of sockets) s.close();
      server.close();
    };
    return { host, players, latest, open, ask, wait, runner, code, close };
  }

  it("streams runner buttons and Thad's tilt at game speed, and everyone sees the same world", async () => {
    const { host, players, latest, ask, wait, runner, close } = await escapeRound(["Thad", "Ann", "Bo"]);
    try {
      const x = (s: Socket, id: string) => runner(s, id)?.[1];
      const thad = players[0]!;
      const ann = players[1]!;
      const startX = x(host, ann.id);
      // 20 packets a second for a second: far over the acked-event budget, fine for the stream.
      for (let i = 0; i < 20; i++) {
        ann.s.emit("game:stream", { l: 0, r: 1, j: 0 });
        thad.s.emit("game:stream", { tilt: 0.5 });
        await new Promise((r) => setTimeout(r, 50));
      }
      await wait(() => x(host, ann.id) > startX + 150, "Ann moved on the host screen");
      assert.ok(latest.get(host).game.world.tilt > 0.4, "Thad's tilt reached the server");
      await wait(() => Math.abs(x(ann.s, ann.id) - x(host, ann.id)) < 1, "Ann's phone sees what the host sees");
      host.emit("game:stream", { tilt: -1 }); // the host display isn't a player: ignored
      await new Promise((r) => setTimeout(r, 200));
      assert.ok(latest.get(host).game.world.tilt > 0.4);
      assert.equal((await ask(ann.s, "game:input", { action: "stream", payload: {} })).ok, true, "the acked path still works, within its budget");
    } finally {
      close();
    }
  });

  it("holds up under five runners at once, a Thad flooding the stream, a plank mid-run and a reconnect", async () => {
    const { host, players, latest, open, ask, wait, runner, code, close } = await escapeRound(["Thad", "Ann", "Bo", "Cy", "Dee", "Eve"]);
    try {
      const [thad, ...runners] = players as { s: Socket; id: string; token: string }[];
      const before = new Map(runners.map((r) => [r.id, runner(host, r.id)!.slice()]));
      const deaths = () => new Map(latest.get(host).game.roster.map((r: View) => [r.id, r.deaths]));
      // Everyone at once for a second: runners at 20 Hz, Thad at 50 Hz with the tilt jumping about.
      for (let t = 0; t < 50; t++) {
        thad!.s.emit("game:stream", { tilt: t % 2 ? 0.9 : -0.9 });
        if (t % 2 === 0) runners.forEach((r, i) => r.s.emit("game:stream", { l: i % 2, r: 1 - (i % 2), j: t % 10 === 0 ? t : 0 }));
        if (t === 20) {
          // A plank drawn while the world is moving.
          const d = createDrawing(null, 390, 219);
          const s = createStroke({ tool: "plank" });
          for (const [px, py] of [[0.3, 0.6], [0.4, 0.61], [0.5, 0.6]] as [number, number][]) addPoint(s, px, py);
          d.strokes.push(s);
          const placed = await ask(runners[1]!.s, "game:input", { action: "plank", payload: { drawing: serialize(d) } });
          assert.equal(placed.ok, true, placed.message);
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      for (const r of runners) {
        const now = runner(host, r.id)!;
        assert.ok(Math.abs(now[1] - before.get(r.id)![1]) > 10 || (deaths().get(r.id) as number) > 0, `${r.id} moved or died trying`);
      }
      assert.equal(latest.get(host).game.world.planks.length, 1, "the plank is in everyone's world");

      // Far past the stream budget: the extra packets are dropped, nothing else breaks.
      for (let i = 0; i < 400; i++) thad!.s.emit("game:stream", { tilt: 0.25 });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(latest.get(host).game.phase, "ESCAPE");
      runners[0]!.s.emit("game:stream", { l: 0, r: 0, j: 0 });
      assert.equal((await ask(runners[0]!.s, "state:request")).ok, true, "other agents unaffected");

      // Reconnect: the same seat on a new socket; the old socket's input no longer counts.
      const ann = runners[0]!;
      const fresh = await open();
      const resumed = await ask(fresh, "player:resume", { code, token: ann.token });
      assert.equal(resumed.ok, true);
      await wait(() => latest.get(fresh)?.game?.you?.role === "runner", "back in as a runner");
      // Thad's last tilt (0.25, rightwards) may still slide Ann a little right; only a move left is steering.
      const [, atX, atY] = runner(host, ann.id)!;
      ann.s.emit("game:stream", { l: 1, r: 0, j: 99 });
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(runner(host, ann.id)![1] >= atX - 2, "the replaced socket can't steer");
      fresh.emit("game:stream", { l: 1, r: 0, j: latest.get(fresh).game.you.jumpSeq + 1 });
      await wait(() => {
        const [, x2, y2, , state] = runner(host, ann.id)!;
        return x2 < atX - 5 || y2 < atY - 20 || state !== 0;
      }, "the new socket steers (left, or up with the jump)");
      // Host and phones agree on the same tick.
      await wait(() => latest.get(fresh).game.tick === latest.get(host).game.tick, "same tick");
      assert.deepEqual(latest.get(fresh).game.world.runners, latest.get(host).game.world.runners);
    } finally {
      close();
    }
  });
});
