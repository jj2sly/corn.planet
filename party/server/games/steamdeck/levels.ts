// The games inside Thad's Steam Deck. Each level is a different "game" the Deck is running; a match
// opens with the first one here (Level 1) and plays the rest in a random order. World units: 1600 ×
// 900 unless a level says otherwise (`size`), y down. Rects are [x, y, w, h]. Every level can be
// escaped without a plank; planks make the short routes possible.
//
// Beyond platforms and hazards, a level can have water (swim: jump strokes up, jump at the surface
// leaps out, too long under drowns you), items to collect (the exit stays shut until the team has
// found them all), a stalker (someone who appears near a runner and takes them if they linger), and
// intro lines the Deck shows while the game loads. A bigger level can also have its own play time,
// checkpoints (touch one and you respawn there), low-gravity zones, and an exit you have to *use*
// (press ▼ in it) once it's active, which sets off a short collapse before the level is complete.
// What it all looks like is up to the screens (public/js/games/steamdeck-scenery.js); this file is
// only what's where.

export type Rect = [number, number, number, number];
export type Phase = "ESCAPE" | "ESCALATION" | "FINAL";

export interface Hazard {
  rect: Rect;
  /** Active from this phase on. */
  from: Phase;
  /** How it's drawn: it kills the same either way. */
  kind?: "spikes" | "lava" | "thorns" | "glitch";
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

export interface Checkpoint {
  id: string;
  name: string;
  /** Where you stand: the middle of the floor under it. Touch it and you respawn here. */
  at: [number, number];
}

/** Somewhere physics half-works: gravity there is multiplied by `gravity`. */
export interface Zone {
  rect: Rect;
  gravity: number;
}

export interface Level {
  id: string;
  name: string;
  tagline: string;
  /** What the Deck says while the game loads. */
  intro: string[];
  /** World size, [width, height]: 1600 × 900 by default. Bigger levels scroll. */
  size?: [number, number];
  /** Play time per phase, when a level needs more than the standard 35 + 25 + 15 s. */
  timing?: { escapeMs: number; escalationMs: number; finalMs: number };
  spawn: [number, number];
  exit: Rect;
  platforms: Rect[];
  hazards: Hazard[];
  water?: Rect[];
  items?: Item[];
  /** What the items are called on screen, e.g. "CORRUPTED FRAGMENTS" (default "DECK PARTS"). */
  itemLabel?: string;
  stalker?: Stalker;
  checkpoints?: Checkpoint[];
  zones?: Zone[];
  /**
   * The exit has to be used: once it's open, a runner standing in it presses ▼. That completes the
   * level for the team and sets off the collapse: `collapseMs` for everyone else to dive in.
   */
  exitUse?: { collapseMs: number };
}

export const WORLD = { width: 1600, height: 900 } as const;

/** A level's world size. */
export function sizeOf(level: Level): { width: number; height: number } {
  return level.size ? { width: level.size[0], height: level.size[1] } : { width: WORLD.width, height: WORLD.height };
}

/** Where a checkpoint puts you back: standing on its floor, centred on it. */
export function checkpointSpawn(c: Checkpoint): [number, number] {
  return [c.at[0] - 14, c.at[1] - 38];
}

/** A checkpoint's touch box. */
export function checkpointRect(c: Checkpoint): Rect {
  return [c.at[0] - 30, c.at[1] - 64, 60, 64];
}

// ------------------------------------------------------------------ Level 1: The Block World

// A ground column: from `y` all the way to the bottom of the Block World.
const BOTTOM = 2000;
const col = (x: number, y: number, w: number): Rect => [x, y, w, BOTTOM - y];

/**
 * The Deck launched a block-building game, and the world is coming apart. Five areas, left to right
 * (and down, and up): the plains where you spawn, Blockton village, the mine and the cave under it,
 * the corrupted chunks floating over the void, and the rift at the edge of the world. Three corrupted
 * fragments (the village's watchtower, the bottom of the cave lake, the highest corrupted chunk) wake
 * the rift; then someone has to go in.
 */
const BLOCK_WORLD: Level = {
  id: "blockworld",
  name: "The Block World",
  tagline: "Punch trees. Find 3 fragments. Leave through the hole in the world.",
  intro: [
    "BLOCKCRAFT · loading world \"THAD\"… 3 errors",
    "Find the 3 corrupted fragments. The rift at the edge of the world opens when you have them all.",
    "Then get in it: ▼ (or ↓ / S) at the rift.",
  ],
  size: [6400, 2000],
  timing: { escapeMs: 70_000, escalationMs: 50_000, finalMs: 40_000 },
  spawn: [80, 1190],
  exit: [6150, 580, 120, 180],
  exitUse: { collapseMs: 12_000 },
  platforms: [
    // ---- the plains: a hill, a pond, a chunk that didn't load
    col(0, 1240, 560),
    col(560, 1200, 160),
    col(720, 1160, 200),
    col(920, 1200, 120),
    col(1040, 1240, 80),
    [1120, 1290, 260, 710], // the pond's bed: a paddling pond, too shallow to drown in
    col(1380, 1240, 180),
    // floating blocks over the hill: the sky stash (optional)
    [830, 1060, 80, 40],
    [970, 960, 80, 40],
    [1110, 880, 140, 40],
    [1180, 1080, 40, 40],
    [1300, 1040, 40, 40],
    // ---- Blockton village
    col(1680, 1240, 920),
    [2650, 1200, 40, 40], // a crate by the farm
    [3140, 1200, 40, 40], // a hay bale by the barn
    // the watchtower: a zig-zag of floors up to the lookout (fragment 1)
    [3180, 1140, 90, 20],
    [3240, 1040, 90, 20],
    [3160, 940, 90, 20],
    [3220, 840, 110, 20],
    // the crust over the cave, the mine shaft through it, and the world border past the village
    [2600, 1240, 740, 160],
    [3460, 1240, 60, 160],
    [3520, 160, 80, 1240],
    [3600, 1240, 1100, 160],
    // ---- the mine shaft down, and the cave
    [3340, 1330, 60, 20],
    [3400, 1420, 60, 20],
    [3340, 1510, 60, 20],
    [2600, 1400, 600, 600], // solid rock west of the cave
    [3200, 1600, 840, 400], // the mine camp and the passage
    [3720, 1400, 320, 150], // the passage's low ceiling
    [4040, 1700, 120, 300],
    [4160, 1890, 140, 110], // under the lava
    [4300, 1700, 60, 300],
    [4360, 1940, 320, 60], // the lake bed
    [4480, 1400, 60, 420], // the rock the lake goes under
    [4680, 1700, 220, 300], // the east bank
    // the climb out
    [4840, 1610, 60, 20],
    [4760, 1520, 60, 20],
    [4840, 1430, 60, 20],
    [4760, 1340, 60, 20],
    [4840, 1250, 60, 20],
    // ---- the corrupted chunks, floating over nothing
    col(4900, 1160, 280), // the last stable chunk
    [5240, 1100, 170, 60],
    [5470, 1020, 150, 60],
    [5660, 880, 140, 40],
    [5850, 720, 130, 40],
    [5660, 540, 140, 40], // fragment 3
    // ---- the rift at the edge of the world
    [6060, 760, 280, 40],
    [6340, 0, 60, 2000],
  ],
  water: [
    [1120, 1256, 260, 34],
    [4360, 1720, 320, 220],
  ],
  hazards: [
    // A chunk that never loaded: fall in and you're deleted.
    { rect: [1560, 1320, 120, 680], from: "ESCAPE", kind: "glitch" },
    { rect: [4160, 1860, 140, 30], from: "ESCAPE", kind: "lava" },
    // The corruption spreads: dead blocks appear on the chunks (hop them), lava creeps into the cave.
    { rect: [5320, 1064, 30, 36], from: "ESCALATION", kind: "glitch" },
    { rect: [4300, 1680, 30, 20], from: "ESCALATION", kind: "lava" },
    { rect: [5730, 844, 30, 36], from: "ESCALATION", kind: "glitch" },
    { rect: [4480, 1932, 60, 8], from: "FINAL", kind: "lava" },
    { rect: [5540, 984, 30, 36], from: "FINAL", kind: "glitch" },
    { rect: [6100, 724, 30, 36], from: "FINAL", kind: "glitch" },
  ],
  items: [
    { id: "village", name: "VILLAGE FRAGMENT", at: [3290, 815] },
    { id: "cave", name: "CAVE FRAGMENT", at: [4630, 1905] },
    { id: "chunks", name: "CORRUPTED FRAGMENT", at: [5730, 515] },
  ],
  itemLabel: "CORRUPTED FRAGMENTS",
  checkpoints: [
    { id: "village", name: "BLOCKTON VILLAGE", at: [2380, 1240] },
    { id: "mine", name: "MINE CAMP", at: [3300, 1600] },
    { id: "chunk", name: "LAST STABLE CHUNK", at: [4980, 1160] },
  ],
  zones: [{ rect: [5560, 340, 460, 780], gravity: 0.35 }],
};

export const LEVELS: readonly Level[] = [
  BLOCK_WORLD,
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
