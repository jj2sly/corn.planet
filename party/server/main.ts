import { networkInterfaces } from "node:os";
import { createPartyServer } from "./app.ts";
import { createAuthVerifier } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { PartyDb } from "./db.ts";

const config = loadConfig();
const db = new PartyDb(config.databasePath);
const auth = createAuthVerifier(config.auth);
const server = createPartyServer({ db, auth, authConfig: config.auth, trustProxy: config.trustProxy });

server.http.listen(config.port, config.host, () => {
  console.log("CPST PARTY SYSTEM INITIALIZING...");
  console.log(`  auth mode: ${config.auth.mode}   database: ${config.databasePath}`);
  console.log(`  host screen: http://localhost:${config.port}/host`);
  if (!config.production) {
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
  console.log(`[cpst-party] ${signal} received, closing sessions...`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
