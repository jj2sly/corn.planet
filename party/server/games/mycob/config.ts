// MY COB ESCAPED, WHAT DO I DO NOW??? — every tunable rule in one place.
//
// Nothing about balance lives in the engine code: stage counts, timers, roles, lives, stat
// thresholds, chaos, randomness, difficulty tables, scoring weights and caps, voting and award
// limits are all here, so post-playtest tuning is editing numbers in this file. Game modes are
// data too: a mode is a name plus a partial override of this config.

export const RESPONSE_TAGS = ["CONTAIN", "EVACUATE", "INVESTIGATE", "COMMUNICATE", "DEPLOY", "EQUIPMENT", "STRATEGIZE", "OTHER"] as const;
export type ResponseTag = (typeof RESPONSE_TAGS)[number];

/** How a player goes about it. Optional; "standard" when not given. Reckless is the chaos playstyle. */
export const APPROACHES = ["careful", "standard", "reckless"] as const;
export type Approach = (typeof APPROACHES)[number];

export const STAT_IDS = ["containment", "facility", "personnel", "resources", "information", "time", "chaos"] as const;
export type StatId = (typeof STAT_IDS)[number];
export type Stats = Record<StatId, number>;
/** Stats that are good for the team when they go up. Chaos is neither good nor bad. */
export const TEAM_STATS: readonly StatId[] = ["containment", "facility", "personnel", "resources", "information", "time"];

export const OUTCOMES = ["critical", "success", "partial", "failure", "catastrophe"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const ENDINGS = ["contained", "terminated", "escaped", "everyone_dies"] as const;
export type EndingId = (typeof ENDINGS)[number];

export type LengthId = "short" | "standard" | "long";
export const LENGTHS: readonly LengthId[] = ["short", "standard", "long"];

export type RoleContextKey = "objectives" | "containment" | "leads" | "systems" | "personnel" | "threat" | "log" | "rumor";

export interface RoleDef {
  id: string;
  name: string;
  /** Shown next to the role everywhere, so it reads at a glance. */
  icon: string;
  blurb: string;
  /** Tags this role is good at. Using one counts as using the role. */
  strongTags: ResponseTag[];
  /** Tags this role is bad at. Allowed, just less reliable. */
  weakTags: ResponseTag[];
  /** Extra information only this role's phone shows. */
  context: RoleContextKey[];
  /** Wider spread of outcomes: more brilliant, more disastrous. */
  wildcard?: boolean;
  /** The role card on the agent's phone: what it's for, what only it sees, what to try. */
  goodAt: string;
  onlyYou: string;
  tryThis: string[];
}

export interface StatLabel {
  /** The label applies at or above this value (checked highest first). */
  min: number;
  label: string;
  tone: "ok" | "warn" | "danger";
}

const ROLES: RoleDef[] = [
  {
    id: "commander",
    name: "Incident Commander",
    icon: "🎖️",
    blurb: "You set priorities. Everyone else ignores them at their own risk.",
    strongTags: ["STRATEGIZE", "COMMUNICATE"],
    weakTags: ["EQUIPMENT"],
    context: ["objectives"],
    goodAt: "Setting priorities and getting everyone pulling the same way.",
    onlyYou: "Every open objective in priority order, with its deadline.",
    tryThis: ["Name the one thing the team does this stage", "Send two agents at the primary objective", "Call off whatever is wasting time"],
  },
  {
    id: "containment",
    name: "Containment Specialist",
    icon: "🔒",
    blurb: "Doors, fields, restraints. Putting things back where they belong.",
    strongTags: ["CONTAIN", "EQUIPMENT"],
    weakTags: ["COMMUNICATE"],
    context: ["containment"],
    goodAt: "Doors, fields and restraints: putting it back and keeping it there.",
    onlyYou: "The entity's containment class, and how the containment systems and doors are holding.",
    tryThis: ["Seal the doors between it and the staff", "Reroute the containment field", "Rig a restraint from whatever is nearby"],
  },
  {
    id: "research",
    name: "Research Specialist",
    icon: "🔬",
    blurb: "You have read the file. Parts of it, anyway.",
    strongTags: ["INVESTIGATE", "STRATEGIZE"],
    weakTags: ["DEPLOY"],
    context: ["leads"],
    goodAt: "Working out what the entity is and how it works.",
    onlyYou: "Research leads: what's still in the files waiting to be found.",
    tryThis: ["Chase one of your leads", "Question whoever has dealt with it before", "Test a theory about what it wants"],
  },
  {
    id: "technician",
    name: "Technician",
    icon: "🔧",
    blurb: "If it has a panel, you can open it. Closing it is a separate skill.",
    strongTags: ["EQUIPMENT", "INVESTIGATE"],
    weakTags: ["EVACUATE"],
    context: ["systems"],
    goodAt: "Fixing, rigging and improvising equipment.",
    onlyYou: "Diagnostics: which systems are failing, and which to fix first.",
    tryThis: ["Fix the system at the top of your diagnostics", "Improvise a trap from spare parts", "Get power back to the containment wing"],
  },
  {
    id: "comms",
    name: "Communications",
    icon: "📻",
    blurb: "Radios, intercoms, and telling people to calm down.",
    strongTags: ["COMMUNICATE", "EVACUATE"],
    weakTags: ["CONTAIN"],
    context: ["personnel"],
    goodAt: "Coordinating people and getting them out alive.",
    onlyYou: "The staff tracker: where everyone is, and who knows something.",
    tryThis: ["Radio a trapped staff member and talk them out", "Clear an evacuation route", "Ask whoever 'knows something' what they know"],
  },
  {
    id: "field",
    name: "Field Operative",
    icon: "🥾",
    blurb: "You go where the entity is. On purpose.",
    strongTags: ["DEPLOY", "CONTAIN", "EVACUATE"],
    weakTags: ["STRATEGIZE"],
    context: ["threat"],
    goodAt: "Going in person: deploying, containing and rescuing up close.",
    onlyYou: "Where the entity was last tracked.",
    tryThis: ["Go where it was last seen and cut it off", "Escort staff out of the danger zone", "Get close enough to contain it by hand"],
  },
  {
    id: "recorder",
    name: "Incident Recorder",
    icon: "📋",
    blurb: "Everything that happens here goes in the report. Everything.",
    strongTags: ["INVESTIGATE", "COMMUNICATE"],
    weakTags: ["DEPLOY"],
    context: ["log"],
    goodAt: "Investigating and keeping everyone's story straight.",
    onlyYou: "The incident log: what happened in the last few stages.",
    tryThis: ["Point out what keeps going wrong", "Interview a witness for the report", "Remind the team what worked last time"],
  },
  {
    id: "intern",
    name: "Intern",
    icon: "☕",
    blurb: "Nobody told you anything. Anything could happen.",
    strongTags: ["OTHER"],
    weakTags: [],
    context: ["rumor"],
    wildcard: true,
    goodAt: "Things nobody else would try. Results vary wildly.",
    onlyYou: "A rumor. Unverified. Possibly nonsense.",
    tryThis: ["Follow the rumor and see what happens", "Do something no procedure covers", "Volunteer for the job nobody wants"],
  },
];

export const DEFAULT_MYCOB_CONFIG = {
  players: { min: 3, max: 8, /** The game ends early if fewer than this many agents remain. */ minToContinue: 2 },

  /** Stage count limits. The default is the standard length's. */
  stages: { min: 3, max: 7 },
  lengths: {
    short: { stages: 3, timerScale: 0.9 },
    standard: { stages: 5, timerScale: 1 },
    long: { stages: 7, timerScale: 1.15 },
  } as Record<LengthId, { stages: number; timerScale: number }>,

  /** Phase durations. Response, consequence and update are scaled by the length's timerScale. */
  timing: {
    alertMs: 20_000,
    /** Read the incident status recap and your intel before responses open. */
    updateMs: 25_000,
    /** Long enough to read the update and your intel, talk it over, and type something meaningful. */
    responseMs: 45_000,
    /** The director gets at least this long (so the screen doesn't flash) and at most the max. */
    processingMinMs: 4_000,
    processingMaxMs: 10_000,
    /** Long enough to read the narration, every action's outcome, status changes and discoveries. */
    consequenceMs: 30_000,
    voteMs: 20_000,
    outcomeMs: 20_000,
    awardSubmitMs: 45_000,
    awardVoteMs: 40_000,
    awardResultsMs: 15_000,
  },

  response: { textMax: 200 },

  roles: ROLES,

  lives: {
    start: 3,
    /** A down agent comes back as someone else with this many lives. */
    afterReassignment: 1,
    /** The most lives one consequence can take from one agent. */
    maxLossPerConsequence: 1,
  },

  stats: {
    start: { containment: 60, facility: 72, personnel: 70, resources: 62, information: 40, time: 100, chaos: 18 } as Stats,
    /** Spread (±) applied to every starting stat except time. */
    startNoise: 8,
    /** Time drains by timeBudget / stages every stage, so it runs low near the end whatever the length. */
    timeBudget: 85,
    /** Qualitative labels players see instead of numbers, highest threshold first. */
    labels: {
      containment: [
        { min: 80, label: "SECURE", tone: "ok" },
        { min: 60, label: "HOLDING", tone: "ok" },
        { min: 40, label: "UNSTABLE", tone: "warn" },
        { min: 20, label: "FAILING", tone: "danger" },
        { min: 0, label: "BREACHED", tone: "danger" },
      ],
      facility: [
        { min: 75, label: "STABLE", tone: "ok" },
        { min: 50, label: "STRAINED", tone: "warn" },
        { min: 25, label: "DAMAGED", tone: "danger" },
        { min: 0, label: "COLLAPSING", tone: "danger" },
      ],
      personnel: [
        { min: 75, label: "SAFE", tone: "ok" },
        { min: 50, label: "AT RISK", tone: "warn" },
        { min: 25, label: "ENDANGERED", tone: "danger" },
        { min: 0, label: "CRITICAL", tone: "danger" },
      ],
      resources: [
        { min: 70, label: "AMPLE", tone: "ok" },
        { min: 40, label: "LIMITED", tone: "warn" },
        { min: 15, label: "SCARCE", tone: "danger" },
        { min: 0, label: "DEPLETED", tone: "danger" },
      ],
      information: [
        { min: 75, label: "CLEAR", tone: "ok" },
        { min: 50, label: "PARTIAL", tone: "warn" },
        { min: 25, label: "POOR", tone: "danger" },
        { min: 0, label: "NONE", tone: "danger" },
      ],
      time: [
        { min: 70, label: "AMPLE", tone: "ok" },
        { min: 40, label: "PRESSING", tone: "warn" },
        { min: 15, label: "CRITICAL", tone: "danger" },
        { min: 0, label: "EXPIRED", tone: "danger" },
      ],
      chaos: [
        { min: 80, label: "UNHINGED", tone: "danger" },
        { min: 60, label: "HIGH", tone: "danger" },
        { min: 40, label: "ELEVATED", tone: "warn" },
        { min: 20, label: "LOW", tone: "ok" },
        { min: 0, label: "CALM", tone: "ok" },
      ],
    } as Record<StatId, StatLabel[]>,
  },

  /** How hard an incident starts. Summed, then noise, then the lucky/bad-day rolls. */
  difficulty: {
    classificationInfluence: 1,
    classification: { COSMIC: 16, CONSTRICTED: 10, EARTHLY: 6, LOCAL: 0, NEUTRALIZED: -6 } as Record<string, number>,
    classificationDefault: 5,
    /** Containment level stands in for how hard the containment procedures are. */
    entityDifficultyInfluence: 1,
    containment: { MINIMAL: -8, STANDARD: 0, ENHANCED: 6, MAXIMUM: 12, TERMINATION: 18 } as Record<string, number>,
    containmentDefault: 4,
    /** Longer procedures (more sentences to get wrong) add a little. */
    procedurePerSentence: 1.5,
    procedureMax: 6,
    /** Uniform-ish spread (±) so the same entity starts differently every time. */
    noise: 14,
    /** A dangerous entity sometimes gets a manageable start... */
    luckyBreakChance: 0.12,
    luckyBreakFactor: 0.3,
    /** ...and a harmless one sometimes gets a terrible day. */
    badDayChance: 0.12,
    badDayBonus: 20,
    /** How strongly difficulty pulls the starting stats down. */
    statImpact: 0.7,
  },

  facility: {
    /** Chance each system starts damaged, before difficulty. */
    degradeChance: 0.14,
    degradePerDifficulty: 0.006,
    /** Of damaged systems, the share that are fully offline rather than degraded. */
    offlineShare: 0.35,
  },

  unknownEntity: {
    /** Chance an incident starts with ENTITY: UNKNOWN. */
    chance: 0.25,
    /** Information at or above this lets a successful investigation identify it... */
    identifyInformationAt: 40,
    /** ...and a brilliant one identifies it regardless. */
    identifyOnCritical: true,
    /** Or it is identified anyway once information reaches this. */
    autoIdentifyAt: 75,
  },

  personnel: {
    /** Real CPI Database personnel pulled in, when any exist. */
    canonMax: 2,
    generatedMin: 2,
    generatedMax: 4,
    allowDeath: true,
    maxChangesPerStage: 3,
  },

  /** Entity-specific incident rules (content.ts ENTITY_RULES) weigh this much against a general breach type. */
  entityRules: { breachWeight: 3 },

  randomness: {
    baseSuccess: 0.5,
    minSuccess: 0.08,
    maxSuccess: 0.9,
    /** Share of the success band that is a critical success. */
    critShare: 0.22,
    /** Band just past success that is a partial success. */
    partialBand: 0.18,
    catastropheBase: 0.04,
    catastrophePerChaos: 0.06,
    /** Chance of an unexpected side effect, rising with chaos. */
    twistBase: 0.08,
    twistPerChaos: 0.25,
  },

  approach: {
    careful: { success: 0.06, catastrophe: -0.04, chaos: -2, magnitude: 0.9, lifeRisk: -0.04 },
    standard: { success: 0, catastrophe: 0, chaos: 0, magnitude: 1, lifeRisk: 0 },
    reckless: { success: -0.05, catastrophe: 0.06, chaos: 4, magnitude: 1.15, lifeRisk: 0.08 },
  } as Record<Approach, { success: number; catastrophe: number; chaos: number; magnitude: number; lifeRisk: number }>,

  roleInfluence: { strongBonus: 0.15, weakPenalty: 0.07, wildcardSpread: 0.18 },
  /** Success chance lost per point of incident difficulty. */
  entityInfluence: { perDifficulty: 0.003 },
  /** Success chance per point the tag's related stat sits above or below 50. */
  stateInfluence: { perPoint: 0.002 },
  /** Which stat helps or hurts each kind of action. OTHER leans on chaos: chaos favours the weird. */
  tagDependsOn: {
    CONTAIN: "containment",
    EVACUATE: "personnel",
    INVESTIGATE: "information",
    COMMUNICATE: "information",
    DEPLOY: "resources",
    EQUIPMENT: "resources",
    STRATEGIZE: "time",
    OTHER: "chaos",
  } as Record<ResponseTag, StatId>,

  analysis: {
    /** Success lost per extra action crammed into one response. */
    overloadPenalty: 0.05,
    maxActions: 5,
    /** Success gained per distinct reference to this incident (people, places, systems)... */
    groundingBonus: 0.03,
    /** ...up to this many. Specificity helps a little; name-dropping doesn't stack. */
    groundingMax: 2,
    /** Success lost for repeating your previous action type. */
    repeatPenalty: 0.05,
  },

  sacrifice: { successBonus: 0.12, lifeRisk: 0.35 },

  lifeRisk: {
    critical: 0,
    success: 0.02,
    partial: 0.03,
    failure: 0.15,
    catastrophe: 0.45,
    /** Everyone, acting or not, has a small chance of being caught up in it. */
    hazardBase: 0.02,
    hazardPersonnel: 0.04,
    hazardChaos: 0.03,
    /** Standing around doing nothing during a breach is not safe either. */
    idleExtra: 0.03,
  } as Record<Outcome, number> & { hazardBase: number; hazardPersonnel: number; hazardChaos: number; idleExtra: number },

  severity: {
    magnitude: 1,
    /** Largest change one action can make to one stat, before magnitude. */
    maxStatDeltaPerAction: 18,
    /** Largest change the whole crew can make to one stat in one stage. */
    maxStatDeltaPerStage: 30,
    outcomeMultiplier: { critical: 1.5, success: 1, partial: 0.4, failure: -0.6, catastrophe: -1.2 } as Record<Outcome, number>,
  },

  /** The default effect of each kind of action at success, before outcome and approach. */
  tagEffects: {
    CONTAIN: { containment: 14, facility: 2 },
    EVACUATE: { personnel: 11, time: -2 },
    INVESTIGATE: { information: 13 },
    COMMUNICATE: { information: 7, personnel: 4 },
    DEPLOY: { containment: 8, personnel: 4 },
    EQUIPMENT: { resources: 7, facility: 6 },
    STRATEGIZE: { time: 7, information: 4 },
    OTHER: { containment: 4, information: 4 },
  } as Record<ResponseTag, Partial<Stats>>,

  interactions: {
    /** Tag pairs that pull against each other when two agents do them in the same stage. */
    conflicts: [
      ["CONTAIN", "EVACUATE"],
      ["DEPLOY", "EVACUATE"],
      ["INVESTIGATE", "DEPLOY"],
    ] as [ResponseTag, ResponseTag][],
    /** Chance a conflicting pair sabotages rather than accidentally helps. */
    sabotageChance: 0.5,
    /** Two or more agents doing the same thing coordinate: a small boost each. */
    synergyBonus: 0.06,
    maxPerStage: 2,
  },

  chaos: {
    outcome: { critical: -5, success: -3, partial: 0, failure: 3, catastrophe: 8 } as Record<Outcome, number>,
    twist: 5,
    conflict: 3,
    /** Every stage things settle a little on their own. */
    stageDrift: -4,
    specialEvent: 4,
    newProblem: 3,
    objectiveCompleted: -4,
    /** Largest chaos change the director may add or remove per action. */
    directorMax: 8,
    /** Higher chaos widens every outcome's spread by up to this much. */
    varianceAtMax: 0.12,
  },

  specialEvents: { base: 0.1, perChaos: 0.45, max: 0.7 },

  newProblems: { base: 0.15, perChaos: 0.25, lowStatBonus: 0.12, lowStatAt: 25, maxActiveSecondary: 4 },

  anomalies: { maxActive: 2 },

  reveals: {
    /** Each discovery also improves the information picture this much. */
    informationPerReveal: 4,
    /** Facts one successful action can uncover. */
    perSuccess: 1,
    maxPerStage: 3,
    /** New game-only facts the director may invent per stage. */
    maxGeneratedPerStage: 2,
  },

  objectives: { secondaryMin: 1, secondaryMax: 3, maxNewPerStage: 1 },

  endings: {
    /** Containment at or above this ends the incident as contained... */
    containedAt: 80,
    /** ...but not before this stage: the incident always gets room to develop. */
    minStage: 3,
    /** Everyone dies when personnel safety collapses this far (or every agent goes down at once). */
    everyoneDies: { personnelAtOrBelow: 5 },
    termination: {
      baseChance: 0.3,
      byContainment: { TERMINATION: 0.25, MAXIMUM: -0.05 } as Record<string, number>,
      byClassification: { COSMIC: -0.2, NEUTRALIZED: 0.15 } as Record<string, number>,
      minContainment: 45,
    },
  },

  scoring: {
    participation: 8,
    /** Harm counts against help at negativeWeight; bringing chaos down counts at stabilizePerPoint. */
    impact: { perPoint: 1.6, negativeWeight: 0.5, stabilizePerPoint: 1, stageCap: 45 },
    /** Chaos only scores when the action actually changed something. */
    chaos: { perPoint: 0.8, stageCap: 20, requireConsequence: 6 },
    creativity: { points: { standard: 0, inventive: 10, wild: 18 } as Record<Novelty, number>, stageCap: 18, gameCap: 60 },
    role: { byOutcome: { critical: 15, success: 12, partial: 8, failure: 4, catastrophe: 2 } as Record<Outcome, number>, stageCap: 15 },
    votes: { perVote: 15, stageCap: 45 },
    sacrifice: { points: 30, perGame: 1 },
    team: {
      ending: { contained: 120, terminated: 100, escaped: 30, everyone_dies: 0 } as Record<EndingId, number>,
      primaryObjective: 50,
      perSecondary: 20,
    },
    /** Optional flat reward for ending a stage in high chaos (Chaos Mode turns it on). */
    highChaosBonus: { enabled: false, atOrAbove: 70, points: 15 },
  },

  voting: { enabled: true },

  awards: { enabled: true, nameMax: 40, descriptionMax: 100, perPlayer: 1, allowSelfVote: false },

  narration: { maxLength: 900, summaryMax: 180, infoMax: 200, objectiveMax: 90 },
};

export type Novelty = "standard" | "inventive" | "wild";
export const NOVELTIES: readonly Novelty[] = ["standard", "inventive", "wild"];

export type MyCobConfig = typeof DEFAULT_MYCOB_CONFIG;

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type ConfigOverrides = DeepPartial<MyCobConfig>;

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merges plain objects; arrays and scalars in an override replace the base value. */
export function resolveConfig(base: MyCobConfig, ...overrides: (ConfigOverrides | undefined)[]): MyCobConfig {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!isPlain(a) || !isPlain(b)) return b === undefined ? a : b;
    const out: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) out[key] = merge(a[key], value);
    return out;
  };
  return overrides.reduce<MyCobConfig>((acc, o) => (o ? (merge(acc, o) as MyCobConfig) : acc), base);
}

// ------------------------------------------------------------------ modes

export type ModeId = "incident_response" | "made_it_worse" | "incident_report" | "choose_response" | "field_operative" | "chaos_mode";

export interface ModeDef {
  id: ModeId;
  name: string;
  emoji: string;
  tagline: string;
  /** Unavailable modes are listed in the lobby but can't be selected yet. */
  available: boolean;
  /** Mode-specific rules, as config. */
  overrides: ConfigOverrides;
}

// Every mode runs on the same incident engine. A mode that needs more than config (a different
// response form, a different stage loop) adds its rule hooks in game.ts, keyed by mode id.
export const MODES: readonly ModeDef[] = [
  {
    id: "incident_response",
    name: "Incident Response",
    emoji: "🚨",
    tagline: "Something got out. Figure out what to do about it, together-ish.",
    available: true,
    overrides: {},
  },
  {
    id: "chaos_mode",
    name: "Chaos Mode",
    emoji: "🔀",
    tagline: "Incident Response with the safety rails removed. Chaos pays.",
    available: true,
    overrides: {
      stats: { start: { containment: 55, facility: 65, personnel: 65, resources: 60, information: 35, time: 100, chaos: 50 } },
      specialEvents: { base: 0.25, perChaos: 0.55, max: 0.85 },
      newProblems: { base: 0.3 },
      unknownEntity: { chance: 0.5 },
      scoring: { highChaosBonus: { enabled: true } },
    },
  },
  {
    id: "made_it_worse",
    name: "You Made It Worse",
    emoji: "💥",
    tagline: "Every stage, someone's bright idea is the new problem.",
    available: false,
    overrides: {},
  },
  {
    id: "incident_report",
    name: "Incident Report",
    emoji: "📋",
    tagline: "The incident is over. Now explain it to the Records Division.",
    available: false,
    overrides: {},
  },
  {
    id: "choose_response",
    name: "Choose Your Response",
    emoji: "🎯",
    tagline: "Pick from the options. The options are all bad.",
    available: false,
    overrides: {},
  },
  {
    id: "field_operative",
    name: "CPST Field Operative",
    emoji: "🥽",
    tagline: "One agent goes in. Everyone else talks them through it.",
    available: false,
    overrides: {},
  },
];

export function modeById(id: string): ModeDef | undefined {
  return MODES.find((m) => m.id === id);
}
