// Types for budgetcuts-funding.js, so tests (TypeScript) can import the module the browser runs.

export declare const TIER_SHORT: string[];
export declare function tierOf(alloc: number, request: number): number;
export declare function okZone(request: number): [number, number];
export declare function planTotals(alloc: Record<string, number>, pool: number): { total: number; left: number; fits: boolean };
