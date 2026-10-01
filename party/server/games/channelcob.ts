// CHANNEL COB — 2–8 agents improvise a live CPI news broadcast out loud. Every agent holds a
// broadcast role with a short private brief that disagrees with everyone else's. The big screen runs
// the show (who is on air, the ticker, the countdown); phones hold the private notes, quick on-air
// decisions and breaking news only that role knows — until someone goes live with it.
//
// Nothing is judged by AI. Accuracy is how well the room understood the truth after each segment
// (a one-tap fact check), coherence is whether the room agrees on one story, and the rest comes
// from decisions and how fast breaking news got on air.
//
// Canon: only record titles and an entity's classification/containment are used, the same fields
// other games show. Nothing is written back. Without canon the game uses fallback scenarios.

import { PartyError } from "../errors.ts";
import { CHANNEL_COB_TUTORIAL, GroupTutorial, TUTORIAL_STEP_MS } from "./tutorial.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "./types.ts";

export interface ChannelCobSettings {
  segments: number;
  liveSeconds: number;
  prepSeconds: number;
  /** Run the group tutorial first (it ends at once when every phone has seen it before). */
  tutorial: boolean;
}

export const COB_TIMING = {
  introMs: 8_000,
  pollMs: 20_000,
  recapMs: 12_000,
  finaleMs: 25_000,
  turnsPerSegment: 6,
};

export const COB_POINTS = { scoop: 100, decision: 25, correct: 50, mvp: 75, confirm: 25 };

// ------------------------------------------------------------------ roles

export type RoleId = "anchor" | "reporter" | "spokesperson" | "expert" | "eyewitness" | "investigator" | "hazard" | "production";

interface RoleDef {
  id: RoleId;
  name: string;
  glyph: string;
  job: string;
  prompts: readonly string[];
}

/** Assigned in this order, so small games always have an anchor, a reporter and CPI's mouthpiece. */
export const ROLES: readonly RoleDef[] = [
  { id: "anchor", name: "News Anchor", glyph: "🎙️", job: "Run the show. Introduce the story, question the others, hand off.", prompts: ["Recap the story for viewers just joining.", "Ask {next} what's going on.", "Press {spokes} on why the alarms are sounding.", "Read the ticker out loud like it's urgent.", "Thank everyone and pretend this is fine."] },
  { id: "reporter", name: "Field Reporter", glyph: "📡", job: "You're at the scene. Describe what you see. Don't read your notes word for word.", prompts: ["Something just moved behind you.", "Describe the smell. Be specific.", "Interview someone nearby (point at a player).", "You've been here for hours. Show it.", "Tell the anchor they're not getting the full picture."] },
  { id: "spokesperson", name: "CPI Spokesperson", glyph: "🏛️", job: "Keep the public calm. Protect the CPI. Never admit more than you must.", prompts: ["Deny responsibility.", "Blame the weather.", "Thank the public for its patience.", "Say 'routine' at least twice.", "Call the last report 'speculation'."] },
  { id: "expert", name: "Expert Analyst", glyph: "🧠", job: "Explain the entity and the danger. Use big words.", prompts: ["Explain what happens if containment fails.", "Draw an invisible diagram in the air.", "Disagree with the last speaker, politely.", "Give a probability. Make it oddly precise.", "Explain it again, simpler, for the anchor."] },
  { id: "eyewitness", name: "Eyewitness", glyph: "👀", job: "You saw it. Probably. Tell your story with total confidence.", prompts: ["Describe what you saw. Add one detail.", "Contradict the reporter.", "Mention your cousin, who also saw it.", "Get emotional about it.", "Change one detail of your story."] },
  { id: "investigator", name: "Investigative Reporter", glyph: "🕵️", job: "You have leaks. Expose the truth before CPI shuts you down.", prompts: ["Hint that you know more.", "Ask the spokesperson about the leak.", "Reveal one leaked detail.", "Say 'sources tell me'.", "Accuse someone of a cover-up."] },
  { id: "hazard", name: "Weather & Hazard Desk", glyph: "🌪️", job: "Track the hazards. Warn people, or reassure them.", prompts: ["Show us the hazard map (gesture at the TV).", "Give the five-minute forecast.", "Rate the danger from 1 to corn.", "Tell viewers what to bring indoors.", "Announce a brand-new hazard category."] },
  { id: "production", name: "Camera & Production", glyph: "🎬", job: "Keep Channel Cob on air. Call cuts, cue people, fix problems.", prompts: ["Tell the anchor to wrap it up.", "Call 'cut to the field!'", "Announce a technical difficulty.", "Count someone in: '3, 2, 1…'", "Whisper-shout instructions at the anchor."] },
];
const ROLE_BY_ID = new Map(ROLES.map((r) => [r.id, r]));

// ------------------------------------------------------------------ scenario

type FactKey = "status" | "cause" | "whereabouts";

interface Fact {
  question: string;
  truth: string;
  official: string;
  rumor: string;
  decoy: string;
}

interface Scenario {
  entity: string;
  entityRef: string | null;
  classification: string;
  containment: string;
  location: string;
  location2: string;
  location3: string;
  second: string;
  incident: string | null;
  official: string | null;
  headline: string;
  observation: string;
  hazard: string;
  facts: Record<FactKey, Fact>;
}

const FALLBACK_ENTITIES = [
  { title: "The Husk Walker", classification: "LOCAL", containment: "ENHANCED" },
  { title: "Specimen 4 (the one with the hat)", classification: "EARTHLY", containment: "STANDARD" },
  { title: "The Grain Shade", classification: "COSMIC", containment: "MAXIMUM" },
];
const LOCATIONS = ["the Westfield Grain Elevator", "the Route 9 Corn Maze", "Millbrook Public Library", "the CPI Site-3 Visitor Centre", "the county fairgrounds", "a Dairy Barn in Oakhollow", "the Elm Street laundromat"];
const CAUSES = [
  { truth: "A guard propped the cell door open for a pizza delivery.", official: "Scheduled maintenance.", rumor: "It was let out on purpose.", decoy: "A solar flare." },
  { truth: "An intern fed it after midnight.", official: "A routine containment test.", rumor: "Aliens. Obviously.", decoy: "A burst water pipe." },
  { truth: "Budget cuts removed the locks.", official: "An authorised field exercise.", rumor: "A rival agency sabotaged it.", decoy: "A rogue vending machine." },
];
const OBSERVATIONS = ["Corn husks are scattered in a perfect spiral.", "The streetlights are flickering in a pattern.", "There's a large, warm dent in a parked car.", "Every dog in the area is staring the same direction.", "A CPI van is parked badly and nobody is in it."];
const HAZARDS = ["Corn-scented fog rolling in from the east.", "Pressure dropping fast. Static in the air.", "Light drizzle of something that isn't rain.", "Wind blowing toward the town centre."];

// ------------------------------------------------------------------ developments and decisions

interface DevDef {
  key: string;
  target: RoleId[];
  minSegment: number;
  /** Raised by these decision flags. */
  boostedBy?: string[];
  private: string;
  ticker: string;
  panic?: number;
  rep?: number;
  chaos?: number;
  /** A development can change what is true. */
  sets?: { fact: FactKey; truth: string };
}

const DEVELOPMENTS: readonly DevDef[] = [
  { key: "moves", target: ["reporter", "eyewitness"], minSegment: 1, private: "{entity} just moved. It's heading for {location2}.", ticker: "{ENTITY} SIGHTED NEAR {LOCATION2}", panic: 10, sets: { fact: "whereabouts", truth: "Near {location2}" } },
  { key: "witness", target: ["eyewitness", "reporter"], minSegment: 1, private: "A second witness swears it spoke. In French.", ticker: "SECOND WITNESS: 'IT SPOKE FRENCH'", chaos: 10 },
  { key: "weather", target: ["hazard", "expert"], minSegment: 1, private: "Readings are spiralling. Strange fog heading for {location}.", ticker: "ANOMALOUS FOG ADVISORY ISSUED", panic: 10 },
  { key: "power", target: ["production", "anchor"], minSegment: 1, private: "Studio power is failing. The lights may go any second.", ticker: "CHANNEL COB EXPERIENCING TECHNICAL DIFFICULTIES", chaos: 10 },
  { key: "leak", target: ["investigator", "reporter"], minSegment: 1, private: "Leaked footage: CPI staff ordering pizza minutes before the breach.", ticker: "LEAKED FOOTAGE SURFACES", rep: -15 },
  { key: "containment", target: ["expert", "hazard"], minSegment: 2, boostedBy: ["downplay", "allclear"], private: "Sensor feed: containment is at 0%. It is completely loose.", ticker: "CONTAINMENT FAILURE CONFIRMED", panic: 20, rep: -10, sets: { fact: "status", truth: "Completely loose — containment failed" } },
  { key: "storychange", target: ["spokesperson"], minSegment: 2, boostedBy: ["deny"], private: "New CPI memo: the official story is now 'a weather balloon'. Switch immediately.", ticker: "CPI REVISES OFFICIAL STATEMENT", rep: -10, chaos: 10 },
  { key: "contact", target: ["anchor", "production"], minSegment: 2, boostedBy: ["approach"], private: "You've lost contact with the field team. Last words: 'oh no'.", ticker: "CONTACT LOST WITH FIELD TEAM", panic: 10, chaos: 5 },
  { key: "correction", target: ["anchor", "investigator"], minSegment: 2, private: "Correction from the desk: the '{rumor}' report was false.", ticker: "CORRECTION ISSUED", chaos: -5, rep: 5 },
  { key: "gag", target: ["spokesperson", "production"], minSegment: 2, boostedBy: ["leak", "press"], private: "CPI Legal demands the broadcast stop mentioning {location}. Make it happen.", ticker: "CPI REQUESTS MEDIA BLACKOUT", rep: -5, chaos: 10 },
  { key: "hazmat", target: ["reporter", "hazard"], minSegment: 2, private: "Hazmat crews in yellow suits just arrived. They're carrying giant butter knives.", ticker: "HAZMAT TEAMS DEPLOYED", panic: 5 },
  { key: "second", target: ["reporter", "expert"], minSegment: 3, private: "There are TWO of them. The second is {second}.", ticker: "SECOND ENTITY REPORTED: {SECOND}", panic: 20, chaos: 15 },
  { key: "evacuate", target: ["hazard", "anchor"], minSegment: 3, boostedBy: ["warn", "exaggerate"], private: "Evacuation ordered for three miles around {location3}. It's there now.", ticker: "EVACUATION ORDERED NEAR {LOCATION3}", panic: 25, sets: { fact: "whereabouts", truth: "At {location3}" } },
];

interface ChoiceDef {
  label: string;
  ticker: string;
  panic?: number;
  rep?: number;
  chaos?: number;
  flag?: string;
  questionable?: boolean;
  honest?: boolean;
}

const DECISIONS: Record<RoleId, { question: string; options: ChoiceDef[] }> = {
  anchor: { question: "The Spokesperson is dodging.", options: [{ label: "PRESS FOR ANSWER", ticker: "ANCHOR DEMANDS ANSWERS FROM CPI", rep: -5, flag: "press" }, { label: "CHANGE SUBJECT", ticker: "AND NOW, A LOOK AT CORN PRICES", chaos: 5 }] },
  reporter: { question: "Something is moving behind the tape.", options: [{ label: "APPROACH INCIDENT", ticker: "REPORTER CROSSES CPI TAPE", panic: 5, chaos: 10, flag: "approach" }, { label: "STAY BACK", ticker: "REPORTER KEEPS A SAFE DISTANCE" }] },
  spokesperson: { question: "Reporters ask if it's loose.", options: [{ label: "DENY", ticker: "CPI: 'NOTHING IS LOOSE'", rep: 10, flag: "deny", questionable: true }, { label: "CONFIRM", ticker: "CPI CONFIRMS INCIDENT", rep: -10, panic: 10, honest: true }, { label: "NO COMMENT", ticker: "CPI: 'NO COMMENT'", rep: -5, chaos: 5 }] },
  expert: { question: "Viewers want to know how bad this is.", options: [{ label: "WARN PUBLIC", ticker: "EXPERT URGES CAUTION", panic: 15, flag: "warn" }, { label: "DOWNPLAY THREAT", ticker: "EXPERT: 'PROBABLY FINE'", panic: -10, flag: "downplay", questionable: true }] },
  eyewitness: { question: "The camera's on you.", options: [{ label: "EXAGGERATE", ticker: "WITNESS: 'IT WAS THIRTY FEET TALL'", panic: 10, chaos: 10, flag: "exaggerate", questionable: true }, { label: "STICK TO WHAT I SAW", ticker: "WITNESS STANDS BY ACCOUNT" }] },
  hazard: { question: "The hazard map is lighting up.", options: [{ label: "ISSUE WARNING", ticker: "HAZARD WARNING IN EFFECT", panic: 10, rep: -5, flag: "warn" }, { label: "ALL CLEAR", ticker: "HAZARD DESK: 'ALL CLEAR'", panic: -10, flag: "allclear", questionable: true }] },
  investigator: { question: "Your source is on the line.", options: [{ label: "LEAK IT", ticker: "CHANNEL COB OBTAINS CPI DOCUMENTS", rep: -15, chaos: 10, flag: "leak", honest: true }, { label: "SIT ON IT", ticker: "INVESTIGATION ONGOING" }] },
  production: { question: "The control room is on fire (a bit).", options: [{ label: "CUT TO COMMERCIAL", ticker: "WE'LL BE RIGHT BACK", rep: 5, chaos: 5 }, { label: "KEEP ROLLING", ticker: "CHANNEL COB STAYS LIVE", chaos: 5, panic: 5 }] },
};

const FILLER_TICKER = ["CORN FUTURES STEADY", "LOCAL MAN SURE HE SAW SOMETHING", "CPI: 'PLEASE STOP CALLING'", "TRAFFIC: TRACTOR ON ROUTE 9", "SPORTS: HUSKERS WIN, NOBODY SURPRISED"];

// ------------------------------------------------------------------ state

type Phase = "TUTORIAL" | "INTRO" | "PREP" | "LIVE" | "POLL" | "RECAP" | "FINALE";

interface PendingDev {
  id: number;
  def: DevDef;
  playerId: string;
  role: RoleId;
  privateText: string;
  ticker: string;
  deliveredTurn: number;
  scooped: boolean;
  revealed: boolean;
}

interface OpenDecision {
  id: number;
  playerId: string;
  role: RoleId;
  chosen: number | null;
}

interface SegmentResult {
  segment: number;
  accuracy: number;
  coherence: number;
  reactions: number;
  panic: number;
  rep: number;
  stars: number;
  highlights: string[];
  mvp: string | null;
  lost: string | null;
}

interface PlayerStats {
  mvpVotes: number;
  lostVotes: number;
  correct: number;
  scoops: number;
  panicCaused: number;
  questionable: number;
  repAsSpokes: number;
  anchorMvp: number;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new PartyError("INVALID_INPUT");
  return payload as Record<string, unknown>;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
export const panicLabel = (p: number) => (p < 30 ? "LOW" : p < 55 ? "ELEVATED" : p < 80 ? "HIGH" : "MAXIMUM");
export const repLabel = (r: number) => (r >= 70 ? "INTACT" : r >= 45 ? "DENTED" : r >= 20 ? "DAMAGED" : "IN RUINS");
export const coherenceLabel = (c: number) => (c >= 85 ? "SOLID" : c >= 60 ? "MOSTLY COHERENT" : c >= 40 ? "QUESTIONABLE" : "LOST THE PLOT");

class ChannelCobGame implements GameInstance {
  private readonly ctx: GameContext;
  private readonly settings: ChannelCobSettings;
  private phase: Phase = "INTRO";
  private segment = 0;
  private scenario!: Scenario;
  private seatOrder: string[] = [];
  private roles = new Map<string, RoleId>(); // playerId -> role this segment
  private inPlay: RoleId[] = [];
  private turn = 0;
  private totalTurns = COB_TIMING.turnsPerSegment;
  private speakers: RoleId[] = [];
  private breakingSpeaker: RoleId | null = null;
  private promptFor = new Map<RoleId, string>();
  private ticker: string[] = [];
  private devPlan = new Map<number, number>(); // turn -> how many developments
  private decisionPlan = new Set<number>();
  private devs: PendingDev[] = [];
  private decision: OpenDecision | null = null;
  private usedDecisionRoles = new Set<RoleId>();
  private usedDevs = new Set<string>();
  private flags = new Set<string>();
  private panic = 20;
  private rep = 70;
  private chaos = 0;
  private segStart = { panic: 20, rep: 70 };
  private seq = 0;
  private poll: { fact: FactKey; question: string; options: { id: string; text: string; correct: boolean }[] } | null = null;
  private answers = new Map<string, string>();
  private mvpVotes = new Map<string, string>();
  private lostVotes = new Map<string, string>();
  private segmentHighlights: string[] = [];
  private results: SegmentResult[] = [];
  private stats = new Map<string, PlayerStats>();
  private moments: string[] = [];
  private cues: { id: number; cue: string }[] = [];
  private nextStep: (() => void) | null = null;
  private finale: unknown = null;
  private tutorial: GroupTutorial | null = null;

  constructor(ctx: GameContext, settings: ChannelCobSettings) {
    this.ctx = ctx;
    this.settings = settings;
  }

  private rand(): number {
    return this.ctx.random();
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rand() * items.length)]!;
  }

  private shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  private cue(cue: string): void {
    this.cues.push({ id: ++this.seq, cue });
    if (this.cues.length > 12) this.cues.shift();
  }

  private schedule(ms: number, step: () => void): void {
    this.nextStep = step;
    this.ctx.setTimer(ms, step);
  }

  private stat(playerId: string): PlayerStats {
    let s = this.stats.get(playerId);
    if (!s) {
      s = { mvpVotes: 0, lostVotes: 0, correct: 0, scoops: 0, panicCaused: 0, questionable: 0, repAsSpokes: 0, anchorMvp: 0 };
      this.stats.set(playerId, s);
    }
    return s;
  }

  private playerFor(role: RoleId): string | null {
    for (const [pid, r] of this.roles) if (r === role) return pid;
    return null;
  }

  private fill(text: string): string {
    const s = this.scenario;
    const values: Record<string, string> = { entity: s.entity, location: s.location, location2: s.location2, location3: s.location3, second: s.second, rumor: s.facts.status.rumor };
    return text.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = values[k.toLowerCase()] ?? k;
      return k === k.toUpperCase() ? v.toUpperCase() : v;
    });
  }

  private meters(d: { panic?: number; rep?: number; chaos?: number }): void {
    this.panic = clamp(this.panic + (d.panic ?? 0));
    this.rep = clamp(this.rep + (d.rep ?? 0));
    this.chaos = Math.max(0, this.chaos + (d.chaos ?? 0));
  }

  // ------------------------------------------------------------------ setup

  start(): void {
    this.scenario = this.buildScenario();
    this.seatOrder = this.shuffle(this.ctx.players().map((p) => p.id));
    this.ticker = [...FILLER_TICKER];
    this.cue("broadcast_intro");
    if (this.settings.tutorial) this.openTutorial();
    else this.beginSegment();
  }

  // ------------------------------------------------------------------ tutorial

  private openTutorial(): void {
    this.tutorial = new GroupTutorial(CHANNEL_COB_TUTORIAL);
    this.phase = "TUTORIAL";
    this.schedule(TUTORIAL_STEP_MS, () => this.tutorialNext());
    this.ctx.changed();
  }

  private tutorialNext(): void {
    if (this.tutorial?.advance()) {
      this.schedule(TUTORIAL_STEP_MS, () => this.tutorialNext());
      this.ctx.changed();
    } else this.endTutorial();
  }

  private endTutorial(): void {
    this.ctx.clearTimer();
    this.tutorial = null;
    this.beginSegment();
  }

  private tutorialInput(playerId: string): void {
    if (this.phase !== "TUTORIAL" || !this.tutorial) throw new PartyError("PHASE_CLOSED");
    this.tutorial.markReady(playerId);
    if (this.tutorial.allReady(this.ctx.players().map((p) => p.id))) return this.endTutorial();
    this.ctx.changed();
  }


  private buildScenario(): Scenario {
    const entities = this.ctx.canon.sample("entity", 2).filter((r) => r.title);
    const incident = this.ctx.canon.sample("incident", 1)[0] ?? null;
    const official = this.ctx.canon.sample("personnel", 1)[0] ?? null;
    const main = entities[0];
    const fb = this.pick(FALLBACK_ENTITIES);
    if (main) this.ctx.canon.used(1, main.ref);
    if (entities[1]) this.ctx.canon.used(1, entities[1].ref);
    if (incident) this.ctx.canon.used(1, incident.ref);
    if (official) this.ctx.canon.used(1, official.ref);

    const entity = main?.title ?? fb.title;
    const [location, location2, location3] = this.shuffle(LOCATIONS);
    const cause = this.pick(CAUSES);
    return {
      entity,
      entityRef: main?.ref ?? null,
      classification: main?.fields.classification || fb.classification,
      containment: main?.fields.containment || fb.containment,
      location: location!,
      location2: location2!,
      location3: location3!,
      second: entities[1]?.title ?? "a smaller one in a tiny hat",
      incident: incident?.title ?? null,
      official: official?.title ?? null,
      headline: `${entity.toUpperCase()} REPORTED AT ${location!.toUpperCase()}`,
      observation: this.pick(OBSERVATIONS),
      hazard: this.pick(HAZARDS),
      facts: {
        status: { question: `Right now, what is the status of ${entity}?`, truth: "Loose — not contained", official: "Fully contained, a routine drill", rumor: "It has multiplied", decoy: "It was never real" },
        cause: { question: "What actually caused this?", ...cause },
        whereabouts: { question: `Where is ${entity} now?`, truth: `Still at ${location}`, official: "Back in its cell", rumor: `Hiding at ${location3}`, decoy: "On the moon" },
      },
    };
  }

  // ------------------------------------------------------------------ segments

  private assignRoles(): void {
    const n = this.seatOrder.length;
    // Rotate seats each segment so everyone gets a different job.
    this.inPlay = ROLES.slice(0, Math.min(n, ROLES.length)).map((r) => r.id);
    this.roles.clear();
    this.seatOrder.forEach((pid, i) => this.roles.set(pid, this.inPlay[(i + this.segment - 1) % this.inPlay.length]!));
  }

  private beginSegment(): void {
    this.segment += 1;
    this.assignRoles();
    this.devs = [];
    this.decision = null;
    this.usedDecisionRoles.clear();
    this.answers.clear();
    this.mvpVotes.clear();
    this.lostVotes.clear();
    this.segmentHighlights = [];
    this.segStart = { panic: this.panic, rep: this.rep };
    this.turn = 0;
    this.breakingSpeaker = null;

    // Speaking order: the anchor opens and closes, everyone else in between.
    const others = this.shuffle(this.inPlay.filter((r) => r !== "anchor"));
    const middle: RoleId[] = [];
    for (let i = 0; middle.length < this.totalTurns - 2; i++) middle.push(others.length ? others[i % others.length]! : "anchor");
    this.speakers = ["anchor", ...middle, "anchor"];

    // Escalation: more developments and decisions each segment, spread over the middle turns.
    const devCount = Math.min(3, this.segment);
    const decCount = Math.min(3, this.segment);
    this.devPlan.clear();
    this.decisionPlan.clear();
    const devTurns = [2, 4, 3];
    const decTurns = [3, 1, 5];
    for (let i = 0; i < devCount; i++) this.devPlan.set(devTurns[i]!, (this.devPlan.get(devTurns[i]!) ?? 0) + 1);
    for (let i = 0; i < decCount; i++) this.decisionPlan.add(decTurns[i]!);

    this.phase = "INTRO";
    this.cue("breaking_news");
    this.schedule(COB_TIMING.introMs, () => this.openPrep());
    this.ctx.changed();
  }

  private openPrep(): void {
    this.phase = "PREP";
    this.schedule(this.settings.prepSeconds * 1000, () => this.goLive());
    this.ctx.changed();
  }

  private turnMs(): number {
    return Math.round((this.settings.liveSeconds * 1000) / this.totalTurns);
  }

  private goLive(): void {
    this.phase = "LIVE";
    this.cue("live_transition");
    this.turn = 0;
    this.nextTurn();
  }

  private currentSpeaker(): RoleId {
    return this.breakingSpeaker ?? this.speakers[this.turn - 1] ?? "anchor";
  }

  private nextTurn(): void {
    this.closeDecision();
    this.turn += 1;
    if (this.turn > this.totalTurns) return this.endLive();
    this.breakingSpeaker = null;

    // Old breaking news nobody went live with gets out anyway — on the ticker.
    for (const d of this.devs) {
      if (!d.revealed && !d.scooped && this.turn - d.deliveredTurn >= 2) {
        d.revealed = true;
        this.pushTicker(`${d.ticker} (CHANNEL COB MISSED IT)`);
        this.cue("broadcast_error");
        this.segmentHighlights.push(`Nobody went live with "${d.ticker}" — viewers read it on the ticker first.`);
      }
    }
    for (let i = 0; i < (this.devPlan.get(this.turn) ?? 0); i++) this.deliverDevelopment();
    if (this.decisionPlan.has(this.turn)) this.openDecision();

    // A fresh nudge for whoever is speaking and whoever is up next.
    this.promptFor.clear();
    const speaker = this.currentSpeaker();
    const next = this.speakers[this.turn] ?? null;
    this.promptFor.set(speaker, this.prompt(speaker, next));
    if (next && next !== speaker) this.promptFor.set(next, this.prompt(next, null));

    this.schedule(this.turnMs(), () => this.nextTurn());
    this.ctx.changed();
  }

  private prompt(role: RoleId, next: RoleId | null): string {
    const def = ROLE_BY_ID.get(role)!;
    const nextName = next && next !== role ? ROLE_BY_ID.get(next)!.name : "the field";
    const spokes = this.inPlay.includes("spokesperson") ? "the CPI Spokesperson" : "the CPI";
    return this.pick(def.prompts).replace("{next}", nextName).replace("{spokes}", spokes);
  }

  private pushTicker(text: string): void {
    this.ticker.unshift(text);
    if (this.ticker.length > 8) this.ticker.pop();
  }

  private deliverDevelopment(): void {
    const pool = DEVELOPMENTS.filter((d) => d.minSegment <= this.segment && !this.usedDevs.has(d.key));
    if (!pool.length) return;
    const weighted = pool.flatMap((d) => {
      const w = 1 + (d.boostedBy?.some((f) => this.flags.has(f)) ? 3 : 0) + (d.minSegment === this.segment ? 1 : 0);
      return Array<DevDef>(w).fill(d);
    });
    const def = this.pick(weighted);
    this.usedDevs.add(def.key);
    const role = def.target.find((r) => this.inPlay.includes(r)) ?? this.pick(this.inPlay.filter((r) => r !== "anchor").length ? this.inPlay.filter((r) => r !== "anchor") : this.inPlay);
    const playerId = this.playerFor(role);
    if (!playerId) return;
    this.devs.push({ id: ++this.seq, def, playerId, role, privateText: this.fill(def.private), ticker: this.fill(def.ticker), deliveredTurn: this.turn, scooped: false, revealed: false });
    this.meters(def);
    if (def.sets) this.scenario.facts[def.sets.fact].truth = this.fill(def.sets.truth);
    this.stat(playerId).panicCaused += Math.max(0, def.panic ?? 0);
    this.cue("incoming_update");
  }

  private openDecision(): void {
    const choices = this.inPlay.filter((r) => !this.usedDecisionRoles.has(r));
    const speaker = this.currentSpeaker();
    const role = choices.includes(speaker) ? speaker : choices.length ? this.pick(choices) : null;
    const playerId = role ? this.playerFor(role) : null;
    if (!role || !playerId) return;
    this.usedDecisionRoles.add(role);
    this.decision = { id: ++this.seq, playerId, role, chosen: null };
  }

  private closeDecision(): void {
    const d = this.decision;
    if (!d) return;
    this.decision = null;
    if (d.chosen === null) {
      this.pushTicker(`${ROLE_BY_ID.get(d.role)!.name.toUpperCase()} FROZE ON AIR`);
      this.meters({ chaos: 5 });
      this.segmentHighlights.push(`The ${ROLE_BY_ID.get(d.role)!.name} froze on live television.`);
    }
  }

  private choose(d: OpenDecision, index: number): void {
    const opt = DECISIONS[d.role].options[index]!;
    d.chosen = index;
    const before = this.rep;
    this.meters(opt);
    if (opt.flag) this.flags.add(opt.flag);
    const s = this.stat(d.playerId);
    s.panicCaused += Math.max(0, opt.panic ?? 0);
    if (opt.questionable) s.questionable += 1;
    if (d.role === "spokesperson") s.repAsSpokes += this.rep - before;
    this.ctx.addPoints(d.playerId, COB_POINTS.decision + (opt.honest ? COB_POINTS.confirm : 0));
    this.pushTicker(opt.ticker);
    this.moments.push(`${ROLE_BY_ID.get(d.role)!.name} (${this.ctx.playerName(d.playerId)}) chose ${opt.label}: "${opt.ticker}"`);
    this.cue("decision_made");
  }

  private endLive(): void {
    this.closeDecision();
    this.decision = null;
    this.breakingSpeaker = null;
    const key: FactKey = (["status", "cause", "whereabouts"] as const)[(this.segment - 1) % 3]!;
    const f = this.scenario.facts[key];
    const options = this.shuffle([
      { id: "t", text: f.truth, correct: true },
      { id: "o", text: f.official, correct: false },
      { id: "r", text: f.rumor, correct: false },
      { id: "d", text: f.decoy, correct: false },
    ]);
    this.poll = { fact: key, question: f.question, options };
    this.phase = "POLL";
    this.cue("segment_end");
    this.schedule(COB_TIMING.pollMs, () => this.recap());
    this.ctx.changed();
  }

  private pollDone(): boolean {
    const players = this.ctx.players();
    const solo = players.length < 2;
    return players.length > 0 && players.every((p) => this.answers.has(p.id) && (solo || (this.mvpVotes.has(p.id) && this.lostVotes.has(p.id))));
  }

  private recap(): void {
    const players = this.ctx.players();
    const answered = [...this.answers.values()];
    const correctId = this.poll!.options.find((o) => o.correct)!.id;
    for (const [pid, a] of this.answers) {
      if (a === correctId) {
        this.ctx.addPoints(pid, COB_POINTS.correct);
        this.stat(pid).correct += 1;
      }
    }
    const accuracy = answered.length ? Math.round((answered.filter((a) => a === correctId).length / answered.length) * 100) : 0;
    const counts = new Map<string, number>();
    for (const a of answered) counts.set(a, (counts.get(a) ?? 0) + 1);
    const coherence = answered.length ? Math.round((Math.max(...counts.values()) / answered.length) * 100) : 0;
    const devs = this.devs.length;
    const reactions = devs ? Math.round((this.devs.filter((d) => d.scooped).length / devs) * 100) : 100;

    const tally = (votes: Map<string, string>, key: "mvpVotes" | "lostVotes") => {
      const c = new Map<string, number>();
      for (const target of votes.values()) {
        c.set(target, (c.get(target) ?? 0) + 1);
        this.stat(target)[key] += 1;
        if (key === "mvpVotes") {
          this.ctx.addPoints(target, COB_POINTS.mvp);
          if (this.roles.get(target) === "anchor") this.stat(target).anchorMvp += 1;
        }
      }
      let best: string | null = null;
      for (const [pid, n] of c) if (!best || n > c.get(best)!) best = pid;
      return best;
    };
    const mvp = tally(this.mvpVotes, "mvpVotes");
    const lost = tally(this.lostVotes, "lostVotes");

    const score = accuracy * 0.35 + coherence * 0.25 + reactions * 0.2 + this.rep * 0.2;
    const stars = Math.max(1, Math.min(5, Math.round(score / 20)));
    const highlights = [...this.segmentHighlights];
    if (this.devs.some((d) => d.scooped)) highlights.unshift(`${[...new Set(this.devs.filter((d) => d.scooped).map((d) => `The ${ROLE_BY_ID.get(d.role)!.name}`))].join(" and ")} broke the news live.`);
    const funny = this.moments.at(-1);
    if (funny && highlights.length < 2) highlights.push(funny);

    this.results.push({ segment: this.segment, accuracy, coherence, reactions, panic: this.panic, rep: this.rep, stars, highlights: highlights.slice(0, 2), mvp: mvp ? this.ctx.playerName(mvp) : null, lost: lost ? this.ctx.playerName(lost) : null });
    for (const h of highlights) this.moments.push(h);
    for (const p of players) this.ctx.countStat(p.id, "roundsPlayed");

    this.phase = "RECAP";
    this.cue(stars >= 3 ? "segment_good" : "segment_bad");
    const last = this.segment >= this.settings.segments;
    this.schedule(COB_TIMING.recapMs, () => (last ? this.openFinale() : this.beginSegment()));
    this.ctx.changed();
  }

  // ------------------------------------------------------------------ finale

  private openFinale(): void {
    const avg = (k: "accuracy" | "stars") => Math.round(this.results.reduce((s, r) => s + r[k], 0) / Math.max(1, this.results.length));
    const best = (pick: (s: PlayerStats) => number, min = 1) => {
      let winner: string | null = null;
      let top = min - 1;
      for (const p of this.ctx.players()) {
        const v = pick(this.stat(p.id));
        if (v > top) {
          top = v;
          winner = p.id;
        }
      }
      return winner && top >= min ? this.ctx.playerName(winner) : null;
    };
    const awards = [
      { title: "Best Anchor", winner: best((s) => s.anchorMvp), detail: "Most MVP votes while holding the desk" },
      { title: "Most Questionable Source", winner: best((s) => s.questionable), detail: "Denied, downplayed or exaggerated the most" },
      { title: "Best Damage Control", winner: best((s) => s.repAsSpokes), detail: "Did the most for CPI's reputation as Spokesperson" },
      { title: "Most Accurate Reporter", winner: best((s) => s.correct), detail: "Got the facts straight most often" },
      { title: "Caused the Most Panic", winner: best((s) => s.panicCaused), detail: "Personally raised public panic the most" },
      { title: "Completely Lost the Story", winner: best((s) => s.lostVotes), detail: "Voted most lost by the newsroom" },
      { title: "Scoop of the Night", winner: best((s) => s.scoops), detail: "Went live with breaking news first" },
    ].filter((a) => a.winner);
    const stars = avg("stars");
    this.finale = {
      stars,
      rating: ["", "CANCELLED", "GRAVEYARD SLOT", "SOLID LOCAL NEWS", "PRIMETIME", "INSTITUTIONAL LEGEND"][stars],
      accuracy: avg("accuracy"),
      rep: this.rep,
      repLabel: repLabel(this.rep),
      panic: this.panic,
      chaos: this.chaos,
      moments: this.shuffle(this.moments).slice(0, 3),
      awards,
      segments: this.results,
    };
    this.phase = "FINALE";
    this.cue("final_results");
    this.schedule(COB_TIMING.finaleMs, () => this.finish());
    this.ctx.changed();
  }

  private finish(): void {
    const f = this.finale as { stars: number; rating: string; accuracy: number; repLabel: string; chaos: number; awards: { title: string; winner: string; detail: string }[]; moments: string[] };
    const highlights: Highlight[] = [
      { title: `Channel Cob Rating: ${"★".repeat(f.stars)}${"☆".repeat(5 - f.stars)}`, playerName: null, text: null, detail: `${f.rating} · Accuracy ${f.accuracy}% · CPI reputation ${f.repLabel} · Chaos ${f.chaos}` },
      ...f.awards.map((a) => ({ title: a.title, playerName: a.winner, text: null, detail: a.detail })),
    ];
    if (f.moments[0]) highlights.push({ title: "Standout Broadcast Moment", playerName: null, text: f.moments[0], detail: "As seen on Channel Cob" });
    this.ctx.finish({ rounds: this.segment, highlights });
  }

  // ------------------------------------------------------------------ input

  handleInput(playerId: string, action: string, payload: unknown): void {
    if (action === "tutorialReady") return this.tutorialInput(playerId);
    const role = this.roles.get(playerId);
    if (!role) throw new PartyError("INVALID_ACTION");
    const input = payload === undefined ? {} : asRecord(payload);

    switch (action) {
      case "golive": {
        if (this.phase !== "LIVE") throw new PartyError("PHASE_CLOSED");
        const dev = this.devs.find((d) => d.id === input.id && d.playerId === playerId && !d.scooped && !d.revealed);
        if (!dev) throw new PartyError("INVALID_INPUT");
        dev.scooped = true;
        dev.revealed = true;
        this.stat(playerId).scoops += 1;
        this.ctx.addPoints(playerId, COB_POINTS.scoop);
        this.pushTicker(`BREAKING: ${dev.ticker}`);
        this.moments.push(`The ${ROLE_BY_ID.get(role)!.name} broke it live: "${dev.ticker}"`);
        this.cue("scoop");
        // Cut straight to whoever has the news, for a full turn.
        this.ctx.clearTimer();
        this.breakingSpeaker = role;
        this.promptFor.set(role, "BREAKING: tell everyone what you just learned.");
        this.schedule(this.turnMs(), () => this.nextTurn());
        break;
      }
      case "choose": {
        if (this.phase !== "LIVE") throw new PartyError("PHASE_CLOSED");
        const d = this.decision;
        if (!d || d.playerId !== playerId || d.id !== input.id || d.chosen !== null) throw new PartyError("INVALID_INPUT");
        const index = input.option;
        if (typeof index !== "number" || !DECISIONS[d.role].options[index]) throw new PartyError("INVALID_INPUT");
        this.choose(d, index);
        break;
      }
      case "handoff": {
        // The speaker (or whoever runs production) passes the mic early.
        if (this.phase !== "LIVE") throw new PartyError("PHASE_CLOSED");
        if (role !== this.currentSpeaker() && role !== "production") throw new PartyError("INVALID_ACTION");
        this.ctx.clearTimer();
        return this.nextTurn();
      }
      case "answer": {
        if (this.phase !== "POLL") throw new PartyError("PHASE_CLOSED");
        if (!this.poll!.options.some((o) => o.id === input.id)) throw new PartyError("INVALID_INPUT");
        this.answers.set(playerId, input.id as string);
        break;
      }
      case "mvp":
      case "lost": {
        if (this.phase !== "POLL") throw new PartyError("PHASE_CLOSED");
        const target = input.playerId;
        if (typeof target !== "string" || target === playerId || !this.roles.has(target)) throw new PartyError("INVALID_VOTE");
        (action === "mvp" ? this.mvpVotes : this.lostVotes).set(playerId, target);
        break;
      }
      default:
        throw new PartyError("INVALID_ACTION");
    }
    if (this.phase === "POLL" && this.pollDone()) {
      this.ctx.clearTimer();
      return this.recap();
    }
    this.ctx.changed();
  }

  hostAction(action: string): void {
    if (action === "skipTutorial" && this.phase === "TUTORIAL") return this.endTutorial();
    if (action !== "skip" || !this.nextStep) throw new PartyError("INVALID_ACTION");
    const step = this.nextStep;
    this.ctx.clearTimer();
    step();
  }

  playerLeft(): void {
    if (this.phase === "TUTORIAL" && this.tutorial?.allReady(this.ctx.players().map((p) => p.id))) return this.endTutorial();
    if (this.phase === "POLL" && this.pollDone()) {
      this.ctx.clearTimer();
      this.recap();
    }
  }

  dispose(): void {
    this.nextStep = null;
  }

  // ------------------------------------------------------------------ views

  /** What each role privately knows. Short on purpose: a glance, not a script. */
  private brief(role: RoleId): string[] {
    const s = this.scenario;
    const f = s.facts;
    const official = s.official ? ` (statement approved by ${s.official})` : "";
    switch (role) {
      case "anchor":
        return [`Headline: ${s.headline}`, `Verified: ${s.entity} was reported at ${s.location}.`, `Running order: you, then ${this.speakers.slice(1, 4).map((r) => ROLE_BY_ID.get(r)!.name).join(", ")}.`];
      case "reporter":
        return [`You're at ${s.location}.`, `You can see: ${s.observation}`, `It does NOT look contained.`];
      case "spokesperson":
        return [`Official line: ${f.status.official}. Cause: ${f.cause.official}${official}.`, `Keep hidden: ${f.cause.truth}`];
      case "expert":
        return [`${s.entity}: classification ${s.classification}, containment ${s.containment}.`, s.incident ? `Similar to the case on file: ${s.incident}.` : "No similar case on file. Improvise.", "If it's loose, things get much worse after dark."];
      case "eyewitness":
        return [`You saw it near ${s.location}. You're sure ${f.status.rumor.toLowerCase()}.`, `You also heard: ${f.cause.rumor}`];
      case "investigator":
        return [`Leaked memo: ${f.cause.truth}`, `Your source says: CPI's line ('${f.status.official}') is false.`];
      case "hazard":
        return [`Hazard: ${s.hazard}`, `Watch ${s.location} and ${s.location2}.`];
      case "production":
        return [`You can HAND OFF the mic at any time to keep things moving.`, `Make sure the anchor mentions ${s.location}.`];
    }
  }

  viewFor(viewer: Viewer): unknown {
    const playerId = viewer.kind === "player" ? viewer.playerId : null;
    const s = this.scenario;
    const roster = [...this.roles].map(([pid, role]) => ({ playerId: pid, name: this.ctx.playerName(pid), role, roleName: ROLE_BY_ID.get(role)!.name, glyph: ROLE_BY_ID.get(role)!.glyph }));
    const speaker = this.phase === "LIVE" ? this.currentSpeaker() : null;
    const nextRole = this.phase === "LIVE" ? (this.speakers[this.turn] ?? null) : null;
    const speakerRow = speaker ? roster.find((r) => r.role === speaker) : null;
    const pendingBreaking = this.devs.filter((d) => !d.scooped && !d.revealed).map((d) => ROLE_BY_ID.get(d.role)!.name);

    const view: Record<string, unknown> = {
      phase: this.phase,
      segment: this.segment,
      totalSegments: this.settings.segments,
      headline: s.headline,
      location: s.location,
      entity: s.entity,
      roster,
      turn: this.turn,
      totalTurns: this.totalTurns,
      speaker: speakerRow ? { ...speakerRow, breaking: this.breakingSpeaker !== null } : null,
      next: nextRole ? (roster.find((r) => r.role === nextRole) ?? null) : null,
      // Only that someone has news, never what it is.
      incoming: pendingBreaking,
      decisionLive: this.decision ? { roleName: ROLE_BY_ID.get(this.decision.role)!.name, done: this.decision.chosen !== null } : null,
      ticker: this.ticker,
      panic: this.panic,
      panicLabel: panicLabel(this.panic),
      rep: this.rep,
      repLabel: repLabel(this.rep),
      chaos: this.chaos,
      poll: this.phase === "POLL" ? { question: this.poll!.question, options: this.poll!.options.map((o) => ({ id: o.id, text: o.text })), answered: this.answers.size, players: this.ctx.players().length } : null,
      recap: this.phase === "RECAP" ? { ...this.results.at(-1)!, panicLabel: panicLabel(this.panic), repLabel: repLabel(this.rep), coherenceLabel: coherenceLabel(this.results.at(-1)!.coherence), truth: this.poll!.options.find((o) => o.correct)!.text } : null,
      finale: this.phase === "FINALE" ? this.finale : null,
      cues: this.cues,
      tutorial: this.phase === "TUTORIAL" && this.tutorial ? this.tutorial.view(playerId, this.ctx.players().length) : null,
    };
    if (!playerId) return view;

    const role = this.roles.get(playerId);
    if (!role) return view;
    const def = ROLE_BY_ID.get(role)!;
    const d = this.decision && this.decision.playerId === playerId ? this.decision : null;
    view.you = {
      role,
      roleName: def.name,
      glyph: def.glyph,
      job: def.job,
      brief: this.brief(role),
      onAir: speaker === role,
      upNext: nextRole === role && speaker !== role,
      prompt: this.promptFor.get(role) ?? null,
      canHandOff: this.phase === "LIVE" && (speaker === role || role === "production"),
      breaking: this.devs.filter((x) => x.playerId === playerId && !x.scooped && !x.revealed).map((x) => ({ id: x.id, text: x.privateText })),
      known: this.devs.filter((x) => x.playerId === playerId && (x.scooped || x.revealed)).map((x) => x.privateText),
      decision: d ? { id: d.id, question: DECISIONS[d.role].question, options: DECISIONS[d.role].options.map((o) => o.label), chosen: d.chosen } : null,
      answer: this.answers.get(playerId) ?? null,
      mvp: this.mvpVotes.get(playerId) ?? null,
      lost: this.lostVotes.get(playerId) ?? null,
    };
    return view;
  }
}

export const channelCobGame: GameDefinition<ChannelCobSettings> = {
  id: "channelcob",
  name: "Channel Cob",
  tagline: "Live from the incident. Nobody knows the same thing.",
  description:
    "You're the Channel Cob news team covering a CPI incident live. Everyone holds a different role and a " +
    "private brief that doesn't quite match anyone else's. Talk it out on air, react to breaking news only " +
    "you received, make snap calls, and try to keep the story straight across three escalating segments.",
  minPlayers: 2,
  maxPlayers: 8,
  defaultSettings: { segments: 3, liveSeconds: 75, prepSeconds: 25, tutorial: true },
  deck: {
    shelf: "party",
    genre: "Live improv",
    controls: ["Phone: your role, private notes, breaking news, quick calls", "Big screen: the broadcast — who's on air, the ticker, the countdown"],
    length: "10–15 min",
    art: { from: "#3a0d0d", to: "#0d0303", accent: "#ff3b30", glyph: "📺", motif: "dots" },
  },
  parseSettings(raw: unknown): ChannelCobSettings {
    const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const d = this.defaultSettings;
    return {
      segments: clampInt(input.segments, 2, 4, d.segments),
      liveSeconds: clampInt(input.liveSeconds, 45, 120, d.liveSeconds),
      prepSeconds: clampInt(input.prepSeconds, 15, 45, d.prepSeconds),
      tutorial: typeof input.tutorial === "boolean" ? input.tutorial : d.tutorial,
    };
  },
  create(ctx, settings) {
    return new ChannelCobGame(ctx, settings);
  },
};
