// Angry Thud's Revenge: every number worth tuning, in one place. Playtest, then change these, not
// the game code. docs/THUD.md explains each group and why it starts where it does.

export const WORLD = { width: 2400, height: 1000, groundY: 900, gravity: 760 } as const;

export const TIMING = {
  /** Picking birds and skins (ends as soon as everyone is ready). */
  selectMs: 45_000,
  /** The handheld launching the game. */
  launchMs: 8_000,
  buildMs: 120_000,
  aimMs: 25_000,
  /** How long a turn waits for someone to donate a bird to a player who has none. */
  needBirdMs: 15_000,
  /** A shot ends when everything settles, or at this at the latest. */
  flightMaxMs: 12_000,
  /** Piggy processing: each step shows at least this long. */
  stepMs: 2_200,
  /** A step with physics (bombs, a tornado, an earthquake) runs at most this long. */
  stepSimMaxMs: 6_000,
  cowMs: 4_500,
  overMs: 40_000,
  tickMs: 50,
  /** Physics steps per tick (120 Hz). */
  substeps: 6,
} as const;

export const SLINGSHOT = {
  /** Where the band's pouch rests, and how far it may be pulled. */
  x: 470,
  y: 700,
  maxSpeed: 1150,
  minPower: 0.15,
  /** Degrees above the horizon (negative: down). */
  minAngle: -35,
  maxAngle: 80,
  /** The rock it stands on (static). */
  pedestal: { x: 470, w: 90, top: 740 },
} as const;

// ------------------------------------------------------------------ economy (one shared pool)

export const ECONOMY = {
  startKernels: 60,
  rewards: {
    pigHit: 2,
    /** Per block destroyed, by material (see MATERIALS.kernels). A chained break adds this: */
    chain: 4,
    /** Three or more piggies in one shot. */
    multikill: 10,
  },
  /** A bird straight from the crate, for when you can't wait for a nest. */
  birdCrate: 30,
  breed: 10,
  /** Fixing a broken Weather Machine: this share of its tier's price. */
  weatherRepairShare: 0.5,
} as const;

export const BIRDS_START = 3;
export const BIRDS_MAX_HELD = 9;

/**
 * Buildings. `cost` in kernels; `hp`; size in world units (they sit on the ground). `max` per team.
 * Add a kind here and in thud-rules.js / the renderer, and it's buildable.
 */
export const BUILDINGS = {
  nest: { name: "Bird Nest", cost: 45, hp: 120, w: 76, h: 44, max: 4, material: "nest", blurb: "Hatches a bird every 1.5 turns. Two agents at one nest: an extra bird." },
  wall: { name: "Husk Wall", cost: 12, hp: 90, w: 22, h: 130, max: 12, material: "wood", blurb: "Cheap and tall. Stops cob bombs." },
  barricade: { name: "Stone Barricade", cost: 25, hp: 230, w: 56, h: 96, max: 8, material: "stone", blurb: "Heavy. Shrugs off bombs and weather." },
  shield: { name: "Kernel Shield", cost: 35, hp: 80, w: 40, h: 50, max: 2, material: "metal", blurb: "A dome that soaks damage for everything under it. Recharges every turn." },
  clone: { name: "Clone Tank", cost: 30, hp: 70, w: 44, h: 72, max: 3, material: "glass", blurb: "One use: copies the bird you have selected." },
  weather: { name: "Weather Machine", cost: 20, hp: 90, w: 48, h: 96, max: 1, material: "metal", blurb: "Predicts the weather. Upgrade it to see further." },
} as const;

export type BuildingKind = keyof typeof BUILDINGS;

export const SHIELD = { radius: 150, chargePerTurn: 90 } as const;

export const NEST = {
  /**
   * "turn": each nest gains `perTurn` of a bird at the end of every turn (1 / 1.5 = a bird every
   * 1.5 turns). "time": a bird every `everyMs` of build and action time. Same nests either way.
   */
  production: { mode: "turn" as "turn" | "time", perTurn: 1 / 1.5, everyMs: 45_000 },
  /** Breeding: two different agents at one nest in a build phase. Once per nest per build phase. */
  breedsPerBuild: 1,
} as const;

// ------------------------------------------------------------------ weather machines

export const WEATHER_TIERS = [
  { tier: 1, name: "Weather Radio", price: 20, hp: 90, h: 80, accuracy: 0.55, window: 1, shows: "category", exactTurn: false, severity: false, secondary: false, mitigation: 0 },
  { tier: 2, name: "Weather Scanner", price: 30, hp: 110, h: 96, accuracy: 0.8, window: 1, shows: "type", exactTurn: false, severity: true, secondary: false, mitigation: 0 },
  { tier: 3, name: "Forecasting Array", price: 45, hp: 130, h: 112, accuracy: 0.92, window: 1, shows: "type", exactTurn: true, severity: true, secondary: true, mitigation: 0 },
  { tier: 4, name: "CPI Weather Management System", price: 60, hp: 160, h: 132, accuracy: 0.97, window: 3, shows: "type", exactTurn: true, severity: true, secondary: true, mitigation: 0 },
] as const;
// `mitigation` is for later: a tier that softens (or redirects) what it predicts. 0 = forecasts only.

// ------------------------------------------------------------------ piggies and their fortress

export const PIGS = {
  basic: { name: "Corn Piggy", r: 20, hp: 28, points: 100, kernels: 10, corruption: 8, lobs: 1 },
  armored: { name: "Armored Piggy", r: 22, hp: 75, points: 150, kernels: 14, corruption: 11, lobs: 1 },
  builder: { name: "Builder Piggy", r: 20, hp: 36, points: 150, kernels: 14, corruption: 10, lobs: 0, repairBonus: 0.1, reinforce: 1 },
  shield: { name: "Shield Piggy", r: 21, hp: 45, points: 175, kernels: 14, corruption: 10, lobs: 0, shieldRadius: 170, shieldFactor: 0.5 },
  corruptor: { name: "Corruptor Piggy", r: 21, hp: 48, points: 200, kernels: 18, corruption: 15, lobs: 0, perTurn: 2.5 },
  boss: { name: "THUD", r: 46, hp: 420, points: 600, kernels: 45, corruption: 28, lobs: 2, summons: 1 },
} as const;

export type PigKind = keyof typeof PIGS;

/** Piggies take this much more damage than blocks from the same hit (they're soft). */
export const PIG_DAMAGE = 1.5;

/**
 * Materials: physics (density per 1000 sq units, friction, restitution), health for a 2400 sq unit
 * block (bigger blocks get more), and what breaking one is worth: corruption, kernels, points.
 */
export const MATERIALS = {
  wood: { density: 0.6, friction: 0.7, restitution: 0.1, hp: 48, corruption: 0.5, kernels: 2, points: 12 },
  glass: { density: 0.45, friction: 0.35, restitution: 0.1, hp: 18, corruption: 0.25, kernels: 1, points: 8 },
  stone: { density: 1.4, friction: 0.8, restitution: 0.05, hp: 120, corruption: 0.8, kernels: 3, points: 20 },
  metal: { density: 1.8, friction: 0.6, restitution: 0.1, hp: 210, corruption: 1.1, kernels: 5, points: 30 },
  ice: { density: 0.55, friction: 0.08, restitution: 0.1, hp: 26, corruption: 0.3, kernels: 1, points: 10 },
  corn: { density: 0.35, friction: 0.9, restitution: 0.05, hp: 32, corruption: 0.4, kernels: 1, points: 10 },
  barrel: { density: 0.6, friction: 0.6, restitution: 0.1, hp: 14, corruption: 0.5, kernels: 3, points: 25 },
  vault: { density: 0.9, friction: 0.7, restitution: 0.05, hp: 60, corruption: 3, kernels: 30, points: 200 },
  totem: { density: 1.1, friction: 0.7, restitution: 0.05, hp: 90, corruption: 7, kernels: 12, points: 200 },
  nest: { density: 1.2, friction: 0.8, restitution: 0.05, hp: 120, corruption: 0, kernels: 0, points: 0 },
} as const;

export type MaterialId = keyof typeof MATERIALS;

/** Damage from a hit: (impulse − threshold) × perImpulse. Impulse = effective mass × closing speed. */
export const DAMAGE = { threshold: 110, perImpulse: 0.05 } as const;

/** Corn oil barrels go off when they break. */
export const BARREL = { radius: 150, push: 720, damage: 55 } as const;

export const REPAIR = {
  /** Share of the turn's structural damage the piggies put back after every turn. */
  pct: 0.75,
  max: 1,
} as const;

export const CORRUPTION = {
  start: 100,
  /**
   * Fewer agents fire fewer birds per turn; corruption each hit removes scales so every team size
   * has a chance: × clamp(reference / agents, min, max).
   */
  playerScale: { reference: 3.5, min: 0.55, max: 1.3 },
  /**
   * A reinforcement brings this share of its own corruption value with it when it lands, so more
   * piggies are more pressure, not free points (killing it still takes all of it back off).
   */
  reinforcementShare: 0.5,
} as const;

/** Cob bombs the piggies lob at your buildings after each turn. */
export const ATTACK = { r: 11, density: 2.2, flightS: 1.7, error: 0.07, radius: 85, damage: 40, push: 420 } as const;

// ------------------------------------------------------------------ personal points (never the meter)

export const SCORING = {
  pigHit: 10,
  /** A break or kill caused by debris rather than the bird: this share extra. */
  chainBonus: 0.5,
  multikill: 150,
  longShot: 75,
  longShotDistance: 1250,
  bounceKill: 40,
  abilityHit: 25,
  donation: 40,
  breed: 20,
  clone: 10,
  build: 5,
} as const;

// ------------------------------------------------------------------ weather

export type WeatherType =
  | "wind"
  | "strong_wind"
  | "tornado"
  | "dust_storm"
  | "acid_rain"
  | "heavy_rain"
  | "hailstorm"
  | "flood"
  | "lightning_storm"
  | "thunderstorm"
  | "fog"
  | "heat_wave"
  | "earthquake";

/**
 * Per type: a category (what a Weather Radio can tell), what it does during the action phase
 * (`action`) and what it does when it strikes after the turn (`strike`). Arrays are by severity
 * (LOW, MEDIUM, HIGH). `secondary`: what can come with it.
 */
export const WEATHER = {
  wind: { label: "Wind", category: "WIND", action: { wind: [140, 230, 330] }, secondary: null },
  strong_wind: { label: "Strong Wind", category: "WIND", action: { wind: [320, 450, 600] }, secondary: null },
  tornado: { label: "Tornado", category: "WIND", strike: { radius: [150, 200, 260], lift: [650, 900, 1200], damage: [35, 60, 90] }, secondary: "wind" },
  dust_storm: { label: "Dust Storm", category: "WIND", action: { wind: [100, 160, 220], obscure: [1, 2, 3] }, secondary: null },
  acid_rain: { label: "Acid Rain", category: "RAIN", strike: { damage: [18, 30, 45] }, secondary: "wind" },
  heavy_rain: { label: "Heavy Rain", category: "RAIN", action: { slippery: [0.6, 0.45, 0.3] }, strike: { soak: [8, 14, 22] }, secondary: "wind" },
  hailstorm: { label: "Hailstorm", category: "RAIN", strike: { hits: [10, 18, 28], damage: [8, 12, 16] }, secondary: "wind" },
  flood: { label: "Flood", category: "RAIN", strike: { level: [70, 110, 150], turns: 2 }, secondary: "heavy_rain" },
  lightning_storm: { label: "Lightning Storm", category: "STORM", strike: { bolts: [2, 3, 4], damage: [40, 55, 75], disableTurns: 1 }, secondary: "wind" },
  thunderstorm: { label: "Thunderstorm", category: "STORM", action: { dark: [0.35, 0.5, 0.65] }, strike: { bolts: [1, 1, 2], damage: [35, 45, 60], disableTurns: 1 }, secondary: "heavy_rain" },
  fog: { label: "Fog", category: "HAZE", action: { fogFrom: [1500, 1300, 1100] }, secondary: null },
  heat_wave: { label: "Heat Wave", category: "HEAT", strike: { melt: [0.5, 0.8, 1], wither: [8, 14, 20] }, secondary: "dust_storm" },
  earthquake: { label: "Earthquake", category: "GROUND", strike: { seconds: [1, 1.4, 1.8], shove: [140, 210, 290] }, secondary: "dust_storm" },
} as const satisfies Record<WeatherType, { label: string; category: string; action?: object; strike?: object; secondary: WeatherType | null }>;

export const WEATHER_RULES = {
  /** LOW, MEDIUM, HIGH. */
  severityWeights: [0.5, 0.35, 0.15],
  /** Later turns lean heavier: each turn after the first adds this to the HIGH weight. */
  severityRamp: 0.03,
  secondaryChance: 0.3,
  /** How many turns ahead the schedule is drawn. */
  horizon: 40,
} as const;
