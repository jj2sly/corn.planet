import type { Stroke } from "../drawing.js";

export declare function plankFromStroke(
  stroke: Stroke,
  world: { width: number; height: number; minLength: number; maxLength: number },
): { x1: number; x2: number; y: number } | null;
