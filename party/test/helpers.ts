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

function canonRecord(ref: string, kind: CanonKind, title: string, fields: Record<string, string>): CanonRecord {
  return { ref, kind, title, fields, links: {}, url: `https://example.test/${ref}` };
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

/** An offline CanonService over a fixed record set. */
export function stubCanon(records: readonly CanonRecord[] = TEST_CANON): CanonService {
  const byRef = new Map(records.map((r) => [r.ref, r]));
  return {
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
    incrementUsage: (ids) => db.incrementUsage(ids),
    recordGame: (record) => {
      records.push(record);
      db.recordGame(record);
    },
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
