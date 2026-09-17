// The canon service: the one way Corn Planet Party reads the CPI Database.
//
// Canon lives in the CPI Database's Firestore collections and is the source of truth for the
// fiction. This module gives games read-only access to it and nothing else — there is no write
// path here, by design. Anything a game invents during a round is generated content and never
// comes back through this file (see docs/CANON.md).
//
// The entity, incident and personnel collections are world-readable (see firestore.rules), so
// these reads carry no token: guests with no CPI account can still play canon-driven games.
//
// Canon is cached in memory and kept warm by refresh(), which main.ts calls at startup and on a
// timer. A refresh that fails keeps serving the last good snapshot, and a single unreadable
// collection never discards the ones that did load, so trouble at Firestore degrades a game's
// variety rather than ending it.

export type CanonKind = "entity" | "incident" | "personnel";

export interface CanonRecord {
  /** The CPI Database document id, e.g. "CPE-002". This is what a game shows and stores. */
  ref: string;
  kind: CanonKind;
  title: string;
  /** Cleaned text fields, keyed as in Firestore. Redacted spans are already removed. */
  fields: Readonly<Record<string, string>>;
  /** Cross-references to other canon records, keyed as in Firestore. */
  links: Readonly<Record<string, readonly string[]>>;
  /** Deep link to this record on the CPI Database site. */
  url: string;
}

/**
 * Reads are synchronous on purpose. A game's start() and viewFor() are synchronous, and making
 * the room lifecycle async just to reach canon would be a large change for no gain. Instead the
 * snapshot is kept warm by refresh(), which main.ts calls at startup and on a timer, exactly like
 * the room cleanup sweep.
 */
export interface CanonService {
  /** Re-reads every collection. Never rejects; failures are reported through status(). */
  refresh(): Promise<void>;
  /** Every canon record currently loaded. Empty until the first refresh lands. */
  all(): readonly CanonRecord[];
  byKind(kind: CanonKind): readonly CanonRecord[];
  get(ref: string): CanonRecord | null;
  /** `count` distinct random records of a kind. Returns fewer if canon is smaller than asked. */
  sample(kind: CanonKind, count: number, random?: () => number): CanonRecord[];
  /** For /healthz and the host lobby: how much canon is loaded and whether the last read worked. */
  status(): { records: number; lastLoadedAt: number | null; lastError: string | null };
}

interface CollectionSpec {
  kind: CanonKind;
  collection: string;
  page: string;
  /** Text fields a game may quote. Order matters only for readability. */
  textFields: readonly string[];
  /** Array-of-reference fields. */
  linkFields: readonly string[];
}

// artifacts/ART-### is deliberately absent: the collection is empty, so fetching it would cost a
// request per refresh for nothing. Add a spec here (page "artifact-entry.html") once it has content.
const COLLECTIONS: readonly CollectionSpec[] = [
  {
    kind: "entity",
    collection: "entities",
    page: "entry.html",
    textFields: ["classification", "containment", "description", "containmentProcedures", "addendum"],
    linkFields: [],
  },
  {
    kind: "incident",
    collection: "incidents",
    page: "incident-entry.html",
    textFields: ["severity", "status", "date", "summary", "description", "resolution", "addendum"],
    linkFields: ["entitiesInvolved", "personnelInvolved"],
  },
  {
    kind: "personnel",
    collection: "personnel",
    page: "personnel-entry.html",
    textFields: ["status", "clearance", "designation", "description", "specialisation", "addendum"],
    linkFields: ["notableIncidents"],
  },
];

/** How often main.ts re-reads canon. Small collections, so this is cheap. */
export const CANON_REFRESH_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 8000;
const PAGE_SIZE = 300;

/**
 * Removes the CPI Database's redaction markers. Redacted text is classified in-fiction and the
 * party server is public, so the hidden text is dropped rather than revealed. Longest marker
 * first, exactly as the database site does it.
 */
export function stripRedactions(text: string): string {
  return text
    .replace(/\/r!!(.*?)\/r!!/g, "[COSMIC ERASED]")
    .replace(/\/r!(.*?)\/r!/g, "[CLASSIFIED]")
    .replace(/\/r(.*?)\/r/g, "[REDACTED]");
}

/** Firestore text -> something safe to put on a host screen: no markers, no runaway whitespace. */
function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return stripRedactions(value).replace(/\s+/g, " ").trim();
}

/** True when a field still hides something, so a game shouldn't build a claim out of it. */
export function isRedacted(text: string): boolean {
  return text.includes("[REDACTED]") || text.includes("[CLASSIFIED]") || text.includes("[COSMIC ERASED]");
}

// Firestore REST returns typed values: { stringValue }, { arrayValue: { values: [...] } }, ...
type FirestoreValue = { stringValue?: string; arrayValue?: { values?: FirestoreValue[] } };
type FirestoreDoc = { name?: string; fields?: Record<string, FirestoreValue> };
type FirestoreList = { documents?: FirestoreDoc[]; nextPageToken?: string };

function refFromName(name: string | undefined): string {
  return name ? (name.split("/").pop() ?? "") : "";
}

function toRecord(doc: FirestoreDoc, spec: CollectionSpec, siteUrl: string): CanonRecord | null {
  const ref = refFromName(doc.name);
  if (!ref) return null;

  const raw = doc.fields ?? {};

  const fields: Record<string, string> = {};
  for (const key of spec.textFields) {
    const value = cleanText(raw[key]?.stringValue);
    if (value) fields[key] = value;
  }

  const links: Record<string, string[]> = {};
  for (const key of spec.linkFields) {
    const values = raw[key]?.arrayValue?.values ?? [];
    const list = values.map((v) => cleanText(v.stringValue)).filter((v) => v.length > 0);
    if (list.length) links[key] = list;
  }

  return {
    ref,
    kind: spec.kind,
    title: cleanText(raw.title?.stringValue) || `UNTITLED ${spec.kind.toUpperCase()}`,
    fields,
    links,
    url: `${siteUrl}/${spec.page}?id=${encodeURIComponent(ref)}`,
  };
}

export interface CanonOptions {
  /** The CPI Database Firebase project, e.g. "cpo-9af17". */
  projectId: string;
  /** Base URL of the CPI Database site, used for the "inspect the record" links. */
  siteUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createCanonService(options: CanonOptions): CanonService {
  const { projectId } = options;
  const siteUrl = (options.siteUrl ?? "https://jj2sly.github.io/corn.planet").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  let cache: readonly CanonRecord[] = [];
  let byRef = new Map<string, CanonRecord>();
  let lastLoadedAt: number | null = null;
  let lastError: string | null = null;
  let inFlight: Promise<void> | null = null;

  async function fetchCollection(spec: CollectionSpec): Promise<CanonRecord[]> {
    const records: CanonRecord[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(
        `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
          `/databases/(default)/documents/${spec.collection}`,
      );
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`${spec.collection}: HTTP ${response.status}`);

      const body = (await response.json()) as FirestoreList;
      for (const doc of body.documents ?? []) {
        const record = toRecord(doc, spec, siteUrl);
        if (record) records.push(record);
      }
      pageToken = body.nextPageToken;
    } while (pageToken);

    return records;
  }

  async function refresh(): Promise<void> {
    // Collections are fetched independently: one unreadable collection must not throw away the
    // ones that did load. A collection the CPI Database hasn't opened up yet simply contributes
    // nothing, and games fall back to the kinds that are available.
    const results = await Promise.allSettled(COLLECTIONS.map((spec) => fetchCollection(spec)));

    const loaded: CanonRecord[] = [];
    const failures: string[] = [];

    results.forEach((result, index) => {
      const spec = COLLECTIONS[index]!;
      if (result.status === "fulfilled") {
        loaded.push(...result.value);
      } else {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push(reason);
        // Stale canon beats no canon: keep what this kind had from the last good read.
        loaded.push(...cache.filter((r) => r.kind === spec.kind));
      }
    });

    if (failures.length === COLLECTIONS.length && lastLoadedAt !== null) {
      // Everything failed and we already had a snapshot — keep it untouched.
      lastError = failures.join("; ");
      console.error("[corn-planet-party] canon refresh failed:", lastError);
      return;
    }

    cache = loaded;
    byRef = new Map(loaded.map((r) => [r.ref, r]));
    lastLoadedAt = Date.now();
    lastError = failures.length ? failures.join("; ") : null;

    if (failures.length) {
      console.error("[corn-planet-party] canon partially unavailable:", lastError);
    }
  }

  return {
    refresh() {
      // One refresh at a time, however often the timer and callers overlap.
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    all() {
      return cache;
    },

    byKind(kind) {
      return cache.filter((r) => r.kind === kind);
    },

    get(ref) {
      return byRef.get(ref) ?? null;
    },

    sample(kind, count, random = Math.random) {
      const pool = cache.filter((r) => r.kind === kind);
      // Partial Fisher-Yates: shuffle only as far as we need.
      for (let i = 0; i < Math.min(count, pool.length); i++) {
        const j = i + Math.floor(random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      return pool.slice(0, count);
    },

    status() {
      return { records: cache.length, lastLoadedAt, lastError };
    },
  };
}
