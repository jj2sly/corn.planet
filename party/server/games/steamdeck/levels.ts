// The games inside Thad's Steam Deck. Each level is a different "game" the Deck is running; a match
// plays some of them in a random order. World units: 1600 × 900, y down. Rects are [x, y, w, h].
// Every level can be escaped without a plank; planks make the short routes possible.
//
// Beyond platforms and hazards, a level can have water (swim: jump strokes up, jump at the surface
// leaps out, too long under drowns you), items to collect (the exit stays shut until the team has
// found them all), a stalker (someone who appears near a runner and takes them if they linger), and
// intro lines the Deck shows while the game loads. What they look like is up to the screens
// (public/js/games/steamdeck-scenery.js); this file is only what's where.

export type Rect = [number, number, number, number];
export type Phase = "ESCAPE" | "ESCALATION" | "FINAL";

export interface Hazard {
  rect: Rect;
  /** Active from this phase on. */
  from: Phase;
  /** How it's drawn: it kills the same either way. */
  kind?: "spikes" | "lava" | "thorns";
}

export interface Item {
  id: string;
  name: string;
  /** Centre of the item. */
  at: [number, number];
}

export interface Stalker {
  /** First appearance, ms into play. */
  firstMs: number;
  /** How often he moves, by phase. */
  everyMs: Record<Phase, number>;
  /** Stay within this distance of him for `killMs` and he takes you. */
  reach: number;
  killMs: Record<Phase, number>;
}

export interface Level {
  id: string;
  name: string;
  tagline: string;
  /** What the Deck says while the game loads. */
  intro: string[];
  spawn: [number, number];
  exit: Rect;
  platforms: Rect[];
  hazards: Hazard[];
  water?: Rect[];
  items?: Item[];
  stalker?: Stalker;
}

export const WORLD = { width: 1600, height: 900 } as const;

export const LEVELS: readonly Level[] = [
  {
    // Blocks, lava, a lake with a stone wall you have to swim under, and a portal out.
    id: "blockcraft",
    name: "Blockcraft",
    tagline: "Punch trees. Avoid lava. Find the portal.",
    intro: ["Generating terrain…", "Tip: water is fine. Lava is not.", "The wall goes into the lake: swim under it (mash JUMP to swim up)."],
    spawn: [60, 670],
    exit: [1520, 410, 70, 100],
    platforms: [
      [0, 720, 380, 180],
      [440, 640, 40, 40],
      [540, 720, 260, 180],
      [800, 860, 380, 40],
      [960, 330, 60, 450],
      [1180, 720, 230, 180],
      [1420, 610, 70, 40],
      [1500, 510, 100, 390],
    ],
    water: [[800, 740, 380, 120]],
    hazards: [
      { rect: [380, 840, 160, 60], from: "ESCAPE", kind: "lava" },
      { rect: [1410, 840, 90, 60], from: "ESCAPE", kind: "lava" },
      // Later, lava creeps onto the shore (jump it, straight into the lake), then the lake floor
      // under the wall turns to magma: swim through, don't sink through.
      { rect: [730, 700, 50, 20], from: "ESCALATION", kind: "lava" },
      { rect: [970, 852, 40, 8], from: "FINAL", kind: "lava" },
    ],
  },
  {
    // Dark woods, six pieces of Thad's Deck, and someone tall who keeps showing up.
    id: "slim",
    name: "SLIM: The Six Parts",
    tagline: "Find all six parts of Thad's Deck. Don't let him get close.",
    intro: ["SLIM.exe · screen brightness 3%", "Thad's Deck is in six pieces. Find them all to open the dock.", "He takes you if you stay near him. Keep moving."],
    spawn: [60, 740],
    exit: [760, 680, 70, 100],
    platforms: [
      [0, 780, 1600, 120],
      [100, 680, 160, 24],
      [560, 680, 160, 24],
      [1000, 680, 160, 24],
      [1380, 680, 160, 24],
      [260, 580, 160, 24],
      [760, 580, 160, 24],
      [1180, 580, 160, 24],
      [60, 480, 180, 24],
      [480, 480, 160, 24],
      [980, 480, 160, 24],
      [1400, 480, 180, 24],
      [260, 380, 160, 24],
      [720, 380, 200, 24],
      [1180, 380, 160, 24],
      [480, 280, 140, 24],
      [980, 280, 140, 24],
    ],
    hazards: [
      { rect: [380, 760, 60, 20], from: "ESCAPE", kind: "thorns" },
      { rect: [1240, 760, 60, 20], from: "ESCALATION", kind: "thorns" },
      { rect: [900, 760, 50, 20], from: "FINAL", kind: "thorns" },
    ],
    items: [
      { id: "lstick", name: "LEFT STICK", at: [150, 450] },
      { id: "screen", name: "SCREEN", at: [550, 250] },
      { id: "battery", name: "BATTERY", at: [1560, 750] },
      { id: "fan", name: "FAN", at: [1050, 250] },
      { id: "rstick", name: "RIGHT STICK", at: [1490, 450] },
      { id: "ssd", name: "SSD", at: [1080, 650] },
    ],
    stalker: {
      firstMs: 5_000,
      everyMs: { ESCAPE: 6_000, ESCALATION: 4_500, FINAL: 3_000 },
      reach: 150,
      killMs: { ESCAPE: 1_600, ESCALATION: 1_300, FINAL: 1_000 },
    },
  },
  {
    id: "firekid",
    name: "Fire Kid & Ice Girl",
    tagline: "Fire kids only. Ice girls also only. It's complicated.",
    intro: ["Loading Fire Kid & Ice Girl…", "Nobody here can swim. The pits are not water."],
    spawn: [60, 710],
    exit: [1500, 360, 70, 100],
    platforms: [
      [0, 760, 360, 140],
      [760, 700, 260, 200],
      [470, 600, 90, 24],
      [620, 520, 70, 24],
      [1120, 580, 200, 30],
      [1400, 460, 200, 440],
      // Stepping stones: without them the slower cast can't make the climbs.
      [380, 680, 60, 24],
      [1040, 630, 50, 24],
      [1340, 520, 50, 24],
    ],
    hazards: [
      { rect: [360, 860, 400, 40], from: "ESCAPE", kind: "lava" },
      { rect: [1020, 860, 380, 40], from: "ESCAPE", kind: "lava" },
      { rect: [840, 676, 80, 24], from: "ESCALATION" },
      { rect: [1170, 556, 60, 24], from: "FINAL" },
    ],
  },
  {
    id: "astro",
    name: "Astro Blaster '84",
    tagline: "INSERT COIN. You have no coins.",
    intro: ["INSERT COIN", "Achievement: you have 0 coins", "Climb to the exit before the machine eats you."],
    spawn: [60, 770],
    exit: [1480, 100, 70, 100],
    platforms: [
      [0, 820, 500, 80],
      [560, 700, 200, 24],
      [860, 600, 200, 24],
      [560, 480, 200, 24],
      [240, 380, 220, 24],
      [560, 280, 260, 24],
      [920, 240, 180, 24],
      [1200, 200, 400, 24],
    ],
    hazards: [
      { rect: [500, 860, 1100, 40], from: "ESCAPE" },
      { rect: [640, 676, 60, 24], from: "ESCALATION" },
      { rect: [1250, 176, 60, 24], from: "FINAL" },
    ],
  },
];

const ORDER: Phase[] = ["ESCAPE", "ESCALATION", "FINAL"];

export function hazardActive(hazard: Hazard, phase: Phase): boolean {
  return ORDER.indexOf(phase) >= ORDER.indexOf(hazard.from);
}
