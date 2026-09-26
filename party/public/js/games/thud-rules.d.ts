// Types for thud-rules.js (shared by the server and the screens).

export declare function placement(
  box: { x: number; w: number; h: number },
  world: { zones: readonly [number, number][]; groundY: number; clear: (cx: number, cy: number, w: number, h: number) => boolean },
): { ok: boolean; x: number; reason: string };

export declare function clearOf(rows: readonly unknown[][]): (cx: number, cy: number, w: number, h: number) => boolean;

export declare function arc(sling: { x: number; y: number; maxSpeed: number; gravity: number }, angle: number, power: number, opts?: { seconds?: number; dt?: number }): [number, number][];

export declare function aimFromPull(dx: number, dy: number, opts?: { maxPull?: number; minAngle?: number; maxAngle?: number; minPower?: number }): { angle: number; power: number };
