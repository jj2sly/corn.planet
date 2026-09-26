// Types for thud-howto.js, so tests (TypeScript) can import the module the browser runs.

export interface TutorialCard {
  id: string;
  title: string;
  lines: string[];
}

export declare function abilityHow(bird: { ability?: { trigger?: string } } | null | undefined): string;
export declare function tutorialCards(options?: { buildMs?: number; bird?: string | null }): TutorialCard[];
