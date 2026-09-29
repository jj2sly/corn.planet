import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { defaultDisplayName, bearerToken, type AuthUser, type AuthVerifier } from "./auth.ts";
import { PartyError, toClientError } from "./errors.ts";
import type { PartyDb } from "./db.ts";
import type { RoomManager } from "./rooms.ts";
import type { CanonService } from "./canon.ts";
import type { GameDefinition } from "./games/types.ts";

type NativeSession = { token: string; code: string; role: "host" | "player"; playerId?: string; connectionId: string; user: AuthUser | null; createdAt: number };
type NativeDeps = { rooms: RoomManager; auth: AuthVerifier; db: PartyDb; canon: CanonService; games: ReadonlyMap<string, GameDefinition> };

function body(req: Request): Record<string, unknown> {
  const value: unknown = req.body;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PartyError("INVALID_INPUT");
  return value as Record<string, unknown>;
}
function session(req: Request, sessions: Map<string, NativeSession>): NativeSession {
  const token = req.get("x-cpi-session");
  if (!token) throw new PartyError("AUTH_REQUIRED");
  const found = sessions.get(token);
  if (!found) throw new PartyError("SESSION_ENDED");
  return found;
}
async function verifyUser(req: Request, auth: AuthVerifier): Promise<AuthUser | null> {
  const token = bearerToken(req.get("authorization"));
  if (!token || auth.mode === "none") return null;
  return auth.verify(token);
}

export function createNativeApi({ rooms, auth, db, canon, games }: NativeDeps): express.Router {
  const api = express.Router();
  const sessions = new Map<string, NativeSession>();
  api.use(express.json({ limit: "16kb" }));

  api.get("/health", (_req, res) => res.json({ ok: true, protocol: 3 }));

  api.get("/games", (_req, res) => {
    res.json({
      games: [...games.values()].map(({ id, name, tagline, description, minPlayers, maxPlayers, defaultSettings, catalog, deck }) => ({
        id,
        name,
        tagline,
        description,
        minPlayers,
        maxPlayers,
        defaultSettings,
        catalog: catalog ?? null,
        deck: deck ?? null,
      })),
    });
  });

  api.get("/me", async (req, res) => {
    try {
      const current = await verifyUser(req, auth);
      if (!current) throw new PartyError("AUTH_REQUIRED");
      const displayName = db.ensureProfile(current.uid, defaultDisplayName(current.uid));
      res.json({ uid: current.uid, displayName, role: current.role, isModerator: current.isModerator });
    } catch (err) {
      res.status(401).json(toClientError(err));
    }
  });

  api.get("/me/stats", async (req, res) => {
    try {
      const current = await verifyUser(req, auth);
      if (!current) throw new PartyError("AUTH_REQUIRED");
      res.json(db.getUserStats(current.uid));
    } catch (err) {
      res.status(401).json(toClientError(err));
    }
  });

  api.get("/canon", (req, res) => {
    const kind = req.query.kind;
    const records = typeof kind === "string" && (kind === "entity" || kind === "incident" || kind === "personnel")
      ? canon.byKind(kind)
      : canon.all();
    res.json({
      records,
      status: canon.status(),
    });
  });

  api.get("/canon/:ref", (req, res) => {
    const record = canon.get(req.params.ref);
    if (!record) {
      res.status(404).json({ error: "CANON_NOT_FOUND" });
      return;
    }
    res.json(record);
  });

  api.post("/host", async (req, res) => {
    const user = await verifyUser(req, auth);
    const room = rooms.create();
    const connectionId = `native-host:${randomUUID()}`;
    room.attachHost(connectionId);
    const token = room.hostKey;
    sessions.set(token, { token, code: room.code, role: "host", connectionId, user, createdAt: Date.now() });
    res.status(201).json({ code: room.code, token, role: "host", state: room.viewFor({ kind: "host" }) });
  });

  api.post("/player", async (req, res) => {
    const input = body(req);
    const code = typeof input.code === "string" ? input.code : "";
    const name = typeof input.name === "string" ? input.name : "";
    const user = await verifyUser(req, auth);
    const room = rooms.get(code);
    const player = room.join(name, user?.uid ?? null);
    const connectionId = `native-player:${randomUUID()}`;
    room.attachPlayer(player, connectionId);
    const token = player.token;
    sessions.set(token, { token, code: room.code, role: "player", playerId: player.id, connectionId, user, createdAt: Date.now() });
    res.status(201).json({ code: room.code, token, role: "player", playerId: player.id, name: player.name, state: room.viewFor({ kind: "player", playerId: player.id }) });
  });

  function roomFor(req: Request) {
    const s = session(req, sessions);
    const room = rooms.get(s.code);
    return { s, room };
  }

  api.get("/state", (req, res) => {
    try {
      const { s, room } = roomFor(req);
      const view = s.role === "host" ? room.viewFor({ kind: "host" }) : room.viewFor({ kind: "player", playerId: s.playerId! });
      res.json(view);
    } catch (err) { res.status(400).json(toClientError(err)); }
  });

  api.post("/configure", (req, res) => {
    try {
      const { s, room } = roomFor(req);
      if (s.role !== "host") throw new PartyError("NOT_ALLOWED");
      const input = body(req);
      room.configure({ gameId: input.gameId, contentMode: input.contentMode, settings: input.settings });
      res.json(room.viewFor({ kind: "host" }));
    } catch (err) { res.status(400).json(toClientError(err)); }
  });

  api.post("/start", (req, res) => {
    try {
      const { s, room } = roomFor(req);
      if (s.role !== "host") throw new PartyError("NOT_ALLOWED");
      room.startGame();
      res.json(room.viewFor({ kind: "host" }));
    } catch (err) { res.status(400).json(toClientError(err)); }
  });

  api.post("/input", (req, res) => {
    try {
      const { s, room } = roomFor(req);
      if (s.role !== "player") throw new PartyError("NOT_ALLOWED");
      const input = body(req);
      room.gameInput(s.playerId!, input.action, input.payload);
      res.json({ ok: true });
    } catch (err) { res.status(400).json(toClientError(err)); }
  });

  api.post("/host-action", (req, res) => {
    try {
      const { s, room } = roomFor(req);
      if (s.role !== "host") throw new PartyError("NOT_ALLOWED");
      const input = body(req);
      room.hostGameAction(input.action, input.payload, input.step);
      res.json({ ok: true });
    } catch (err) { res.status(400).json(toClientError(err)); }
  });

  api.post("/leave", (req, res) => {
    try {
      const { s, room } = roomFor(req);
      if (s.role === "player" && s.playerId) room.removePlayer(s.playerId);
      else if (s.role === "host") room.detachHost(s.connectionId);
      sessions.delete(s.token);
      res.json({ ok: true });
    } catch (err) { res.status(400).json(toClientError(err)); }
  });

  return api;
}
