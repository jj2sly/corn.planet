import type { Stroke } from "../drawing.js";

export declare function plankFromStroke(
  stroke: Stroke,
  world: { width: number; height: number; minLength: number; maxLength: number },
): { x1: number; x2: number; y: number } | null;

export declare const SUGGESTED_PLANK: number;

export declare function strokeAhead(
  runner: { x: number; y: number; facing: number; width: number; height: number },
  world: { width: number; height: number },
  offset?: [number, number],
): Stroke;
