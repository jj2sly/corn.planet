// Types for sound-catalog.js (shared by the server and the screens).

export interface SoundRow {
  id: string;
  /** "file:<path under /sounds/mycob/>" or "synth:<tag>". */
  source: string;
  tag: string;
  enabled: boolean;
  volume: number;
}

export declare const SOUND_TAGS: Record<string, { label: string; base?: string }>;
export declare const SOUND_SCOPES: Record<string, { name?: string; global?: boolean; tags: string[] }>;
export interface SoundFamily {
  label: string;
  gain: number;
  cooldown: number;
  priority: number;
}
export declare const SOUND_FAMILIES: Record<string, SoundFamily>;
export declare function soundPolicy(tag: string): SoundFamily & { family: string };
export declare const SOUND_BASE: string;
export declare function baseTag(tag: string): string;
export declare function defaultRows(scopeId: string, manifest: unknown): SoundRow[];
export declare function checkRows(scopeId: string, rows: unknown, files: ReadonlySet<string>): SoundRow[] | string;
