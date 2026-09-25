// Types for steamdeck-scenery.js, so tests (TypeScript) can import the module the browser runs.
// Every painter takes a CanvasRenderingContext2D (`ctx: unknown` here: tests pass a stand-in).

export interface Theme {
  name: string;
  props: unknown[][];
  decals?: unknown[][];
  live: unknown[][];
  [key: string]: unknown;
}

interface LevelLike {
  id: string;
  platforms: readonly (readonly number[])[];
  /** The server's { rect, from } hazards or the view's [x, y, w, h, live] arrays. */
  hazards: readonly unknown[];
}

export declare const MARGIN: number;
export declare const THEMES: Readonly<Record<string, Theme>>;
export declare function themeFor(levelId: string): Theme;
export declare function paintBackdrop(ctx: unknown, level: LevelLike, theme?: Theme): void;
export declare function paintSolids(ctx: unknown, level: LevelLike, theme?: Theme): void;
export declare function paintLive(ctx: unknown, level: LevelLike, time: number, theme?: Theme): void;
export declare function paintHazard(ctx: unknown, rect: readonly number[], options: { live: number | boolean; armed?: number; time?: number; theme?: Theme; kind?: string }): void;
export declare function paintExit(ctx: unknown, rect: readonly number[], options?: { time?: number; urgent?: boolean; out?: number; total?: number; style?: string; open?: boolean; found?: number; need?: number }): void;
export declare function paintWater(ctx: unknown, rect: readonly number[], time: number): void;
export declare function paintItem(ctx: unknown, name: string, x: number, y: number, time: number): void;
export declare function paintStalker(ctx: unknown, rect: readonly number[], time: number): void;
export declare function paintPlank(ctx: unknown, plank: { x1: number; x2: number; y: number }, options?: { color?: string; age?: number; ttl?: number; ghost?: boolean; invalid?: boolean; time?: number }): void;
export declare function paintVoid(ctx: unknown, width: number, height: number): void;
