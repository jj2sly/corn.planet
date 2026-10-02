// Types for debrief.js, so tests (TypeScript) can import the parts that are plain logic.

export interface DebriefHighlight {
  title: string;
  playerName: string | null;
  text: string | null;
  detail: string;
}

export interface DebriefStanding {
  playerId: string;
  name: string;
  score: number;
  placement: number;
  left?: boolean;
}

export interface DebriefResults {
  gameId: string;
  gameName?: string;
  rounds?: number;
  standings: DebriefStanding[];
  highlights: DebriefHighlight[];
}

/** The team result to lead with, if the game has one. */
export declare function teamOutcome(results: DebriefResults): DebriefHighlight | null;
/** Who the headline names, or null when nobody scored. */
export declare function headline(
  results: DebriefResults,
  options?: { outcome?: DebriefHighlight | null },
): { label: string; top: DebriefStanding[]; score: number } | null;
