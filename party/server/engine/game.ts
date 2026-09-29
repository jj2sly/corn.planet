// Stable, game-facing contracts for the CPI Party runtime.
//
// The runtime owns rooms, connections, timers, persistence and networking. Games own their
// rules and viewer-safe state. Keep these contracts independent of any individual game so
// future games (including CPI: Cold Case) can target the same runtime.

import type { CanonKind, CanonRecord } from "../canon.ts";
import type { PickedPrompt } from "../db.ts";
import type { EffectLibrary } from "../games/auctioneffects.ts";

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

export interface GameCanon {
  sample(kind: CanonKind, count: number): CanonRecord[];
  list(kind: CanonKind): CanonRecord[];
  get(ref: string): CanonRecord | null;
  used(round: number, ref: string): void;
}

export interface MomentInput {
  authorId: string;
  text: string;
  context: string;
  votes: number;
  votesPossible: number;
}

export interface GameDetails {
  kind: string;
  data: unknown;
}

/**
 * Services supplied by the runtime to an installed game.
 *
 * A game should depend on this interface rather than importing Room, Socket.IO, SQLite,
 * Firebase or another game's implementation.
 */
export interface GameContext {
  players(): GamePlayer[];
  playerName(playerId: string): string;
  setTimer(ms: number, onExpire: () => void): void;
  clearTimer(): void;
  addPoints(playerId: string, points: number): void;
  countStat(playerId: string, key: string, amount?: number): void;
  pickPrompts(count: number): PickedPrompt[];
  effectLibrary(): EffectLibrary;
  canon: GameCanon;
  saveMoment(moment: MomentInput): void;
  random(): number;
  paused(): boolean;
  changed(): void;
  finish(summary: { rounds: number; highlights: Highlight[]; details?: GameDetails }): void;
}

export interface GameInstance {
  start(): void;
  handleInput(playerId: string, action: string, payload: unknown): void;
  hostAction(action: string, payload: unknown): void;
  viewFor(viewer: Viewer): unknown;
  playerLeft(playerId: string): void;
  abortDetails?(): GameDetails | null;
  dispose(): void;
}

export interface DeckInfo {
  shelf: "handheld" | "party";
  genre: string;
  controls: string[];
  length: string;
  art: { from: string; to: string; accent: string; glyph: string; motif?: string };
}

export interface GameDefinition<Settings = unknown> {
  id: string;
  name: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  defaultSettings: Settings;
  catalog?: unknown;
  deck?: DeckInfo;
  parseSettings(raw: unknown): Settings;
  create(ctx: GameContext, settings: Settings): GameInstance;
}
