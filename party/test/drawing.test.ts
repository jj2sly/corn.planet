import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addPoint, clear, createDrawing, createStroke, deserialize, DrawingError, interpret, pointCount, serialize, strokeBounds, undo } from "../public/js/drawing.js";
import { plankFromStroke, strokeAhead } from "../public/js/games/steamdeck-rules.js";

function sample() {
  const d = createDrawing("p1", 390, 219);
  const a = createStroke({ tool: "plank", width: 0.012, layer: 1, timestamp: 40 });
  for (const [x, y] of [[0.1, 0.5], [0.2, 0.52], [0.35, 0.49], [0.5, 0.5]]) addPoint(a, x!, y!);
  const b = createStroke({ tool: "pen", width: 0.02 });
  addPoint(b, 0.9, 0.1);
  d.strokes.push(a, b);
  return d;
}

describe("CPI Drawing System", () => {
  it("round-trips through its compact wire form, in normalized coordinates", () => {
    const d = sample();
    const wire = serialize(d);
    assert.deepEqual(Object.keys(wire).sort(), ["h", "s", "v", "w"]);
    assert.ok(wire.s[0]![4].every((n) => Number.isInteger(n) && n >= 0 && n <= 10000), "points are small integers");
    const back = deserialize(JSON.parse(JSON.stringify(wire)), { playerId: "server-says" });
    assert.equal(back.playerId, "server-says", "the caller decides whose drawing it is");
    assert.deepEqual([back.canvasWidth, back.canvasHeight], [390, 219]);
    assert.deepEqual(
      back.strokes.map((s) => ({ ...s })),
      d.strokes.map((s) => ({ ...s })),
    );
  });

  it("keeps strokes small: close points are skipped, points are clamped and capped", () => {
    const s = createStroke();
    assert.equal(addPoint(s, 0.5, 0.5), true);
    assert.equal(addPoint(s, 0.501, 0.5), false, "too close to the last point");
    addPoint(s, 1.7, -3);
    assert.deepEqual(s.points.at(-1), [1, 0]);
    const capped = createStroke();
    for (let i = 0; i < 50; i++) addPoint(capped, i / 50, 0.5, { maxPoints: 10 });
    assert.equal(capped.points.length, 10);
  });

  it("supports undo and clear", () => {
    const d = sample();
    assert.equal(undo(d)?.tool, "pen");
    assert.equal(d.strokes.length, 1);
    clear(d);
    assert.equal(pointCount(d), 0);
    assert.equal(undo(d), null);
  });

  it("refuses anything malformed or over the limits", () => {
    const good = serialize(sample());
    const bad = (mutate: (w: any) => void, limits = {}) => {
      const w = JSON.parse(JSON.stringify(good));
      mutate(w);
      assert.throws(() => deserialize(w, { limits }), DrawingError);
    };
    assert.throws(() => deserialize("nope"), DrawingError);
    bad((w) => (w.v = 2));
    bad((w) => (w.w = -1));
    bad((w) => (w.s = "x"));
    bad((w) => (w.s[0][0] = "<script>"));
    bad((w) => (w.s[0][4] = [1, 2, 3]), {});
    bad((w) => (w.s[0][4][0] = 10001));
    bad((w) => (w.s[0][4][1] = 0.5));
    bad((w) => (w.s[0][4][1] = null));
    bad((w) => (w.s[0][1] = 5000));
    bad((w) => (w.s[0][2] = 99));
    bad(() => {}, { tools: ["eraser"] });
    bad(() => {}, { maxStrokes: 1 });
    bad(() => {}, { maxPoints: 3 });
  });

  it("hands each stroke to the rule for its tool; unknown tools make nothing", () => {
    const d = sample();
    const made = interpret(d, { plank: (s) => ({ bounds: strokeBounds(s) }) }, null);
    assert.equal(made.length, 1);
    assert.deepEqual(made[0]!.bounds, { minX: 0.1, minY: 0.49, maxX: 0.5, maxY: 0.52 });
  });
});

describe("Steam My Deck: plank rule", () => {
  const world = { width: 1600, height: 900, minLength: 80, maxLength: 320 };
  it("reads a sideways stroke as a flat plank at its average height, clamped in length", () => {
    const s = createStroke({ tool: "plank" });
    for (const [x, y] of [[0.3, 0.5], [0.35, 0.52], [0.4, 0.48]]) addPoint(s, x!, y!);
    assert.deepEqual(plankFromStroke(s, world), { x1: 480, x2: 640, y: 450 });
    const long = createStroke({ tool: "plank" });
    addPoint(long, 0, 0.5);
    addPoint(long, 1, 0.5);
    const p = plankFromStroke(long, world)!;
    assert.equal(p.x2 - p.x1, 320, "capped");
  });

  it("gives keyboard players an ordinary stroke just ahead of them, which becomes the same kind of plank", () => {
    const runner = { x: 400, y: 700, facing: 1, width: 28, height: 36 };
    const ahead = plankFromStroke(strokeAhead(runner, world), world)!;
    assert.deepEqual(ahead, { x1: 438, x2: 638, y: 736 }, "to the right, at the feet");
    const behind = plankFromStroke(strokeAhead({ ...runner, facing: -1 }, world), world)!;
    assert.ok(behind.x2 <= runner.x, "to the left when facing left");
    const nudged = plankFromStroke(strokeAhead(runner, world, [40, -60]), world)!;
    assert.deepEqual([nudged.x1 - ahead.x1, nudged.y - ahead.y], [40, -60]);
    // It survives the wire like a drawn stroke.
    const d = createDrawing("p1", 390, 219);
    d.strokes.push(strokeAhead(runner, world));
    const back = deserialize(serialize(d), { limits: { tools: ["plank"] } });
    assert.deepEqual(plankFromStroke(back.strokes[0]!, world), ahead);
  });

  it("refuses a stroke that isn't sideways enough to be a plank", () => {
    const s = createStroke({ tool: "plank" });
    addPoint(s, 0.5, 0.1);
    addPoint(s, 0.51, 0.9);
    assert.equal(plankFromStroke(s, world), null);
  });
});
