// MY COB ESCAPED, WHAT DO I DO NOW??? — an incident-response party game.
//
// A random CPI Database entity gets out. Agents are handed temporary roles and three lives, and
// every stage each one files an open-ended response (a tag plus free text) from their phone. The
// Incident Director interprets them all together; the engine rolls, validates and applies what
// actually happens; the room sees one narrated consequence and votes anonymously for the stage's
// best move. After the last stage (or a decisive ending), agents invent the awards and vote on who
// gets them.
//
//   ALERT -> (UPDATE -> RESPONSE -> PROCESSING -> CONSEQUENCE -> STAGE_VOTE) x stages
//         -> OUTCOME -> AWARD_SUBMIT -> AWARD_VOTE -> AWARD_RESULTS -> room final results
//
// Secrecy: raw responses, the hidden stats, undiscovered facts, the unknown entity's identity, the
// rolls and the director's context all stay in this instance. viewFor() only ever builds from what
// the viewer may know. Canon is read-only; the whole incident is generated content.

import { PartyError } from "../../errors.ts";
import { cleanText } from "../../text.ts";
import { AwardCeremony } from "../awards.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "../types.ts";
import {
  APPROACHES,
  DEFAULT_MYCOB_CONFIG,
  LENGTHS,
  MODES,
  modeById,
  RESPONSE_TAGS,
  resolveConfig,
  STAT_IDS,
  type Approach,
  type ConfigOverrides,
  type EndingId,
  type LengthId,
  type ModeId,
  type MyCobConfig,
  type Outcome,
  type ResponseTag,
} from "./config.ts";
import { DEPARTMENTS, ENDING_TEXT, NPC_FIRST, NPC_LAST, SYSTEM_IDS, SYSTEMS } from "./content.ts";
import { buildDirectorContext, MockIncidentDirector, validateDirectorOutput, type DirectorContext, type IncidentDirector, type ValidatedOutput } from "./director.ts";
import {
  describeStat,
  evaluateObjectives,
  fill,
  generateIncident,
  locationName,
  OK_STATUSES,
  pick,
  scrubHidden,
  shuffle,
  type Fact,
  type Incident,
} from "./incident.ts";
import { NarrationLog } from "./narration.ts";
import {
  applyStage,
  checkEnding,
  emptyScore,
  planStage,
  roleOf,
  scoreStage,
  teamScore,
  type ActionInput,
  type ScoreLine,
  type ScoringMemory,
  type StagePlan,
  type StageResult,
} from "./rules.ts";

export interface MyCobSettings {
  mode: ModeId;
  length: LengthId;
  stages: number;
}

type Phase =
  | "ALERT"
  | "UPDATE"
  | "RESPONSE"
  | "PROCESSING"
  | "CONSEQUENCE"
  | "STAGE_VOTE"
  | "OUTCOME"
  | "AWARD_SUBMIT"
  | "AWARD_VOTE"
  | "AWARD_RESULTS";

const TRADE_PHASES: readonly Phase[] = ["ALERT", "UPDATE"];
const STAGE_PHASES: readonly Phase[] = ["ALERT", "UPDATE", "RESPONSE", "PROCESSING", "CONSEQUENCE", "STAGE_VOTE"];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  critical: "BRILLIANT",
  success: "IT WORKED",
  partial: "PARTIALLY",
  failure: "IT DIDN'T WORK",
  catastrophe: "CATASTROPHIC",
};

interface Notice {
  id: string;
  stage: number;
  kind: "life" | "down" | "reassigned" | "trade";
  text: string;
}

interface CrewMember {
  playerId: string;
  name: string;
  roleId: string;
  startRoleId: string;
  lives: number;
  /** Hit zero lives this stage; reassigned when the next stage starts. */
  down: boolean;
  downs: number;
  livesLost: number;
  /** The staff member this agent now plays, after going down. */
  identity: string | null;
  /** Tag used each stage, for diminishing returns on repetition. */
  tags: ResponseTag[];
  left: boolean;
  notices: Notice[];
}

interface Response {
  tag: ResponseTag;
  text: string;
  approach: Approach;
  sacrifice: boolean;
}

interface StageRecord {
  stage: number;
  plan: StagePlan;
  director: { id: string; fallback: boolean; issues: string[] };
  output: ValidatedOutput;
  result: StageResult;
  ballots: { voter: string; target: string }[];
  /** Agents who could vote this stage. */
  eligible: number;
  scores: Record<string, ScoreLine>;
  narration: string;
}

const hashString = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new PartyError("INVALID_INPUT");
  return payload as Record<string, unknown>;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** The effective rules for a game: defaults, then the options' overrides, then the mode's, then the length's timing. */
export function configFor(settings: MyCobSettings, overrides?: ConfigOverrides): MyCobConfig {
  const mode = modeById(settings.mode) ?? MODES[0]!;
  const config = resolveConfig(DEFAULT_MYCOB_CONFIG, overrides, mode.overrides);
  const scale = config.lengths[settings.length].timerScale;
  const t = config.timing;
  return {
    ...config,
    timing: {
      ...t,
      updateMs: Math.round(t.updateMs * scale),
      responseMs: Math.round(t.responseMs * scale),
      consequenceMs: Math.round(t.consequenceMs * scale),
    },
  };
}

class MyCobGame implements GameInstance {
  private readonly ctx: GameContext;
  private readonly settings: MyCobSettings;
  private readonly config: MyCobConfig;
  private readonly director: IncidentDirector;
  private readonly fallback = new MockIncidentDirector();
  private readonly incident: Incident;
  /** The incident as generated, for the saved record. */
  private readonly initial: Incident;
  private readonly crew = new Map<string, CrewMember>();
  private readonly narration = new NarrationLog();
  private readonly awards: AwardCeremony;
  private readonly memory: ScoringMemory = { creativity: new Map(), sacrifices: new Map() };

  private phase: Phase = "ALERT";
  private stage = 0;
  private responses = new Map<string, Response>();
  private plan: StagePlan | null = null;
  private context: DirectorContext | null = null;
  private output: ValidatedOutput | null = null;
  private result: StageResult | null = null;
  private processing: { token: number; raw: unknown; done: boolean } | null = null;
  private processingToken = 0;
  private votes = new Map<string, string>();
  private voters: string[] = [];
  private offers = new Map<string, string>();
  private readonly trades: { stage: number; a: string; b: string }[] = [];
  private readonly history: string[] = [];
  private readonly records: StageRecord[] = [];
  private readonly mvps: { stage: number; playerIds: string[]; votes: number }[] = [];
  private ending: { id: EndingId; stage: number; narration: string } | null = null;
  private totals = new Map<string, ScoreLine>();
  private team = 0;
  private nextStep: (() => void) | null = null;
  private disposed = false;
  private noticeSeq = 0;

  constructor(ctx: GameContext, settings: MyCobSettings, config: MyCobConfig, director: IncidentDirector) {
    this.ctx = ctx;
    this.settings = settings;
    this.config = config;
    this.director = director;
    this.awards = new AwardCeremony(config.awards);

    const entities = ctx.canon.list("entity");
    if (entities.length === 0) throw new PartyError("NO_CANON");
    this.incident = generateIncident(
      { entities, personnel: ctx.canon.list("personnel"), incidents: ctx.canon.list("incident") },
      config,
      () => ctx.random(),
      { mode: settings.mode, stages: settings.stages, playerCount: ctx.players().length },
    );
    this.initial = structuredClone(this.incident);
  }

  private get totalStages(): number {
    return this.settings.stages;
  }

  private schedule(ms: number, step: () => void): void {
    this.nextStep = step;
    this.ctx.setTimer(ms, step);
  }

  private activeCrew(): CrewMember[] {
    const present = new Set(this.ctx.players().map((p) => p.id));
    return [...this.crew.values()].filter((m) => !m.left && present.has(m.playerId));
  }

  private notify(member: CrewMember, kind: Notice["kind"], text: string): void {
    this.noticeSeq += 1;
    member.notices.push({ id: `x${this.noticeSeq}`, stage: this.stage, kind, text });
  }

  private scrub(text: string): string {
    return scrubHidden(text, this.incident);
  }

  // ------------------------------------------------------------------ start

  start(): void {
    const roles = shuffle(this.config.roles, () => this.ctx.random());
    this.ctx.players().forEach((p, i) => {
      const role = roles[i % roles.length]!;
      this.crew.set(p.id, {
        playerId: p.id,
        name: p.name,
        roleId: role.id,
        startRoleId: role.id,
        lives: this.config.lives.start,
        down: false,
        downs: 0,
        livesLost: 0,
        identity: null,
        tags: [],
        left: false,
        notices: [],
      });
    });
    for (const ref of this.incident.canonRefs) this.ctx.canon.used(1, ref);

    const inc = this.incident;
    this.narration.newBeat();
    this.narration.add(
      "incident_alert",
      0,
      `INCIDENT ${inc.code}: ${inc.breach.name.toUpperCase()}. ${inc.breach.text} ${inc.problem.text}` +
        (inc.environment.length ? ` ${inc.environment.map((e) => e.text).join(" ")}` : "") +
        (inc.entity.identityKnown ? ` Entity: ${inc.entity.title}.` : " Entity: UNKNOWN."),
    );
    this.phase = "ALERT";
    this.schedule(this.config.timing.alertMs, () => this.beginStage());
    this.ctx.changed();
  }

  // ------------------------------------------------------------------ the stage loop

  private beginStage(): void {
    if (this.activeCrew().length < this.config.players.minToContinue) return this.endEarly();
    this.stage += 1;
    this.responses = new Map();
    this.plan = null;
    this.context = null;
    this.output = null;
    this.result = null;
    this.votes = new Map();

    this.narration.newBeat();
    const inc = this.incident;
    const status = (id: "containment" | "time") => describeStat(id, inc.stats[id], this.config).value;
    const lines = [`Stage ${this.stage} of ${this.totalStages}. Containment: ${status("containment")}. Time: ${status("time")}.`];
    const previous = this.mvps.find((m) => m.stage === this.stage - 1);
    if (previous) lines.push(`Stage ${previous.stage} commendation: ${previous.playerIds.map((id) => this.crew.get(id)!.name).join(" and ")}.`);
    if (inc.entity.revealedStage === this.stage - 1 && inc.entity.initiallyUnknown) lines.push(`The entity has been identified: ${inc.entity.title}.`);
    const open = inc.objectives.filter((o) => o.status === "active").length;
    lines.push(`${open} objective${open === 1 ? "" : "s"} still open.`);
    this.narration.add("stage_transition", this.stage, lines.join(" "));

    for (const member of this.crew.values()) if (member.down && !member.left) this.reassign(member);

    this.phase = "UPDATE";
    this.schedule(this.config.timing.updateMs, () => this.openResponses());
    this.ctx.changed();
  }

  /** A down agent comes back as somebody else: a new role, and a staff member to play. */
  private reassign(member: CrewMember): void {
    const random = () => this.ctx.random();
    const roles = this.config.roles.filter((r) => r.id !== member.roleId);
    const role = roles.length ? pick(roles, random) : roleOf(this.config, member.roleId);
    const available = this.incident.personnel.filter((p) => !p.controlledBy && OK_STATUSES.includes(p.status) && p.status !== "unavailable");
    let npc = available.length ? pick(available, random) : null;
    if (!npc) {
      const dept = DEPARTMENTS.find((d) => d.id === "intern")!;
      npc = {
        id: `p-r${this.incident.personnel.length + 1}`,
        name: `${dept.title} ${pick(NPC_FIRST, random)} ${pick(NPC_LAST, random)}`,
        department: dept.name,
        source: "generated",
        ref: null,
        url: null,
        location: this.incident.location.id,
        status: "active",
        relationship: "was sent in as a replacement",
        importance: "low",
        knowledgeFactId: null,
        controlledBy: null,
      };
      this.incident.personnel.push(npc);
    }
    npc.controlledBy = member.playerId;
    npc.status = "active";
    member.roleId = role.id;
    member.identity = npc.name;
    member.lives = this.config.lives.afterReassignment;
    member.down = false;
    this.notify(member, "reassigned", `You're back in as ${npc.name}, ${role.name}. Lives: ${member.lives}.`);
    this.narration.add("stage_transition", this.stage, `${member.name} is back in the field as ${npc.name}.`);
  }

  private openResponses(): void {
    this.offers.clear();
    this.phase = "RESPONSE";
    this.schedule(this.config.timing.responseMs, () => this.closeResponses());
    this.ctx.changed();
  }

  private allResponded(): boolean {
    const crew = this.activeCrew();
    return crew.length > 0 && crew.every((m) => this.responses.has(m.playerId));
  }

  private closeResponses(): void {
    this.ctx.clearTimer();
    const crew = this.activeCrew();
    const inputs: ActionInput[] = [];
    for (const member of crew) {
      const r = this.responses.get(member.playerId);
      if (!r) continue;
      inputs.push({
        playerId: member.playerId,
        playerName: member.name,
        role: roleOf(this.config, member.roleId),
        tag: r.tag,
        approach: r.approach,
        sacrifice: r.sacrifice,
        text: r.text,
        previousTags: member.tags,
      });
      member.tags.push(r.tag);
    }
    this.plan = planStage(
      inputs,
      crew.map((m) => m.playerId),
      this.incident,
      this.stage,
      this.totalStages,
      this.config,
      () => this.ctx.random(),
    );
    const names = new Map([...this.crew.values()].map((m) => [m.playerId, m.name]));
    this.context = buildDirectorContext(this.incident, this.plan, names, this.history, this.config);
    this.startProcessing();
  }

  private startProcessing(): void {
    this.processingToken += 1;
    const token = this.processingToken;
    const started = Date.now();
    this.processing = { token, raw: undefined, done: false };
    this.phase = "PROCESSING";
    this.schedule(this.config.timing.processingMaxMs, () => this.completeProcessing());
    this.ctx.changed();

    // The director gets a copy: nothing it does can reach the live incident.
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(this.director.resolveStage(structuredClone(this.context!)));
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then(
      (raw) => {
        if (this.disposed || this.processing?.token !== token || this.phase !== "PROCESSING") return;
        this.processing.raw = raw;
        this.processing.done = true;
        const wait = Math.max(0, this.config.timing.processingMinMs - (Date.now() - started));
        this.schedule(wait, () => this.completeProcessing());
        this.ctx.changed();
      },
      (err: unknown) => {
        console.error("[corn-planet-party] incident director failed; the fallback director will narrate:", err instanceof Error ? err.message : err);
      },
    );
  }

  private completeProcessing(): void {
    this.ctx.clearTimer();
    const plan = this.plan!;
    const processing = this.processing;
    this.processing = null;

    let output = processing?.done ? validateDirectorOutput(processing.raw, plan, this.incident, this.config) : null;
    const fallback = output === null;
    if (!output) output = validateDirectorOutput(this.fallback.resolveSync(this.context!), plan, this.incident, this.config)!;
    this.output = output;

    const result = applyStage(this.incident, plan, output, this.config, () => this.ctx.random());
    this.result = result;
    this.history.push(output.narration);

    // Narration for the consequence beat.
    this.narration.newBeat();
    this.narration.add("consequence", this.stage, output.narration);
    // Its own event (for the screen and a future voice), unless the narration already told it.
    if (result.specialEvent && !output.narration.includes(result.specialEvent.text)) {
      this.narration.add("special_event", this.stage, `${result.specialEvent.name}: ${result.specialEvent.text}`);
    }
    for (const fact of result.reveals) this.narration.add("discovery", this.stage, `Discovered — ${fact.label}: ${this.scrub(fact.text)}`);
    for (const change of result.objectiveChanges) this.narration.add("objective_update", this.stage, `Objective ${change.to}: ${this.scrub(change.text)}`);
    for (const o of result.objectivesAdded) this.narration.add("objective_update", this.stage, `New objective: ${this.scrub(o.text)}`);

    // Lives: told to everyone at once, and to the agent on their own phone.
    const amount = this.config.lives.maxLossPerConsequence;
    for (const loss of result.lifeLosses) {
      const member = this.crew.get(loss.playerId);
      if (!member || member.left || member.lives <= 0) continue;
      member.lives = Math.max(0, member.lives - amount);
      member.livesLost += 1;
      this.ctx.countStat(member.playerId, "livesLost");
      this.notify(member, "life", `You lost a life. ${loss.reason}`);
      this.narration.add("life_loss", this.stage, `${member.name} lost a life.`);
      this.narration.add("life_loss", this.stage, `You lost a life. ${loss.reason}`, member.playerId);
      if (member.lives === 0) {
        member.down = true;
        member.downs += 1;
        this.ctx.countStat(member.playerId, "downs");
        this.notify(member, "down", "You're down. You'll be reassigned when the next stage starts.");
        this.narration.add("life_loss", this.stage, `${member.name} is down.`);
      }
    }

    this.records.push({
      stage: this.stage,
      plan,
      director: { id: fallback ? this.fallback.id : this.director.id, fallback: fallback && this.director.id !== this.fallback.id, issues: output.issues },
      output,
      result,
      ballots: [],
      eligible: 0,
      scores: {},
      narration: output.narration,
    });

    this.phase = "CONSEQUENCE";
    this.schedule(this.config.timing.consequenceMs, () => this.openVote());
    this.ctx.changed();
  }

  /** Agents who did something this stage and are still here: the ballot. */
  private candidates(): string[] {
    const active = new Set(this.activeCrew().map((m) => m.playerId));
    return (this.plan?.actions ?? []).map((a) => a.playerId).filter((id) => active.has(id));
  }

  private openVote(): void {
    const candidates = this.candidates();
    this.voters = this.activeCrew()
      .map((m) => m.playerId)
      .filter((id) => candidates.some((c) => c !== id));
    if (!this.config.voting.enabled || this.voters.length === 0) return this.closeVote();
    this.phase = "STAGE_VOTE";
    this.schedule(this.config.timing.voteMs, () => this.closeVote());
    this.ctx.changed();
  }

  private allVoted(): boolean {
    const active = new Set(this.activeCrew().map((m) => m.playerId));
    return this.voters.filter((id) => active.has(id)).every((id) => this.votes.has(id));
  }

  private closeVote(): void {
    this.ctx.clearTimer();
    const counts = new Map<string, number>();
    for (const [voter, target] of this.votes) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
      this.ctx.countStat(voter, "votesCast");
    }
    for (const [id, n] of counts) this.ctx.countStat(id, "votesReceived", n);
    const top = Math.max(0, ...counts.values());
    if (top > 0) this.mvps.push({ stage: this.stage, playerIds: [...counts].filter(([, n]) => n === top).map(([id]) => id), votes: top });

    // Stage scoring happens here, after the consequence and the vote. It isn't shown until the end.
    const everyone = [...this.crew.keys()];
    const lines = scoreStage(this.plan!, this.result!, this.output!, counts, everyone, this.memory, this.config);
    for (const [id, line] of lines) {
      const total = this.totals.get(id) ?? emptyScore();
      for (const key of Object.keys(total) as (keyof ScoreLine)[]) total[key] += line[key];
      this.totals.set(id, total);
    }
    const record = this.records[this.records.length - 1]!;
    record.ballots = [...this.votes].map(([voter, target]) => ({ voter, target }));
    record.eligible = this.voters.length;
    record.scores = Object.fromEntries(lines);
    for (const m of this.activeCrew()) this.ctx.countStat(m.playerId, "roundsPlayed");

    const crew = this.activeCrew();
    const everyoneDown = crew.length > 0 && crew.every((m) => m.down);
    const ending = checkEnding(this.incident, this.stage, this.totalStages, everyoneDown, this.config);
    if (ending) return this.showOutcome(ending);
    this.beginStage();
  }

  /** Too few agents left to carry on: the incident ends as it stands. */
  private endEarly(): void {
    const ending = checkEnding(this.incident, Math.max(this.stage, this.config.endings.minStage), this.stage, false, this.config) ?? "escaped";
    this.showOutcome(ending);
  }

  // ------------------------------------------------------------------ the ending

  private showOutcome(ending: EndingId): void {
    this.ctx.clearTimer();
    const inc = this.incident;
    evaluateObjectives(inc, this.stage, true);
    if (ending === "contained") inc.entity.status = "contained";

    this.team = teamScore(ending, inc, this.config);
    for (const member of this.crew.values()) {
      const total = (this.totals.get(member.playerId)?.total ?? 0) + this.team;
      this.ctx.addPoints(member.playerId, total);
    }

    const random = () => this.ctx.random();
    const text = fill(pick(ENDING_TEXT[ending].lines, random), { entity: inc.entity.title });
    const tail = ending === "contained" || ending === "terminated" ? ` Resolved in ${this.stage} stage${this.stage === 1 ? "" : "s"}.` : "";
    this.ending = { id: ending, stage: this.stage, narration: text.charAt(0).toUpperCase() + text.slice(1) + tail };
    this.narration.newBeat();
    this.narration.add("ending", this.stage, `${ENDING_TEXT[ending].title}. ${this.ending.narration}`);

    this.phase = "OUTCOME";
    const awardsPossible = this.config.awards.enabled && this.activeCrew().length >= 2;
    this.schedule(this.config.timing.outcomeMs, () => (awardsPossible ? this.openAwardSubmit() : this.finish()));
    this.ctx.changed();
  }

  private openAwardSubmit(): void {
    this.phase = "AWARD_SUBMIT";
    this.schedule(this.config.timing.awardSubmitMs, () => this.openAwardVote());
    this.ctx.changed();
  }

  private allAwardsIn(): boolean {
    const crew = this.activeCrew();
    return crew.length > 0 && crew.every((m) => this.awards.byAuthor(m.playerId).length >= this.config.awards.perPlayer);
  }

  private openAwardVote(): void {
    if (this.awards.count === 0 || this.activeCrew().length < 2) return this.finish();
    this.phase = "AWARD_VOTE";
    this.schedule(this.config.timing.awardVoteMs, () => this.showAwardResults());
    this.ctx.changed();
  }

  private allAwardVotesIn(): boolean {
    const crew = this.activeCrew();
    return crew.length > 0 && crew.every((m) => this.awards.doneVoting(m.playerId));
  }

  private showAwardResults(): void {
    this.ctx.clearTimer();
    this.narration.newBeat();
    for (const r of this.awards.results((id) => this.crew.get(id)?.name ?? this.ctx.playerName(id))) {
      const who = r.winners.length ? r.winners.map((w) => w.name).join(" and ") : "nobody (no votes)";
      this.narration.add("award", this.stage, `${r.name}: ${who}.`);
      for (const w of r.winners) this.ctx.countStat(w.playerId, "awardsWon");
    }
    this.phase = "AWARD_RESULTS";
    this.schedule(this.config.timing.awardResultsMs, () => this.finish());
    this.ctx.changed();
  }

  private finish(): void {
    this.nextStep = null;
    this.ctx.clearTimer();
    const inc = this.incident;
    const nameOf = (id: string) => this.crew.get(id)?.name ?? this.ctx.playerName(id);
    const highlights: Highlight[] = [];
    if (this.ending) {
      highlights.push({
        title: ENDING_TEXT[this.ending.id].title,
        playerName: null,
        text: this.ending.narration,
        detail: `Incident ${inc.code} · ${inc.entity.ref} ${inc.entity.title} · ${inc.breach.name}`,
      });
    }
    for (const r of this.awards.results(nameOf)) {
      if (!r.winners.length) continue;
      highlights.push({
        title: r.name,
        playerName: r.winners.map((w) => w.name).join(" & "),
        text: r.description || null,
        detail: `Player-created award · ${r.winners[0]!.votes} vote${r.winners[0]!.votes === 1 ? "" : "s"}`,
      });
    }

    // The stage's best-voted move goes to the Hall of Fame, where a moderator may promote it.
    const best = this.records
      .flatMap((r) => r.plan.actions.map((a) => ({ record: r, action: a, votes: r.ballots.filter((b) => b.target === a.playerId).length })))
      .sort((x, y) => y.votes - x.votes)[0];
    if (best && best.votes > 0) {
      this.ctx.saveMoment({
        authorId: best.action.playerId,
        text: best.record.output.interpretations.find((i) => i.actionId === best.action.id)!.summary,
        context: `Incident ${inc.code}: ${inc.breach.name}. ${inc.problem.text}`,
        votes: best.votes,
        votesPossible: best.record.eligible,
      });
    }

    this.ctx.finish({ rounds: this.stage, highlights, details: { kind: "mycob.v1", data: this.record() } });
  }

  /** The structured game record for tuning and review. Server-side only; generated content, never canon. */
  private record(): unknown {
    const inc = this.incident;
    const start = this.initial;
    const players = [...this.crew.values()];
    return {
      canon: false,
      mode: this.settings.mode,
      length: this.settings.length,
      stagesPlanned: this.totalStages,
      stagesPlayed: this.stage,
      director: this.director.id,
      config: this.config,
      incident: {
        code: inc.code,
        entity: { ref: inc.entity.ref, title: inc.entity.title, classification: inc.entity.classification, containment: inc.entity.containment },
        initiallyUnknown: inc.entity.initiallyUnknown,
        identifiedAtStage: inc.entity.revealedStage,
        breach: { id: inc.breach.id, name: inc.breach.name, entitySpecific: !!inc.breach.entitySpecific },
        location: inc.location.id,
        problem: inc.problem,
        environment: inc.environment,
        rulesApplied: inc.rulesApplied,
        difficulty: inc.difficulty,
        notes: inc.notes,
        start: { stats: start.stats, systems: start.systems, personnel: start.personnel, objectives: start.objectives, facts: start.facts },
        final: {
          stats: inc.stats,
          systems: inc.systems,
          personnel: inc.personnel,
          objectives: inc.objectives,
          facts: inc.facts.map(({ id, label, source, ref, visibility, revealedStage }) => ({ id, label, source, ref, visibility, revealedStage })),
          entityStatus: inc.entity.status,
        },
        canonRefs: inc.canonRefs,
      },
      players: players.map((m) => ({
        playerId: m.playerId,
        name: m.name,
        startRole: m.startRoleId,
        finalRole: m.roleId,
        livesLost: m.livesLost,
        downs: m.downs,
        identity: m.identity,
        left: m.left,
      })),
      trades: this.trades,
      stages: this.records.map((r) => ({
        stage: r.stage,
        statsBefore: r.result.statsBefore,
        statsAfter: r.result.statsAfter,
        responses: r.plan.actions.map((a) => ({
          actionId: a.id,
          playerId: a.playerId,
          role: a.roleId,
          tag: a.tag,
          approach: a.approach,
          sacrifice: a.sacrifice,
          text: a.text,
          analysis: a.analysis,
          repeated: a.repeated,
          roll: a.roll,
        })),
        idle: r.plan.idle,
        hazards: r.plan.hazards,
        interactions: r.plan.interactions,
        specialEvent: r.plan.specialEvent?.id ?? null,
        newProblem: r.plan.newProblem?.def.id ?? null,
        director: r.director,
        interpretations: r.output.interpretations,
        applied: r.result.applied,
        lifeLosses: r.result.lifeLosses,
        personnelChanges: r.result.personnelChanges,
        systemChanges: r.result.systemChanges,
        reveals: r.result.reveals.map((f) => f.id),
        objectivesAdded: r.result.objectivesAdded,
        objectiveChanges: r.result.objectiveChanges,
        terminated: r.result.terminated,
        threatMoved: r.result.threatMoved,
        narration: r.narration,
        ballots: r.ballots,
        scores: r.scores,
      })),
      mvps: this.mvps,
      ending: this.ending,
      scores: { team: this.team, totals: Object.fromEntries(this.totals) },
      awards: this.awards.record(),
    };
  }

  // ------------------------------------------------------------------ input

  handleInput(playerId: string, action: string, payload: unknown): void {
    const member = this.crew.get(playerId);
    if (!member || member.left) throw new PartyError("NOT_ALLOWED");
    switch (action) {
      case "respond":
        return this.respond(member, asRecord(payload));
      case "vote":
        return this.vote(member, asRecord(payload));
      case "trade:offer":
        return this.tradeOffer(member, asRecord(payload));
      case "trade:accept":
        return this.tradeAccept(member, asRecord(payload));
      case "trade:cancel":
        this.offers.delete(member.playerId);
        return this.ctx.changed();
      case "trade:decline": {
        const from = asRecord(payload).from;
        if (typeof from === "string" && this.offers.get(from) === member.playerId) this.offers.delete(from);
        return this.ctx.changed();
      }
      case "award:submit":
        return this.submitAward(member, asRecord(payload));
      case "award:vote":
        return this.voteAward(member, asRecord(payload));
      default:
        throw new PartyError("INVALID_ACTION");
    }
  }

  private respond(member: CrewMember, payload: Record<string, unknown>): void {
    if (this.phase !== "RESPONSE") throw new PartyError("PHASE_CLOSED");
    const tag = payload.tag;
    if (typeof tag !== "string" || !RESPONSE_TAGS.includes(tag as ResponseTag)) throw new PartyError("INVALID_INPUT", "Pick what kind of response this is.");
    const approach = payload.approach === undefined ? "standard" : payload.approach;
    if (typeof approach !== "string" || !APPROACHES.includes(approach as Approach)) throw new PartyError("INVALID_INPUT");
    if (payload.sacrifice !== undefined && typeof payload.sacrifice !== "boolean") throw new PartyError("INVALID_INPUT");
    const text = cleanText(payload.text, this.config.response.textMax);
    if (!text.ok) throw new PartyError(text.reason === "TOO_LONG" ? "ANSWER_TOO_LONG" : "ANSWER_EMPTY");

    if (!this.responses.has(member.playerId)) this.ctx.countStat(member.playerId, "answersSubmitted");
    this.responses.set(member.playerId, {
      tag: tag as ResponseTag,
      text: text.value,
      approach: approach as Approach,
      sacrifice: payload.sacrifice === true,
    });
    if (this.allResponded()) return this.closeResponses();
    this.ctx.changed();
  }

  private vote(member: CrewMember, payload: Record<string, unknown>): void {
    if (this.phase !== "STAGE_VOTE") throw new PartyError("PHASE_CLOSED");
    if (!this.voters.includes(member.playerId)) throw new PartyError("NOT_ELIGIBLE", "You have nobody to vote for this stage.");
    if (this.votes.has(member.playerId)) throw new PartyError("ALREADY_VOTED");
    const target = payload.playerId;
    if (target === member.playerId) throw new PartyError("CANNOT_VOTE_OWN", "You can't vote for your own action.");
    if (typeof target !== "string" || !this.candidates().includes(target)) throw new PartyError("INVALID_VOTE");
    this.votes.set(member.playerId, target);
    if (this.allVoted()) return this.closeVote();
    this.ctx.changed();
  }

  private tradeOffer(member: CrewMember, payload: Record<string, unknown>): void {
    if (!TRADE_PHASES.includes(this.phase)) throw new PartyError("PHASE_CLOSED");
    const to = this.crew.get(String(payload.to));
    if (!to || to.left || to.playerId === member.playerId || to.roleId === member.roleId) throw new PartyError("TRADE_UNAVAILABLE");
    this.offers.set(member.playerId, to.playerId);
    this.ctx.changed();
  }

  private tradeAccept(member: CrewMember, payload: Record<string, unknown>): void {
    if (!TRADE_PHASES.includes(this.phase)) throw new PartyError("PHASE_CLOSED");
    const from = this.crew.get(String(payload.from));
    if (!from || from.left || this.offers.get(from.playerId) !== member.playerId) throw new PartyError("TRADE_UNAVAILABLE");
    [from.roleId, member.roleId] = [member.roleId, from.roleId];
    for (const [a, b] of [...this.offers]) {
      if ([a, b].some((id) => id === from.playerId || id === member.playerId)) this.offers.delete(a);
    }
    this.trades.push({ stage: this.stage, a: from.playerId, b: member.playerId });
    this.notify(from, "trade", `${member.name} took your offer. You're now ${roleOf(this.config, from.roleId).name}.`);
    this.notify(member, "trade", `Trade done. You're now ${roleOf(this.config, member.roleId).name}.`);
    this.ctx.changed();
  }

  private submitAward(member: CrewMember, payload: Record<string, unknown>): void {
    if (this.phase !== "AWARD_SUBMIT") throw new PartyError("PHASE_CLOSED");
    this.awards.submit(member.playerId, { awardId: payload.awardId, name: payload.name, description: payload.description });
    if (this.allAwardsIn()) return this.openAwardVote();
    this.ctx.changed();
  }

  private voteAward(member: CrewMember, payload: Record<string, unknown>): void {
    if (this.phase !== "AWARD_VOTE") throw new PartyError("PHASE_CLOSED");
    const eligible = this.activeCrew().map((m) => m.playerId);
    this.awards.vote(member.playerId, payload.awardId, payload.playerId, eligible);
    if (this.allAwardVotesIn()) return this.showAwardResults();
    this.ctx.changed();
  }

  hostAction(action: string): void {
    if (action !== "skip" || !this.nextStep) throw new PartyError("INVALID_ACTION");
    const step = this.nextStep;
    this.ctx.clearTimer();
    step();
  }

  playerLeft(playerId: string): void {
    const member = this.crew.get(playerId);
    if (member) member.left = true;
    for (const [a, b] of [...this.offers]) if (a === playerId || b === playerId) this.offers.delete(a);
    this.awards.forget(playerId);

    const enough = this.activeCrew().length >= this.config.players.minToContinue;
    if (!enough && STAGE_PHASES.includes(this.phase) && this.phase !== "PROCESSING") return this.endEarly();
    if (!enough && (this.phase === "AWARD_SUBMIT" || this.phase === "AWARD_VOTE")) return this.finish();
    if (this.phase === "RESPONSE" && this.allResponded()) return this.closeResponses();
    if (this.phase === "STAGE_VOTE" && this.allVoted()) return this.closeVote();
    if (this.phase === "AWARD_SUBMIT" && this.allAwardsIn()) return this.openAwardVote();
    if (this.phase === "AWARD_VOTE" && this.allAwardVotesIn()) return this.showAwardResults();
  }

  dispose(): void {
    this.disposed = true;
    this.nextStep = null;
    this.processing = null;
  }

  // ------------------------------------------------------------------ views

  /** Everything any screen may show about the incident right now. */
  private publicIncident() {
    const inc = this.incident;
    const known = inc.entity.identityKnown;
    const present = new Map(this.ctx.players().map((p) => [p.id, p.connected]));
    return {
      code: inc.code,
      mode: (({ id, name, emoji }) => ({ id, name, emoji }))(modeById(inc.mode) ?? MODES[0]!),
      stage: this.stage,
      totalStages: this.totalStages,
      entity: known
        ? { known: true, ref: inc.entity.ref, title: inc.entity.title, classification: inc.entity.classification, containment: inc.entity.containment }
        : { known: false },
      breach: { name: inc.breach.name, text: this.scrub(inc.breach.text), entitySpecific: !!inc.breach.entitySpecific },
      location: { name: inc.location.name, description: inc.location.description },
      problem: this.scrub(inc.problem.text),
      environment: inc.environment.map((e) => e.text),
      statuses: STAT_IDS.map((id) => describeStat(id, inc.stats[id], this.config)),
      systems: SYSTEM_IDS.map((id) => ({ id, name: SYSTEMS[id].name, condition: inc.systems[id] })),
      objectives: inc.objectives.map((o) => ({ id: o.id, kind: o.kind, text: this.scrub(o.text), status: o.status })),
      personnel: inc.personnel.map((p) => ({
        id: p.id,
        name: p.name,
        department: p.department,
        status: p.status,
        location: locationName(inc, p.location),
        relationship: p.relationship,
        source: p.source,
        ref: p.ref,
        url: p.url,
        controlledBy: p.controlledBy ? (this.crew.get(p.controlledBy)?.name ?? null) : null,
      })),
      facts: inc.facts.filter((f) => f.visibility === "known").map((f) => this.publicFact(f)),
      anomalies: inc.anomalies.map((a) => ({ name: a.name, text: a.text })),
      crew: [...this.crew.values()]
        .filter((m) => !m.left)
        .map((m) => ({
          playerId: m.playerId,
          name: m.name,
          role: roleOf(this.config, m.roleId).name,
          lives: m.lives,
          down: m.down,
          identity: m.identity,
          connected: present.get(m.playerId) ?? false,
          submitted: this.phase === "RESPONSE" ? this.responses.has(m.playerId) : undefined,
        })),
    };
  }

  private publicFact(f: Fact) {
    return {
      id: f.id,
      label: this.scrub(f.label),
      text: this.scrub(f.text),
      source: f.source,
      ref: f.about === "identity" || this.incident.entity.identityKnown || f.about !== "entity" ? f.ref : null,
      redacted: f.redacted,
      revealedStage: f.revealedStage,
    };
  }

  private consequenceView() {
    const plan = this.plan!;
    const output = this.output!;
    const result = this.result!;
    const before = (id: (typeof STAT_IDS)[number]) => describeStat(id, result.statsBefore[id], this.config);
    return {
      actions: plan.actions.map((a) => ({
        playerId: a.playerId,
        name: a.playerName,
        role: a.roleName,
        tag: a.tag,
        outcome: a.roll.outcome,
        outcomeLabel: OUTCOME_LABELS[a.roll.outcome],
        summary: output.interpretations.find((i) => i.actionId === a.id)!.summary,
      })),
      lifeLosses: result.lifeLosses
        .filter((l) => this.crew.has(l.playerId))
        .map((l) => ({ playerId: l.playerId, name: this.crew.get(l.playerId)!.name, reason: l.reason, down: this.crew.get(l.playerId)!.down })),
      discoveries: result.reveals.map((f) => this.publicFact(f)),
      personnelChanges: result.personnelChanges.map((c) => ({ name: c.name, to: c.to })),
      systemChanges: result.systemChanges.map((c) => ({ name: c.name, to: c.to })),
      objectiveChanges: result.objectiveChanges.map((c) => ({ text: this.scrub(c.text), to: c.to })),
      objectivesAdded: result.objectivesAdded.map((o) => ({ text: this.scrub(o.text) })),
      specialEvent: result.specialEvent,
      newProblem: result.newProblem,
      statusChanges: STAT_IDS.map((id) => ({ ...describeStat(id, result.statsAfter[id], this.config), from: before(id).value })).filter((s) => s.from !== s.value),
      terminated: result.terminated,
    };
  }

  private outcomeView() {
    const inc = this.incident;
    const ending = this.ending!;
    return {
      id: ending.id,
      title: ENDING_TEXT[ending.id].title,
      narration: ending.narration,
      stagesPlayed: this.stage,
      // The incident is over: the entity's file is open to everyone now.
      entity: { ref: inc.entity.ref, title: inc.entity.title, classification: inc.entity.classification, containment: inc.entity.containment, url: inc.entity.url },
      initiallyUnknown: inc.entity.initiallyUnknown,
      mvps: this.mvps.map((m) => ({ stage: m.stage, names: m.playerIds.map((id) => this.crew.get(id)?.name ?? "?"), votes: m.votes })),
      team: this.team,
      breakdown: [...this.crew.values()].map((m) => {
        const t = this.totals.get(m.playerId) ?? emptyScore();
        return {
          playerId: m.playerId,
          name: m.name,
          impact: t.impact + t.participation,
          chaos: t.chaos + t.bonus,
          creativity: t.creativity,
          role: t.role,
          votes: t.votes,
          sacrifice: t.sacrifice,
          team: this.team,
          total: t.total + this.team,
          livesLost: m.livesLost,
          downs: m.downs,
        };
      }),
    };
  }

  /** The extra information a role gives its holder. Built only from what that role may know. */
  private roleContext(member: CrewMember): { title: string; lines: string[] }[] {
    const inc = this.incident;
    const role = roleOf(this.config, member.roleId);
    const out: { title: string; lines: string[] }[] = [];
    for (const key of role.context) {
      switch (key) {
        case "objectives":
          out.push({
            title: "Command priorities",
            lines: inc.objectives
              .filter((o) => o.status === "active")
              .map((o) => `${o.kind === "primary" ? "PRIMARY" : "Secondary"}: ${this.scrub(o.text)}${o.goal.type === "stat" && o.goal.byStage ? ` (by stage ${o.goal.byStage})` : ""}`),
          });
          break;
        case "containment":
          out.push({
            title: "Containment readout",
            lines: [
              `Entity containment class: ${inc.entity.identityKnown ? inc.entity.containment : "UNKNOWN"}`,
              `Containment systems: ${inc.systems.containment.toUpperCase()}`,
              `Doors: ${inc.systems.doors.toUpperCase()}`,
            ],
          });
          break;
        case "leads": {
          const leads = inc.facts.filter((f) => f.visibility !== "known").slice(0, 3);
          out.push({
            title: "Research leads",
            lines: leads.length
              ? leads.map((f) => (f.about === "record" ? "A prior incident file mentions this" : f.about === "identity" ? "The entity's identity is on file somewhere" : this.scrub(f.label)))
              : ["Nothing left in the files. You've read it all."],
          });
          break;
        }
        case "systems": {
          const broken = SYSTEM_IDS.filter((s) => inc.systems[s] !== "nominal").sort((a, b) => (inc.systems[b] === "offline" ? 1 : 0) - (inc.systems[a] === "offline" ? 1 : 0));
          out.push({
            title: "Diagnostics",
            lines: broken.length ? [`Fix first: ${SYSTEMS[broken[0]!].name} (${inc.systems[broken[0]!].toUpperCase()})`, ...broken.slice(1).map((s) => `${SYSTEMS[s].name}: ${inc.systems[s].toUpperCase()}`)] : ["All systems nominal."],
          });
          break;
        }
        case "personnel":
          out.push({
            title: "Staff tracker",
            lines: inc.personnel
              .filter((p) => p.status !== "dead")
              .map((p) => `${p.name}: ${p.status.toUpperCase()}${p.knowledgeFactId && inc.facts.find((f) => f.id === p.knowledgeFactId)?.visibility !== "known" ? " · knows something" : ""}`),
          });
          break;
        case "threat":
          out.push({ title: "Tracking", lines: [`Entity last tracked: ${inc.threatLocation ? locationName(inc, inc.threatLocation) : "UNKNOWN"}`] });
          break;
        case "log":
          out.push({ title: "Incident log", lines: this.history.slice(-3).map((h, i, all) => `Stage ${this.records.length - all.length + i + 1}: ${h.slice(0, 160)}${h.length > 160 ? "…" : ""}`) });
          break;
        case "rumor": {
          const broken = SYSTEM_IDS.find((s) => inc.systems[s] !== "nominal");
          const rumors = [
            broken ? `Someone said the ${SYSTEMS[broken].name.toLowerCase()} is the real problem.` : "Someone said the facility is fine, actually.",
            "Someone said the entity is afraid of spreadsheets.",
            "Someone said there's a second exit behind the vending machine.",
            `Someone said ${pickDeterministic(inc.personnel.map((p) => p.name), member.playerId, this.stage) ?? "the custodian"} knows more than they're letting on.`,
            "Someone said the corn is listening.",
          ];
          out.push({ title: "Rumor (unverified)", lines: [pickDeterministic(rumors, member.playerId, this.stage)!] });
          break;
        }
      }
    }
    return out;
  }

  viewFor(viewer: Viewer): unknown {
    const playerId = viewer.kind === "player" ? viewer.playerId : null;
    const member = playerId ? this.crew.get(playerId) : undefined;
    const base = {
      phase: this.phase,
      stage: this.stage,
      totalStages: this.totalStages,
      incident: this.publicIncident(),
      narration: this.narration.current(playerId).map(({ id, type, text }) => ({ id, type, text })),
      tags: RESPONSE_TAGS,
      approaches: APPROACHES,
      maxLives: this.config.lives.start,
      limits: { textMax: this.config.response.textMax, awardNameMax: this.config.awards.nameMax, awardDescriptionMax: this.config.awards.descriptionMax },
    };

    const phaseView: Record<string, unknown> = {};
    if (this.phase === "RESPONSE") {
      phaseView.progress = { submitted: this.activeCrew().filter((m) => this.responses.has(m.playerId)).length, needed: this.activeCrew().length };
    }
    if (this.phase === "PROCESSING") phaseView.processing = { actions: this.plan?.actions.length ?? 0 };
    if (this.phase === "CONSEQUENCE" || this.phase === "STAGE_VOTE") phaseView.consequence = this.consequenceView();
    if (this.phase === "STAGE_VOTE") {
      const consequence = phaseView.consequence as ReturnType<MyCobGame["consequenceView"]>;
      const candidates = this.candidates();
      phaseView.vote = {
        candidates: consequence.actions.filter((a) => candidates.includes(a.playerId) && a.playerId !== playerId).map(({ playerId: id, name, summary }) => ({ playerId: id, name, summary })),
        cast: this.votes.size,
        needed: this.voters.length,
      };
    }
    if (this.phase === "OUTCOME" || this.phase.startsWith("AWARD")) phaseView.outcome = this.outcomeView();
    if (this.phase === "AWARD_SUBMIT") phaseView.awards = { submitted: this.awards.submitters().size, needed: this.activeCrew().length };
    if (this.phase === "AWARD_VOTE") {
      phaseView.awards = {
        list: this.awards.publicList(),
        recipients: this.activeCrew().map((m) => ({ playerId: m.playerId, name: m.name })).filter((r) => this.config.awards.allowSelfVote || r.playerId !== playerId),
        done: this.activeCrew().filter((m) => this.awards.doneVoting(m.playerId)).length,
        needed: this.activeCrew().length,
      };
    }
    if (this.phase === "AWARD_RESULTS") phaseView.awards = { results: this.awards.results((id) => this.crew.get(id)?.name ?? this.ctx.playerName(id)) };

    if (!member) return { ...base, ...phaseView };

    const role = roleOf(this.config, member.roleId);
    const response = this.responses.get(member.playerId) ?? null;
    const action = this.plan?.actions.find((a) => a.playerId === member.playerId);
    const you = {
      playerId: member.playerId,
      role: { id: role.id, name: role.name, blurb: role.blurb, strongTags: role.strongTags },
      lives: member.lives,
      maxLives: this.config.lives.start,
      down: member.down,
      identity: member.identity,
      context: this.roleContext(member),
      notices: member.notices.filter((n) => n.stage === this.stage).map(({ id, kind, text }) => ({ id, kind, text })),
      response,
      action:
        action && this.output && (this.phase === "CONSEQUENCE" || this.phase === "STAGE_VOTE")
          ? {
              outcome: action.roll.outcome,
              outcomeLabel: OUTCOME_LABELS[action.roll.outcome],
              summary: this.output.interpretations.find((i) => i.actionId === action.id)!.summary,
            }
          : null,
      lostLife: this.phase === "CONSEQUENCE" || this.phase === "STAGE_VOTE" ? (this.result?.lifeLosses.some((l) => l.playerId === member.playerId) ?? false) : false,
      trades: TRADE_PHASES.includes(this.phase)
        ? {
            outgoing: this.offers.get(member.playerId) ?? null,
            incoming: [...this.offers].filter(([, to]) => to === member.playerId).map(([from]) => from),
          }
        : null,
      yourVote: this.phase === "STAGE_VOTE" ? (this.votes.get(member.playerId) ?? null) : null,
      canVote: this.phase === "STAGE_VOTE" ? this.voters.includes(member.playerId) : false,
      awards:
        this.phase === "AWARD_SUBMIT"
          ? { mine: this.awards.byAuthor(member.playerId), perPlayer: this.config.awards.perPlayer }
          : this.phase === "AWARD_VOTE"
            ? { votes: this.awards.votesBy(member.playerId) }
            : null,
    };
    return { ...base, ...phaseView, you };
  }
}

/** Stable pick per agent and stage, so a rumor doesn't change on every refresh. */
function pickDeterministic<T>(items: readonly T[], playerId: string, stage: number): T | undefined {
  if (!items.length) return undefined;
  return items[hashString(`${playerId}:${stage}`) % items.length];
}

export interface MyCobOptions {
  /** The Incident Director. Defaults to the built-in mock; a model-backed director slots in here. */
  director?: IncidentDirector;
  /** Rule overrides on top of the defaults (tests, tuning experiments). */
  config?: ConfigOverrides;
}

const AVAILABLE_MODES = MODES.filter((m) => m.available).map((m) => m.id);

export function createMyCobGame(options: MyCobOptions = {}): GameDefinition<MyCobSettings> {
  const director = options.director ?? new MockIncidentDirector();
  const base = resolveConfig(DEFAULT_MYCOB_CONFIG, options.config);
  return {
    id: "mycob",
    name: "My Cob Escaped, What Do I Do Now???",
    tagline: "Something got out. Everyone has a role. Nobody has a plan.",
    description:
      "A random entity from the CPI Database has escaped and the incident is yours. Every stage, each agent types " +
      "what they do — anything at all — and the Incident Director works out what actually happens. Great ideas can " +
      "fail, terrible ones can work, and the incident keeps changing. Three lives each, anonymous votes every stage, " +
      "and at the end you invent the awards.",
    minPlayers: base.players.min,
    maxPlayers: base.players.max,
    defaultSettings: { mode: "incident_response", length: "standard", stages: base.lengths.standard.stages },
    catalog: {
      modes: MODES.map(({ id, name, emoji, tagline, available }) => ({ id, name, emoji, tagline, available })),
      lengths: LENGTHS.map((id) => ({ id, stages: base.lengths[id].stages })),
      stages: { min: base.stages.min, max: base.stages.max },
    },
    parseSettings(raw: unknown): MyCobSettings {
      const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      const mode = AVAILABLE_MODES.includes(input.mode as ModeId) ? (input.mode as ModeId) : "incident_response";
      const length = LENGTHS.includes(input.length as LengthId) ? (input.length as LengthId) : "standard";
      const preset = base.lengths[length].stages;
      const stages = input.stages === null || input.stages === undefined ? preset : clampInt(input.stages, base.stages.min, base.stages.max, preset);
      return { mode, length, stages };
    },
    create(ctx, settings) {
      return new MyCobGame(ctx, settings, configFor(settings, options.config), director);
    },
  };
}

export const myCobGame = createMyCobGame();
