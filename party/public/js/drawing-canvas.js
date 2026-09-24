// CPI Drawing System, browser side: capture freehand strokes on a canvas (touch, pen or mouse) and
// render drawings. The data model is drawing.js; this file only turns pointer input into strokes and
// strokes into pixels.
//
//   const pad = createDrawingPad(canvas, { tool: "plank", width: 0.012, onChange: (drawing, active) => … });
//   pad.undo(); pad.clear(); pad.serialize(); pad.destroy();
//   renderDrawing(ctx2d, drawing, { width, height });
//
// The canvas needs `touch-action: none` so a finger draws instead of scrolling the page.

import { addPoint, clear, createDrawing, createStroke, serialize, undo } from "./drawing.js";

/** Sizes a canvas's backing store to its CSS size × devicePixelRatio. Returns the CSS size. */
export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { width: rect.width, height: rect.height, dpr };
}

/** Draws strokes onto a 2D context sized `width` × `height` (in the context's units). */
export function renderDrawing(ctx, drawing, { width, height, color = "#ffd400", strokeStyle = null } = {}) {
  const strokes = [...drawing.strokes].sort((a, b) => a.layer - b.layer);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    const pts = stroke.points;
    if (!pts.length) continue;
    ctx.strokeStyle = strokeStyle ? strokeStyle(stroke) : color;
    ctx.lineWidth = Math.max(1, stroke.width * width);
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * width, pts[0][1] * height);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * width, pts[i][1] * height);
    if (pts.length === 1) ctx.lineTo(pts[0][0] * width + 0.1, pts[0][1] * height);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Captures strokes on `canvas`. `decorate(ctx, width, height, drawing)` draws on top after the strokes
 * (a game's preview of what the drawing will do). `maxStrokes` keeps only the newest strokes.
 */
export function createDrawingPad(canvas, { playerId = null, tool = "pen", width = 0.01, layer = 0, maxStrokes = 8, color, onChange, decorate } = {}) {
  const drawing = createDrawing(playerId, 1, 1);
  const started = performance.now();
  let active = null;
  let pointerId = null;
  let current = { tool, width, layer };

  const toNormal = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  };

  const redraw = () => {
    const { width: w, height: h, dpr } = fitCanvas(canvas);
    drawing.canvasWidth = Math.round(w);
    drawing.canvasHeight = Math.round(h);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    renderDrawing(ctx, drawing, { width: w, height: h, color });
    decorate?.(ctx, w, h, drawing);
  };

  const changed = () => {
    redraw();
    onChange?.(drawing, active);
  };

  const down = (e) => {
    if (pointerId !== null) return;
    e.preventDefault();
    pointerId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable (e.g. a synthetic pointer): drawing still works while it stays on the canvas.
    }
    active = createStroke({ ...current, timestamp: Math.round(performance.now() - started) });
    drawing.strokes.push(active);
    while (drawing.strokes.length > maxStrokes) drawing.strokes.shift();
    const [x, y] = toNormal(e);
    addPoint(active, x, y);
    changed();
  };
  const move = (e) => {
    if (e.pointerId !== pointerId || !active) return;
    e.preventDefault();
    const [x, y] = toNormal(e);
    if (addPoint(active, x, y)) changed();
  };
  const up = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    active = null;
    changed();
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  return {
    drawing,
    setTool(next) {
      current = { ...current, ...next };
    },
    undo() {
      undo(drawing);
      changed();
    },
    clear() {
      clear(drawing);
      changed();
    },
    redraw,
    serialize: () => serialize(drawing),
    destroy() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
}
