import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { SEED_EFFECTS, validateEffect, type EffectDef, type EffectKind, type EffectLibrary, type Polarity } from "./games/auctioneffects.ts";
import { SEED_CATEGORIES } from "./seed.ts";

export type PromptRating = "safe" | "chaos";
export type PromptStatus = "pending" | "approved" | "disabled";
export type ContentMode = "safe" | "chaos" | "custom";
export type ModerationPolicy = "all" | "safe" | "none";

export const PROMPT_RATINGS: readonly PromptRating[] = ["safe", "chaos"];
export const PROMPT_STATUSES: readonly PromptStatus[] = ["pending", "approved", "disabled"];
export const CONTENT_MODES: readonly ContentMode[] = ["safe", "chaos", "custom"];
export const MODERATION_POLICIES: readonly ModerationPolicy[] = ["all", "safe", "none"];

export interface Prompt {
  id: number;
  text: string;
  category: string;
  tags: string[];
  rating: PromptRating;
  status: PromptStatus;
  packId: number | null;
  packName: string | null;
  authorUid: string | null;
  authorName: string | null;
  usageCount: number;
  openReports: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptInput {
  text: string;
  category: string;
  tags: string[];
  rating: PromptRating;
}

export interface Pack {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  promptCount: number;
}

export interface Settings {
  moderationPolicy: ModerationPolicy;
  reportThreshold: number;
}

export interface PickedPrompt {
  id: number | null;
  text: string;
  category: string;
}

export interface GameRecord {
  gameId: string;
  roomCode: string;
  rounds: number;
  startedAt: number;
  endedAt: number;
  players: { uid: string | null; name: string; score: number; placement: number; stats: Record<string, number> }[];
  /**
   * CPI Database records this game drew on, e.g. { round: 1, ref: "CPE-002" }. These point at
   * canon; nothing the game generated is stored here (see docs/CANON.md).
   */
  canonRefs?: { round: number; ref: string }[];
  /** Memorable moments for the Hall of Fame. Generated content, never canon. */
  moments?: SavedMomentInput[];
}

export interface SavedMomentInput {
  text: string;
  context: string;
  authorUid: string | null;
  authorName: string;
  votes: number;
  votesPossible: number;
}

export type MomentStatus = "visible" | "hidden";
export const MOMENT_STATUSES: readonly MomentStatus[] = ["visible", "hidden"];
export type MomentSort = "top" | "recent";

export interface Moment {
  id: number;
  gameId: string;
  text: string;
  context: string;
  authorUid: string | null;
  authorName: string;
  votes: number;
  votesPossible: number;
  status: MomentStatus;
  /** Set once a moderator has opened the Records Division for it. */
  promotionStartedAt: string | null;
  /** The canon record it became. Set only once that record really exists in the CPI Database. */
  canonRef: string | null;
  createdAt: string;
}

export interface UserStats {
  gamesPlayed: number;
  wins: number;
  bestPlacement: number | null;
  totalPoints: number;
  roundsPlayed: number;
  answersSubmitted: number;
  votesCast: number;
  votesReceived: number;
  unanimousRulings: number;
  promptsCreated: number;
  promptsApproved: number;
  promptUses: number;
  favoriteCategories: { category: string; count: number }[];
}

export interface HistoryEntry {
  gameId: string;
  endedAt: string;
  playerCount: number;
  rounds: number;
  score: number;
  placement: number;
}

type Row = Record<string, SQLInputValue>;

const DEFAULT_SETTINGS: Settings = { moderationPolicy: "safe", reportThreshold: 2 };

const SCHEMA_V1 = `
CREATE TABLE profiles (
  uid TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE categories (
  name TEXT PRIMARY KEY
);
CREATE TABLE packs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE prompts (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  category TEXT NOT NULL REFERENCES categories(name),
  tags TEXT NOT NULL DEFAULT '',
  rating TEXT NOT NULL CHECK (rating IN ('safe', 'chaos')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'disabled')),
  pack_id INTEGER REFERENCES packs(id) ON DELETE SET NULL,
  author_uid TEXT,
  builtin_key TEXT UNIQUE,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX prompts_author ON prompts(author_uid);
CREATE INDEX prompts_status ON prompts(status, rating);
CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  reporter_uid TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (prompt_id, reporter_uid)
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  game_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  player_count INTEGER NOT NULL,
  rounds INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL
);
CREATE TABLE game_players (
  game_row_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  uid TEXT,
  display_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  placement INTEGER NOT NULL,
  stats TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX game_players_uid ON game_players(uid);
`;

const PROMPT_SELECT = `
SELECT p.*, k.name AS pack_name, pr.display_name AS author_name,
  (SELECT COUNT(*) FROM reports r WHERE r.prompt_id = p.id AND r.resolved = 0) AS open_reports
FROM prompts p
LEFT JOIN packs k ON k.id = p.pack_id
LEFT JOIN profiles pr ON pr.uid = p.author_uid`;

const MOMENT_SELECT = `
SELECT m.*, g.game_id FROM moments m JOIN games g ON g.id = m.game_row_id`;

function toMoment(row: Row): Moment {
  return {
    id: Number(row.id),
    gameId: String(row.game_id),
    text: String(row.text),
    context: String(row.context),
    authorUid: row.author_uid === null ? null : String(row.author_uid),
    authorName: String(row.author_name),
    votes: Number(row.votes),
    votesPossible: Number(row.votes_possible),
    status: row.status as MomentStatus,
    promotionStartedAt: row.promotion_started_at === null ? null : String(row.promotion_started_at),
    canonRef: row.canon_ref === null ? null : String(row.canon_ref),
    createdAt: String(row.created_at),
  };
}

function toEffect(row: Row): EffectDef {
  let effect: EffectDef["effect"] = { type: "" };
  try {
    effect = JSON.parse(String(row.effect)) as EffectDef["effect"];
  } catch {
    // A corrupt effect is shown to moderators as broken and never played (see effectLibrary).
  }
  return {
    id: String(row.id),
    kind: row.kind as EffectKind,
    name: String(row.name),
    polarity: row.polarity === null ? null : (row.polarity as Polarity),
    description: String(row.description),
    effect,
    enabled: row.enabled === 1,
  };
}

// Prompts that may appear in games: approved, and not inside a disabled pack.
const PLAYABLE = `p.status = 'approved' AND (p.pack_id IS NULL OR k.enabled = 1)`;

function nowIso(): string {
  return new Date().toISOString();
}

function toPrompt(row: Row): Prompt {
  return {
    id: Number(row.id),
    text: String(row.text),
    category: String(row.category),
    tags: row.tags ? String(row.tags).split(",") : [],
    rating: row.rating as PromptRating,
    status: row.status as PromptStatus,
    packId: row.pack_id === null ? null : Number(row.pack_id),
    packName: row.pack_name === null ? null : String(row.pack_name),
    authorUid: row.author_uid === null ? null : String(row.author_uid),
    authorName: row.author_name === null ? null : String(row.author_name),
    usageCount: Number(row.usage_count),
    openReports: Number(row.open_reports),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class PartyDb {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
    this.seed();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const version = Number((this.db.prepare("PRAGMA user_version").get() as Row).user_version);
    if (version < 1) {
      this.transaction(() => {
        this.db.exec(SCHEMA_V1);
        this.db.exec("PRAGMA user_version = 1");
      });
    }
    if (version < 2) {
      // The group chose to start with an empty library: clear every prompt (reports cascade) and
      // the old built-in pack, once. Prompts added after this migration are never touched.
      this.transaction(() => {
        this.db.exec("DELETE FROM prompts");
        this.db.exec("DELETE FROM packs WHERE name = 'Standard Issue'");
        this.db.exec("PRAGMA user_version = 2");
      });
    }
    if (version < 3) {
      // Which canon a round was built from. Generated game content is never written here: this
      // table only ever holds ids that already exist in the CPI Database.
      this.transaction(() => {
        this.db.exec(`
CREATE TABLE IF NOT EXISTS game_canon_refs (
  game_row_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  ref TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS game_canon_refs_game ON game_canon_refs(game_row_id);
CREATE INDEX IF NOT EXISTS game_canon_refs_ref ON game_canon_refs(ref);
`);
        this.db.exec("PRAGMA user_version = 3");
      });
    }
    if (version < 4) {
      // The Hall of Fame. Generated content only: a moment becomes canon when a person files a
      // record in the Records Division, which sets canon_ref here (see promotion.ts).
      this.transaction(() => {
        this.db.exec(`
CREATE TABLE IF NOT EXISTS moments (
  id INTEGER PRIMARY KEY,
  game_row_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  author_uid TEXT,
  author_name TEXT NOT NULL,
  votes INTEGER NOT NULL,
  votes_possible INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  promotion_started_by TEXT,
  promotion_started_at TEXT,
  canon_ref TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS moments_game ON moments(game_row_id);
CREATE INDEX IF NOT EXISTS moments_status ON moments(status);
`);
        this.db.exec("PRAGMA user_version = 4");
      });
    }
    if (version < 5) {
      // Entity Auction's hidden modifiers and Action Round events. Seeded once; from then on
      // moderators own them. Effects are data (a type and its parameters), never code.
      this.transaction(() => {
        this.db.exec(`
CREATE TABLE IF NOT EXISTS auction_effects (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('modifier', 'event')),
  name TEXT NOT NULL,
  polarity TEXT CHECK (polarity IN ('buff', 'debuff', 'neutral')),
  description TEXT NOT NULL,
  effect TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
`);
        for (const e of SEED_EFFECTS) this.insertEffect(e);
        this.db.exec("PRAGMA user_version = 5");
      });
    }
  }

  private insertEffect(e: EffectDef): void {
    this.db
      .prepare(
        // OR IGNORE: re-running the seed migration never overwrites what moderators changed.
        `INSERT OR IGNORE INTO auction_effects (id, kind, name, polarity, description, effect, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.id, e.kind, e.name, e.polarity, e.description, JSON.stringify(e.effect), e.enabled ? 1 : 0, nowIso());
  }

  private seed(): void {
    const addCategory = this.db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
    this.transaction(() => {
      for (const name of SEED_CATEGORIES) addCategory.run(name);
    });
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---------------------------------------------------------------- profiles

  getDisplayName(uid: string): string | null {
    const row = this.db.prepare("SELECT display_name FROM profiles WHERE uid = ?").get(uid) as Row | undefined;
    return row ? String(row.display_name) : null;
  }

  /** Returns the profile's display name, creating the profile with `fallbackName` if needed. */
  ensureProfile(uid: string, fallbackName: string): string {
    const existing = this.getDisplayName(uid);
    if (existing !== null) return existing;
    const now = nowIso();
    this.db
      .prepare("INSERT INTO profiles (uid, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(uid, fallbackName, now, now);
    return fallbackName;
  }

  setDisplayName(uid: string, displayName: string): void {
    this.ensureProfile(uid, displayName);
    this.db.prepare("UPDATE profiles SET display_name = ?, updated_at = ? WHERE uid = ?").run(displayName, nowIso(), uid);
  }

  // ---------------------------------------------------------------- settings

  getSettings(): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as Row[];
    const settings: Settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key === "moderationPolicy" && MODERATION_POLICIES.includes(row.value as ModerationPolicy)) {
        settings.moderationPolicy = row.value as ModerationPolicy;
      }
      if (row.key === "reportThreshold") settings.reportThreshold = Number(row.value);
    }
    return settings;
  }

  updateSettings(changes: Partial<Settings>): Settings {
    const upsert = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    this.transaction(() => {
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) upsert.run(key, String(value));
      }
    });
    return this.getSettings();
  }

  /** The status a newly written (or edited) prompt gets under the current moderation policy. */
  private statusForNewText(rating: PromptRating): PromptStatus {
    const { moderationPolicy } = this.getSettings();
    if (moderationPolicy === "all") return "approved";
    if (moderationPolicy === "safe" && rating === "safe") return "approved";
    return "pending";
  }

  // ---------------------------------------------------------------- categories & packs

  listCategories(): string[] {
    return (this.db.prepare("SELECT name FROM categories ORDER BY name").all() as Row[]).map((r) => String(r.name));
  }

  hasCategory(name: string): boolean {
    return this.db.prepare("SELECT 1 FROM categories WHERE name = ?").get(name) !== undefined;
  }

  addCategory(name: string): void {
    this.db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(name);
  }

  /** Deletes a category, moving its prompts to "general". */
  deleteCategory(name: string): boolean {
    if (name === "general") return false;
    return this.transaction(() => {
      this.db.prepare("UPDATE prompts SET category = 'general' WHERE category = ?").run(name);
      return this.db.prepare("DELETE FROM categories WHERE name = ?").run(name).changes > 0;
    });
  }

  listPacks(): Pack[] {
    const rows = this.db
      .prepare(
        `SELECT k.*, (SELECT COUNT(*) FROM prompts p WHERE p.pack_id = k.id) AS prompt_count
         FROM packs k ORDER BY k.name`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      description: String(r.description),
      enabled: r.enabled === 1,
      promptCount: Number(r.prompt_count),
    }));
  }

  createPack(name: string, description: string): Pack | null {
    const result = this.db
      .prepare("INSERT OR IGNORE INTO packs (name, description, created_at) VALUES (?, ?, ?)")
      .run(name, description, nowIso());
    if (result.changes === 0) return null;
    return this.listPacks().find((p) => p.id === Number(result.lastInsertRowid)) ?? null;
  }

  updatePack(id: number, changes: { name?: string; description?: string; enabled?: boolean }): Pack | null {
    const pack = this.listPacks().find((p) => p.id === id);
    if (!pack) return null;
    try {
      this.db
        .prepare("UPDATE packs SET name = ?, description = ?, enabled = ? WHERE id = ?")
        .run(changes.name ?? pack.name, changes.description ?? pack.description, (changes.enabled ?? pack.enabled) ? 1 : 0, id);
    } catch {
      return null; // duplicate name
    }
    return this.listPacks().find((p) => p.id === id) ?? null;
  }

  // ---------------------------------------------------------------- prompts

  getPrompt(id: number): Prompt | null {
    const row = this.db.prepare(`${PROMPT_SELECT} WHERE p.id = ?`).get(id) as Row | undefined;
    return row ? toPrompt(row) : null;
  }

  createPrompt(authorUid: string, input: PromptInput): Prompt {
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO prompts (text, category, tags, rating, status, author_uid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.text, input.category, input.tags.join(","), input.rating, this.statusForNewText(input.rating), authorUid, now, now);
    return this.getPrompt(Number(result.lastInsertRowid))!;
  }

  /**
   * An author editing their own prompt. Edited text goes back through the moderation policy,
   * and a prompt a moderator disabled always returns to review instead of re-enabling itself.
   */
  updatePromptAsAuthor(id: number, input: PromptInput): Prompt {
    const current = this.getPrompt(id)!;
    const status: PromptStatus = current.status === "disabled" ? "pending" : this.statusForNewText(input.rating);
    this.db
      .prepare("UPDATE prompts SET text = ?, category = ?, tags = ?, rating = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(input.text, input.category, input.tags.join(","), input.rating, status, nowIso(), id);
    return this.getPrompt(id)!;
  }

  updatePromptAsModerator(
    id: number,
    changes: Partial<PromptInput> & { status?: PromptStatus; packId?: number | null },
  ): Prompt {
    const current = this.getPrompt(id)!;
    this.transaction(() => {
      this.db
        .prepare(
          "UPDATE prompts SET text = ?, category = ?, tags = ?, rating = ?, status = ?, pack_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          changes.text ?? current.text,
          changes.category ?? current.category,
          (changes.tags ?? current.tags).join(","),
          changes.rating ?? current.rating,
          changes.status ?? current.status,
          changes.packId === undefined ? current.packId : changes.packId,
          nowIso(),
          id,
        );
      // A moderator approving a prompt is the review of its open reports.
      if (changes.status === "approved") {
        this.db.prepare("UPDATE reports SET resolved = 1 WHERE prompt_id = ?").run(id);
      }
    });
    return this.getPrompt(id)!;
  }

  deletePrompt(id: number): boolean {
    return this.db.prepare("DELETE FROM prompts WHERE id = ?").run(id).changes > 0;
  }

  listPromptsByAuthor(uid: string): Prompt[] {
    return (this.db.prepare(`${PROMPT_SELECT} WHERE p.author_uid = ? ORDER BY p.created_at DESC`).all(uid) as Row[]).map(toPrompt);
  }

  /** How many prompts games can currently draw from, overall and safe-rated. */
  countPlayablePrompts(): { total: number; safe: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(p.rating = 'safe'), 0) AS safe
         FROM prompts p LEFT JOIN packs k ON k.id = p.pack_id WHERE ${PLAYABLE}`,
      )
      .get() as Row;
    return { total: Number(row.total), safe: Number(row.safe) };
  }

  listLibrary(filter: { rating?: PromptRating; category?: string; search?: string; limit: number; offset: number }): Prompt[] {
    const where = [PLAYABLE];
    const params: SQLInputValue[] = [];
    if (filter.rating) {
      where.push("p.rating = ?");
      params.push(filter.rating);
    }
    if (filter.category) {
      where.push("p.category = ?");
      params.push(filter.category);
    }
    if (filter.search) {
      where.push("p.text LIKE ? ESCAPE '\\'");
      params.push(`%${filter.search.replace(/[\\%_]/g, "\\$&")}%`);
    }
    const sql = `${PROMPT_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.author_uid IS NULL, p.created_at DESC LIMIT ? OFFSET ?`;
    return (this.db.prepare(sql).all(...params, filter.limit, filter.offset) as Row[]).map(toPrompt);
  }

  listForModeration(view: PromptStatus | "reported"): Prompt[] {
    const where = view === "reported" ? "open_reports > 0" : "status = ?";
    const params = view === "reported" ? [] : [view];
    const sql = `SELECT * FROM (${PROMPT_SELECT}) WHERE ${where} ORDER BY updated_at DESC LIMIT 500`;
    return (this.db.prepare(sql).all(...params) as Row[]).map(toPrompt);
  }

  listReports(promptId: number): { reason: string; createdAt: string; resolved: boolean }[] {
    const rows = this.db
      .prepare("SELECT reason, created_at, resolved FROM reports WHERE prompt_id = ? ORDER BY created_at DESC")
      .all(promptId) as Row[];
    return rows.map((r) => ({ reason: String(r.reason), createdAt: String(r.created_at), resolved: r.resolved === 1 }));
  }

  /** Files a report. Returns false if this user already reported the prompt. */
  reportPrompt(promptId: number, reporterUid: string, reason: string): { created: boolean; autoDisabled: boolean } {
    return this.transaction(() => {
      const result = this.db
        .prepare("INSERT OR IGNORE INTO reports (prompt_id, reporter_uid, reason, created_at) VALUES (?, ?, ?, ?)")
        .run(promptId, reporterUid, reason, nowIso());
      if (result.changes === 0) return { created: false, autoDisabled: false };

      const prompt = this.getPrompt(promptId)!;
      const { reportThreshold } = this.getSettings();
      if (prompt.status === "approved" && reportThreshold > 0 && prompt.openReports >= reportThreshold) {
        this.db.prepare("UPDATE prompts SET status = 'disabled', updated_at = ? WHERE id = ?").run(nowIso(), promptId);
        return { created: true, autoDisabled: true };
      }
      return { created: true, autoDisabled: false };
    });
  }

  dismissReports(promptId: number): void {
    this.db.prepare("UPDATE reports SET resolved = 1 WHERE prompt_id = ?").run(promptId);
  }

  /**
   * Picks up to `count` random playable prompts for a content mode, skipping `excludeIds`.
   * Custom mode prefers prompts written by the group's accounts.
   */
  pickPrompts(mode: ContentMode, count: number, excludeIds: ReadonlySet<number>): PickedPrompt[] {
    const exclude = [...excludeIds];
    const notIn = exclude.length ? `AND p.id NOT IN (${exclude.map(() => "?").join(",")})` : "";
    const pick = (extra: string, limit: number, skip: number[]): PickedPrompt[] => {
      const skipSql = skip.length ? `AND p.id NOT IN (${skip.map(() => "?").join(",")})` : "";
      const rows = this.db
        .prepare(
          `SELECT p.id, p.text, p.category FROM prompts p LEFT JOIN packs k ON k.id = p.pack_id
           WHERE ${PLAYABLE} ${extra} ${notIn} ${skipSql} ORDER BY random() LIMIT ?`,
        )
        .all(...exclude, ...skip, limit) as Row[];
      return rows.map((r) => ({ id: Number(r.id), text: String(r.text), category: String(r.category) }));
    };

    if (mode === "safe") return pick("AND p.rating = 'safe'", count, []);
    if (mode === "chaos") return pick("", count, []);

    const custom = pick("AND p.author_uid IS NOT NULL", count, []);
    if (custom.length >= count) return custom;
    return [...custom, ...pick("", count - custom.length, custom.map((p) => p.id!))];
  }

  incrementUsage(ids: number[]): void {
    const stmt = this.db.prepare("UPDATE prompts SET usage_count = usage_count + 1 WHERE id = ?");
    this.transaction(() => {
      for (const id of ids) stmt.run(id);
    });
  }

  // ---------------------------------------------------------------- entity auction library

  /** Every modifier and event, modifiers first, for the moderation console. */
  listAuctionEffects(): EffectDef[] {
    return (this.db.prepare("SELECT * FROM auction_effects ORDER BY kind DESC, id").all() as Row[]).map(toEffect);
  }

  getAuctionEffect(id: string): EffectDef | null {
    const row = this.db.prepare("SELECT * FROM auction_effects WHERE id = ?").get(id) as Row | undefined;
    return row ? toEffect(row) : null;
  }

  /** What a game may draw from: enabled entries whose effect is still one the engine knows. */
  effectLibrary(): EffectLibrary {
    const playable = this.listAuctionEffects().filter((e) => e.enabled && validateEffect(e.kind, e.effect).ok);
    return { modifiers: playable.filter((e) => e.kind === "modifier"), events: playable.filter((e) => e.kind === "event") };
  }

  /** Files a new modifier or event under the next free id for its kind, e.g. BUFF-005 or EVENT-011. */
  createAuctionEffect(input: Omit<EffectDef, "id">): EffectDef {
    const prefix = input.kind === "event" ? "EVENT" : (input.polarity ?? "neutral").toUpperCase();
    const rows = this.db.prepare("SELECT id FROM auction_effects WHERE id LIKE ?").all(`${prefix}-%`) as Row[];
    const next = 1 + Math.max(0, ...rows.map((r) => Number(String(r.id).slice(prefix.length + 1)) || 0));
    const id = `${prefix}-${String(next).padStart(3, "0")}`;
    this.insertEffect({ ...input, id });
    return this.getAuctionEffect(id)!;
  }

  updateAuctionEffect(
    id: string,
    changes: Partial<Pick<EffectDef, "name" | "polarity" | "description" | "effect" | "enabled">>,
  ): EffectDef | null {
    const current = this.getAuctionEffect(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    this.db
      .prepare("UPDATE auction_effects SET name = ?, polarity = ?, description = ?, effect = ?, enabled = ?, updated_at = ? WHERE id = ?")
      .run(next.name, next.polarity, next.description, JSON.stringify(next.effect), next.enabled ? 1 : 0, nowIso(), id);
    return this.getAuctionEffect(id);
  }

  // ---------------------------------------------------------------- games & stats

  recordGame(record: GameRecord): void {
    this.transaction(() => {
      const game = this.db
        .prepare(
          "INSERT INTO games (game_id, room_code, player_count, rounds, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.gameId,
          record.roomCode,
          record.players.length,
          record.rounds,
          new Date(record.startedAt).toISOString(),
          new Date(record.endedAt).toISOString(),
        );
      const addPlayer = this.db.prepare(
        "INSERT INTO game_players (game_row_id, uid, display_name, score, placement, stats) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const p of record.players) {
        addPlayer.run(game.lastInsertRowid, p.uid, p.name, p.score, p.placement, JSON.stringify(p.stats));
      }

      const addCanonRef = this.db.prepare("INSERT INTO game_canon_refs (game_row_id, round, ref) VALUES (?, ?, ?)");
      for (const { round, ref } of record.canonRefs ?? []) {
        addCanonRef.run(game.lastInsertRowid, round, ref);
      }

      const addMoment = this.db.prepare(
        `INSERT INTO moments (game_row_id, text, context, author_uid, author_name, votes, votes_possible, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const endedAt = new Date(record.endedAt).toISOString();
      for (const m of record.moments ?? []) {
        addMoment.run(game.lastInsertRowid, m.text, m.context, m.authorUid, m.authorName, m.votes, m.votesPossible, endedAt);
      }
    });
  }

  // ---------------------------------------------------------------- hall of fame

  /**
   * Hall of Fame entries. "top" ranks by the share of the board that backed a moment, so a
   * unanimous 4 of 4 beats a 3 of 7; "recent" is newest first.
   */
  listMoments(options: { includeHidden: boolean; sort: MomentSort; limit: number; offset: number }): Moment[] {
    const where = options.includeHidden ? "" : "WHERE m.status = 'visible'";
    const order =
      options.sort === "recent"
        ? "m.created_at DESC, m.id DESC"
        : "(m.votes * 1.0 / MAX(m.votes_possible, 1)) DESC, m.votes DESC, m.id DESC";
    const rows = this.db
      .prepare(`${MOMENT_SELECT} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(options.limit, options.offset) as Row[];
    return rows.map(toMoment);
  }

  getMoment(id: number): Moment | null {
    const row = this.db.prepare(`${MOMENT_SELECT} WHERE m.id = ?`).get(id) as Row | undefined;
    return row ? toMoment(row) : null;
  }

  setMomentStatus(id: number, status: MomentStatus): Moment | null {
    this.db.prepare("UPDATE moments SET status = ? WHERE id = ?").run(status, id);
    return this.getMoment(id);
  }

  /** Notes that a moderator opened the Records Division for this moment. Canon is not touched. */
  startPromotion(id: number, moderatorUid: string): Moment | null {
    this.db
      .prepare("UPDATE moments SET promotion_started_by = ?, promotion_started_at = ? WHERE id = ?")
      .run(moderatorUid, nowIso(), id);
    return this.getMoment(id);
  }

  /**
   * Records that a canon record now exists for this moment. Only ever called once the record has
   * been read back from the CPI Database. The first record wins if a moment was filed twice.
   * Returns true when this call changed something.
   */
  markMomentPromoted(id: number, canonRef: string): boolean {
    const result = this.db.prepare("UPDATE moments SET canon_ref = ? WHERE id = ? AND canon_ref IS NULL").run(canonRef, id);
    return Number(result.changes) > 0;
  }

  /** How often each canon record has been used in a game, most-used first. */
  canonUsage(): { ref: string; uses: number }[] {
    const rows = this.db
      .prepare("SELECT ref, COUNT(*) AS uses FROM game_canon_refs GROUP BY ref ORDER BY uses DESC, ref ASC")
      .all() as Row[];
    return rows.map((row) => ({ ref: String(row.ref), uses: Number(row.uses) }));
  }

  getUserStats(uid: string): UserStats {
    const rows = this.db.prepare("SELECT score, placement, stats FROM game_players WHERE uid = ?").all(uid) as Row[];
    const totals: Record<string, number> = {};
    let wins = 0;
    let totalPoints = 0;
    let bestPlacement: number | null = null;
    for (const row of rows) {
      totalPoints += Number(row.score);
      const placement = Number(row.placement);
      if (placement === 1) wins += 1;
      bestPlacement = bestPlacement === null ? placement : Math.min(bestPlacement, placement);
      try {
        for (const [key, value] of Object.entries(JSON.parse(String(row.stats)) as Record<string, unknown>)) {
          if (typeof value === "number") totals[key] = (totals[key] ?? 0) + value;
        }
      } catch {
        // A malformed stats blob only loses that game's counters.
      }
    }

    const prompts = this.db
      .prepare(
        `SELECT COUNT(*) AS created, SUM(status = 'approved') AS approved, COALESCE(SUM(usage_count), 0) AS uses
         FROM prompts WHERE author_uid = ?`,
      )
      .get(uid) as Row;

    const favoriteCategories = Object.entries(totals)
      .filter(([key]) => key.startsWith("category:"))
      .map(([key, count]) => ({ category: key.slice("category:".length), count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
      .slice(0, 3);

    return {
      gamesPlayed: rows.length,
      wins,
      bestPlacement,
      totalPoints,
      roundsPlayed: totals.roundsPlayed ?? 0,
      answersSubmitted: totals.answersSubmitted ?? 0,
      votesCast: totals.votesCast ?? 0,
      votesReceived: totals.votesReceived ?? 0,
      unanimousRulings: totals.unanimousRulings ?? 0,
      promptsCreated: Number(prompts.created),
      promptsApproved: Number(prompts.approved ?? 0),
      promptUses: Number(prompts.uses),
      favoriteCategories,
    };
  }

  getUserHistory(uid: string, limit = 20): HistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT g.game_id, g.ended_at, g.player_count, g.rounds, gp.score, gp.placement
         FROM game_players gp JOIN games g ON g.id = gp.game_row_id
         WHERE gp.uid = ? ORDER BY g.ended_at DESC LIMIT ?`,
      )
      .all(uid, limit) as Row[];
    return rows.map((r) => ({
      gameId: String(r.game_id),
      endedAt: String(r.ended_at),
      playerCount: Number(r.player_count),
      rounds: Number(r.rounds),
      score: Number(r.score),
      placement: Number(r.placement),
    }));
  }
}
