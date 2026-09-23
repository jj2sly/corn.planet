import type { CanonKind, CanonRecord, CanonService } from "../server/canon.ts";
import { PartyDb, type GameRecord } from "../server/db.ts";
import { GAMES } from "../server/games/registry.ts";
import { RoomManager, type Room, type RoomDeps } from "../server/rooms.ts";

/** Small deterministic PRNG so shuffles and room codes are repeatable. */
export function seededRandom(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ canon

function canonRecord(ref: string, kind: CanonKind, title: string, fields: Record<string, string>, links: Record<string, string[]> = {}): CanonRecord {
  return { ref, kind, title, fields, links, url: `https://example.test/${ref}` };
}

/** A small, stable canon so game tests are deterministic and do not touch the network. */
export const TEST_CANON: CanonRecord[] = [
  canonRecord("CPE-001", "entity", "The Evil Jik", {
    classification: "COSMIC",
    containment: "MAXIMUM",
    containmentProcedures: "Do not make eye contact.",
    description: "An ancient grudge with legs.",
  }),
  canonRecord("CPE-002", "entity", "Thad Phelps", {
    classification: "EARTHLY",
    containment: "STANDARD",
    containmentProcedures: "Give him steam deck.",
    description: "Partakes in humiliation rituals.",
  }),
  canonRecord("CPE-004", "entity", "Chuck", {
    classification: "LOCAL",
    containment: "MINIMAL",
    containmentProcedures: "Leave the gate open.",
    description: "Chuck is a dog, probably.",
  }),
  canonRecord("CPE-005", "entity", "Big Yellow", {
    classification: "LOCAL",
    containment: "ENHANCED",
    containmentProcedures: "Do not water.",
    description: "Large. Yellow.",
  }),
  canonRecord("PER-001", "personnel", "Agent Kernel", {
    status: "ACTIVE",
    clearance: "LEVEL 3",
    designation: "Field Agent",
  }),
];

/**
 * Canon built to give an unidentified entity away every way it can: entity-specific breaches
 * (NEUTRALIZED, TERMINATION, a file that mentions a gate), classification-keyed environment lines
 * (COSMIC), procedures a breach would quote, a description that names it and its id, a prior
 * incident, and a staff member tied to it. My Cob's secrecy tests play unknown-entity games on it.
 */
export const SECRET_CANON = {
  gatekeeper: canonRecord("CPE-013", "entity", "The Spooky Gatekeeper", {
    classification: "NEUTRALIZED",
    containment: "TERMINATION",
    containmentProcedures: "Keep the gate shut at all times. Never let it near water, never feed it after midnight, and avoid eye contact.",
    description: "The Spooky Gatekeeper guards a door that is not there and whispers its designation, CPE-013, to anyone nearby.",
  }),
  howler: canonRecord("CPE-014", "entity", "Starhowler", {
    classification: "COSMIC",
    containment: "MAXIMUM",
    containmentProcedures: "Keep it in the dark and sing to it on the hour, every hour.",
    description: "Starhowler howls at stars that are not in the sky.",
  }),
  handler: canonRecord("PER-013", "personnel", "Agent Mallory Birch", { status: "ACTIVE", designation: "Handler", description: "Has handled it for years." }, { notableIncidents: ["INC-013"] }),
  bystander: canonRecord("PER-001", "personnel", "Agent Kernel", { status: "ACTIVE", designation: "Field Agent" }),
  priorGatekeeper: canonRecord("INC-013", "incident", "The Night Shift Incident", { summary: "The Spooky Gatekeeper got out and sat in the cafeteria." }, { entitiesInvolved: ["CPE-013"], personnelInvolved: ["PER-013"] }),
  priorHowler: canonRecord("INC-014", "incident", "Howling at Noon", { summary: "Starhowler howled at noon." }, { entitiesInvolved: ["CPE-014"] }),
};

/** SECRET_CANON around one of its two entities (the handler and the Night Shift Incident belong to the Gatekeeper). */
export function secretCanon(entity: "gatekeeper" | "howler"): CanonRecord[] {
  const c = SECRET_CANON;
  return entity === "gatekeeper" ? [c.gatekeeper, c.handler, c.bystander, c.priorGatekeeper, c.priorHowler] : [c.howler, c.bystander, c.priorHowler];
}

/**
 * Everything that would identify a SECRET_CANON entity if players saw it before it is identified.
 * Its own canon text is left out: that may be discovered in play (check it against known facts).
 */
export const UNKNOWN_ENTITY_LEAKS: { label: string; pattern: RegExp }[] = [
  { label: "entity name", pattern: /spooky|gatekeeper|starhowler/i },
  { label: "entity or related id", pattern: /\b(?:CPE|INC)[\s\-_.]*0*1[34]\b|\bPER[\s\-_.]*0*13\b/i },
  { label: "database link", pattern: /example\.test/i },
  { label: "staff tied to the entity", pattern: /Mallory|Birch|has dealt with this entity/i },
  { label: "entity-specific breach", pattern: /Procedure Violation|Termination Protocol|Neutraliz|Cascade Failure|Gate Left Open|"entitySpecific":true/i },
  { label: "classification or containment", pattern: /NEUTRALIZED|TERMINATION|COSMIC|MAXIMUM/ },
  { label: "classification-keyed environment", pattern: /four seconds behind|Clocks disagree/i },
];

/** An offline CanonService over a fixed record set. */
export function stubCanon(records: readonly CanonRecord[] = TEST_CANON): CanonService {
  const byRef = new Map(records.map((r) => [r.ref, r]));
  return {
    siteUrl: "https://example.test/corn.planet",
    async refresh() {},
    all: () => records,
    byKind: (kind) => records.filter((r) => r.kind === kind),
    get: (ref) => byRef.get(ref) ?? null,
    sample: (kind, count, random = Math.random) => {
      const pool = records.filter((r) => r.kind === kind);
      for (let i = 0; i < Math.min(count, pool.length); i++) {
        const j = i + Math.floor(random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      return pool.slice(0, count);
    },
    status: () => ({ records: records.length, lastLoadedAt: Date.now(), lastError: null }),
  };
}

export interface TestRooms {
  manager: RoomManager;
  db: PartyDb;
  records: GameRecord[];
  changes: Room[];
  closed: { code: string; reason: string }[];
}

export function makeRooms(overrides: Partial<RoomDeps> = {}): TestRooms {
  const db = new PartyDb(":memory:");
  const records: GameRecord[] = [];
  const changes: Room[] = [];
  const closed: { code: string; reason: string }[] = [];
  const manager = new RoomManager({
    games: GAMES,
    canon: stubCanon(),
    pickPrompts: (mode, count, exclude) => db.pickPrompts(mode, count, exclude),
    effectLibrary: () => db.effectLibrary(),
    incrementUsage: (ids) => db.incrementUsage(ids),
    recordGame: (record) => {
      records.push(record);
      db.recordGame(record);
    },
    recordAbortedGame: (record) => db.recordAbortedGame(record),
    random: seededRandom(),
    onChange: (room) => changes.push(room),
    onClose: (room, reason) => closed.push({ code: room.code, reason }),
    ...overrides,
  });
  return { manager, db, records, changes, closed };
}

/** Creates a room with a connected host and `names.length` connected players. */
export function roomWithPlayers(manager: RoomManager, names: string[], uids: (string | null)[] = []) {
  const room = manager.create();
  room.attachHost("host-socket");
  const players = names.map((name, i) => {
    const player = room.join(name, uids[i] ?? null);
    room.attachPlayer(player, `socket-${i}`);
    return player;
  });
  return { room, players };
}

// ------------------------------------------------------------------ view shapes used by tests

export interface ChaosView {
  phase: string;
  round: number;
  totalRounds: number;
  breach: boolean;
  multiplier: number;
  progress?: { playerId: string; done: number; needed: number }[];
  assignments?: { incidentId: string; prompt: string; answer: string | null }[];
  incidentId?: string;
  prompt?: string;
  reports?: { id: string; text: string }[];
  votesCast?: number;
  votesNeeded?: number;
  canVote?: boolean;
  ownReportId?: string | null;
  yourVote?: string | null;
  yourPoints?: number;
  verdict?: {
    defaulted: boolean;
    totalVotes: number;
    winningReportIds: string[];
    entries: { reportId: string; text: string; authorId: string; authorName: string; votes: number; points: number; unanimous: boolean }[];
  };
}

export function gameView(room: Room, playerId?: string): ChaosView {
  const view = room.viewFor(playerId ? { kind: "player", playerId } : { kind: "host" });
  return view.game as ChaosView;
}
