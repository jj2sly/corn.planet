// The contract between the room system and a minigame.
//
// Rooms own everything generic: players, connections, reconnects, host/leader authority, the
// pausable phase timer, scores, stat counters, prompt selection and persisting results.
// A game owns only its own phases, rules and what each viewer is allowed to see.

import type { PickedPrompt } from "../db.ts";

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
  /** Uniform random in [0, 1). Injectable so tests are deterministic. */
  random(): number;
  /** Tell the room the game's state changed so every viewer gets a fresh view. */
  changed(): void;
  /** End the game: the room ranks players by score, records stats and shows final results. */
  finish(summary: { rounds: number; highlights: Highlight[] }): void;
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
  /** Turns untrusted host input into valid settings (clamping/ignoring bad values). Never throws. */
  parseSettings(raw: unknown): Settings;
  create(ctx: GameContext, settings: Settings): GameInstance;
}
