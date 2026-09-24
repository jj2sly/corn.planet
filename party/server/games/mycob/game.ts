// MY COB ESCAPED, WHAT DO I DO NOW??? — an incident-response party game.
//
// A random CPI Database entity gets out. Agents are handed temporary roles (kept for the whole
// incident, unless they go down and come back as someone else) and three lives, and every stage each one files an open-ended response (a tag plus free text) from their phone. The
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
import type { GameContext, GameDefinition, GameDetails, GameInstance, Highlight, Viewer } from "../types.ts";
import {
  APPROACHES,
  DEFAULT_MYCOB_CONFIG,
  LENGTHS,
  MODES,
  modeById,
  RESPONSE_TAGS,
  resolveConfig,
  STAT_IDS,
  TEAM_STATS,
  type Approach,
  type ConfigOverrides,
  type EndingId,
  type LengthId,
  type ModeId,
  type MyCobConfig,
  type Outcome,
  type ResponseTag,
  type StatId,
} from "./config.ts";
import { DEPARTMENTS, ENDING_TEXT, NPC_FIRST, NPC_LAST, SYSTEM_IDS, SYSTEMS, type SystemId } from "./content.ts";
import {
  buildDirectorContext,
  MockIncidentDirector,
  validateDirectorOutput,
  validateNarration,
  type DirectorContext,
  type IncidentDirector,
  type NarrationRequest,
  type ValidatedOutput,
} from "./director.ts";
import {
  describeStat,
  evaluateObjectives,
  fill,
  generateIncident,
  locationName,
  OK_STATUSES,
  pick,
  publicBreach,
  publicEnvironment,
  scrubHidden,
  shuffle,
  STAT_NAMES,
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
  toneFor,
  type ActionInput,
  type ActionPlan,
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

const STAGE_PHASES: readonly Phase[] = ["ALERT", "UPDATE", "RESPONSE", "PROCESSING", "CONSEQUENCE", "STAGE_VOTE"];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  critical: "BRILLIANT",
  success: "IT WORKED",
  partial: "PARTIALLY",
  failure: "IT DIDN'T WORK",
  catastrophe: "CATASTROPHIC",
};

/**
 * Sound cues for the screens (public/js/games/mycob-sound.js turns them into sounds). Each is only
 * ever about something every screen is already being shown.
 */
export type SoundCue =
  | "game_start"
  | "response_in"
  | "major_failure"
  | "success"
  | "chaos_up"
  | "discovery"
  | "life_lost"
  | "vote_start"
  | "vote_result"
  | "escaped"
  | "contained"
  | "terminated"
  | "everyone_dies"
  | "game_end";

/** "INCIDENT STATUS" at the start of a stage: what just happened, what matters now, what changed. */
interface Recap {
  stage: number;
  happened: string[];
  now: string;
  changes: string[];
  /** Known risks: danger statuses, systems down, staff in trouble. */
  risks: string[];
  team: { lives: number; maxLives: number; back: string[]; lastLife: string[] };
  objectives: { done: number; total: number; primary: string; primaryStatus: string; deadline: string | null };
}

const IN_DANGER = ["critical", "trapped", "injured", "missing"];

interface Notice {
  id: string;
  stage: number;
  kind: "life" | "down" | "reassigned";
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
  private readonly history: string[] = [];
  private readonly records: StageRecord[] = [];
  private readonly mvps: { stage: number; playerIds: string[]; votes: number }[] = [];
  /** narration is null while the director is still writing the closing report. */
  private ending: { id: EndingId; stage: number; narration: string | null; template: string; narratedBy: "director" | "template" | null } | null = null;
  private totals = new Map<string, ScoreLine>();
  private team = 0;
  private nextStep: (() => void) | null = null;
  private disposed = false;
  private noticeSeq = 0;
  private recap: Recap | null = null;
  private cues: { id: number; cue: SoundCue }[] = [];
  private cueSeq = 0;

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

  private cue(...names: SoundCue[]): void {
    for (const cue of names) this.cues.push({ id: ++this.cueSeq, cue });
    // Screens play each cue once by id; only the recent ones matter.
    this.cues.splice(0, Math.max(0, this.cues.length - 12));
  }

  /** A fact's text for players. Canon text gets the stricter scrub: it is the entity's own file. */
  private factText(f: Fact): { label: string; text: string } {
    const partialNames = f.source === "canon";
    return { label: scrubHidden(f.label, this.incident, undefined, { partialNames }), text: scrubHidden(f.text, this.incident, undefined, { partialNames }) };
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
    const breach = publicBreach(inc);
    const environment = publicEnvironment(inc);
    this.narration.newBeat();
    this.narration.add(
      "incident_alert",
      0,
      this.scrub(`INCIDENT ${inc.code}: ${breach.name.toUpperCase()}. ${breach.text} ${inc.problem.text}`) +
        (environment.length ? ` ${environment.join(" ")}` : "") +
        (inc.entity.identityKnown ? ` Entity: ${inc.entity.title}.` : " Entity: UNKNOWN."),
    );
    this.phase = "ALERT";
    this.cue("game_start");
    this.schedule(this.config.timing.alertMs, () => this.beginStage());
    this.ctx.changed();

    // The director's own opening joins the alert if it arrives while the alert is still up.
    this.askNarration("opening", this.openingContext(), (text) => {
      if (this.phase !== "ALERT") return;
      this.narration.add("incident_alert", 0, text);
      this.ctx.changed();
    });
  }

  /** Asks the director for the opening or the closing report. Never blocks the game. */
  private askNarration(kind: NarrationRequest["kind"], context: Record<string, unknown>, apply: (text: string) => void, fallback: () => void = () => {}): void {
    const narrate = this.director.narrate?.bind(this.director);
    if (!narrate) return fallback();
    // At the end of the game there is nothing left to hide.
    const revealing = kind === "ending" ? new Set(this.incident.facts.map((f) => f.id)) : undefined;
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(narrate({ kind, context: structuredClone(context) }));
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending
      .then(
        (raw) => {
          if (this.disposed) return;
          const text = validateNarration(raw, this.incident, this.config.narration.maxLength, revealing);
          if (text) apply(text);
          else fallback();
        },
        (err: unknown) => {
          console.error(`[corn-planet-party] incident director ${kind} failed; using the template:`, err instanceof Error ? err.message : err);
          if (!this.disposed) fallback();
        },
      )
      .catch((err: unknown) => console.error("[corn-planet-party] could not apply the director's narration:", err));
  }

  private openingContext(): Record<string, unknown> {
    const inc = this.incident;
    const breach = publicBreach(inc);
    return {
      tone: toneFor(inc.stats),
      mode: modeById(inc.mode)?.name ?? inc.mode,
      incident: {
        code: inc.code,
        breach: { name: breach.name, text: this.scrub(breach.text) },
        location: inc.location.name,
        problem: inc.problem.text,
        environment: publicEnvironment(inc),
        // An unknown entity's identity is not sent at all: what the director does not know it cannot leak.
        entity: inc.entity.identityKnown
          ? { identityKnown: true, title: inc.entity.title, classification: inc.entity.classification, containment: inc.entity.containment }
          : { identityKnown: false },
        objectives: inc.objectives.map((o) => o.text),
      },
      crew: [...this.crew.values()].map((m) => ({ name: m.name, role: roleOf(this.config, m.roleId).name })),
    };
  }

  private endingContext(ending: EndingId): Record<string, unknown> {
    const inc = this.incident;
    return {
      ending: { id: ending, title: ENDING_TEXT[ending].title },
      stagesPlayed: this.stage,
      entity: { title: inc.entity.title, classification: inc.entity.classification, initiallyUnknown: inc.entity.initiallyUnknown, identifiedAtStage: inc.entity.revealedStage },
      stageNarrations: this.history,
      statuses: STAT_IDS.map((id) => describeStat(id, inc.stats[id], this.config)).map(({ name, value }) => `${name}: ${value}`),
      objectives: inc.objectives.map((o) => ({ text: o.text, status: o.status })),
      crew: [...this.crew.values()].map((m) => ({ name: m.name, livesLost: m.livesLost, wentDown: m.downs > 0 })),
      commendations: this.mvps.map((m) => ({ stage: m.stage, names: m.playerIds.map((id) => this.crew.get(id)?.name ?? "?") })),
    };
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

    const back: string[] = [];
    for (const member of this.crew.values()) {
      if (member.down && !member.left) {
        this.reassign(member);
        back.push(`${member.name} is back as ${member.identity}`);
      }
    }
    this.recap = this.buildRecap(back);

    this.phase = "UPDATE";
    this.schedule(this.config.timing.updateMs, () => this.openResponses());
    this.ctx.changed();
  }

  /** Built only from what the last consequence showed everyone, kept short enough for a phone. */
  private buildRecap(back: string[] = []): Recap {
    const inc = this.incident;
    const extra = this.recapStatus(back);
    const short = (text: string, max = 150) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
    const last = this.records.at(-1);
    if (!last) {
      const breach = publicBreach(inc);
      return { stage: this.stage, happened: [`${breach.name} in the ${inc.location.name}.`], now: short(this.scrub(inc.problem.text)), changes: [], ...extra };
    }
    const { plan, output, result } = last;
    const outcomes = plan.actions.map((a) => a.roll.outcome);
    const count = (of: Outcome[]) => outcomes.filter((o) => of.includes(o)).length;
    const tally = (
      [
        [count(["critical", "success"]), "worked"],
        [count(["partial"]), "half worked"],
        [count(["failure", "catastrophe"]), "went badly"],
      ] as const
    )
      .filter(([n]) => n > 0)
      .map(([n, what]) => `${n} ${what}`);
    const happened = [plan.actions.length ? `Stage ${last.stage}: ${tally.join(" · ")}.` : `Stage ${last.stage}: nobody acted.`];
    const drama: Record<Outcome, number> = { catastrophe: 4, critical: 3, failure: 2, success: 1, partial: 0 };
    const top = [...plan.actions].sort((a, b) => drama[b.roll.outcome] - drama[a.roll.outcome])[0];
    if (top) happened.push(short(output.interpretations.find((i) => i.actionId === top.id)!.summary));
    const hurt = result.lifeLosses.map((l) => this.crew.get(l.playerId)?.name).filter((n): n is string => !!n);
    if (hurt.length) happened.push(`${hurt.join(", ")} lost a life.`);

    const worst = STAT_IDS.filter((id) => id !== "chaos")
      .map((id) => describeStat(id, inc.stats[id], this.config))
      .find((st) => st.tone === "danger");
    const now = result.newProblem ?? (worst ? `${worst.name} is ${worst.value}.` : inc.problem.text);

    const identified = inc.entity.initiallyUnknown && inc.entity.revealedStage === last.stage ? [`Entity identified: ${inc.entity.title}`] : [];
    const discoveries = result.reveals
      .filter((f) => f.about !== "identity")
      .map((f) => {
        const { label, text } = this.factText(f);
        return `Discovered — ${label}: ${short(text, 60)}`;
      });
    const stats = STAT_IDS.map((id) => ({ was: describeStat(id, result.statsBefore[id], this.config), is: describeStat(id, result.statsAfter[id], this.config) }))
      .filter(({ was, is }) => was.value !== is.value)
      .map(({ was, is }) => `${is.name}: ${was.value} → ${is.value}`);
    const objectives = result.objectiveChanges.map((c) => `Objective ${c.to}: ${this.scrub(c.text)}`);
    const event = result.specialEvent ? [result.specialEvent.name] : [];
    const changes = [...identified, ...discoveries.slice(0, 1), ...stats.slice(0, 2), ...objectives, ...event].slice(0, 3).map((c) => short(c, 90));
    return { stage: this.stage, happened: happened.slice(0, 3), now: short(this.scrub(now)), changes, ...extra };
  }

  /** The standing parts of the recap: known risks, the team, objective progress. All already public. */
  private recapStatus(back: string[]): Pick<Recap, "risks" | "team" | "objectives"> {
    const inc = this.incident;
    const danger = STAT_IDS.map((id) => describeStat(id, inc.stats[id], this.config))
      .filter((st) => st.tone === "danger")
      .map((st) => `${st.name} ${st.value}`);
    const offline = SYSTEM_IDS.filter((id) => inc.systems[id] === "offline").map((id) => SYSTEMS[id].name);
    const hurt = inc.personnel.filter((p) => IN_DANGER.includes(p.status) && !p.controlledBy);
    const risks = [
      ...danger.slice(0, 2),
      ...(offline.length ? [`Offline: ${offline.slice(0, 2).join(", ")}${offline.length > 2 ? ` +${offline.length - 2}` : ""}`] : []),
      ...(hurt.length ? [`${hurt.length} staff in trouble`] : []),
      ...inc.anomalies.map((a) => a.name),
    ].slice(0, 3);
    const crew = this.activeCrew();
    const primary = inc.objectives.find((o) => o.kind === "primary")!;
    const due = inc.objectives
      .filter((o) => o.status === "active" && o.goal.type === "stat" && o.goal.byStage !== null)
      .sort((a, b) => ((a.goal as { byStage: number }).byStage ?? 0) - ((b.goal as { byStage: number }).byStage ?? 0))[0];
    return {
      risks,
      team: {
        lives: crew.reduce((n, m) => n + m.lives, 0),
        maxLives: crew.length * this.config.lives.start,
        back,
        lastLife: crew.filter((m) => m.lives === 1).map((m) => m.name),
      },
      objectives: {
        done: inc.objectives.filter((o) => o.status === "completed").length,
        total: inc.objectives.length,
        primary: this.scrub(primary.text),
        primaryStatus: primary.status,
        deadline: due ? `${this.scrub(due.text)} — by stage ${(due.goal as { byStage: number }).byStage}` : null,
      },
    };
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
        // A copy: this stage's tag is pushed next and must not count as a repeat of itself.
        previousTags: [...member.tags],
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
        // No point waiting out the whole window for an answer that isn't coming.
        if (this.disposed || this.processing?.token !== token || this.phase !== "PROCESSING") return;
        const wait = Math.max(0, this.config.timing.processingMinMs - (Date.now() - started));
        this.schedule(wait, () => this.completeProcessing());
        this.ctx.changed();
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
    const event = result.specialEvent;
    if (event && !output.narration.includes(event.text)) {
      const named = event.text.toLowerCase().startsWith(event.name.toLowerCase());
      this.narration.add("special_event", this.stage, named ? event.text : `${event.name}: ${event.text}`);
    }
    for (const fact of result.reveals) {
      const { label, text } = this.factText(fact);
      this.narration.add("discovery", this.stage, `Discovered — ${label}: ${text}`);
    }
    for (const change of result.objectiveChanges) this.narration.add("objective_update", this.stage, `Objective ${change.to}: ${this.scrub(change.text)}`);
    for (const o of result.objectivesAdded) this.narration.add("objective_update", this.stage, `New objective: ${this.scrub(o.text)}`);

    // Lives: told to everyone at once, and to the agent on their own phone.
    const amount = this.config.lives.maxLossPerConsequence;
    let livesLost = 0;
    for (const loss of result.lifeLosses) {
      const member = this.crew.get(loss.playerId);
      if (!member || member.left || member.lives <= 0) continue;
      livesLost++;
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

    const outcomes = plan.actions.map((a) => a.roll.outcome);
    const chaosLabels = this.config.stats.labels.chaos.map((l) => l.label);
    const chaosRank = (value: number) => chaosLabels.indexOf(describeStat("chaos", value, this.config).value);
    if (outcomes.some((o) => o === "critical" || o === "success")) this.cue("success");
    if (outcomes.includes("catastrophe") || (outcomes.length > 0 && outcomes.every((o) => o === "failure"))) this.cue("major_failure");
    if (result.reveals.length) this.cue("discovery");
    // Labels run highest first, so a lower index is more chaos.
    if (chaosRank(result.statsAfter.chaos) < chaosRank(result.statsBefore.chaos)) this.cue("chaos_up");
    if (livesLost) this.cue("life_lost");

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
    this.cue("vote_start");
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
    if (top > 0) {
      this.mvps.push({ stage: this.stage, playerIds: [...counts].filter(([, n]) => n === top).map(([id]) => id), votes: top });
      this.cue("vote_result");
    }

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
    const template = text.charAt(0).toUpperCase() + text.slice(1) + tail;
    this.ending = { id: ending, stage: this.stage, narration: null, template, narratedBy: null };
    this.narration.newBeat();
    this.narration.add("ending", this.stage, `${ENDING_TEXT[ending].title}.`);

    // The closing report: the director's if it has one, otherwise (or on any failure) the template.
    const settle = (narration: string, by: "director" | "template") => {
      const e = this.ending;
      if (!e || e.narration !== null) return;
      e.narration = narration;
      e.narratedBy = by;
      if (this.phase === "OUTCOME") this.narration.add("ending", this.stage, narration);
      this.ctx.changed();
    };

    this.phase = "OUTCOME";
    const awardsPossible = this.config.awards.enabled && this.activeCrew().length >= 2;
    this.cue(ending);
    if (!awardsPossible) this.cue("game_end");
    this.schedule(this.config.timing.outcomeMs, () => (awardsPossible ? this.openAwardSubmit() : this.finish()));
    this.ctx.changed();
    // After the phase change, so a template settled at once still reaches the screens.
    this.askNarration("ending", this.endingContext(ending), (t) => settle(t, "director"), () => settle(template, "template"));
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
    this.cue("game_end");
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
        text: this.ending.narration ?? this.ending.template,
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
    const best = this.bestMove();
    if (best) {
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

  /** The most-voted move of the incident, if anyone got a vote. */
  private bestMove() {
    const best = this.records
      .flatMap((r) => r.plan.actions.map((a) => ({ record: r, action: a, votes: r.ballots.filter((b) => b.target === a.playerId).length })))
      .sort((x, y) => y.votes - x.votes)[0];
    return best && best.votes > 0 ? best : null;
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
        lives: m.lives,
        down: m.down,
        livesLost: m.livesLost,
        downs: m.downs,
        identity: m.identity,
        left: m.left,
      })),
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

  /**
   * The record so far, when the game ends without finishing (the room saves it apart from finished
   * games). Adds where it stopped and the current stage's responses if they were never processed.
   * Server-side only, like record().
   */
  abortDetails(): GameDetails {
    const unprocessed = !this.records.some((r) => r.stage === this.stage);
    return {
      kind: "mycob.v1",
      data: {
        ...(this.record() as Record<string, unknown>),
        aborted: {
          phase: this.phase,
          stage: this.stage,
          pendingResponses: unprocessed ? [...this.responses].map(([playerId, r]) => ({ playerId, ...r })) : [],
        },
      },
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

    if (!this.responses.has(member.playerId)) {
      this.ctx.countStat(member.playerId, "answersSubmitted");
      this.cue("response_in");
    }
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
    const breach = publicBreach(inc);
    return {
      code: inc.code,
      mode: (({ id, name, emoji }) => ({ id, name, emoji }))(modeById(inc.mode) ?? MODES[0]!),
      stage: this.stage,
      totalStages: this.totalStages,
      entity: known
        ? { known: true, ref: inc.entity.ref, title: inc.entity.title, classification: inc.entity.classification, containment: inc.entity.containment }
        : { known: false },
      breach: { name: breach.name, text: this.scrub(breach.text), entitySpecific: breach.entitySpecific },
      location: { name: inc.location.name, description: inc.location.description },
      problem: this.scrub(inc.problem.text),
      environment: publicEnvironment(inc),
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
        // No database links until the entity is identified: nothing public points back at it.
        ref: known ? p.ref : null,
        url: known ? p.url : null,
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
          roleIcon: roleOf(this.config, m.roleId).icon,
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
      ...this.factText(f),
      source: f.source,
      // Database ids only once the entity is identified: until then any of them could lead to it.
      ref: this.incident.entity.identityKnown ? f.ref : null,
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
        roleIcon: roleOf(this.config, a.roleId).icon,
        // Who this move ran into or worked with. The narration tells it too.
        with: plan.interactions
          .filter((i) => i.a === a.id || i.b === a.id)
          .map((i) => {
            const other = plan.actions.find((x) => x.id === (i.a === a.id ? i.b : i.a))?.playerName ?? "someone";
            return i.kind === "synergy" ? `teamed up with ${other}` : `clashed with ${other}`;
          }),
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
      statusChanges: STAT_IDS.map((id) => ({
        ...describeStat(id, result.statsAfter[id], this.config),
        from: before(id).value,
        // Labels are ordered, so which way it moved is public once the label changed. More chaos is worse.
        better: id === "chaos" ? result.statsAfter[id] < result.statsBefore[id] : result.statsAfter[id] > result.statsBefore[id],
      })).filter((s) => s.from !== s.value),
      terminated: result.terminated,
      next: this.nextStepText(),
    };
  }

  /** What happens after the consequence, in one line. */
  private nextStepText(): string {
    const candidates = this.candidates();
    const vote = this.config.voting.enabled && this.activeCrew().some((m) => candidates.some((c) => c !== m.playerId));
    const last = this.stage >= this.totalStages || this.result?.terminated;
    const after = last ? "the final report" : `stage ${this.stage + 1}${this.stage >= this.config.endings.minStage ? " (unless it's over)" : ""}`;
    return vote ? `Vote for the best move, then ${after}.` : `Next: ${after}.`;
  }

  /** Why your move went the way it did: the engine's reasons, in words, never numbers. Yours only. */
  private whyFor(action: ActionPlan): string[] {
    const plan = this.plan!;
    const role = roleOf(this.config, action.roleId);
    const nameOf = (id: string) => plan.actions.find((a) => a.id === id)?.playerName ?? "someone";
    const out: string[] = [];
    const team: string[] = [];
    for (const i of plan.interactions.filter((x) => x.a === action.id || x.b === action.id)) {
      const other = nameOf(i.a === action.id ? i.b : i.a);
      if (i.kind === "synergy") team.push(other);
      else if (i.affected === action.id) out.push(i.kind === "sabotage" ? `${other}'s move got in your way` : `${other}'s move accidentally helped`);
      else out.push(`Clashed with ${other}`);
    }
    // One line however many joined in, so the rest of the reasons still fit.
    if (team.length) out.unshift(`Teamed up with ${team.length > 2 ? `${team.slice(0, -1).join(", ")} and ${team.at(-1)}` : team.join(" and ")}`);
    if (role.strongTags.includes(action.tag)) out.push("★ Your role's strength");
    else if (role.weakTags.includes(action.tag)) out.push("Not your role's strength");
    if (action.approach === "careful") out.push("Careful: steadier, smaller");
    if (action.approach === "reckless") out.push("Reckless: bigger swing");
    if (action.sacrifice) out.push("You put yourself in harm's way");
    if (action.analysis.actionCount > 1) out.push(`Tried ${action.analysis.actionCount} things at once`);
    // From the agent's own history (this stage's tag is already its last entry), not action.repeated.
    if (this.crew.get(action.playerId)?.tags.at(-2) === action.tag) out.push("Same move as last stage");
    if (action.analysis.references.length) out.push("Aimed at something specific");
    if (action.roll.twist) out.push("Something unexpected happened");
    if ((this.result?.statsBefore.chaos ?? 0) >= 60) out.push("Chaos made it unpredictable");
    return out.slice(0, 4);
  }

  /** Which way your move pushed each part of the incident: direction and roughly how hard. */
  private causedBy(action: ActionPlan): { name: string; up: boolean; big: boolean }[] {
    const applied = this.result?.applied.find((a) => a.actionId === action.id);
    if (!applied) return [];
    const moved = STAT_IDS.filter((id) => id !== "chaos" && Math.round(applied.deltas[id] ?? 0) !== 0).map((id) => {
      const d = applied.deltas[id]!;
      return { name: STAT_NAMES[id], up: d > 0, big: Math.abs(d) >= 8 };
    });
    if (applied.chaos >= 3 || applied.chaos <= -3) moved.push({ name: STAT_NAMES.chaos, up: applied.chaos > 0, big: Math.abs(applied.chaos) >= 8 });
    return moved;
  }

  private outcomeView() {
    const inc = this.incident;
    const ending = this.ending!;
    const best = this.bestMove();
    return {
      id: ending.id,
      title: ENDING_TEXT[ending.id].title,
      narration: ending.narration,
      stagesPlayed: this.stage,
      // The incident is over: the entity's file is open to everyone now.
      entity: { ref: inc.entity.ref, title: inc.entity.title, classification: inc.entity.classification, containment: inc.entity.containment, url: inc.entity.url },
      initiallyUnknown: inc.entity.initiallyUnknown,
      mvps: this.mvps.map((m) => ({ stage: m.stage, names: m.playerIds.map((id) => this.crew.get(id)?.name ?? "?"), votes: m.votes })),
      bestMove: best
        ? { stage: best.record.stage, name: best.action.playerName, summary: best.record.output.interpretations.find((i) => i.actionId === best.action.id)!.summary, votes: best.votes }
        : null,
      summary: {
        objectives: { completed: inc.objectives.filter((o) => o.status === "completed").length, total: inc.objectives.length },
        discoveries: inc.facts.filter((f) => f.revealedStage !== null).length,
        livesLost: [...this.crew.values()].reduce((n, m) => n + m.livesLost, 0),
        downs: [...this.crew.values()].reduce((n, m) => n + m.downs, 0),
        staffEvacuated: inc.personnel.filter((p) => p.status === "evacuated").length,
        staffLost: inc.personnel.filter((p) => p.status === "dead").length,
        identifiedAt: inc.entity.initiallyUnknown ? inc.entity.revealedStage : null,
        chaos: describeStat("chaos", inc.stats.chaos, this.config).value,
      },
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

  /**
   * What a role gives its holder: `read`, the one line that matters most right now, and `context`,
   * the fuller intel. Only this agent's phone gets it. Each role reads a different part of the incident
   * (some from hidden state, always as words), so every role has something nobody else has.
   */
  private roleIntel(member: CrewMember): { read: string; context: { title: string; lines: string[] }[] } {
    const inc = this.incident;
    const role = roleOf(this.config, member.roleId);
    const where = (id: string | null) => locationName(inc, id);
    const fragile = () => {
      const weakest = TEAM_STATS.reduce((a, b) => (inc.stats[b] < inc.stats[a] ? b : a));
      return `${STAT_NAMES[weakest]} (${describeStat(weakest, inc.stats[weakest], this.config).value})`;
    };
    const leadLine = (f: Fact) => (f.about === "record" ? "A prior incident file mentions this" : f.about === "identity" ? "The entity's identity is on file somewhere" : this.scrub(f.label));
    const leads = inc.facts.filter((f) => f.visibility !== "known");
    const broken = SYSTEM_IDS.filter((id) => inc.systems[id] !== "nominal").sort((a, b) => (inc.systems[b] === "offline" ? 1 : 0) - (inc.systems[a] === "offline" ? 1 : 0));
    const drags = (id: SystemId) => {
      const effects = SYSTEMS[id].effects[inc.systems[id] as "degraded" | "offline"] ?? {};
      return Object.keys(effects).map((k) => STAT_NAMES[k as StatId].toLowerCase()).join(" and ");
    };
    const inDanger = inc.personnel
      .filter((p) => IN_DANGER.includes(p.status) && !p.controlledBy)
      .sort((a, b) => IN_DANGER.indexOf(a.status) - IN_DANGER.indexOf(b.status));
    const last = this.records.at(-1);

    switch (role.context[0]) {
      case "objectives": {
        const active = inc.objectives.filter((o) => o.status === "active");
        const byDeadline = (o: (typeof active)[number]) => (o.kind === "primary" ? -1 : o.goal.type === "stat" && o.goal.byStage ? o.goal.byStage : 99);
        // The Commander's own edge: how far each measurable objective is from done, from hidden state, in words.
        const distance = (o: (typeof active)[number]): string | null => {
          const g = o.goal;
          if (g.type === "contain" && g.identify && !inc.entity.identityKnown) return "identify it first";
          const gap = g.type === "contain" ? g.atLeast - inc.stats.containment : g.type === "stat" ? g.atLeast - inc.stats[g.stat] : null;
          if (g.type === "survive") return inc.stats.personnel - g.atLeast > 15 ? "holding" : "at risk";
          return gap === null ? null : gap <= 10 ? "within reach" : gap <= 25 ? "a way off" : "far off";
        };
        const primary = active.find((o) => o.kind === "primary");
        const primaryDistance = primary ? distance(primary) : null;
        return {
          read: `Most fragile right now: ${fragile()}. ${primaryDistance ? `Primary objective: ${primaryDistance}.` : "Put someone on it."}`,
          context: [
            {
              title: "Command priorities",
              lines: [...active]
                .sort((a, b) => byDeadline(a) - byDeadline(b))
                .map((o) => {
                  const d = distance(o);
                  return `${o.kind === "primary" ? "PRIMARY" : "Secondary"}: ${this.scrub(o.text)}${o.goal.type === "stat" && o.goal.byStage ? ` (by stage ${o.goal.byStage})` : ""}${d ? ` · ${d}` : ""}`;
                }),
            },
          ],
        };
      }
      case "containment": {
        const d = last ? last.result.statsAfter.containment - last.result.statsBefore.containment : 0;
        const trend = Math.abs(d) < 2 ? "steady" : d > 0 ? "improving" : "slipping";
        const goal = describeStat("containment", this.config.endings.containedAt, this.config).value;
        const early = this.stage < this.config.endings.minStage ? `, from stage ${this.config.endings.minStage}` : "";
        return {
          read: `Containment is ${last ? `${trend} (${describeStat("containment", inc.stats.containment, this.config).value})` : describeStat("containment", inc.stats.containment, this.config).value}. It's contained at ${goal}${early}.`,
          context: [
            {
              title: "Containment readout",
              lines: [
                `Entity containment class: ${inc.entity.identityKnown ? inc.entity.containment : "UNKNOWN"}`,
                `Containment systems: ${inc.systems.containment.toUpperCase()}`,
                `Doors: ${inc.systems.doors.toUpperCase()}`,
              ],
            },
          ],
        };
      }
      case "leads": {
        const read = !inc.entity.identityKnown
          ? inc.stats.information >= this.config.unknownEntity.identifyInformationAt
            ? "Enough is known: a successful investigation could identify the entity now."
            : "Not enough to identify the entity yet. Work the leads."
          : leads.length
            ? `${leads.length} file${leads.length === 1 ? "" : "s"} still unread. Investigating finds them.`
            : "You've read everything on file.";
        return { read, context: [{ title: "Research leads", lines: leads.length ? leads.slice(0, 3).map(leadLine) : ["Nothing left in the files."] }] };
      }
      case "systems": {
        const first = broken[0];
        return {
          read: first ? `Fix first: ${SYSTEMS[first].name} (${inc.systems[first].toUpperCase()}) — it's dragging down ${drags(first)}.` : "Every system is running. Keep it that way.",
          context: [{ title: "Diagnostics", lines: broken.length ? broken.map((id) => `${SYSTEMS[id].name}: ${inc.systems[id].toUpperCase()} · hurts ${drags(id)}`) : ["All systems nominal."] }],
        };
      }
      case "personnel": {
        const worst = inDanger[0];
        return {
          read: worst ? `${worst.name} is ${worst.status.toUpperCase()} in the ${where(worst.location)}. Get them out.` : "Nobody is in danger right now.",
          context: [
            {
              title: "Staff tracker",
              lines: inc.personnel
                .filter((p) => p.status !== "dead")
                .map((p) => `${p.name}: ${p.status.toUpperCase()} · ${where(p.location)}${p.knowledgeFactId && inc.facts.find((f) => f.id === p.knowledgeFactId)?.visibility !== "known" ? " · knows something" : ""}`),
            },
          ],
        };
      }
      case "threat": {
        const near = inc.threatLocation ? inc.personnel.filter((p) => p.location === inc.threatLocation && p.status !== "dead" && p.status !== "evacuated") : [];
        return {
          read: inc.threatLocation
            ? `It was last tracked in the ${where(inc.threatLocation)}.${near.length ? ` ${near.map((p) => p.name).join(", ")} ${near.length === 1 ? "is" : "are"} there.` : ""}`
            : "Nobody knows where it is. Go and find it.",
          context: [{ title: "Tracking", lines: [`Entity last tracked: ${inc.threatLocation ? where(inc.threatLocation) : "UNKNOWN"}`, ...near.map((p) => `Nearby: ${p.name} (${p.status.toUpperCase()})`)] }],
        };
      }
      case "log": {
        const tally = new Map<string, { worked: number; total: number }>();
        for (const r of this.records) {
          for (const a of r.plan.actions) {
            const t = tally.get(a.tag) ?? { worked: 0, total: 0 };
            t.total++;
            if (a.roll.outcome === "critical" || a.roll.outcome === "success") t.worked++;
            tally.set(a.tag, t);
          }
        }
        const ranked = [...tally].sort(([, a], [, b]) => b.worked / b.total - a.worked / a.total || b.total - a.total);
        const repeating = this.activeCrew().filter((m) => m.tags.length >= 2 && m.tags.at(-1) === m.tags.at(-2));
        const read = repeating.length
          ? `${repeating[0]!.name} keeps going ${repeating[0]!.tags.at(-1)} — doing the same thing again works less well.`
          : ranked.length
            ? `${ranked[0]![0]} has worked ${ranked[0]![1].worked} of ${ranked[0]![1].total} times so far.`
            : "Nothing on record yet. Watch what works.";
        return {
          read,
          context: [
            { title: "What's been working", lines: ranked.length ? ranked.map(([tag, t]) => `${tag}: worked ${t.worked} of ${t.total}`) : ["No record yet."] },
            { title: "Incident log", lines: this.history.slice(-2).map((h, i, all) => `Stage ${this.records.length - all.length + i + 1}: ${h.slice(0, 120)}${h.length > 120 ? "…" : ""}`) },
          ],
        };
      }
      case "rumor":
      default: {
        // About half the time the rumor is true: a real lead, the real weakest system, the real weak spot.
        const truths = [
          leads[0] ? `Someone said to look into this: ${leadLine(leads[0])}.` : null,
          broken[0] ? `Someone said the ${SYSTEMS[broken[0]].name.toLowerCase()} is the real problem.` : null,
          `Someone said ${fragile().split(" (")[0]!.toLowerCase()} is about to give.`,
        ].filter((t): t is string => !!t);
        const nonsense = [
          "Someone said the entity is afraid of spreadsheets.",
          "Someone said there's a second exit behind the vending machine.",
          `Someone said ${pickDeterministic(inc.personnel.map((p) => p.name), member.playerId, this.stage) ?? "the custodian"} knows more than they're letting on.`,
          "Someone said the corn is listening.",
        ];
        const rumor = pickDeterministic([...truths, ...nonsense.slice(0, truths.length)], member.playerId, this.stage)!;
        return { read: rumor, context: [{ title: "Rumor (unverified)", lines: [rumor] }] };
      }
    }
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
      cues: this.cues.map((c) => ({ ...c })),
      tags: RESPONSE_TAGS,
      approaches: APPROACHES,
      maxLives: this.config.lives.start,
      limits: { textMax: this.config.response.textMax, awardNameMax: this.config.awards.nameMax, awardDescriptionMax: this.config.awards.descriptionMax },
    };

    const phaseView: Record<string, unknown> = {};
    if (this.phase === "UPDATE" && this.recap) phaseView.recap = this.recap;
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
      role: { id: role.id, name: role.name, icon: role.icon, blurb: role.blurb, strongTags: role.strongTags, goodAt: role.goodAt, onlyYou: role.onlyYou, tryThis: role.tryThis },
      lives: member.lives,
      maxLives: this.config.lives.start,
      down: member.down,
      identity: member.identity,
      ...this.roleIntel(member),
      // This stage's notices; the ending screens start clean.
      notices: STAGE_PHASES.includes(this.phase) ? member.notices.filter((n) => n.stage === this.stage).map(({ id, kind, text }) => ({ id, kind, text })) : [],
      response,
      action:
        action && this.output && (this.phase === "CONSEQUENCE" || this.phase === "STAGE_VOTE")
          ? {
              outcome: action.roll.outcome,
              outcomeLabel: OUTCOME_LABELS[action.roll.outcome],
              summary: this.output.interpretations.find((i) => i.actionId === action.id)!.summary,
              why: this.whyFor(action),
              caused: this.causedBy(action),
            }
          : null,
      lostLife: this.phase === "CONSEQUENCE" || this.phase === "STAGE_VOTE" ? (this.result?.lifeLosses.some((l) => l.playerId === member.playerId) ?? false) : false,
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
