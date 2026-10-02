// Cornlashing's cob scoreboard, the numbers behind it: each agent owns a lane of kernels on a corn
// cob, lit in proportion to their score (the leader's lane is full), and this round's points pop
// in on top of what they had. No DOM here (the tests run it in Node); chaos-host.js draws it.

/** Kernels along a lane. */
export const COB_COLUMNS = 24;

/** Kernel rows per lane: a small room gets a chunkier cob (each agent owns a band of rows). */
export const cobRowsPerLane = (lanes) => (lanes <= 2 ? 3 : lanes <= 4 ? 2 : 1);

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
