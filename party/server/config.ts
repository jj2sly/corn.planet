export type AuthConfig =
  | { mode: "firebase"; projectId: string; apiKey: string; authDomain: string }
  | { mode: "dev" }
  | { mode: "none" };

export interface Config {
  port: number;
  host: string;
  production: boolean;
  databasePath: string;
  trustProxy: boolean;
  auth: AuthConfig;
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

  return {
    port,
    host: env.HOST?.trim() || "0.0.0.0",
    production,
    databasePath: env.DATABASE_PATH?.trim() || "./data/party.db",
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
    auth,
  };
}
