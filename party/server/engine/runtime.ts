import type { GameContext, GameDefinition, GameInstance, Viewer } from "./game.ts";
import { createFixedStepClock, type FixedStepClock } from "./tick.ts";

export type RuntimePhase = "IDLE" | "RUNNING" | "PAUSED" | "FINISHED";
export interface RuntimeSnapshot { phase: RuntimePhase; gameId: string | null; elapsed: number; tick: number; }
export interface RuntimeHostOptions { games?: ReadonlyMap<string, GameDefinition>; tickRate?: number; now?: () => number; }
export interface RuntimeEvents { changed?: (snapshot: RuntimeSnapshot) => void; error?: (error: unknown) => void; }

export class PartyRuntime {
  private readonly games: ReadonlyMap<string, GameDefinition>;
  private readonly clock: FixedStepClock;
  private readonly now: () => number;
  private phase: RuntimePhase = "IDLE";
  private gameId: string | null = null;
  private game: GameInstance | null = null;
  private tickNumber = 0;
  private lastNow: number | null = null;
  private events: RuntimeEvents;

  constructor(options: RuntimeHostOptions = {}, events: RuntimeEvents = {}) {
    this.games = options.games ?? new Map();
    this.clock = createFixedStepClock(1 / Math.max(1, options.tickRate ?? 20));
    this.now = options.now ?? Date.now;
    this.events = events;
  }
  snapshot(): RuntimeSnapshot { return { phase: this.phase, gameId: this.gameId, elapsed: this.clock.elapsed, tick: this.tickNumber }; }
  listGames(): GameDefinition[] { return [...this.games.values()]; }
  getGame(): GameInstance | null { return this.game; }

  start(gameId: string, context: GameContext, settings: unknown): boolean {
    if (this.phase !== "IDLE" && this.phase !== "FINISHED") return false;
    const definition = this.games.get(gameId);
    if (!definition) return false;
    this.disposeGame();
    try {
      const parsed = definition.parseSettings(settings);
      this.game = definition.create(context, parsed);
      this.gameId = definition.id;
      this.phase = "RUNNING";
      this.tickNumber = 0;
      this.clock.accumulator = 0;
      this.clock.elapsed = 0;
      this.lastNow = this.now();
      this.game.start();
      this.emit();
      return true;
    } catch (error) {
      this.disposeGame();
      this.events.error?.(error);
      return false;
    }
  }

  input(playerId: string, action: string, payload: unknown): boolean {
    if (!this.game || (this.phase !== "RUNNING" && this.phase !== "PAUSED")) return false;
    try { this.game.handleInput(playerId, action, payload); return true; }
    catch (error) { this.events.error?.(error); return false; }
  }

  hostAction(action: string, payload: unknown): boolean {
    if (!this.game || (this.phase !== "RUNNING" && this.phase !== "PAUSED")) return false;
    try { this.game.hostAction(action, payload); return true; }
    catch (error) { this.events.error?.(error); return false; }
  }

  view(viewer: Viewer): unknown { return this.game?.viewFor(viewer) ?? null; }

  pause(): boolean { if (this.phase !== "RUNNING") return false; this.phase = "PAUSED"; this.emit(); return true; }
  resume(): boolean { if (this.phase !== "PAUSED") return false; this.lastNow = this.now(); this.phase = "RUNNING"; this.emit(); return true; }

  step(deltaSeconds?: number): number {
    if (this.phase !== "RUNNING") return 0;
    const now = this.now();
    const delta = deltaSeconds ?? Math.max(0, (now - (this.lastNow ?? now)) / 1000);
    this.lastNow = now;
    const steps = this.clock.tick(delta, () => { this.tickNumber++; });
    if (steps > 0) this.emit();
    return steps;
  }

  playerLeft(playerId: string): void { this.game?.playerLeft(playerId); }
  finish(): void { if (this.phase === "IDLE" || this.phase === "FINISHED") return; this.phase = "FINISHED"; this.emit(); }

  dispose(): void {
    this.disposeGame();
    this.phase = "IDLE"; this.gameId = null; this.tickNumber = 0;
    this.clock.accumulator = 0; this.clock.elapsed = 0; this.lastNow = null; this.emit();
  }

  private disposeGame(): void {
    if (!this.game) return;
    try { this.game.dispose(); } catch (error) { this.events.error?.(error); }
    this.game = null;
  }
  private emit(): void { this.events.changed?.(this.snapshot()); }
}
