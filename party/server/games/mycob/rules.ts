// The engine's mechanics. The Incident Director decides what things mean and how they read; this
// file decides what is mechanically possible and what actually happens to the numbers:
//
//   planStage()      read each response, roll its outcome, find interactions, hazards, events
//   effectEnvelope() the range a director may move a stat for an action with a given outcome
//   applyStage()     apply a *validated* director result to the incident, within stage caps
//   scoreStage()     turn what happened (and the vote) into points, with caps
//   checkEnding()    whether the incident is over, and how
//
// Randomness always comes from the room's random(), so a seeded test replays exactly.

import type { RoleDef } from "./config.ts";
import {
  TEAM_STATS,
  type Approach,
  type EndingId,
  type MyCobConfig,
  type Novelty,
  type Outcome,
  type ResponseTag,
  type StatId,
  type Stats,
} from "./config.ts";
import {
  NEW_PROBLEMS,
  SPECIAL_EVENTS,
  SYSTEM_IDS,
  SYSTEMS,
  type Condition,
  type NewProblemDef,
  type SpecialEventDef,
  type SystemId,
} from "./content.ts";
import type { ValidatedOutput } from "./director.ts";
import {
  clamp,
  evaluateObjectives,
  fill,
  makeSecondary,
  nextId,
  pick,
  revealFact,
  weighted,
  type Fact,
  type Incident,
  type Objective,
  type PersonnelStatus,
  type Random,
} from "./incident.ts";

// ------------------------------------------------------------------ response analysis

/** Clause boundaries: sentence ends, semicolons, "then", "also", "after that", commas. */
const CLAUSES = /[.;!?\n]+|,|\b(?:and then|then|also|after that|meanwhile)\b/i;

export interface ResponseAnalysis {
  /** Estimated separate actions crammed into the response (1..maxActions). */
  actionCount: number;
  /** Distinct parts of this incident the response refers to, e.g. "npc:p-3", "loc:cafeteria". */
  references: string[];
}

const mentions = (text: string, phrase: string) => {
  const p = phrase.trim().toLowerCase();
  return p.length >= 3 && new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text);
};

/**
 * Reads a response for mechanics that don't need a language model: how overloaded it is, and
 * which people, places and systems of *this* incident it names. Neither is ever scored directly.
 * Overload makes actions less reliable; references make them slightly more reliable (capped) and
 * tell the director what the action is aimed at.
 */
export function analyzeResponse(text: string, incident: Incident, config: MyCobConfig): ResponseAnalysis {
  const clauses = text.split(CLAUSES).filter((c) => (c ?? "").trim().split(/\s+/).filter(Boolean).length >= 2);
  const actionCount = clamp(clauses.length, 1, config.analysis.maxActions);
  const lower = text.toLowerCase();
  const references = new Set<string>();

  if (incident.entity.identityKnown && mentions(lower, incident.entity.title)) references.add("entity");
  for (const npc of incident.personnel) {
    const parts = npc.name.split(/\s+/).slice(npc.source === "generated" ? 1 : 0);
    if (parts.some((part) => part.length >= 3 && mentions(lower, part))) references.add(`npc:${npc.id}`);
  }
  for (const location of incident.locations) {
    if ([location.name, ...location.keywords].some((k) => mentions(lower, k))) references.add(`loc:${location.id}`);
  }
  for (const id of SYSTEM_IDS) {
    if (SYSTEMS[id].keywords.some((k) => mentions(lower, k))) references.add(`sys:${id}`);
  }
  return { actionCount, references: [...references] };
}

// ------------------------------------------------------------------ planning a stage

export interface ActionInput {
  playerId: string;
  playerName: string;
  role: RoleDef;
  tag: ResponseTag;
  approach: Approach;
  sacrifice: boolean;
  text: string;
  /** This player's tags in earlier stages, oldest first. */
  previousTags: ResponseTag[];
}

export interface ActionRoll {
  /** Success chance after every modifier. Engine-only: never shown to anyone. */
  chance: number;
  roll: number;
  outcome: Outcome;
  /** An unexpected side effect is due. */
  twist: boolean;
  lifeAtRisk: boolean;
  /** Scales how big this action's effects may be (approach x severity). */
  magnitude: number;
  /** Pre-rolled: if the director reads this action as an attempt to terminate, would it work? */
  terminationPossible: boolean;
}

export interface ActionPlan extends Omit<ActionInput, "role" | "previousTags"> {
  id: string;
  roleId: string;
  roleName: string;
  strongTags: ResponseTag[];
  analysis: ResponseAnalysis;
  /** Consecutive earlier stages this player used the same tag. */
  repeated: number;
  roll: ActionRoll;
}

export interface Interaction {
  a: string;
  b: string;
  kind: "synergy" | "sabotage" | "help";
  /** The action whose outcome shifted, for sabotage/help. */
  affected: string | null;
}

export interface NewProblemDraft {
  def: NewProblemDef;
  text: string;
  hint: { npcId?: string; system?: SystemId; location?: string };
}

export interface StagePlan {
  stage: number;
  totalStages: number;
  actions: ActionPlan[];
  interactions: Interaction[];
  /** Agents caught up in the incident whatever they did (or didn't) do. */
  hazards: string[];
  /** Agents who submitted nothing this stage. */
  idle: string[];
  specialEvent: SpecialEventDef | null;
  newProblem: NewProblemDraft | null;
}

const TIERS: readonly Outcome[] = ["catastrophe", "failure", "partial", "success", "critical"];
export const SUCCESSES: readonly Outcome[] = ["critical", "success"];
export const FAILURES: readonly Outcome[] = ["failure", "catastrophe"];
const shiftTier = (o: Outcome, by: number) => TIERS[clamp(TIERS.indexOf(o) + by, 0, TIERS.length - 1)]!;

export function roleOf(config: MyCobConfig, roleId: string): RoleDef {
  return config.roles.find((r) => r.id === roleId) ?? config.roles[0]!;
}

export function successChance(input: ActionInput, analysis: ResponseAnalysis, repeated: number, incident: Incident, config: MyCobConfig, bonus: number): number {
  const r = config.randomness;
  let chance = r.baseSuccess + bonus;
  if (input.role.strongTags.includes(input.tag)) chance += config.roleInfluence.strongBonus;
  if (input.role.weakTags.includes(input.tag)) chance -= config.roleInfluence.weakPenalty;
  chance -= incident.difficulty * config.entityInfluence.perDifficulty;
  chance += (incident.stats[config.tagDependsOn[input.tag]] - 50) * config.stateInfluence.perPoint;
  chance += config.approach[input.approach].success;
  if (input.sacrifice) chance += config.sacrifice.successBonus;
  chance -= (analysis.actionCount - 1) * config.analysis.overloadPenalty;
  chance += Math.min(config.analysis.groundingMax, analysis.references.length) * config.analysis.groundingBonus;
  chance -= repeated * config.analysis.repeatPenalty;
  for (const anomaly of incident.anomalies) if (!anomaly.tag || anomaly.tag === input.tag) chance += anomaly.success;
  return clamp(chance, r.minSuccess, r.maxSuccess);
}

function rollOutcome(chance: number, input: ActionInput, incident: Incident, config: MyCobConfig, random: Random): { roll: number; outcome: Outcome } {
  const r = config.randomness;
  const chaos = incident.stats.chaos / 100;
  // Chaos (and the Intern) stretch the roll towards both ends: more brilliance, more disaster.
  const variance = config.chaos.varianceAtMax * chaos + (input.role.wildcard ? config.roleInfluence.wildcardSpread : 0);
  const roll = clamp(0.5 + (random() - 0.5) * (1 + variance), 0, 0.9999);
  const catastrophe = clamp(r.catastropheBase + r.catastrophePerChaos * chaos + config.approach[input.approach].catastrophe, 0.01, 0.4);
  if (roll < chance * r.critShare) return { roll, outcome: "critical" };
  if (roll < chance) return { roll, outcome: "success" };
  if (roll >= 1 - catastrophe) return { roll, outcome: "catastrophe" };
  if (roll < chance + r.partialBand) return { roll, outcome: "partial" };
  return { roll, outcome: "failure" };
}

export function terminationChance(incident: Incident, outcome: Outcome, config: MyCobConfig): number {
  const t = config.endings.termination;
  return clamp(
    t.baseChance +
      (t.byContainment[incident.entity.containment] ?? 0) +
      (t.byClassification[incident.entity.classification] ?? 0) +
      (outcome === "critical" ? 0.15 : 0),
    0,
    0.95,
  );
}

export function planStage(
  inputs: ActionInput[],
  crew: string[],
  incident: Incident,
  stage: number,
  totalStages: number,
  config: MyCobConfig,
  random: Random,
): StagePlan {
  const tagCounts = new Map<ResponseTag, number>();
  for (const i of inputs) tagCounts.set(i.tag, (tagCounts.get(i.tag) ?? 0) + 1);

  const actions: ActionPlan[] = inputs.map((input, index) => {
    const analysis = analyzeResponse(input.text, incident, config);
    let repeated = 0;
    for (let i = input.previousTags.length - 1; i >= 0 && input.previousTags[i] === input.tag; i--) repeated++;
    // Coordinated: more than one agent doing the same kind of thing.
    const synergy = (tagCounts.get(input.tag) ?? 0) > 1 ? config.interactions.synergyBonus : 0;
    const chance = successChance(input, analysis, repeated, incident, config, synergy);
    const { roll, outcome } = rollOutcome(chance, input, incident, config, random);
    const twist = random() < config.randomness.twistBase + config.randomness.twistPerChaos * (incident.stats.chaos / 100);
    return {
      id: `a${stage}-${index + 1}`,
      playerId: input.playerId,
      playerName: input.playerName,
      roleId: input.role.id,
      roleName: input.role.name,
      strongTags: input.role.strongTags,
      tag: input.tag,
      approach: input.approach,
      sacrifice: input.sacrifice,
      text: input.text,
      analysis,
      repeated,
      roll: {
        chance,
        roll,
        outcome,
        twist,
        lifeAtRisk: false,
        magnitude: config.approach[input.approach].magnitude * config.severity.magnitude,
        terminationPossible: false,
      },
    };
  });

  // Conflicting actions both happen, and pull on each other: one of the pair ends up worse off
  // (sabotage) or, sometimes, accidentally better off (help).
  const interactions: Interaction[] = [];
  const conflicts = config.interactions.conflicts;
  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const a = actions[i]!;
      const b = actions[j]!;
      if (a.tag === b.tag) {
        interactions.push({ a: a.id, b: b.id, kind: "synergy", affected: null });
        continue;
      }
      const clash =
        conflicts.some(([x, y]) => (a.tag === x && b.tag === y) || (a.tag === y && b.tag === x)) ||
        (a.approach === "reckless" && b.approach === "careful") ||
        (a.approach === "careful" && b.approach === "reckless");
      if (!clash || interactions.filter((x) => x.kind !== "synergy").length >= config.interactions.maxPerStage) continue;
      const affected = random() < 0.5 ? a : b;
      const sabotage = random() < config.interactions.sabotageChance;
      affected.roll.outcome = shiftTier(affected.roll.outcome, sabotage ? -1 : 1);
      interactions.push({ a: a.id, b: b.id, kind: sabotage ? "sabotage" : "help", affected: affected.id });
    }
  }

  // Life risk is rolled after interactions, on the outcome that actually stands.
  const lr = config.lifeRisk;
  for (const action of actions) {
    const risk = lr[action.roll.outcome] + config.approach[action.approach].lifeRisk + (action.sacrifice ? config.sacrifice.lifeRisk : 0);
    action.roll.lifeAtRisk = random() < Math.max(0, risk);
    const t = config.endings.termination;
    action.roll.terminationPossible =
      SUCCESSES.includes(action.roll.outcome) &&
      stage >= config.endings.minStage &&
      incident.stats.containment >= t.minContainment &&
      random() < terminationChance(incident, action.roll.outcome, config);
  }

  const acted = new Set(inputs.map((i) => i.playerId));
  const idle = crew.filter((id) => !acted.has(id));
  const hazardBase = lr.hazardBase + lr.hazardPersonnel * ((100 - incident.stats.personnel) / 100) + lr.hazardChaos * (incident.stats.chaos / 100);
  const hazards = crew.filter((id) => random() < hazardBase + (acted.has(id) ? 0 : lr.idleExtra));

  return {
    stage,
    totalStages,
    actions,
    interactions,
    hazards,
    idle,
    specialEvent: rollSpecialEvent(incident, config, random),
    newProblem: rollNewProblem(incident, config, random),
  };
}

export function specialEventChance(chaos: number, config: MyCobConfig): number {
  const s = config.specialEvents;
  return clamp(s.base + s.perChaos * (chaos / 100), 0, s.max);
}

function rollSpecialEvent(incident: Incident, config: MyCobConfig, random: Random): SpecialEventDef | null {
  if (random() >= specialEventChance(incident.stats.chaos, config)) return null;
  const pool = SPECIAL_EVENTS.filter((e) => e.minChaos <= incident.stats.chaos);
  return pool.length ? weighted(pool, (e) => e.weight, random) : null;
}

function rollNewProblem(incident: Incident, config: MyCobConfig, random: Random): NewProblemDraft | null {
  const n = config.newProblems;
  const activeSecondary = incident.objectives.filter((o) => o.kind === "secondary" && o.status === "active").length;
  if (activeSecondary >= n.maxActiveSecondary) return null;
  const low = TEAM_STATS.some((s) => incident.stats[s] < n.lowStatAt);
  if (random() >= n.base + n.perChaos * (incident.stats.chaos / 100) + (low ? n.lowStatBonus : 0)) return null;

  const alive = incident.personnel.filter((p) => !["dead", "trapped", "evacuated"].includes(p.status) && !p.controlledBy);
  const nominal = SYSTEM_IDS.filter((s) => incident.systems[s] === "nominal");
  const holder = incident.personnel.find((p) => p.status !== "dead" && incident.facts.some((f) => f.heldBy === p.id && f.visibility !== "known"));
  const possible = NEW_PROBLEMS.filter(
    (p) =>
      (p.objective !== "rescue" || alive.length > 0) &&
      (p.objective !== "restore" || nominal.length > 0) &&
      (p.objective !== "discover" || holder),
  );
  if (!possible.length) return null;
  const def = weighted(possible, (p) => p.weight, random);
  const location = pick(incident.locations.filter((l) => l.id !== incident.location.id), random);
  const hint: NewProblemDraft["hint"] = { location: location.id };
  let npcName = "";
  if (def.objective === "rescue") {
    const npc = pick(alive, random);
    hint.npcId = npc.id;
    npcName = npc.name;
  }
  if (def.objective === "discover" && holder) {
    hint.npcId = holder.id;
    npcName = holder.name;
  }
  if (def.objective === "restore") hint.system = pick(nominal, random);
  const text = fill(def.text, { npc: npcName, location: location.name, system: hint.system ? SYSTEMS[hint.system].name : "" });
  return { def, text: text.charAt(0).toUpperCase() + text.slice(1), hint };
}

// ------------------------------------------------------------------ effect envelopes

/**
 * The range one action may move one stat, by outcome. Primary effects follow the outcome (a
 * success can't hurt its main target); secondary effects are side effects either way, smaller.
 * Directors pick which stats move and by how much; this decides how much is allowed.
 */
export function effectEnvelope(outcome: Outcome, magnitude: number, config: MyCobConfig, kind: "primary" | "secondary"): [number, number] {
  const max = config.severity.maxStatDeltaPerAction * magnitude;
  if (kind === "secondary") return [-0.5 * max, 0.5 * max];
  switch (outcome) {
    case "critical":
      return [0, max];
    case "success":
      return [0, 0.75 * max];
    case "partial":
      return [-0.25 * max, 0.4 * max];
    case "failure":
      return [-0.6 * max, 0.1 * max];
    case "catastrophe":
      return [-max, 0];
  }
}

/** What an action does to the numbers when the director says nothing usable about it. */
export function defaultEffects(action: ActionPlan, config: MyCobConfig): { stat: StatId; delta: number }[] {
  const multiplier = config.severity.outcomeMultiplier[action.roll.outcome] * action.roll.magnitude;
  const [min, max] = effectEnvelope(action.roll.outcome, action.roll.magnitude, config, "primary");
  return Object.entries(config.tagEffects[action.tag]).map(([stat, base]) => ({
    stat: stat as StatId,
    delta: Math.round(clamp((base ?? 0) * multiplier, min, max)),
  }));
}

// ------------------------------------------------------------------ applying a stage

export interface AppliedAction {
  actionId: string;
  playerId: string;
  /** Net change this action made to each stat (before the stage cap). */
  deltas: Partial<Stats>;
  chaos: number;
  /** Total size of its effect on the team's stats, for chaos-scoring's "actual consequence" rule. */
  consequence: number;
}

export interface LifeLoss {
  playerId: string;
  reason: string;
  actionId: string | null;
}

export interface StageResult {
  stage: number;
  statsBefore: Stats;
  statsAfter: Stats;
  applied: AppliedAction[];
  lifeLosses: LifeLoss[];
  personnelChanges: { npcId: string; name: string; from: PersonnelStatus; to: PersonnelStatus }[];
  systemChanges: { system: SystemId; name: string; from: Condition; to: Condition }[];
  reveals: Fact[];
  objectivesAdded: Objective[];
  objectiveChanges: { id: string; text: string; from: string; to: string }[];
  specialEvent: { name: string; text: string } | null;
  newProblem: string | null;
  terminated: boolean;
  threatMoved: { from: string | null; to: string | null } | null;
}

/**
 * Applies a validated director result. Everything here has already been checked against the
 * plan by validateDirectorOutput(); this only sums, caps and records.
 */
export function applyStage(incident: Incident, plan: StagePlan, output: ValidatedOutput, config: MyCobConfig, random: Random): StageResult {
  const stage = plan.stage;
  const statsBefore = { ...incident.stats };
  const totals: Partial<Stats> = {};
  const add = (stat: StatId, delta: number) => (totals[stat] = (totals[stat] ?? 0) + delta);

  const applied: AppliedAction[] = plan.actions.map((action) => {
    const deltas: Partial<Stats> = {};
    for (const e of [...output.primaryEffects, ...output.secondaryEffects].filter((e) => e.actionId === action.id)) {
      deltas[e.stat] = (deltas[e.stat] ?? 0) + e.delta;
    }
    const conflicted = plan.interactions.some((i) => i.kind !== "synergy" && (i.a === action.id || i.b === action.id));
    const chaos =
      config.chaos.outcome[action.roll.outcome] +
      config.approach[action.approach].chaos +
      (action.roll.twist ? config.chaos.twist : 0) +
      (conflicted ? config.chaos.conflict : 0) +
      output.chaosEffects.filter((c) => c.actionId === action.id).reduce((n, c) => n + c.delta, 0);
    for (const [stat, delta] of Object.entries(deltas)) add(stat as StatId, delta);
    add("chaos", chaos);
    const consequence = TEAM_STATS.reduce((n, s) => n + Math.abs(deltas[s] ?? 0), 0);
    return { actionId: action.id, playerId: action.playerId, deltas, chaos, consequence };
  });

  // Stage-level effects: director side effects not tied to one action, the special event, the new problem.
  for (const e of output.secondaryEffects.filter((e) => e.actionId === null)) add(e.stat, e.delta);
  for (const c of output.chaosEffects.filter((c) => c.actionId === null)) add("chaos", c.delta);
  add("chaos", config.chaos.stageDrift);

  let specialEvent: StageResult["specialEvent"] = null;
  const systemChanges: StageResult["systemChanges"] = [];
  const setSystem = (system: SystemId, to: Condition) => {
    const from = incident.systems[system];
    if (from === to) return;
    // A system's own drag on the stats follows its condition.
    const drag = (c: Condition) => (c === "nominal" ? {} : SYSTEMS[system].effects[c]);
    for (const [stat, value] of Object.entries(drag(from))) add(stat as StatId, -(value ?? 0));
    for (const [stat, value] of Object.entries(drag(to))) add(stat as StatId, value ?? 0);
    incident.systems[system] = to;
    systemChanges.push({ system, name: SYSTEMS[system].name, from, to });
  };

  if (plan.specialEvent) {
    const e = plan.specialEvent;
    specialEvent = { name: e.name, text: output.specialEventText ?? e.text };
    for (const [stat, value] of Object.entries(e.stats)) add(stat as StatId, value ?? 0);
    add("chaos", config.chaos.specialEvent);
    for (const [system, condition] of Object.entries(e.systems ?? {})) setSystem(system as SystemId, condition);
    if (e.anomaly && incident.anomalies.length < config.anomalies.maxActive) {
      incident.anomalies.push({ ...e.anomaly, id: nextId(incident, "an-"), untilStage: stage + e.anomaly.stages });
    }
  }

  for (const change of output.systemEffects) setSystem(change.system, change.condition);

  // Personnel, before the new problem: a staff member rescued this stage can then be trapped again
  // elsewhere, instead of the rescue quietly undoing the new problem (and completing its objective).
  const personnelChanges: StageResult["personnelChanges"] = [];
  for (const change of output.personnelEffects) {
    const npc = incident.personnel.find((p) => p.id === change.npcId)!;
    personnelChanges.push({ npcId: npc.id, name: npc.name, from: npc.status, to: change.status });
    npc.status = change.status;
  }

  const objectivesAdded: Objective[] = [];
  let newProblem: string | null = null;
  if (plan.newProblem) {
    const { def, hint, text } = plan.newProblem;
    newProblem = text;
    for (const [stat, value] of Object.entries(def.stats)) add(stat as StatId, value ?? 0);
    add("chaos", config.chaos.newProblem);
    if (def.objective === "rescue" && hint.npcId) {
      const npc = incident.personnel.find((p) => p.id === hint.npcId);
      if (npc && npc.status !== "dead") {
        npc.status = "trapped";
        npc.location = hint.location ?? npc.location;
      }
    }
    if (def.objective === "restore" && hint.system) setSystem(hint.system, random() < 0.5 ? "offline" : "degraded");
    // "It's heading for X": that's where tracking now puts it.
    if (def.objective === "prevent_spread" && hint.location) incident.threatLocation = hint.location;
    const objective = makeSecondary(incident, def.objective, stage, random, hint);
    if (objective) objectivesAdded.push(objective);
  }
  if (plan.specialEvent?.objective) {
    objectivesAdded.push(narrativeObjective(incident, plan.specialEvent.objective, stage, "generated"));
  }
  for (const text of output.newObjectives) objectivesAdded.push(narrativeObjective(incident, text, stage, "director"));
  incident.objectives.push(...objectivesAdded);

  // Termination: the director read an action as a kill attempt and the engine's pre-roll allows it.
  const terminated = output.interpretations.some((i) => i.intent === "terminate" && plan.actions.find((a) => a.id === i.actionId)?.roll.terminationPossible);
  if (terminated) incident.entity.status = "terminated";

  let threatMoved: StageResult["threatMoved"] = null;
  if (output.threatLocation !== undefined && output.threatLocation !== incident.threatLocation) {
    threatMoved = { from: incident.threatLocation, to: output.threatLocation };
    incident.threatLocation = output.threatLocation;
  }

  // Apply the stage's totals, capped so no single stage decides the whole incident.
  const cap = config.severity.maxStatDeltaPerStage;
  for (const [stat, delta] of Object.entries(totals)) {
    incident.stats[stat as StatId] += clamp(delta ?? 0, -cap, cap);
  }
  incident.stats.time -= config.stats.timeBudget / Math.max(1, plan.totalStages);
  for (const stat of Object.keys(incident.stats) as StatId[]) incident.stats[stat] = Math.round(clamp(incident.stats[stat], 0, 100));

  // Reveals come after the stat changes: information gained this stage counts.
  const reveals: Fact[] = [];
  for (const factId of output.reveals) reveals.push(...revealFact(incident, factId, stage));
  for (const info of output.generatedFacts) {
    const fact: Fact = {
      id: nextId(incident, "f-gen-"),
      label: info.label,
      text: info.text,
      source: "generated",
      ref: null,
      about: "incident",
      visibility: "known",
      redacted: false,
      revealedStage: stage,
      heldBy: null,
    };
    incident.facts.push(fact);
    reveals.push(fact);
  }
  // Every discovery sharpens the picture, and enough information identifies the entity regardless.
  if (reveals.length) {
    incident.stats.information = Math.round(clamp(incident.stats.information + reveals.length * config.reveals.informationPerReveal, 0, 100));
  }
  if (!incident.entity.identityKnown && incident.stats.information >= config.unknownEntity.autoIdentifyAt) {
    reveals.push(...revealFact(incident, "f-identity", stage));
  }

  // Objectives: director updates to its own narrative objectives, then the engine's checks.
  const objectiveChanges: StageResult["objectiveChanges"] = [];
  for (const update of output.objectiveUpdates) {
    const o = incident.objectives.find((x) => x.id === update.objectiveId)!;
    objectiveChanges.push({ id: o.id, text: o.text, from: o.status, to: update.status });
    o.status = update.status;
    o.resolvedStage = stage;
  }
  for (const change of evaluateObjectives(incident, stage, false)) {
    objectiveChanges.push({ id: change.objective.id, text: change.objective.text, from: change.from, to: change.objective.status });
  }
  const completed = objectiveChanges.filter((c) => c.to === "completed").length;
  if (completed) incident.stats.chaos = clamp(incident.stats.chaos + completed * config.chaos.objectiveCompleted, 0, 100);

  // Anomalies wear off.
  incident.anomalies = incident.anomalies.filter((a) => a.untilStage > stage);

  return {
    stage,
    statsBefore,
    statsAfter: { ...incident.stats },
    applied,
    lifeLosses: output.lifeEvents,
    personnelChanges,
    systemChanges,
    reveals,
    objectivesAdded,
    objectiveChanges,
    specialEvent,
    newProblem,
    terminated,
    threatMoved,
  };
}

function narrativeObjective(incident: Incident, text: string, stage: number, source: Objective["source"]): Objective {
  return {
    id: nextId(incident, "o-"),
    kind: "secondary",
    text,
    goal: { type: "narrative" },
    status: "active",
    createdStage: stage,
    resolvedStage: null,
    source,
  };
}

// ------------------------------------------------------------------ endings

export function checkEnding(incident: Incident, stage: number, totalStages: number, everyoneDown: boolean, config: MyCobConfig): EndingId | null {
  const e = config.endings;
  if (incident.entity.status === "terminated") return "terminated";
  if (everyoneDown || incident.stats.personnel <= e.everyoneDies.personnelAtOrBelow) {
    return "everyone_dies";
  }
  if (stage >= e.minStage && incident.stats.containment >= e.containedAt) {
    incident.entity.status = "contained";
    return "contained";
  }
  if (stage >= totalStages || incident.stats.time <= 0) return "escaped";
  return null;
}

// ------------------------------------------------------------------ scoring

export interface ScoreLine {
  participation: number;
  impact: number;
  chaos: number;
  creativity: number;
  role: number;
  votes: number;
  sacrifice: number;
  bonus: number;
  total: number;
}

export const emptyScore = (): ScoreLine => ({ participation: 0, impact: 0, chaos: 0, creativity: 0, role: 0, votes: 0, sacrifice: 0, bonus: 0, total: 0 });

export interface ScoringMemory {
  /** Creativity points so far this game, per player (for the game cap). */
  creativity: Map<string, number>;
  /** Sacrifice awards so far, per player. */
  sacrifices: Map<string, number>;
}

/**
 * Scores one stage. Nothing here reads the response text or the director's prose: impact is
 * what actually changed, chaos only counts with a real consequence, creativity is the director's
 * bounded classification (capped, and halved for repeating yourself), role credit needs the role
 * actually used, and votes come from the other agents.
 */
export function scoreStage(
  plan: StagePlan,
  result: StageResult,
  output: ValidatedOutput,
  votes: ReadonlyMap<string, number>,
  crew: string[],
  memory: ScoringMemory,
  config: MyCobConfig,
): Map<string, ScoreLine> {
  const s = config.scoring;
  const lines = new Map(crew.map((id) => [id, emptyScore()]));
  const lostLife = new Set(result.lifeLosses.map((l) => l.playerId));

  for (const action of plan.actions) {
    const line = lines.get(action.playerId);
    if (!line) continue;
    const applied = result.applied.find((a) => a.actionId === action.id)!;
    const interpretation = output.interpretations.find((i) => i.actionId === action.id)!;
    line.participation = s.participation;

    let impact = 0;
    for (const stat of TEAM_STATS) {
      const d = applied.deltas[stat] ?? 0;
      impact += d > 0 ? d * s.impact.perPoint : d * s.impact.perPoint * s.impact.negativeWeight;
    }
    if (applied.chaos < 0) impact += -applied.chaos * s.impact.stabilizePerPoint;
    line.impact = Math.round(clamp(impact, 0, s.impact.stageCap));

    const hadConsequence =
      applied.consequence >= s.chaos.requireConsequence ||
      action.roll.twist ||
      plan.interactions.some((i) => i.kind !== "synergy" && (i.a === action.id || i.b === action.id));
    line.chaos = hadConsequence ? Math.round(clamp(applied.chaos * s.chaos.perPoint, 0, s.chaos.stageCap)) : 0;

    const novelty: Novelty = interpretation.novelty;
    const raw = s.creativity.points[novelty] * 0.5 ** action.repeated;
    const room = Math.max(0, s.creativity.gameCap - (memory.creativity.get(action.playerId) ?? 0));
    line.creativity = Math.round(Math.min(raw, s.creativity.stageCap, room));
    memory.creativity.set(action.playerId, (memory.creativity.get(action.playerId) ?? 0) + line.creativity);

    line.role = interpretation.usesRole ? Math.min(s.role.byOutcome[action.roll.outcome], s.role.stageCap) : 0;

    if (action.sacrifice && lostLife.has(action.playerId) && !FAILURES.includes(action.roll.outcome)) {
      const used = memory.sacrifices.get(action.playerId) ?? 0;
      if (used < s.sacrifice.perGame) {
        line.sacrifice = s.sacrifice.points;
        memory.sacrifices.set(action.playerId, used + 1);
      }
    }
    if (s.highChaosBonus.enabled && result.statsAfter.chaos >= s.highChaosBonus.atOrAbove) line.bonus = s.highChaosBonus.points;
  }

  for (const [id, count] of votes) {
    const line = lines.get(id);
    if (line) line.votes = Math.min(count * s.votes.perVote, s.votes.stageCap);
  }
  for (const line of lines.values()) {
    line.total = line.participation + line.impact + line.chaos + line.creativity + line.role + line.votes + line.sacrifice + line.bonus;
  }
  return lines;
}

/** The shared reward everyone gets for how the incident went. */
export function teamScore(ending: EndingId, incident: Incident, config: MyCobConfig): number {
  const t = config.scoring.team;
  const primary = incident.objectives.find((o) => o.kind === "primary");
  const secondaries = incident.objectives.filter((o) => o.kind === "secondary" && o.status === "completed").length;
  return t.ending[ending] + (primary?.status === "completed" ? t.primaryObjective : 0) + secondaries * t.perSecondary;
}

// ------------------------------------------------------------------ misc

export function toneFor(stats: Stats): "calm" | "tense" | "unhinged" {
  if (stats.chaos >= 60) return "unhinged";
  if (stats.containment < 40 || stats.personnel < 40 || stats.time < 25) return "tense";
  return "calm";
}
