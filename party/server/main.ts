import { networkInterfaces } from "node:os";
import { createPartyServer } from "./app.ts";
import { createAuthVerifier } from "./auth.ts";
import { CANON_REFRESH_MS, createCanonService } from "./canon.ts";
import { loadConfig } from "./config.ts";
import { PartyDb } from "./db.ts";
import { reconcilePromotions } from "./promotion.ts";

const config = loadConfig();
let db: PartyDb;
try {
  db = new PartyDb(config.databasePath);
} catch (err) {
  console.error(
    `[corn-planet-party] Could not open the database at ${config.databasePath}. ` +
      "Check that its folder is on persistent storage (e.g. a volume mounted at /data) and writable by the server.",
  );
  throw err;
}
const auth = createAuthVerifier(config.auth);

// Canon is read from the CPI Database and kept warm here, so games can read it synchronously.
// With no Firebase project configured there is simply no canon, and canon-driven games say so
// rather than failing.
const canon = config.canon
  ? createCanonService(config.canon)
  : createCanonService({ projectId: "" });

const server = createPartyServer({ db, auth, authConfig: config.auth, canon, trustProxy: config.trustProxy });

// After every canon read, link Hall of Fame moments to any records filed from them.
async function refreshCanon(): Promise<void> {
  await canon.refresh();
  try {
    const promoted = reconcilePromotions(db, canon);
    if (promoted > 0) console.log(`[corn-planet-party] ${promoted} Hall of Fame moment(s) are now canon.`);
  } catch (err) {
    console.error("[corn-planet-party] could not link promoted moments:", err);
  }
}

if (config.canon) {
  void refreshCanon().then(() => {
    const { records, lastError } = canon.status();
    console.log(`[corn-planet-party] canon loaded: ${records} CPI Database records${lastError ? ` (partial: ${lastError})` : ""}`);
  });
  const canonTimer = setInterval(() => void refreshCanon(), CANON_REFRESH_MS);
  canonTimer.unref();
} else {
  console.warn("[corn-planet-party] no FIREBASE_PROJECT_ID: canon-driven games have no source material.");
}

server.http.listen(config.port, config.host, () => {
  console.log("CORN PLANET PARTY SYSTEM INITIALIZING...");
  console.log(`  auth mode: ${config.auth.mode}   database: ${config.databasePath}`);
  console.log(`  host screen: http://localhost:${config.port}/host`);
  if (!config.production && (config.host === "0.0.0.0" || config.host === "::")) {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const a of addresses ?? []) {
        if (a.family === "IPv4" && !a.internal) console.log(`  phones on this network: http://${a.address}:${config.port}/play`);
      }
    }
  }
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[corn-planet-party] ${signal} received, closing sessions...`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
