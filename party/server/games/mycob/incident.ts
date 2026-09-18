// The incident: what happened, where, to whom, and the hidden state the engine plays it out on.
//
// generateIncident() builds a new one from a random canon entity plus random breach type,
// location, facility state, starting problem, personnel and objectives. Canon records are read,
// never changed: every status, stat and invented staff member here lives only in this game.
//
// Information model. The engine (and the Incident Director) know every Fact. Players know only
// facts whose visibility is "known" — from the start, or revealed during play (revealedStage).
// "discoverable" facts are there to be found. A redacted fact is a canon field that still hides
// something; canon.ts already stripped the hidden text, so revealing it shows the markers only.

import { isRedacted, type CanonRecord } from "../../canon.ts";
import { STAT_IDS, type ModeId, type MyCobConfig, type StatId, type Stats } from "./config.ts";
import {
  BREACHES,
  DEPARTMENTS,
  ENTITY_RULES,
  LOCATIONS,
  NPC_FIRST,
  NPC_KNOWLEDGE,
  NPC_LAST,
  NPC_RELATIONSHIPS,
  PROBLEMS,
  SECONDARY_TEMPLATES,
  SYSTEM_IDS,
  SYSTEMS,
  type AnomalyDef,
  type BreachDef,
  type Condition,
  type EntityRule,
  type LocationDef,
  type StatDeltas,
  type SystemId,
  type SecondaryTemplate,
} from "./content.ts";

export type Random = () => number;

// ------------------------------------------------------------------ model

export const PERSONNEL_STATUSES = ["safe", "active", "missing", "trapped", "injured", "critical", "evacuated", "unavailable", "dead"] as const;
export type PersonnelStatus = (typeof PERSONNEL_STATUSES)[number];
/** Statuses a person is out of danger in. */
export const OK_STATUSES: readonly PersonnelStatus[] = ["safe", "active", "evacuated", "unavailable"];

export interface Npc {
  id: string;
  name: string;
  department: string;
  source: "canon" | "generated";
  /** CPI Database id for canon personnel. Their game status never goes back to canon. */
  ref: string | null;
  url: string | null;
  location: string;
  status: PersonnelStatus;
  /** Public: their part in this incident. */
  relationship: string;
  importance: "low" | "medium" | "high";
  /** A discoverable fact only this person can tell you. */
  knowledgeFactId: string | null;
  /** The agent who took this person over after going down. */
  controlledBy: string | null;
}

export interface Fact {
  id: string;
  label: string;
  text: string;
  source: "canon" | "generated";
  ref: string | null;
  about: "identity" | "entity" | "record" | "personnel" | "incident";
  visibility: "known" | "discoverable";
  redacted: boolean;
  revealedStage: number | null;
  heldBy: string | null;
}

export interface IncidentEntity {
  ref: string;
  title: string;
  url: string;
  classification: string;
  containment: string;
  /** Canon text fields, redactions already stripped by canon.ts. Engine and director only. */
  fields: Readonly<Record<string, string>>;
  identityKnown: boolean;
  initiallyUnknown: boolean;
  revealedStage: number | null;
  status: "loose" | "contained" | "terminated";
}

export type ObjectiveGoal =
  | { type: "contain"; atLeast: number; identify: boolean }
  | { type: "stat"; stat: StatId; atLeast: number; byStage: number | null }
  | { type: "rescue"; npcId: string }
  | { type: "protect"; npcId: string }
  | { type: "system"; system: SystemId }
  | { type: "discover"; factId: string }
  | { type: "survive"; atLeast: number }
  /** Director-made: no mechanical check; resolved by validated director updates. */
  | { type: "narrative" };

export type ObjectiveStatus = "active" | "completed" | "failed" | "impossible";

export interface Objective {
  id: string;
  kind: "primary" | "secondary";
  text: string;
  goal: ObjectiveGoal;
  status: ObjectiveStatus;
  createdStage: number;
  resolvedStage: number | null;
  source: "generated" | "director";
}

export interface Anomaly extends AnomalyDef {
  id: string;
  /** Active through the end of this stage. */
  untilStage: number;
}

export interface Incident {
  code: string;
  mode: ModeId;
  entity: IncidentEntity;
  breach: BreachDef & { text: string };
  location: LocationDef;
  /** Where the entity is believed to be, or null when nobody knows. Field Operatives see this. */
  threatLocation: string | null;
  problem: { id: string; text: string };
  environment: { ruleId: string; text: string }[];
  systems: Record<SystemId, Condition>;
  personnel: Npc[];
  objectives: Objective[];
  facts: Fact[];
  stats: Stats;
  difficulty: number;
  /** Generation notes for analytics ("lucky break", "bad day"). */
  notes: string[];
  rulesApplied: string[];
  anomalies: Anomaly[];
  /** The location pool this incident draws on (built-in now, canon later). */
  locations: readonly LocationDef[];
  /** Every canon record this incident drew on. */
  canonRefs: string[];
  nextId: number;
}

// ------------------------------------------------------------------ small helpers

export const pick = <T>(items: readonly T[], random: Random): T => items[Math.floor(random() * items.length)]!;

export function weighted<T>(items: readonly T[], weightOf: (item: T) => number, random: Random): T {
  const total = items.reduce((n, i) => n + Math.max(0, weightOf(i)), 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= Math.max(0, weightOf(item));
    if (roll < 0) return item;
  }
  return items[items.length - 1]!;
}

/** Symmetric spread in [-n, n], peaked at 0. */
export const spread = (n: number, random: Random) => (random() + random() - 1) * n;

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

export function addStats(stats: Stats, deltas: StatDeltas | undefined, scale = 1): void {
  if (!deltas) return;
  for (const [key, value] of Object.entries(deltas)) {
    if (typeof value === "number") stats[key as StatId] += value * scale;
  }
}

export function nextId(incident: Incident, prefix: string): string {
  incident.nextId += 1;
  return `${prefix}${incident.nextId}`;
}

export const STAT_NAMES: Record<StatId, string> = {
  containment: "Containment",
  facility: "Facility",
  personnel: "Personnel",
  resources: "Resources",
  information: "Information",
  time: "Time",
  chaos: "Chaos",
};

/** Numeric state -> the qualitative status players see. Thresholds live in config. */
export function describeStat(id: StatId, value: number, config: MyCobConfig) {
  const labels = config.stats.labels[id];
  const hit = labels.find((l) => value >= l.min) ?? labels[labels.length - 1]!;
  return { id, name: STAT_NAMES[id], value: hit.label, tone: hit.tone };
}

export function locationName(incident: Incident, id: string | null): string {
  if (!id) return "unknown location";
  return incident.locations.find((l) => l.id === id)?.name ?? "unknown location";
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Removes anything players may not know yet from text the engine didn't write itself (the
 * director's narration): the entity's name and id while it is unidentified, and verbatim copies
 * of undiscovered facts.
 */
export function scrubHidden(text: string, incident: Incident): string {
  let out = text;
  if (!incident.entity.identityKnown) {
    for (const token of [incident.entity.title, incident.entity.ref]) {
      if (token.trim().length >= 3) out = out.replace(new RegExp(escapeRegExp(token.trim()), "gi"), "[UNIDENTIFIED ENTITY]");
    }
  }
  for (const fact of incident.facts) {
    if (fact.visibility !== "known" && fact.text.length >= 10 && out.includes(fact.text)) {
      out = out.split(fact.text).join("[DATA WITHHELD]");
    }
  }
  return out;
}

// ------------------------------------------------------------------ reveals

/** Reveals a fact to players; returns what became known. Revealing the identity also reveals the file header. */
export function revealFact(incident: Incident, factId: string, stage: number): Fact[] {
  const fact = incident.facts.find((f) => f.id === factId);
  if (!fact || fact.visibility === "known") return [];
  const revealed = [fact];
  if (fact.about === "identity") {
    incident.entity.identityKnown = true;
    incident.entity.revealedStage = stage;
    revealed.push(...incident.facts.filter((f) => (f.id === "f-classification" || f.id === "f-containment") && f.visibility !== "known"));
  }
  for (const f of revealed) {
    f.visibility = "known";
    f.revealedStage = stage;
  }
  return revealed;
}

// ------------------------------------------------------------------ objectives

export function evaluateObjectives(incident: Incident, stage: number, final: boolean) {
  const changes: { objective: Objective; from: ObjectiveStatus }[] = [];
  const set = (o: Objective, status: ObjectiveStatus) => {
    if (o.status === status) return;
    changes.push({ objective: o, from: o.status });
    o.status = status;
    o.resolvedStage = stage;
  };
  const npc = (id: string) => incident.personnel.find((p) => p.id === id);

  for (const o of incident.objectives) {
    if (o.status !== "active") continue;
    const g = o.goal;
    switch (g.type) {
      case "contain":
        if (incident.entity.status !== "loose") set(o, "completed");
        else if (incident.stats.containment >= g.atLeast && (!g.identify || incident.entity.identityKnown)) set(o, "completed");
        else if (final) set(o, "failed");
        break;
      case "stat":
        if (incident.stats[g.stat] >= g.atLeast) set(o, "completed");
        else if (final || (g.byStage !== null && stage >= g.byStage)) set(o, "failed");
        break;
      case "rescue": {
        const p = npc(g.npcId);
        if (!p || p.status === "dead") set(o, "impossible");
        else if (p.status === "safe" || p.status === "evacuated") set(o, "completed");
        else if (final) set(o, "failed");
        break;
      }
      case "protect": {
        const p = npc(g.npcId);
        if (!p || p.status === "dead") set(o, "impossible");
        else if (final) set(o, p.status === "critical" ? "failed" : "completed");
        break;
      }
      case "system":
        if (incident.systems[g.system] === "nominal") set(o, "completed");
        else if (final) set(o, "failed");
        break;
      case "discover": {
        const fact = incident.facts.find((f) => f.id === g.factId);
        const holder = fact?.heldBy ? npc(fact.heldBy) : undefined;
        if (fact?.visibility === "known") set(o, "completed");
        else if (holder?.status === "dead") set(o, "impossible");
        else if (final) set(o, "failed");
        break;
      }
      case "survive":
        if (final) set(o, incident.stats.personnel >= g.atLeast ? "completed" : "failed");
        break;
      case "narrative":
        if (final) set(o, "failed");
        break;
    }
  }
  return changes;
}

/** Builds a secondary objective from a template, or null if this incident can't support it now. */
export function makeSecondary(
  incident: Incident,
  template: SecondaryTemplate["id"],
  stage: number,
  random: Random,
  hint: { npcId?: string; system?: SystemId; location?: string } = {},
): Objective | null {
  const tpl = SECONDARY_TEMPLATES.find((t) => t.id === template)!;
  const active = incident.objectives.filter((o) => o.status === "active");
  const taken = (type: string, key: string) => active.some((o) => o.goal.type === type && JSON.stringify(o.goal).includes(`"${key}"`));
  const otherLocation = () => pick(incident.locations.filter((l) => l.id !== incident.location.id), random);
  const make = (text: string, goal: ObjectiveGoal): Objective => ({
    id: nextId(incident, "o-"),
    kind: "secondary",
    text,
    goal,
    status: "active",
    createdStage: stage,
    resolvedStage: null,
    source: "generated",
  });
  const alive = incident.personnel.filter((p) => p.status !== "dead" && !p.controlledBy);

  switch (template) {
    case "rescue": {
      const target =
        (hint.npcId && alive.find((p) => p.id === hint.npcId)) ||
        alive.find((p) => ["trapped", "missing", "injured", "critical"].includes(p.status) && !taken("rescue", p.id));
      if (!target) return null;
      return make(fill(tpl.text, { npc: target.name, location: locationName(incident, target.location) }), { type: "rescue", npcId: target.id });
    }
    case "restore": {
      const system = hint.system ?? SYSTEM_IDS.find((s) => incident.systems[s] !== "nominal" && !taken("system", s));
      if (!system || incident.systems[system] === "nominal") return null;
      return make(fill(tpl.text, { system: SYSTEMS[system].name }), { type: "system", system });
    }
    case "recover": {
      const location = hint.location ? locationName(incident, hint.location) : otherLocation().name;
      const atLeast = clamp(Math.round(incident.stats.resources + 15), 40, 95);
      return make(fill(tpl.text, { location }), { type: "stat", stat: "resources", atLeast, byStage: null });
    }
    case "discover": {
      const fact = incident.facts.find((f) => f.heldBy && f.visibility !== "known" && !taken("discover", f.id));
      const holder = fact && alive.find((p) => p.id === fact.heldBy);
      if (!fact || !holder) return null;
      return make(fill(tpl.text, { npc: holder.name }), { type: "discover", factId: fact.id });
    }
    case "protect": {
      const target = (hint.npcId && alive.find((p) => p.id === hint.npcId)) || shuffle(alive, random).find((p) => !taken("protect", p.id));
      if (!target) return null;
      return make(fill(tpl.text, { npc: target.name }), { type: "protect", npcId: target.id });
    }
    case "prevent_spread": {
      const location = hint.location ? locationName(incident, hint.location) : otherLocation().name;
      const atLeast = clamp(Math.round(incident.stats.containment + 10), 50, 90);
      return make(fill(tpl.text, { location }), { type: "stat", stat: "containment", atLeast, byStage: stage + 2 });
    }
    case "stabilize": {
      if (taken("stat", "facility")) return null;
      const atLeast = clamp(Math.round(incident.stats.facility + 15), 60, 95);
      return make(tpl.text, { type: "stat", stat: "facility", atLeast, byStage: null });
    }
  }
}

// ------------------------------------------------------------------ generation

export interface IncidentSources {
  entities: readonly CanonRecord[];
  personnel?: readonly CanonRecord[];
  incidents?: readonly CanonRecord[];
  /** Real locations, once the CPI Database has them. Built-in facility areas otherwise. */
  locations?: readonly LocationDef[];
}

export interface GenerateOptions {
  mode: ModeId;
  stages: number;
  playerCount: number;
  /** Tests: generate around this entity. */
  entityRef?: string;
}

const upper = (s: string | undefined) => (s ?? "").trim().toUpperCase();

export function classificationOf(record: CanonRecord): string {
  return upper(record.fields.classification) || "UNCLASSIFIED";
}

export function containmentOf(record: CanonRecord): string {
  return upper(record.fields.containment) || "UNKNOWN";
}

export function ruleMatches(rule: EntityRule, record: CanonRecord): boolean {
  const m = rule.match;
  if (m.refs && !m.refs.includes(record.ref)) return false;
  if (m.classifications && !m.classifications.includes(classificationOf(record))) return false;
  if (m.containment && !m.containment.includes(containmentOf(record))) return false;
  if (m.hasField) {
    const value = record.fields[m.hasField];
    if (!value || isRedacted(value)) return false;
  }
  if (m.textIncludes) {
    const haystack = `${record.fields.description ?? ""} ${record.fields.containmentProcedures ?? ""}`.toLowerCase();
    if (!m.textIncludes.some((t) => haystack.includes(t))) return false;
  }
  return true;
}

/** The difficulty an entity brings before anything random: classification + containment + procedures. */
export function entityDifficulty(record: CanonRecord, config: MyCobConfig): number {
  const d = config.difficulty;
  const cls = d.classification[classificationOf(record)] ?? d.classificationDefault;
  const cont = d.containment[containmentOf(record)] ?? d.containmentDefault;
  const sentences = (record.fields.containmentProcedures ?? "").split(/[.!?]+/).filter((s) => s.trim().length > 2).length;
  const procedures = Math.min(d.procedureMax, sentences * d.procedurePerSentence);
  return cls * d.classificationInfluence + (cont + procedures) * d.entityDifficultyInfluence;
}

/** How much each stat is dragged down per point of difficulty (containment the most). */
const DIFFICULTY_PULL: Partial<Record<StatId, number>> = { containment: 1, facility: 0.5, personnel: 0.6, resources: 0.4, information: 0.4 };

export function generateIncident(sources: IncidentSources, config: MyCobConfig, random: Random, options: GenerateOptions): Incident {
  if (sources.entities.length === 0) throw new Error("generateIncident needs at least one entity");
  const record = (options.entityRef && sources.entities.find((e) => e.ref === options.entityRef)) || pick(sources.entities, random);
  const classification = classificationOf(record);
  const containment = containmentOf(record);
  const locations = sources.locations?.length ? sources.locations : LOCATIONS;

  // Entity-specific rules: which match this entity's file, then which fire this time.
  const rules = ENTITY_RULES.filter((r) => ruleMatches(r, record) && random() < r.chance);

  const breachPool: { breach: BreachDef; weight: number }[] = [
    ...BREACHES.map((b) => ({ breach: b, weight: b.weight })),
    ...rules.filter((r) => r.breach).map((r) => ({ breach: r.breach!, weight: config.entityRules.breachWeight })),
  ];
  const breach = weighted(breachPool, (b) => b.weight, random).breach;

  // Unknown entity: 0 and 1 are absolute, anything between is nudged by the breach and the rules.
  const u = config.unknownEntity.chance;
  const unknownChance =
    u <= 0 ? 0 : u >= 1 ? 1 : clamp(u + (breach.unknownBonus ?? 0) + rules.reduce((n, r) => n + (r.unknownBonus ?? 0), 0), 0, 0.95);
  const unknown = random() < unknownChance;

  const preferred = breach.locations ? locations.filter((l) => breach.locations!.includes(l.id)) : [];
  const location = preferred.length && random() < 0.7 ? pick(preferred, random) : pick(locations, random);

  const preferredProblems = breach.problems ? PROBLEMS.filter((p) => breach.problems!.includes(p.id)) : [];
  const problemDef = weighted(preferredProblems.length && random() < 0.75 ? preferredProblems : PROBLEMS, (p) => p.weight, random);

  // Difficulty: the entity sets the tone, everything else and luck decide the day.
  const notes: string[] = [];
  let difficulty =
    entityDifficulty(record, config) +
    breach.difficulty +
    location.difficulty +
    problemDef.difficulty +
    rules.reduce((n, r) => n + (r.difficulty ?? 0), 0) +
    spread(config.difficulty.noise, random);
  const luck = random();
  if (luck < config.difficulty.luckyBreakChance) {
    difficulty *= config.difficulty.luckyBreakFactor;
    notes.push("lucky break");
  } else if (luck < config.difficulty.luckyBreakChance + config.difficulty.badDayChance) {
    difficulty += config.difficulty.badDayBonus;
    notes.push("bad day");
  }
  difficulty = Math.round(difficulty);

  // Facility state: forced by the breach and problem, otherwise damaged more often when it's bad.
  const systems = Object.fromEntries(SYSTEM_IDS.map((s) => [s, "nominal"])) as Record<SystemId, Condition>;
  const damage = clamp(config.facility.degradeChance + difficulty * config.facility.degradePerDifficulty, 0, 0.6);
  for (const s of SYSTEM_IDS) {
    if (random() < damage) systems[s] = random() < config.facility.offlineShare ? "offline" : "degraded";
  }
  Object.assign(systems, breach.systems ?? {}, problemDef.systems ?? {});

  const incident: Incident = {
    code: `MC-${String(1000 + Math.floor(random() * 9000))}`,
    mode: options.mode,
    entity: {
      ref: record.ref,
      title: record.title,
      url: record.url,
      classification,
      containment,
      fields: record.fields,
      identityKnown: !unknown,
      initiallyUnknown: unknown,
      revealedStage: null,
      status: "loose",
    },
    breach: { ...breach, text: "" },
    location,
    threatLocation: problemDef.id === "location_unknown" ? null : location.id,
    problem: { id: problemDef.id, text: "" },
    environment: rules.filter((r) => r.environment).map((r) => ({ ruleId: r.id, text: r.environment!.text })),
    systems,
    personnel: [],
    objectives: [],
    facts: [],
    stats: { ...config.stats.start },
    difficulty,
    notes,
    rulesApplied: rules.map((r) => r.id),
    anomalies: [],
    locations,
    canonRefs: [record.ref],
    nextId: 0,
  };

  addFacts(incident, record, sources.incidents ?? [], breach);
  addPersonnel(incident, sources, config, random, options.playerCount);

  // The starting problem may single out one staff member.
  let problemNpc = "";
  if (problemDef.npcStatus && incident.personnel.length) {
    const target = pick(incident.personnel, random);
    target.status = problemDef.npcStatus;
    target.location = location.id;
    target.importance = "high";
    problemNpc = target.name;
  }
  const vars = {
    location: location.name,
    npc: problemNpc || "A staff member",
    entity: incident.entity.identityKnown ? record.title : "the unknown entity",
    procedures: record.fields.containmentProcedures ?? "",
  };
  incident.breach.text = fill(breach.description, vars);
  const text = fill(problemDef.text, vars);
  incident.problem.text = text.charAt(0).toUpperCase() + text.slice(1);

  // Starting stats: defaults, noise, difficulty, then everything that was generated.
  const stats = incident.stats;
  for (const id of STAT_IDS) if (id !== "time") stats[id] += spread(config.stats.startNoise, random);
  for (const [id, weight] of Object.entries(DIFFICULTY_PULL)) stats[id as StatId] -= difficulty * config.difficulty.statImpact * weight;
  stats.chaos += difficulty * 0.3;
  addStats(stats, breach.stats);
  addStats(stats, problemDef.stats);
  addStats(stats, location.stats);
  for (const r of rules) addStats(stats, r.environment?.stats);
  for (const s of SYSTEM_IDS) if (systems[s] !== "nominal") addStats(stats, SYSTEMS[s].effects[systems[s] as "degraded" | "offline"]);
  for (const id of STAT_IDS) stats[id] = Math.round(clamp(stats[id], id === "chaos" ? 0 : 5, 100));
  // Never start already contained.
  stats.containment = Math.min(stats.containment, config.endings.containedAt - 15);

  addObjectives(incident, config, random);
  return incident;
}

function addFacts(incident: Incident, record: CanonRecord, canonIncidents: readonly CanonRecord[], breach: BreachDef): void {
  const known = incident.entity.identityKnown;
  const add = (fact: Omit<Fact, "revealedStage" | "heldBy" | "redacted"> & { heldBy?: string }) =>
    incident.facts.push({ revealedStage: null, heldBy: null, redacted: isRedacted(fact.text), ...fact });

  add({ id: "f-identity", label: "Entity identity", text: `${record.ref} — ${record.title}`, source: "canon", ref: record.ref, about: "identity", visibility: known ? "known" : "discoverable" });
  add({ id: "f-classification", label: "Classification", text: incident.entity.classification, source: "canon", ref: record.ref, about: "entity", visibility: known ? "known" : "discoverable" });
  add({ id: "f-containment", label: "Containment level", text: incident.entity.containment, source: "canon", ref: record.ref, about: "entity", visibility: known ? "known" : "discoverable" });

  const fieldLabels: Record<string, string> = {
    containmentProcedures: "Containment procedures",
    description: "Description",
    addendum: "Addendum",
  };
  for (const [key, label] of Object.entries(fieldLabels)) {
    const text = record.fields[key];
    if (!text) continue;
    add({
      id: `f-${key}`,
      label,
      text,
      source: "canon",
      ref: record.ref,
      about: "entity",
      visibility: breach.revealsFields?.includes(key) ? "known" : "discoverable",
    });
  }

  // Prior incidents on file for this entity: something to dig up.
  for (const prior of canonIncidents.filter((i) => i.links.entitiesInvolved?.includes(record.ref)).slice(0, 3)) {
    const summary = prior.fields.summary ?? prior.fields.description ?? "";
    add({
      id: `f-${prior.ref}`,
      label: `Prior incident ${prior.ref}`,
      text: `${prior.title}${summary ? `: ${summary}` : ""}`.slice(0, 300),
      source: "canon",
      ref: prior.ref,
      about: "record",
      visibility: "discoverable",
    });
    incident.canonRefs.push(prior.ref);
  }
}

const CANON_STATUS: Record<string, PersonnelStatus> = {
  ACTIVE: "active",
  REASSIGNED: "active",
  INACTIVE: "unavailable",
  MIA: "missing",
};

function addPersonnel(incident: Incident, sources: IncidentSources, config: MyCobConfig, random: Random, playerCount: number): void {
  const entityRef = incident.entity.ref;
  const nearby = () => (random() < 0.5 ? incident.location.id : pick(incident.locations, random).id);

  // Real personnel files first, the ones tied to this entity's past incidents preferred.
  const related = new Set<string>();
  for (const i of sources.incidents ?? []) {
    if (!i.links.entitiesInvolved?.includes(entityRef)) continue;
    for (const ref of i.links.personnelInvolved ?? []) related.add(ref);
    for (const p of sources.personnel ?? []) if (p.links.notableIncidents?.includes(i.ref)) related.add(p.ref);
  }
  const usable = (sources.personnel ?? []).filter((p) => CANON_STATUS[upper(p.fields.status)] !== undefined || !p.fields.status);
  const ordered = [...shuffle(usable.filter((p) => related.has(p.ref)), random), ...shuffle(usable.filter((p) => !related.has(p.ref)), random)];
  for (const p of ordered.slice(0, config.personnel.canonMax)) {
    const npc: Npc = {
      id: nextId(incident, "p-"),
      name: p.title,
      department: p.fields.designation || p.fields.specialisation || "Personnel",
      source: "canon",
      ref: p.ref,
      url: p.url,
      location: nearby(),
      status: CANON_STATUS[upper(p.fields.status)] ?? "active",
      relationship: related.has(p.ref) ? "has dealt with this entity before" : pick(NPC_RELATIONSHIPS, random),
      importance: related.has(p.ref) ? "high" : "medium",
      knowledgeFactId: null,
      controlledBy: null,
    };
    if (p.fields.description) {
      const factId = `f-${p.ref}`;
      incident.facts.push({
        id: factId,
        label: `Personnel file ${p.ref}`,
        text: p.fields.description.slice(0, 300),
        source: "canon",
        ref: p.ref,
        about: "personnel",
        visibility: "discoverable",
        redacted: isRedacted(p.fields.description),
        revealedStage: null,
        heldBy: npc.id,
      });
      npc.knowledgeFactId = factId;
    }
    incident.personnel.push(npc);
    incident.canonRefs.push(p.ref);
  }

  // Game-only staff fill out the facility.
  const { generatedMin, generatedMax } = config.personnel;
  const count = generatedMin + Math.floor(random() * (generatedMax - generatedMin + 1)) + (playerCount >= 6 ? 1 : 0);
  const used = new Set(incident.personnel.map((p) => p.name));
  for (let i = 0; i < count; i++) {
    const dept = pick(DEPARTMENTS, random);
    let name = "";
    for (let attempt = 0; attempt < 20 && (!name || used.has(name)); attempt++) {
      name = `${dept.title} ${pick(NPC_FIRST, random)} ${pick(NPC_LAST, random)}`;
    }
    used.add(name);
    const npc: Npc = {
      id: nextId(incident, "p-"),
      name,
      department: dept.name,
      source: "generated",
      ref: null,
      url: null,
      location: nearby(),
      status: random() < 0.8 ? "active" : "safe",
      relationship: pick(NPC_RELATIONSHIPS, random),
      importance: random() < 0.25 ? "high" : random() < 0.6 ? "medium" : "low",
      knowledgeFactId: null,
      controlledBy: null,
    };
    const factId = `f-knows-${npc.id}`;
    const knowledge = fill(pick(NPC_KNOWLEDGE, random), {
      location: pick(incident.locations, random).name,
      system: SYSTEMS[pick(SYSTEM_IDS, random)].name,
    });
    incident.facts.push({
      id: factId,
      label: `What ${name} knows`,
      text: `${name} ${knowledge}.`,
      source: "generated",
      ref: null,
      about: "personnel",
      visibility: "discoverable",
      redacted: false,
      revealedStage: null,
      heldBy: npc.id,
    });
    npc.knowledgeFactId = factId;
    incident.personnel.push(npc);
  }
}

function addObjectives(incident: Incident, config: MyCobConfig, random: Random): void {
  const containedAt = config.endings.containedAt;
  const primary: Objective = !incident.entity.identityKnown
    ? {
        id: "o-primary",
        kind: "primary",
        text: "Identify and contain the unknown entity",
        goal: { type: "contain", atLeast: containedAt, identify: true },
        status: "active",
        createdStage: 0,
        resolvedStage: null,
        source: "generated",
      }
    : incident.difficulty >= 32 && random() < 0.35
      ? {
          id: "o-primary",
          kind: "primary",
          text: "Get everyone out alive",
          goal: { type: "survive", atLeast: 40 },
          status: "active",
          createdStage: 0,
          resolvedStage: null,
          source: "generated",
        }
      : {
          id: "o-primary",
          kind: "primary",
          text: `Contain ${incident.entity.title}`,
          goal: { type: "contain", atLeast: containedAt, identify: false },
          status: "active",
          createdStage: 0,
          resolvedStage: null,
          source: "generated",
        };
  incident.objectives.push(primary);

  const { secondaryMin, secondaryMax } = config.objectives;
  const want = secondaryMin + Math.floor(random() * (secondaryMax - secondaryMin + 1));
  // What the situation demands first (whoever the problem trapped, then anyone missing, then
  // broken systems), then variety.
  const demanded: { template: SecondaryTemplate["id"]; npcId?: string }[] = [];
  const inTrouble = incident.personnel.filter((p) => p.status === "trapped" || p.status === "missing");
  for (const p of [...inTrouble].sort((a, b) => (a.status === "trapped" ? 0 : 1) - (b.status === "trapped" ? 0 : 1))) {
    demanded.push({ template: "rescue", npcId: p.id });
  }
  if (SYSTEM_IDS.some((s) => incident.systems[s] === "offline")) demanded.push({ template: "restore" });
  const target = Math.max(want, demanded.length ? Math.min(demanded.length, secondaryMax) : 0);
  for (let tries = 0; incident.objectives.length - 1 < target && tries < 20; tries++) {
    const next = demanded.shift() ?? { template: weighted(SECONDARY_TEMPLATES, (t) => t.weight, random).id };
    const objective = makeSecondary(incident, next.template, 0, random, { npcId: next.npcId });
    if (objective) incident.objectives.push(objective);
  }
}
