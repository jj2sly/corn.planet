// Types for the DOM-free helpers in steamdeck-ui.js, so tests (TypeScript) can import them. The
// module's DOM builders (launchSteps, roundReport, badge, …) are browser-only and not declared here.

interface RosterEntry {
  id: string;
  name: string;
  color: string;
  deaths: number;
  escapedMs: number | null;
}

/** The game's title, from Steam My Deck's library (the server registry) once it's installed. */
export declare function gameTitle(): string;
export declare const PLAYING: readonly string[];
export declare const PHASE_TITLE: Readonly<Record<string, string>>;
export declare const PHASE_SHORT: Readonly<Record<string, string>>;
export declare function battery(phase: string, timer: { remainingMs: number; totalMs: number } | null, playMs?: [number, number, number] | null): number;
export declare function verdict(g: { roster: RosterEntry[] }): { stamp: string; line: string; kind: string };
export declare function quip(id: string, escaped: boolean, round?: number): string;
export declare function thadLine(g: { roster: RosterEntry[] }, points: number): string;
export declare function phaseNotice(g: { phase: string; world: { maxTilt: number }; level?: { exitUse?: boolean; items?: unknown[] } }): { text: string; kind: string; icon: string } | null;
