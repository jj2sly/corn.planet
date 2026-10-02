// Cornlashing's cob scoreboard, the parts that run without a screen: lane order, proportions and
// gains for every room size, ties and the TOP COB marker, the 3D layout (where each lane sits on the
// cylinder) and the reveal's timeline, including the settled state used for reduced motion.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COB_BURST,
  COB_COLUMNS,
  cobGeometry,
  cobKernelSlot,
  cobLeaders,
  cobOutline,
  cobPopDelays,
  cobPopSpan,
  cobRail,
  cobRowsPerLane,
  cobShading,
  cobStandings,
  cobTaper,
  cobTimeline,
} from "../public/js/games/chaos-cob.js";

const NAMES = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo", "Gus", "Hal"];
const room = (scores: number[]) => scores.map((score, i) => ({ id: NAMES[i]!.toLowerCase(), name: NAMES[i]!, score, connected: true }));
const began = (players: ReturnType<typeof room>, gains: number[]) => new Map(players.map((p, i) => [p.id, p.score - (gains[i] ?? 0)]));

describe("cob lanes for every room size", () => {
  for (let n = 2; n <= 8; n++) {
    it(`${n} agents: ranked lanes, proportional kernels, exact numbers`, () => {
      const scores = Array.from({ length: n }, (_, i) => 1000 - i * 90 - (i % 3) * 7);
      const players = room([...scores].reverse()); // room order is the opposite of the ranking
      const gains = players.map((_, i) => 40 + i * 15);
      const cob = cobStandings(players, began(players, gains), { kernels: COB_COLUMNS * cobRowsPerLane(n) });
      const perLane = COB_COLUMNS * cobRowsPerLane(n);

      assert.equal(cob.rows.length, n, "one lane per agent");
      assert.deepEqual(cob.rows.map((r) => r.score), [...scores], "ranked best first");
      assert.deepEqual(cob.rows.map((r) => r.placement), cob.rows.map((_, i) => i + 1));
      assert.equal(cob.rows[0]!.kernelsAfter, perLane, "the leader's lane is full");
      for (const r of cob.rows) {
        assert.equal(r.kernelsAfter, Math.max(1, Math.round((r.score / scores[0]!) * perLane)), `${r.name}: kernels follow the score`);
        assert.ok(r.kernelsBefore <= r.kernelsAfter, "a lane never shrinks");
        // The number on the board is the score itself, the gain the difference: never the kernel count.
        assert.equal(r.gain, r.score - r.previous);
        assert.equal(r.gain, gains[players.findIndex((p) => p.id === r.id)]);
      }
      const geometry = cobGeometry(n);
      assert.equal(geometry.slots.length, n, "a place on the cob for every lane");
    });
  }

  it("orders lanes by score, keeping room order among equals", () => {
    const cob = cobStandings(room([300, 900, 300, 600]), null);
    assert.deepEqual(cob.rows.map((r) => r.name), ["Bo", "Di", "Ann", "Cy"]);
  });

  it("reports climbs and falls for the ▲/▼ markers", () => {
    const players = room([500, 800, 200]);
    const cob = cobStandings(players, new Map([["ann", 500], ["bo", 100], ["cy", 200]]));
    const byName = new Map(cob.rows.map((r) => [r.name, r]));
    assert.equal(byName.get("Bo")!.move, 2, "Bo climbed from third to first");
    assert.equal(byName.get("Ann")!.move, -1);
    assert.equal(byName.get("Cy")!.move, -1);
    assert.deepEqual([...cob.rows].map((r) => r.move > 0 ? "up" : r.move < 0 ? "down" : "-"), ["up", "down", "down"]);
  });
});

describe("TOP COB marker", () => {
  it("goes to the one agent in front", () => {
    const cob = cobStandings(room([100, 700, 400]), null);
    assert.deepEqual(cobLeaders(cob.rows).map((r) => r.name), ["Bo"]);
  });

  it("is shared by a tie for first", () => {
    const cob = cobStandings(room([700, 300, 700]), null);
    assert.deepEqual(cobLeaders(cob.rows).map((r) => r.name), ["Ann", "Cy"]);
  });

  it("is not awarded for zero points", () => {
    assert.deepEqual(cobLeaders(cobStandings(room([0, 0, 0]), null).rows), []);
    assert.deepEqual(cobLeaders(cobStandings(room([0, 50]), null).rows).map((r) => r.name), ["Bo"]);
  });
});

describe("cob layout", () => {
  for (let n = 1; n <= 8; n++) {
    it(`${n} lanes sit in order down the curve, none squeezed out`, () => {
      const g = cobGeometry(n);
      assert.equal(g.rows, n * cobRowsPerLane(n));
      const ys = g.slots.map((s) => s.y);
      assert.deepEqual([...ys].sort((a, b) => a - b), ys, "rank 1 is the top lane");
      assert.ok(ys.every((y) => y > 0 && y < 1));
      const angles = g.slots.map((s) => s.angle);
      assert.ok(angles.every((a, i) => i === 0 || a < angles[i - 1]!), "angles go from the top round to the bottom");
      assert.ok(g.slots.every((s) => s.height > 0));
      // The outer lanes are foreshortened by the curve, but stay at least about 40% of the tallest.
      const tallest = Math.max(...g.slots.map((s) => s.height));
      if (n > 2) assert.ok(Math.min(...g.slots.map((s) => s.height)) > tallest * 0.4, "outer lanes stay readable");
      // Rows of one lane are stacked inside the lane's own span of the curve.
      for (let slot = 0; slot < n; slot++) {
        const rows = Array.from({ length: g.bands }, (_, band) => g.rowAngle(slot, band));
        assert.ok(rows.every((a, i) => i === 0 || a < rows[i - 1]!));
        assert.ok(rows[0]! <= g.seam(slot) && rows.at(-1)! >= (slot + 1 < n ? g.seam(slot + 1) : g.bottom));
      }
    });
  }

  it("gives small rooms thick bands so there are no empty stretches of cob", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 8].map((n) => cobGeometry(n).bands), [5, 3, 2, 2, 1, 1]);
    assert.ok([1, 2, 3, 4, 5, 6, 7, 8].every((n) => cobGeometry(n).rows >= 5), "always a handful of rows round the cob");
  });

  it("keeps the stage a sensible shape at every room size", () => {
    for (let n = 1; n <= 8; n++) {
      const g = cobGeometry(n);
      assert.ok(g.aspect > 0.25 && g.aspect < 0.6, `${n}: aspect ${g.aspect}`);
      assert.ok(g.slots.every((s) => s.ends[0] > 0.04 && s.ends[1] < 0.96 && s.ends[0] < s.ends[1]));
      // Lanes nearer the edge of the curve are further from the viewer, so their ends pull in.
      const mid = g.slots[Math.floor((n - 1) / 2)]!;
      assert.ok(g.slots.every((s) => s.ends[0] >= mid.ends[0] - 1e-9));
    }
  });

  it("tapers the cob toward both ends and outlines it within the stage", () => {
    assert.equal(cobTaper(0.5), 1);
    assert.ok(cobTaper(0) < 1 && cobTaper(0) === cobTaper(1));
    assert.ok(cobTaper(-0.04) < cobTaper(0), "the caps keep narrowing");
    const g = cobGeometry(6);
    const o = cobOutline(g);
    const [w, h] = o.viewBox;
    assert.ok(o.left > 0 && o.right < w && o.top >= 0 && o.bottom < h, "the body fits inside the stage, with room for the husk and the shadow");
    const rail = cobRail(g, 40);
    const ys = rail.map(([, y]) => y);
    assert.ok(ys[0]! > ys[8]! && ys[16]! > ys[8]!, "a seam on the upper curve is highest at the belly and drops toward the ends");
    assert.ok(Math.abs(ys[0]! - ys[16]!) < 1e-6, "and is the same at both ends");
  });

  it("lights it from the upper left: bright toward the top, dark at the bottom and the rim", () => {
    const stops = cobShading(cobGeometry(6));
    assert.equal(stops[0]!.at, 0);
    assert.equal(stops.at(-1)!.at, 1);
    assert.ok(stops.every((s, i) => i === 0 || s.at > stops[i - 1]!.at), "stops run top to bottom");
    const brightest = stops.reduce((best, s, i) => (s.light > stops[best]!.light ? i : best), 0);
    const darkest = stops.reduce((worst, s, i) => (s.dark > stops[worst]!.dark ? i : worst), 0);
    assert.ok(brightest > 0 && brightest < stops.length / 2, "the lit band is in the upper half");
    assert.equal(darkest, stops.length - 1, "the underside is darkest");
  });

  it("fills a lane column by column, the bands side by side, alternate rows staggered", () => {
    const slots = [0, 1, 2, 3, 4, 5].map((k) => cobKernelSlot(k, 3));
    assert.deepEqual(slots.map((s) => [s.band, s.column]), [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]);
    assert.ok(slots[1]!.u > slots[0]!.u, "the middle band is offset half a kernel");
    assert.equal(slots[2]!.u, slots[0]!.u);
    assert.ok(cobKernelSlot(COB_COLUMNS * 3 - 1, 3).u < 1);
  });
});

describe("cob reveal timeline", () => {
  const rows = (n: number) => cobStandings(room(Array.from({ length: n }, (_, i) => 100 + i * 80)), new Map()).rows;

  it("pops kernels in short bursts, not one long cascade", () => {
    const delays = cobPopDelays(24);
    assert.equal(delays[0], 0);
    assert.ok(delays.every((d, i) => i === 0 || d > delays[i - 1]!), "each kernel a little after the last");
    assert.equal(delays[COB_BURST], delays[COB_BURST - 1]! + 95 - 22 * (COB_BURST - 1), "a new burst starts on the beat");
    assert.ok(cobPopSpan(24) < 1000, "a full lane pops in under a second");
    assert.equal(cobPopSpan(0), 0);
  });

  it("plays in order and fits the standings window, for every room size", () => {
    for (let n = 2; n <= 8; n++) {
      const cob = cobStandings(room(Array.from({ length: n }, (_, i) => 1000 - i * 100)), new Map(room(Array.from({ length: n }, () => 0)).map((p) => [p.id, 0])));
      const t = cobTimeline({ lanes: n, rows: cob.rows, moved: true, live: true });
      assert.ok(t.activate < t.popAt && t.popAt < t.settleAt && t.settleAt < t.crownAt, `${n}: lanes, pops, reorder, crown`);
      assert.ok(t.total <= 4500, `${n}: done well inside the 6 s standings window (${t.total} ms)`);
      assert.ok(t.cues.length >= 1 && t.cues.length <= 4, "a few grouped pop cues");
      assert.ok(t.cues.every((c) => c >= t.popAt && c <= t.popAt + t.popSpan));
    }
  });

  it("is already settled with reduced motion or nothing to reveal", () => {
    const t = cobTimeline({ lanes: 6, rows: rows(6), moved: true, live: false });
    assert.equal(t.live, false);
    assert.deepEqual([t.roll, t.popAt, t.settleAt, t.crownAt, t.total], [0, 0, 0, 0, 0], "nothing is scheduled");
    assert.deepEqual(t.cues, []);
  });

  it("holds the crown a beat after the lanes settle, longer when they had to move", () => {
    const still = cobTimeline({ lanes: 4, rows: rows(4), moved: false, live: true });
    const moved = cobTimeline({ lanes: 4, rows: rows(4), moved: true, live: true });
    assert.ok(moved.crownAt - moved.settleAt > still.crownAt - still.settleAt);
  });
});
