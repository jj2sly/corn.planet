// ANGRY THUD'S REVENGE — a cooperative slingshot game that runs inside Steam My Deck's CPI
// handheld. The team knocks down Corn Piggy fortresses to drive the Corruption Meter from 100% to
// 0% before the piggies finish building the Red Cow behind their walls.
//
// Turn: BUILD (shared kernels, 120 s, vote to skip) → ACTION (every agent launches one bird, in
// order) → PROCESS (piggies repair, lob cob bombs, the weather strikes, nests hatch) → the Red Cow
// advances every few turns (a short cutscene) → the next turn. Win: corruption 0%. Lose: the Red
// Cow reaches 100%.
//
// The server decides everything: turn order, birds, kernels, placements, the physics that matters
// (world.ts runs the real simulation, live, only while something moves), corruption, the Red Cow,
// weather, piggies, scores and the result. Screens only draw what they're sent. Tuning: config.ts.

import { BIRD_IDS, BIRDS, birdType, SKINS } from "../../../public/js/games/thud-birds.js";
import { placement } from "../../../public/js/games/thud-rules.js";
import { PartyError } from "../../errors.ts";
import { createWallet, type SharedWallet } from "../kit/economy.ts";
import { drawSchedule, forecast, unit, type WeatherEvent } from "../kit/weather.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "../types.ts";
import {
  BIRDS_MAX_HELD,
  BIRDS_START,
  BUILDINGS,
  CORRUPTION,
  ECONOMY,
  MATERIALS,
  NEST,
  PIGS,
  REPAIR,
  SCORING,
  SHIELD,
  SLINGSHOT,
  TIMING,
  WEATHER,
  WEATHER_RULES,
  WEATHER_TIERS,
  WORLD,
  type BuildingKind,
  type PigKind,
  type WeatherType,
} from "./config.ts";
import { LEVELS, levelById, type Level } from "./levels.ts";
import { buildingHeight, entityOf, ThudWorld, type Cause, type Entity, type ShotRecord } from "./world.ts";

export interface ThudSettings {
  level: string;
}

export type Phase = "SELECT" | "LAUNCH" | "BUILD" | "ACTION" | "PROCESS" | "COW" | "OVER";
type Stage = "AIM" | "FLIGHT" | "NEED_BIRD" | "BETWEEN";

export const COLORS = ["#ffd400", "#4dd4ff", "#ff5fa2", "#7dff6a", "#ff9a3d", "#b58cff", "#f4f4f4", "#ff4d4d"];

type Cue =
  | "game_start"
  | "alert"
  | "success"
  | "major_failure"
  | "discovery"
  | "contained"
  | "everyone_dies"
  | "vote_start"
  | "thud_cow"
  | "thud_weather"
  | "thud_nest"
  | "thud_donate"
  | "thud_breed"
  | "thud_victory"
  | "thud_defeat";

interface Stats {
  destruction: number;
  blocks: number;
  pigs: number;
  pigHits: number;
  chains: number;
  shots: number;
  birdsUsed: number;
  corruption: number;
  kernels: number;
  donations: number;
  received: number;
  bred: number;
  cloned: number;
  built: number;
  abilities: number;
}

interface PlayerState {
  id: string;
  bird: string;
  skin: string;
  chosen: boolean;
  ready: boolean;
  birds: string[];
  selected: number;
  vote: boolean;
  cursor: number | null;
  stats: Stats;
}

interface ProcessStep {
  id: "repair" | "attack" | "weather" | "upkeep";
  label: string;
  detail: string;
  run: () => void;
}

interface LogLine {
  id: number;
  text: string;
  kind: "info" | "ok" | "warn" | "danger";
}

const blankStats = (): Stats => ({ destruction: 0, blocks: 0, pigs: 0, pigHits: 0, chains: 0, shots: 0, birdsUsed: 0, corruption: 0, kernels: 0, donations: 0, received: 0, bred: 0, cloned: 0, built: 0, abilities: 0 });

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new PartyError("INVALID_INPUT");
  return payload as Record<string, unknown>;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const SEVERITY = ["", "LOW", "MEDIUM", "HIGH"];

/** How much odder than a straight line a shot flew (awards; no judgement involved). */
export function trajectoryScore(s: ShotRecord): number {
  const straight = Math.max(80, s.maxX - SLINGSHOT.x);
  const loopiness = s.path / straight;
  const angleOdd = Math.abs(s.angle - 38) / 45;
  return Math.round((loopiness + s.bounces * 0.6 + s.reversals * 1.2 + angleOdd + (s.power < 0.4 ? 0.6 : 0)) * 100) / 100;
}

class ThudGame implements GameInstance {
  private readonly ctx: GameContext;
  private readonly settings: ThudSettings;
  private readonly level: Level;
  private readonly order: string[];
  private readonly players = new Map<string, PlayerState>();
  private readonly wallet: SharedWallet;
  private readonly world: ThudWorld;
  private readonly seed: number;
  private readonly schedule: WeatherEvent[];
  private readonly scale: number;
  private phase: Phase = "SELECT";
  private turn = 0;
  private turnsDone = 0;
  private corruption: number = CORRUPTION.start;
  private cow = 0;
  private cowScene: { from: number; to: number } | null = null;
  private structural = 0;
  private queue: string[] = [];
  private qIndex = 0;
  private stage: Stage = "BETWEEN";
  private aim = { a: 38, p: 0.75 };
  private flightStart = 0;
  private stillSince = -1;
  private flying: { playerId: string; bird: string; skin: string } | null = null;
  private steps: ProcessStep[] = [];
  private stepIndex = 0;
  private stepReadyAt = 0;
  private stepSimStart = 0;
  private water: { level: number; turns: number } | null = null;
  private active: WeatherEvent | null = null;
  private windDir = 1;
  private result: "victory" | "defeat" | null = null;
  private shots: ShotRecord[] = [];
  private log: LogLine[] = [];
  private logSeq = 0;
  private cues: { id: number; cue: Cue }[] = [];
  private cueSeq = 0;
  private clock = 0;
  private tickSeq = 0;
  private viewSeq = 0;
  private cache: { seq: number; base: Record<string, unknown> } | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private finished = false;
  private readonly session = Math.floor(Math.random() * 2 ** 32).toString(36);
  private peakCorruptionShot: { playerId: string; amount: number; turn: number } | null = null;
  private shotCorruption = 0;

  constructor(ctx: GameContext, settings: ThudSettings) {
    this.ctx = ctx;
    this.settings = settings;
    this.level = levelById(settings.level) ?? LEVELS[0]!;
    this.order = ctx.players().map((p) => p.id);
    this.wallet = createWallet(ECONOMY.startKernels);
    this.seed = Math.floor(ctx.random() * 2 ** 31);
    const n = Math.max(1, this.order.length);
    this.scale = clamp(CORRUPTION.playerScale.reference / n, CORRUPTION.playerScale.min, CORRUPTION.playerScale.max);
    this.schedule = drawSchedule({
      random: () => ctx.random(),
      types: WEATHER,
      pool: this.level.weather.pool as Record<string, number>,
      chance: this.level.weather.chance,
      firstTurn: this.level.weather.firstTurn,
      horizon: WEATHER_RULES.horizon,
      severityWeights: WEATHER_RULES.severityWeights,
      severityRamp: WEATHER_RULES.severityRamp,
      secondaryChance: WEATHER_RULES.secondaryChance,
    });
    this.world = new ThudWorld(
      this.level,
      {
        broke: (e, cause, chained, at) => this.onBroke(e, cause, chained, at),
        killed: (kind, cause, chained, at) => this.onKilled(kind, cause, chained, at),
        pigHit: (kind, cause) => this.onPigHit(kind, cause),
        buildingLost: (state, cause) => this.say(`${BUILDINGS[state.type].name} destroyed${cause.kind === "weather" ? ` by ${WEATHER[cause.type as WeatherType]?.label ?? "weather"}` : cause.kind === "pigs" ? " by a cob bomb" : ""}`, "danger"),
        structural: (amount) => (this.structural += amount),
      },
      () => ctx.random(),
      WEATHER_TIERS,
    );
    // Everyone starts with a bird picked for them, so a quick start still works.
    this.order.forEach((id, i) => {
      const bird = BIRD_IDS[i % BIRD_IDS.length]!;
      this.players.set(id, { id, bird, skin: "classic", chosen: false, ready: false, birds: [], selected: 0, vote: false, cursor: null, stats: blankStats() });
    });
  }

  start(): void {
    this.interval = setInterval(() => this.tick(), TIMING.tickMs);
    this.interval.unref?.();
    this.cue("game_start");
    this.enter("SELECT", TIMING.selectMs);
  }

  // ---------------------------------------------------------------- bookkeeping

  private changed(): void {
    this.viewSeq += 1;
    this.ctx.changed();
  }

  private cue(cue: Cue): void {
    this.cues.push({ id: ++this.cueSeq, cue });
    this.cues.splice(0, Math.max(0, this.cues.length - 12));
  }

  private say(text: string, kind: LogLine["kind"] = "info"): void {
    this.log.push({ id: ++this.logSeq, text, kind });
    this.log.splice(0, Math.max(0, this.log.length - 10));
  }

  private present(): string[] {
    const here = new Set(this.ctx.players().map((p) => p.id));
    return this.order.filter((id) => here.has(id) && this.players.has(id));
  }

  private name(id: string): string {
    return this.ctx.playerName(id);
  }

  private player(id: string): PlayerState {
    const p = this.players.get(id);
    if (!p) throw new PartyError("NOT_ALLOWED", "You're not in this game.");
    return p;
  }

  private enter(phase: Phase, ms: number | null): void {
    this.phase = phase;
    if (ms === null) this.ctx.clearTimer();
    else this.ctx.setTimer(ms, () => this.expire());
    this.changed();
  }

  private points(id: string, n: number): void {
    if (n > 0 && this.players.has(id)) this.ctx.addPoints(id, Math.round(n));
  }

  private shooterOf(cause: Cause): PlayerState | null {
    return cause.kind === "shot" ? (this.players.get(cause.playerId) ?? null) : null;
  }

  private reduce(amount: number, cause: Cause): void {
    const before = this.corruption;
    this.corruption = clamp(this.corruption - amount, 0, 100);
    const done = before - this.corruption;
    const p = this.shooterOf(cause);
    if (p && done > 0) {
      p.stats.corruption += done;
      this.shotCorruption += done;
    }
    if (this.corruption <= 0 && !this.result) this.result = "victory";
  }

  private onBroke(e: Entity, cause: Cause, chained: boolean, at: { x: number; y: number }): void {
    if (e.team !== "pig" || !e.material) return;
    const mat = MATERIALS[e.material];
    this.reduce(mat.corruption * this.scale, cause);
    const p = this.shooterOf(cause);
    if (!p) return;
    this.wallet.earn(mat.kernels + (chained ? ECONOMY.rewards.chain : 0), `break:${e.material}`, p.id);
    p.stats.kernels += mat.kernels + (chained ? ECONOMY.rewards.chain : 0);
    p.stats.blocks += 1;
    p.stats.destruction += e.maxHp;
    if (chained) p.stats.chains += 1;
    this.points(p.id, mat.points * (chained ? 1 + SCORING.chainBonus : 1));
    if (e.material === "vault") this.say(`${this.name(p.id)} cracked a KERNEL VAULT · +${mat.kernels} kernels`, "ok");
    if (e.material === "totem") this.say(`${this.name(p.id)} toppled a Corruption Totem`, "ok");
    void at;
  }

  private onKilled(kind: PigKind, cause: Cause, chained: boolean, at: { x: number; y: number }): void {
    const spec = PIGS[kind];
    this.reduce(spec.corruption * this.scale, cause);
    const p = this.shooterOf(cause);
    const how = cause.kind === "weather" ? ` (${WEATHER[cause.type as WeatherType]?.label ?? "weather"})` : cause.kind === "pigs" ? " (friendly cob)" : "";
    this.say(`${spec.name} eliminated${p ? ` by ${this.name(p.id)}` : how}`, kind === "boss" ? "ok" : "info");
    if (kind === "boss") this.cue("contained");
    if (!p) return;
    this.wallet.earn(spec.kernels + (chained ? ECONOMY.rewards.chain : 0), `pig:${kind}`, p.id);
    p.stats.kernels += spec.kernels + (chained ? ECONOMY.rewards.chain : 0);
    p.stats.pigs += 1;
    p.stats.destruction += spec.hp;
    if (chained) p.stats.chains += 1;
    this.points(p.id, spec.points * (chained ? 1 + SCORING.chainBonus : 1));
    this.ctx.countStat(p.id, "thud:pigs");
    void at;
  }

  private onPigHit(_kind: PigKind, cause: Cause): void {
    const p = this.shooterOf(cause);
    if (!p) return;
    p.stats.pigHits += 1;
    this.wallet.earn(ECONOMY.rewards.pigHit, "pig-hit", p.id);
    p.stats.kernels += ECONOMY.rewards.pigHit;
    this.points(p.id, SCORING.pigHit);
  }

  // ---------------------------------------------------------------- phases

  private expire(): void {
    if (this.phase === "SELECT") return this.launchGame();
    if (this.phase === "LAUNCH") return this.startTurn();
    if (this.phase === "BUILD") return this.startAction();
    if (this.phase === "ACTION") {
      if (this.stage === "AIM") {
        this.say(`${this.name(this.queue[this.qIndex]!)} hesitated. The bird went back in the box.`, "warn");
        return this.nextShooter(1);
      }
      if (this.stage === "NEED_BIRD") {
        this.say(`Nobody gave ${this.name(this.queue[this.qIndex]!)} a bird. Skipped.`, "warn");
        return this.nextShooter(1);
      }
      if (this.stage === "BETWEEN") return this.nextShooter(1);
      return;
    }
    if (this.phase === "COW") return this.afterCow();
    if (this.phase === "OVER") return this.finish();
  }

  private launchGame(): void {
    // Anyone who didn't choose keeps the bird they were given.
    for (const p of this.players.values()) {
      p.birds = Array.from({ length: BIRDS_START }, () => p.bird);
      p.selected = 0;
    }
    this.cue("vote_start");
    this.enter("LAUNCH", TIMING.launchMs);
  }

  private startTurn(): void {
    this.turn += 1;
    for (const p of this.players.values()) p.vote = false;
    for (const b of this.world.buildings()) {
      const s = entityOf(b).building!;
      s.breeders = [];
      s.breeds = 0;
      if (s.type === "shield") s.charge = SHIELD.chargePerTurn;
    }
    this.say(`Turn ${this.turn}: build phase`, "info");
    this.enter("BUILD", TIMING.buildMs);
  }

  private startAction(): void {
    this.active = this.schedule.find((e) => e.turn === this.turn) ?? null;
    this.windDir = unit(this.seed, this.turn, 7) < 0.5 ? -1 : 1;
    const effects = this.actionWeather();
    this.world.world.wind = effects.wind;
    this.world.setFriction(effects.slippery);
    if (this.active) {
      this.cue("thud_weather");
      this.say(`WEATHER: ${WEATHER[this.active.type as WeatherType].label.toUpperCase()} · ${SEVERITY[this.active.severity]}${this.active.secondary ? ` + ${WEATHER[this.active.secondary as WeatherType].label}` : ""}`, "warn");
    }
    this.queue = this.present();
    this.qIndex = -1;
    this.phase = "ACTION";
    this.nextShooter(1);
  }

  /** What the weather does to this action phase (the event and its secondary). */
  private actionWeather(): { wind: number; slippery: number; fogFrom: number | null; dark: number; obscure: number } {
    const out = { wind: 0, slippery: 1, fogFrom: null as number | null, dark: 0, obscure: 0 };
    const e = this.active;
    if (!e) return out;
    const sev = Math.max(1, e.severity - (this.machine()?.mitigation ?? 0));
    for (const type of [e.type, e.secondary].filter(Boolean) as WeatherType[]) {
      const a = (WEATHER[type] as { action?: Record<string, readonly number[]> }).action;
      if (!a) continue;
      const i = sev - 1;
      if (a.wind) out.wind += this.windDir * a.wind[i]! * (type === e.type ? 1 : 0.6);
      if (a.slippery) out.slippery = Math.min(out.slippery, a.slippery[i]!);
      if (a.fogFrom) out.fogFrom = a.fogFrom[i]!;
      if (a.dark) out.dark = Math.max(out.dark, a.dark[i]!);
      if (a.obscure) out.obscure = Math.max(out.obscure, a.obscure[i]!);
    }
    out.wind = Math.round(out.wind);
    return out;
  }

  private nextShooter(step: number): void {
    this.qIndex += step;
    this.flying = null;
    const here = new Set(this.present());
    while (this.qIndex < this.queue.length && !here.has(this.queue[this.qIndex]!)) this.qIndex += 1;
    if (this.qIndex >= this.queue.length) return this.startProcess();
    const p = this.players.get(this.queue[this.qIndex]!)!;
    if (p.birds.length) return this.beginAim(p);
    const donors = [...this.players.values()].filter((o) => o.id !== p.id && here.has(o.id) && o.birds.length > 0);
    if (!donors.length) {
      this.say(`${this.name(p.id)} has no birds and nobody can spare one. Skipped.`, "warn");
      return this.nextShooter(1);
    }
    this.stage = "NEED_BIRD";
    this.say(`${this.name(p.id)} NEEDS A BIRD. Donate one!`, "warn");
    this.cue("alert");
    this.enter("ACTION", TIMING.needBirdMs);
  }

  private beginAim(p: PlayerState): void {
    this.stage = "AIM";
    p.selected = clamp(p.selected, 0, p.birds.length - 1);
    this.aim = { a: 38, p: 0.75 };
    this.enter("ACTION", TIMING.aimMs);
  }

  private shooter(): PlayerState | null {
    if (this.phase !== "ACTION") return null;
    const id = this.queue[this.qIndex];
    return id ? (this.players.get(id) ?? null) : null;
  }

  private launch(p: PlayerState, angle: number, power: number): void {
    const bird = p.birds.splice(p.selected, 1)[0]!;
    p.selected = clamp(p.selected, 0, Math.max(0, p.birds.length - 1));
    p.stats.shots += 1;
    p.stats.birdsUsed += 1;
    this.ctx.countStat(p.id, "thud:shots");
    this.world.launch(p.id, bird, p.skin, angle, power);
    this.flying = { playerId: p.id, bird, skin: p.skin };
    this.stage = "FLIGHT";
    this.flightStart = this.clock;
    this.stillSince = -1;
    this.shotCorruption = 0;
    this.ctx.clearTimer();
    this.changed();
  }

  private endFlight(): void {
    const s = this.world.endShot();
    this.world.world.wind = this.actionWeather().wind;
    if (s) {
      this.shots.push(s);
      const p = this.players.get(s.playerId);
      if (p) {
        if (s.kills >= 3) {
          this.points(p.id, SCORING.multikill);
          this.wallet.earn(ECONOMY.rewards.multikill, "multikill", p.id);
          this.say(`MULTI-KILL! ${this.name(p.id)} got ${s.kills} piggies in one shot`, "ok");
        }
        if (s.kills > 0 && s.firstKillDistance > SCORING.longShotDistance) this.points(p.id, SCORING.longShot);
        if (s.kills > 0 && s.bounces > 0) this.points(p.id, SCORING.bounceKill * Math.min(3, s.bounces));
        if (s.abilityUsed) p.stats.abilities += 1;
        if (s.abilityUsed && s.abilityHit) this.points(p.id, SCORING.abilityHit);
        if (!this.peakCorruptionShot || this.shotCorruption > this.peakCorruptionShot.amount) this.peakCorruptionShot = { playerId: p.id, amount: this.shotCorruption, turn: this.turn };
        const bits = [s.kills ? `${s.kills} piggy${s.kills === 1 ? "" : "s"}` : null, s.broke ? `${s.broke} block${s.broke === 1 ? "" : "s"}` : null].filter(Boolean);
        this.say(`${this.name(p.id)}: ${bits.length ? bits.join(", ") : "missed everything, confidently"}`, s.kills ? "ok" : "info");
        if (s.kills) this.cue("success");
      }
    }
    if (this.result === "victory") return this.gameOver();
    this.stage = "BETWEEN";
    this.enter("ACTION", 900);
  }

  // ---------------------------------------------------------------- piggies and weather, after the turn

  private startProcess(): void {
    this.world.world.wind = 0;
    this.world.setFriction(1);
    this.stage = "BETWEEN";
    const e = this.active;
    const strike = e && (WEATHER[e.type as WeatherType] as { strike?: object }).strike;
    this.steps = [
      { id: "repair", label: "PIGGIES REPAIR", detail: "", run: () => this.repairStep() },
      { id: "attack", label: "PIGGIES ATTACK", detail: "", run: () => this.attackStep() },
      ...(strike ? [{ id: "weather" as const, label: `${WEATHER[e!.type as WeatherType].label.toUpperCase()} STRIKES`, detail: "", run: () => this.weatherStep(e!) }] : []),
      { id: "upkeep", label: "END OF TURN", detail: "", run: () => this.upkeepStep() },
    ];
    this.stepIndex = -1;
    this.phase = "PROCESS";
    this.ctx.clearTimer();
    this.nextStep();
  }

  private nextStep(): void {
    this.stepIndex += 1;
    if (this.result === "victory") return this.gameOver();
    const step = this.steps[this.stepIndex];
    if (!step) return this.endTurn();
    step.run();
    this.stepReadyAt = this.clock + TIMING.stepMs;
    this.stepSimStart = this.clock;
    this.changed();
  }

  private repairStep(): void {
    const step = this.steps[this.stepIndex]!;
    const builders = this.world.pigs().filter((b) => entityOf(b).pig === "builder").length;
    const pct = Math.min(REPAIR.max, REPAIR.pct + builders * PIGS.builder.repairBonus);
    const budget = this.structural * pct;
    this.structural = 0;
    const r = this.world.repair(budget);
    for (const e of r.restoredBlocks) if (e.material) this.corruption = clamp(this.corruption + MATERIALS[e.material].corruption * this.scale, 0, 100);
    const reinforced = builders ? this.world.reinforce(builders * PIGS.builder.reinforce) : 0;
    step.detail = budget < 1 ? "Nothing to fix. The piggies look smug." : `${Math.round(pct * 100)}% of the damage: rebuilt ${r.rebuilt} block${r.rebuilt === 1 ? "" : "s"}, patched ${r.healed} hp${reinforced ? `, reinforced ${reinforced}` : ""}`;
    if (r.rebuilt) this.say(`Piggies rebuilt ${r.rebuilt} block${r.rebuilt === 1 ? "" : "s"}`, "warn");
  }

  private attackStep(): void {
    const step = this.steps[this.stepIndex]!;
    const targets = this.world.buildings().filter((b) => !entityOf(b).building!.broken);
    const lobbers = this.world.pigs().flatMap((b) => Array.from({ length: PIGS[entityOf(b).pig!].lobs }, () => b));
    const a = this.level.attack;
    const count = Math.min(lobbers.length, a.max, a.base + Math.floor((this.turn - 1) / a.growEvery));
    if (!targets.length || !count) {
      step.detail = targets.length ? "No piggy is in a throwing mood." : "Nothing of yours to hit. They throw insults instead.";
      return;
    }
    this.world.cause = { kind: "pigs" };
    const weight = (b: ReturnType<ThudWorld["buildings"]>[number]) => ({ nest: 3, weather: 3, clone: 2, shield: 1.5, wall: 0.6, barricade: 0.6 })[entityOf(b).building!.type] ?? 1;
    for (let i = 0; i < count; i++) {
      const from = lobbers[Math.floor(this.ctx.random() * lobbers.length)]!;
      const total = targets.reduce((n, b) => n + weight(b), 0);
      let r = this.ctx.random() * total;
      const target = targets.find((b) => (r -= weight(b)) < 0) ?? targets[0]!;
      this.world.lob(from, target.x, target.y - 10);
    }
    step.detail = `${count} cob bomb${count === 1 ? "" : "s"} incoming`;
    this.cue("alert");
  }

  private weatherStep(e: WeatherEvent): void {
    const step = this.steps[this.stepIndex]!;
    const type = e.type as WeatherType;
    const sev = Math.max(1, e.severity - (this.machine()?.mitigation ?? 0));
    const i = sev - 1;
    const s = (WEATHER[type] as { strike?: Record<string, readonly number[] | number> }).strike ?? {};
    const at = (key: string) => {
      const v = s[key];
      return Array.isArray(v) ? (v[i] as number) : (v as number);
    };
    this.world.cause = { kind: "weather", type };
    const buildings = this.world.buildings();
    const exposed = (list: ReturnType<ThudWorld["buildings"]>) => list.filter((b) => this.world.exposed(b));
    const pick = <T>(list: T[], w: (t: T) => number): T | null => {
      const total = list.reduce((n, t) => n + w(t), 0);
      if (!list.length || total <= 0) return null;
      let r = this.ctx.random() * total;
      return list.find((t) => (r -= w(t)) < 0) ?? list[0]!;
    };
    this.cue("thud_weather");
    switch (type) {
      case "tornado": {
        const onUs = this.ctx.random() < 0.6;
        const x = onUs ? 80 + this.ctx.random() * 700 : 1180 + this.ctx.random() * 950;
        this.world.tornado(x, at("radius"), at("lift"), at("damage"), 1.3);
        step.detail = onUs ? "Touching down on OUR side" : "Touching down on the fortress (thanks, tornado)";
        break;
      }
      case "acid_rain": {
        const hit = exposed(buildings);
        for (const b of hit) this.world.damage(b, at("damage"), this.world.cause, false);
        step.detail = hit.length ? `${hit.length} exposed building${hit.length === 1 ? "" : "s"} sizzling` : "Nothing exposed. Good roofing.";
        break;
      }
      case "heavy_rain": {
        let n = 0;
        for (const b of [...this.world.fortressBlocks(), ...buildings]) {
          const m = entityOf(b).material;
          if (m === "wood" || m === "corn" || m === "nest") {
            this.world.damage(b, at("soak"), this.world.cause, false);
            n += 1;
          }
        }
        step.detail = `${n} wooden things soaked and weakened`;
        break;
      }
      case "hailstorm": {
        const all = [...this.world.fortressBlocks(), ...buildings].filter((b) => this.world.exposed(b));
        const hits = at("hits");
        for (let k = 0; k < hits && all.length; k++) {
          const b = all[Math.floor(this.ctx.random() * all.length)]!;
          if (b.removed) continue;
          this.world.damage(b, at("damage") * (entityOf(b).material === "glass" ? 2 : 1), this.world.cause, false);
          this.world.fx("hail", b.x, b.y);
        }
        step.detail = `${hits} hailstones, everyone's roofs`;
        break;
      }
      case "flood": {
        this.water = { level: WORLD.groundY - at("level"), turns: (s.turns as number) ?? 2 };
        this.world.setWater(this.water.level);
        step.detail = `Water up ${at("level")} units for ${this.water.turns} turns. Nests below it are waterlogged.`;
        break;
      }
      case "lightning_storm":
      case "thunderstorm": {
        const bolts = at("bolts");
        const struck: string[] = [];
        for (let k = 0; k < bolts; k++) {
          const candidates = [...this.world.buildings(), ...this.world.fortressBlocks()];
          const target = pick(candidates, (b) => {
            const bs = entityOf(b).building;
            if (!bs) return 0.5;
            return bs.type === "weather" ? 4 : 2;
          });
          if (!target) break;
          const bs = entityOf(target).building;
          this.world.bolt(target, at("damage"));
          if (bs && !target.removed) {
            bs.disabled = Math.max(bs.disabled, (s.disableTurns as number) ?? 1);
            struck.push(BUILDINGS[bs.type].name);
          }
        }
        step.detail = struck.length ? `Struck: ${struck.join(", ")} (offline for a turn)` : "Lightning hit the fortress. Nice.";
        break;
      }
      case "heat_wave": {
        let melted = 0;
        for (const b of [...this.world.fortressBlocks()]) {
          const e2 = entityOf(b);
          if (e2.material === "ice") {
            this.world.damage(b, e2.maxHp * at("melt"), this.world.cause, false);
            melted += 1;
          } else if ((e2.material === "wood" || e2.material === "corn") && this.world.exposed(b)) this.world.damage(b, at("wither"), this.world.cause, false);
        }
        for (const b of exposed(buildings)) if (entityOf(b).material === "wood" || entityOf(b).material === "nest") this.world.damage(b, at("wither"), this.world.cause, false);
        if (this.water) {
          this.water = null;
          this.world.setWater(null);
        }
        step.detail = `${melted ? `${melted} ice block${melted === 1 ? "" : "s"} melting, ` : ""}wood withering, any flood evaporating`;
        break;
      }
      case "earthquake":
        this.world.earthquake(at("seconds"), at("shove"));
        step.detail = "Everything is shaking. Everything.";
        break;
      default:
        step.detail = "";
    }
  }

  private upkeepStep(): void {
    const step = this.steps[this.stepIndex]!;
    const notes: string[] = [];
    this.world.cause = { kind: "none" };
    // Corruptors corrupt.
    const corruptors = this.world.pigs().filter((b) => entityOf(b).pig === "corruptor").length;
    if (corruptors) {
      this.corruption = clamp(this.corruption + corruptors * PIGS.corruptor.perTurn, 0, 100);
      notes.push(`Corruptors +${(corruptors * PIGS.corruptor.perTurn).toFixed(1)}%`);
    }
    // Flood water drowns what's under it, then recedes.
    if (this.water) {
      for (const b of this.world.pigs()) if (b.y - PIGS[entityOf(b).pig!].r > this.water.level) this.world.damage(b, 12, { kind: "weather", type: "flood" }, false);
      for (const b of this.world.buildings()) entityOf(b).building!.waterlogged = b.y > this.water.level;
      this.water.turns -= 1;
      if (this.water.turns <= 0) {
        this.water = null;
        this.world.setWater(null);
        for (const b of this.world.buildings()) entityOf(b).building!.waterlogged = false;
        notes.push("The flood recedes");
      }
    }
    // THUD summons, reinforcements parachute in.
    const pigs = this.world.pigs();
    const r = this.level.reinforce;
    let spawn = 0;
    if (pigs.some((b) => entityOf(b).pig === "boss")) spawn += PIGS.boss.summons;
    if (pigs.length < r.minAlive || (this.turn % r.everyTurns === 0 && pigs.length < r.maxAlive)) spawn += 1;
    spawn = Math.min(spawn, r.maxAlive - pigs.length);
    let arrived = 0;
    for (let k = 0; k < spawn; k++) {
      const kind = r.kinds[(this.turn + k) % r.kinds.length]!;
      const x = r.drops[Math.floor(this.ctx.random() * r.drops.length)]!;
      const y = this.dropHeight(x, PIGS[kind].r);
      if (y === null) continue;
      this.world.addPig(kind, x, y, false, true);
      this.world.fx("drop", x, y, kind);
      arrived += PIGS[kind].corruption * this.scale * CORRUPTION.reinforcementShare;
    }
    if (arrived > 0) this.corruption = clamp(this.corruption + arrived, 0, 100);
    if (spawn > 0) notes.push(`${spawn} piggy reinforcement${spawn === 1 ? "" : "s"} parachuting in (+${arrived.toFixed(1)}% corruption)`);
    // Nests hatch.
    if (NEST.production.mode === "turn") {
      for (const b of this.world.buildings()) {
        const s = entityOf(b).building!;
        if (s.type !== "nest") continue;
        if (s.disabled > 0 || s.waterlogged) continue;
        s.progress += NEST.production.perTurn;
      }
    }
    const hatched = this.hatch();
    if (hatched) notes.push(`${hatched} bird${hatched === 1 ? "" : "s"} hatched`);
    // Lightning wears off.
    for (const b of this.world.buildings()) {
      const s = entityOf(b).building!;
      if (s.disabled > 0) s.disabled -= 1;
    }
    step.detail = notes.join(" · ") || "The piggies regroup.";
  }

  /** Where a parachuting piggy lands: high above the drop point (it falls onto whatever's there). */
  private dropHeight(x: number, r: number): number | null {
    for (let y = 380; y < WORLD.groundY - r; y += 20) if (this.world.clear(x, y, r * 2 + 4, r * 2 + 4)) return y;
    return null;
  }

  /** Nests with a whole bird ready give it to whoever has the fewest. */
  private hatch(): number {
    let n = 0;
    for (const b of this.world.buildings()) {
      const s = entityOf(b).building!;
      if (s.type !== "nest") continue;
      while (s.progress >= 1) {
        s.progress -= 1;
        const to = this.neediest();
        if (!to) break;
        to.birds.push(to.bird);
        n += 1;
        this.world.fx("hatch", b.x, b.y - 30, to.bird);
        this.say(`NEST HATCHED: a ${birdType(to.bird)?.name ?? "bird"} for ${this.name(to.id)}`, "ok");
        this.cue("thud_nest");
      }
    }
    return n;
  }

  private neediest(): PlayerState | null {
    const here = this.present().map((id) => this.players.get(id)!).filter((p) => p.birds.length < BIRDS_MAX_HELD);
    return here.sort((a, b) => a.birds.length - b.birds.length)[0] ?? null;
  }

  private endTurn(): void {
    this.turnsDone += 1;
    this.world.cause = { kind: "none" };
    if (this.turnsDone % this.level.cow.everyTurns === 0) {
      const from = this.cow;
      this.cow = Math.min(1, Math.round((this.cow + this.level.cow.step) * 1000) / 1000);
      this.cowScene = { from, to: this.cow };
      this.say(`RED COW CONSTRUCTION: ${Math.round(from * 100)}% → ${Math.round(this.cow * 100)}%`, "danger");
      this.cue("thud_cow");
      return this.enter("COW", TIMING.cowMs);
    }
    this.startTurn();
  }

  private afterCow(): void {
    this.cowScene = null;
    if (this.cow >= 1) {
      this.result = "defeat";
      return this.gameOver();
    }
    this.startTurn();
  }

  private gameOver(): void {
    this.world.freeze();
    this.world.endShot();
    this.stage = "BETWEEN";
    this.cue(this.result === "victory" ? "thud_victory" : "thud_defeat");
    this.say(this.result === "victory" ? "TEAM VICTORY: corruption purged" : "TEAM DEFEAT: the Red Cow is complete", this.result === "victory" ? "ok" : "danger");
    this.enter("OVER", TIMING.overMs);
  }

  // ---------------------------------------------------------------- the simulation

  private tick(): void {
    if (this.disposed || this.ctx.paused()) return;
    const flying = this.phase === "ACTION" && this.stage === "FLIGHT";
    const processing = this.phase === "PROCESS";
    if (NEST.production.mode === "time" && (this.phase === "BUILD" || this.phase === "ACTION")) {
      for (const b of this.world.buildings()) {
        const s = entityOf(b).building!;
        if (s.type === "nest" && !s.disabled && !s.waterlogged) s.progress += TIMING.tickMs / NEST.production.everyMs;
      }
      if (this.hatch()) this.changed();
    }
    if (!flying && !processing) return;
    this.clock += TIMING.tickMs;
    const busy = this.world.busy();
    if (busy) this.world.advance(TIMING.tickMs / 1000);
    this.tickSeq += 1;
    if (flying) {
      const still = !this.world.busy();
      if (still && this.stillSince < 0) this.stillSince = this.clock;
      if (!still) this.stillSince = -1;
      if ((still && this.clock - this.stillSince >= 250) || this.clock - this.flightStart >= TIMING.flightMaxMs) {
        if (this.clock - this.flightStart >= TIMING.flightMaxMs) this.world.freeze();
        this.endFlight();
        return;
      }
    } else {
      if (busy && this.clock - this.stepSimStart >= TIMING.stepSimMaxMs) this.world.freeze();
      if (!this.world.busy() && this.clock >= this.stepReadyAt) {
        this.nextStep();
        return;
      }
    }
    if (busy || this.tickSeq % 4 === 0) this.changed();
  }

  // ---------------------------------------------------------------- input

  handleInput(playerId: string, action: string, payload: unknown): void {
    if (action === "stream") return this.stream(playerId, payload);
    const p = this.player(playerId);
    switch (action) {
      case "choose":
        return this.choose(p, asRecord(payload));
      case "ready":
        return this.ready(p, asRecord(payload));
      case "select":
        return this.select(p, asRecord(payload));
      case "launch":
        return this.launchInput(p, asRecord(payload));
      case "ability":
        return this.abilityInput(p);
      case "build":
        return this.buildInput(p, asRecord(payload));
      case "upgrade_weather":
        return this.upgradeWeather(p);
      case "repair_weather":
        return this.repairWeather(p);
      case "buy_bird":
        return this.buyBird(p);
      case "donate":
        return this.donate(p, asRecord(payload));
      case "breed":
        return this.breed(p, asRecord(payload));
      case "clone":
        return this.clone(p, asRecord(payload));
      case "vote_skip":
        return this.voteSkip(p, asRecord(payload));
      default:
        throw new PartyError("INVALID_ACTION");
    }
  }

  /** Frequent, fire-and-forget: the shooter's aim and steering, a builder's cursor. Bad values are ignored. */
  private stream(playerId: string, payload: unknown): void {
    if (typeof payload !== "object" || payload === null) return;
    const s = payload as Record<string, unknown>;
    const p = this.players.get(playerId);
    if (!p) return;
    if (this.phase === "BUILD" && typeof s.bx === "number" && Number.isFinite(s.bx)) {
      p.cursor = clamp(Math.round(s.bx), 0, WORLD.width);
      this.changed();
      return;
    }
    if (this.shooter() !== p) return;
    if (this.stage === "AIM" && (typeof s.a === "number" || typeof s.p === "number")) {
      this.aim = { a: clamp(num(s.a, this.aim.a), SLINGSHOT.minAngle, SLINGSHOT.maxAngle), p: clamp(num(s.p, this.aim.p), SLINGSHOT.minPower, 1) };
      this.changed();
    } else if (this.stage === "FLIGHT" && typeof s.s === "number") this.world.steer(s.s);
  }

  private choose(p: PlayerState, body: Record<string, unknown>): void {
    if (this.phase !== "SELECT") throw new PartyError("PHASE_CLOSED");
    if (typeof body.bird === "string") {
      if (!BIRD_IDS.includes(body.bird)) throw new PartyError("INVALID_INPUT", "That bird doesn't exist.");
      p.bird = body.bird;
      p.chosen = true;
    }
    if (typeof body.skin === "string") {
      if (!SKINS.some((s) => s.id === body.skin)) throw new PartyError("INVALID_INPUT", "That skin doesn't exist.");
      p.skin = body.skin;
    }
    this.changed();
  }

  private ready(p: PlayerState, body: Record<string, unknown>): void {
    if (this.phase !== "SELECT") throw new PartyError("PHASE_CLOSED");
    p.ready = body.ready !== false;
    p.chosen = true;
    const everyone = this.present().every((id) => this.players.get(id)!.ready);
    if (everyone) return this.launchGame();
    this.changed();
  }

  private select(p: PlayerState, body: Record<string, unknown>): void {
    const i = body.index;
    if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= p.birds.length) throw new PartyError("INVALID_INPUT");
    if (this.shooter() === p && this.stage === "FLIGHT") throw new PartyError("PHASE_CLOSED");
    p.selected = i as number;
    this.changed();
  }

  private launchInput(p: PlayerState, body: Record<string, unknown>): void {
    if (this.shooter() !== p) throw new PartyError("NOT_ALLOWED", "It's not your shot.");
    if (this.stage !== "AIM") throw new PartyError("PHASE_CLOSED");
    if (!p.birds.length) throw new PartyError("INVALID_ACTION", "You have no birds.");
    const angle = clamp(num(body.angle, this.aim.a), SLINGSHOT.minAngle, SLINGSHOT.maxAngle);
    const power = clamp(num(body.power, this.aim.p), SLINGSHOT.minPower, 1);
    this.aim = { a: angle, p: power };
    this.launch(p, angle, power);
  }

  private abilityInput(p: PlayerState): void {
    if (this.shooter() !== p || this.stage !== "FLIGHT") throw new PartyError("PHASE_CLOSED");
    if (!this.world.ability()) throw new PartyError("INVALID_ACTION", "Nothing left to do. Enjoy the flight.");
    this.changed();
  }

  private building(): boolean {
    return this.phase === "BUILD";
  }

  private buildInput(p: PlayerState, body: Record<string, unknown>): void {
    if (!this.building()) throw new PartyError("PHASE_CLOSED", "You can only build during the build phase.");
    const type = body.type as BuildingKind;
    if (typeof type !== "string" || !(type in BUILDINGS)) throw new PartyError("INVALID_INPUT", "That isn't a building.");
    const def = BUILDINGS[type];
    const x = num(body.x, NaN);
    if (!Number.isFinite(x)) throw new PartyError("INVALID_INPUT");
    const existing = this.world.buildings().filter((b) => entityOf(b).building!.type === type).length;
    if (existing >= def.max) throw new PartyError("INVALID_ACTION", `The team already has the most ${def.name}s allowed (${def.max}).`);
    const h = buildingHeight(type, 1, WEATHER_TIERS);
    const spot = placement({ x, w: def.w, h }, { zones: this.level.zones, groundY: WORLD.groundY, clear: (cx, cy, w2, h2) => this.world.clear(cx, cy, w2, h2) });
    if (!spot.ok) throw new PartyError("INVALID_ACTION", spot.reason);
    if (!this.wallet.spend(def.cost, `build:${type}`, p.id)) throw new PartyError("INSUFFICIENT_KERNELS", `${def.name} costs ${def.cost} kernels.`);
    this.world.placeBuilding(type, spot.x, p.id);
    p.stats.built += 1;
    this.points(p.id, SCORING.build);
    this.ctx.countStat(p.id, "thud:built");
    this.say(`${this.name(p.id)} built a ${def.name} (−${def.cost})`, "info");
    this.changed();
  }

  private machineBody() {
    return this.world.buildings().find((b) => entityOf(b).building!.type === "weather") ?? null;
  }

  private machine(): (typeof WEATHER_TIERS)[number] | null {
    const b = this.machineBody();
    return b ? (WEATHER_TIERS[entityOf(b).building!.tier - 1] ?? null) : null;
  }

  private upgradeWeather(p: PlayerState): void {
    if (!this.building()) throw new PartyError("PHASE_CLOSED");
    const body = this.machineBody();
    if (!body) throw new PartyError("INVALID_ACTION", "Build a Weather Machine first.");
    const s = entityOf(body).building!;
    if (s.broken) throw new PartyError("INVALID_ACTION", "Repair it first.");
    const next = WEATHER_TIERS[s.tier];
    if (!next) throw new PartyError("INVALID_ACTION", "It's already the best forecasting money can buy.");
    if (!this.wallet.spend(next.price, `upgrade:weather:${next.tier}`, p.id)) throw new PartyError("INSUFFICIENT_KERNELS", `The ${next.name} costs ${next.price} kernels.`);
    this.world.upgradeWeather(body, next.tier, next.hp);
    this.say(`${this.name(p.id)} upgraded the Weather Machine: ${next.name}`, "ok");
    this.changed();
  }

  private repairWeather(p: PlayerState): void {
    if (!this.building()) throw new PartyError("PHASE_CLOSED");
    const body = this.machineBody();
    if (!body || !entityOf(body).building!.broken) throw new PartyError("INVALID_ACTION", "Nothing to repair.");
    const e = entityOf(body);
    const tier = WEATHER_TIERS[e.building!.tier - 1]!;
    const cost = Math.round(tier.price * ECONOMY.weatherRepairShare);
    if (!this.wallet.spend(cost, "repair:weather", p.id)) throw new PartyError("INSUFFICIENT_KERNELS", `Repairs cost ${cost} kernels.`);
    e.building!.broken = false;
    e.hp = e.maxHp;
    this.world.fx("heal", body.x, body.y, "weather");
    this.say(`${this.name(p.id)} repaired the Weather Machine (−${cost})`, "ok");
    this.changed();
  }

  private buyBird(p: PlayerState): void {
    if (!this.building()) throw new PartyError("PHASE_CLOSED");
    if (p.birds.length >= BIRDS_MAX_HELD) throw new PartyError("INVALID_ACTION", "Your hands are full of birds.");
    if (!this.wallet.spend(ECONOMY.birdCrate, "bird-crate", p.id)) throw new PartyError("INSUFFICIENT_KERNELS", `A bird crate costs ${ECONOMY.birdCrate} kernels.`);
    p.birds.push(p.bird);
    this.say(`${this.name(p.id)} bought a ${birdType(p.bird)?.name} crate (−${ECONOMY.birdCrate})`, "info");
    this.changed();
  }

  private donate(p: PlayerState, body: Record<string, unknown>): void {
    if (this.phase !== "BUILD" && this.phase !== "ACTION") throw new PartyError("PHASE_CLOSED");
    const to = this.players.get(String(body.to));
    if (!to || to === p || !this.present().includes(to.id)) throw new PartyError("INVALID_INPUT", "Donate to another agent.");
    if (to.birds.length > 0) throw new PartyError("INVALID_ACTION", `${this.name(to.id)} still has birds.`);
    if (!p.birds.length) throw new PartyError("INVALID_ACTION", "You have no birds to give.");
    if (this.shooter() === p && this.stage === "FLIGHT") throw new PartyError("PHASE_CLOSED");
    const index = Number.isInteger(body.index) && (body.index as number) >= 0 && (body.index as number) < p.birds.length ? (body.index as number) : p.selected;
    const bird = p.birds.splice(index, 1)[0]!;
    p.selected = clamp(p.selected, 0, Math.max(0, p.birds.length - 1));
    to.birds.push(bird);
    to.selected = 0;
    p.stats.donations += 1;
    to.stats.received += 1;
    this.points(p.id, SCORING.donation);
    this.ctx.countStat(p.id, "thud:donations");
    this.say(`DONATION: ${this.name(p.id)} gave ${this.name(to.id)} a ${birdType(bird)?.name ?? "bird"} · ${this.name(p.id)} ${p.birds.length} left · ${this.name(to.id)} ${to.birds.length}`, "ok");
    this.cue("thud_donate");
    if (this.shooter() === to && this.stage === "NEED_BIRD") return this.beginAim(to);
    this.changed();
  }

  private breed(p: PlayerState, body: Record<string, unknown>): void {
    if (!this.building()) throw new PartyError("PHASE_CLOSED", "Breeding happens in the build phase.");
    const nest = this.world.buildings().find((b) => b.id === body.nest && entityOf(b).building!.type === "nest");
    if (!nest) throw new PartyError("INVALID_INPUT", "That isn't a nest.");
    const s = entityOf(nest).building!;
    if (s.disabled > 0 || s.waterlogged) throw new PartyError("INVALID_ACTION", "That nest is out of action this turn.");
    if (s.breeds >= NEST.breedsPerBuild) throw new PartyError("INVALID_ACTION", "That nest has already bred this turn.");
    if (s.breeders.includes(p.id)) {
      s.breeders = s.breeders.filter((id) => id !== p.id);
      return this.changed();
    }
    if (!s.breeders.length) {
      s.breeders = [p.id];
      p.cursor = Math.round(nest.x);
      this.say(`${this.name(p.id)} is waiting at a nest. One more agent to breed!`, "info");
      return this.changed();
    }
    if (!this.wallet.spend(ECONOMY.breed, "breed", p.id)) throw new PartyError("INSUFFICIENT_KERNELS", `Breeding costs ${ECONOMY.breed} kernels.`);
    const pair = [this.players.get(s.breeders[0]!)!, p];
    s.breeders = [];
    s.breeds += 1;
    p.cursor = Math.round(nest.x);
    const to = pair.filter((q) => q.birds.length < BIRDS_MAX_HELD).sort((a, b) => a.birds.length - b.birds.length)[0];
    if (to) {
      to.birds.push(to.bird);
      this.world.fx("hatch", nest.x, nest.y - 30, to.bird);
    }
    for (const q of pair) {
      q.stats.bred += 1;
      this.points(q.id, SCORING.breed);
    }
    this.say(`BRED: ${this.name(pair[0]!.id)} + ${this.name(p.id)} → a ${birdType(to?.bird ?? p.bird)?.name} for ${this.name((to ?? p).id)}`, "ok");
    this.cue("thud_breed");
    this.changed();
  }

  private clone(p: PlayerState, body: Record<string, unknown>): void {
    if (!this.building()) throw new PartyError("PHASE_CLOSED");
    const tank = this.world.buildings().find((b) => b.id === body.tank && entityOf(b).building!.type === "clone");
    if (!tank) throw new PartyError("INVALID_INPUT", "That isn't a clone tank.");
    if (entityOf(tank).building!.disabled > 0) throw new PartyError("INVALID_ACTION", "That tank is offline this turn.");
    if (!p.birds.length) throw new PartyError("INVALID_ACTION", "Nothing to clone: you have no birds.");
    if (p.birds.length >= BIRDS_MAX_HELD) throw new PartyError("INVALID_ACTION", "Your hands are full of birds.");
    const bird = p.birds[p.selected]!;
    p.birds.splice(p.selected + 1, 0, bird);
    this.world.removeBuilding(tank, "clone");
    p.stats.cloned += 1;
    this.points(p.id, SCORING.clone);
    this.say(`${this.name(p.id)} cloned a ${birdType(bird)?.name} (the tank is spent)`, "ok");
    this.changed();
  }

  private voteSkip(p: PlayerState, body: Record<string, unknown>): void {
    if (!this.building()) throw new PartyError("PHASE_CLOSED");
    p.vote = body.vote !== false;
    const { votes, needed } = this.skipVotes();
    if (votes >= needed) {
      this.say("The team voted to skip the build phase", "info");
      return this.startAction();
    }
    this.changed();
  }

  private skipVotes(): { votes: number; needed: number } {
    const connected = new Set(this.ctx.players().filter((q) => q.connected).map((q) => q.id));
    const here = this.present().filter((id) => connected.has(id));
    return { votes: here.filter((id) => this.players.get(id)!.vote).length, needed: Math.floor(here.length / 2) + 1 };
  }

  hostAction(action: string): void {
    if (action !== "skip") throw new PartyError("INVALID_ACTION");
    if (this.phase === "ACTION" && this.stage === "FLIGHT") {
      this.world.freeze();
      return this.endFlight();
    }
    if (this.phase === "PROCESS") {
      this.world.freeze();
      return this.nextStep();
    }
    this.ctx.clearTimer();
    this.expire();
  }

  playerLeft(playerId: string): void {
    this.players.get(playerId)!.vote = false;
    if (this.present().length < 1) return this.finish();
    if (this.phase === "SELECT" && this.present().every((id) => this.players.get(id)!.ready)) return this.launchGame();
    if (this.phase === "ACTION" && this.queue[this.qIndex] === playerId && this.stage !== "FLIGHT") return this.nextShooter(1);
    this.changed();
  }

  // ---------------------------------------------------------------- the end

  private awards() {
    const ids = [...this.players.keys()];
    const out: { title: string; playerId: string; detail: string }[] = [];
    const top = (f: (p: PlayerState) => number) => ids.map((id) => ({ id, v: f(this.players.get(id)!) })).sort((a, b) => b.v - a.v)[0];
    const destructive = top((p) => p.stats.destruction);
    if (destructive && destructive.v > 0) {
      const s = this.players.get(destructive.id)!.stats;
      out.push({ title: "MOST DESTRUCTIVE", playerId: destructive.id, detail: `${Math.round(s.destruction)} hp of fortress removed · ${s.blocks} blocks, ${s.pigs} piggies` });
    }
    const weird = [...this.shots].sort((a, b) => trajectoryScore(b) * (b.kills + b.broke > 0 ? 2 : 1) - trajectoryScore(a) * (a.kills + a.broke > 0 ? 2 : 1))[0];
    if (weird) out.push({ title: "MOST QUESTIONABLE TRAJECTORY", playerId: weird.playerId, detail: `Flew ${Math.round(weird.path)} units to get ${Math.round(weird.maxX - SLINGSHOT.x)} across · ${weird.bounces} bounce${weird.bounces === 1 ? "" : "s"}, ${weird.reversals} U-turn${weird.reversals === 1 ? "" : "s"}${weird.kills + weird.broke ? " · and it worked" : ""}` });
    const save = top((p) => p.stats.corruption);
    if (save && save.v > 0) out.push({ title: "BIGGEST TEAM SAVE", playerId: save.id, detail: `${save.v.toFixed(1)}% of the corruption meter, personally` });
    const worst = this.shots
      .filter((s) => s.kills > 0)
      .map((s) => ({ s, badness: 1 - s.power + Math.abs(s.angle - 38) / 45 + (s.angle < 0 ? 0.8 : 0) + s.bounces * 0.2 + s.reversals * 0.4 }))
      .sort((a, b) => b.badness - a.badness)[0];
    if (worst && worst.badness > 0.8) {
      const how = [`${Math.round(worst.s.power * 100)}% power at ${Math.round(worst.s.angle)}°`, worst.s.bounces ? `${worst.s.bounces} bounce${worst.s.bounces === 1 ? "" : "s"}` : null, worst.s.reversals ? `${worst.s.reversals} U-turn${worst.s.reversals === 1 ? "" : "s"}` : null].filter(Boolean).join(", ");
      out.push({ title: "WORST SHOT THAT SOMEHOW WORKED", playerId: worst.s.playerId, detail: `${how} … and ${worst.s.kills} ${worst.s.kills === 1 ? "piggy" : "piggies"} still went down` });
    }
    const generous = top((p) => p.stats.donations);
    if (generous && generous.v > 0) out.push({ title: "MOST GENEROUS", playerId: generous.id, detail: `Gave away ${generous.v} bird${generous.v === 1 ? "" : "s"}` });
    const architect = top((p) => this.wallet.byPlayer(p.id).spent);
    if (architect && architect.v > 0) out.push({ title: "CHIEF ARCHITECT", playerId: architect.id, detail: `Spent ${architect.v} team kernels` });
    return out;
  }

  private summary() {
    return {
      result: this.result,
      corruption: Math.round(this.corruption * 10) / 10,
      cow: this.cow,
      turns: this.turnsDone,
      kernels: { earned: this.wallet.earned, spent: this.wallet.spent, left: this.wallet.balance },
      players: [...this.players.values()].map((p) => ({ id: p.id, name: this.name(p.id), bird: p.bird, skin: p.skin, ...p.stats, kernelsSpent: this.wallet.byPlayer(p.id).spent, birdsLeft: p.birds.length })),
      awards: this.awards().map((a) => ({ ...a, name: this.name(a.playerId) })),
      bestShot: [...this.shots].sort((a, b) => b.kills * 3 + b.broke - (a.kills * 3 + a.broke))[0] ?? null,
    };
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    const summary = this.summary();
    const highlights: Highlight[] = summary.awards.map((a) => ({ title: a.title, playerName: a.name, text: null, detail: a.detail }));
    highlights.unshift({ title: this.result === "victory" ? "TEAM VICTORY" : this.result === "defeat" ? "TEAM DEFEAT" : "OPERATION ENDED", playerName: null, text: null, detail: `Corruption ${summary.corruption}% · Red Cow ${Math.round(this.cow * 100)}% · ${this.turnsDone} turns on ${this.level.name}` });
    this.ctx.finish({ rounds: Math.max(1, this.turnsDone), highlights, details: { kind: "thud.v1", data: { level: this.level.id, ...summary, shots: this.shots } } });
  }

  abortDetails() {
    return { kind: "thud.v1", data: { level: this.level.id, aborted: { phase: this.phase, turn: this.turn }, ...this.summary(), shots: this.shots } };
  }

  // ---------------------------------------------------------------- views

  private forecastView() {
    const body = this.machineBody();
    if (!body) return null;
    const s = entityOf(body).building!;
    const tier = WEATHER_TIERS[s.tier - 1]!;
    const status = s.broken ? "BROKEN" : s.disabled > 0 ? "OFFLINE" : "OK";
    const lines = status === "OK" ? forecast(this.schedule, Math.max(1, this.turn), tier, { seed: this.seed, types: WEATHER, pool: this.level.weather.pool as Record<string, number> }) : [];
    return {
      tier: tier.tier,
      name: tier.name,
      status,
      lines: lines.map((l) => ({ ...l, label: l.type ? WEATHER[l.type as WeatherType].label : null, secondaryLabel: l.secondary ? WEATHER[l.secondary as WeatherType].label : null, severity: l.severity ? SEVERITY[l.severity] : null })),
      next: WEATHER_TIERS[s.tier] ? { name: WEATHER_TIERS[s.tier]!.name, price: WEATHER_TIERS[s.tier]!.price } : null,
      repair: s.broken ? Math.round(tier.price * ECONOMY.weatherRepairShare) : null,
    };
  }

  private base(): Record<string, unknown> {
    if (this.cache?.seq === this.viewSeq) return this.cache.base;
    const index = new Map(this.order.map((id, i) => [id, i]));
    const colorOf = (id: string) => COLORS[Math.max(0, this.order.indexOf(id)) % COLORS.length]!;
    const shooter = this.shooter();
    const effects = this.phase === "ACTION" ? this.actionWeather() : { wind: 0, slippery: 1, fogFrom: null, dark: 0, obscure: 0 };
    const buildings = this.world.buildings();
    const votes = this.skipVotes();
    const counts = Object.fromEntries(Object.keys(BUILDINGS).map((k) => [k, buildings.filter((b) => entityOf(b).building!.type === k).length]));
    const flyingBird = this.world.birds().find((b) => entityOf(b).bird!.primary);
    const base = {
      session: this.session,
      phase: this.phase,
      turn: this.turn,
      turnsDone: this.turnsDone,
      tick: this.tickSeq,
      tickMs: TIMING.tickMs,
      level: {
        id: this.level.id,
        name: this.level.name,
        theme: this.level.theme,
        tagline: this.level.tagline,
        intro: this.level.intro,
        difficulty: this.level.difficulty,
        width: WORLD.width,
        height: WORLD.height,
        groundY: WORLD.groundY,
        terrain: this.level.terrain,
        zones: this.level.zones,
        sling: { x: SLINGSHOT.x, y: SLINGSHOT.y, maxSpeed: SLINGSHOT.maxSpeed, gravity: WORLD.gravity, minAngle: SLINGSHOT.minAngle, maxAngle: SLINGSHOT.maxAngle, minPower: SLINGSHOT.minPower },
        cowX: this.level.cow.x,
      },
      world: {
        v: this.world.version,
        rows: this.world.rows(index),
        fx: this.world.recentFx(),
        water: this.world.world.waterLevel,
        wind: effects.wind,
        fogFrom: effects.fogFrom,
        dark: effects.dark,
        obscure: effects.obscure,
      },
      weather: this.active && (this.phase === "ACTION" || this.phase === "PROCESS") ? { type: this.active.type, label: WEATHER[this.active.type as WeatherType].label, severity: SEVERITY[this.active.severity], secondary: this.active.secondary ? WEATHER[this.active.secondary as WeatherType].label : null } : null,
      corruption: Math.round(this.corruption * 10) / 10,
      cow: { progress: this.cow, step: this.level.cow.step, everyTurns: this.level.cow.everyTurns, nextIn: this.level.cow.everyTurns - (this.turnsDone % this.level.cow.everyTurns), scene: this.cowScene },
      kernels: { balance: this.wallet.balance, earned: this.wallet.earned, spent: this.wallet.spent },
      roster: this.order
        .filter((id) => this.players.has(id))
        .map((id) => {
          const p = this.players.get(id)!;
          return { id, name: this.name(id), color: colorOf(id), bird: p.bird, skin: p.skin, chosen: p.chosen, ready: p.ready, birds: p.birds, selected: p.selected, vote: p.vote, cursor: p.cursor, here: this.present().includes(id), stats: { pigs: p.stats.pigs, blocks: p.stats.blocks, shots: p.stats.shots, corruption: Math.round(p.stats.corruption * 10) / 10 } };
        }),
      build: {
        votes: votes.votes,
        needed: votes.needed,
        catalog: Object.entries(BUILDINGS).map(([type, d]) => ({ type, name: d.name, cost: d.cost, w: d.w, h: buildingHeight(type as BuildingKind, 1, WEATHER_TIERS), max: d.max, count: counts[type] ?? 0, blurb: d.blurb })),
        birdCrate: ECONOMY.birdCrate,
        breedCost: ECONOMY.breed,
        /** How long a build phase lasts (the tutorial says so). */
        buildMs: TIMING.buildMs,
        structures: buildings.map((b) => {
          const s = entityOf(b).building!;
          const e = entityOf(b);
          return { id: b.id, type: s.type, tier: s.tier, x: Math.round(b.x), hp: Math.round(e.hp), maxHp: e.maxHp, disabled: s.disabled, broken: s.broken, waterlogged: s.waterlogged, progress: Math.round(s.progress * 100) / 100, breeders: s.breeders, breeds: s.breeds, charge: Math.round(s.charge), builtBy: s.builtBy };
        }),
        shield: SHIELD,
      },
      forecast: this.forecastView(),
      action:
        this.phase === "ACTION"
          ? {
              shooterId: shooter?.id ?? null,
              stage: this.stage,
              index: this.qIndex,
              queue: this.queue,
              aim: this.aim,
              flying: this.flying,
              uses: flyingBird ? entityOf(flyingBird).bird!.uses : 0,
              fuel: flyingBird ? Math.round(entityOf(flyingBird).bird!.fuel * 100) / 100 : 0,
            }
          : null,
      process: this.phase === "PROCESS" ? { step: this.steps[this.stepIndex]?.id ?? null, label: this.steps[this.stepIndex]?.label ?? "", detail: this.steps[this.stepIndex]?.detail ?? "", index: this.stepIndex, total: this.steps.length } : null,
      log: this.log,
      cues: this.cues,
      over: this.phase === "OVER" ? this.summary() : null,
    };
    this.cache = { seq: this.viewSeq, base };
    return base;
  }

  viewFor(viewer: Viewer): unknown {
    const base = this.base();
    if (viewer.kind !== "player") return base;
    const p = this.players.get(viewer.playerId);
    return {
      ...base,
      you: p
        ? {
            playerId: p.id,
            bird: p.bird,
            skin: p.skin,
            ready: p.ready,
            birds: p.birds,
            selected: p.selected,
            vote: p.vote,
            shooting: this.shooter() === p,
            color: COLORS[Math.max(0, this.order.indexOf(p.id)) % COLORS.length],
          }
        : { playerId: viewer.playerId, spectator: true },
    };
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

export const thudGame: GameDefinition<ThudSettings> = {
  id: "thud",
  name: "Angry Thud's Revenge",
  tagline: "Launch birds. Topple piggies. Stop the Red Cow.",
  description:
    "A co-op slingshot game running inside Steam My Deck. Pick a bird, share one pool of kernels, build nests, walls and weather machines, " +
    "then take turns launching birds at the Corn Piggy fortress. Knock the Corruption Meter to 0% before the piggies finish the Red Cow.",
  minPlayers: 2,
  maxPlayers: 8,
  defaultSettings: { level: LEVELS[0]!.id },
  catalog: { levels: LEVELS.map((l) => ({ id: l.id, name: l.name, difficulty: l.difficulty, tagline: l.tagline })), birds: BIRDS.map((b) => b.id) },
  parseSettings(raw: unknown): ThudSettings {
    const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const level = typeof input.level === "string" && levelById(input.level) ? input.level : LEVELS[0]!.id;
    return { level };
  },
  create(ctx, settings) {
    return new ThudGame(ctx, settings);
  },
};
