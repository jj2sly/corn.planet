// Accounts are the existing CPST Database Firebase accounts. The browser signs in with the
// Firebase SDK and sends its ID token; this module verifies that token against Google's public
// keys and reads the user's CPI role from their own users/{uid} Firestore document.
// CPST Party never writes to Firebase.

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthConfig } from "./config.ts";
import { PartyError } from "./errors.ts";

export interface AuthUser {
  uid: string;
  role: string;
  isModerator: boolean;
}

export interface AuthVerifier {
  mode: AuthConfig["mode"];
  /** Resolves the user for a token, or throws PartyError("AUTH_FAILED" | "AUTH_DISABLED"). */
  verify(token: string): Promise<AuthUser>;
}

/** CPI roles from the database site's roles.js, lowest to highest. */
export const CPI_ROLES = ["VIEWER", "CPI_EMPLOYEE", "CORRESPONDENT", "OVERSEER", "EXEC"] as const;

/** Strike Team Overseers and CPI Execs moderate CPST Party prompts. */
const MODERATOR_ROLES = new Set(["OVERSEER", "EXEC"]);

const GOOGLE_JWKS = new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
const ROLE_CACHE_MS = 5 * 60_000;
const ROLE_FAILURE_CACHE_MS = 30_000;

function userFor(uid: string, role: string): AuthUser {
  const known = (CPI_ROLES as readonly string[]).includes(role) ? role : "VIEWER";
  return { uid, role: known, isModerator: MODERATOR_ROLES.has(known) };
}

export function createAuthVerifier(config: AuthConfig, fetchImpl: typeof fetch = fetch): AuthVerifier {
  if (config.mode === "none") {
    return {
      mode: "none",
      async verify() {
        throw new PartyError("AUTH_DISABLED");
      },
    };
  }

  if (config.mode === "dev") {
    console.warn("[cpst-party] AUTH_MODE=dev: fake logins are enabled. Never use this in production.");
    return {
      mode: "dev",
      // Token format: dev:<uid>:<ROLE>
      async verify(token) {
        const match = /^dev:([A-Za-z0-9_-]{1,40}):([A-Z_]+)$/.exec(token);
        if (!match) throw new PartyError("AUTH_FAILED");
        return userFor(`dev-${match[1]}`, match[2]!);
      },
    };
  }

  const { projectId } = config;
  const jwks = createRemoteJWKSet(GOOGLE_JWKS);
  const roleCache = new Map<string, { role: string; expiresAt: number }>();

  async function fetchRole(uid: string, token: string): Promise<string> {
    const cached = roleCache.get(uid);
    if (cached && cached.expiresAt > Date.now()) return cached.role;

    let role = "VIEWER";
    let ttl = ROLE_CACHE_MS;
    try {
      const url =
        `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
        `/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
      // The request carries the user's own token, so the existing Firestore rules decide what it may read.
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const doc = (await response.json()) as { fields?: { role?: { stringValue?: string } } };
        role = doc.fields?.role?.stringValue ?? "VIEWER";
      } else if (response.status !== 404) {
        ttl = ROLE_FAILURE_CACHE_MS;
      }
    } catch {
      // Fail closed: if the role can't be read, the user gets the lowest clearance.
      ttl = ROLE_FAILURE_CACHE_MS;
    }
    roleCache.set(uid, { role, expiresAt: Date.now() + ttl });
    return role;
  }

  return {
    mode: "firebase",
    async verify(token) {
      let uid: string;
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: `https://securetoken.google.com/${projectId}`,
          audience: projectId,
          algorithms: ["RS256"],
        });
        const authTime = payload.auth_time;
        if (typeof payload.sub !== "string" || payload.sub.length === 0 || payload.sub.length > 128) throw new Error("sub");
        if (typeof authTime !== "number" || authTime * 1000 > Date.now() + 60_000) throw new Error("auth_time");
        uid = payload.sub;
      } catch {
        throw new PartyError("AUTH_FAILED");
      }
      return userFor(uid, await fetchRole(uid, token));
    },
  };
}

export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer (\S{1,4096})$/.exec(header ?? "");
  return match ? match[1]! : null;
}

export function defaultDisplayName(uid: string): string {
  return `Agent ${uid.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase() || "X"}`;
}
