// Types for channelcob-task.js, so tests (TypeScript) can import the module the browser runs.

export interface CobYou {
  roleName: string;
  job: string;
  onAir: boolean;
  upNext: boolean;
  prompt: string | null;
  breaking: { id: number; text: string }[];
  decision: { id: number; question: string; options: string[]; chosen: number | null } | null;
}

export interface CobGameView {
  phase: string;
  segment: number;
  speaker?: { roleName: string } | null;
  you: CobYou;
}

export interface CobTask {
  kind: "intro" | "prep" | "decision" | "breaking" | "live" | "next" | "listen";
  title?: string;
  tag?: string;
  text: string;
  job?: string;
  id?: number;
  options?: string[];
  more?: number;
  note?: string;
}

export declare const SEGMENT_STEPS: string[];
export declare function segmentStep(phase: string): number;
export declare function stateLabel(game: CobGameView): string;
export declare function currentTask(game: CobGameView): CobTask;
