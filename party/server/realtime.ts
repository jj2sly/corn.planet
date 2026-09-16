import { timingSafeEqual } from "node:crypto";
import type { DefaultEventsMap, Server, Socket } from "socket.io";
import { defaultDisplayName, type AuthUser, type AuthVerifier } from "./auth.ts";
import type { PartyDb } from "./db.ts";
import { PartyError, toClientError } from "./errors.ts";
import { RateLimiter } from "./ratelimit.ts";
import type { Room, RoomManager } from "./rooms.ts";

export interface SocketData {
  user: AuthUser | null;
  displayName: string | null;
  ip: string;
  code: string | null;
  role: "host" | "player" | null;
  playerId: string | null;
}

type PartySocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
type Payload = Record<string, unknown>;

const CLOSE_MESSAGES: Record<string, string> = {
  CLOSED_BY_HOST: "The host ended this session.",
  ABANDONED: "This session closed after everyone disconnected.",
  EXPIRED: "This session expired.",
};

function sameSecret(a: unknown, b: string): boolean {
  if (typeof a !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface RealtimeDeps {
  io: Server;
  rooms: RoomManager;
  auth: AuthVerifier;
  db: PartyDb;
  trustProxy: boolean;
}

export function createRealtime({ io, rooms, auth, db, trustProxy }: RealtimeDeps) {
  const connectLimiter = new RateLimiter(60, 60_000); // per IP
  const createLimiter = new RateLimiter(10, 10 * 60_000); // rooms per IP
  const joinLimiter = new RateLimiter(40, 60_000); // join/resume attempts per IP (limits code guessing)
  const eventLimiter = new RateLimiter(40, 10_000); // any event per socket
  const pruneTimer = setInterval(() => {
    for (const limiter of [connectLimiter, createLimiter, joinLimiter, eventLimiter]) limiter.prune();
  }, 60_000);
  pruneTimer.unref();

  // ------------------------------------------------------------------ broadcasting

  const pending = new Set<Room>();

  function sendState(room: Room, socket: PartySocket): void {
    const { role, playerId } = socket.data;
    if (role === "host") socket.emit("state", room.viewFor({ kind: "host" }));
    else if (role === "player" && playerId) socket.emit("state", room.viewFor({ kind: "player", playerId }));
  }

  function socketsIn(room: Room): PartySocket[] {
    const ids = io.sockets.adapter.rooms.get(room.code);
    if (!ids) return [];
    return [...ids].map((id) => io.sockets.sockets.get(id) as PartySocket | undefined).filter((s) => s !== undefined);
  }

  /** Every viewer gets their own view, coalesced to one push per room per tick. */
  function onRoomChange(room: Room): void {
    if (pending.has(room)) return;
    pending.add(room);
    queueMicrotask(() => {
      pending.delete(room);
      if (room.closed) return;
      for (const socket of socketsIn(room)) sendState(room, socket);
    });
  }

  function endSession(socket: PartySocket, error: string, message: string): void {
    socket.emit("session:ended", { error, message });
    unbind(socket);
  }

  function onRoomClose(room: Room, reason: string): void {
    for (const socket of socketsIn(room)) {
      endSession(socket, "SESSION_ENDED", CLOSE_MESSAGES[reason] ?? "This session has ended.");
    }
  }

  // ------------------------------------------------------------------ binding

  function unbind(socket: PartySocket): void {
    if (socket.data.code) socket.leave(socket.data.code);
    socket.data.code = null;
    socket.data.role = null;
    socket.data.playerId = null;
  }

  /** Detaches a socket from whatever room it is in (e.g. before joining another). */
  function leaveCurrent(socket: PartySocket): void {
    const room = socket.data.code ? rooms.rooms.get(socket.data.code) : undefined;
    if (room && socket.data.role === "host") room.detachHost(socket.id);
    if (room && socket.data.role === "player") room.detachPlayerSocket(socket.id);
    unbind(socket);
  }

  function bindHost(socket: PartySocket, room: Room): void {
    leaveCurrent(socket);
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.role = "host";
    room.attachHost(socket.id);
  }

  function bindPlayer(socket: PartySocket, room: Room, playerId: string): void {
    const player = room.activePlayers().find((p) => p.id === playerId)!;
    if (player.socketId !== socket.id) leaveCurrent(socket);
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.role = "player";
    socket.data.playerId = player.id;
    const replaced = room.attachPlayer(player, socket.id);
    if (replaced) {
      const old = io.sockets.sockets.get(replaced) as PartySocket | undefined;
      if (old) endSession(old, "SESSION_REPLACED", "This seat was opened on another screen.");
    }
  }

  function currentRoom(socket: PartySocket): Room {
    const room = socket.data.code ? rooms.rooms.get(socket.data.code) : undefined;
    if (!room) throw new PartyError("NOT_IN_ROOM");
    if (socket.data.role === "player") {
      const player = room.activePlayers().find((p) => p.id === socket.data.playerId);
      if (!player || player.socketId !== socket.id) throw new PartyError("SESSION_ENDED");
    }
    return room;
  }

  /** Host controls: the host display, or the room leader from their phone. */
  function controlledRoom(socket: PartySocket): Room {
    const room = currentRoom(socket);
    if (socket.data.role === "host") return room;
    if (socket.data.role === "player" && room.leaderId() === socket.data.playerId) return room;
    throw new PartyError("NOT_ALLOWED");
  }

  function playerIdentity(socket: PartySocket, room: Room, playerId: string) {
    const player = room.activePlayers().find((p) => p.id === playerId)!;
    return { code: room.code, playerId: player.id, token: player.token, name: player.name };
  }

  // ------------------------------------------------------------------ connection

  io.use(async (rawSocket, next) => {
    const socket = rawSocket as PartySocket;
    const forwarded = socket.handshake.headers["x-forwarded-for"];
    const ip = trustProxy && typeof forwarded === "string" ? forwarded.split(",")[0]!.trim() : socket.handshake.address;
    socket.data = { user: null, displayName: null, ip, code: null, role: null, playerId: null };
    if (!connectLimiter.take(ip)) return next(new Error("RATE_LIMITED"));

    const token: unknown = socket.handshake.auth?.token;
    if (typeof token === "string" && token.length > 0 && auth.mode !== "none") {
      try {
        const verified = await auth.verify(token);
        socket.data.user = verified;
        socket.data.displayName = db.ensureProfile(verified.uid, defaultDisplayName(verified.uid));
      } catch {
        return next(new Error("AUTH_FAILED"));
      }
    }
    next();
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as PartySocket;

    const on = (event: string, handler: (payload: Payload) => object | void) => {
      socket.on(event, (payload: unknown, ack: unknown) => {
        if (typeof payload === "function") [payload, ack] = [{}, payload];
        const reply = typeof ack === "function" ? (ack as (response: unknown) => void) : () => {};
        try {
          if (!eventLimiter.take(socket.id)) throw new PartyError("RATE_LIMITED");
          const input = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Payload) : {};
          reply({ ok: true, ...(handler(input) ?? {}) });
        } catch (err) {
          reply(toClientError(err));
        }
      });
    };

    socket.emit("hello", { loggedIn: socket.data.user !== null, displayName: socket.data.displayName });

    on("host:create", () => {
      if (!createLimiter.take(socket.data.ip)) throw new PartyError("RATE_LIMITED");
      const room = rooms.create();
      bindHost(socket, room);
      return { code: room.code, hostKey: room.hostKey };
    });

    on("host:resume", ({ code, hostKey }) => {
      if (!joinLimiter.take(socket.data.ip)) throw new PartyError("RATE_LIMITED");
      const room = rooms.get(code);
      if (!sameSecret(hostKey, room.hostKey)) throw new PartyError("SESSION_ENDED");
      bindHost(socket, room);
      return { code: room.code };
    });

    on("player:join", ({ code, name }) => {
      if (!joinLimiter.take(socket.data.ip)) throw new PartyError("RATE_LIMITED");
      const room = rooms.get(code);
      const player = room.join(name, socket.data.user?.uid ?? null);
      bindPlayer(socket, room, player.id);
      return playerIdentity(socket, room, player.id);
    });

    on("player:resume", ({ code, token }) => {
      if (!joinLimiter.take(socket.data.ip)) throw new PartyError("RATE_LIMITED");
      const room = rooms.get(code);
      const player = room.findByToken(token);
      if (!player) throw new PartyError("SESSION_ENDED");
      bindPlayer(socket, room, player.id);
      return playerIdentity(socket, room, player.id);
    });

    on("room:leave", () => {
      const room = currentRoom(socket);
      if (socket.data.role === "player" && socket.data.playerId) {
        room.removePlayer(socket.data.playerId);
      } else {
        room.detachHost(socket.id);
      }
      unbind(socket);
    });

    on("room:configure", ({ gameId, contentMode, settings }) => {
      controlledRoom(socket).configure({ gameId, contentMode, settings });
    });

    on("room:start", () => {
      controlledRoom(socket).startGame();
    });

    on("room:lobby", () => {
      controlledRoom(socket).returnToLobby();
    });

    on("room:resume", () => {
      controlledRoom(socket).resumeWithoutHost();
    });

    on("room:kick", ({ playerId }) => {
      const room = controlledRoom(socket);
      if (typeof playerId !== "string" || playerId === socket.data.playerId) throw new PartyError("INVALID_ACTION");
      const kickedSocketId = room.removePlayer(playerId);
      const kicked = kickedSocketId ? (io.sockets.sockets.get(kickedSocketId) as PartySocket | undefined) : undefined;
      if (kicked) endSession(kicked, "SESSION_ENDED", "The host removed you from this session.");
    });

    on("room:close", () => {
      const room = currentRoom(socket);
      if (socket.data.role !== "host") throw new PartyError("NOT_ALLOWED");
      rooms.close(room, "CLOSED_BY_HOST");
    });

    on("game:host", ({ action, payload }) => {
      controlledRoom(socket).hostGameAction(action, payload);
    });

    on("game:input", ({ action, payload }) => {
      const room = currentRoom(socket);
      if (socket.data.role !== "player" || !socket.data.playerId) throw new PartyError("NOT_ALLOWED");
      room.gameInput(socket.data.playerId, action, payload);
    });

    on("state:request", () => {
      sendState(currentRoom(socket), socket);
    });

    socket.on("disconnect", () => leaveCurrent(socket));
  });

  return { onRoomChange, onRoomClose, stop: () => clearInterval(pruneTimer) };
}
