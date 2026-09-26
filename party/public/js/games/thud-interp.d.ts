// Types for thud-interp.js, so tests (TypeScript) can import the module the browser runs.

export type Row = (string | number)[];

export interface Sampled {
  row: Row;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  leaving: boolean;
}

export interface SnapshotBuffer {
  push(tick: number, tickMs: number, rows: readonly Row[], now: number): void;
  sample(now: number): Sampled[];
  hold<T>(items: readonly T[], arrivedAt?: number): void;
  due<T = unknown>(now: number): { item: T; waitedMs: number }[];
  reset(): void;
  renderTime(now: number): number;
  latestTime(): number;
  readonly size: number;
}

export declare function createSnapshotBuffer(options?: { delayMs?: number; max?: number }): SnapshotBuffer;
