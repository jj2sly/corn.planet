// CPI Drawing System: the data model every drawing game shares, in the browser and on the server.
//
// A Drawing is freehand strokes in normalized coordinates: every point is 0..1 across the canvas it
// was drawn on, so it renders the same on any screen. Strokes carry their width (a fraction of the
// canvas width), a tool id, a layer and a timestamp (ms since the drawing started). Nothing here is a
// raster image.
//
//   Drawing { playerId, strokes: Stroke[], canvasWidth, canvasHeight }
//   Stroke  { points: [x, y][], width, tool, layer, timestamp }
//
// On the wire a drawing is compact (serialize/deserialize): points become integers 0..10000 in one
// flat array. deserialize() validates everything and throws DrawingError on anything malformed, so a
// server can take a client's drawing as untrusted input.
//
// What a stroke *does* is up to the game: interpret() hands each stroke to the rule registered for its
// tool. A new game adds rules; it never touches this file. Capturing and rendering strokes in the
// browser is drawing-canvas.js.

export const DRAWING_VERSION = 1;

/** Integer resolution of a normalized coordinate on the wire. */
const SCALE = 10000;

export const DEFAULT_LIMITS = Object.freeze({
  maxStrokes: 32,
  maxPointsPerStroke: 200,
  maxPoints: 1500,
  minWidth: 0.002,
  maxWidth: 0.08,
  maxLayer: 7,
  /** Allowed tool ids, or null for any short id. */
  tools: null,
});

export class DrawingError extends Error {
  constructor(message) {
    super(message);
    this.name = "DrawingError";
  }
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round4 = (n) => Math.round(n * SCALE) / SCALE;

export function createDrawing(playerId = null, canvasWidth = 1, canvasHeight = 1) {
  return { playerId, strokes: [], canvasWidth, canvasHeight };
}

export function createStroke({ tool = "pen", width = 0.01, layer = 0, timestamp = 0 } = {}) {
  return { points: [], width, tool, layer, timestamp };
}

/**
 * Adds a normalized point, skipping ones closer than `minDistance` to the last (keeps strokes small).
 * Returns whether it was added.
 */
export function addPoint(stroke, x, y, { minDistance = 0.004, maxPoints = DEFAULT_LIMITS.maxPointsPerStroke } = {}) {
  if (stroke.points.length >= maxPoints) return false;
  const p = [round4(clamp(x, 0, 1)), round4(clamp(y, 0, 1))];
  const last = stroke.points.at(-1);
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < minDistance) return false;
  stroke.points.push(p);
  return true;
}

export function undo(drawing) {
  return drawing.strokes.pop() ?? null;
}

export function clear(drawing) {
  drawing.strokes.length = 0;
}

export function pointCount(drawing) {
  return drawing.strokes.reduce((n, s) => n + s.points.length, 0);
}

export function strokeBounds(stroke) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const [x, y] of stroke.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function strokeLength(stroke) {
  let length = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const [ax, ay] = stroke.points[i - 1];
    const [bx, by] = stroke.points[i];
    length += Math.hypot(bx - ax, by - ay);
  }
  return length;
}

/** Compact, JSON-safe form for the wire or storage. */
export function serialize(drawing) {
  return {
    v: DRAWING_VERSION,
    w: drawing.canvasWidth,
    h: drawing.canvasHeight,
    s: drawing.strokes.map((s) => [s.tool, Math.round(s.width * SCALE), s.layer, Math.round(s.timestamp), s.points.flatMap(([x, y]) => [Math.round(x * SCALE), Math.round(y * SCALE)])]),
  };
}

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

/**
 * Validates and rebuilds a drawing from its compact form. Throws DrawingError on anything malformed or
 * over the limits. `playerId` is set by the caller (a server never trusts the client's claim).
 */
export function deserialize(data, { playerId = null, limits = {} } = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new DrawingError("Not a drawing.");
  if (data.v !== DRAWING_VERSION) throw new DrawingError("Unknown drawing version.");
  const { w, h, s } = data;
  if (typeof w !== "number" || typeof h !== "number" || !(w > 0) || !(h > 0) || w > 100000 || h > 100000) throw new DrawingError("Bad canvas size.");
  if (!Array.isArray(s) || s.length > lim.maxStrokes) throw new DrawingError("Too many strokes.");
  let total = 0;
  const strokes = s.map((raw) => {
    if (!Array.isArray(raw) || raw.length !== 5) throw new DrawingError("Bad stroke.");
    const [tool, width, layer, timestamp, flat] = raw;
    if (typeof tool !== "string" || !/^[a-z][a-z0-9_-]{0,23}$/.test(tool)) throw new DrawingError("Bad tool.");
    if (lim.tools && !lim.tools.includes(tool)) throw new DrawingError(`The ${tool} tool isn't allowed here.`);
    if (!isInt(width, Math.floor(lim.minWidth * SCALE), Math.ceil(lim.maxWidth * SCALE))) throw new DrawingError("Bad stroke width.");
    if (!isInt(layer, 0, lim.maxLayer)) throw new DrawingError("Bad layer.");
    if (!isInt(timestamp, 0, 24 * 3600 * 1000)) throw new DrawingError("Bad timestamp.");
    if (!Array.isArray(flat) || flat.length % 2 !== 0 || flat.length === 0 || flat.length / 2 > lim.maxPointsPerStroke) throw new DrawingError("Bad points.");
    total += flat.length / 2;
    if (total > lim.maxPoints) throw new DrawingError("Too many points.");
    const points = [];
    for (let i = 0; i < flat.length; i += 2) {
      if (!isInt(flat[i], 0, SCALE) || !isInt(flat[i + 1], 0, SCALE)) throw new DrawingError("Point out of range.");
      points.push([flat[i] / SCALE, flat[i + 1] / SCALE]);
    }
    return { points, width: width / SCALE, tool, layer, timestamp };
  });
  return { playerId, strokes, canvasWidth: w, canvasHeight: h };
}

/**
 * Turns strokes into game objects. `rules` maps a tool id to (stroke, drawing, context) => object |
 * null; strokes with no rule, or whose rule returns null, produce nothing.
 */
export function interpret(drawing, rules, context) {
  const out = [];
  for (const stroke of drawing.strokes) {
    const rule = rules[stroke.tool];
    const result = rule ? rule(stroke, drawing, context) : null;
    if (result) out.push(result);
  }
  return out;
}
