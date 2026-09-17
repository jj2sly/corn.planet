// CORNLASHING — every prompt is an incident, players file anonymous incident reports,
// and everyone else on the review board votes for the report they accept.

import { randomBytes } from "node:crypto";
import type { PickedPrompt } from "../db.ts";
import { PartyError } from "../errors.ts";
import { cleanText, LIMITS } from "../text.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "./types.ts";

export interface ChaosSettings {
  /** Paired rounds before the optional Total Breach final round. */
  rounds: number;
  answerSeconds: number;
  voteSeconds: number;
  totalBreach: boolean;
}

export const CHAOS_TIMING = {
  introMs: 5_000,
  verdictMs: 8_000,
  breachVerdictMs: 12_000,
  standingsMs: 8_000,
};

export const POINTS_PER_VOTE = 100;

type Phase = "INTRO" | "ANSWERING" | "VOTING" | "VERDICT" | "STANDINGS";

interface Report {
  id: string;
  authorId: string;
  text: string;
}

interface VerdictEntry {
  reportId: string;
  text: string;
  authorId: string;
  authorName: string;
  votes: number;
  points: number;
  unanimous: boolean;
}

interface Verdict {
  defaulted: boolean;
  totalVotes: number;
  winningReportIds: string[];
  entries: VerdictEntry[];
}

interface Incident {
  id: string;
  prompt: PickedPrompt;
  authorIds: string[];
  authorsMayVote: boolean;
  reports: Map<string, Report>; // authorId -> report
  order: string[]; // report ids in display order
  votes: Map<string, string>; // voterId -> reportId
  verdict: Verdict | null;
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

class ChaosGame implements GameInstance {
  private readonly ctx: GameContext;
  private readonly settings: ChaosSettings;
  private phase: Phase = "INTRO";
  private round = 0;
  private breach = false;
  private incidents: Incident[] = [];
  private index = -1;
  private nextStep: (() => void) | null = null;
  private best: { text: string; authorName: string; votes: number; prompt: string } | null = null;
  private reportsFiled = 0;
  private unanimous = new Map<string, number>();

  constructor(ctx: GameContext, settings: ChaosSettings) {
    this.ctx = ctx;
    this.settings = settings;
  }

  private get totalRounds(): number {
    return this.settings.rounds + (this.settings.totalBreach ? 1 : 0);
  }

  private get multiplier(): number {
    return this.round;
  }

  private get current(): Incident | undefined {
    return this.incidents[this.index];
  }

  private activeIds(): Set<string> {
    return new Set(this.ctx.players().map((p) => p.id));
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

  // ------------------------------------------------------------------ phases

  private beginRound(): void {
    const players = this.ctx.players();
    if (players.length < 3) return this.finish();

    this.round += 1;
    this.breach = this.settings.totalBreach && this.round === this.totalRounds;
    this.index = -1;

    const makeIncident = (prompt: PickedPrompt, authorIds: string[]): Incident => ({
      id: newId(),
      prompt,
      authorIds,
      authorsMayVote: this.breach,
      reports: new Map(),
      order: [],
      votes: new Map(),
      verdict: null,
    });

    if (this.breach) {
      const [prompt] = this.ctx.pickPrompts(1);
      this.incidents = [makeIncident(prompt!, players.map((p) => p.id))];
    } else {
      // A shuffled ring: incident i goes to players i and i+1, so everyone answers exactly two
      // and (with 3+ players) no pair of agents meets twice in a round.
      const ring = this.shuffle(players.map((p) => p.id));
      const prompts = this.ctx.pickPrompts(ring.length);
      this.incidents = ring.map((id, i) => makeIncident(prompts[i]!, [id, ring[(i + 1) % ring.length]!]));
    }

    this.phase = "INTRO";
    this.schedule(CHAOS_TIMING.introMs, () => this.openAnswering());
    this.ctx.changed();
  }

  private openAnswering(): void {
    this.phase = "ANSWERING";
    this.schedule(this.settings.answerSeconds * 1000, () => this.closeAnswering());
    this.ctx.changed();
  }

  private allAnswered(): boolean {
    const active = this.activeIds();
    return this.incidents.every((incident) =>
      incident.authorIds.every((id) => !active.has(id) || incident.reports.has(id)),
    );
  }

  private closeAnswering(): void {
    this.ctx.clearTimer();
    this.index = -1;
    this.nextIncident();
  }

  private nextIncident(): void {
    this.index += 1;
    const incident = this.current;
    if (!incident) return this.showStandings();

    const filed = [...incident.reports.values()];
    if (filed.length === 0) return this.nextIncident();

    incident.order = this.shuffle(filed.map((r) => r.id));
    if (filed.length === 1) return this.revealVerdict(true);
    if (this.eligibleVoters(incident).length === 0) return this.revealVerdict(false);

    this.phase = "VOTING";
    this.schedule(this.settings.voteSeconds * 1000, () => this.revealVerdict(false));
    this.ctx.changed();
  }

  private eligibleVoters(incident: Incident): string[] {
    return this.ctx
      .players()
      .map((p) => p.id)
      .filter((id) => incident.authorsMayVote || !incident.authorIds.includes(id));
  }

  private allVoted(incident: Incident): boolean {
    return this.eligibleVoters(incident).every((id) => incident.votes.has(id));
  }

  private revealVerdict(defaulted: boolean): void {
    this.ctx.clearTimer();
    const incident = this.current!;
    const mult = this.multiplier;
    const reports = new Map([...incident.reports.values()].map((r) => [r.id, r]));
    const counts = new Map<string, number>();
    for (const reportId of incident.votes.values()) counts.set(reportId, (counts.get(reportId) ?? 0) + 1);
    const totalVotes = incident.votes.size;

    const entries = incident.order.map((reportId): VerdictEntry => {
      const report = reports.get(reportId)!;
      const votes = counts.get(reportId) ?? 0;
      const unanimous = !defaulted && totalVotes >= 2 && votes === totalVotes;
      const points = defaulted
        ? POINTS_PER_VOTE * mult
        : votes * POINTS_PER_VOTE * mult + (unanimous ? POINTS_PER_VOTE * mult : 0);

      this.ctx.addPoints(report.authorId, points);
      if (votes > 0) this.ctx.countStat(report.authorId, "votesReceived", votes);
      if (unanimous) {
        this.ctx.countStat(report.authorId, "unanimousRulings");
        this.unanimous.set(report.authorId, (this.unanimous.get(report.authorId) ?? 0) + 1);
      }

      const authorName = this.ctx.playerName(report.authorId);
      if (!defaulted && votes > 0 && (!this.best || votes > this.best.votes)) {
        this.best = { text: report.text, authorName, votes, prompt: incident.prompt.text };
      }
      return { reportId, text: report.text, authorId: report.authorId, authorName, votes, points, unanimous };
    });

    const maxVotes = Math.max(0, ...entries.map((e) => e.votes));
    incident.verdict = {
      defaulted,
      totalVotes,
      winningReportIds: maxVotes > 0 ? entries.filter((e) => e.votes === maxVotes).map((e) => e.reportId) : [],
      entries,
    };

    this.phase = "VERDICT";
    this.schedule(this.breach ? CHAOS_TIMING.breachVerdictMs : CHAOS_TIMING.verdictMs, () => this.nextIncident());
    this.ctx.changed();
  }

  private showStandings(): void {
    for (const id of this.activeIds()) this.ctx.countStat(id, "roundsPlayed");
    this.phase = "STANDINGS";
    this.schedule(CHAOS_TIMING.standingsMs, () => (this.round >= this.totalRounds ? this.finish() : this.beginRound()));
    this.ctx.changed();
  }

  private finish(): void {
    this.nextStep = null;
    this.ctx.clearTimer();
    const highlights: Highlight[] = [];
    if (this.best) {
      highlights.push({
        title: "Most convincing report",
        playerName: this.best.authorName,
        text: this.best.text,
        detail: `${this.best.votes} vote${this.best.votes === 1 ? "" : "s"} · ${this.best.prompt}`,
      });
    }
    const topUnanimous = [...this.unanimous.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topUnanimous) {
      highlights.push({
        title: "Unanimous rulings",
        playerName: this.ctx.playerName(topUnanimous[0]),
        text: null,
        detail: `${topUnanimous[1]} report${topUnanimous[1] === 1 ? "" : "s"} accepted by the entire review board`,
      });
    }
    highlights.push({
      title: "Incident reports filed",
      playerName: null,
      text: null,
      detail: `${this.reportsFiled} reports across ${this.round} round${this.round === 1 ? "" : "s"}`,
    });
    this.ctx.finish({ rounds: this.round, highlights });
  }

  // ------------------------------------------------------------------ input

  handleInput(playerId: string, action: string, payload: unknown): void {
    if (action === "answer") return this.submitAnswer(playerId, asRecord(payload));
    if (action === "vote") return this.castVote(playerId, asRecord(payload));
    throw new PartyError("INVALID_ACTION");
  }

  private submitAnswer(playerId: string, payload: Record<string, unknown>): void {
    if (this.phase !== "ANSWERING") throw new PartyError("PHASE_CLOSED");
    const incident = this.incidents.find((i) => i.id === payload.incidentId);
    if (!incident || !incident.authorIds.includes(playerId)) throw new PartyError("NOT_YOUR_PROMPT");

    const cleaned = cleanText(payload.text, LIMITS.answerMax);
    if (!cleaned.ok) throw new PartyError(cleaned.reason === "TOO_LONG" ? "ANSWER_TOO_LONG" : "ANSWER_EMPTY");

    const existing = incident.reports.get(playerId);
    if (existing) {
      existing.text = cleaned.value;
    } else {
      incident.reports.set(playerId, { id: newId(), authorId: playerId, text: cleaned.value });
      this.reportsFiled += 1;
      this.ctx.countStat(playerId, "answersSubmitted");
      this.ctx.countStat(playerId, `category:${incident.prompt.category}`);
    }

    if (this.allAnswered()) return this.closeAnswering();
    this.ctx.changed();
  }

  private castVote(playerId: string, payload: Record<string, unknown>): void {
    const incident = this.current;
    if (this.phase !== "VOTING" || !incident || payload.incidentId !== incident.id) throw new PartyError("PHASE_CLOSED");
    if (!incident.authorsMayVote && incident.authorIds.includes(playerId)) throw new PartyError("NOT_ELIGIBLE");
    if (incident.votes.has(playerId)) throw new PartyError("ALREADY_VOTED");

    const report = [...incident.reports.values()].find((r) => r.id === payload.reportId);
    if (!report) throw new PartyError("INVALID_VOTE");
    if (report.authorId === playerId) throw new PartyError("CANNOT_VOTE_OWN");

    incident.votes.set(playerId, report.id);
    this.ctx.countStat(playerId, "votesCast");

    if (this.allVoted(incident)) return this.revealVerdict(false);
    this.ctx.changed();
  }

  hostAction(action: string): void {
    if (action !== "skip" || !this.nextStep) throw new PartyError("INVALID_ACTION");
    const step = this.nextStep;
    this.ctx.clearTimer();
    step();
  }

  playerLeft(): void {
    const incident = this.current;
    if (this.phase === "ANSWERING" && this.allAnswered()) this.closeAnswering();
    else if (this.phase === "VOTING" && incident && this.allVoted(incident)) this.revealVerdict(false);
  }

  dispose(): void {
    this.nextStep = null;
  }

  // ------------------------------------------------------------------ views

  viewFor(viewer: Viewer): unknown {
    const playerId = viewer.kind === "player" ? viewer.playerId : null;
    const base = {
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      breach: this.breach,
      multiplier: this.multiplier,
    };

    if (this.phase === "INTRO" || this.phase === "STANDINGS") return base;

    if (this.phase === "ANSWERING") {
      const progress = this.ctx.players().map((p) => {
        const mine = this.incidents.filter((i) => i.authorIds.includes(p.id));
        return { playerId: p.id, done: mine.filter((i) => i.reports.has(p.id)).length, needed: mine.length };
      });
      const assignments = playerId
        ? this.incidents
            .filter((i) => i.authorIds.includes(playerId))
            .map((i) => ({ incidentId: i.id, prompt: i.prompt.text, answer: i.reports.get(playerId)?.text ?? null }))
        : undefined;
      return { ...base, progress, assignments };
    }

    const incident = this.current!;
    const reportsById = new Map([...incident.reports.values()].map((r) => [r.id, r]));
    const shared = {
      ...base,
      incidentId: incident.id,
      incidentNumber: this.index + 1,
      incidentCount: this.incidents.length,
      prompt: incident.prompt.text,
    };

    if (this.phase === "VOTING") {
      const eligible = this.eligibleVoters(incident);
      // Authorship stays on the server: reports carry only a random id and their text.
      const view = {
        ...shared,
        reports: incident.order.map((id) => ({ id, text: reportsById.get(id)!.text })),
        votesCast: incident.votes.size,
        votesNeeded: eligible.length,
      };
      if (!playerId) return view;
      return {
        ...view,
        canVote: eligible.includes(playerId),
        ownReportId: incident.reports.get(playerId)?.id ?? null,
        yourVote: incident.votes.get(playerId) ?? null,
      };
    }

    // VERDICT: authors are revealed.
    const verdict = incident.verdict!;
    return {
      ...shared,
      verdict,
      yourPoints: playerId ? verdict.entries.filter((e) => e.authorId === playerId).reduce((n, e) => n + e.points, 0) : undefined,
    };
  }
}

export const chaosGame: GameDefinition<ChaosSettings> = {
  id: "chaos",
  name: "Cornlashing",
  tagline: "File the funniest incident report. Survive the review board.",
  description:
    "Each round, agents receive classified incidents on their phones and file short, anonymous reports. " +
    "Reports go head-to-head on the big screen and the review board votes. Votes are points. " +
    "The optional final round, Total Breach, puts everyone on the same incident.",
  minPlayers: 3,
  maxPlayers: 8,
  defaultSettings: { rounds: 2, answerSeconds: 90, voteSeconds: 25, totalBreach: true },
  parseSettings(raw: unknown): ChaosSettings {
    const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const d = this.defaultSettings;
    return {
      rounds: clampInt(input.rounds, 1, 3, d.rounds),
      answerSeconds: clampInt(input.answerSeconds, 30, 180, d.answerSeconds),
      voteSeconds: clampInt(input.voteSeconds, 10, 60, d.voteSeconds),
      totalBreach: typeof input.totalBreach === "boolean" ? input.totalBreach : d.totalBreach,
    };
  },
  create(ctx, settings) {
    return new ChaosGame(ctx, settings);
  },
};
