// BUDGET CUTS — 2–8 agents each run a CPI department and fight over one shrinking emergency
// budget. Each cycle: briefing, a timed in-person negotiation (phones only propose, back, deal
// and lock in), a vote, then incidents roll against how each department was funded.
//
// Everything here is game-only. Canon entity/incident titles are borrowed for flavour (titles
// only — never descriptions, so nothing redacted or hidden leaks) and recorded as used; nothing is
// written back to the CPI Database. Without canon the game uses fallback names and still plays.

import { PartyError } from "../errors.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "./types.ts";

export interface BudgetCutsSettings {
  cycles: number;
  negotiateSeconds: number;
  voteSeconds: number;
}

export const BUDGET_TIMING = {
  briefingMs: 14_000,
  renegotiateMs: 35_000,
  verdictMs: 5_000,
  forcedMs: 9_000,
  incidentMs: 9_000,
  consequencesMs: 14_000,
  auditMs: 25_000,
};

export const START_STABILITY = 75;
export const MAX_VOTES = 2;
export const POINTS = {
  helped: 60,
  blamed: -40,
  deal: 80,
  objective: 300,
  health: [200, 120, 50, 0] as const,
  stabilityMultiplier: 2,
};

// ------------------------------------------------------------------ departments

export type DeptId = "containment" | "research" | "security" | "medical" | "records" | "logistics" | "pr" | "strike";

interface DeptDef {
  id: DeptId;
  name: string;
  glyph: string;
  motto: string;
  good: string;
  weak: string;
  baseRequest: number;
  pitch: readonly string[];
}

export const DEPARTMENTS: readonly DeptDef[] = [
  { id: "containment", name: "Containment", glyph: "🧪", motto: "If it moves, it goes in a box.", good: "Breaches, lab leaks, anything with teeth", weak: "Paperwork, press, people", baseRequest: 140, pitch: ["New cell doors. The old ones are 'mostly' doors.", "Bigger boxes. Do not ask what for."] },
  { id: "research", name: "Research", glyph: "🔬", motto: "We poked it so you don't have to.", good: "Artifacts, power, equipment", weak: "Keeping things inside", baseRequest: 120, pitch: ["A second microscope, for redundancy.", "Grant renewal for Project [UNFUNDED]."] },
  { id: "security", name: "Security", glyph: "🛡️", motto: "Badge, please. Again.", good: "Intruders, breaches, leaks to the press", weak: "Medical emergencies, food", baseRequest: 120, pitch: ["More cameras pointed at the other cameras.", "Replacement lanyards (the old ones were seized)."] },
  { id: "medical", name: "Medical", glyph: "🩺", motto: "Do not touch the green one.", good: "Personnel emergencies, food incidents, lab leaks", weak: "Anything armed", baseRequest: 110, pitch: ["Bandages that are not repurposed corn husks.", "Antidote stock for the cafeteria."] },
  { id: "records", name: "Records Division", glyph: "🗂️", motto: "If it isn't filed, it didn't happen.", good: "Audits, public exposure, paperwork", weak: "Physical danger of any kind", baseRequest: 90, pitch: ["Filing cabinets that close.", "A shredder for 'accidents'."] },
  { id: "logistics", name: "Logistics", glyph: "📦", motto: "It's on a truck. Somewhere.", good: "Power, equipment, deployments", weak: "Explaining where anything is", baseRequest: 100, pitch: ["Forklift insurance (retroactive).", "Generators. Plural. Please."] },
  { id: "pr", name: "Public Relations", glyph: "📣", motto: "That wasn't a monster, it was a mascot.", good: "Public exposure, viral videos, food scandals", weak: "Actual containment", baseRequest: 90, pitch: ["A new cover story. The weather balloon one is tired.", "Influencer outreach (do not ask)."] },
  { id: "strike", name: "Strike Team Ops", glyph: "🎯", motto: "We knock once.", good: "Breaches, intruders, deployments", weak: "Subtlety, receipts", baseRequest: 130, pitch: ["Fuel for the van.", "Tactical corn launchers (prototype)."] },
];
const DEPT_BY_ID = new Map(DEPARTMENTS.map((d) => [d.id, d]));

export const TIERS = ["Severely Underfunded", "Underfunded", "Adequate", "Well Funded", "Excessive"] as const;
export const HEALTH = ["Operational", "Strained", "Critical", "Failed"] as const;
/** How much each funding tier helps an incident response. Excessive funding gets spent on fountains. */
const TIER_EFFECT = [0, 1, 2, 3, 2.5] as const;
const HEALTH_PENALTY = [0, 0.3, 0.8, 99] as const;

export function tierFor(allocated: number, request: number): number {
  const ratio = request <= 0 ? 1 : allocated / request;
  if (ratio < 0.4) return 0;
  if (ratio < 0.8) return 1;
  if (ratio < 1.2) return 2;
  if (ratio < 1.6) return 3;
  return 4;
}

// ------------------------------------------------------------------ incidents

interface IncidentDef {
  key: string;
  category: string;
  title: string;
  needs: readonly DeptId[];
  /** Extra difficulty, 0..0.1. */
  danger: number;
  /** {entity} {hero} {blamed} {incident} are filled in. */
  setup: string;
  contained: readonly string[];
  patched: readonly string[];
  failed: readonly string[];
  usesEntity?: boolean;
}

export const INCIDENTS: readonly IncidentDef[] = [
  { key: "breach", category: "CONTAINMENT", title: "Containment Breach", needs: ["containment", "security", "strike"], danger: 0.08, usesEntity: true, setup: "{entity} is out of its cell and heading for the break room.", contained: ["{hero} had it back in the box before the coffee finished brewing.", "{entity} was returned to containment and given a stern talking-to."], patched: ["{entity} was recaptured. The break room was not."], failed: ["{entity} ate the break room. {blamed} has been asked to 'reflect on its choices'.", "{blamed} tried to contain {entity} with a cardboard box labelled BOX."] },
  { key: "power", category: "POWER", title: "Facility Power Failure", needs: ["logistics", "research", "security"], danger: 0.03, setup: "The lights are out across three wings. The doors are electric. All of them.", contained: ["{hero} had the generators humming inside four minutes.", "Backup power held. Nobody even noticed except the plants."], patched: ["Power is back, mostly. The elevator now only goes sideways."], failed: ["{blamed}'s backup generator turned out to be a drawing of a generator.", "Forty agents spent the night in an elevator. {blamed} has been sent the bill."] },
  { key: "artifact", category: "ANOMALOUS", title: "Artifact Activation", needs: ["research", "containment", "medical"], danger: 0.06, usesEntity: true, setup: "Something in storage is humming in a key that does not exist. Records link it to {entity}.", contained: ["{hero} identified the frequency and politely asked it to stop.", "{hero} put it in a lead box and the humming became muffled resentment."], patched: ["It stopped humming. Three interns now hum instead."], failed: ["The artifact opened. {blamed} had not budgeted for 'opened'.", "Everyone in Wing C now speaks only in fax tones. {blamed} is responsible."] },
  { key: "personnel", category: "PERSONNEL", title: "Personnel Emergency", needs: ["medical", "logistics", "records"], danger: 0.02, setup: "Half of night shift reported in with the same rash. It is shaped like a spreadsheet.", contained: ["{hero} diagnosed it as 'mostly fine' and handed out lollipops.", "{hero} had everyone treated, signed off and back at their desks."], patched: ["Everyone recovered. The rash is now a recognised union member."], failed: ["{blamed} prescribed 'walking it off'. Nobody walked it off.", "The rash filed a grievance. {blamed} lost."] },
  { key: "exposure", category: "PUBLIC EXPOSURE", title: "Public Exposure", needs: ["pr", "records", "security"], danger: 0.05, usesEntity: true, setup: "A local news van filmed {entity} waving from a window.", contained: ["{hero} convinced the public it was a very committed mascot.", "{hero} bought every copy of the newspaper. All of them."], patched: ["The story ran, but on page 14, under the crossword."], failed: ["{blamed}'s official statement was just the word 'no' forty times.", "{entity} has its own fan account now. {blamed} is being blamed in the comments."] },
  { key: "equipment", category: "EQUIPMENT", title: "Equipment Failure", needs: ["logistics", "research"], danger: 0.0, setup: "The Kernel Counter in the vault has started counting backwards.", contained: ["{hero} replaced the part. It was a sticky key.", "{hero} recalibrated the counter and only lost a little dignity."], patched: ["It counts forwards again. In base 7."], failed: ["{blamed} hit it with a wrench. It now counts in screams.", "The counter reached zero and so did {blamed}'s reputation."] },
  { key: "food", category: "FOOD", title: "Cafeteria Incident", needs: ["medical", "containment", "pr"], danger: 0.04, setup: "Today's corn chowder has begun responding to its name.", contained: ["{hero} contained the chowder and issued free sandwiches.", "The chowder was gently returned to the pot. Lunch was reheated."], patched: ["The chowder was subdued. Lunch is now 'a cracker'."], failed: ["The chowder unionised. {blamed} negotiated badly.", "{blamed} tried to eat the evidence. The evidence ate back."] },
  { key: "deploy", category: "TACTICAL", title: "Emergency Strike Deployment", needs: ["strike", "logistics", "medical"], danger: 0.07, usesEntity: true, setup: "Field report: {entity} has been sighted at a county fair. Deploy now.", contained: ["{hero} rolled out, bagged it and won a stuffed bear on the way home.", "Textbook deployment. {hero} even used the turn signal."], patched: ["The team got it, but left the van at the fair."], failed: ["{blamed}'s van had a quarter tank and a dream.", "{entity} won the pie contest. {blamed} placed fourth."] },
  { key: "audit", category: "AUDIT", title: "Oversight Audit", needs: ["records", "pr"], danger: 0.03, setup: "The Oversight Committee wants receipts. For everything. Since 1987.", contained: ["{hero} produced every receipt, alphabetised, laminated and scented.", "The auditors left impressed and slightly frightened of {hero}."], patched: ["The audit passed. Nobody can explain line 404."], failed: ["{blamed} submitted a single receipt that just says 'stuff'.", "The auditors found the jet ski. {blamed} is holding the jet ski."] },
  { key: "intruder", category: "INTRUDER", title: "Intruder at the Gate", needs: ["security", "strike"], danger: 0.04, setup: "Someone at the front gate insists they are 'the new guy'. Nobody hired a new guy.", contained: ["{hero} checked the badge, then the other badge, then sent them home.", "{hero} escorted the intruder out and confiscated their lanyard."], patched: ["The intruder left, but took a stapler."], failed: ["{blamed} let them in. The 'new guy' is now in middle management.", "The intruder was given a desk by {blamed}. They are thriving."] },
  { key: "leak", category: "BIOHAZARD", title: "Lab Leak", needs: ["research", "medical", "containment"], danger: 0.06, setup: "Lab 6 is venting a pleasant-smelling yellow fog. Pleasant is the problem.", contained: ["{hero} sealed Lab 6 and handed out complimentary masks.", "{hero} vented the fog harmlessly over the parking lot of a rival agency."], patched: ["The fog cleared. Everyone in Lab 6 now smells of butter."], failed: ["{blamed} opened a window. The town smells of butter now.", "{blamed} tried to bottle the fog and sell it."] },
  { key: "viral", category: "PUBLIC EXPOSURE", title: "Viral Video", needs: ["pr", "security"], danger: 0.02, setup: "A clip of an agent fighting a sentient filing cabinet has eleven million views.", contained: ["{hero} claimed it was a movie trailer. Fans are excited for the movie.", "{hero} got it taken down and replaced with a cat."], patched: ["The video is down. The remixes are not."], failed: ["{blamed} posted a reply. It was the wrong account.", "{blamed} denied everything while visibly holding the filing cabinet."] },
];

const FALLBACK_ENTITIES = ["Specimen 4 (the one with the hat)", "an unlabelled crate", "the thing in Locker 9", "the Grain Shade", "the cafeteria's oldest muffin"];

const SITUATIONS = [
  "Fiscal Year opens. Oversight approved a budget they called 'basically fine'.",
  "Mid-year review. Someone expensed a jet ski and nobody will say who.",
  "Year-end. Every department has suddenly discovered urgent needs.",
  "Overtime. The budget office is now run from a hallway.",
];

const SURPRISES = [
  "Settlement: The Vending Machine v. CPI",
  "Replacement of every stapler (they knew)",
  "Mandatory team-building retreat (cancelled, non-refundable)",
  "The jet ski",
  "Emergency carpet cleaning, Wing C (do not ask)",
  "Consulting fee for the consultant who recommended consultants",
];

const FORCED_RULES = [
  { id: "equal", name: "Emergency Rule 7-C: Equal Shares", text: "The Acting Interim Comptroller has divided the pool evenly. Nobody is happy. That is the point." },
  { id: "proportional", name: "Emergency Rule 12: Proportional Pain", text: "Every department gets the same percentage of its request. The Comptroller has gone home." },
] as const;

// ------------------------------------------------------------------ state

type Phase = "BRIEFING" | "NEGOTIATE" | "VOTE" | "VERDICT" | "FORCED" | "INCIDENTS" | "CONSEQUENCES" | "AUDIT";
type Alloc = Record<string, number>;

type ObjectiveKind = "share" | "starve" | "patron" | "scapegoat" | "untouchable" | "lean" | "survivor" | "hero";

interface Objective {
  kind: ObjectiveKind;
  target: DeptId | null;
  text: string;
}

interface Dept {
  def: DeptDef;
  playerId: string;
  health: number;
  request: number;
  allocations: number[];
  requests: number[];
  tiers: number[];
  blamed: number;
  helped: number;
  objective: Objective;
  intel: string[];
}

interface Proposal {
  id: string;
  authorId: string | null;
  label: string;
  alloc: Alloc;
}

interface Deal {
  from: string;
  to: string;
  accepted: boolean;
}

interface IncidentRoll {
  def: IncidentDef;
  entity: string;
  needs: DeptId[];
  severity: number;
  chance: number;
  outcome: "CONTAINED" | "PATCHED" | "FAILED";
  hero: DeptId | null;
  blamed: DeptId | null;
  line: string;
  setup: string;
  stabilityDelta: number;
  kernelsLost: number;
  funding: { dept: DeptId; tier: number }[];
  cycle: number;
}

interface CycleSummary {
  stabilityBefore: number;
  stabilityAfter: number;
  healthChanges: { dept: DeptId; from: number; to: number; reason: string }[];
  deals: { from: DeptId; to: DeptId; honored: boolean }[];
  kernelsLost: number;
  notes: string[];
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new PartyError("INVALID_INPUT");
  return payload as Record<string, unknown>;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);
const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? k);

class BudgetCutsGame implements GameInstance {
  private readonly ctx: GameContext;
  private readonly settings: BudgetCutsSettings;
  private phase: Phase = "BRIEFING";
  private cycle = 0;
  private stability = START_STABILITY;
  private cycleStartStability = START_STABILITY;
  private depts: Dept[] = [];
  private pool = 0;
  private surprise: { name: string; cost: number } | null = null;
  private carriedLoss = 0;
  private forecast: { category: string; needs: DeptId[] }[] = [];
  private planned: IncidentRoll[] = [];
  private incidentIndex = -1;
  private proposals = new Map<string, Proposal>();
  private backing = new Map<string, string>();
  private locked = new Set<string>();
  private deals: Deal[] = [];
  private votes = new Map<string, boolean>();
  private voteAttempt = 0;
  private lastVote: { approve: number; reject: number; passed: boolean } | null = null;
  private forced: (typeof FORCED_RULES)[number] | null = null;
  private finalAlloc: Alloc | null = null;
  private summary: CycleSummary | null = null;
  private history: IncidentRoll[] = [];
  private collapsed = false;
  private funnies: string[] = [];
  private cues: { id: number; cue: string }[] = [];
  private cueSeq = 0;
  private nextStep: (() => void) | null = null;
  private audit: unknown = null;
  private readonly usedEntities = new Set<string>();

  constructor(ctx: GameContext, settings: BudgetCutsSettings) {
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
    this.cues.push({ id: ++this.cueSeq, cue });
    if (this.cues.length > 12) this.cues.shift();
  }

  private schedule(ms: number, step: () => void): void {
    this.nextStep = step;
    this.ctx.setTimer(ms, step);
  }

  private deptOf(playerId: string): Dept | undefined {
    return this.depts.find((d) => d.playerId === playerId);
  }

  private dept(id: DeptId): Dept | undefined {
    return this.depts.find((d) => d.def.id === id);
  }

  private name(id: DeptId): string {
    return DEPT_BY_ID.get(id)!.name;
  }

  // ------------------------------------------------------------------ setup

  start(): void {
    const players = this.ctx.players();
    // Containment, Security and Research first so small games still have the core trio.
    const core: DeptId[] = ["containment", "security", "research", "medical", "pr", "logistics", "strike", "records"];
    const chosen = players.length <= 3 ? this.shuffle(core.slice(0, 5)).slice(0, players.length) : this.shuffle(core).slice(0, players.length);
    const assigned = this.shuffle(chosen);
    this.depts = players.map((p, i) => ({
      def: DEPT_BY_ID.get(assigned[i]!)!,
      playerId: p.id,
      health: 0,
      request: 0,
      allocations: [],
      requests: [],
      tiers: [],
      blamed: 0,
      helped: 0,
      objective: { kind: "survivor", target: null, text: "" },
      intel: [],
    }));
    this.assignObjectives();
    this.cue("game_start");
    this.beginCycle();
  }

  private assignObjectives(): void {
    const n = this.depts.length;
    const sharePct = Math.max(20, Math.min(60, Math.round(140 / n)));
    const kinds: ObjectiveKind[] = this.shuffle(["share", "starve", "patron", "scapegoat", "untouchable", "lean", "survivor", "hero"]);
    this.depts.forEach((d, i) => {
      const kind = kinds[i % kinds.length]!;
      const others = this.depts.filter((o) => o !== d);
      const target = ["starve", "patron", "scapegoat"].includes(kind) && others.length ? this.pick(others).def.id : null;
      const t = target ? this.name(target).toUpperCase() : "";
      const text: Record<ObjectiveKind, string> = {
        share: `Receive at least ${sharePct}% of all kernels handed out this year.`,
        starve: `Keep ${t} below Adequate funding in at least 2 cycles.`,
        patron: `Get ${t} Well Funded (or better) in at least 2 cycles.`,
        scapegoat: `Make sure ${t} gets blamed for at least one failure.`,
        untouchable: "Never get blamed for a failure.",
        lean: "Never receive more than you asked for, and finish Operational or Strained.",
        survivor: "Finish the year Operational.",
        hero: "Help resolve at least 2 incidents (be Adequate or better when one is handled).",
      };
      d.objective = { kind, target, text: text[kind] };
    });
  }

  private objectiveMet(d: Dept): boolean {
    const o = d.objective;
    const target = o.target ? this.dept(o.target) : undefined;
    const played = d.tiers.length;
    switch (o.kind) {
      case "share": {
        const total = this.depts.reduce((s, x) => s + x.allocations.reduce((a, b) => a + b, 0), 0);
        const mine = d.allocations.reduce((a, b) => a + b, 0);
        const pct = Math.max(20, Math.min(60, Math.round(140 / this.depts.length)));
        return total > 0 && (mine / total) * 100 >= pct;
      }
      case "starve":
        return !!target && target.tiers.filter((t) => t <= 1).length >= Math.min(2, played);
      case "patron":
        return !!target && target.tiers.filter((t) => t >= 3).length >= Math.min(2, played);
      case "scapegoat":
        return !!target && target.blamed > 0;
      case "untouchable":
        return d.blamed === 0;
      case "lean":
        return d.allocations.every((a, i) => a <= (d.requests[i] ?? 0)) && d.health <= 1;
      case "survivor":
        return d.health === 0;
      case "hero":
        return d.helped >= 2;
    }
  }

  // ------------------------------------------------------------------ cycle

  private beginCycle(): void {
    this.cycle += 1;
    const c = this.cycle;
    const growth = 1 + 0.15 * (c - 1);
    for (const d of this.depts) {
      const emergency = d.health >= 2 ? 1.35 : 1;
      d.request = round5(d.def.baseRequest * growth * emergency);
    }
    const asked = this.depts.reduce((s, d) => s + d.request, 0);
    const fraction = [0.85, 0.72, 0.62, 0.55][Math.min(c - 1, 3)]!;
    let pool = asked * fraction;
    this.surprise = null;
    if (c >= 2) {
      const cost = round5(pool * (0.05 + this.rand() * 0.07));
      this.surprise = { name: this.pick(SURPRISES), cost };
      pool -= cost;
    }
    pool -= Math.min(this.carriedLoss, pool * 0.25);
    this.carriedLoss = 0;
    this.pool = round5(pool);

    this.planIncidents();
    this.writeIntel();

    // The Comptroller's Draft: proportional to requests, the default if nobody does better.
    this.proposals = new Map([["draft", { id: "draft", authorId: null, label: "Comptroller's Draft", alloc: this.proportional() }]]);
    this.backing.clear();
    this.locked.clear();
    this.deals = [];
    this.votes.clear();
    this.voteAttempt = 0;
    this.lastVote = null;
    this.forced = null;
    this.finalAlloc = null;
    this.summary = null;
    this.incidentIndex = -1;
    this.cycleStartStability = this.stability;

    this.phase = "BRIEFING";
    this.cue("alert");
    this.schedule(BUDGET_TIMING.briefingMs, () => this.openNegotiation(this.settings.negotiateSeconds * 1000));
    this.ctx.changed();
  }

  private proportional(): Alloc {
    const asked = this.depts.reduce((s, d) => s + d.request, 0);
    const alloc: Alloc = {};
    let given = 0;
    for (const d of this.depts) {
      const share = Math.floor(((this.pool * d.request) / asked) / 5) * 5;
      alloc[d.def.id] = share;
      given += share;
    }
    // Leftover crumbs go to whoever asked most.
    const biggest = [...this.depts].sort((a, b) => b.request - a.request)[0]!;
    alloc[biggest.def.id]! += this.pool - given;
    return alloc;
  }

  private equal(): Alloc {
    const each = Math.floor(this.pool / this.depts.length / 5) * 5;
    const alloc: Alloc = {};
    for (const d of this.depts) alloc[d.def.id] = each;
    alloc[this.depts[0]!.def.id]! += this.pool - each * this.depts.length;
    return alloc;
  }

  private planIncidents(): void {
    const inPlay = new Set(this.depts.map((d) => d.def.id));
    const usable = INCIDENTS.filter((i) => i.needs.some((n) => inPlay.has(n)));
    const count = this.cycle === 1 ? 1 : 2;
    const picked = this.shuffle(usable).slice(0, count);
    const entities = this.ctx.canon.sample("entity", 4).filter((r) => r.title && !this.usedEntities.has(r.ref));

    this.planned = picked.map((def) => {
      let entity = this.pick(FALLBACK_ENTITIES);
      if (def.usesEntity && entities.length) {
        const rec = entities.shift()!;
        this.usedEntities.add(rec.ref);
        this.ctx.canon.used(this.cycle, rec.ref);
        entity = rec.title;
      }
      const severity = Math.round(10 + this.cycle * 2.5 + this.rand() * 4);
      return {
        def,
        entity,
        needs: def.needs.filter((n) => inPlay.has(n)),
        severity,
        chance: 0,
        outcome: "FAILED" as const,
        hero: null,
        blamed: null,
        line: "",
        setup: fill(def.setup, { entity }),
        stabilityDelta: 0,
        kernelsLost: 0,
        funding: [],
        cycle: this.cycle,
      };
    });

    // Public forecast: the real categories plus one that will not happen, so nobody can be sure.
    const real = picked.map((p) => p.category);
    const decoys = usable.filter((i) => !real.includes(i.category));
    const decoy = decoys.length ? this.pick(decoys) : null;
    const entries = [...this.planned.map((p) => ({ category: p.def.category, needs: p.needs }))];
    if (decoy) entries.push({ category: decoy.category, needs: decoy.needs.filter((n) => inPlay.has(n)) });
    this.forecast = this.shuffle(entries);
  }

  private writeIntel(): void {
    const tested = new Set(this.planned.flatMap((p) => p.needs));
    const untested = this.depts.filter((d) => !tested.has(d.def.id));
    for (const d of this.depts) {
      const lines: string[] = [];
      const testedList = [...tested];
      const sure = testedList.length ? this.pick(testedList) : null;
      if (sure && (this.rand() < 0.6 || !untested.length)) lines.push(`Your sources say ${this.name(sure).toUpperCase()} will definitely be tested this cycle.`);
      else if (untested.length) lines.push(`Your sources say ${this.pick(untested).def.name.toUpperCase()} will NOT be needed this cycle.`);
      if (tested.has(d.def.id)) lines.push("Rumour in the hallway: your department is on this cycle's risk list.");
      const watchers = this.depts.filter((o) => o !== d && o.objective.target === d.def.id);
      if (watchers.length) lines.push(`Leverage: ${watchers.map((w) => w.def.name.toUpperCase()).join(" and ")} has a private interest in your department.`);
      if (d.health >= 2) lines.push("Your department is in bad shape. Your request includes an emergency top-up.");
      d.intel = lines;
    }
  }

  // ------------------------------------------------------------------ negotiation + vote

  private openNegotiation(ms: number): void {
    this.phase = "NEGOTIATE";
    this.locked.clear();
    this.schedule(ms, () => this.openVote());
    this.ctx.changed();
  }

  /** The proposal with the most backers. Ties go to the newest player proposal, then the draft. */
  private leading(): Proposal {
    const counts = new Map<string, number>();
    for (const id of this.backing.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
    let best = this.proposals.get("draft")!;
    let bestCount = counts.get("draft") ?? 0;
    for (const p of this.proposals.values()) {
      const n = counts.get(p.id) ?? 0;
      if (n > bestCount) {
        best = p;
        bestCount = n;
      }
    }
    return best;
  }

  private openVote(): void {
    this.phase = "VOTE";
    this.votes.clear();
    this.voteAttempt += 1;
    this.cue("vote_start");
    this.schedule(this.settings.voteSeconds * 1000, () => this.tallyVote());
    this.ctx.changed();
  }

  private tallyVote(): void {
    let approve = 0;
    let reject = 0;
    for (const v of this.votes.values()) v ? approve++ : reject++;
    const passed = approve > reject;
    this.lastVote = { approve, reject, passed };
    this.phase = "VERDICT";
    if (passed) {
      this.finalAlloc = { ...this.leading().alloc };
      this.cue("success");
      this.schedule(BUDGET_TIMING.verdictMs, () => this.lockBudget());
    } else {
      this.cue("vote_result");
      if (this.voteAttempt >= MAX_VOTES) this.schedule(BUDGET_TIMING.verdictMs, () => this.forceBudget());
      else this.schedule(BUDGET_TIMING.verdictMs, () => this.openNegotiation(BUDGET_TIMING.renegotiateMs));
    }
    this.ctx.changed();
  }

  private forceBudget(): void {
    this.forced = this.pick(FORCED_RULES);
    this.finalAlloc = this.forced.id === "equal" ? this.equal() : this.proportional();
    this.stability = Math.max(0, this.stability - 4);
    this.funnies.push(`Cycle ${this.cycle}: nobody could agree, so ${this.forced.name} took over.`);
    this.phase = "FORCED";
    this.cue("major_failure");
    this.schedule(BUDGET_TIMING.forcedMs, () => this.lockBudget());
    this.ctx.changed();
  }

  private lockBudget(): void {
    const alloc = this.finalAlloc ?? this.proportional();
    for (const d of this.depts) {
      const a = alloc[d.def.id] ?? 0;
      d.allocations.push(a);
      d.requests.push(d.request);
      d.tiers.push(tierFor(a, d.request));
    }
    this.resolveIncidents();
    this.incidentIndex = -1;
    this.phase = "INCIDENTS";
    this.revealIncident();
  }

  // ------------------------------------------------------------------ incidents

  private resolveIncidents(): void {
    const danger = 0.05 * (this.cycle - 1);
    for (const inc of this.planned) {
      const funding = inc.needs.map((id) => ({ dept: id, tier: this.dept(id)!.tiers.at(-1)! }));
      const effect = (id: DeptId, tier: number) => {
        const d = this.dept(id)!;
        return d.health >= 3 ? 0 : Math.max(0, TIER_EFFECT[tier]! - HEALTH_PENALTY[d.health]!);
      };
      const effs = funding.map((f) => ({ ...f, eff: effect(f.dept, f.tier) }));
      const avg = effs.length ? effs.reduce((s, f) => s + f.eff, 0) / effs.length : 1;
      const chance = Math.min(0.92, Math.max(0.08, 0.25 + 0.2 * avg - inc.def.danger - danger));
      const roll = this.rand();
      inc.chance = chance;
      inc.funding = funding;
      inc.outcome = roll < chance * 0.7 ? "CONTAINED" : roll < chance ? "PATCHED" : "FAILED";

      const sorted = this.shuffle(effs).sort((a, b) => b.eff - a.eff);
      const hero = sorted[0]?.dept ?? null;
      const blamed = sorted.at(-1)?.dept ?? null;
      if (inc.outcome === "FAILED") {
        inc.blamed = blamed;
        inc.stabilityDelta = -inc.severity;
        inc.kernelsLost = inc.severity * 2;
        inc.line = fill(this.pick(inc.def.failed), { entity: inc.entity, blamed: blamed ? this.name(blamed) : "Nobody" });
        this.funnies.push(inc.line);
      } else {
        inc.hero = hero;
        inc.stabilityDelta = inc.outcome === "CONTAINED" ? 3 : -Math.round(inc.severity / 3);
        const lines = inc.outcome === "CONTAINED" ? inc.def.contained : inc.def.patched;
        inc.line = fill(this.pick(lines), { entity: inc.entity, hero: hero ? this.name(hero) : "Somebody" });
      }
    }
  }

  private applyIncident(inc: IncidentRoll): void {
    this.stability = Math.max(0, Math.min(100, this.stability + inc.stabilityDelta));
    this.carriedLoss += inc.kernelsLost;
    if (inc.outcome === "FAILED") {
      this.cue("major_failure");
      if (inc.blamed) {
        const d = this.dept(inc.blamed)!;
        d.blamed += 1;
        this.ctx.addPoints(d.playerId, POINTS.blamed);
        this.ctx.countStat(d.playerId, "budgetBlamed");
      }
    } else {
      this.cue("success");
      for (const f of inc.funding) {
        if (f.tier < 2) continue;
        const d = this.dept(f.dept)!;
        d.helped += 1;
        this.ctx.addPoints(d.playerId, POINTS.helped);
      }
    }
    this.history.push(inc);
  }

  /** Reveals the next incident and applies it at once, so the screen and the stability bar agree. */
  private revealIncident(): void {
    this.incidentIndex += 1;
    this.cue("alert");
    this.applyIncident(this.planned[this.incidentIndex]!);
    const last = this.stability <= 0 || this.incidentIndex + 1 >= this.planned.length;
    this.schedule(BUDGET_TIMING.incidentMs, () => (last ? this.endCycle() : this.revealIncident()));
    this.ctx.changed();
  }

  private endCycle(): void {
    const before = this.cycleStartStability;
    const changes: CycleSummary["healthChanges"] = [];
    const notes: string[] = [];

    for (const d of this.depts) {
      const from = d.health;
      const tier = d.tiers.at(-1) ?? 2;
      const wasBlamed = this.planned.some((p) => this.history.includes(p) && p.blamed === d.def.id);
      let to = from + (wasBlamed ? 1 : 0) + (tier === 0 ? 1 : 0);
      let reason = [wasBlamed ? "blamed for a failure" : "", tier === 0 ? "severely underfunded" : ""].filter(Boolean).join(" + ");
      if (!wasBlamed && tier >= 3 && from > 0) {
        to = from - 1;
        reason = "well funded — recovering";
      }
      to = Math.max(0, Math.min(3, to));
      if (to !== from) {
        changes.push({ dept: d.def.id, from, to, reason });
        if (to === 3 && from < 3) {
          this.cue("major_failure");
          this.funnies.push(`${d.def.name} officially ceased to function. Its plant is now in charge.`);
        }
      }
      d.health = to;
      if (d.health === 3) {
        this.stability = Math.max(0, this.stability - 6);
        notes.push(`${d.def.name} has FAILED: −6 stability until someone funds it back to life.`);
      }
    }

    const deals: CycleSummary["deals"] = [];
    for (const deal of this.deals.filter((x) => x.accepted)) {
      const a = this.deptOf(deal.from);
      const b = this.deptOf(deal.to);
      if (!a || !b) continue;
      const honored = (a.tiers.at(-1) ?? 0) >= 2 && (b.tiers.at(-1) ?? 0) >= 2;
      deals.push({ from: a.def.id, to: b.def.id, honored });
      if (honored) {
        this.ctx.addPoints(a.playerId, POINTS.deal);
        this.ctx.addPoints(b.playerId, POINTS.deal);
        this.ctx.countStat(a.playerId, "budgetDeals");
        this.ctx.countStat(b.playerId, "budgetDeals");
      }
    }

    this.summary = { stabilityBefore: before, stabilityAfter: this.stability, healthChanges: changes, deals, kernelsLost: this.carriedLoss, notes };
    for (const p of this.ctx.players()) this.ctx.countStat(p.id, "roundsPlayed");
    if (this.stability <= 0) this.collapsed = true;

    this.phase = "CONSEQUENCES";
    this.ctx.changed();
    const last = this.collapsed || this.cycle >= this.settings.cycles;
    this.schedule(BUDGET_TIMING.consequencesMs, () => (last ? this.openAudit() : this.beginCycle()));
  }

  // ------------------------------------------------------------------ end

  private openAudit(): void {
    const survived = !this.collapsed;
    const rows = this.depts.map((d) => {
      const met = this.objectiveMet(d);
      let objectivePts = met ? POINTS.objective : 0;
      if (!survived) objectivePts = Math.floor(objectivePts / 2);
      const healthPts = POINTS.health[d.health]!;
      const groupPts = survived ? this.stability * POINTS.stabilityMultiplier : 0;
      this.ctx.addPoints(d.playerId, objectivePts + healthPts + groupPts);
      if (met) this.ctx.countStat(d.playerId, "budgetObjectives");
      const totalAlloc = d.allocations.reduce((a, b) => a + b, 0);
      const totalReq = d.requests.reduce((a, b) => a + b, 0);
      return {
        dept: d.def.id,
        name: d.def.name,
        glyph: d.def.glyph,
        player: this.ctx.playerName(d.playerId),
        health: HEALTH[d.health],
        objective: d.objective.text,
        objectiveMet: met,
        objectivePts,
        healthPts,
        groupPts,
        funded: totalReq ? Math.round((totalAlloc / totalReq) * 100) : 0,
        blamed: d.blamed,
        helped: d.helped,
      };
    });

    const failures = this.history.filter((h) => h.outcome === "FAILED").sort((a, b) => b.severity - a.severity);
    const byFunding = [...rows].sort((a, b) => b.funded - a.funded);
    this.audit = {
      survived,
      stability: this.stability,
      rows,
      disaster: failures[0] ? { title: failures[0].def.title, line: failures[0].line, cycle: failures[0].cycle, severity: failures[0].severity } : null,
      bestFunded: byFunding[0] ? { name: byFunding[0].name, funded: byFunding[0].funded } : null,
      worstFunded: byFunding.at(-1) ? { name: byFunding.at(-1)!.name, funded: byFunding.at(-1)!.funded } : null,
      funniest: this.funnies.length ? this.pick(this.funnies) : null,
    };
    this.phase = "AUDIT";
    this.cue("game_end");
    this.schedule(BUDGET_TIMING.auditMs, () => this.finish());
    this.ctx.changed();
  }

  private finish(): void {
    const a = this.audit as { survived: boolean; stability: number; rows: { name: string; player: string; objectiveMet: boolean; objective: string }[]; disaster: { title: string; line: string } | null; bestFunded: { name: string; funded: number } | null; worstFunded: { name: string; funded: number } | null; funniest: string | null } | null;
    const highlights: Highlight[] = [];
    if (a) {
      highlights.push({
        title: a.survived ? "CPI Survived the Fiscal Year" : "Catastrophic Bureaucratic Failure",
        playerName: null,
        text: null,
        detail: a.survived ? `Final stability ${a.stability}%. Everyone shares the credit, nobody shares the blame.` : "Stability hit zero. The CPI is now operated by a single sticky note reading 'back in 5'.",
      });
      if (a.disaster) highlights.push({ title: "Biggest Budget Disaster", playerName: null, text: a.disaster.line, detail: a.disaster.title });
      if (a.bestFunded) highlights.push({ title: "Best-Funded Department", playerName: null, text: null, detail: `${a.bestFunded.name} — ${a.bestFunded.funded}% of what it asked for` });
      if (a.worstFunded) highlights.push({ title: "Most Underfunded Department", playerName: null, text: null, detail: `${a.worstFunded.name} — ${a.worstFunded.funded}% of what it asked for` });
      if (a.funniest) highlights.push({ title: "Funniest Consequence", playerName: null, text: a.funniest, detail: "Filed under 'lessons learned'" });
      for (const r of a.rows.filter((r) => r.objectiveMet)) {
        highlights.push({ title: "Hidden Priority Achieved", playerName: r.player, text: r.objective, detail: r.name });
      }
    }
    this.ctx.finish({ rounds: this.cycle, highlights });
  }

  // ------------------------------------------------------------------ input

  private readAlloc(raw: unknown): Alloc {
    const input = asRecord(raw);
    const alloc: Alloc = {};
    let total = 0;
    for (const d of this.depts) {
      const v = input[d.def.id];
      const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
      if (n < 0) throw new PartyError("INVALID_INPUT", "Allocations can't be negative.");
      alloc[d.def.id] = n;
      total += n;
    }
    if (total > this.pool) throw new PartyError("INVALID_INPUT", `That's ${total} kernels. Only ${this.pool} are available.`);
    return alloc;
  }

  handleInput(playerId: string, action: string, payload: unknown): void {
    const me = this.deptOf(playerId);
    if (!me) throw new PartyError("INVALID_ACTION");

    if (action === "vote") {
      if (this.phase !== "VOTE") throw new PartyError("PHASE_CLOSED");
      if (this.votes.has(playerId)) throw new PartyError("ALREADY_VOTED");
      const { approve } = asRecord(payload);
      if (typeof approve !== "boolean") throw new PartyError("INVALID_VOTE");
      this.votes.set(playerId, approve);
      if (this.ctx.players().every((p) => this.votes.has(p.id))) {
        this.ctx.clearTimer();
        return this.tallyVote();
      }
      return this.ctx.changed();
    }

    if (this.phase !== "NEGOTIATE") throw new PartyError("PHASE_CLOSED");

    switch (action) {
      case "propose": {
        const { alloc } = asRecord(payload);
        this.proposals.set(playerId, { id: playerId, authorId: playerId, label: `${me.def.name} plan`, alloc: this.readAlloc(alloc) });
        this.backing.set(playerId, playerId);
        this.locked.delete(playerId);
        break;
      }
      case "back": {
        const { proposalId } = asRecord(payload);
        if (typeof proposalId !== "string" || !this.proposals.has(proposalId)) throw new PartyError("INVALID_INPUT");
        this.backing.set(playerId, proposalId);
        break;
      }
      case "deal": {
        const { dept } = asRecord(payload);
        const target = this.depts.find((d) => d.def.id === dept);
        if (!target || target === me) throw new PartyError("INVALID_INPUT");
        const incoming = this.deals.find((x) => x.from === target.playerId && x.to === playerId);
        if (incoming) incoming.accepted = true;
        else if (!this.deals.some((x) => x.from === playerId && x.to === target.playerId)) {
          if (this.deals.filter((x) => x.from === playerId).length >= 3) throw new PartyError("INVALID_INPUT", "Three deal offers per cycle.");
          this.deals.push({ from: playerId, to: target.playerId, accepted: false });
        }
        break;
      }
      case "lock": {
        this.locked.add(playerId);
        if (!this.backing.has(playerId)) this.backing.set(playerId, this.leading().id);
        if (this.ctx.players().every((p) => this.locked.has(p.id))) {
          this.ctx.clearTimer();
          return this.openVote();
        }
        break;
      }
      case "unlock":
        this.locked.delete(playerId);
        break;
      default:
        throw new PartyError("INVALID_ACTION");
    }
    this.ctx.changed();
  }

  hostAction(action: string): void {
    if (action !== "skip" || !this.nextStep) throw new PartyError("INVALID_ACTION");
    const step = this.nextStep;
    this.ctx.clearTimer();
    step();
  }

  playerLeft(): void {
    const players = this.ctx.players();
    if (this.phase === "VOTE" && players.length && players.every((p) => this.votes.has(p.id))) {
      this.ctx.clearTimer();
      this.tallyVote();
    } else if (this.phase === "NEGOTIATE" && players.length && players.every((p) => this.locked.has(p.id))) {
      this.ctx.clearTimer();
      this.openVote();
    }
  }

  dispose(): void {
    this.nextStep = null;
  }

  // ------------------------------------------------------------------ views

  private deptView(d: Dept, alloc: Alloc | null) {
    const a = alloc ? (alloc[d.def.id] ?? 0) : null;
    return {
      id: d.def.id,
      name: d.def.name,
      glyph: d.def.glyph,
      motto: d.def.motto,
      good: d.def.good,
      weak: d.def.weak,
      pitch: d.def.pitch[(this.cycle - 1) % d.def.pitch.length],
      player: this.ctx.playerName(d.playerId),
      playerId: d.playerId,
      request: d.request,
      health: d.health,
      healthLabel: HEALTH[d.health],
      emergency: d.health >= 2,
      allocated: a,
      tier: a === null ? null : tierFor(a, d.request),
      tierLabel: a === null ? null : TIERS[tierFor(a, d.request)],
    };
  }

  private incidentView(inc: IncidentRoll, revealed: boolean) {
    const base = { title: inc.def.title, category: inc.def.category, setup: inc.setup, needs: inc.needs.map((n) => ({ id: n, name: this.name(n) })), severity: inc.severity };
    if (!revealed) return base;
    return {
      ...base,
      outcome: inc.outcome,
      chance: Math.round(inc.chance * 100),
      line: inc.line,
      hero: inc.hero ? this.name(inc.hero) : null,
      blamed: inc.blamed ? this.name(inc.blamed) : null,
      stabilityDelta: inc.stabilityDelta,
      kernelsLost: inc.kernelsLost,
      funding: inc.funding.map((f) => ({ id: f.dept, name: this.name(f.dept), tier: f.tier, tierLabel: TIERS[f.tier] })),
    };
  }

  viewFor(viewer: Viewer): unknown {
    const playerId = viewer.kind === "player" ? viewer.playerId : null;
    const leading = this.proposals.size ? this.leading() : null;
    const shownAlloc = this.finalAlloc ?? (this.phase === "NEGOTIATE" || this.phase === "VOTE" || this.phase === "VERDICT" ? (leading?.alloc ?? null) : null);
    const backers = new Map<string, string[]>();
    for (const [pid, propId] of this.backing) backers.set(propId, [...(backers.get(propId) ?? []), this.deptOf(pid)?.def.name ?? "?"]);

    const view: Record<string, unknown> = {
      phase: this.phase,
      cycle: this.cycle,
      totalCycles: this.settings.cycles,
      stability: this.stability,
      pool: this.pool,
      situation: SITUATIONS[Math.min(this.cycle - 1, SITUATIONS.length - 1)],
      surprise: this.surprise,
      forecast: this.forecast.map((f) => ({ category: f.category, needs: f.needs.map((n) => this.name(n)) })),
      forecastReal: this.planned.length,
      depts: this.depts.map((d) => this.deptView(d, shownAlloc)),
      proposals: [...this.proposals.values()].map((p) => ({ id: p.id, label: p.label, alloc: p.alloc, backers: backers.get(p.id) ?? [] })),
      leadingId: leading?.id ?? null,
      lockedCount: this.locked.size,
      playerCount: this.ctx.players().length,
      deals: this.deals.map((d) => ({ from: this.deptOf(d.from)?.def.name, to: this.deptOf(d.to)?.def.name, accepted: d.accepted })),
      voteAttempt: this.voteAttempt,
      maxVotes: MAX_VOTES,
      votesCast: this.votes.size,
      lastVote: this.lastVote,
      forced: this.forced,
      incidentIndex: this.incidentIndex,
      incidents: this.phase === "INCIDENTS" || this.phase === "CONSEQUENCES" ? this.planned.slice(0, this.incidentIndex + 1).map((i) => this.incidentView(i, true)) : [],
      summary: this.phase === "CONSEQUENCES" ? { ...this.summary, healthChanges: this.summary?.healthChanges.map((c) => ({ ...c, name: this.name(c.dept), fromLabel: HEALTH[c.from], toLabel: HEALTH[c.to] })), deals: this.summary?.deals.map((x) => ({ from: this.name(x.from), to: this.name(x.to), honored: x.honored })) } : null,
      collapsed: this.collapsed,
      audit: this.phase === "AUDIT" ? this.audit : null,
      cues: this.cues,
    };

    if (!playerId) return view;
    const me = this.deptOf(playerId);
    if (!me) return view;
    const mine = this.proposals.get(playerId);
    view.you = {
      dept: this.deptView(me, shownAlloc),
      objective: me.objective.text,
      // Live progress only for the player's own objective, never anyone else's.
      objectiveOnTrack: me.tiers.length > 0 ? this.objectiveMet(me) : null,
      intel: me.intel,
      proposal: mine?.alloc ?? null,
      backing: this.backing.get(playerId) ?? null,
      locked: this.locked.has(playerId),
      vote: this.votes.has(playerId) ? this.votes.get(playerId) : null,
      dealsIn: this.deals.filter((d) => d.to === playerId && !d.accepted).map((d) => this.deptOf(d.from)?.def.id),
      dealsOut: this.deals.filter((d) => d.from === playerId).map((d) => ({ dept: this.deptOf(d.to)?.def.id, accepted: d.accepted })),
      dealsAccepted: this.deals.filter((d) => d.accepted && (d.from === playerId || d.to === playerId)).map((d) => this.deptOf(d.from === playerId ? d.to : d.from)?.def.id),
    };
    return view;
  }
}

export const budgetCutsGame: GameDefinition<BudgetCutsSettings> = {
  id: "budgetcuts",
  name: "Budget Cuts",
  tagline: "One emergency budget. Too many departments. Argue.",
  description:
    "Every agent runs a CPI department with its own needs and a hidden priority. Each cycle the group splits a " +
    "shrinking pool of kernels, argues it out, votes, and then incidents hit — and the funding decides who " +
    "saves the day and who gets blamed. Keep the CPI stable, or watch it collapse into paperwork.",
  minPlayers: 2,
  maxPlayers: 8,
  defaultSettings: { cycles: 3, negotiateSeconds: 75, voteSeconds: 20 },
  deck: {
    shelf: "party",
    genre: "Negotiation",
    controls: ["Phone: propose budgets, back plans, make deals, vote", "Big screen: the budget, the incidents, the blame"],
    length: "10–15 min",
    art: { from: "#1f2a1a", to: "#0a0d08", accent: "#e8c547", glyph: "💰", motif: "dots" },
  },
  parseSettings(raw: unknown): BudgetCutsSettings {
    const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const d = this.defaultSettings;
    return {
      cycles: clampInt(input.cycles, 2, 4, d.cycles),
      negotiateSeconds: clampInt(input.negotiateSeconds, 30, 120, d.negotiateSeconds),
      voteSeconds: clampInt(input.voteSeconds, 10, 40, d.voteSeconds),
    };
  },
  create(ctx, settings) {
    return new BudgetCutsGame(ctx, settings);
  },
};
