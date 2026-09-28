// Reachability checker for Steam My Deck. For every level, every phase and every distinct
// movement in the cast, it searches what a runner can reach with the real physics (physics.ts), no
// planks and a level Deck, and fails if the exit or any item is out of reach, from the spawn and from
// every checkpoint (a runner who dies respawns there, so nothing may be cut off from one). Run it
// after changing levels.ts or the cast's stats:
//
//   node scripts/steamdeck-reach.ts [levelId]
//
// The search: from each place a runner can come to rest (standing, or floating in water), try a set of
// scripted moves (run-up, jump or not, steer in the air, or swim strokes), simulate each until the
// runner settles, and queue where they end up. Everything touched on the way counts as reached.

import { CAST } from "../public/js/games/steamdeck-cast.js";
import { checkpointSpawn, hazardActive, LEVELS, sizeOf, type Level, type Phase } from "../server/games/steamdeck/levels.ts";
import { newBody, PHYS, stepBody, type Arena, type Body, type RunnerInput, type Stats } from "../server/games/steamdeck/physics.ts";

/** Same as the game: 20 ticks a second, 4 substeps each, input read per tick. */
const SUBSTEPS = 4;
const DT = 0.05 / SUBSTEPS;
/** Same as game.ts. */
const ITEM_REACH = 20;
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

/** Swimming places are coarser (and your breath rounded to a second): otherwise water alone is most of a search. */
const WET_GRID = 20;
const key = (b: Body) => (b.wet ? `w${Math.round(b.x / WET_GRID)},${Math.round(b.y / WET_GRID)},${Math.round(b.breath)}` : `${Math.round(b.x / GRID)},${Math.round(b.y / GRID)}`);

/** A uniform grid of rects, so each tick only collides with what's near (big levels have many). */
const CELL = 256;
function spatial<T>(items: readonly T[], rectOf: (t: T) => readonly number[]) {
  const cells = new Map<string, T[]>();
  items.forEach((item) => {
    const [x, y, w, h] = rectOf(item) as [number, number, number, number];
    for (let cx = Math.floor(x / CELL); cx <= Math.floor((x + w) / CELL); cx++) {
      for (let cy = Math.floor(y / CELL); cy <= Math.floor((y + h) / CELL); cy++) {
        const k = `${cx},${cy}`;
        (cells.get(k) ?? cells.set(k, []).get(k)!).push(item);
      }
    }
  });
  /** Everything within `pad` of the box (a runner moves at most ~70 units a tick). */
  return (x: number, y: number, pad = 120): T[] => {
    const out = new Set<T>();
    for (let cx = Math.floor((x - pad) / CELL); cx <= Math.floor((x + PHYS.width + pad) / CELL); cx++) {
      for (let cy = Math.floor((y - pad) / CELL); cy <= Math.floor((y + PHYS.height + pad) / CELL); cy++) for (const item of cells.get(`${cx},${cy}`) ?? []) out.add(item);
    }
    return [...out];
  };
}

function touches(b: Body, [cx, cy]: [number, number]): boolean {
  return b.x < cx + ITEM_REACH && b.x + PHYS.width > cx - ITEM_REACH && b.y < cy + ITEM_REACH && b.y + PHYS.height > cy - ITEM_REACH;
}

export function checkReach(level: Level, phase: Phase, stats: Stats, from: [number, number] = level.spawn): ReachResult {
  const arena: Arena = {
    spawn: from,
    exit: level.exit,
    platforms: level.platforms,
    hazards: level.hazards.filter((h) => hazardActive(h, phase)).map((h) => h.rect),
    planks: [],
    water: level.water ?? [],
    zones: level.zones ?? [],
    exitOpen: true,
    ...sizeOf(level),
  };
  const items = level.items ?? [];
  const found = new Set<number>();
  let exit = false;
  const nearPlatforms = spatial(arena.platforms, (r) => r);
  const nearHazards = spatial(arena.hazards, (r) => r);
  const nearWater = spatial(arena.water ?? [], (r) => r);

  const start = newBody(from);
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
    const local: Arena = { ...arena, platforms: nearPlatforms(b.x, b.y), hazards: nearHazards(b.x, b.y), water: nearWater(b.x, b.y) };
    for (let s = 0; s < SUBSTEPS; s++) {
      const events = stepBody(b, input, local, 0, DT, stats);
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

/** One tick of input, as a player's buttons: which way, and whether jump is pressed this tick. */
export interface TickInput {
  dir: -1 | 0 | 1;
  jump: boolean;
}

/**
 * A way to get from `start` (a body at rest) to wherever `goal` is true at the end of a tick, with
 * the real physics and no planks: the searcher above, remembering how it got to each place. Returns
 * the inputs, tick by tick, and where they leave you; null if there's no way. The exit stays shut
 * (`exitOpen` false), as it is in a level whose exit has to be used.
 */
export function planRoute(level: Level, phase: Phase, stats: Stats, start: Body, goal: (b: Body) => boolean): { inputs: TickInput[]; end: Body } | null {
  const arena: Arena = {
    spawn: level.spawn,
    exit: level.exit,
    platforms: level.platforms,
    hazards: level.hazards.filter((h) => hazardActive(h, phase)).map((h) => h.rect),
    planks: [],
    water: level.water ?? [],
    zones: level.zones ?? [],
    exitOpen: false,
    ...sizeOf(level),
  };
  const nearPlatforms = spatial(arena.platforms, (r) => r);
  const nearHazards = spatial(arena.hazards, (r) => r);
  const nearWater = spatial(arena.water ?? [], (r) => r);
  const step = (b: Body, input: TickInput): boolean => {
    const local: Arena = { ...arena, platforms: nearPlatforms(b.x, b.y), hazards: nearHazards(b.x, b.y), water: nearWater(b.x, b.y) };
    const seq = input.jump ? b.lastJumpSeq + 1 : b.lastJumpSeq;
    for (let s = 0; s < SUBSTEPS; s++) if (stepBody(b, { left: input.dir < 0, right: input.dir > 0, jumpSeq: seq }, local, 0, DT, stats).includes("died")) return false;
    return true;
  };
  const nodes: { body: Body; parent: number; inputs: TickInput[] }[] = [{ body: clone(start), parent: -1, inputs: [] }];
  const seen = new Set([key(start)]);
  const route = (index: number, tail: TickInput[], end: Body) => {
    const parts: TickInput[][] = [tail];
    for (let i = index; i >= 0; i = nodes[i]!.parent) parts.unshift(nodes[i]!.inputs);
    return { inputs: parts.flat(), end };
  };
  if (goal(start)) return { inputs: [], end: clone(start) };
  for (let head = 0; head < nodes.length; head++) {
    for (const move of MOVES) {
      const b = clone(nodes[head]!.body);
      const inputs: TickInput[] = [];
      let alive = true;
      for (const seg of move) {
        for (let t = 0; t < seg.ticks && alive; t++) {
          const input: TickInput = { dir: seg.dir, jump: seg.jumpAt === t || (!!seg.jumpEvery && t % seg.jumpEvery === 0) };
          inputs.push(input);
          alive = step(b, input);
          if (alive && goal(b)) return route(head, inputs, b);
        }
      }
      let settled = false;
      for (let t = 0; t < SETTLE_TICKS && alive; t++) {
        if ((b.grounded && Math.abs(b.vx) < 1) || (b.wet && t > 4)) {
          settled = true;
          break;
        }
        const input: TickInput = { dir: 0, jump: false };
        inputs.push(input);
        alive = step(b, input);
        if (alive && goal(b)) return route(head, inputs, b);
      }
      if (!alive || !settled || seen.has(key(b))) continue;
      seen.add(key(b));
      nodes.push({ body: b, parent: head, inputs });
    }
  }
  return null;
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

/**
 * Checks every level (or one), every movement, from the spawn and every checkpoint. Returns the
 * failures, one line each. Only the FINAL phase: it has every hazard the earlier phases have, and a
 * hazard only ever takes reach away, so if FINAL is escapable so is everything before it.
 */
export function checkAll(levelId?: string, log: (line: string) => void = () => {}): string[] {
  const failures: string[] = [];
  const levels = LEVELS.filter((l) => !levelId || l.id === levelId);
  if (!levels.length) throw new Error(`no level "${levelId}"`);
  for (const level of levels) {
    const starts: [string, [number, number]][] = [["spawn", level.spawn], ...(level.checkpoints ?? []).map((c): [string, [number, number]] => [`checkpoint ${c.id}`, checkpointSpawn(c)])];
    for (const phase of ["FINAL"] as Phase[]) {
      for (const { stats, who } of castMovements()) {
        for (const [where, from] of starts) {
          const r = checkReach(level, phase, stats, from);
          const problems = [...(r.exit ? [] : ["exit"]), ...r.missingItems.map((id) => `item ${id}`)];
          const label = `${level.id} ${phase} from ${where} run ${stats.run} jump ${stats.jump} (${who.join(", ")})`;
          log(`${problems.length ? "✗" : "✓"} ${label}${problems.length ? `: can't reach ${problems.join(", ")} (${r.places} places)` : ""}`);
          if (problems.length) failures.push(`${label}: ${problems.join(", ")}`);
        }
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
