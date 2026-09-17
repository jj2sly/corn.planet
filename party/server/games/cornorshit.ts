// CORN OR SHIT — two claims about one CPI Database record. One is documented canon, one was
// fabricated for this round. Agents decide which is which.
//
// Everything on screen that is not the source record is generated content: the fabricated claim is
// built by template from another canon record (see claims.ts), is labelled as fabricated at the
// reveal, and never goes back to the CPI Database. Only the source record's id is recorded as the
// canon this round drew on.

import { randomBytes } from "node:crypto";
import type { CanonKind } from "../canon.ts";
import { PartyError } from "../errors.ts";
import { buildClaimPair, type ClaimPair } from "./claims.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "./types.ts";

export interface CornOrShitSettings {
  rounds: number;
  guessSeconds: number;
}

export const CORN_OR_SHIT_TIMING = {
  introMs: 5_000,
  revealMs: 9_000,
};

export const POINTS_CORRECT = 100;
/** Awarded at the end for calling every round right, when there were enough rounds to mean it. */
export const PERFECT_RECORD_BONUS = 200;
export const PERFECT_RECORD_MIN_ROUNDS = 3;

/** Kinds are tried in this order when building a round, so entity-led rounds are the default. */
const KIND_ORDER: readonly CanonKind[] = ["entity", "incident", "personnel"];

type Phase = "INTRO" | "GUESSING" | "REVEAL";

interface Option {
  id: string;
  text: string;
  real: boolean;
}

interface Round {
  number: number;
  pair: ClaimPair;
  /** Shuffled, so the documented claim is not always first. */
  options: Option[];
  guesses: Map<string, string>; // playerId -> option id
}

function newId(): string {
  return randomBytes(6).toString("hex");
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new PartyError("INVALID_INPUT");
  return payload as Record<string, unknown>;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** True when canon can produce at least one round. Used to refuse to start rather than fail mid-game. */
export function canonIsPlayable(ctx: GameContext): boolean {
  for (const kind of KIND_ORDER) {
    const pool = ctx.canon.list(kind);
    for (const source of pool) {
      if (buildClaimPair(source, pool, () => 0)) return true;
    }
  }
  return false;
}

class CornOrShitGame implements GameInstance {
  private readonly ctx: GameContext;
  private readonly settings: CornOrShitSettings;
  private phase: Phase = "INTRO";
  private round: Round | null = null;
  private roundNumber = 0;
  private nextStep: (() => void) | null = null;
  private correct = new Map<string, number>();
  private usedRefs = new Set<string>();
  private best: { ref: string; title: string; claim: string; fooled: number } | null = null;

  constructor(ctx: GameContext, settings: CornOrShitSettings) {
    this.ctx = ctx;
    this.settings = settings;
  }

  private schedule(ms: number, step: () => void): void {
    this.nextStep = step;
    this.ctx.setTimer(ms, step);
  }

  private shuffle<T>(items: T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.ctx.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  start(): void {
    this.beginRound();
  }

  // ------------------------------------------------------------------ rounds

  /** Picks the next claim pair, preferring canon this room has not used yet. */
  private nextPair(): ClaimPair | null {
    for (const kind of KIND_ORDER) {
      const pool = this.ctx.canon.list(kind);
      if (pool.length < 2) continue;

      const unused = this.shuffle(pool.filter((r) => !this.usedRefs.has(r.ref)));
      const fallback = this.shuffle(pool);

      for (const source of [...unused, ...fallback]) {
        const pair = buildClaimPair(source, pool, () => this.ctx.random());
        if (pair) return pair;
      }
    }
    return null;
  }

  private beginRound(): void {
    if (this.roundNumber >= this.settings.rounds) return this.finish();

    const pair = this.nextPair();
    // Canon ran dry mid-game (records deleted, or a refresh emptied a collection): end cleanly
    // on the rounds already played rather than showing a broken round.
    if (!pair) return this.finish();

    this.roundNumber += 1;
    this.usedRefs.add(pair.source.ref);
    // Only the source record counts as the canon this round came from; the donor merely lent a
    // value to the fabrication.
    this.ctx.canon.used(this.roundNumber, pair.source.ref);

    this.round = {
      number: this.roundNumber,
      pair,
      options: this.shuffle([
        { id: newId(), text: pair.real, real: true },
        { id: newId(), text: pair.fake, real: false },
      ]),
      guesses: new Map(),
    };

    this.phase = "INTRO";
    this.schedule(CORN_OR_SHIT_TIMING.introMs, () => this.openGuessing());
    this.ctx.changed();
  }

  private openGuessing(): void {
    this.phase = "GUESSING";
    this.schedule(this.settings.guessSeconds * 1000, () => this.reveal());
    this.ctx.changed();
  }

  private allGuessed(): boolean {
    const round = this.round;
    if (!round) return false;
    const players = this.ctx.players();
    return players.length > 0 && players.every((p) => round.guesses.has(p.id));
  }

  private reveal(): void {
    const round = this.round;
    if (!round) return this.finish();

    const realOption = round.options.find((o) => o.real)!;
    let fooled = 0;

    for (const [playerId, optionId] of round.guesses) {
      this.ctx.countStat(playerId, "canonGuesses");
      if (optionId === realOption.id) {
        this.ctx.addPoints(playerId, POINTS_CORRECT);
        this.ctx.countStat(playerId, "canonCorrect");
        this.correct.set(playerId, (this.correct.get(playerId) ?? 0) + 1);
      } else {
        fooled += 1;
      }
    }
    for (const player of this.ctx.players()) this.ctx.countStat(player.id, "roundsPlayed");

    if (!this.best || fooled > this.best.fooled) {
      this.best = { ref: round.pair.source.ref, title: round.pair.source.title, claim: round.pair.fake, fooled };
    }

    this.phase = "REVEAL";
    this.schedule(CORN_OR_SHIT_TIMING.revealMs, () => this.beginRound());
    this.ctx.changed();
  }

  private finish(): void {
    const highlights: Highlight[] = [];

    // The perfect record only means something over a few rounds.
    if (this.roundNumber >= PERFECT_RECORD_MIN_ROUNDS) {
      for (const player of this.ctx.players()) {
        if ((this.correct.get(player.id) ?? 0) === this.roundNumber) {
          this.ctx.addPoints(player.id, PERFECT_RECORD_BONUS);
          this.ctx.countStat(player.id, "perfectRecords");
          highlights.push({
            title: "Perfect Record",
            playerName: player.name,
            text: null,
            detail: `Called all ${this.roundNumber} rounds correctly. +${PERFECT_RECORD_BONUS}`,
          });
        }
      }
    }

    if (this.best && this.best.fooled > 0) {
      highlights.push({
        title: "Most Convincing Fabrication",
        playerName: null,
        text: this.best.claim,
        detail: `Fooled ${this.best.fooled} ${this.best.fooled === 1 ? "agent" : "agents"} — ${this.best.ref} is not on record for that.`,
      });
    }

    this.ctx.finish({ rounds: this.roundNumber, highlights });
  }

  // ------------------------------------------------------------------ input

  handleInput(playerId: string, action: string, payload: unknown): void {
    if (action !== "guess") throw new PartyError("INVALID_ACTION");
    const round = this.round;
    if (this.phase !== "GUESSING" || !round) throw new PartyError("PHASE_CLOSED");
    if (round.guesses.has(playerId)) throw new PartyError("ALREADY_VOTED");

    const { optionId } = asRecord(payload);
    if (!round.options.some((o) => o.id === optionId)) throw new PartyError("INVALID_VOTE");

    round.guesses.set(playerId, optionId as string);

    if (this.allGuessed()) return this.reveal();
    this.ctx.changed();
  }

  hostAction(action: string): void {
    if (action !== "skip" || !this.nextStep) throw new PartyError("INVALID_ACTION");
    const step = this.nextStep;
    this.ctx.clearTimer();
    step();
  }

  playerLeft(): void {
    if (this.phase === "GUESSING" && this.allGuessed()) this.reveal();
  }

  dispose(): void {
    this.nextStep = null;
    this.round = null;
  }

  // ------------------------------------------------------------------ views

  viewFor(viewer: Viewer): unknown {
    const playerId = viewer.kind === "player" ? viewer.playerId : null;
    const round = this.round;

    const base = {
      phase: this.phase,
      round: this.roundNumber,
      totalRounds: this.settings.rounds,
    };

    if (!round) return base;

    const shared = {
      ...base,
      kind: round.pair.source.kind,
      // The record's own title is safe to show: it is which record is under discussion, not which
      // claim is true.
      subject: round.pair.source.title,
    };

    if (this.phase === "INTRO") return shared;

    if (this.phase === "GUESSING") {
      // Which option is documented is hidden here: options carry only an id and their text.
      const view = {
        ...shared,
        options: round.options.map((o) => ({ id: o.id, text: o.text })),
        guessesCast: round.guesses.size,
        guessesNeeded: this.ctx.players().length,
      };
      if (!playerId) return view;
      return { ...view, yourGuess: round.guesses.get(playerId) ?? null };
    }

    // REVEAL: the answer, the canon behind it, and where the fabrication came from.
    const realOption = round.options.find((o) => o.real)!;
    const scoreboard = this.ctx.players().map((p) => {
      const guess = round.guesses.get(p.id) ?? null;
      return {
        playerId: p.id,
        name: p.name,
        guessed: guess,
        correct: guess === realOption.id,
      };
    });

    return {
      ...shared,
      options: round.options.map((o) => ({
        id: o.id,
        text: o.text,
        real: o.real,
        picked: scoreboard.filter((s) => s.guessed === o.id).length,
      })),
      realOptionId: realOption.id,
      reference: {
        ref: round.pair.source.ref,
        title: round.pair.source.title,
        url: round.pair.source.url,
      },
      // Named so the client cannot render it as anything but what it is.
      fabricatedFrom: { ref: round.pair.donor.ref, title: round.pair.donor.title },
      scoreboard,
      pointsForCorrect: POINTS_CORRECT,
      yourResult: playerId ? (scoreboard.find((s) => s.playerId === playerId) ?? null) : undefined,
    };
  }
}

export const cornOrShitGame: GameDefinition<CornOrShitSettings> = {
  id: "cornorshit",
  name: "Corn or Shit",
  tagline: "One claim is in the database. One is not. Choose.",
  description:
    "Every round puts two claims about the same CPI Database record on the big screen. One is documented " +
    "canon; the other was fabricated for the round out of a different record. Agents pick the real one from " +
    "their phones, then the database reference is revealed so you can go and check.",
  minPlayers: 3,
  maxPlayers: 8,
  defaultSettings: { rounds: 5, guessSeconds: 25 },
  parseSettings(raw: unknown): CornOrShitSettings {
    const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const d = this.defaultSettings;
    return {
      rounds: clampInt(input.rounds, 3, 10, d.rounds),
      guessSeconds: clampInt(input.guessSeconds, 10, 60, d.guessSeconds),
    };
  },
  create(ctx, settings) {
    // Refuse up front rather than starting a game with nothing to ask about.
    if (!canonIsPlayable(ctx)) throw new PartyError("NO_CANON");
    return new CornOrShitGame(ctx, settings);
  },
};
