// Angry Thud's Revenge: smooth motion between the server's physics snapshots. Screens only.
//
// The server steps the physics at a fixed rate (TIMING.tickMs, 120 Hz substeps inside) and sends
// every body once per tick, stamped with the tick number. Drawing those as they arrive stutters:
// packets bunch up and spread out, and 20 updates a second is well under a screen's 60+. So a
// screen keeps the last few snapshots on the *server's* clock (tick × tickMs) and draws a moment a
// little in the past (`delayMs`), between the two snapshots either side of it: a curve through
// four snapshots where it has them, a straight line where it doesn't. Nothing is predicted and
// nothing is decided here; the drawing just runs a tenth of a second behind the physics.
//
// Effects (a block breaking, a piggy popping) come with the snapshot they happened in and are
// held until the drawing reaches that snapshot, so the pop lands when the piggy visibly goes.

/** Late snapshots nudge the clock this much per snapshot (early ones reset it at once). */
const DRIFT = 0.06;
/** Arriving this much later than expected means the simulation paused (between shots): resync. */
const RESYNC_MS = 250;

function catmull(p0, p1, p2, p3, k) {
  const k2 = k * k;
  const k3 = k2 * k;
  return 0.5 * (2 * p1 + (-p0 + p2) * k + (2 * p0 - 5 * p1 + 4 * p2 - p3) * k2 + (-p0 + 3 * p1 - 3 * p2 + p3) * k3);
}

function turn(from, to) {
  let d = to - from;
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * A buffer of body snapshots. Rows are the server's world rows ([id, kind, sub, x, y, angle×1000,
 * …]); `push` them with their tick, then `sample(now)` for where to draw everything right now.
 */
export function createSnapshotBuffer({ delayMs = 100, max = 10 } = {}) {
  /** { tick, time, rows: Map<id, row> }, oldest first. */
  let snaps = [];
  /** Local ms minus server ms, as best we know it (the fastest delivery seen, drifting). */
  let offset = null;
  let pending = [];

  const reset = () => {
    snaps = [];
    offset = null;
    pending = [];
  };

  /**
   * A state arrived at local time `now`. The same tick again (someone aimed, a building went up
   * between shots) replaces that snapshot's rows rather than adding a moment.
   */
  function push(tick, tickMs, rows, now) {
    const time = tick * tickMs;
    const last = snaps[snaps.length - 1];
    if (last && tick < last.tick) reset();
    const map = new Map(rows.map((r) => [r[0], r]));
    const newest = snaps[snaps.length - 1];
    if (newest && newest.tick === tick) {
      newest.rows = map;
      return;
    }
    snaps.push({ tick, time, rows: map });
    if (snaps.length > max) snaps.shift();
    const seen = now - time;
    if (offset === null || seen < offset || seen - offset > RESYNC_MS) offset = seen;
    else offset += (seen - offset) * DRIFT;
  }

  /** The server time being drawn at local time `now`. */
  function renderTime(now) {
    if (offset === null) return Infinity;
    return now - offset - delayMs;
  }

  /** The newest snapshot's server time (what effects arriving now belong to). */
  const latestTime = () => snaps[snaps.length - 1]?.time ?? 0;

  /**
   * Everything to draw at `now`: [{ row, x, y, a, vx, vy, leaving }]. vx / vy are world units a
   * second. `leaving`: the body is gone by the next snapshot (drawn until then).
   */
  function sample(now) {
    const n = snaps.length;
    if (!n) return [];
    const t = renderTime(now);
    let i = n - 1;
    while (i > 0 && snaps[i].time > t) i -= 1;
    // Past the newest: hold it. Before the oldest: show the oldest.
    if (i === n - 1 || t <= snaps[0].time) {
      const s = t <= snaps[0].time ? snaps[0] : snaps[n - 1];
      const before = snaps[snaps.indexOf(s) - 1];
      return [...s.rows.values()].map((row) => still(row, before?.rows.get(row[0]), before ? s.time - before.time : 0));
    }
    const a = snaps[i];
    const b = snaps[i + 1];
    const span = Math.max(1, b.time - a.time);
    const k = Math.min(1, Math.max(0, (t - a.time) / span));
    const z = snaps[i - 1];
    const c = snaps[i + 2];
    const out = [];
    for (const row of b.rows.values()) {
      const p1 = a.rows.get(row[0]);
      if (!p1) {
        out.push({ row, x: row[3], y: row[4], a: row[5] / 1000, vx: 0, vy: 0, leaving: false });
        continue;
      }
      const p0 = z?.rows.get(row[0]) ?? p1;
      const p3 = c?.rows.get(row[0]) ?? row;
      const x = catmull(p0[3], p1[3], row[3], p3[3], k);
      const y = catmull(p0[4], p1[4], row[4], p3[4], k);
      const a1 = p1[5] / 1000;
      out.push({ row, x, y, a: a1 + turn(a1, row[5] / 1000) * k, vx: ((row[3] - p1[3]) / span) * 1000, vy: ((row[4] - p1[4]) / span) * 1000, leaving: false });
    }
    for (const row of a.rows.values()) {
      if (b.rows.has(row[0])) continue;
      out.push({ row, x: row[3], y: row[4], a: row[5] / 1000, vx: 0, vy: 0, leaving: true });
    }
    return out;
  }

  function still(row, before, span) {
    const vx = before && span ? ((row[3] - before[3]) / span) * 1000 : 0;
    const vy = before && span ? ((row[4] - before[4]) / span) * 1000 : 0;
    return { row, x: row[3], y: row[4], a: row[5] / 1000, vx, vy, leaving: false };
  }

  /** Hold effects (arriving now, at local `arrivedAt`) until the drawing reaches their snapshot. */
  function hold(items, arrivedAt = performance.now()) {
    const time = latestTime();
    for (const item of items) pending.push({ item, time, arrivedAt });
    // A screen that stopped drawing (a hidden tab) keeps only the latest few hundred.
    if (pending.length > 400) pending.splice(0, pending.length - 400);
  }

  /**
   * Effects the drawing has now reached, oldest first, each with how long it waited here (ms): a
   * tab that stopped drawing for a while gets a backlog, which a screen can show without sound.
   */
  function due(now) {
    if (!pending.length) return [];
    const t = renderTime(now);
    const out = [];
    const keep = [];
    for (const p of pending) (p.time <= t ? out : keep).push(p);
    pending = keep;
    return out.map((p) => ({ item: p.item, waitedMs: now - p.arrivedAt }));
  }

  return {
    push,
    sample,
    hold,
    due,
    reset,
    renderTime,
    latestTime,
    get size() {
      return snaps.length;
    },
  };
}
