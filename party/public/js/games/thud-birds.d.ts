// Types for thud-birds.js, so the server (TypeScript) launches the same birds the screens draw.

export type AbilityKind = "pop" | "boost" | "pierce" | "split" | "ricochet" | "slam" | "glide" | "magnet" | "bunker";

export interface Ability {
  kind: AbilityKind;
  trigger: "tap" | "hold" | "launch";
  uses?: number;
  radius?: number;
  push?: number;
  damage?: number;
  factor?: number;
  maxSpeed?: number;
  burnS?: number;
  budget?: number;
  slow?: number;
  count?: number;
  spread?: number;
  scale?: number;
  bounceBonus?: number;
  maxBounces?: number;
  speed?: number;
  massFactor?: number;
  fuel?: number;
  steer?: number;
  lift?: number;
  pull?: number;
  seconds?: number;
  size?: number;
  hp?: number;
}

export interface BirdType {
  id: string;
  name: string;
  title: string;
  role: string;
  blurb: string;
  usage: string;
  body: { r: number; density: number; restitution: number };
  ability: Ability;
  icon: string;
}

export interface Skin {
  id: string;
  name: string;
  identity: string | null;
  source: "classic" | "cast" | "custom";
  look: Record<string, unknown> | null;
  art?: string;
}

export declare const BIRDS: readonly BirdType[];
export declare const BIRD_IDS: readonly string[];
export declare function birdType(id: string): BirdType | null;
export declare const CUSTOM_SKINS: readonly Skin[];
export declare const SKINS: readonly Skin[];
export declare function skinById(id: string): Skin;
export declare function lookFor(birdId: string, skinId?: string): Record<string, unknown>;
export declare function birdLookFromPerson(look?: Record<string, unknown>): Record<string, unknown>;
