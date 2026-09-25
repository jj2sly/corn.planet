// STEAM MY DECK — one agent is Thad and holds the Steam Deck; everyone else is trapped
// inside it and has to platform their way to the exit while Thad tilts the whole world.
//
// Realtime: the server runs the physics at 20 Hz and pushes a compact world snapshot each tick.
// Runners stream their buttons and Thad streams the tilt over `game:stream` (fire-and-forget, its own
// rate limit); drawings go over the normal acked `game:input`. Runners can draw planks with the CPI
// Drawing System (public/js/drawing.js): the stroke is read as a flat plank, never as free geometry.
//
// Rounds: ASSIGNMENT → INTRO → ESCAPE → ESCALATION → FINAL → RESULTS. Thad rotates each round,
// starting with the first agent who joined (the session leader, usually whoever brought the Deck).

import { deserialize, DrawingError, interpret, type Drawing, type Stroke } from "../../../public/js/drawing.js";
import { castMember, dealCast } from "../../../public/js/games/steamdeck-cast.js";
import { plankFromStroke } from "../../../public/js/games/steamdeck-rules.js";
import { PartyError } from "../../errors.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "../types.ts";
import { hazardActive, LEVELS, WORLD, type Level, type Phase as PlayPhase } from "./levels.ts";
import { jolt, kill, newBody, PHYS, stepBody, tiltAccel, type Body, type Plank, type RunnerInput, type Stats } from "./physics.ts";

export interface SteamDeckSettings {
  rounds: number;
}

type Phase = "ASSIGNMENT" | "INTRO" | PlayPhase | "RESULTS";
const PLAY: readonly Phase[] = ["ESCAPE", "ESCALATION", "FINAL"];

export const TIMING = {
  assignmentMs: 8_000,
  introMs: 5_000,
  escapeMs: 35_000,
  escalationMs: 25_000,
  finalMs: 15_000,
  resultsMs: 12_000,
  tickMs: 50,
  substeps: 4,
} as const;

/** How far the Deck can lean, by phase. It gets worse. */
export const MAX_TILT: Record<PlayPhase, number> = { ESCAPE: 14, ESCALATION: 22, FINAL: 30 };

export const PLANK = { minLength: 80, maxLength: 320, lifetimeMs: 10_000, cooldownMs: 4_000 } as const;

/**
 * Thad's shake: a warning rumble, then every runner standing on something is thrown up (`lift`) and
 * sideways (`push`, a random way each), scaled by their character's `knock`.
 */
export const SHAKE = { cooldownMs: 8_000, warnMs: 500, lift: 520, push: 300 } as const;

export const POINTS = { escape: 100, perSecondLeft: 2, firstOut: 25, thadPerTrapped: 50, thadPerDeath: 5, thadDeathCap: 60 } as const;

export const COLORS = ["#ffd400", "#4dd4ff", "#ff5fa2", "#7dff6a", "#ff9a3d", "#b58cff", "#f4f4f4", "#ff4d4d"];

const PHASE_MS: Record<Phase, number> = {
  ASSIGNMENT: TIMING.assignmentMs,
  INTRO: TIMING.introMs,
  ESCAPE: TIMING.escapeMs,
  ESCALATION: TIMING.escalationMs,
  FINAL: TIMING.finalMs,
  RESULTS: TIMING.resultsMs,
};

const NEXT: Record<Phase, Phase | null> = { ASSIGNMENT: "INTRO", INTRO: "ESCAPE", ESCAPE: "ESCALATION", ESCALATION: "FINAL", FINAL: "RESULTS", RESULTS: null };

type Cue = "game_start" | "alert" | "timer_warning" | "success" | "life_lost" | "major_failure" | "vote_result" | "discovery" | "contained";

/** An item's pick-up box, either side of its centre. */
const ITEM_REACH = 20;
/** The stalker's size (he stands on something, tall). */
const STALKER = { w: 30, h: 110 } as const;

interface Runner {
  id: string;
  /** Their character this round (steamdeck-cast.js) and, for one with builds, which. */
  character: string;
  build: number;
  stats: Stats;
  knock: number;
  body: Body;
  input: RunnerInput;
  deaths: number;
  planks: number;
  escapedAtMs: number | null;
  plankCooldownUntil: number;
  /** Time spent near the stalker (ms); too long and he takes you. */
  near: number;
}

interface PlacedPlank extends Plank {
  id: number;
  owner: string;
  expiresAt: number;
}

interface RoundRecord {
  round: number;
  level: string;
  thadId: string;
  escapes: { playerId: string; ms: number }[];
  deaths: Record<string, number>;
  planks: number;
  points: Record<string, number>;
  cast: Record<string, string>;
  shakes: number;
  /** Items found, of how many (levels with items). */
  found: number;
  items: number;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new PartyError("INVALID_INPUT");
  return payload as Record<string, unknown>;
}

/** A plank drawing becomes a flat plank (the rule phones preview with, so what you see is what you get). */
export const plankRule = (stroke: Stroke): Plank | null =>
  plankFromStroke(stroke, { width: WORLD.width, height: WORLD.height, minLength: PLANK.minLength, maxLength: PLANK.maxLength });

const PLANK_RULES = { plank: plankRule };

class SteamDeckGame implements GameInstance {
  private readonly ctx: GameContext;
  private readonly settings: SteamDeckSettings;
  private readonly order: string[];
  private phase: Phase = "ASSIGNMENT";
  private round = 0;
  private level: Level = LEVELS[0]!;
  private thadId = "";
  private runners = new Map<string, Runner>();
  private planks: PlacedPlank[] = [];
  private plankSeq = 0;
  private tilt = 0;
  private tiltTarget = 0;
  /** Game clock times: when Thad can shake again, and when a called shake lands (null: none). */
  private shakeReadyAt = 0;
  private shakeAt: number | null = null;
  private shakes = 0;
  /** Which of the level's items have been found this round (the whole team shares them). */
  private taken: boolean[] = [];
  private stalker: { x: number; y: number } | null = null;
  private stalkerNext = 0;
  /** Game time in ms, advanced only while the physics runs (so pauses don't eat it). */
  private clock = 0;
  private playStartedAt = 0;
  private tickSeq = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private cues: { id: number; cue: Cue }[] = [];
  private cueSeq = 0;
  private records: RoundRecord[] = [];
  private roundPoints = new Map<string, number>();
  private levelOrder: Level[];
  private disposed = false;
  /** Tells screens one game from the next (cue ids restart with every game). */
  private readonly session = Math.floor(Math.random() * 2 ** 32).toString(36);

  constructor(ctx: GameContext, settings: SteamDeckSettings) {
    this.ctx = ctx;
    this.settings = settings;
    this.order = ctx.players().map((p) => p.id);
    const shuffled = [...LEVELS];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    this.levelOrder = shuffled;
  }

  start(): void {
    this.interval = setInterval(() => this.tick(), TIMING.tickMs);
    this.interval.unref?.();
    this.beginRound();
  }

  private cue(cue: Cue): void {
    this.cues.push({ id: ++this.cueSeq, cue });
    this.cues.splice(0, Math.max(0, this.cues.length - 12));
  }

  private present(): string[] {
    return this.ctx.players().map((p) => p.id);
  }

  private beginRound(): void {
    this.round += 1;
    const present = this.order.filter((id) => this.present().includes(id));
    this.thadId = present[(this.round - 1) % present.length]!;
    this.level = this.levelOrder[(this.round - 1) % this.levelOrder.length]!;
    const runnerIds = present.filter((id) => id !== this.thadId);
    const dealt = dealCast(runnerIds.length, () => this.ctx.random());
    this.runners = new Map(
      runnerIds.map((id, i) => {
        const { id: character, build } = dealt[i]!;
        const member = castMember(character)!;
        const runner: Runner = {
          id,
          character,
          build,
          stats: { run: member.stats.run, jump: member.stats.jump },
          knock: member.stats.knock,
          body: newBody(this.level.spawn),
          input: { left: false, right: false, jumpSeq: 0 },
          deaths: 0,
          planks: 0,
          escapedAtMs: null,
          plankCooldownUntil: 0,
          near: 0,
        };
        return [id, runner];
      }),
    );
    this.planks = [];
    this.tilt = this.tiltTarget = 0;
    this.shakeReadyAt = this.clock;
    this.shakeAt = null;
    this.shakes = 0;
    this.taken = (this.level.items ?? []).map(() => false);
    this.stalker = null;
    this.roundPoints = new Map();
    this.cue("game_start");
    this.enter("ASSIGNMENT");
  }

  private enter(phase: Phase): void {
    this.phase = phase;
    if (phase === "ESCAPE") {
      this.playStartedAt = this.clock;
      this.stalkerNext = this.clock + (this.level.stalker?.firstMs ?? 0);
    }
    if (phase === "ESCALATION") this.cue("alert");
    if (phase === "FINAL") this.cue("timer_warning");
    if (phase === "RESULTS") this.scoreRound();
    this.ctx.setTimer(PHASE_MS[phase], () => this.advance());
    this.ctx.changed();
  }

  private advance(): void {
    const next = NEXT[this.phase];
    if (next) return this.enter(next);
    if (this.round >= this.settings.rounds || this.present().length < 2) return this.finish();
    this.beginRound();
  }

  // ---------------------------------------------------------------- the simulation

  private playing(): boolean {
    return (PLAY as Phase[]).includes(this.phase);
  }

  private tick(): void {
    if (this.disposed || !this.playing() || this.ctx.paused()) return;
    const dt = TIMING.tickMs / 1000 / TIMING.substeps;
    const connected = new Set(this.ctx.players().filter((p) => p.connected).map((p) => p.id));
    // Thad's tilt eases toward what the Deck says, and back to level if the Deck drops out.
    this.tiltTarget = connected.has(this.thadId) ? this.tiltTarget : 0;
    this.tilt += (this.tiltTarget - this.tilt) * 0.35;
    const pull = tiltAccel(this.tilt, MAX_TILT[this.phase as PlayPhase]);
    const arena = {
      spawn: this.level.spawn,
      exit: this.level.exit,
      platforms: this.level.platforms,
      hazards: this.level.hazards.filter((h) => hazardActive(h, this.phase as PlayPhase)).map((h) => h.rect),
      planks: this.planks,
      water: this.level.water ?? [],
      exitOpen: this.exitOpen(),
    };
    const idle: RunnerInput = { left: false, right: false, jumpSeq: 0 };
    if (this.shakeAt !== null && this.clock >= this.shakeAt) {
      this.shakeAt = null;
      for (const r of this.runners.values()) {
        const way = this.ctx.random() < 0.5 ? -1 : 1;
        jolt(r.body, way * SHAKE.push * r.knock, SHAKE.lift * r.knock);
      }
    }
    for (let s = 0; s < TIMING.substeps; s++) {
      this.clock += TIMING.tickMs / TIMING.substeps;
      for (const r of this.runners.values()) {
        const input = connected.has(r.id) ? r.input : { ...idle, jumpSeq: r.body.lastJumpSeq };
        for (const event of stepBody(r.body, input, arena, pull, dt, r.stats)) {
          if (event === "died") {
            r.deaths += 1;
            this.ctx.countStat(r.id, "deaths");
            this.cue("life_lost");
          }
          if (event === "escaped") {
            r.escapedAtMs = this.clock - this.playStartedAt;
            this.ctx.countStat(r.id, "escapes");
            this.cue("success");
          }
        }
      }
    }
    this.planks = this.planks.filter((p) => p.expiresAt > this.clock);
    this.collect();
    this.haunt();
    this.tickSeq += 1;
    // Everyone still inside is out: no reason to wait for the timer.
    const runners = [...this.runners.values()];
    if (runners.length && runners.every((r) => r.body.escaped)) return this.enter("RESULTS");
    this.ctx.changed();
  }

  // ---------------------------------------------------------------- items and the stalker

  private found(): number {
    return this.taken.filter(Boolean).length;
  }

  private exitOpen(): boolean {
    return this.found() >= this.taken.length;
  }

  /** Anyone touching an item picks it up for the team; the last one opens the exit. */
  private collect(): void {
    const items = this.level.items;
    if (!items?.length) return;
    for (const r of this.runners.values()) {
      const b = r.body;
      if (b.deadFor > 0 || b.escaped) continue;
      items.forEach((item, i) => {
        if (this.taken[i]) return;
        const [cx, cy] = item.at;
        if (b.x < cx + ITEM_REACH && b.x + PHYS.width > cx - ITEM_REACH && b.y < cy + ITEM_REACH && b.y + PHYS.height > cy - ITEM_REACH) {
          this.taken[i] = true;
          this.ctx.countStat(r.id, "parts");
          this.cue(this.exitOpen() ? "contained" : "discovery");
        }
      });
    }
  }

  /**
   * The stalker: every so often he appears near a runner, standing on whatever's there. Anyone who
   * stays within his reach long enough is taken (they respawn, like any death).
   */
  private haunt(): void {
    const cfg = this.level.stalker;
    if (!cfg) return;
    const phase = this.phase as PlayPhase;
    const alive = [...this.runners.values()].filter((r) => r.body.deadFor === 0 && !r.body.escaped);
    if (this.clock >= this.stalkerNext) {
      this.stalkerNext = this.clock + cfg.everyMs[phase] + this.ctx.random() * 800;
      const target = alive[Math.floor(this.ctx.random() * alive.length)];
      if (!target) this.stalker = null;
      else {
        const side = this.ctx.random() < 0.5 ? -1 : 1;
        let x = target.body.x + side * (200 + this.ctx.random() * 180);
        if (x < 20 || x > WORLD.width - 50) x = target.body.x - side * (200 + this.ctx.random() * 180);
        x = Math.max(20, Math.min(WORLD.width - 50, x));
        // Stand on whatever is under that spot nearest the target's height.
        const feet = target.body.y + PHYS.height;
        const under = this.level.platforms.filter((p) => x + STALKER.w / 2 >= p[0] && x + STALKER.w / 2 <= p[0] + p[2]).sort((a, b) => Math.abs(a[1] - feet) - Math.abs(b[1] - feet))[0];
        this.stalker = { x, y: (under ? under[1] : feet) - STALKER.h };
      }
    }
    const s = this.stalker;
    if (!s) return;
    const sx = s.x + STALKER.w / 2;
    const sy = s.y + STALKER.h / 2;
    for (const r of this.runners.values()) {
      const b = r.body;
      if (b.deadFor > 0 || b.escaped) {
        r.near = 0;
        continue;
      }
      const close = Math.hypot(b.x + PHYS.width / 2 - sx, b.y + PHYS.height / 2 - sy) < cfg.reach;
      r.near = close ? r.near + TIMING.tickMs : Math.max(0, r.near - TIMING.tickMs / 2);
      if (r.near >= cfg.killMs[phase] && kill(b)) {
        r.near = 0;
        r.deaths += 1;
        this.ctx.countStat(r.id, "deaths");
        this.cue("life_lost");
        // He's had his fun: gone for a moment.
        this.stalker = null;
        this.stalkerNext = this.clock + 1_200;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- scoring

  private scoreRound(): void {
    const runners = [...this.runners.values()];
    const escaped = runners.filter((r) => r.escapedAtMs !== null).sort((a, b) => a.escapedAtMs! - b.escapedAtMs!);
    const totalPlayMs = TIMING.escapeMs + TIMING.escalationMs + TIMING.finalMs;
    const add = (id: string, points: number) => {
      if (points <= 0) return;
      this.roundPoints.set(id, (this.roundPoints.get(id) ?? 0) + points);
      this.ctx.addPoints(id, points);
    };
    escaped.forEach((r, i) => {
      const secondsLeft = Math.max(0, Math.floor((totalPlayMs - r.escapedAtMs!) / 1000));
      add(r.id, POINTS.escape + secondsLeft * POINTS.perSecondLeft + (i === 0 ? POINTS.firstOut : 0));
    });
    const trapped = runners.length - escaped.length;
    const deaths = runners.reduce((n, r) => n + r.deaths, 0);
    add(this.thadId, trapped * POINTS.thadPerTrapped + Math.min(POINTS.thadDeathCap, deaths * POINTS.thadPerDeath));
    this.ctx.countStat(this.thadId, "thadRounds");
    this.records.push({
      round: this.round,
      level: this.level.id,
      thadId: this.thadId,
      escapes: escaped.map((r) => ({ playerId: r.id, ms: r.escapedAtMs! })),
      deaths: Object.fromEntries(runners.map((r) => [r.id, r.deaths])),
      planks: runners.reduce((n, r) => n + r.planks, 0),
      points: Object.fromEntries(this.roundPoints),
      cast: Object.fromEntries(runners.map((r) => [r.id, r.character])),
      shakes: this.shakes,
      found: this.found(),
      items: this.taken.length,
    });
    this.cue(escaped.length === runners.length ? "success" : escaped.length === 0 ? "major_failure" : "vote_result");
  }

  private finish(): void {
    this.stop();
    const name = (id: string) => this.ctx.playerName(id);
    const highlights: Highlight[] = [];
    const escapes = this.records.flatMap((r) => r.escapes.map((e) => ({ ...e, level: r.level })));
    const fastest = escapes.sort((a, b) => a.ms - b.ms)[0];
    if (fastest) highlights.push({ title: "Fastest escape", playerName: name(fastest.playerId), text: null, detail: `${(fastest.ms / 1000).toFixed(1)} s out of ${LEVELS.find((l) => l.id === fastest.level)?.name}` });
    const deaths = new Map<string, number>();
    for (const r of this.records) for (const [id, n] of Object.entries(r.deaths)) deaths.set(id, (deaths.get(id) ?? 0) + n);
    const clumsy = [...deaths].sort((a, b) => b[1] - a[1])[0];
    if (clumsy && clumsy[1] > 0) highlights.push({ title: "Most committed to falling", playerName: name(clumsy[0]), text: null, detail: `${clumsy[1]} deaths inside the Deck` });
    const bestThad = [...this.records].sort((a, b) => (b.points[b.thadId] ?? 0) - (a.points[a.thadId] ?? 0))[0];
    if (bestThad && (bestThad.points[bestThad.thadId] ?? 0) > 0) highlights.push({ title: "Most Thad Thad", playerName: name(bestThad.thadId), text: null, detail: `${bestThad.points[bestThad.thadId]} points for tilting` });
    this.ctx.finish({ rounds: this.round, highlights, details: { kind: "steamdeck.v1", data: { rounds: this.records } } });
  }

  // ---------------------------------------------------------------- input

  handleInput(playerId: string, action: string, payload: unknown): void {
    if (action === "stream") return this.stream(playerId, payload);
    if (action === "plank") return this.placePlank(playerId, payload);
    if (action === "shake") return this.shake(playerId);
    throw new PartyError("INVALID_ACTION");
  }

  /** Thad shakes the Deck: it rumbles for a moment, then throws everyone standing. */
  private shake(playerId: string): void {
    if (playerId !== this.thadId) throw new PartyError("NOT_ALLOWED", "Only Thad can shake the Deck.");
    if (!this.playing()) throw new PartyError("PHASE_CLOSED");
    if (this.clock < this.shakeReadyAt || this.shakeAt !== null) throw new PartyError("INVALID_ACTION", "The Deck is still settling.");
    this.shakeAt = this.clock + SHAKE.warnMs;
    this.shakeReadyAt = this.clock + SHAKE.cooldownMs;
    this.shakes += 1;
    this.ctx.changed();
  }

  /** Buttons from runners, tilt from Thad. Best-effort and frequent: bad values are ignored. */
  private stream(playerId: string, payload: unknown): void {
    if (typeof payload !== "object" || payload === null) return;
    const p = payload as Record<string, unknown>;
    if (playerId === this.thadId) {
      if (typeof p.tilt === "number" && Number.isFinite(p.tilt)) this.tiltTarget = Math.max(-1, Math.min(1, p.tilt));
      return;
    }
    const runner = this.runners.get(playerId);
    if (!runner) return;
    runner.input.left = p.l === true || p.l === 1;
    runner.input.right = p.r === true || p.r === 1;
    if (Number.isInteger(p.j) && (p.j as number) >= 0 && (p.j as number) < 1e9) runner.input.jumpSeq = p.j as number;
  }

  private placePlank(playerId: string, payload: unknown): void {
    const runner = this.runners.get(playerId);
    if (!runner) throw new PartyError("NOT_ALLOWED", "Only runners can draw planks.");
    if (!this.playing()) throw new PartyError("PHASE_CLOSED");
    if (this.clock < runner.plankCooldownUntil) throw new PartyError("INVALID_ACTION", "Your plank is still recharging.");
    let drawing: Drawing;
    try {
      drawing = deserialize(asRecord(payload).drawing, { playerId, limits: { tools: ["plank"], maxStrokes: 4, maxPointsPerStroke: 120, maxPoints: 400 } });
    } catch (err) {
      throw new PartyError("INVALID_INPUT", err instanceof DrawingError ? err.message : "That drawing didn't make sense.");
    }
    const plank = interpret(drawing, PLANK_RULES, null).at(-1);
    if (!plank) throw new PartyError("INVALID_INPUT", "Draw it sideways: a plank is flat.");
    // One plank each: a new one replaces your old one.
    this.planks = this.planks.filter((p) => p.owner !== playerId);
    this.planks.push({ ...plank, id: ++this.plankSeq, owner: playerId, expiresAt: this.clock + PLANK.lifetimeMs });
    runner.plankCooldownUntil = this.clock + PLANK.cooldownMs;
    runner.planks += 1;
    this.ctx.countStat(playerId, "planks");
    this.ctx.changed();
  }

  hostAction(action: string): void {
    if (action !== "skip") throw new PartyError("INVALID_ACTION");
    this.ctx.clearTimer();
    this.advance();
  }

  playerLeft(playerId: string): void {
    this.runners.delete(playerId);
    this.planks = this.planks.filter((p) => p.owner !== playerId);
    if (this.present().length < 2) return this.finish();
    if (playerId === this.thadId) this.tiltTarget = 0;
    this.ctx.changed();
  }

  // ---------------------------------------------------------------- views

  viewFor(viewer: Viewer): unknown {
    const playerId = viewer.kind === "player" ? viewer.playerId : null;
    const colorOf = (id: string) => COLORS[Math.max(0, this.order.indexOf(id)) % COLORS.length]!;
    const phase = this.phase;
    const hazardPhase: PlayPhase = this.playing() ? (phase as PlayPhase) : phase === "RESULTS" ? "FINAL" : "ESCAPE";
    const runners = [...this.runners.values()];
    const base = {
      session: this.session,
      phase,
      round: this.round,
      totalRounds: this.settings.rounds,
      tick: this.tickSeq,
      tickMs: TIMING.tickMs,
      level: {
        id: this.level.id,
        name: this.level.name,
        tagline: this.level.tagline,
        intro: this.level.intro,
        width: WORLD.width,
        height: WORLD.height,
        spawn: this.level.spawn,
        exit: this.level.exit,
        platforms: this.level.platforms,
        // [x, y, w, h, live, kind]
        hazards: this.level.hazards.map((h) => [...h.rect, hazardActive(h, hazardPhase) ? 1 : 0, h.kind ?? "spikes"]),
        water: this.level.water ?? [],
        // [name, x, y]
        items: (this.level.items ?? []).map((i) => [i.name, i.at[0], i.at[1]]),
        stalker: !!this.level.stalker,
      },
      world: {
        tilt: Math.round(this.tilt * 1000) / 1000,
        maxTilt: MAX_TILT[hazardPhase],
        size: [PHYS.width, PHYS.height],
        // [id, x, y, facing, state] — state 0 alive, 1 dead, 2 escaped.
        runners: runners.map((r) => [r.id, Math.round(r.body.x), Math.round(r.body.y), r.body.facing, r.body.escaped ? 2 : r.body.deadFor > 0 ? 1 : 0]),
        planks: this.planks.map((p) => [p.x1, p.x2, p.y, p.owner, Math.max(0, p.expiresAt - this.clock)]),
        // [ms until Thad can shake again, ms until a called shake lands or -1]
        shake: [Math.max(0, this.shakeReadyAt - this.clock), this.shakeAt === null ? -1 : Math.max(0, this.shakeAt - this.clock)],
        // Which items are found (1) or not (0), whether the exit is open, where the stalker stands.
        taken: this.taken.map((t) => (t ? 1 : 0)),
        exitOpen: this.exitOpen(),
        stalker: this.stalker && this.playing() ? [Math.round(this.stalker.x), Math.round(this.stalker.y), STALKER.w, STALKER.h] : null,
      },
      thad: { id: this.thadId, name: this.ctx.playerName(this.thadId), color: colorOf(this.thadId) },
      roster: runners.map((r) => ({ id: r.id, name: this.ctx.playerName(r.id), color: colorOf(r.id), character: r.character, build: r.build, deaths: r.deaths, escapedMs: r.escapedAtMs })),
      cues: this.cues.map((c) => ({ ...c })),
      results: phase === "RESULTS" ? { points: Object.fromEntries(this.roundPoints), escaped: runners.filter((r) => r.body.escaped).length, total: runners.length } : null,
      limits: { plankMin: PLANK.minLength, plankMax: PLANK.maxLength, cooldownMs: PLANK.cooldownMs, shakeCooldownMs: SHAKE.cooldownMs },
    };
    if (!playerId) return base;
    const runner = this.runners.get(playerId);
    return {
      ...base,
      you: {
        playerId,
        role: playerId === this.thadId ? "thad" : runner ? "runner" : "spectator",
        color: colorOf(playerId),
        jumpSeq: runner?.body.lastJumpSeq ?? 0,
        plankReadyMs: runner ? Math.max(0, runner.plankCooldownUntil - this.clock) : 0,
        // How close the stalker is to taking you, 0..1 (for your screen's static).
        near: runner && this.level.stalker && this.playing() ? Math.min(1, runner.near / this.level.stalker.killMs[this.phase as PlayPhase]) : 0,
      },
    };
  }

  abortDetails() {
    return { kind: "steamdeck.v1", data: { rounds: this.records, aborted: { phase: this.phase, round: this.round } } };
  }

  private stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}

export const steamDeckGame: GameDefinition<SteamDeckSettings> = {
  id: "steamdeck",
  name: "Steam My Deck",
  tagline: "You live in the Deck now. Thad is holding it.",
  description:
    "One agent is Thad and holds the Steam Deck (in spirit: keyboard, mouse or touch all work). Everyone else is trapped inside it, " +
    "dropped into a different game each round (in a random order) and has to reach its way out while Thad tilts and shakes the whole world. " +
    "Draw planks to help each other across. Thad rotates every round.",
  minPlayers: 2,
  maxPlayers: 8,
  defaultSettings: { rounds: 3 },
  /** The games on the Deck, so the lobby's "Games" choice and hint follow levels.ts. */
  catalog: { games: LEVELS.map((l) => ({ id: l.id, name: l.name })) },
  parseSettings(raw: unknown): SteamDeckSettings {
    const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    // One game per round, in a random order, never the same one twice in a match.
    const rounds = typeof input.rounds === "number" && Number.isInteger(input.rounds) ? Math.min(LEVELS.length, Math.max(1, input.rounds)) : 3;
    return { rounds };
  },
  create(ctx, settings) {
    return new SteamDeckGame(ctx, settings);
  },
};
