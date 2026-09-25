// Types for steamdeck-cast.js, so the server (TypeScript) imports the same cast the browser draws.

export interface CastStats {
  /** Top speed and acceleration. */
  run: number;
  /** Jump launch speed. */
  jump: number;
  /** How far Thad's shake throws them. */
  knock: number;
}

export interface CastMember {
  id: string;
  name: string;
  stats: Readonly<CastStats>;
  size: { w: number; h: number };
  builds?: { name: string; w: number }[];
  look: Record<string, unknown>;
}

export declare const CAST: readonly CastMember[];
export declare const NORMAL_STATS: Readonly<CastStats>;
export declare function castMember(id: string): CastMember | null;
export declare function dealCast(count: number, random: () => number): { id: string; build: number }[];
