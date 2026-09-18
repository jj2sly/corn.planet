import { randomBytes } from "node:crypto";
import type { CanonService } from "./canon.ts";
import { CONTENT_MODES, type ContentMode, type GameRecord, type PickedPrompt, type SavedMomentInput } from "./db.ts";
import { PartyError } from "./errors.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "./games/types.ts";
import { EMERGENCY_PROMPTS } from "./seed.ts";
import { cleanName, normalizeCode } from "./text.ts";

export const ROOM_LIMITS = {
  maxPlayers: 8,
  /** Hard cap on live rooms so a flood of room creation can't exhaust memory. */
  maxRooms: 500,
  /** A leader who blips offline (screen lock, refresh) keeps leadership this long. */
  leaderGraceMs: 30_000,
  /** Disconnected players are removed from a lobby after this long. */
  lobbyDropMs: 2 * 60_000,
  /** Rooms with nobody connected are closed after this long. */
  abandonMs: 10 * 60_000,
  maxAgeMs: 6 * 60 * 60_000,
};

// Consonants only: codes can't spell words, and there's no O/0 or I/1 confusion.
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

export type RoomStatus = "LOBBY" | "IN_GAME" | "FINAL_RESULTS";

export interface Player {
  id: string;
  token: string;
  name: string;
  uid: string | null;
  connected: boolean;
  socketId: string | null;
  joinedAt: number;
  disconnectedAt: number | null;
  /** Left or was kicked mid-game; kept only so scores and names survive until the game ends. */
  left: boolean;
}

export interface Standing {
  playerId: string;
  name: string;
  score: number;
  placement: number;
  left: boolean;
}

export interface FinalResults {
  gameId: string;
  gameName: string;
  rounds: number;
  standings: Standing[];
  highlights: Highlight[];
}

export interface RoomDeps {
  games: ReadonlyMap<string, GameDefinition>;
  canon: CanonService;
  pickPrompts(mode: ContentMode, count: number, exclude: ReadonlySet<number>): PickedPrompt[];
  incrementUsage(ids: number[]): void;
  recordGame(record: GameRecord): void;
  random(): number;
  onChange(room: Room): void;
  onClose(room: Room, reason: string): void;
}

interface PhaseTimer {
  totalMs: number;
  remainingMs: number;
  deadline: number;
  onExpire: () => void;
  handle: NodeJS.Timeout | null;
}

function secret(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export class Room {
  readonly code: string;
  readonly hostKey = secret(24);
  readonly createdAt = Date.now();
  readonly players: Player[] = [];
  readonly hostSockets = new Set<string>();
  status: RoomStatus = "LOBBY";
  gameId: string;
  contentMode: ContentMode = "chaos";
  gameSettings: unknown;
  results: FinalResults | null = null;
  emptySince: number | null = null;
  closed = false;
  /** The leader chose to keep playing while the host display is gone. */
  private hostlessResume = false;

  private readonly deps: RoomDeps;
  private game: GameInstance | null = null;
  private generation = 0;
  private gameStartedAt = 0;
  private scores = new Map<string, number>();
  private stats = new Map<string, Record<string, number>>();
  /** CPI canon records the current game drew on, saved with its history when it finishes. */
  private canonRefs: { round: number; ref: string }[] = [];
  /** Hall of Fame moments from the current game, saved with its history when it finishes. */
  private moments: SavedMomentInput[] = [];
  private readonly usedPromptIds = new Set<number>();
  private timer: PhaseTimer | null = null;
  /** Increments every time a game starts a new phase timer; lets host skips target one phase. */
  private step = 0;

  constructor(code: string, deps: RoomDeps) {
    this.code = code;
    this.deps = deps;
    const first = [...deps.games.values()][0]!;
    this.gameId = first.id;
    this.gameSettings = first.defaultSettings;
  }

  private get definition(): GameDefinition {
    return this.deps.games.get(this.gameId)!;
  }

  private changed(): void {
    if (!this.closed) this.deps.onChange(this);
  }

  get paused(): boolean {
    return this.status === "IN_GAME" && this.hostSockets.size === 0 && !this.hostlessResume;
  }

  activePlayers(): Player[] {
    return this.players.filter((p) => !p.left);
  }

  leaderId(): string | null {
    const now = Date.now();
    const active = this.activePlayers();
    const leader = active.find(
      (p) => p.connected || (p.disconnectedAt !== null && now - p.disconnectedAt < ROOM_LIMITS.leaderGraceMs),
    );
    return (leader ?? active[0])?.id ?? null;
  }

  // ---------------------------------------------------------------- membership

  /** Adds a player, or hands a logged-in user back the seat they already hold. */
  join(nameInput: unknown, uid: string | null): Player {
    if (uid) {
      const existing = this.activePlayers().find((p) => p.uid === uid);
      if (existing) return existing;
    }
    if (this.status === "IN_GAME") throw new PartyError("GAME_IN_PROGRESS");

    const name = cleanName(nameInput);
    if (!name) throw new PartyError("INVALID_NAME");
    const active = this.activePlayers();
    if (active.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new PartyError("NAME_TAKEN");
    if (active.length >= ROOM_LIMITS.maxPlayers) throw new PartyError("ROOM_FULL");

    const player: Player = {
      id: secret(6),
      token: secret(24),
      name,
      uid,
      connected: false,
      socketId: null,
      joinedAt: Date.now(),
      disconnectedAt: null,
      left: false,
    };
    this.players.push(player);
    this.changed();
    return player;
  }

  findByToken(token: unknown): Player | null {
    if (typeof token !== "string" || token.length !== 48) return null;
    return this.activePlayers().find((p) => p.token === token) ?? null;
  }

  /** Binds a socket to a player. Returns the socket id it replaced, if any. */
  attachPlayer(player: Player, socketId: string): string | null {
    const previous = player.socketId;
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = null;
    this.emptySince = null;
    this.changed();
    return previous !== socketId ? previous : null;
  }

  detachPlayerSocket(socketId: string): void {
    const player = this.players.find((p) => p.socketId === socketId);
    if (!player) return;
    player.socketId = null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    this.changed();
  }

  attachHost(socketId: string): void {
    this.hostSockets.add(socketId);
    this.hostlessResume = false;
    this.emptySince = null;
    this.syncPause();
    this.changed();
  }

  detachHost(socketId: string): void {
    if (!this.hostSockets.delete(socketId)) return;
    this.syncPause();
    this.changed();
  }

  /** Removes a player. Returns their socket id so the caller can notify it. */
  removePlayer(playerId: string): string | null {
    const index = this.players.findIndex((p) => p.id === playerId && !p.left);
    if (index === -1) throw new PartyError("NOT_FOUND");
    const player = this.players[index]!;
    const socketId = player.socketId;
    player.socketId = null;
    player.connected = false;

    if (this.status === "IN_GAME") {
      player.left = true;
      this.guard(() => this.game?.playerLeft(player.id));
    } else {
      this.players.splice(index, 1);
    }
    this.changed();
    return socketId;
  }

  // ---------------------------------------------------------------- host controls

  configure(input: { gameId?: unknown; contentMode?: unknown; settings?: unknown }): void {
    if (this.status === "IN_GAME") throw new PartyError("INVALID_ACTION");
    if (input.gameId !== undefined) {
      if (typeof input.gameId !== "string" || !this.deps.games.has(input.gameId)) throw new PartyError("UNKNOWN_GAME");
      if (input.gameId !== this.gameId) {
        this.gameId = input.gameId;
        this.gameSettings = this.definition.defaultSettings;
      }
    }
    if (input.contentMode !== undefined) {
      if (!CONTENT_MODES.includes(input.contentMode as ContentMode)) throw new PartyError("INVALID_INPUT");
      this.contentMode = input.contentMode as ContentMode;
    }
    if (input.settings !== undefined) {
      const current = typeof this.gameSettings === "object" && this.gameSettings !== null ? this.gameSettings : {};
      const patch = typeof input.settings === "object" && input.settings !== null ? input.settings : {};
      this.gameSettings = this.definition.parseSettings({ ...current, ...patch });
    }
    this.changed();
  }

  startGame(): void {
    if (this.status === "IN_GAME") throw new PartyError("INVALID_ACTION");
    const definition = this.definition;
    const active = this.activePlayers();
    if (active.filter((p) => p.connected).length < definition.minPlayers) throw new PartyError("NOT_ENOUGH_PLAYERS");
    if (active.length > definition.maxPlayers) throw new PartyError("TOO_MANY_PLAYERS");

    this.generation += 1;
    const generation = this.generation;
    const live = () => generation === this.generation && this.status === "IN_GAME";

    const ctx: GameContext = {
      players: () => this.activePlayers().map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      playerName: (id) => this.players.find((p) => p.id === id)?.name ?? "Unknown agent",
      setTimer: (ms, onExpire) => live() && this.setTimer(ms, onExpire),
      clearTimer: () => live() && this.clearTimer(),
      addPoints: (id, points) => live() && this.scores.set(id, (this.scores.get(id) ?? 0) + points),
      countStat: (id, key, amount = 1) => {
        if (!live()) return;
        const counters = this.stats.get(id) ?? {};
        counters[key] = (counters[key] ?? 0) + amount;
        this.stats.set(id, counters);
      },
      pickPrompts: (count) => this.pickPrompts(count),
      canon: {
        sample: (kind, count) => this.deps.canon.sample(kind, count, () => this.deps.random()),
        list: (kind) => [...this.deps.canon.byKind(kind)],
        get: (ref) => this.deps.canon.get(ref),
        used: (round, ref) => {
          // Only real canon ids are recorded, never anything a game invented.
          if (live() && this.deps.canon.get(ref)) this.canonRefs.push({ round, ref });
        },
      },
      saveMoment: (moment) => {
        if (!live()) return;
        // Resolved now, not at the end: the author may leave before the game finishes.
        const author = this.players.find((p) => p.id === moment.authorId);
        if (!author) return;
        this.moments.push({
          text: moment.text,
          context: moment.context,
          authorUid: author.uid,
          authorName: author.name,
          votes: moment.votes,
          votesPossible: moment.votesPossible,
        });
      },
      random: () => this.deps.random(),
      changed: () => live() && this.changed(),
      finish: (summary) => live() && this.finishGame(summary.rounds, summary.highlights),
    };

    this.scores = new Map(active.map((p) => [p.id, 0]));
    this.stats = new Map();
    this.canonRefs = [];
    this.moments = [];
    this.results = null;
    this.status = "IN_GAME";
    // Starting from a phone while the display is away is an explicit choice to play without it.
    this.hostlessResume = this.hostSockets.size === 0;
    this.gameStartedAt = Date.now();
    this.game = definition.create(ctx, definition.parseSettings(this.gameSettings));
    this.guard(() => this.game?.start());
    this.changed();
  }

  returnToLobby(): void {
    this.endGame();
    this.status = "LOBBY";
    this.results = null;
    this.scores = new Map();
    this.changed();
  }

  resumeWithoutHost(): void {
    if (this.status !== "IN_GAME" || this.hostSockets.size > 0) throw new PartyError("INVALID_ACTION");
    this.hostlessResume = true;
    this.syncPause();
    this.changed();
  }

  gameInput(playerId: string, action: unknown, payload: unknown): void {
    if (this.status !== "IN_GAME" || !this.game || typeof action !== "string") throw new PartyError("INVALID_ACTION");
    this.game.handleInput(playerId, action, payload);
  }

  /**
   * A host/leader game action. `expectedStep` (from the viewer's last state) makes it apply only
   * to the phase they were looking at, so a skip tapped just as a timer fires can't skip two phases.
   */
  hostGameAction(action: unknown, payload: unknown, expectedStep?: unknown): void {
    if (this.status !== "IN_GAME" || !this.game || typeof action !== "string") throw new PartyError("INVALID_ACTION");
    if (expectedStep !== undefined && expectedStep !== this.step) throw new PartyError("PHASE_CLOSED");
    this.game.hostAction(action, payload);
  }

  close(): void {
    this.endGame();
    this.closed = true;
  }

  // ---------------------------------------------------------------- game lifecycle

  private endGame(): void {
    this.generation += 1;
    this.clearTimer();
    this.game?.dispose();
    this.game = null;
    this.hostlessResume = false;
    // Players who left mid-game are only kept until the game is over.
    for (let i = this.players.length - 1; i >= 0; i--) {
      if (this.players[i]!.left) this.players.splice(i, 1);
    }
  }

  private finishGame(rounds: number, highlights: Highlight[]): void {
    const everyone = this.players.filter((p) => this.scores.has(p.id));
    const standings: Standing[] = everyone
      .map((p) => ({ playerId: p.id, name: p.name, score: this.scores.get(p.id) ?? 0, placement: 0, left: p.left }))
      .sort((a, b) => b.score - a.score);
    for (const s of standings) s.placement = 1 + standings.filter((o) => o.score > s.score).length;

    const record: GameRecord = {
      gameId: this.gameId,
      roomCode: this.code,
      rounds,
      startedAt: this.gameStartedAt,
      endedAt: Date.now(),
      players: standings.map((s) => ({
        uid: this.players.find((p) => p.id === s.playerId)?.uid ?? null,
        name: s.name,
        score: s.score,
        placement: s.placement,
        stats: this.stats.get(s.playerId) ?? {},
      })),
      canonRefs: this.canonRefs,
      moments: this.moments,
    };
    try {
      this.deps.recordGame(record);
    } catch (err) {
      console.error("[corn-planet-party] failed to record game stats:", err);
    }

    this.results = { gameId: this.gameId, gameName: this.definition.name, rounds, standings, highlights };
    this.endGame();
    this.status = "FINAL_RESULTS";
    this.changed();
  }

  private pickPrompts(count: number): PickedPrompt[] {
    let picked: PickedPrompt[] = [];
    try {
      picked = this.deps.pickPrompts(this.contentMode, count, this.usedPromptIds);
      if (picked.length < count) {
        // The room has seen the whole library: allow repeats rather than stopping the game.
        this.usedPromptIds.clear();
        const have = new Set(picked.map((p) => p.id!));
        picked = picked.concat(this.deps.pickPrompts(this.contentMode, count - picked.length, have));
      }
      const ids = picked.map((p) => p.id).filter((id): id is number => id !== null);
      for (const id of ids) this.usedPromptIds.add(id);
      this.deps.incrementUsage(ids);
    } catch (err) {
      console.error("[corn-planet-party] prompt lookup failed, using emergency prompts:", err);
    }
    for (let i = 0; picked.length < count; i++) {
      picked.push({ id: null, text: EMERGENCY_PROMPTS[i % EMERGENCY_PROMPTS.length]!, category: "general" });
    }
    return picked;
  }

  /** A bug inside a game must not take the whole server down: log it and reset the room. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[corn-planet-party] game error in room ${this.code}, returning to lobby:`, err);
      this.returnToLobby();
    }
  }

  // ---------------------------------------------------------------- timer

  private setTimer(ms: number, onExpire: () => void): void {
    this.clearTimer();
    this.step += 1;
    this.timer = { totalMs: ms, remainingMs: ms, deadline: Date.now() + ms, onExpire, handle: null };
    if (!this.paused) this.armTimer();
  }

  private armTimer(): void {
    const timer = this.timer;
    if (!timer || timer.handle) return;
    timer.deadline = Date.now() + timer.remainingMs;
    timer.handle = setTimeout(() => {
      if (this.timer !== timer) return;
      this.timer = null;
      this.guard(timer.onExpire);
    }, timer.remainingMs);
    // The HTTP server keeps the process alive; game timers alone shouldn't.
    timer.handle.unref?.();
  }

  private clearTimer(): void {
    if (this.timer?.handle) clearTimeout(this.timer.handle);
    this.timer = null;
  }

  private syncPause(): void {
    const timer = this.timer;
    if (!timer) return;
    if (this.paused && timer.handle) {
      clearTimeout(timer.handle);
      timer.handle = null;
      timer.remainingMs = Math.max(0, timer.deadline - Date.now());
    } else if (!this.paused) {
      this.armTimer();
    }
  }

  // ---------------------------------------------------------------- views

  viewFor(viewer: Viewer) {
    const leaderId = this.leaderId();
    const me = viewer.kind === "player" ? this.players.find((p) => p.id === viewer.playerId) : undefined;
    const timer = this.timer;
    return {
      code: this.code,
      status: this.status,
      paused: this.paused,
      hostConnected: this.hostSockets.size > 0,
      leaderId,
      step: this.step,
      maxPlayers: ROOM_LIMITS.maxPlayers,
      players: this.activePlayers().map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        score: this.scores.get(p.id) ?? 0,
      })),
      config: { gameId: this.gameId, contentMode: this.contentMode, settings: this.gameSettings },
      you:
        viewer.kind === "host"
          ? { role: "host" as const }
          : { role: "player" as const, playerId: me?.id ?? null, name: me?.name ?? null, isLeader: me?.id === leaderId, loggedIn: !!me?.uid },
      timer: timer
        ? {
            remainingMs: timer.handle ? Math.max(0, timer.deadline - Date.now()) : timer.remainingMs,
            totalMs: timer.totalMs,
            paused: !timer.handle,
          }
        : null,
      game: this.status === "IN_GAME" && this.game ? this.game.viewFor(viewer) : null,
      results: this.status === "FINAL_RESULTS" ? this.results : null,
    };
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly deps: RoomDeps;

  constructor(deps: RoomDeps) {
    this.deps = deps;
  }

  create(): Room {
    if (this.rooms.size >= ROOM_LIMITS.maxRooms) throw new PartyError("SERVER_BUSY");
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(this.deps.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) {
        const room = new Room(code, this.deps);
        this.rooms.set(code, room);
        return room;
      }
    }
    throw new PartyError("SERVER_ERROR");
  }

  get(codeInput: unknown): Room {
    const code = normalizeCode(codeInput);
    if (!code) throw new PartyError("INVALID_CODE");
    const room = this.rooms.get(code);
    if (!room) throw new PartyError("ROOM_NOT_FOUND");
    return room;
  }

  close(room: Room, reason: string): void {
    if (room.closed) return;
    room.close();
    this.rooms.delete(room.code);
    this.deps.onClose(room, reason);
  }

  /** Periodic housekeeping: drop long-gone lobby players, close abandoned and expired rooms. */
  cleanup(now = Date.now()): void {
    for (const room of [...this.rooms.values()]) {
      if (now - room.createdAt > ROOM_LIMITS.maxAgeMs) {
        this.close(room, "EXPIRED");
        continue;
      }
      if (room.status !== "IN_GAME") {
        for (const p of room.activePlayers()) {
          if (!p.connected && p.disconnectedAt !== null && now - p.disconnectedAt > ROOM_LIMITS.lobbyDropMs) {
            room.removePlayer(p.id);
          }
        }
      }
      const anyoneConnected = room.hostSockets.size > 0 || room.players.some((p) => p.connected);
      if (anyoneConnected) {
        room.emptySince = null;
      } else {
        room.emptySince ??= now;
        if (now - room.emptySince > ROOM_LIMITS.abandonMs) this.close(room, "ABANDONED");
      }
    }
  }
}
