// The Incident Director: the world and the narrative, never the rules.
//
// A director reads the whole incident (including everything players haven't discovered, and every
// agent's raw response) and returns *structured effects*: what each action meant, which stats it
// moved, who got hurt, what was found, what new problems appeared, and the narration. It never
// awards points, decides a winner, or touches lives directly.
//
// validateDirectorOutput() is the boundary. Whatever a director returns — a language model's
// JSON, garbage, or nothing — is checked against the engine's rolls: unknown fields are ignored,
// magnitudes are clamped to the outcome the engine rolled, changes need a mechanical basis, reveals
// have a budget, and every piece of text is cleaned and scrubbed of anything players can't know.
// The result is always a complete, safe ValidatedOutput.
//
// MockIncidentDirector is the built-in director: deterministic, template-driven, no network and
// no API key. A language-model director is one more class implementing IncidentDirector.

import { cleanText } from "../../text.ts";
import { NOVELTIES, STAT_IDS, type MyCobConfig, type Novelty, type Outcome, type ResponseTag, type StatId } from "./config.ts";
import { SYSTEM_IDS, SYSTEMS, TAG_REPAIRS, type Condition, type SystemId } from "./content.ts";
import {
  describeStat,
  fill,
  PERSONNEL_STATUSES,
  scrubHidden,
  type Incident,
  type PersonnelStatus,
  type Random,
} from "./incident.ts";
import { defaultEffects, effectEnvelope, FAILURES, SUCCESSES, toneFor, type ActionPlan, type LifeLoss, type StagePlan } from "./rules.ts";

// ------------------------------------------------------------------ contract

export interface IncidentDirector {
  readonly id: string;
  /**
   * Resolves one stage. May be slow or fail: the game waits at most processingMaxMs, then falls
   * back to the mock director. The return value is untrusted and always validated.
   */
  resolveStage(context: DirectorContext): Promise<unknown>;
}

/** Everything a director is told about a stage. Server-side only; never sent to any client. */
export interface DirectorContext {
  stage: number;
  totalStages: number;
  mode: string;
  tone: "calm" | "tense" | "unhinged";
  incident: {
    code: string;
    entity: Incident["entity"];
    breach: { name: string; text: string; entitySpecific: boolean };
    location: { id: string; name: string; description: string };
    threatLocation: string | null;
    locations: { id: string; name: string }[];
    problem: string;
    environment: string[];
    systems: Record<SystemId, Condition>;
    personnel: Incident["personnel"];
    objectives: Incident["objectives"];
    facts: Incident["facts"];
    stats: Incident["stats"];
    statuses: { id: StatId; value: string }[];
    anomalies: { name: string; text: string }[];
    difficulty: number;
  };
  /** The last few stages' narration, oldest first. */
  history: string[];
  actions: {
    actionId: string;
    playerId: string;
    playerName: string;
    role: string;
    usesRoleTags: ResponseTag[];
    tag: ResponseTag;
    approach: string;
    sacrifice: boolean;
    /** The agent's own words. */
    text: string;
    actionCount: number;
    references: string[];
    /** Rolled by the engine. Narrate this outcome; do not change it. */
    outcome: Outcome;
    twist: boolean;
    lifeAtRisk: boolean;
    /** If you read this action as an attempt to kill the entity, it only succeeds when this is true. */
    terminationPossible: boolean;
    /** Allowed range for each primary stat change. */
    primaryRange: [number, number];
  }[];
  idle: { playerId: string; playerName: string }[];
  hazards: { playerId: string; playerName: string }[];
  interactions: { a: string; b: string; kind: string; affected: string | null }[];
  specialEvent: { name: string; text: string } | null;
  newProblem: string | null;
  limits: {
    stats: StatId[];
    personnelStatuses: readonly PersonnelStatus[];
    /** Whether revealing the unknown entity's identity (fact f-identity) is allowed this stage. */
    identityRevealAllowed: boolean;
    maxReveals: number;
    maxGeneratedFacts: number;
    maxNewObjectives: number;
    narrationMax: number;
    summaryMax: number;
  };
}

export interface Interpretation {
  actionId: string;
  summary: string;
  usesRole: boolean;
  novelty: Novelty;
  intent: "terminate" | null;
}

export interface ValidatedOutput {
  interpretations: Interpretation[];
  primaryEffects: { actionId: string; stat: StatId; delta: number }[];
  secondaryEffects: { actionId: string | null; stat: StatId; delta: number }[];
  chaosEffects: { actionId: string | null; delta: number }[];
  personnelEffects: { npcId: string; status: PersonnelStatus }[];
  systemEffects: { system: SystemId; condition: Condition }[];
  lifeEvents: LifeLoss[];
  reveals: string[];
  generatedFacts: { label: string; text: string }[];
  newObjectives: string[];
  objectiveUpdates: { objectiveId: string; status: "completed" | "failed" | "impossible" }[];
  specialEventText: string | null;
  /** undefined: no change. null: nobody knows where it is any more. */
  threatLocation?: string | null;
  narration: string;
  /** What validation dropped or changed. Analytics only. */
  issues: string[];
}

// ------------------------------------------------------------------ context

export function buildDirectorContext(
  incident: Incident,
  plan: StagePlan,
  names: ReadonlyMap<string, string>,
  history: string[],
  config: MyCobConfig,
): DirectorContext {
  const name = (id: string) => names.get(id) ?? "An agent";
  return {
    stage: plan.stage,
    totalStages: plan.totalStages,
    mode: incident.mode,
    tone: toneFor(incident.stats),
    incident: {
      code: incident.code,
      entity: incident.entity,
      breach: { name: incident.breach.name, text: incident.breach.text, entitySpecific: !!incident.breach.entitySpecific },
      location: { id: incident.location.id, name: incident.location.name, description: incident.location.description },
      threatLocation: incident.threatLocation,
      locations: incident.locations.map((l) => ({ id: l.id, name: l.name })),
      problem: incident.problem.text,
      environment: incident.environment.map((e) => e.text),
      systems: incident.systems,
      personnel: incident.personnel,
      objectives: incident.objectives,
      facts: incident.facts,
      stats: incident.stats,
      statuses: STAT_IDS.map((id) => ({ id, value: describeStat(id, incident.stats[id], config).value })),
      anomalies: incident.anomalies.map((a) => ({ name: a.name, text: a.text })),
      difficulty: incident.difficulty,
    },
    history: history.slice(-3),
    actions: plan.actions.map((a) => ({
      actionId: a.id,
      playerId: a.playerId,
      playerName: a.playerName,
      role: a.roleName,
      usesRoleTags: a.strongTags,
      tag: a.tag,
      approach: a.approach,
      sacrifice: a.sacrifice,
      text: a.text,
      actionCount: a.analysis.actionCount,
      references: a.analysis.references,
      outcome: a.roll.outcome,
      twist: a.roll.twist,
      lifeAtRisk: a.roll.lifeAtRisk,
      terminationPossible: a.roll.terminationPossible,
      primaryRange: effectEnvelope(a.roll.outcome, a.roll.magnitude, config, "primary").map(Math.round) as [number, number],
    })),
    idle: plan.idle.map((id) => ({ playerId: id, playerName: name(id) })),
    hazards: plan.hazards.map((id) => ({ playerId: id, playerName: name(id) })),
    interactions: plan.interactions,
    specialEvent: plan.specialEvent ? { name: plan.specialEvent.name, text: plan.specialEvent.text } : null,
    newProblem: plan.newProblem?.text ?? null,
    limits: {
      stats: STAT_IDS.filter((s) => s !== "chaos"),
      personnelStatuses: PERSONNEL_STATUSES,
      identityRevealAllowed: identityRevealAllowed(plan, incident, config),
      maxReveals: config.reveals.maxPerStage,
      maxGeneratedFacts: config.reveals.maxGeneratedPerStage,
      maxNewObjectives: config.objectives.maxNewPerStage,
      narrationMax: config.narration.maxLength,
      summaryMax: config.narration.summaryMax,
    },
  };
}

// ------------------------------------------------------------------ validation

/** The unknown entity can only be identified with enough information and a successful inquiry. */
export function identityRevealAllowed(plan: StagePlan, incident: Incident, config: MyCobConfig): boolean {
  const inquiries = plan.actions.filter((a) => ["INVESTIGATE", "COMMUNICATE", "STRATEGIZE"].includes(a.tag));
  return (
    (incident.stats.information >= config.unknownEntity.identifyInformationAt && inquiries.some((a) => SUCCESSES.includes(a.roll.outcome))) ||
    (config.unknownEntity.identifyOnCritical && inquiries.some((a) => a.roll.outcome === "critical"))
  );
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const asArray = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(asObject).filter((x): x is Record<string, unknown> => x !== null) : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const clampN = (n: number, [min, max]: [number, number]) => Math.round(Math.min(max, Math.max(min, n)));

const OUTCOME_WORDS: Record<Outcome, string> = {
  critical: "and it worked better than anyone expected",
  success: "and it worked",
  partial: "and it half worked",
  failure: "and it did not work",
  catastrophe: "and made everything worse",
};

const TAG_WORDS: Record<ResponseTag, string> = {
  CONTAIN: "moved to contain it",
  EVACUATE: "started an evacuation",
  INVESTIGATE: "investigated",
  COMMUNICATE: "got on comms",
  DEPLOY: "deployed a team",
  EQUIPMENT: "went for the equipment",
  STRATEGIZE: "made a plan",
  OTHER: "tried something unusual",
};

export function defaultSummary(action: ActionPlan): string {
  return `${action.playerName} (${action.roleName}) ${TAG_WORDS[action.tag]} ${OUTCOME_WORDS[action.roll.outcome]}.`;
}

/**
 * Turns whatever a director returned into a safe, complete result. Returns null only when the
 * output is not even an object, so the caller can fall back to the mock director.
 */
export function validateDirectorOutput(raw: unknown, plan: StagePlan, incident: Incident, config: MyCobConfig): ValidatedOutput | null {
  const input = asObject(raw);
  if (!input) return null;
  const issues: string[] = [];

  // Reveals first: a budget earned by actions that went somewhere, and the identity has its own
  // bar. What is revealed this stage may then be named in this stage's text.
  const progress = plan.actions.filter((a) => a.roll.outcome !== "failure" && a.roll.outcome !== "catastrophe").length;
  let budget = Math.min(config.reveals.maxPerStage, progress * config.reveals.perSuccess + (incident.stats.information >= 75 ? 1 : 0));
  const identityAllowed = identityRevealAllowed(plan, incident, config);
  const reveals: string[] = [];
  const requests = asArray(input.newInformation);
  if (input.revealEntity === true) requests.unshift({ factId: "f-identity" });
  for (const r of requests) {
    const factId = str(r.factId);
    if (!factId) continue;
    const fact = incident.facts.find((f) => f.id === factId);
    if (!fact || fact.visibility === "known" || reveals.includes(factId) || budget <= 0) continue;
    if (fact.about === "identity" && !identityAllowed) {
      issues.push("refused identity reveal");
      continue;
    }
    const holder = fact.heldBy ? incident.personnel.find((p) => p.id === fact.heldBy) : undefined;
    if (holder && (holder.status === "dead" || holder.status === "missing")) continue;
    reveals.push(factId);
    budget -= 1;
  }
  const revealing = new Set(reveals);

  // Agents never see each other's raw responses, so a director quoting one word for word is cut.
  const rawResponses = plan.actions.map((a) => a.text).filter((t) => t.length >= 20);
  const scrub = (value: unknown, max: number): string | null => {
    const cleaned = cleanText(value, max * 4);
    if (!cleaned.ok) return null;
    let text = scrubHidden(cleaned.value, incident, revealing);
    for (const raw of rawResponses) text = text.split(raw).join("…");
    return [...text].length > max ? `${[...text].slice(0, max - 1).join("")}…` : text;
  };
  for (const forbidden of ["points", "score", "scores", "winner", "winners", "lives", "stats"]) {
    if (forbidden in input) issues.push(`ignored field: ${forbidden}`);
  }

  const actions = new Map(plan.actions.map((a) => [a.id, a]));
  const outcomes = plan.actions.map((a) => a.roll.outcome);
  const anySuccess = outcomes.some((o) => SUCCESSES.includes(o));
  const anyProgress = anySuccess || outcomes.includes("partial");
  const anyFailure = outcomes.some((o) => FAILURES.includes(o)) || plan.actions.some((a) => a.roll.twist);
  const anyCatastrophe = outcomes.includes("catastrophe");
  const troubleBasis = anyFailure || plan.specialEvent !== null || plan.hazards.length > 0;
  const statIds = STAT_IDS.filter((s) => s !== "chaos") as StatId[];

  // Interpretations: exactly one per action.
  const rawInterpretations = new Map(asArray(input.actionInterpretations).map((i) => [str(i.actionId), i]));
  const interpretations: Interpretation[] = plan.actions.map((action) => {
    const r = rawInterpretations.get(action.id);
    if (!r) issues.push(`default interpretation: ${action.id}`);
    const novelty = NOVELTIES.includes(r?.novelty as Novelty) ? (r!.novelty as Novelty) : "standard";
    return {
      actionId: action.id,
      summary: (r && scrub(r.summary, config.narration.summaryMax)) || defaultSummary(action),
      usesRole: typeof r?.usesRole === "boolean" ? r.usesRole : action.strongTags.includes(action.tag),
      novelty,
      intent: r?.intent === "terminate" ? "terminate" : null,
    };
  });

  // Stat effects, clamped into the envelope of the outcome the engine rolled.
  const primaryEffects: ValidatedOutput["primaryEffects"] = [];
  for (const e of asArray(input.primaryEffects)) {
    const action = actions.get(str(e.actionId) ?? "");
    const stat = str(e.stat) as StatId;
    const delta = num(e.delta);
    if (!action || !statIds.includes(stat) || delta === null) {
      issues.push("dropped primary effect");
      continue;
    }
    if (primaryEffects.filter((p) => p.actionId === action.id).length >= 3) continue;
    const range = effectEnvelope(action.roll.outcome, action.roll.magnitude, config, "primary");
    const clamped = clampN(delta, range);
    if (clamped !== Math.round(delta)) issues.push(`clamped ${action.id}.${stat}`);
    primaryEffects.push({ actionId: action.id, stat, delta: clamped });
  }
  for (const action of plan.actions) {
    if (!primaryEffects.some((p) => p.actionId === action.id)) {
      for (const d of defaultEffects(action, config)) primaryEffects.push({ actionId: action.id, ...d });
    }
  }

  const secondaryEffects: ValidatedOutput["secondaryEffects"] = [];
  for (const e of asArray(input.secondaryEffects)) {
    const actionId = str(e.actionId);
    const action = actionId ? actions.get(actionId) : undefined;
    const stat = str(e.stat) as StatId;
    const delta = num(e.delta);
    if ((actionId && !action) || !statIds.includes(stat) || delta === null) {
      issues.push("dropped secondary effect");
      continue;
    }
    const sameOwner = secondaryEffects.filter((s) => s.actionId === (action?.id ?? null)).length;
    if (sameOwner >= 2) continue;
    const range = effectEnvelope("success", action?.roll.magnitude ?? 1, config, "secondary");
    secondaryEffects.push({ actionId: action?.id ?? null, stat, delta: clampN(delta, range) });
  }

  const chaosEffects: ValidatedOutput["chaosEffects"] = [];
  for (const e of asArray(input.chaosEffects)) {
    const actionId = str(e.actionId);
    const action = actionId ? actions.get(actionId) : undefined;
    const delta = num(e.delta);
    if ((actionId && !action) || delta === null) continue;
    if (chaosEffects.some((c) => c.actionId === (action?.id ?? null))) continue;
    chaosEffects.push({ actionId: action?.id ?? null, delta: clampN(delta, [-config.chaos.directorMax, config.chaos.directorMax]) });
  }

  // Personnel: changes need something that happened this stage to justify them.
  const personnelEffects: ValidatedOutput["personnelEffects"] = [];
  const IMPROVED: readonly PersonnelStatus[] = ["safe", "active", "evacuated"];
  for (const e of asArray(input.personnelEffects)) {
    const npc = incident.personnel.find((p) => p.id === str(e.npcId));
    const status = str(e.status) as PersonnelStatus;
    if (!npc || !PERSONNEL_STATUSES.includes(status) || npc.status === "dead" || npc.controlledBy || npc.status === status) continue;
    if (personnelEffects.length >= config.personnel.maxChangesPerStage || personnelEffects.some((p) => p.npcId === npc.id)) continue;
    const improving = IMPROVED.includes(status);
    const allowed = (improving ? anyProgress : troubleBasis) && (status !== "dead" || (config.personnel.allowDeath && anyCatastrophe));
    if (!allowed) {
      issues.push(`refused personnel change ${npc.id} -> ${status}`);
      continue;
    }
    personnelEffects.push({ npcId: npc.id, status });
  }

  const systemEffects: ValidatedOutput["systemEffects"] = [];
  for (const e of asArray(input.facilityEffects ?? input.systemEffects)) {
    const system = str(e.system) as SystemId;
    const condition = str(e.condition) as Condition;
    if (!SYSTEM_IDS.includes(system) || !["nominal", "degraded", "offline"].includes(condition)) continue;
    if (systemEffects.length >= 2 || systemEffects.some((s) => s.system === system) || incident.systems[system] === condition) continue;
    const better = condition === "nominal" || (condition === "degraded" && incident.systems[system] === "offline");
    if (better ? !anySuccess : !(anyFailure || plan.specialEvent)) {
      issues.push(`refused system change ${system} -> ${condition}`);
      continue;
    }
    systemEffects.push({ system, condition });
  }

  // Lives: exactly the agents the engine put at risk. The director only supplies the reason.
  const reasons = new Map(asArray(input.lifeEvents).map((l) => [str(l.playerId), l.reason]));
  const atRisk = new Map<string, string | null>();
  for (const a of plan.actions) if (a.roll.lifeAtRisk) atRisk.set(a.playerId, a.id);
  for (const id of plan.hazards) if (!atRisk.has(id)) atRisk.set(id, null);
  for (const id of reasons.keys()) if (id && !atRisk.has(id)) issues.push(`refused life event: ${id}`);
  const nameOf = (id: string) => plan.actions.find((a) => a.playerId === id)?.playerName ?? null;
  const lifeEvents: LifeLoss[] = [...atRisk].map(([playerId, actionId]) => ({
    playerId,
    actionId,
    reason: scrub(reasons.get(playerId), 140) || `${nameOf(playerId) ?? "An agent"} got caught up in it.`,
  }));

  // New game-only facts the director made up.
  const generatedFacts: ValidatedOutput["generatedFacts"] = [];
  for (const r of requests) {
    if (str(r.factId)) continue;
    const label = scrub(r.label, 40);
    const text = scrub(r.text, config.narration.infoMax);
    if (label && text && generatedFacts.length < config.reveals.maxGeneratedPerStage) generatedFacts.push({ label, text });
  }

  const activeSecondary = incident.objectives.filter((o) => o.kind === "secondary" && o.status === "active").length;
  const newObjectives = asArray(input.newObjectives)
    .map((o) => scrub(o.text, config.narration.objectiveMax))
    .filter((t): t is string => !!t)
    .slice(0, Math.max(0, Math.min(config.objectives.maxNewPerStage, config.newProblems.maxActiveSecondary - activeSecondary)));

  const objectiveUpdates: ValidatedOutput["objectiveUpdates"] = [];
  for (const u of asArray(input.objectiveUpdates)) {
    const o = incident.objectives.find((x) => x.id === str(u.objectiveId));
    const status = str(u.status);
    if (!o || o.kind !== "secondary" || o.goal.type !== "narrative" || o.status !== "active") continue;
    if (status === "completed" ? !anySuccess : status === "failed" || status === "impossible" ? !troubleBasis : true) continue;
    if (objectiveUpdates.some((x) => x.objectiveId === o.id)) continue;
    objectiveUpdates.push({ objectiveId: o.id, status: status as "completed" | "failed" | "impossible" });
  }

  const eventText = plan.specialEvent ? scrub(asArray(input.specialEvents)[0]?.text, 300) : null;

  let threatLocation: string | null | undefined;
  if ("threatLocation" in input) {
    const t = input.threatLocation;
    if (t === null || (typeof t === "string" && incident.locations.some((l) => l.id === t))) threatLocation = t as string | null;
  }

  const narration =
    scrub(input.narration, config.narration.maxLength) || interpretations.map((i) => i.summary).join(" ").slice(0, config.narration.maxLength);
  if (!scrub(input.narration, config.narration.maxLength)) issues.push("default narration");

  return {
    interpretations,
    primaryEffects,
    secondaryEffects,
    chaosEffects,
    personnelEffects,
    systemEffects,
    lifeEvents,
    reveals,
    generatedFacts,
    newObjectives,
    objectiveUpdates,
    specialEventText: eventText,
    ...(threatLocation !== undefined ? { threatLocation } : {}),
    narration,
    issues,
  };
}

// ------------------------------------------------------------------ the mock director

/** Small deterministic PRNG (mulberry32). */
function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const DOING: Record<ResponseTag, string[]> = {
  CONTAIN: ["went to lock {entity} down{at}", "tried to get {entity} back behind a door{at}", "set up a containment line{at}"],
  EVACUATE: ["started moving people out{from}", "ran an evacuation{from}", "herded staff toward the exits{from}"],
  INVESTIGATE: ["dug into what {entity} actually is", "pulled the file and started reading", "went looking for clues{at}"],
  COMMUNICATE: ["got on the radio{with}", "tried to talk everyone down{with}", "coordinated over the intercom{with}"],
  DEPLOY: ["sent a response team in{at}", "went in personally{at}", "deployed everything that could walk{at}"],
  EQUIPMENT: ["went for the equipment{sys}", "improvised something out of whatever was lying around{sys}", "started pulling panels open{sys}"],
  STRATEGIZE: ["drew up a plan", "made a whiteboard. A big one", "called a very short meeting"],
  OTHER: ["tried something no procedure covers", "did something the Records Division will ask about", "went completely off-script"],
};

const RESULT: Record<Outcome, string[]> = {
  critical: ["It worked better than anyone expected.", "Textbook. Somebody frame it.", "It worked. Beautifully. Suspiciously."],
  success: ["It worked.", "It held.", "Against the odds: fine."],
  partial: ["It half worked.", "Some of it worked.", "It worked, in a sense."],
  failure: ["It did not work.", "That went badly.", "No."],
  catastrophe: ["It made everything worse.", "It went catastrophically wrong.", "The paperwork for this will be enormous."],
};

const OPENERS: Record<"calm" | "tense" | "unhinged", string[]> = {
  calm: ["Status report from the {location}.", "Here's what happened.", "The response is under way."],
  tense: ["Things are moving fast.", "The situation is deteriorating.", "Nobody is having a good time."],
  unhinged: ["The situation has left the building.", "At this point the incident has a mind of its own.", "Somewhere, a clipboard has been thrown."],
};

const RECKLESS = ["Nobody asked {name} to do that.", "The narrator would like it on record that this was {name}'s idea.", "Bold of {name}. Very bold."];
const SACRIFICE = ["{name} put themselves between everyone else and the problem.", "{name} volunteered for the dangerous part."];
const TWIST = ["There was a side effect.", "Something else happened too.", "Nobody saw the side effect coming."];
const HURT = ["{name} got too close.", "{name} was in the wrong place at the worst time.", "{name} took the hit.", "{name} slipped on the corn."];
const HURT_SACRIFICE = ["{name} took the hit so nobody else had to."];
const TERMINATE = /\b(kill|terminate|destroy|eliminate|incinerate|shoot|obliterate|execute|nuke)\w*/i;

export class MockIncidentDirector implements IncidentDirector {
  readonly id = "mock";

  async resolveStage(context: DirectorContext): Promise<unknown> {
    return this.resolveSync(context);
  }

  /** Deterministic for a given context. Also the fallback when another director fails or is late. */
  resolveSync(ctx: DirectorContext): Record<string, unknown> {
    const random = seeded(hash(`${ctx.incident.code}:${ctx.stage}:${ctx.actions.map((a) => `${a.actionId}${a.outcome}${a.text}`).join("|")}`));
    const choose = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
    // Lines already used this stage, so three successes don't all read "It worked."
    const used = new Set<string>();
    const fresh = (items: readonly string[]) => {
      const pick = choose(items.filter((i) => !used.has(i)).length ? items.filter((i) => !used.has(i)) : items);
      used.add(pick);
      return pick;
    };
    const inc = ctx.incident;
    const entity = inc.entity.identityKnown ? inc.entity.title : "the unknown entity";
    const locName = (id: string | null) => inc.locations.find((l) => l.id === id)?.name ?? "the facility";
    const npcById = (id: string) => inc.personnel.find((p) => p.id === id);
    const refOf = (a: DirectorContext["actions"][number], kind: string) => a.references.find((r) => r.startsWith(`${kind}:`))?.slice(kind.length + 1);

    const interpretations: Record<string, unknown>[] = [];
    const secondaryEffects: Record<string, unknown>[] = [];
    const chaosEffects: Record<string, unknown>[] = [];
    const personnelEffects: Record<string, unknown>[] = [];
    const facilityEffects: Record<string, unknown>[] = [];
    const newInformation: Record<string, unknown>[] = [];
    const touched = new Set<string>();
    let threatLocation: string | null | undefined;

    for (const a of ctx.actions) {
      const loc = refOf(a, "loc");
      const npcId = refOf(a, "npc");
      const sys = refOf(a, "sys") as SystemId | undefined;
      const npc = npcId ? npcById(npcId) : undefined;
      const doing = fill(fresh(DOING[a.tag]), {
        entity,
        at: loc ? ` in the ${locName(loc)}` : "",
        from: loc ? ` from the ${locName(loc)}` : npc ? `, starting with ${npc.name}` : "",
        with: npc ? ` with ${npc.name}` : "",
        sys: sys ? ` for the ${SYSTEMS[sys].name.toLowerCase()}` : "",
      });
      const good = a.outcome === "critical" || a.outcome === "success";
      const progress = good || a.outcome === "partial";
      // A template can't judge ideas, so it guesses: unusual actions aimed at something specific in
      // this incident are sometimes inventive, and sometimes wild when they go spectacularly.
      // Recklessness alone never counts.
      const unusual = a.tag === "OTHER" || a.actionCount > 1;
      const aimed = a.references.length > 0;
      const wild = unusual && (a.outcome === "critical" || a.outcome === "catastrophe") && random() < 0.5;
      const inventive = (aimed && random() < 0.35) || (unusual && random() < 0.25);
      interpretations.push({
        actionId: a.actionId,
        summary: `${a.playerName} (${a.role}) ${doing}. ${fresh(RESULT[a.outcome])}`,
        usesRole: a.usesRoleTags.includes(a.tag),
        novelty: wild ? "wild" : inventive ? "inventive" : "standard",
        intent: TERMINATE.test(a.text) ? "terminate" : null,
      });

      if (a.twist) {
        const stat = choose(["containment", "facility", "personnel", "resources", "information", "time"] as StatId[]);
        secondaryEffects.push({ actionId: a.actionId, stat, delta: (random() < 0.5 ? -1 : 1) * (3 + Math.floor(random() * 6)) });
      }
      if (wild) chaosEffects.push({ actionId: a.actionId, delta: 3 });

      // People: rescues when it went somewhere, injuries when it didn't.
      const inTrouble = inc.personnel.filter((p) => ["trapped", "missing", "injured", "critical"].includes(p.status) && !p.controlledBy && !touched.has(p.id));
      const target = (npc && inTrouble.includes(npc) ? npc : undefined) ?? inTrouble[0];
      if (["EVACUATE", "DEPLOY", "COMMUNICATE"].includes(a.tag) && target) {
        if (progress) personnelEffects.push({ npcId: target.id, status: a.tag === "EVACUATE" ? "evacuated" : "safe" });
        else if (a.tag !== "COMMUNICATE") personnelEffects.push({ npcId: target.id, status: target.status === "injured" ? "critical" : "injured" });
        touched.add(target.id);
      }
      if (a.outcome === "catastrophe") {
        const nearby = inc.personnel.filter((p) => p.status !== "dead" && !p.controlledBy && !touched.has(p.id) && p.location === (inc.threatLocation ?? inc.location.id));
        const victim = nearby[0];
        if (victim) {
          const next = victim.status === "critical" ? (random() < 0.5 ? "dead" : "critical") : victim.status === "injured" ? "critical" : "injured";
          if (next !== victim.status) personnelEffects.push({ npcId: victim.id, status: next });
          touched.add(victim.id);
        }
      }

      // Systems: fixes when it worked, breakage when it went very wrong.
      const repairs = TAG_REPAIRS[a.tag] ?? [];
      if (good) {
        const fix = (sys && inc.systems[sys] !== "nominal" ? sys : undefined) ?? repairs.find((s) => inc.systems[s] !== "nominal");
        if (fix) facilityEffects.push({ system: fix, condition: "nominal" });
      } else if (a.outcome === "catastrophe") {
        const nominal = SYSTEM_IDS.filter((s) => inc.systems[s] === "nominal");
        if (nominal.length) facilityEffects.push({ system: choose(nominal), condition: "degraded" });
      }

      // Information: investigations find out about the entity, conversations about people.
      if (progress) {
        const hidden = inc.facts.filter((f) => f.visibility !== "known" && (f.about !== "identity" || ctx.limits.identityRevealAllowed));
        const entityFacts = hidden.filter((f) => f.about === "identity" || f.about === "entity" || f.about === "record");
        const knowledge = hidden.filter((f) => f.heldBy && (!npc || f.heldBy === npc.id));
        const want =
          a.tag === "INVESTIGATE"
            ? entityFacts[0]
            : a.tag === "COMMUNICATE"
              ? (knowledge[0] ?? entityFacts[0])
              : a.outcome === "critical"
                ? hidden[0]
                : undefined;
        if (want) newInformation.push({ factId: want.id });
      }

      if ((a.tag === "CONTAIN" || a.tag === "DEPLOY") && a.outcome === "catastrophe") {
        const others = inc.locations.filter((l) => l.id !== inc.threatLocation);
        threatLocation = choose(others).id;
      }
    }

    // Narration: tone, the most dramatic moments, then everything else that happened.
    const lines: string[] = [fill(choose(OPENERS[ctx.tone]), { location: inc.location.name })];
    const ranked = [...ctx.actions].sort((x, y) => drama(y.outcome) - drama(x.outcome));
    for (const a of ranked.slice(0, 2)) {
      const i = interpretations.find((x) => x.actionId === a.actionId)!;
      lines.push(String(i.summary));
      if (a.approach === "reckless" && random() < 0.7) lines.push(fill(choose(RECKLESS), { name: a.playerName }));
      else if (a.sacrifice) lines.push(fill(choose(SACRIFICE), { name: a.playerName }));
      if (a.twist) lines.push(choose(TWIST));
    }
    const nameOf = (id: string) => ctx.actions.find((a) => a.actionId === id)?.playerName ?? "someone";
    for (const i of ctx.interactions.filter((x) => x.kind !== "synergy").slice(0, 2)) {
      lines.push(
        i.kind === "sabotage"
          ? `${nameOf(i.a)} and ${nameOf(i.b)} worked against each other, and ${nameOf(i.affected ?? i.a)} came off worse.`
          : `${nameOf(i.a)} and ${nameOf(i.b)} got in each other's way, which somehow helped ${nameOf(i.affected ?? i.a)}.`,
      );
    }
    const synergy = ctx.interactions.find((x) => x.kind === "synergy");
    if (synergy) lines.push(`${nameOf(synergy.a)} and ${nameOf(synergy.b)} ended up working together.`);
    if (ctx.actions.length === 0) lines.push("Nobody did anything. The incident did not wait for them.");
    if (ctx.specialEvent) lines.push(ctx.specialEvent.text);
    if (ctx.newProblem) lines.push(`New problem: ${ctx.newProblem}`);

    const hurt = new Map<string, { playerName: string; sacrifice: boolean }>();
    for (const a of ctx.actions) if (a.lifeAtRisk) hurt.set(a.playerId, a);
    for (const h of ctx.hazards) if (!hurt.has(h.playerId)) hurt.set(h.playerId, { playerName: h.playerName, sacrifice: false });
    const lifeEvents = [...hurt].map(([playerId, x]) => ({ playerId, reason: fill(choose(x.sacrifice ? HURT_SACRIFICE : HURT), { name: x.playerName }) }));
    for (const l of lifeEvents) lines.push(l.reason);

    let narration = "";
    for (const line of lines) {
      if (narration.length + line.length + 1 > ctx.limits.narrationMax) break;
      narration += (narration ? " " : "") + line;
    }

    // Director-made objectives resolve when things go well.
    const objectiveUpdates: Record<string, unknown>[] = [];
    const open = ctx.incident.objectives.find((o) => o.goal.type === "narrative" && o.status === "active");
    if (open && ctx.actions.some((a) => a.outcome === "critical" || a.outcome === "success") && random() < 0.4) {
      objectiveUpdates.push({ objectiveId: open.id, status: "completed" });
    }

    return {
      actionInterpretations: interpretations,
      secondaryEffects,
      chaosEffects,
      personnelEffects,
      facilityEffects,
      lifeEvents,
      newInformation,
      objectiveUpdates,
      specialEvents: ctx.specialEvent ? [{ text: ctx.specialEvent.text }] : [],
      ...(threatLocation !== undefined ? { threatLocation } : {}),
      narration,
    };
  }
}

function drama(o: Outcome): number {
  return { catastrophe: 4, critical: 3, failure: 2, success: 1, partial: 0 }[o];
}
