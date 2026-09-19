export type AuthConfig =
  | { mode: "firebase"; projectId: string; apiKey: string; authDomain: string }
  | { mode: "dev" }
  | { mode: "none" };

/** Where games read CPI canon from. Null when no Firebase project is configured. */
export interface CanonConfig {
  projectId: string;
  /** Base URL of the CPI Database site, for the "inspect the record" links games show. */
  siteUrl: string;
}

export interface Config {
  port: number;
  host: string;
  production: boolean;
  databasePath: string;
  trustProxy: boolean;
  auth: AuthConfig;
  canon: CanonConfig | null;
  /** Who narrates My Cob Escaped: the built-in template director, or Claude (needs ANTHROPIC_API_KEY). */
  incidentDirector: "builtin" | "claude";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const projectId = env.FIREBASE_PROJECT_ID?.trim() ?? "";
  const mode = env.AUTH_MODE?.trim() || (projectId ? "firebase" : "none");

  let auth: AuthConfig;
  if (mode === "firebase") {
    const apiKey = env.FIREBASE_API_KEY?.trim() ?? "";
    const authDomain = env.FIREBASE_AUTH_DOMAIN?.trim() ?? "";
    if (!projectId || !apiKey || !authDomain) {
      throw new Error("AUTH_MODE=firebase needs FIREBASE_PROJECT_ID, FIREBASE_API_KEY and FIREBASE_AUTH_DOMAIN");
    }
    auth = { mode, projectId, apiKey, authDomain };
  } else if (mode === "dev") {
    if (production) throw new Error("AUTH_MODE=dev is refused when NODE_ENV=production");
    auth = { mode };
  } else if (mode === "none") {
    auth = { mode };
  } else {
    throw new Error(`Unknown AUTH_MODE "${mode}" (expected firebase, dev or none)`);
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PORT "${env.PORT}"`);

  // Canon is read from the same Firebase project as logins, but it does not depend on AUTH_MODE:
  // the canon collections are world-readable, so a server running with AUTH_MODE=none or dev
  // still serves canon-driven games to guests.
  const canon: CanonConfig | null = projectId
    ? {
        projectId,
        siteUrl: env.CPI_DATABASE_URL?.trim() || "https://jj2sly.github.io/corn.planet",
      }
    : null;

  const incidentDirector = env.MYCOB_DIRECTOR?.trim() || "builtin";
  if (incidentDirector !== "builtin" && incidentDirector !== "claude") {
    throw new Error(`Unknown MYCOB_DIRECTOR "${incidentDirector}" (expected builtin or claude)`);
  }

  return {
    port,
    host: env.HOST?.trim() || "0.0.0.0",
    production,
    databasePath: env.DATABASE_PATH?.trim() || "./data/party.db",
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
    auth,
    canon,
    incidentDirector,
  };
}
