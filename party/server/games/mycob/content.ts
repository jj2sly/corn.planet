// The world My Cob Escaped builds incidents from: a generic containment facility with a few Corn
// Planet touches. All of it is generated content, never canon — only the entity (and any real
// personnel or incident files) come from the CPI Database.
//
// Everything is data. Adding a location, breach type, problem, special event or entity rule is
// adding an entry here; the generator and engine read these tables and nothing else.

import type { EndingId, ResponseTag, Stats } from "./config.ts";

export type StatDeltas = Partial<Stats>;

// ------------------------------------------------------------------ facility systems

export const SYSTEM_IDS = ["power", "security", "comms", "containment", "doors", "alarms", "equipment", "safety"] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];
export type Condition = "nominal" | "degraded" | "offline";

/** keywords: words in a response that refer to this system (for grounding, never for scoring). */
export const SYSTEMS: Record<SystemId, { name: string; keywords: string[]; effects: { degraded: StatDeltas; offline: StatDeltas } }> = {
  power: { name: "Power", keywords: ["power", "generator", "electric", "breaker", "lights"], effects: { degraded: { facility: -4 }, offline: { facility: -10, containment: -5 } } },
  security: { name: "Security", keywords: ["security", "camera", "badge", "lockdown"], effects: { degraded: { containment: -3 }, offline: { containment: -8 } } },
  comms: { name: "Communications", keywords: ["radio", "comms", "intercom", "phone", "communication"], effects: { degraded: { information: -4 }, offline: { information: -10 } } },
  containment: { name: "Containment Systems", keywords: ["containment field", "containment system", "field generator", "restraint"], effects: { degraded: { containment: -5 }, offline: { containment: -12 } } },
  doors: { name: "Doors", keywords: ["door", "gate", "hatch", "blast door"], effects: { degraded: { personnel: -3 }, offline: { personnel: -6, containment: -4 } } },
  alarms: { name: "Alarms", keywords: ["alarm", "siren", "klaxon"], effects: { degraded: { time: -3 }, offline: { time: -6 } } },
  equipment: { name: "Equipment", keywords: ["equipment", "gear", "kit", "tool"], effects: { degraded: { resources: -6 }, offline: { resources: -14 } } },
  safety: { name: "Personnel Safety", keywords: ["sprinkler", "first aid", "safety", "extinguisher"], effects: { degraded: { personnel: -5 }, offline: { personnel: -12 } } },
};

/** Which system an action type repairs when it goes well. */
export const TAG_REPAIRS: Partial<Record<ResponseTag, SystemId[]>> = {
  EQUIPMENT: ["power", "equipment", "containment", "alarms", "doors"],
  COMMUNICATE: ["comms", "alarms"],
  DEPLOY: ["security", "doors"],
  CONTAIN: ["containment", "doors"],
  EVACUATE: ["safety", "doors"],
};

// ------------------------------------------------------------------ locations

export interface LocationDef {
  id: string;
  name: string;
  description: string;
  difficulty: number;
  stats?: StatDeltas;
  /** Words in a response that refer to this place (for grounding, never for scoring). */
  keywords: string[];
  /** Where the location came from. Canon locations can be added once the CPI Database has them. */
  source: "builtin" | "canon";
  ref?: string;
}

export const LOCATIONS: readonly LocationDef[] = [
  { id: "containment_wing", name: "Containment Wing", description: "Row after row of bays. One of them is open.", difficulty: 4, keywords: ["containment wing", "bay"], source: "builtin" },
  { id: "research_wing", name: "Research Wing", description: "Whiteboards, sample fridges and a coffee machine that has seen things.", difficulty: 2, stats: { information: 5 }, keywords: ["research wing", "lab"], source: "builtin" },
  { id: "medical", name: "Medical Bay", description: "Beds, bandages and a hand-hygiene poster nobody reads.", difficulty: 2, stats: { personnel: 5 }, keywords: ["medical", "infirmary", "med bay"], source: "builtin" },
  { id: "security", name: "Security Office", description: "Monitors, a weapons locker and a half-eaten corn dog.", difficulty: 0, stats: { resources: 5 }, keywords: ["security office", "weapons locker"], source: "builtin" },
  { id: "administration", name: "Administration", description: "Filing cabinets and the Records Division annex. Nothing here is built to hold anything.", difficulty: 6, stats: { containment: -5 }, keywords: ["admin", "records division", "office"], source: "builtin" },
  { id: "storage", name: "Storage Level B", description: "Shelving to the ceiling. Crates marked DO NOT OPEN, most of them open.", difficulty: 4, stats: { resources: 5 }, keywords: ["storage", "crate", "shelf"], source: "builtin" },
  { id: "maintenance", name: "Maintenance Tunnels", description: "Pipes, steam and nowhere to turn around.", difficulty: 7, stats: { time: -5 }, keywords: ["maintenance", "tunnel", "pipe"], source: "builtin" },
  { id: "loading", name: "Loading & Transport", description: "Dock doors, forklifts and a truck that was supposed to leave an hour ago.", difficulty: 5, keywords: ["loading", "dock", "truck", "forklift"], source: "builtin" },
  { id: "cafeteria", name: "Cafeteria", description: "Today's special is creamed corn. It is always creamed corn.", difficulty: 3, stats: { personnel: -5 }, keywords: ["cafeteria", "kitchen", "creamed corn"], source: "builtin" },
  { id: "corn_processing", name: "Corn Processing Area", description: "Industrial husking lines. Loud, sharp and full of corn.", difficulty: 8, stats: { facility: -5 }, keywords: ["processing", "husking", "husker"], source: "builtin" },
];

// ------------------------------------------------------------------ breach / incident types

export interface BreachDef {
  id: string;
  name: string;
  /** May use {location} and {procedures}. */
  description: string;
  difficulty: number;
  stats: StatDeltas;
  weight: number;
  systems?: Partial<Record<SystemId, Condition>>;
  /** Preferred locations and problems, used most of the time when given. */
  locations?: string[];
  problems?: string[];
  /** Makes an unknown-entity start more likely. */
  unknownBonus?: number;
  /** Entity fields this breach puts in front of players from the start. */
  revealsFields?: string[];
  /** Set on entity-specific breach types. */
  entitySpecific?: boolean;
}

export const BREACHES: readonly BreachDef[] = [
  {
    id: "standard_failure",
    name: "Standard Containment Failure",
    description: "The bay door opened. It was not supposed to.",
    difficulty: 4,
    stats: { containment: -10 },
    weight: 3,
    problems: ["entity_escaped", "containment_breach"],
  },
  {
    id: "security_failure",
    name: "Security Failure",
    description: "Badge readers are accepting everything, including a sandwich.",
    difficulty: 5,
    stats: { containment: -5 },
    systems: { security: "offline" },
    weight: 2,
    problems: ["security_failure", "unauthorized_access"],
  },
  {
    id: "power_failure",
    name: "Power Failure",
    description: "Main power is down. Backup power is thinking about it.",
    difficulty: 7,
    stats: { facility: -8 },
    systems: { power: "offline" },
    weight: 2,
    problems: ["sealed_malfunction", "location_unknown", "personnel_trapped"],
  },
  {
    id: "unauthorized_access",
    name: "Unauthorized Access",
    description: "Someone went in who shouldn't have. They left the door open behind them.",
    difficulty: 4,
    stats: { information: -5 },
    weight: 2,
    problems: ["unauthorized_access", "personnel_trapped"],
  },
  {
    id: "transport_escape",
    name: "Escape During Transport",
    description: "The entity was being moved between bays. It is no longer being moved.",
    difficulty: 6,
    stats: { containment: -8 },
    weight: 2,
    locations: ["loading", "maintenance", "containment_wing"],
    problems: ["transport_incident", "entity_escaped", "location_unknown"],
  },
  {
    id: "containment_malfunction",
    name: "Containment Malfunction",
    description: "The chamber is sealed, but every system inside it is reporting nonsense.",
    difficulty: 3,
    stats: { containment: 6, information: -8 },
    systems: { containment: "degraded" },
    weight: 2,
    locations: ["containment_wing"],
    problems: ["sealed_malfunction", "unknown_anomaly"],
  },
  {
    id: "unknown_breach",
    name: "Unknown Breach",
    description: "Alarms everywhere. Nobody knows why yet.",
    difficulty: 6,
    stats: { information: -14 },
    weight: 1.5,
    unknownBonus: 0.35,
    problems: ["unknown_anomaly", "location_unknown"],
  },
];

// ------------------------------------------------------------------ starting problems

export interface ProblemDef {
  id: string;
  /** May use {location}, {npc} and {entity}. */
  text: string;
  difficulty: number;
  stats: StatDeltas;
  weight: number;
  systems?: Partial<Record<SystemId, Condition>>;
  /** Puts one generated or canon staff member in this state, and names them in the text. */
  npcStatus?: "trapped" | "missing" | "injured";
}

export const PROBLEMS: readonly ProblemDef[] = [
  { id: "entity_escaped", text: "{entity} is loose in the {location}.", difficulty: 5, stats: { containment: -12 }, weight: 3 },
  { id: "containment_breach", text: "Containment in the {location} is breached and spreading.", difficulty: 4, stats: { containment: -8, facility: -5 }, weight: 2 },
  { id: "personnel_trapped", text: "{npc} is trapped in the {location} with {entity}.", difficulty: 4, stats: { personnel: -10 }, weight: 2, npcStatus: "trapped" },
  { id: "sealed_malfunction", text: "The chamber is sealed, but its systems are failing one by one.", difficulty: 3, stats: { facility: -6 }, weight: 1.5, systems: { containment: "degraded" } },
  { id: "location_unknown", text: "Nobody knows where {entity} is. The cameras show an empty {location}.", difficulty: 5, stats: { information: -12 }, weight: 2 },
  { id: "comms_failure", text: "Communications are down across the facility.", difficulty: 4, stats: { information: -6 }, weight: 1.5, systems: { comms: "offline" } },
  { id: "security_failure", text: "The lockdown failed. Doors in the {location} are opening on their own.", difficulty: 5, stats: { containment: -6 }, weight: 1.5, systems: { doors: "offline" } },
  { id: "transport_incident", text: "A transport cart overturned in the {location}. Its cargo is missing.", difficulty: 4, stats: { containment: -6, resources: -6 }, weight: 1.5 },
  { id: "unauthorized_access", text: "{npc} let themselves into the bay \"just to look\" and hasn't come out.", difficulty: 4, stats: { personnel: -6 }, weight: 1.5, npcStatus: "missing" },
  { id: "unknown_anomaly", text: "Something is wrong in the {location}, and every instrument disagrees about what.", difficulty: 5, stats: { information: -10, chaos: 8 }, weight: 1.5 },
  { id: "corn_overflow", text: "The {location} is ankle-deep in corn and rising.", difficulty: 4, stats: { facility: -6, chaos: 5 }, weight: 1 },
];

// ------------------------------------------------------------------ generated personnel

export const NPC_FIRST = ["Maizie", "Cobb", "Kerry", "Hank", "Dale", "Colby", "Polly", "Ernest", "Sheila", "Glen", "Barb", "Wanda", "Fritz", "Nell", "Tess", "Otis"];
export const NPC_LAST = ["Husk", "Kernel", "Stalk", "Cobbett", "Maize", "Silk", "Shuckley", "Tassel", "Grain", "Popper", "Hominy", "Furrow", "Fielding", "Crib"];

export interface DepartmentDef {
  id: string;
  name: string;
  title: string;
}

export const DEPARTMENTS: readonly DepartmentDef[] = [
  { id: "research", name: "Research", title: "Dr." },
  { id: "technical", name: "Technical", title: "Tech" },
  { id: "security", name: "Security", title: "Officer" },
  { id: "medical", name: "Medical", title: "Nurse" },
  { id: "comms", name: "Communications", title: "Operator" },
  { id: "contractor", name: "Contractor", title: "Contractor" },
  { id: "intern", name: "Interns", title: "Intern" },
  { id: "admin", name: "Administration", title: "Administrator" },
  { id: "facilities", name: "Facilities", title: "Custodian" },
];

/** Public: what everyone can see about a staff member's part in this. */
export const NPC_RELATIONSHIPS = [
  "was on duty when it happened",
  "is responsible for this bay",
  "has never seen an entity before today",
  "insists this is not their fault",
  "brought snacks",
  "was halfway through a lunch break",
  "has filed three complaints about this bay",
  "is new",
];

/** Private: something they know, revealed by talking to them. Game-only. */
export const NPC_KNOWLEDGE = [
  "knows the backup generator is in the {location}",
  "has the override code for the {system} panel",
  "was the last person to see the entity",
  "has been feeding the entity (unauthorized)",
  "wrote the transport manifest and left out a line",
  "knows a shortcut through the {location}",
  "saw something move in the {location} ten minutes before the alarm",
  "has a key that shouldn't exist",
];

// ------------------------------------------------------------------ objectives

export interface SecondaryTemplate {
  id: "rescue" | "restore" | "recover" | "discover" | "protect" | "prevent_spread" | "stabilize";
  text: string;
  weight: number;
}

export const SECONDARY_TEMPLATES: readonly SecondaryTemplate[] = [
  { id: "rescue", text: "Rescue {npc} from the {location}", weight: 3 },
  { id: "restore", text: "Restore {system}", weight: 2 },
  { id: "recover", text: "Recover the containment kit from the {location}", weight: 1 },
  { id: "discover", text: "Find out what {npc} knows", weight: 1.5 },
  { id: "protect", text: "Keep {npc} alive", weight: 1 },
  { id: "prevent_spread", text: "Stop it reaching the {location}", weight: 1.5 },
  { id: "stabilize", text: "Stabilize the facility", weight: 1 },
];

// ------------------------------------------------------------------ special events and anomalies

export interface AnomalyDef {
  name: string;
  text: string;
  /** Stages it lasts. */
  stages: number;
  /** Success chance change for one tag, or every action when tag is omitted. */
  tag?: ResponseTag;
  success: number;
}

export interface SpecialEventDef {
  id: string;
  name: string;
  text: string;
  weight: number;
  /** Only possible at or above this chaos. */
  minChaos: number;
  stats: StatDeltas;
  systems?: Partial<Record<SystemId, Condition>>;
  anomaly?: AnomalyDef;
  /** Adds a new secondary objective. */
  objective?: string;
}

export const SPECIAL_EVENTS: readonly SpecialEventDef[] = [
  { id: "sprinklers", name: "Sprinkler Uprising", text: "Every sprinkler in the wing goes off at once. Nobody touched anything. Allegedly.", weight: 2, minChaos: 0, stats: { facility: -6, chaos: 3 } },
  { id: "corn_rain", name: "Corn Rain", text: "It is raining corn indoors. Visibility is poor and morale is confused.", weight: 1.5, minChaos: 30, stats: { information: -5 }, anomaly: { name: "Corn Rain", text: "Evacuations are slower in the corn.", stages: 1, tag: "EVACUATE", success: -0.1 } },
  { id: "audit", name: "Records Division Audit", text: "The Records Division picks this exact moment for a surprise audit. Paperwork is required before anything else happens.", weight: 1, minChaos: 0, stats: { time: -8 } },
  { id: "ally", name: "Unexpected Ally", text: "A custodian nobody has met before calmly hands over a mop and a plan. Both help.", weight: 1, minChaos: 0, stats: { containment: 6, personnel: 4 } },
  { id: "popcorn", name: "Popcorn Event", text: "A heat vent pops half the stores into popcorn. The entity is visibly distracted.", weight: 1.5, minChaos: 20, stats: { containment: 7, resources: -5 } },
  { id: "blackout", name: "Blackout", text: "The lights go out. All of them. The backup lights also go out, out of solidarity.", weight: 1.5, minChaos: 25, stats: { facility: -6 }, systems: { power: "offline" } },
  { id: "second_signature", name: "Second Signature", text: "Sensors pick up a second, smaller signature. It is probably fine. It is probably not fine.", weight: 1, minChaos: 45, stats: { information: -6 }, objective: "Find the source of the second signature" },
  { id: "clairvoyance", name: "Temporary Clairvoyance", text: "Everyone in the facility briefly knows where they left their keys. And a few other things.", weight: 0.8, minChaos: 35, stats: { information: 8 }, anomaly: { name: "Clairvoyance", text: "Investigations are unusually lucky.", stages: 1, tag: "INVESTIGATE", success: 0.2 } },
  { id: "override", name: "The Intern Found the Override", text: "An intern finds the master override in a desk drawer labelled \"NOT THE OVERRIDE\".", weight: 1, minChaos: 0, stats: { resources: 10 } },
  { id: "jazz", name: "Smooth Jazz Incident", text: "Every radio in the facility is now playing smooth jazz. Only smooth jazz.", weight: 1, minChaos: 30, stats: { information: -6 }, systems: { comms: "degraded" } },
  { id: "time_dilation", name: "Time Dilation", text: "A clock in the wing is running backwards, and the incident is briefly running with it.", weight: 0.8, minChaos: 50, stats: { time: 12 } },
  { id: "gravity", name: "Gravity Takes Five", text: "Gravity in the wing goes on a short, unannounced break.", weight: 0.8, minChaos: 60, stats: { facility: -5 }, anomaly: { name: "Low Gravity", text: "Everything is floatier and harder to aim.", stages: 1, success: -0.05 } },
];

/** New problems that can appear mid-incident, as secondary objectives. */
export interface NewProblemDef {
  id: string;
  /** Situation line; may use {location}, {npc}, {system}. */
  text: string;
  objective: SecondaryTemplate["id"];
  stats: StatDeltas;
  weight: number;
}

export const NEW_PROBLEMS: readonly NewProblemDef[] = [
  { id: "new_trapped", text: "{npc} is now trapped in the {location}.", objective: "rescue", stats: { personnel: -6 }, weight: 3 },
  { id: "new_system", text: "{system} just failed.", objective: "restore", stats: { facility: -4 }, weight: 2 },
  { id: "new_spread", text: "It's heading for the {location}.", objective: "prevent_spread", stats: { containment: -5 }, weight: 2 },
  { id: "new_fire", text: "A small fire has started in the {location}. It's growing.", objective: "stabilize", stats: { facility: -6 }, weight: 1.5 },
  { id: "new_witness", text: "{npc} saw something and won't stop talking about it.", objective: "discover", stats: { information: -3 }, weight: 1 },
];

// ------------------------------------------------------------------ entity-specific rules

/**
 * A rule that fires for entities matching it. Rules are how an entity's canon shapes its
 * incidents: unique incident types, environmental effects, difficulty. Matching is by id,
 * classification, containment level, or text in the entity's own file — never by one hard-coded
 * entity in the engine.
 */
export interface EntityRule {
  id: string;
  match: {
    refs?: string[];
    classifications?: string[];
    containment?: string[];
    /** Any of these (lowercase) appear in the description or containment procedures. */
    textIncludes?: string[];
    /** This field must be present and not redacted. */
    hasField?: string;
  };
  /** Chance the rule applies when it matches. */
  chance: number;
  breach?: BreachDef;
  environment?: { text: string; stats?: StatDeltas };
  unknownBonus?: number;
  difficulty?: number;
}

export const ENTITY_RULES: readonly EntityRule[] = [
  {
    id: "procedure_violation",
    match: { hasField: "containmentProcedures" },
    chance: 0.3,
    breach: {
      id: "procedure_violation",
      name: "Procedure Violation",
      description: "Someone ignored the containment procedures. The file is very clear: “{procedures}”",
      difficulty: 3,
      stats: { containment: -8 },
      weight: 1,
      revealsFields: ["containmentProcedures"],
      entitySpecific: true,
    },
  },
  {
    id: "termination_misfire",
    match: { containment: ["TERMINATION"] },
    chance: 0.5,
    breach: {
      id: "termination_misfire",
      name: "Termination Protocol Misfire",
      description: "The termination order went through. The entity did not.",
      difficulty: 6,
      stats: { containment: -10 },
      weight: 1,
      entitySpecific: true,
    },
  },
  {
    id: "neutralization_reversal",
    match: { classifications: ["NEUTRALIZED"] },
    chance: 0.6,
    breach: {
      id: "neutralization_reversal",
      name: "Neutralization Reversal",
      description: "This entity is on file as NEUTRALIZED. It would like a word about that.",
      difficulty: 8,
      stats: { information: -8 },
      weight: 1,
      entitySpecific: true,
    },
  },
  {
    id: "cascade_failure",
    match: { containment: ["MAXIMUM", "TERMINATION"] },
    chance: 0.3,
    breach: {
      id: "cascade_failure",
      name: "Cascade Failure",
      description: "Every layer of a maximum-security bay failed in sequence, in alphabetical order.",
      difficulty: 7,
      stats: { containment: -12, facility: -5 },
      weight: 1,
      systems: { containment: "offline" },
      entitySpecific: true,
    },
  },
  {
    id: "gate_left_open",
    match: { textIncludes: ["gate", "door"] },
    chance: 0.35,
    breach: {
      id: "gate_left_open",
      name: "Gate Left Open",
      description: "Somebody left a gate open. Possibly on purpose. Possibly per procedure.",
      difficulty: 2,
      stats: { containment: -6 },
      weight: 1,
      entitySpecific: true,
    },
  },
  { id: "cosmic_desync", match: { classifications: ["COSMIC"] }, chance: 0.5, environment: { text: "Local reality is running four seconds behind. Clocks disagree. So do people.", stats: { information: -6, time: -4 } } },
  { id: "earthly_blend", match: { classifications: ["EARTHLY"] }, chance: 0.35, environment: { text: "It looks disturbingly ordinary. Staff keep walking past it." }, unknownBonus: 0.25 },
  { id: "constricted_pressure", match: { classifications: ["CONSTRICTED"] }, chance: 0.4, environment: { text: "The containment fields are pressing inward. Everything in the wing feels tight.", stats: { facility: -5 } } },
  { id: "local_familiar", match: { classifications: ["LOCAL"] }, chance: 0.3, environment: { text: "Half the staff have met it before and all of them have opinions.", stats: { information: 6 } } },
  { id: "water_sensitive", match: { textIncludes: ["water", "wet", "rain"] }, chance: 0.5, environment: { text: "The sprinkler system is armed and twitchy.", stats: { facility: -4 } }, difficulty: 2 },
  { id: "eye_contact", match: { textIncludes: ["eye contact", "look at", "stare"] }, chance: 0.5, environment: { text: "Staff have been told not to look at it. Several have already looked at it.", stats: { personnel: -6 } }, difficulty: 2 },
  { id: "hungry", match: { textIncludes: ["feed", "food", "eat", "snack", "hungry"] }, chance: 0.4, environment: { text: "It's hungry, and the cafeteria is very close.", stats: { personnel: -4 } } },
];

// ------------------------------------------------------------------ endings

export const ENDING_TEXT: Record<EndingId, { title: string; lines: string[] }> = {
  contained: {
    title: "ENTITY CONTAINED",
    lines: [
      "{entity} is back where it belongs. Mostly.",
      "Containment holds. The paperwork begins.",
      "{entity} has been contained. Nobody is entirely sure which part of the plan worked.",
    ],
  },
  terminated: {
    title: "ENTITY TERMINATED",
    lines: [
      "{entity} has been terminated. The Records Division will want to know how.",
      "It's over. {entity} is not coming back. Probably.",
    ],
  },
  escaped: {
    title: "ENTITY AT LARGE",
    lines: [
      "{entity} is still out there. Somewhere. Probably near the corn.",
      "The incident window has closed with {entity} uncontained. Lock your doors.",
      "{entity} got away. Officially, this is now someone else's problem.",
    ],
  },
  everyone_dies: {
    title: "NO SURVIVORS",
    lines: ["Nobody made it out. The corn remains.", "The facility has gone quiet. {entity} has not."],
  },
};
