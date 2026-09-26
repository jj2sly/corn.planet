// Types for thud-camera.js, so tests (TypeScript) can import the module the browser runs.

import type { Sampled } from "./thud-interp.js";

export interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface Camera {
  x: number;
  y: number;
  s: number;
}

export interface Level {
  width: number;
  groundY: number;
  cowX: number;
  zones: readonly (readonly [number, number])[];
  sling: { x: number; y: number };
}

export declare function fortBox(bodies: readonly Sampled[], level: Level): { l: number; r: number; t: number };
export declare function withMovers(box: Box, bodies: readonly Sampled[]): Box;
export declare function fit(
  box: Box,
  view: { width: number; height: number; insets?: { top: number; bottom: number }; level: Level; top?: number },
  opts?: { minSpan?: number; maxSpan?: number; fill?: number; anchor?: { x: number; at: number } | null; wholeHeight?: boolean },
): Camera;
export declare function frameShot(
  g: { level: Level; phase: string; action?: { stage?: string } | null },
  bodies: readonly Sampled[],
  view: { width: number; height: number; insets?: { top: number; bottom: number }; mode?: "host" | "phone"; camMode?: "auto" | "map"; ghost?: { x: number } | null; top?: number },
): Camera;
