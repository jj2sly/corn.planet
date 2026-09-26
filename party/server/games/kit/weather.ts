// CPI weather: a seeded schedule of hostile weather, and forecasts of it at any accuracy. Generic:
// a game supplies its weather types (each with a category), which of them a level uses, and what a
// forecasting instrument of each tier can tell. What weather *does* is up to the game.
//
//   const schedule = drawSchedule({ random, types, pool, chance, firstTurn, … });
//   forecast(schedule, currentTurn, tier, { seed, types, pool })   // what an instrument would say
//
// Forecasts are deterministic per (game, event, tier): the same machine says the same thing all
// turn, and an upgrade can change its mind (it's a better instrument), never a refresh.

export interface WeatherEvent {
  turn: number;
  type: string;
  /** 1 LOW, 2 MEDIUM, 3 HIGH. */
  severity: number;
  secondary: string | null;
}

export interface WeatherTypeInfo {
  category: string;
  secondary: string | null;
}

export interface ScheduleOptions {
  random: () => number;
  types: Record<string, WeatherTypeInfo>;
  /** Type → weight, for this level. */
  pool: Record<string, number>;
  /** Chance of weather on any turn from `firstTurn`. */
  chance: number;
  firstTurn: number;
  horizon: number;
  severityWeights: readonly number[];
  severityRamp: number;
  secondaryChance: number;
}

function weighted<T>(entries: [T, number][], r: number): T {
  const total = entries.reduce((n, [, w]) => n + Math.max(0, w), 0);
  let x = r * total;
  for (const [v, w] of entries) {
    x -= Math.max(0, w);
    if (x < 0) return v;
  }
  return entries[entries.length - 1]![0];
}

export function drawSchedule(o: ScheduleOptions): WeatherEvent[] {
  const pool = Object.entries(o.pool).filter(([t, w]) => w > 0 && o.types[t]);
  const events: WeatherEvent[] = [];
  if (!pool.length) return events;
  for (let turn = o.firstTurn; turn <= o.horizon; turn++) {
    // Always draw the same number of randoms per turn, so one change doesn't reshuffle the rest.
    const rChance = o.random();
    const rType = o.random();
    const rSev = o.random();
    const rSec = o.random();
    if (rChance >= o.chance) continue;
    const type = weighted(pool, rType);
    const ramp = o.severityRamp * (turn - 1);
    const sw = o.severityWeights.map((w, i) => (i === o.severityWeights.length - 1 ? w + ramp : w));
    const severity = weighted(sw.map((w, i) => [i + 1, w] as [number, number]), rSev);
    const second = o.types[type]!.secondary;
    events.push({ turn, type, severity, secondary: second && rSec < o.secondaryChance ? second : null });
  }
  return events;
}

export interface ForecastTier {
  tier: number;
  accuracy: number;
  /** Tiers that list turns: how many turns ahead. Others: the next event only. */
  window: number;
  shows: "category" | "type";
  exactTurn: boolean;
  severity: boolean;
  secondary: boolean;
}

export interface ForecastLine {
  /** The turn it's for (exact), or an estimate, or a range. */
  turn: number | null;
  estTurn: number | null;
  turnRange: [number, number] | null;
  category: string | null;
  type: string | null;
  severity: number | null;
  secondary: string | null;
  /** How sure the instrument is, 0..1 (its tier's accuracy). */
  confidence: number;
  /** Nothing expected on that turn (listing tiers). */
  clear: boolean;
}

/** A small stable hash → 0..1, so an instrument's guess stays put. */
export function unit(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function guess(event: WeatherEvent, tier: ForecastTier, seed: number, types: Record<string, WeatherTypeInfo>, pool: Record<string, number>): { type: string; category: string; right: boolean } {
  const truth = { type: event.type, category: types[event.type]!.category };
  const right = unit(seed, event.turn, tier.tier, 1) < tier.accuracy;
  if (right) return { ...truth, right };
  const inPool = Object.keys(pool).filter((t) => types[t]);
  if (tier.shows === "category") {
    const others = [...new Set(inPool.map((t) => types[t]!.category))].filter((c) => c !== truth.category);
    if (!others.length) return { ...truth, right: true };
    const category = others[Math.floor(unit(seed, event.turn, tier.tier, 2) * others.length)]!;
    return { type: event.type, category, right: false };
  }
  const same = inPool.filter((t) => t !== event.type && types[t]!.category === truth.category);
  const others = same.length ? same : inPool.filter((t) => t !== event.type);
  if (!others.length) return { ...truth, right: true };
  const type = others[Math.floor(unit(seed, event.turn, tier.tier, 3) * others.length)]!;
  return { type, category: types[type]!.category, right: false };
}

/** What an instrument of `tier` says, standing at `currentTurn`. */
export function forecast(schedule: readonly WeatherEvent[], currentTurn: number, tier: ForecastTier, ctx: { seed: number; types: Record<string, WeatherTypeInfo>; pool: Record<string, number> }): ForecastLine[] {
  const line = (event: WeatherEvent): ForecastLine => {
    const g = guess(event, tier, ctx.seed, ctx.types, ctx.pool);
    let turn: number | null = null;
    let estTurn: number | null = null;
    let turnRange: [number, number] | null = null;
    if (tier.exactTurn) turn = event.turn;
    else if (tier.shows === "type") estTurn = Math.max(currentTurn, event.turn + Math.floor(unit(ctx.seed, event.turn, tier.tier, 4) * 3) - 1);
    else {
      const lo = Math.max(currentTurn, event.turn - Math.floor(unit(ctx.seed, event.turn, tier.tier, 5) * 2));
      turnRange = [lo, Math.max(lo + 1, event.turn + Math.floor(unit(ctx.seed, event.turn, tier.tier, 6) * 2))];
    }
    return {
      turn,
      estTurn,
      turnRange,
      category: g.category,
      type: tier.shows === "type" ? g.type : null,
      severity: tier.severity ? event.severity : null,
      secondary: tier.secondary ? event.secondary : null,
      confidence: tier.accuracy,
      clear: false,
    };
  };
  if (tier.window > 1) {
    const out: ForecastLine[] = [];
    for (let t = currentTurn; t < currentTurn + tier.window; t++) {
      const event = schedule.find((e) => e.turn === t);
      out.push(event ? line(event) : { turn: t, estTurn: null, turnRange: null, category: null, type: null, severity: null, secondary: null, confidence: tier.accuracy, clear: true });
    }
    return out;
  }
  const next = schedule.find((e) => e.turn >= currentTurn);
  return next ? [line(next)] : [];
}
