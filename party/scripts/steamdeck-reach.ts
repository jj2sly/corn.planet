// Reachability checker for Steam My Deck. For every level, every phase and every distinct
// movement in the cast, it searches what a runner can reach with the real physics (physics.ts), no
// planks and a level Deck, and fails if the exit or any item is out of reach. Run it after changing
// levels.ts or the cast's stats:
//
//   node scripts/steamdeck-reach.ts [levelId]
//
// The search: from each place a runner can come to rest (standing, or floating in water), try a set of
// scripted moves (run-up, jump or not, steer in the air, or swim strokes), simulate each until the
// runner settles, and queue where they end up. Everything touched on the way counts as reached.

import { CAST } from "../public/js/games/steamdeck-cast.js";
import { hazardActive, LEVELS, type Level, type Phase } from "../server/games/steamdeck/levels.ts";
import { newBody, PHYS, stepBody, type Arena, type Body, type RunnerInput, type Stats } from "../server/games/steamdeck/physics.ts";

/** Same as the game: 20 ticks a second, 4 substeps each, input read per tick. */
const SUBSTEPS = 4;
const DT = 0.05 / SUBSTEPS;
/** Same as game.ts. */
const ITEM_REACH = 20;
const PHASES: Phase[] = ["ESCAPE", "ESCALATION", "FINAL"];
/** A move that hasn't settled after this many ticks is dropped. */
const SETTLE_TICKS = 200;
/** Place granularity for the search, in world units. */
const GRID = 6;

export interface ReachResult {
  exit: boolean;
  /** Ids of items nobody with these stats can reach. */
  missingItems: string[];
  /** Places the search came to rest (a measure of how far it got). */
  places: number;
}

type Move = { dir: -1 | 0 | 1; ticks: number; jumpEvery?: number; jumpAt?: number }[];

// Walk; run up and jump; steer in the air then let go; swim with strokes. Ticks are 50 ms.
const MOVES: Move[] = (() => {
  const moves: Move[] = [];
  const dirs = [-1, 0, 1] as const;
  for (const d of [-1, 1] as const) for (const t of [2, 5, 12]) moves.push([{ dir: d, ticks: t }]);
  for (const run of [-1, 0, 1] as const) {
    for (const runTicks of run ? [0, 3, 8] : [0]) {
      for (const air of dirs) {
        for (const airTicks of air ? [2, 4, 7, 11, 16, 40] : [40]) {
          moves.push([{ dir: run, ticks: runTicks }, { dir: air, ticks: airTicks, jumpAt: 0 }]);
        }
      }
    }
  }
  for (const d of dirs) for (const every of [3, 6, 10]) for (const t of [10, 25, 60]) moves.push([{ dir: d, ticks: t, jumpEvery: every }]);
  return moves;
})();

function clone(b: Body): Body {
  return { ...b };
}

const key = (b: Body) => `${Math.round(b.x / GRID)},${Math.round(b.y / GRID)},${b.wet ? Math.round(b.breath * 2) : "d"}`;

function touches(b: Body, [cx, cy]: [number, number]): boolean {
  return b.x < cx + ITEM_REACH && b.x + PHYS.width > cx - ITEM_REACH && b.y < cy + ITEM_REACH && b.y + PHYS.height > cy - ITEM_REACH;
}

export function checkReach(level: Level, phase: Phase, stats: Stats): ReachResult {
  const arena: Arena = {
    spawn: level.spawn,
    exit: level.exit,
    platforms: level.platforms,
    hazards: level.hazards.filter((h) => hazardActive(h, phase)).map((h) => h.rect),
    planks: [],
    water: level.water ?? [],
    exitOpen: true,
  };
  const items = level.items ?? [];
  const found = new Set<number>();
  let exit = false;

  const start = newBody(level.spawn);
  const seen = new Set<string>();
  const queue: Body[] = [];
  const settle = (b: Body) => {
    const k = key(b);
    if (!seen.has(k)) {
      seen.add(k);
      queue.push(b);
    }
  };

  /** One tick with this input. False once the runner has died or escaped. */
  const tick = (b: Body, input: RunnerInput): boolean => {
    for (let s = 0; s < SUBSTEPS; s++) {
      const events = stepBody(b, input, arena, 0, DT, stats);
      if (events.includes("escaped")) exit = true;
      if (events.includes("died") || events.includes("escaped")) return false;
    }
    items.forEach((item, i) => {
      if (!found.has(i) && touches(b, item.at)) found.add(i);
    });
    return true;
  };

  // Let the spawn drop onto the ground first.
  {
    const b = clone(start);
    let alive = true;
    for (let t = 0; t < SETTLE_TICKS && alive && !(b.grounded && Math.abs(b.vx) < 1); t++) alive = tick(b, { left: false, right: false, jumpSeq: 0 });
    if (alive) settle(b);
  }

  while (queue.length && !(exit && found.size === items.length)) {
    const from = queue.shift()!;
    for (const move of MOVES) {
      const b = clone(from);
      let seq = b.lastJumpSeq;
      let alive = true;
      for (const seg of move) {
        for (let t = 0; t < seg.ticks && alive; t++) {
          if (seg.jumpAt === t || (seg.jumpEvery && t % seg.jumpEvery === 0)) seq += 1;
          alive = tick(b, { left: seg.dir < 0, right: seg.dir > 0, jumpSeq: seq });
        }
      }
      // Let go and see where they come to rest: standing still, or bobbing in water.
      let settled = false;
      for (let t = 0; t < SETTLE_TICKS && alive; t++) {
        if ((b.grounded && Math.abs(b.vx) < 1) || (b.wet && t > 4)) {
          settled = true;
          break;
        }
        alive = tick(b, { left: false, right: false, jumpSeq: seq });
      }
      if (alive && settled) settle(b);
    }
  }
  return { exit, missingItems: items.filter((_, i) => !found.has(i)).map((item) => item.id), places: seen.size };
}

/** The cast's distinct movements, each with who moves like that. */
export function castMovements(): { stats: Stats; who: string[] }[] {
  const byStats = new Map<string, { stats: Stats; who: string[] }>();
  for (const member of CAST) {
    const k = `${member.stats.run}/${member.stats.jump}`;
    const entry = byStats.get(k) ?? { stats: { run: member.stats.run, jump: member.stats.jump }, who: [] };
    entry.who.push(member.name);
    byStats.set(k, entry);
  }
  return [...byStats.values()];
}

/** Checks every level (or one), every phase, every movement. Returns the failures, one line each. */
export function checkAll(levelId?: string, log: (line: string) => void = () => {}): string[] {
  const failures: string[] = [];
  const levels = LEVELS.filter((l) => !levelId || l.id === levelId);
  if (!levels.length) throw new Error(`no level "${levelId}"`);
  for (const level of levels) {
    for (const phase of PHASES) {
      for (const { stats, who } of castMovements()) {
        const r = checkReach(level, phase, stats);
        const problems = [...(r.exit ? [] : ["exit"]), ...r.missingItems.map((id) => `item ${id}`)];
        const label = `${level.id} ${phase} run ${stats.run} jump ${stats.jump} (${who.join(", ")})`;
        log(`${problems.length ? "✗" : "✓"} ${label}${problems.length ? `: can't reach ${problems.join(", ")} (${r.places} places)` : ""}`);
        if (problems.length) failures.push(`${label}: ${problems.join(", ")}`);
      }
    }
  }
  return failures;
}

if (import.meta.main) {
  const failures = checkAll(process.argv[2], (line) => console.log(line));
  console.log(failures.length ? `\n${failures.length} unreachable` : "\nEvery level is reachable by everyone, in every phase.");
  process.exitCode = failures.length ? 1 : 0;
}
