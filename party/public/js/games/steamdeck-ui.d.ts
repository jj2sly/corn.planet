// Types for the DOM-free helpers in steamdeck-ui.js, so tests (TypeScript) can import them. The
// module's DOM builders (launchSteps, roundReport, badge, …) are browser-only and not declared here.

interface RosterEntry {
  id: string;
  name: string;
  color: string;
  deaths: number;
  escapedMs: number | null;
}

export declare const TITLE: string;
export declare const PLAYING: readonly string[];
export declare const PHASE_TITLE: Readonly<Record<string, string>>;
export declare const PHASE_SHORT: Readonly<Record<string, string>>;
export declare function battery(phase: string, timer: { remainingMs: number; totalMs: number } | null): number;
export declare function verdict(g: { roster: RosterEntry[] }): { stamp: string; line: string; kind: string };
export declare function quip(id: string, escaped: boolean, round?: number): string;
export declare function thadLine(g: { roster: RosterEntry[] }, points: number): string;
export declare function phaseNotice(g: { phase: string; world: { maxTilt: number } }): { text: string; kind: string; icon: string } | null;
