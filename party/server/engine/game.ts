// Stable, game-facing contracts for the CPI Party runtime.
//
// Keep these types free of individual game implementations. The server owns the runtime
// lifecycle; a game supplies rules and viewer-safe state through these contracts.

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

export interface GameDetails {
  kind: string;
  data: unknown;
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

/** The runtime needs only this definition to install a game. Game-specific services live in GameContext. */
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
  create(ctx: unknown, settings: Settings): GameInstance;
}
