// Types for thud-art.js, so tests (TypeScript) can draw with the module the browser runs.
// `ctx` is a CanvasRenderingContext2D; tests pass a recording stand-in.

export declare const PIG_LOOK: Readonly<Record<string, { body: string; nose: string; hat: string }>>;
export declare const MATERIAL_COLORS: Readonly<Record<string, string>>;
export declare function drawPig(ctx: unknown, kind: string, pose: { x: number; y: number; r: number; angle?: number; t?: number; crack?: number; hurt?: number; facing?: number; state?: string }): void;
export declare function drawBlock(ctx: unknown, material: string, hw: number, hh: number, opts?: { crack?: number; reinforced?: boolean; t?: number; seed?: number }): void;
export declare function drawBuilding(ctx: unknown, type: string, tier: number, hw: number, hh: number, opts?: { t?: number; disabled?: boolean; broken?: boolean; waterlogged?: boolean; crack?: number; progress?: number }): void;
export declare function drawRedCow(ctx: unknown, x: number, groundY: number, progress: number, opts?: { t?: number; workers?: number; scale?: number }): void;
export declare function drawSling(ctx: unknown, x: number, y: number, opts?: { pouch?: [number, number] | null; back?: boolean; power?: number; twang?: number; t?: number }): void;
export declare function themeOf(id: string): Record<string, unknown>;
export declare function paintBackdrop(ctx: unknown, level: { theme: string; width: number; groundY: number; terrain: readonly (readonly number[])[]; zones: readonly (readonly number[])[] }, opts?: { top?: number }): void;
