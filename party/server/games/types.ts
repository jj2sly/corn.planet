// The contract between the room system and a minigame.
//
// Rooms own everything generic: players, connections, reconnects, host/leader authority, the
// pausable phase timer, scores, stat counters, prompt selection and persisting results.
// A game owns only its own phases, rules and what each viewer is allowed to see.

import type { CanonKind, CanonRecord } from "../canon.ts";
import type { PickedPrompt } from "../db.ts";
import type { EffectLibrary } from "./auctioneffects.ts";

export type Viewer = { kind: "host" } | { kind: "player"; playerId: string };

export interface GamePlayer {
  id: string;
  name: string;
  connected: boolean;
}

export interface Highlight {
  title: string;
  playerName: string | null;
  text: string | null;
  detail: string;
}

/**
 * A game's read-only window onto the CPI Database. Reads come from the warm canon snapshot, so
 * they are synchronous and may be empty when canon has not loaded — a game must always cope with
 * getting fewer records than it asked for.
 *
 * There is no write path here on purpose. Anything a game makes up during a round is generated
 * content, is never canon, and never goes back to the CPI Database (see docs/CANON.md).
 */
export interface GameCanon {
  /** `count` distinct random canon records of a kind, using the room's seeded randomness. */
  sample(kind: CanonKind, count: number): CanonRecord[];
  /** Every canon record of a kind. A fresh array, safe for the caller to shuffle. */
  list(kind: CanonKind): CanonRecord[];
  get(ref: string): CanonRecord | null;
  /** Records that this round was built from a canon record; saved with the game's history. */
  used(round: number, ref: string): void;
}

/**
 * Something worth keeping from a game — for Cornlashing, a report the review board accepted. Moments
 * are saved with the game's history and shown in the Hall of Fame.
 *
 * A moment is generated content, never canon. A moderator can promote one, which hands it to the
 * Records Division to be filed by a person; nothing here ever writes to the CPI Database.
 */
export interface MomentInput {
  /** The player who made it, as a player id in this game. */
  authorId: string;
  /** The line itself. */
  text: string;
  /** What it was responding to, e.g. the incident prompt. */
  context: string;
  /** How many agents backed it, and how many could have. */
  votes: number;
  votesPossible: number;
}

/**
 * A game's structured record, saved as JSON with its history (game_details) for analytics, tuning
 * and review. Generated content, never canon. `kind` names the shape, e.g. "mycob.v1".
 */
export interface GameDetails {
  kind: string;
  data: unknown;
}

export interface GameContext {
  /** Players still in the game (not left or kicked), in join order. */
  players(): GamePlayer[];
  /** Display name for any player who was in this game, including ones who left. */
  playerName(playerId: string): string;
  /** Starts the single phase timer, replacing any existing one. Pauses with the room. */
  setTimer(ms: number, onExpire: () => void): void;
  clearTimer(): void;
  addPoints(playerId: string, points: number): void;
  /** Adds to a per-player counter persisted with the game (e.g. "votesCast", "category:corn"). */
  countStat(playerId: string, key: string, amount?: number): void;
  /** Random prompts for the room's content mode, avoiding repeats within the room. */
  pickPrompts(count: number): PickedPrompt[];
  /** The enabled hidden modifiers and Action Round events moderators manage (Entity Auction). */
  effectLibrary(): EffectLibrary;
  /** Read-only access to CPI canon, and a note of which records a round used. */
  canon: GameCanon;
  /** Keeps a memorable moment for the Hall of Fame; saved with the game when it finishes. */
  saveMoment(moment: MomentInput): void;
  /** Uniform random in [0, 1). Injectable so tests are deterministic. */
  random(): number;
  /** Tell the room the game's state changed so every viewer gets a fresh view. */
  changed(): void;
  /** End the game: the room ranks players by score, records stats and shows final results. */
  finish(summary: { rounds: number; highlights: Highlight[]; details?: GameDetails }): void;
}

export interface GameInstance {
  start(): void;
  /** A player action. Must validate everything and throw PartyError on anything invalid. */
  handleInput(playerId: string, action: string, payload: unknown): void;
  /** A host-screen or leader action (e.g. "skip"). Throws PartyError when invalid. */
  hostAction(action: string, payload: unknown): void;
  /** What one viewer may see right now. Never include hidden information for that viewer. */
  viewFor(viewer: Viewer): unknown;
  playerLeft(playerId: string): void;
  /**
   * Optional: the game's structured record so far, saved when it ends without finishing (sent back
   * to the lobby, room closed or abandoned, server shutting down, a game error). Server-side only.
   */
  abortDetails?(): GameDetails | null;
  dispose(): void;
}

export interface GameDefinition<Settings = unknown> {
  id: string;
  name: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  defaultSettings: Settings;
  /** Static choices the lobby can offer (e.g. modes), published in /api/config. */
  catalog?: unknown;
  /** Turns untrusted host input into valid settings (clamping/ignoring bad values). Never throws. */
  parseSettings(raw: unknown): Settings;
  create(ctx: GameContext, settings: Settings): GameInstance;
}
