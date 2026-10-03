// Budget Cuts' funding tiers as the phone shows them (no DOM, so the tests run it in Node). The
// server decides the real tier (tierFor in server/games/budgetcuts.ts); this mirrors its thresholds
// only so the plan editor can show the result of a tap before it is submitted.

/** Short names for the five funding tiers, lowest first. */
export const TIER_SHORT = ["Way under", "Under", "OK", "Plenty", "Wasted"];

/** Funding tier for `alloc` kernels against an ask: under 40%, 80%, 120%, 160% of it. */
export function tierOf(alloc, request) {
  const ratio = request <= 0 ? 1 : alloc / request;
  return ratio < 0.4 ? 0 : ratio < 0.8 ? 1 : ratio < 1.2 ? 2 : ratio < 1.6 ? 3 : 4;
}

/** The kernels that keep a department "OK" (Adequate): 80% up to just under 120% of its ask, in 5s. */
export function okZone(request) {
  const lo = Math.ceil((request * 0.8) / 5) * 5;
  const hi = Math.ceil((request * 1.2) / 5) * 5 - 5;
  return [lo, Math.max(lo, hi)];
}

/** Total of a plan (department id → kernels), and how far it is under (+) or over (−) the pool. */
export function planTotals(alloc, pool) {
  const total = Object.values(alloc).reduce((a, b) => a + b, 0);
  return { total, left: pool - total, fits: total <= pool };
}
