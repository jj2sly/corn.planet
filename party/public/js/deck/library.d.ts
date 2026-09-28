// Types for library.js, so tests (TypeScript) can import the module the browser runs.

export interface LibraryArt {
  from: string;
  to: string;
  accent: string;
  glyph: string;
  motif: string;
}

export interface LibraryEntry {
  readonly id: string;
  readonly title: string;
  readonly tagline: string;
  readonly description: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly players: string;
  readonly shelf: "handheld" | "party";
  readonly genre: string;
  readonly length: string;
  readonly controls: string[];
  readonly art: Readonly<LibraryArt>;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export declare const PLATFORM: string;
export declare const PLATFORM_NAME: string;
export declare const OS_VERSION: string;
export declare const AGENT_COLORS: readonly string[];
export declare const SHELVES: ReadonlyArray<{ id: "handheld" | "party"; label: string; blurb: string }>;
export declare function playersLabel(min: number, max: number): string;
export declare function initials(title: string): string;
export declare function libraryEntry(game: unknown): LibraryEntry;
export declare function libraryFrom(games: unknown): LibraryEntry[];
export declare function setLibrary(games: unknown): LibraryEntry[];
export declare function library(): LibraryEntry[];
export declare function gameInfo(id: string): LibraryEntry | null;
export declare function titleOf(id: string, fallback?: string): string;
export declare function withRecent(list: unknown, id: string | null, max?: number): string[];
export declare function homeOrder(entries: LibraryEntry[], recent?: string[], selectedId?: string | null): LibraryEntry[];
export declare function pagesFor(role: "host" | "player"): Array<{ id: string; label: string; icon: string }>;
export declare function spatialMove(rects: Array<Rect | null | undefined>, from: number, dir: string): number;
