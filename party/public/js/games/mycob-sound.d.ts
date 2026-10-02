// Types for the parts of mycob-sound.js the tests use.

export declare const CUES: string[];
export declare function setSoundScope(id: string | null): void;
/** `scope`: look the tag up in that game's moderated list instead of the current one's. */
export declare function chooseSound(cue: string, scope?: string): Promise<{ url?: string; synth?: string; volume: number } | null | undefined>;
export declare function hasTone(tag: string): boolean;
export declare function playCue(cue: string): void;
