import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { PartyError } from "../server/errors.ts";
import { ROOM_LIMITS } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers } from "./helpers.ts";

function expectError(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof PartyError && err.code === code);
}

describe("room creation and codes", () => {
  it("creates rooms with unique 4-letter consonant codes", () => {
    const { manager } = makeRooms();
    const codes = new Set<string>();
    for (let i = 0; i < 300; i++) codes.add(manager.create().code);
    assert.equal(codes.size, 300);
    for (const code of codes) assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  });

  it("looks rooms up case-insensitively and rejects bad or unknown codes", () => {
    const { manager } = makeRooms();
    const room = manager.create();
    assert.equal(manager.get(room.code.toLowerCase()), room);
    expectError(() => manager.get("AB"), "INVALID_CODE");
    expectError(() => manager.get(12), "INVALID_CODE");
    expectError(() => manager.get("AAAA"), "ROOM_NOT_FOUND");
  });

  it("gives each room a long secret host key", () => {
    const { manager } = makeRooms();
    assert.match(manager.create().hostKey, /^[0-9a-f]{48}$/);
  });
});

describe("joining", () => {
  it("adds players in the lobby with private reconnect tokens", () => {
    const { manager } = makeRooms();
    const room = manager.create();
    const player = room.join("  Agent   Kernel ", null);
    assert.equal(player.name, "Agent Kernel");
    assert.match(player.token, /^[0-9a-f]{48}$/);
    const view = room.viewFor({ kind: "host" });
    assert.equal(view.players.length, 1);
    assert.ok(!JSON.stringify(view).includes(player.token), "tokens never appear in views");
  });

  it("rejects invalid, duplicate (case-insensitive) names", () => {
    const { manager } = makeRooms();
    const room = manager.create();
    room.join("Husk", null);
    expectError(() => room.join("husk", null), "NAME_TAKEN");
    expectError(() => room.join("   ", null), "INVALID_NAME");
    expectError(() => room.join("x".repeat(17), null), "INVALID_NAME");
    expectError(() => room.join(42, null), "INVALID_NAME");
  });

  it("enforces the 8-player limit", () => {
    const { manager } = makeRooms();
    const room = manager.create();
    for (let i = 0; i < ROOM_LIMITS.maxPlayers; i++) room.join(`P${i}`, null);
    expectError(() => room.join("Ninth", null), "ROOM_FULL");
  });

  it("refuses new players mid-game but lets a logged-in player reclaim their seat", () => {
    const { manager } = makeRooms();
    const { room, players } = roomWithPlayers(manager, ["A", "B", "C"], ["uid-a", null, null]);
    room.startGame();
    expectError(() => room.join("Late", null), "GAME_IN_PROGRESS");
    assert.equal(room.join("Whatever", "uid-a"), players[0]);
  });

  it("finds players by token only", () => {
    const { manager } = makeRooms();
    const room = manager.create();
    const player = room.join("A", null);
    assert.equal(room.findByToken(player.token), player);
    assert.equal(room.findByToken("0".repeat(48)), null);
    assert.equal(room.findByToken(undefined), null);
  });
});

describe("leaving, disconnecting and reconnecting", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("removes a lobby player immediately when they leave", () => {
    const { manager } = makeRooms();
    const { room, players } = roomWithPlayers(manager, ["A", "B"]);
    room.removePlayer(players[0]!.id);
    assert.deepEqual(room.activePlayers().map((p) => p.name), ["B"]);
    expectError(() => room.removePlayer(players[0]!.id), "NOT_FOUND");
  });

  it("keeps a mid-game leaver's score until the game ends, then drops them", () => {
    const { manager } = makeRooms();
    const { room, players } = roomWithPlayers(manager, ["A", "B", "C", "D"]);
    room.startGame();
    room.removePlayer(players[3]!.id);
    assert.equal(room.activePlayers().length, 3);
    assert.equal(room.players.length, 4);
    room.returnToLobby();
    assert.equal(room.players.length, 3);
  });

  it("marks players disconnected and reconnects them onto a new socket", () => {
    const { manager } = makeRooms();
    const { room, players } = roomWithPlayers(manager, ["A"]);
    room.detachPlayerSocket("socket-0");
    assert.equal(players[0]!.connected, false);
    const replaced = room.attachPlayer(players[0]!, "socket-new");
    assert.equal(replaced, null);
    assert.equal(players[0]!.connected, true);
    // Opening the same seat elsewhere reports the socket it replaced.
    assert.equal(room.attachPlayer(players[0]!, "socket-third"), "socket-new");
  });

  it("drops lobby players who stay disconnected, but not mid-game", () => {
    const { manager } = makeRooms();
    const { room, players } = roomWithPlayers(manager, ["A", "B", "C"]);
    room.detachPlayerSocket("socket-2");
    mock.timers.tick(ROOM_LIMITS.lobbyDropMs + 1);
    manager.cleanup();
    assert.equal(room.activePlayers().length, 2);

    const { room: busy } = roomWithPlayers(manager, ["A", "B", "C"]);
    busy.startGame();
    busy.detachPlayerSocket("socket-2");
    mock.timers.tick(ROOM_LIMITS.lobbyDropMs + 1);
    manager.cleanup();
    assert.equal(busy.activePlayers().length, 3);
    assert.ok(players.length);
  });
});

describe("leader and host", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("makes the earliest connected player leader and transfers after a grace period", () => {
    const { manager } = makeRooms();
    const { room, players } = roomWithPlayers(manager, ["A", "B", "C"]);
    assert.equal(room.leaderId(), players[0]!.id);

    room.detachPlayerSocket("socket-0");
    assert.equal(room.leaderId(), players[0]!.id, "a brief blip keeps leadership");
    mock.timers.tick(ROOM_LIMITS.leaderGraceMs + 1);
    assert.equal(room.leaderId(), players[1]!.id);

    room.attachPlayer(players[0]!, "socket-back");
    assert.equal(room.leaderId(), players[0]!.id);

    room.removePlayer(players[0]!.id);
    assert.equal(room.leaderId(), players[1]!.id);
  });

  it("pauses the game timer while the host display is gone and resumes exactly", () => {
    const { manager } = makeRooms();
    const { room } = roomWithPlayers(manager, ["A", "B", "C"]);
    room.startGame();
    mock.timers.tick(2000);
    room.detachHost("host-socket");
    assert.equal(room.viewFor({ kind: "host" }).paused, true);
    const remaining = room.viewFor({ kind: "host" }).timer!.remainingMs;
    mock.timers.tick(60_000);
    assert.equal(room.viewFor({ kind: "host" }).timer!.remainingMs, remaining, "paused timers don't run");
    assert.equal((room.viewFor({ kind: "host" }).game as { phase: string }).phase, "INTRO");

    room.attachHost("host-socket-2");
    assert.equal(room.viewFor({ kind: "host" }).paused, false);
    mock.timers.tick(remaining + 1);
    assert.equal((room.viewFor({ kind: "host" }).game as { phase: string }).phase, "ANSWERING");
  });

  it("lets the leader continue without the host display", () => {
    const { manager } = makeRooms();
    const { room } = roomWithPlayers(manager, ["A", "B", "C"]);
    room.startGame();
    room.detachHost("host-socket");
    room.resumeWithoutHost();
    assert.equal(room.paused, false);
    mock.timers.tick(10_000);
    assert.equal((room.viewFor({ kind: "host" }).game as { phase: string }).phase, "ANSWERING");
    expectError(() => {
      room.attachHost("h");
      room.resumeWithoutHost();
    }, "INVALID_ACTION");
  });
});

describe("configuration and starting", () => {
  it("validates game, content mode and clamps settings", () => {
    const { manager } = makeRooms();
    const room = manager.create();
    room.configure({ contentMode: "safe", settings: { rounds: 99, answerSeconds: "5", totalBreach: false } });
    assert.equal(room.contentMode, "safe");
    assert.deepEqual(room.gameSettings, { rounds: 3, answerSeconds: 30, voteSeconds: 25, totalBreach: false });
    expectError(() => room.configure({ gameId: "tetris" }), "UNKNOWN_GAME");
    expectError(() => room.configure({ contentMode: "spicy" }), "INVALID_INPUT");
  });

  it("requires 3 connected players and refuses to start twice", () => {
    const { manager } = makeRooms();
    const { room } = roomWithPlayers(manager, ["A", "B", "C"]);
    room.detachPlayerSocket("socket-2");
    expectError(() => room.startGame(), "NOT_ENOUGH_PLAYERS");
    room.attachPlayer(room.players[2]!, "socket-2b");
    room.startGame();
    assert.equal(room.status, "IN_GAME");
    expectError(() => room.startGame(), "INVALID_ACTION");
    expectError(() => room.configure({ contentMode: "safe" }), "INVALID_ACTION");
  });
});

describe("cleanup", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("closes rooms nobody is connected to after the abandon window", () => {
    const { manager, closed } = makeRooms();
    const { room } = roomWithPlayers(manager, ["A"]);
    room.detachHost("host-socket");
    room.detachPlayerSocket("socket-0");
    manager.cleanup();
    mock.timers.tick(ROOM_LIMITS.abandonMs + 1);
    manager.cleanup();
    assert.deepEqual(closed, [{ code: room.code, reason: "ABANDONED" }]);
    assert.equal(manager.rooms.size, 0);
  });

  it("keeps rooms alive while someone is connected, and expires very old rooms", () => {
    const { manager, closed } = makeRooms();
    const room = manager.create();
    room.attachHost("h");
    mock.timers.tick(ROOM_LIMITS.abandonMs * 2);
    manager.cleanup();
    assert.equal(manager.rooms.size, 1);
    mock.timers.tick(ROOM_LIMITS.maxAgeMs);
    manager.cleanup();
    assert.deepEqual(closed, [{ code: room.code, reason: "EXPIRED" }]);
  });
});
