// The levels inside Thad's Steam Deck. World units: 1600 × 900, y down. Rects are [x, y, w, h].
// Every level can be escaped without a plank; planks make the short routes possible.

export type Rect = [number, number, number, number];
export type Phase = "ESCAPE" | "ESCALATION" | "FINAL";

export interface Hazard {
  rect: Rect;
  /** Active from this phase on. */
  from: Phase;
}

export interface Level {
  id: string;
  name: string;
  tagline: string;
  spawn: [number, number];
  exit: Rect;
  platforms: Rect[];
  hazards: Hazard[];
}

export const WORLD = { width: 1600, height: 900 } as const;

export const LEVELS: readonly Level[] = [
  {
    id: "home",
    name: "The Home Screen",
    tagline: "Recently played: nothing. Recently cried: you.",
    spawn: [60, 690],
    exit: [1500, 400, 70, 100],
    platforms: [
      [0, 740, 440, 160],
      [600, 740, 300, 160],
      [980, 620, 220, 40],
      [1260, 500, 340, 400],
      [700, 540, 160, 28],
      [260, 580, 120, 24],
    ],
    hazards: [
      { rect: [440, 860, 160, 40], from: "ESCAPE" },
      { rect: [760, 716, 90, 24], from: "ESCALATION" },
      { rect: [1300, 476, 70, 24], from: "FINAL" },
    ],
  },
  {
    id: "library",
    name: "Library (Unsorted)",
    tagline: "4,000 games. You have played three.",
    spawn: [60, 710],
    exit: [1500, 360, 70, 100],
    platforms: [
      [0, 760, 360, 140],
      [760, 700, 260, 200],
      [470, 600, 90, 24],
      [620, 520, 70, 24],
      [1120, 580, 200, 30],
      [1400, 460, 200, 440],
    ],
    hazards: [
      { rect: [360, 860, 400, 40], from: "ESCAPE" },
      { rect: [1020, 860, 380, 40], from: "ESCAPE" },
      { rect: [840, 676, 80, 24], from: "ESCALATION" },
      { rect: [1170, 556, 60, 24], from: "FINAL" },
    ],
  },
  {
    id: "proton",
    name: "Proton Compatibility Layer",
    tagline: "Runs great*. (*Does not run.)",
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
