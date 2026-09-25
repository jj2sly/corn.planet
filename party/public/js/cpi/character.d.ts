// Types for character.js, so tests (TypeScript) can import the module the browser runs.

export interface Appearance {
  hat: string;
  face: string;
  suit: string;
  accessory: string;
  /** Visor LED colour. */
  led: string;
  /** Colour for knitted and fabric bits (beanies, caps, scarves). */
  knit: string;
}

export interface SlotOption {
  id: string;
  label: string;
  /** Never picked at random: a cosmetic to earn or choose. */
  unlock?: boolean;
}

export interface Character {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly appearance: Readonly<Appearance>;
  readonly colors: Readonly<{ suit: string; dark: string; light: string; helmet: string; helmetShade: string; led: string; knit: string }>;
}

export interface Joints {
  frontLeg: number;
  backLeg: number;
  legLength: number;
  frontArm: number;
  backArm: number;
  bob: number;
  lean: number;
  eyes: string;
  item: string | null;
  itemAngle: number;
  ghost: boolean;
}

export interface CharacterPose {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  facing?: number;
  state?: string;
  t?: number;
  cycle?: number;
  squash?: number;
  scale?: number;
  alpha?: number;
  lean?: number;
  speed?: number;
  clock?: number;
  effects?: string[];
  outline?: string;
  flash?: boolean;
}

export declare const BOX: Readonly<{ w: number; h: number }>;
export declare const SLOTS: Readonly<Record<"hat" | "face" | "suit" | "accessory", SlotOption[]>>;
export declare function hashString(text: string): number;
export declare function seeded(seed: number): () => number;
export declare function appearanceFor(id: string): Appearance;
export declare function createCharacter(options?: { id?: string; name?: string; color?: string; appearance?: Partial<Record<keyof Appearance, string>> }): Character;
export declare function shade(hex: string, amount: number): string;
export declare function jointsFor(state: string, t?: number, cycle?: number): Joints;
/** `ctx` is a CanvasRenderingContext2D. */
export declare function drawCharacter(ctx: unknown, ch: Character, pose: CharacterPose): void;
/** Returns an HTMLCanvasElement with a `paint(pose)` method. */
export declare function characterCanvas(ch: Character, options?: { size?: number; state?: string; facing?: number; t?: number; label?: string | null }): unknown;
