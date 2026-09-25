// Types for animation.js, so tests (TypeScript) can import the module the browser runs.

export type AnimEvent = "jump" | "land" | "walkoff" | "die" | "respawn" | "escape";

export interface AnimPose {
  state: string;
  t: number;
  cycle: number;
  squash: number;
  scale: number;
  alpha: number;
  lift: number;
  effects: string[];
  flash: boolean;
  gone: boolean;
  speed: number;
}

export interface Animator {
  observe(sample: { time: number; x: number; y: number; status?: "alive" | "dead" | "escaped"; facing?: number }): AnimEvent[];
  trigger(name: string, time: number, length?: number): void;
  setFlag(name: string, on: boolean): void;
  readonly grounded: boolean;
  readonly velocity: { x: number; y: number };
  readonly landing: number;
  readonly status: string;
  airTime(time: number): number;
  pose(time: number, x?: number): AnimPose;
}

export declare const ANIM: Readonly<{
  runSpeed: number;
  slideSpeed: number;
  slipSpeed: number;
  stride: number;
  landS: number;
  jumpS: number;
  placeS: number;
  hitS: number;
  spawnS: number;
  escapeS: number;
  hardLanding: number;
}>;

export declare function createAnimator(options?: Partial<typeof ANIM>): Animator;
