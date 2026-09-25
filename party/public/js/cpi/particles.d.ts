// Types for particles.js, so tests (TypeScript) can import the module the browser runs.

export interface Particles {
  emit(kind: string, x: number, y: number, opts?: Record<string, unknown>): unknown;
  burst(kind: string, x: number, y: number, count: number, opts?: Record<string, unknown>): void;
  update(dt: number): void;
  /** `ctx` is a CanvasRenderingContext2D. */
  draw(ctx: unknown, layer?: "back" | "front"): void;
  readonly count: number;
  readonly max: number;
  clear(): void;
}

export declare const PARTICLE_KINDS: readonly string[];
export declare function createParticles(options?: { max?: number; random?: () => number }): Particles;
