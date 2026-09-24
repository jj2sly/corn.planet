// Types for drawing.js, so server code (TypeScript) can import the same module the browser runs.

export type Point = [number, number];

export interface Stroke {
  /** Normalized [x, y], each 0..1 across the canvas it was drawn on. */
  points: Point[];
  /** A fraction of the canvas width. */
  width: number;
  tool: string;
  layer: number;
  /** Milliseconds since the drawing started. */
  timestamp: number;
}

export interface Drawing {
  playerId: string | null;
  strokes: Stroke[];
  canvasWidth: number;
  canvasHeight: number;
}

export interface DrawingLimits {
  maxStrokes: number;
  maxPointsPerStroke: number;
  maxPoints: number;
  minWidth: number;
  maxWidth: number;
  maxLayer: number;
  tools: readonly string[] | null;
}

export interface SerializedDrawing {
  v: number;
  w: number;
  h: number;
  s: [string, number, number, number, number[]][];
}

export declare const DRAWING_VERSION: number;
export declare const DEFAULT_LIMITS: Readonly<DrawingLimits>;

export declare class DrawingError extends Error {}

export declare function createDrawing(playerId?: string | null, canvasWidth?: number, canvasHeight?: number): Drawing;
export declare function createStroke(options?: Partial<Pick<Stroke, "tool" | "width" | "layer" | "timestamp">>): Stroke;
export declare function addPoint(stroke: Stroke, x: number, y: number, options?: { minDistance?: number; maxPoints?: number }): boolean;
export declare function undo(drawing: Drawing): Stroke | null;
export declare function clear(drawing: Drawing): void;
export declare function pointCount(drawing: Drawing): number;
export declare function strokeBounds(stroke: Stroke): { minX: number; minY: number; maxX: number; maxY: number };
export declare function strokeLength(stroke: Stroke): number;
export declare function serialize(drawing: Drawing): SerializedDrawing;
export declare function deserialize(data: unknown, options?: { playerId?: string | null; limits?: Partial<DrawingLimits> }): Drawing;
export declare function interpret<C, R>(drawing: Drawing, rules: Record<string, (stroke: Stroke, drawing: Drawing, context: C) => R | null>, context: C): R[];
