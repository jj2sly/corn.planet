// Types for sim.js, so tests (TypeScript) can drive the simulation the browser runs.

import type { ColdCaseMap } from "./map.js";

export interface Input {
  moveX: number;
  moveY: number;
  interact: boolean;
  interactPressed: boolean;
  action: boolean;
  actionPressed: boolean;
  cancelPressed: boolean;
  /** -1, 0 or 1 for one step: a dial click. */
  adjust: number;
  /** -1..1 while held: pushes the balance panel. */
  adjustHeld: number;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  facing: number;
  hp: number;
  warmth: number;
  felt: number;
  zone: number;
  iframes: number;
  heatPacks: number;
  slowUntil: number;
  moving: boolean;
}

export interface Zone { id: string; name: string; temp: number; target: number; dark: number; safe: boolean }
export interface DoorState { id: string; kind: string; unlocked: boolean; open: number; passable: boolean }
export interface Threat {
  id: string;
  kind: "milk" | "icecream";
  leash: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  facing: number;
  temper: "FROZEN" | "AWAKE" | "SPOILED" | "SOFT" | "HARD";
  mode: string;
  modeT: number;
  aimX: number;
  aimY: number;
  temp: number;
}
export interface HeatSource { id: string; x: number; y: number; r: number; temp: number; on: boolean; until: number; follow: boolean }

export interface Panel {
  id: string;
  kind: "dial" | "timing" | "pressure" | "balance";
  t: number;
  result: string | null;
  flash: string | null;
  flashT: number;
  armed: boolean;
  value: number;
  min?: number;
  max?: number;
  current?: number;
  needle?: number;
  window?: [number, number];
  hits?: number;
  need?: number;
  cooldown?: number;
  band?: [number, number];
  locks?: number;
  inBand?: number;
}

export interface Flags {
  fridgeOpened: boolean;
  entered: boolean;
  thermostatUsed: boolean;
  setpointOk: boolean;
  thaw: number;
  current: boolean;
  powerRestored: boolean;
  coolingRepaired: boolean;
  outpostFound: boolean;
  lockerOpened: boolean;
  coreStage: number;
  coreStabilized: boolean;
  liftArrived: boolean;
  extracted: boolean;
  done: Record<string, boolean>;
}

export interface GameEvent { type: string; [key: string]: unknown }

export interface Target { type: "station" | "door"; id: string; kind: string; available: boolean; label: string }

export interface GameState {
  map: ColdCaseMap;
  seed: number;
  time: number;
  missionTime: number;
  phase: "BRIEFING" | "PLAYING" | "DOWNED" | "COMPLETE";
  objective: number;
  setpoint: number;
  zones: Zone[];
  discovered: Uint8Array;
  flags: Flags;
  player: Player;
  doors: DoorState[];
  threats: Threat[];
  heat: HeatSource[];
  pickups: { id: string; kind: string; x: number; y: number; taken: boolean }[];
  checkpoint: string;
  hazards: { id: string; kind: string; state: string; x: number; y: number; w?: number; h?: number; r?: number }[];
  core: { progress: number; surges: { r: number; hit: boolean }[]; surgeT: number };
  target: Target | null;
  hold: { id: string; t: number; dur: number } | null;
  panel: Panel | null;
  transition: { portal: string; kind: string; t: number; dur: number; swap: number; swapped: boolean } | null;
  events: GameEvent[];
  stats: { downs: number; damage: number; heatPacksUsed: number; spoiled: boolean; threats: Record<string, boolean>; checkpoints: number };
}

export interface ObjectiveInfo { id: string; text: string; detail: string; progress: number | null; target: { x: number; y: number } | null }

export declare const CONFIG: {
  player: { radius: number; speed: number; accel: number; friction: number; iceAccel: number; iceFriction: number; maxHp: number; maxWarmth: number; maxHeatPacks: number };
  temp: { zoneRate: number; feltRate: number };
  cold: { neutralLow: number; neutralHigh: number; drain: number; gain: number; maxGain: number; hypothermia: number; slowBelow: number; slowMin: number };
  thaw: { point: number; rate: number };
  loop: { min: number; max: number; start: number };
  milk: Record<string, number>;
  icecream: Record<string, number>;
  core: Record<string, number>;
  timing: Record<string, number>;
  pressure: { need: number; rise: number; accel: number; bleed: number; bands: [number, number][]; overDamage: number };
  respawn: { downTime: number; hp: number; warmth: number; iframes: number };
  [key: string]: unknown;
};
export declare const OBJECTIVES: readonly { id: string; done(state: GameState): boolean }[];
export declare const NO_INPUT: Readonly<Input>;
export declare function createGame(options?: { seed?: number; map?: ColdCaseMap; skipBriefing?: boolean }): GameState;
export declare function beginMission(state: GameState): boolean;
export declare function stepGame(state: GameState, input?: Partial<Input>, dt?: number): GameState;
export declare function drainEvents(state: GameState): GameEvent[];
export declare function zoneId(state: GameState): string;
export declare function tileSolid(state: GameState, tx: number, ty: number): boolean;
export declare function localTemp(state: GameState, x: number, y: number): number;
export declare function inHeat(state: GameState, x: number, y: number): boolean;
export declare function doorState(state: GameState, id: string): DoorState | null;
export declare function distanceField(state: GameState, gx: number, gy: number, passable: (x: number, y: number) => boolean): Int16Array;
export declare function routeTo(state: GameState, x: number, y: number, tx: number, ty: number, options?: { maxLength?: number }): { x: number; y: number }[];
export declare function stationInfo(state: GameState, station: { id: string }): { available: boolean; label: string; locked: string | null; visible: boolean };
export declare function objectiveInfo(state: GameState): ObjectiveInfo;
export declare function debrief(state: GameState): {
  time: number;
  downs: number;
  damage: number;
  heatPacksUsed: number;
  spoiled: boolean;
  threats: string[];
  technician: boolean;
  setpoint: number;
  systems: [string, boolean][];
};
