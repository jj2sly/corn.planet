// Angry Thud's Revenge on the screens: the snapshot smoothing, the tutorial's content and the art.
// Browser code, run here without a browser (drawing goes to a stand-in context that records calls).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drawBird } from "../public/js/cpi/bird.js";
import { drawBlock, drawBuilding, drawPig, drawRedCow, drawSling, MATERIAL_COLORS, paintBackdrop, PIG_LOOK } from "../public/js/games/thud-art.js";
import { BIRDS, lookFor, SKINS } from "../public/js/games/thud-birds.js";
import { abilityHow, tutorialCards } from "../public/js/games/thud-howto.js";
import { createSnapshotBuffer, type Row } from "../public/js/games/thud-interp.js";
import { BUILDINGS, TIMING, WORLD } from "../server/games/thud/config.ts";
import { LEVELS } from "../server/games/thud/levels.ts";

const TICK = 50;
const bird = (x: number, y: number, angle = 0): Row => ["b1", "B", "popcorn:classic", x, y, Math.round(angle * 1000), 16, 16, 0, 0, 0];

describe("Angry Thud's Revenge: smoothing between physics snapshots", () => {
  it("draws a steady moment in the past, between the snapshots either side of it", () => {
    const buf = createSnapshotBuffer({ delayMs: 100 });
    // Ticks 1-4 arrive on time, 50 ms apart, the bird moving 10 units a tick.
    for (let tick = 1; tick <= 4; tick++) buf.push(tick, TICK, [bird(tick * 10, 0)], 1000 + tick * TICK);
    // At local 1200 the newest (tick 4, server 200) just arrived; 100 ms back is server 100: tick 2.
    const at = (now: number) => buf.sample(now)[0]!.x;
    assert.equal(at(1200), 20);
    // Halfway between tick 2 and 3, and moving smoothly frame to frame, never backwards.
    assert.ok(Math.abs(at(1225) - 25) < 0.01);
    let last = -Infinity;
    for (let now = 1200; now <= 1250; now += 4) {
      const x = at(now);
      assert.ok(x >= last, `x never goes back (${x} after ${last})`);
      last = x;
    }
    assert.ok(Math.abs(buf.sample(1225)[0]!.vx - 200) < 0.01, "10 units a 50 ms tick is 200 a second");
  });

  it("rides out a late packet instead of freezing then jumping", () => {
    const buf = createSnapshotBuffer({ delayMs: 100 });
    for (let tick = 1; tick <= 4; tick++) buf.push(tick, TICK, [bird(tick * 10, 0)], 1000 + tick * TICK);
    // Tick 5 is 40 ms late. The drawing keeps moving through what it already has.
    const before = buf.sample(1260)[0]!.x;
    buf.push(5, TICK, [bird(50, 0)], 1290);
    const after = buf.sample(1260)[0]!.x;
    assert.ok(Math.abs(after - before) < 1.5, "a late packet barely nudges what's on screen");
  });

  it("follows a curve through a bounce, and turns the short way round", () => {
    const buf = createSnapshotBuffer({ delayMs: 0 });
    const path: [number, number][] = [[0, 0], [10, 10], [20, 14], [30, 10], [40, 0]];
    // Every snapshot arrives exactly on time: local = server + 1000. The angle crosses ±π at tick 3.
    path.forEach(([x, y], i) => buf.push(i + 1, TICK, [bird(x, y, i === 1 ? 3.1 : i === 2 ? -3.1 : 0)], 1000 + (i + 1) * TICK));
    // Between ticks 2 and 3 (server 100-150) the curve bulges above the straight line.
    const mid = buf.sample(1000 + 125)[0]!;
    assert.ok(mid.y > 12, `curved (${mid.y}), not the straight 12`);
    assert.ok(Math.abs(mid.a) > 3.1, `the angle went the short way through ±π (${mid.a})`);
    assert.equal(buf.size, 5);
  });

  it("keeps the same tick as one moment, resyncs after a pause, and starts over for a new game", () => {
    const buf = createSnapshotBuffer({ delayMs: 100 });
    buf.push(10, TICK, [bird(0, 0)], 1000);
    // A building goes up between shots: same tick, new rows, no new moment.
    buf.push(10, TICK, [bird(0, 0), ["h1", "h", "wall:1", 600, 860, 0, 20, 40, 0, 2, 0]], 1500);
    assert.equal(buf.size, 1);
    assert.equal(buf.sample(1600).length, 2);
    // The next shot starts 20 s later: the clock catches up rather than replaying 20 s of nothing.
    buf.push(11, TICK, [bird(10, 0)], 21_000);
    buf.push(12, TICK, [bird(20, 0)], 21_050);
    assert.ok(Math.abs(buf.sample(21_100)[0]!.x - 10) < 0.01);
    // A new game's ticks start low again.
    buf.push(1, TICK, [bird(999, 0)], 30_000);
    assert.equal(buf.size, 1);
    assert.equal(buf.sample(30_500)[0]!.x, 999);
  });

  it("holds a body that's gone until the drawing reaches the moment it went, with its effects", () => {
    const buf = createSnapshotBuffer({ delayMs: 100 });
    buf.push(1, TICK, [bird(0, 0), ["p1", "p", "basic", 500, 800, 0, 20, 20, 0, 0, -1]], 1050);
    buf.hold([{ t: "launch" }], 1050);
    buf.push(2, TICK, [bird(10, 0)], 1100);
    buf.hold([{ t: "pop" }], 1100);
    // At 1100 the drawing is at server 0: before tick 1. Nothing's due, the piggy is there.
    assert.deepEqual(buf.due(1100), []);
    // Server 75: between the ticks. The launch is due; the piggy is still drawn, on its way out.
    assert.deepEqual(buf.due(1175).map((d) => (d.item as { t: string }).t), ["launch"]);
    assert.equal(buf.sample(1175).find((s) => s.row[0] === "p1")?.leaving, true);
    // Server 100: tick 2. The pop is due (it waited the 100 ms delay) and the piggy is gone.
    assert.deepEqual(buf.due(1200), [{ item: { t: "pop" }, waitedMs: 100 }]);
    assert.equal(buf.sample(1200).find((s) => s.row[0] === "p1"), undefined);
  });
});

describe("Angry Thud's Revenge: the first-time tutorial", () => {
  it("teaches the essentials in six short cards, from the game's own numbers", () => {
    const cards = tutorialCards({ buildMs: TIMING.buildMs, bird: "popcorn" });
    assert.deepEqual(
      cards.map((c) => c.id),
      ["build", "aim", "ability", "goal", "weather", "team"],
    );
    const all = cards.flatMap((c) => c.lines).join(" ");
    assert.match(all, new RegExp(`${TIMING.buildMs / 1000} seconds`), "the build phase's real length");
    assert.match(all, /vote/i);
    assert.match(all, /one bird per turn/i);
    assert.match(all, /Corruption Meter/);
    assert.match(all, /0%/);
    assert.match(all, /Red Cow/);
    assert.match(all, /Weather Machine/);
    assert.match(all, /donate/i);
    for (const c of cards) {
      assert.ok(c.lines.length <= 3, `${c.id}: three lines at most`);
      for (const line of c.lines) assert.ok(line.length <= 130, `${c.id}: short lines ("${line}")`);
    }
    // A different build length shows up as itself.
    assert.match(tutorialCards({ buildMs: 90_000 })[0]!.lines.join(" "), /90 seconds/);
  });

  it("explains how the player's own bird's ability is set off", () => {
    for (const bird of BIRDS) {
      const card = tutorialCards({ bird: bird.id }).find((c) => c.id === "ability")!;
      assert.ok(card.lines.some((l) => l.includes(bird.name)), `${bird.id} is named`);
      const how = abilityHow(bird);
      assert.ok(card.lines.includes(how));
      if (bird.ability.trigger === "tap") assert.match(how, /tap/i);
      if (bird.ability.trigger === "hold") assert.match(how, /hold/i);
      if (bird.ability.trigger === "launch") assert.match(how, /nothing to press/i);
    }
    assert.match(tutorialCards({ bird: null }).find((c) => c.id === "ability")!.lines.join(" "), /Pick a bird/);
  });
});

/** A stand-in 2D context: every drawing call is recorded, nothing is drawn. */
function fakeContext() {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, globalCompositeOperation: "source-over" };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
      if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
      return () => void calls.push(key);
    },
    set(target, key, value) {
      if (typeof key === "string") target[key] = value;
      return true;
    },
  });
  return { ctx, calls };
}

describe("Angry Thud's Revenge: the art", () => {
  it("draws every material at every stage of damage, and every building", () => {
    const { ctx, calls } = fakeContext();
    for (const m of [...Object.keys(MATERIAL_COLORS), "mystery"]) {
      for (let crack = 0; crack <= 4; crack++) for (const reinforced of [false, true]) drawBlock(ctx, m, 40, 10, { crack, reinforced, seed: crack % 4 });
      drawBlock(ctx, m, 8, 60, { crack: 2 });
    }
    for (const type of Object.keys(BUILDINGS)) for (const tier of [1, 2, 3, 4]) drawBuilding(ctx, type, tier, 24, 40, { t: 1, crack: 2, broken: tier === 2, disabled: tier === 3, waterlogged: tier === 4, progress: 0.7 });
    assert.ok(calls.includes("fill") && calls.includes("stroke"));
    // Cracks are drawn inside the block (clipped), never over its neighbours.
    const clips = calls.filter((c) => c === "clip").length;
    assert.ok(clips > 0);
  });

  it("draws every piggy, bird and skin, the slingshot and the Red Cow", () => {
    const { ctx, calls } = fakeContext();
    for (const kind of Object.keys(PIG_LOOK)) for (const state of ["idle", "smug", "build"]) drawPig(ctx, kind, { x: 0, y: 0, r: 20, t: 1.5, crack: 3, hurt: 0.6, state });
    for (const bird of BIRDS) for (const skin of SKINS) for (const state of ["idle", "fly", "hit", "sling", "cheer", "sad"]) drawBird(ctx, lookFor(bird.id, skin.id), { r: 16, state, t: 2, facing: state === "sad" ? -1 : 1 });
    drawSling(ctx, 470, 740, { pouch: [440, 760], back: true, power: 0.9 });
    drawSling(ctx, 470, 740, { pouch: null, back: false, twang: 0.5, t: 1 });
    for (const p of [0, 0.4, 1]) drawRedCow(ctx, 2100, 900, p, { t: 3, workers: 3 });
    assert.ok(calls.length > 1000);
  });

  it("paints every level's scenery without touching its collision data", () => {
    const before = JSON.stringify(LEVELS);
    for (const level of LEVELS) {
      const { ctx, calls } = fakeContext();
      paintBackdrop(ctx, { ...level, width: WORLD.width, groundY: WORLD.groundY }, { top: -420 });
      assert.ok(calls.length > 200, `${level.id} has scenery`);
    }
    assert.equal(JSON.stringify(LEVELS), before);
  });
});
