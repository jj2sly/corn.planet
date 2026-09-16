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
