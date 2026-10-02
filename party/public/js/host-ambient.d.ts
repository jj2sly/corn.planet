// Types for host-ambient.js, so tests (TypeScript) can import the module the browser runs.

export type AmbientMood = "quiet" | "active" | "alert";

export declare function ambientTheme(gameId: unknown): string | null;
export declare function ambientMood(gameId: unknown, phase: unknown): AmbientMood;

export interface Ambient {
  /** The layer's root element (an HTMLElement in the browser), or null when nothing is showing. */
  // biome-ignore lint/suspicious/noExplicitAny: the tests give it a stand-in DOM
  readonly root: any;
  readonly motion: "still" | "drift";
  show(gameId: string | null | undefined, phase?: string): void;
  hide(): void;
  destroy(): void;
}

export declare function createAmbient(parent?: unknown, options?: { matchMedia?: (query: string) => unknown }): Ambient;
