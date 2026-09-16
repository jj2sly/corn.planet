import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { createApi } from "./api.ts";
import type { AuthVerifier } from "./auth.ts";
import type { AuthConfig } from "./config.ts";
import type { PartyDb } from "./db.ts";
import { GAMES } from "./games/registry.ts";
import { createRealtime } from "./realtime.ts";
import { RoomManager } from "./rooms.ts";

export interface PartyServerOptions {
  db: PartyDb;
  auth: AuthVerifier;
  authConfig: AuthConfig;
  trustProxy?: boolean;
  random?: () => number;
}

export interface PartyServer {
  http: HttpServer;
  io: Server;
  rooms: RoomManager;
  close(): Promise<void>;
}

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

// Pages load scripts only from this origin and the Firebase SDK CDN; no inline scripts anywhere.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.gstatic.com",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const PAGES: Record<string, string> = {
  "/": "index.html",
  "/host": "host.html",
  "/play": "play.html",
  "/account": "account.html",
  "/prompts": "prompts.html",
};

export function createPartyServer(options: PartyServerOptions): PartyServer {
  const { db, auth, authConfig } = options;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", options.trustProxy ? 1 : false);

  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size });
  });

  app.use(
    "/api",
    createApi({
      db,
      auth,
      firebase:
        authConfig.mode === "firebase"
          ? { apiKey: authConfig.apiKey, authDomain: authConfig.authDomain, projectId: authConfig.projectId }
          : null,
    }),
  );

  for (const [route, file] of Object.entries(PAGES)) {
    app.get(route, (_req, res) => res.sendFile(file, { root: PUBLIC_DIR }));
  }
  // Short share link: /join/ABCD opens the phone page with the code filled in.
  app.get("/join/:code", (req, res) => {
    const code = /^[A-Za-z]{4}$/.test(req.params.code) ? req.params.code.toUpperCase() : "";
    res.redirect(302, `/play${code ? `?code=${code}` : ""}`);
  });
  app.use(express.static(PUBLIC_DIR, { index: false, extensions: ["html"] }));
  app.use((_req, res) => res.status(404).sendFile("404.html", { root: PUBLIC_DIR }));
  // Never show stack traces to visitors, whatever NODE_ENV is.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[cpst-party] request error:", err);
    if (!res.headersSent) res.status(500).type("text/plain").send("CPST Party encountered an error. Try again.");
  });

  const http = createServer(app);
  const io = new Server(http, {
    serveClient: true,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  let realtime: ReturnType<typeof createRealtime> | null = null;
  const rooms = new RoomManager({
    games: GAMES,
    pickPrompts: (mode, count, exclude) => db.pickPrompts(mode, count, exclude),
    incrementUsage: (ids) => db.incrementUsage(ids),
    recordGame: (record) => db.recordGame(record),
    random: options.random ?? Math.random,
    onChange: (room) => realtime?.onRoomChange(room),
    onClose: (room, reason) => realtime?.onRoomClose(room, reason),
  });
  realtime = createRealtime({ io, rooms, auth, db, trustProxy: options.trustProxy ?? false });

  const cleanupTimer = setInterval(() => rooms.cleanup(), 15_000);
  cleanupTimer.unref();

  return {
    http,
    io,
    rooms,
    async close() {
      clearInterval(cleanupTimer);
      realtime?.stop();
      for (const room of [...rooms.rooms.values()]) rooms.close(room, "EXPIRED");
      await io.close();
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
