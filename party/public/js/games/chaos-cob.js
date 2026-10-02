// Cornlashing's cob scoreboard, the numbers behind it: each agent owns a lane of kernels on a corn
// cob, lit in proportion to their score (the leader's lane is full), and this round's points pop
// in on top of what they had. No DOM here (the tests run it in Node); chaos-host.js draws it.
//
// The cob is a tapered cylinder lying on its side, seen with a little perspective, and each lane is
// a strip of kernel rows wrapped around it. So this file also holds the small amount of geometry
// (where each lane sits on the curve, the cob's outline and lighting) and the reveal's timeline.

/** Kernels along a lane. */
export const COB_COLUMNS = 24;

/** Kernel rows per lane: a small room gets a chunkier cob (each agent owns a band of rows). */
export const cobRowsPerLane = (lanes) => (lanes <= 1 ? 5 : lanes <= 2 ? 3 : lanes <= 4 ? 2 : 1);

/**
 * The scoreboard for `players` ([{ id, name, score, connected }], in room order) given their scores
 * when the round began (`previous`: Map of id -> score, or null when this screen doesn't know them,
 * say after a reload: then nothing pops and nobody moves).
 *
 * `kernels` is how many kernels make a full lane. Returns { rows, previousOrder, scale, moved,
 * known }: `rows` ranked now, `previousOrder` ranked as the round began, each { id, name, connected,
 * index, score, previous, gain, kernelsBefore, kernelsAfter, placement, previousPlacement, move }
 * (move > 0: climbed that many places).
 */
export function cobStandings(players, previous, { kernels: perLane = COB_COLUMNS } = {}) {
  const list = Array.isArray(players) ? players : [];
  const before = (p) => {
    if (!previous) return p.score;
    const value = previous.get(p.id);
    return Math.max(0, Math.min(p.score, Number.isFinite(value) ? value : 0));
  };
  const scale = Math.max(0, ...list.map((p) => p.score));
  // Lit in proportion to the leader; anyone with points shows at least one kernel.
  const kernels = (score) => (scale > 0 && score > 0 ? Math.max(1, Math.round((score / scale) * perLane)) : 0);
  const rows = list.map((p, index) => ({
    id: p.id,
    name: p.name,
    connected: p.connected !== false,
    index,
    score: p.score,
    previous: before(p),
  }));
  // The order and places "before" only mean something once somebody had points.
  const known = previous !== null && rows.some((r) => r.previous > 0);
  for (const r of rows) {
    r.gain = r.score - r.previous;
    r.kernelsBefore = kernels(r.previous);
    r.kernelsAfter = kernels(r.score);
    r.placement = 1 + rows.filter((o) => o.score > r.score).length;
    r.previousPlacement = known ? 1 + rows.filter((o) => o.previous > r.previous).length : r.placement;
    r.move = r.previousPlacement - r.placement;
  }
  const ranked = [...rows].sort((a, b) => b.score - a.score || a.index - b.index);
  const previousOrder = known ? [...rows].sort((a, b) => b.previous - a.previous || a.index - b.index) : ranked;
  const moved = previousOrder.some((r, i) => r !== ranked[i]);
  return { rows: ranked, previousOrder, scale, moved, known };
}

// ------------------------------------------------------------------ the cylinder

/** Degrees the cob is rolled about its axis at rest (0: the middle of the lanes faces the viewer). */
export const COB_TILT = 0;
/** Camera distance in cylinder radii (smaller: stronger perspective). */
export const COB_PERSPECTIVE = 4;
/** Degrees of bare cob visible past the outermost rows (the rim curving away). */
export const COB_RIM = 16;
/** Width of the kernel zone as a fraction of the stage, measured through the front-facing rows. */
export const COB_ZONE = 0.84;
/** Taller than wide, like a real kernel. */
const KERNEL_ASPECT = 1.7;
/** How much narrower the cylinder is at its ends than at its belly, and how sharply. */
const TAPER = 0.22;
const TAPER_POWER = 2.4;
/** Direction of the light: degrees above the viewing axis (it comes from the upper left). */
const LIGHT = 38;
/** Space under the cob for its shadow, in cylinder radii. */
const FLOOR = 0.2;
/** How far the outer rows are widened toward equal on-screen heights (0: equal angles, 1: equal heights). */
const FLATTEN = 0.5;

const rad = (deg) => (deg * Math.PI) / 180;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

/** Cylinder radius at `u` along the cob (0 stem end … 1 tip), 1 at the belly. Defined a little past both ends for the caps. */
export const cobTaper = (u) => Math.max(0.5, 1 - TAPER * Math.abs(2 * u - 1) ** TAPER_POWER);

/** A point at radius `r` (cylinder radii) and `deg` above the view axis: screen `y` (down, in radii) and the perspective scale `s`. */
function project(r, deg) {
  const s = COB_PERSPECTIVE / (COB_PERSPECTIVE - r * Math.cos(rad(deg)));
  return { y: -r * Math.sin(rad(deg)) * s, s };
}

/**
 * Where everything sits for a cob of `lanes` agents with `bands` kernel rows each (cobRowsPerLane).
 * "R" is the cylinder's radius; the stage is `aspect` times as tall as it is wide and R = rho x its
 * width, so everything scales with the stage.
 *
 * Returns { lanes, bands, rows, step, span, top, bottom, rho, aspect, axis, height, rowW, rowH, cell,
 * slots, rowAngle, seam, frac }. `slots[i]` is where the i-th ranked lane sits { angle, y, height,
 * ends }: the lane's centre in degrees above the view axis, its centre and height as fractions of
 * the stage height, and [left, right] fractions of the stage width at that lane. `rowAngle(slot,
 * band)` is one kernel row's angle, `rowH(j)` row j's height in R and `seam(slot)` the angle where
 * lane `slot` begins. `axis` and `height` are the cob's axis depth and the stage height, in R.
 */
export function cobGeometry(lanes, bands = cobRowsPerLane(lanes)) {
  const n = Math.max(1, Math.floor(lanes));
  const rows = n * bands;
  const span = clamp(rows * 16, 96, 124);
  // Row edges, top to bottom. Equal steps of angle would squash the outer lanes to a third of the
  // middle ones, so they are spread halfway toward equal heights on screen (wider rows near the edge).
  const half = rad(span / 2);
  const edges = Array.from({ length: rows + 1 }, (_, i) => {
    const t = i / rows;
    const even = (span / 2) * (1 - 2 * t);
    const flat = (Math.asin(Math.sin(half) * (1 - 2 * t)) * 180) / Math.PI;
    return COB_TILT + even * (1 - FLATTEN) + flat * FLATTEN;
  });
  const rowAngle = (slot, band) => {
    const j = slot * bands + band;
    return (edges[j] + edges[j + 1]) / 2;
  };
  const rowStep = (j) => edges[j] - edges[j + 1];
  const laneTop = (slot) => edges[slot * bands];
  const laneBottom = (slot) => edges[(slot + 1) * bands];
  const laneAngle = (slot) => (laneTop(slot) + laneBottom(slot)) / 2;
  const step = Math.min(...Array.from({ length: rows }, (_, j) => rowStep(j)));

  // The front-on belly is magnified by s0, so the kernels' proportions are set there.
  const s0 = COB_PERSPECTIVE / (COB_PERSPECTIVE - 1);
  const cell = COB_ZONE / (COB_COLUMNS + 0.5);
  const rho = (KERNEL_ASPECT * cell) / (rad(step) * s0);

  // Vertical extent of the body (rows plus the rim) and the floor under it.
  const above = -project(1, edges[0] + COB_RIM).y;
  const below = project(1, edges[rows] - COB_RIM).y;
  const margin = 0.03;
  const height = above + below + FLOOR + margin * 2;
  const axis = above + margin;
  const frac = (yR) => (axis + yR) / height;

  const rowW = COB_ZONE / s0; // a row's width in stage widths, before perspective
  const slots = Array.from({ length: n }, (_, slot) => {
    const upper = project(1, laneTop(slot));
    const lower = project(1, laneBottom(slot));
    const mid = project(1, laneAngle(slot));
    const reach = (rowW * mid.s) / 2;
    return { angle: round(laneAngle(slot), 3), y: round(frac(mid.y)), height: round((lower.y - upper.y) / height), ends: [round(0.5 - reach), round(0.5 + reach)] };
  });
  const rowH = (j) => round(rad(rowStep(j)) * 0.97);
  return { lanes: n, bands, rows, step, span, top: edges[0], bottom: edges[rows], rho, aspect: round(height * rho), axis: round(axis), height: round(height), rowW: round(rowW), rowH, cell: round(cell), slots, rowAngle, seam: laneTop, frac };
}

/** A lane's kernel at `index` (filled column by column, the bands side by side): its row, column and place `u` along the cob. */
export function cobKernelSlot(index, bands) {
  const band = index % bands;
  const column = Math.floor(index / bands);
  // Alternate rows are staggered half a kernel, as on a real cob.
  const u = (column + 0.5 + (band % 2) * 0.5) / (COB_COLUMNS + 0.5);
  return { band, column, u };
}

/**
 * The cob's outline in the stage's own coordinates (1000 wide, `1000 x aspect` tall): points
 * clockwise from the stem end's top, and their bounds. Sampled along the taper, so it narrows
 * toward both ends with the same perspective the kernels get.
 */
export function cobOutline(geometry) {
  const { rho, rowW, height } = geometry;
  const top = geometry.top + COB_RIM;
  const bottom = geometry.bottom - COB_RIM;
  const point = (u, deg) => {
    const r = cobTaper(u);
    const p = project(r, deg);
    return [round((0.5 + (u - 0.5) * rowW * p.s) * 1000, 1), round((geometry.axis + p.y) * rho * 1000, 1)];
  };
  const cap = -0.045; // the caps reach this far past the first and last kernel
  const along = 24;
  const around = 8;
  const points = [];
  const at = (i) => cap + ((1 - 2 * cap) * i) / along;
  for (let i = 0; i <= along; i++) points.push(point(at(i), top)); // along the top, stem to tip
  for (let i = 1; i < around; i++) points.push(point(1 - cap, top + ((bottom - top) * i) / around)); // down the tip's cap
  for (let i = along; i >= 0; i--) points.push(point(at(i), bottom)); // back along the bottom
  for (let i = around - 1; i > 0; i--) points.push(point(cap, top + ((bottom - top) * i) / around)); // up the stem's cap
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { points, left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), viewBox: [1000, round(height * rho * 1000, 1)] };
}

/** A seam along the cob at `deg`, in the outline's coordinates: [[x, y], …] from the stem end to the tip (where lanes meet). */
export function cobRail(geometry, deg, samples = 16) {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const u = i / samples;
    const r = cobTaper(u);
    const p = project(r, deg);
    return [round((0.5 + (u - 0.5) * geometry.rowW * p.s) * 1000, 1), round((geometry.axis + p.y) * geometry.rho * 1000, 1)];
  });
}

/** How brightly the light from the upper left falls on the surface facing `deg` (about 0.2 dark … 1 lit). */
export function cobLight(deg) {
  const facing = Math.max(0, Math.cos(rad(deg - LIGHT)));
  const grazing = 0.6 + 0.4 * Math.cos(rad(clamp(deg - COB_TILT, -90, 90)));
  return clamp((0.28 + 0.72 * facing) * grazing, 0, 1);
}

/** Where the sheen sits down the body, in the outline's coordinates (y): halfway between the light and the viewer. */
export const cobSheen = (geometry) => round((geometry.axis + project(1, LIGHT / 2).y) * geometry.rho * 1000, 1);

/** Shading down the body, from the light model: [{ at (0..1 down the outline), dark, light }] as overlay opacities. */
export function cobShading(geometry, samples = 12) {
  const top = geometry.top + COB_RIM;
  const bottom = geometry.bottom - COB_RIM;
  const angle = (i) => top + ((bottom - top) * i) / samples;
  const ys = Array.from({ length: samples + 1 }, (_, i) => project(1, angle(i)).y);
  return ys.map((y, i) => {
    const light = cobLight(angle(i));
    return { at: round((y - ys[0]) / (ys[samples] - ys[0]), 3), dark: round((1 - light) * 0.78, 3), light: round(Math.max(0, light - 0.8) * 1.1, 3) };
  });
}

// ------------------------------------------------------------------ the reveal

/** Kernels pop in short bursts: COB_BURST at a time, COB_BURST_STEP apart, a burst every COB_BURST_GAP (ms). */
export const COB_BURST = 4;
export const COB_BURST_STEP = 22;
export const COB_BURST_GAP = 95;

/** Delay of each of `count` popping kernels from the start of the pops (ms). */
export const cobPopDelays = (count) => Array.from({ length: count }, (_, i) => Math.floor(i / COB_BURST) * COB_BURST_GAP + (i % COB_BURST) * COB_BURST_STEP);

/** How long `count` pops take, first to last, including the last kernel's own motion (ms). */
export const cobPopSpan = (count) => (count > 0 ? cobPopDelays(count)[count - 1] + 360 : 0);

/**
 * When things happen, in ms from the board appearing: lanes light up one by one while the cob rolls
 * into view, this round's kernels pop (all lanes at once, in bursts), the lanes slide into their new
 * order, then the top agent is crowned. A board that isn't `live` (nothing to reveal, or reduced
 * motion) is already settled: everything at 0, nothing to animate.
 */
export function cobTimeline({ lanes, rows, moved, live }) {
  if (!live) return { live: false, roll: 0, activate: 0, activateStep: 0, popAt: 0, mostPops: 0, popSpan: 0, settleAt: 0, crownAt: 0, cues: [], total: 0 };
  const activate = 200;
  const activateStep = 70;
  const roll = 900;
  const popAt = Math.max(roll - 150, activate + lanes * activateStep + 180);
  const mostPops = Math.max(0, ...rows.map((r) => r.kernelsAfter - r.kernelsBefore));
  const popSpan = cobPopSpan(mostPops);
  const settleAt = popAt + popSpan + 260;
  const crownAt = settleAt + (moved ? 560 : 140);
  // A few grouped pop cues, at every other burst of the longest lane: never one per kernel.
  const bursts = Math.ceil(mostPops / COB_BURST);
  const cues = Array.from({ length: Math.min(4, Math.ceil(bursts / 2)) }, (_, i) => popAt + i * 2 * COB_BURST_GAP + 30);
  return { live: true, roll, activate, activateStep, popAt, mostPops, popSpan, settleAt, crownAt, cues, total: crownAt + 700 };
}

/** The agents wearing TOP COB: first place with points (ties share it). */
export const cobLeaders = (rows) => rows.filter((r) => r.placement === 1 && r.score > 0);
