// Types for chaos-cob.js, so tests (TypeScript) can import the module the browser runs.

export interface CobRow {
  id: string;
  name: string;
  connected: boolean;
  index: number;
  score: number;
  previous: number;
  gain: number;
  kernelsBefore: number;
  kernelsAfter: number;
  placement: number;
  previousPlacement: number;
  move: number;
}

export declare const COB_COLUMNS: number;
export declare function cobRowsPerLane(lanes: number): number;
export declare function cobStandings(
  players: { id: string; name: string; score: number; connected?: boolean }[],
  previous: Map<string, number> | null,
  options?: { kernels?: number },
): { rows: CobRow[]; previousOrder: CobRow[]; scale: number; moved: boolean; known: boolean };
