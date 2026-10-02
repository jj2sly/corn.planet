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

export declare const COB_TILT: number;
export declare const COB_PERSPECTIVE: number;
export declare const COB_RIM: number;
export declare const COB_ZONE: number;
export declare const COB_BURST: number;
export declare const COB_BURST_STEP: number;
export declare const COB_BURST_GAP: number;

export interface CobSlot {
  /** The lane's centre, degrees above the view axis. */
  angle: number;
  /** Fractions of the stage height. */
  y: number;
  height: number;
  /** [left, right] fractions of the stage width at this lane. */
  ends: [number, number];
}

export interface CobGeometry {
  lanes: number;
  bands: number;
  rows: number;
  step: number;
  span: number;
  top: number;
  bottom: number;
  rho: number;
  aspect: number;
  axis: number;
  height: number;
  rowW: number;
  rowH: (row: number) => number;
  cell: number;
  slots: CobSlot[];
  rowAngle: (slot: number, band: number) => number;
  seam: (slot: number) => number;
  frac: (yInRadii: number) => number;
}

export interface CobOutline {
  points: [number, number][];
  left: number;
  right: number;
  top: number;
  bottom: number;
  viewBox: [number, number];
}

export interface CobTimeline {
  live: boolean;
  roll: number;
  activate: number;
  activateStep: number;
  popAt: number;
  mostPops: number;
  popSpan: number;
  settleAt: number;
  crownAt: number;
  cues: number[];
  total: number;
}

export declare function cobTaper(u: number): number;
export declare function cobGeometry(lanes: number, bands?: number): CobGeometry;
export declare function cobKernelSlot(index: number, bands: number): { band: number; column: number; u: number };
export declare function cobOutline(geometry: CobGeometry): CobOutline;
export declare function cobRail(geometry: CobGeometry, deg: number, samples?: number): [number, number][];
export declare function cobLight(deg: number): number;
export declare function cobSheen(geometry: CobGeometry): number;
export declare function cobShading(geometry: CobGeometry, samples?: number): { at: number; dark: number; light: number }[];
export declare function cobPopDelays(count: number): number[];
export declare function cobPopSpan(count: number): number;
export declare function cobTimeline(options: { lanes: number; rows: CobRow[]; moved: boolean; live: boolean }): CobTimeline;
export declare function cobLeaders(rows: CobRow[]): CobRow[];
