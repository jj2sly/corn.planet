// CPI Drawing System, browser side: capture freehand strokes on a canvas (touch, pen or mouse) and
// render drawings. The data model is drawing.js; this file only turns pointer input into strokes and
// strokes into pixels.
//
//   const pad = createDrawingPad(canvas, { tool: "plank", width: 0.012, onChange: (drawing, active) => … });
//   pad.undo(); pad.clear(); pad.serialize(); pad.destroy();
//   renderDrawing(ctx2d, drawing, { width, height });
//
// Feedback is built in and purely visual: strokes are drawn smoothed (the stored points never
// change), a ring follows the finger while drawing, and an undone stroke fades out instead of
// vanishing.
//
// The canvas needs `touch-action: none` so a finger draws instead of scrolling the page.

import { addPoint, clear, createDrawing, createStroke, serialize, undo } from "./drawing.js";

/** Sizes a canvas's backing store to its CSS size × devicePixelRatio (at most `maxDpr`). Returns the CSS size. */
export function fitCanvas(canvas, maxDpr = 3) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(maxDpr, globalThis.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { width: rect.width, height: rect.height, dpr };
}

/** Traces a stroke's path, through the midpoints of its points so it reads as one smooth line. */
function tracePath(ctx, pts, width, height, smooth) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * width, pts[0][1] * height);
  if (pts.length === 1) return ctx.lineTo(pts[0][0] * width + 0.1, pts[0][1] * height);
  if (!smooth || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * width, pts[i][1] * height);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    ctx.quadraticCurveTo(x * width, y * height, ((x + nx) / 2) * width, ((y + ny) / 2) * height);
  }
  const last = pts.at(-1);
  ctx.lineTo(last[0] * width, last[1] * height);
}

/**
 * Draws strokes onto a 2D context sized `width` × `height` (in the context's units). `glow` adds a
 * soft halo so a line reads over a busy picture; `smooth` (default) curves through the points.
 */
export function renderDrawing(ctx, drawing, { width, height, color = "#ffd400", strokeStyle = null, glow = null, smooth = true, alpha = 1 } = {}) {
  const strokes = [...drawing.strokes].sort((a, b) => a.layer - b.layer);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    const pts = stroke.points;
    if (!pts.length) continue;
    const lineWidth = Math.max(1, stroke.width * width);
    if (glow) {
      ctx.strokeStyle = glow;
      ctx.lineWidth = lineWidth + 6;
      tracePath(ctx, pts, width, height, smooth);
      ctx.stroke();
    }
    ctx.strokeStyle = strokeStyle ? strokeStyle(stroke) : color;
    ctx.lineWidth = lineWidth;
    tracePath(ctx, pts, width, height, smooth);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Captures strokes on `canvas`. `decorate(ctx, width, height, drawing, info)` draws on top after the
 * strokes (a game's preview of what the drawing will do); info is { pointer: {x, y} | null, drawing:
 * whether a finger is down, time }. `maxStrokes` keeps only the newest strokes. `glow` haloes the ink;
 * `onUndo(stroke)` hears about undos. `animate` keeps redrawing every frame (for a moving preview).
 */
export function createDrawingPad(canvas, { playerId = null, tool = "pen", width = 0.01, layer = 0, maxStrokes = 8, color, glow = null, onChange, onUndo, decorate, animate = false } = {}) {
  const drawing = createDrawing(playerId, 1, 1);
  const started = performance.now();
  let active = null;
  let pointerId = null;
  let current = { tool, width, layer };
  let pointer = null; // { x, y } in CSS px while drawing, for the touch ring
  let fading = null; // { stroke, at }: an undone stroke fading out
  let raf = 0;
  let destroyed = false;

  const toNormal = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  };

  const redraw = () => {
    const { width: w, height: h, dpr } = fitCanvas(canvas);
    // Never 0 (a canvas that hasn't been laid out yet): the size is metadata, the points are normalized.
    drawing.canvasWidth = Math.max(1, Math.round(w));
    drawing.canvasHeight = Math.max(1, Math.round(h));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const now = performance.now();
    if (fading) {
      const k = (now - fading.at) / 260;
      if (k >= 1) fading = null;
      else renderDrawing(ctx, { strokes: [fading.stroke] }, { width: w, height: h, color: "#ff6b5e", alpha: 1 - k });
    }
    renderDrawing(ctx, drawing, { width: w, height: h, color, glow });
    decorate?.(ctx, w, h, drawing, { pointer, drawing: pointerId !== null, time: now / 1000 });
    if (pointer && pointerId !== null) {
      // The touch ring: where the ink is going, even under a fingertip.
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  // Redraws every frame only while something is moving (a fade, or an animated preview).
  const loop = () => {
    raf = 0;
    if (destroyed || !canvas.isConnected) return;
    redraw();
    if (animate || fading) raf = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (!raf && !destroyed) raf = requestAnimationFrame(loop);
  };
  if (animate) kick();

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
    pointer = at(e);
    addPoint(active, x, y);
    changed();
  };
  const at = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const move = (e) => {
    if (e.pointerId !== pointerId || !active) return;
    e.preventDefault();
    const [x, y] = toNormal(e);
    pointer = at(e);
    if (addPoint(active, x, y)) changed();
    else redraw();
  };
  const up = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    active = null;
    pointer = null;
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
      const removed = undo(drawing);
      if (removed) {
        fading = { stroke: removed, at: performance.now() };
        onUndo?.(removed);
        kick();
      }
      changed();
    },
    clear() {
      clear(drawing);
      changed();
    },
    redraw,
    serialize: () => serialize(drawing),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    },
  };
}
