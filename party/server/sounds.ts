// Sound effects moderation: each game's sound list (see public/js/sound-catalog.js) as moderators
// have set it, falling back to the defaults from public/sounds/mycob/sounds.json. Stored in the
// settings table, one row per game, so it survives restarts and deploys.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRows, defaultRows, SOUND_SCOPES, type SoundRow } from "../public/js/sound-catalog.js";
import type { PartyDb } from "./db.ts";

const SOUND_DIR = fileURLToPath(new URL("../public/sounds/mycob/", import.meta.url));
const AUDIO = /\.(mp3|ogg|wav|m4a)$/i;

/** Every sound file on disk, as paths under /sounds/mycob/. Missing folder: none. */
export function soundFiles(dir = SOUND_DIR): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (AUDIO.test(entry.name)) out.add(relative(dir, full).split(sep).join("/"));
    }
  };
  try {
    walk(dir);
  } catch {
    // No sounds folder: every game plays its built-in tones.
  }
  return out;
}

export function soundManifest(dir = SOUND_DIR): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, "sounds.json"), "utf8"));
  } catch {
    return {};
  }
}

export const isSoundScope = (id: string) => Object.hasOwn(SOUND_SCOPES, id);

export interface SoundService {
  files(): Set<string>;
  /** A game's sounds as they play now, and whether a moderator has changed them. */
  rows(scope: string): { rows: SoundRow[]; customised: boolean };
  save(scope: string, rows: unknown): SoundRow[] | string;
  reset(scope: string): void;
}

export function createSoundService(db: PartyDb, dir = SOUND_DIR): SoundService {
  const manifest = soundManifest(dir);
  let cached: Set<string> | null = null;
  const files = () => (cached ??= soundFiles(dir));
  return {
    files: () => ((cached = null), files()),
    rows(scope) {
      const saved = db.getSoundConfig(scope);
      if (saved) {
        // A file deleted since it was set up just drops out instead of failing the whole list.
        const have = files();
        const sourceOf = (r: unknown) => String((r as { source?: unknown } | null)?.source ?? "");
        const usable = saved.filter((r) => !sourceOf(r).startsWith("file:") || have.has(sourceOf(r).slice(5)));
        const checked = checkRows(scope, usable, have);
        if (typeof checked !== "string") return { rows: checked, customised: true };
      }
      return { rows: defaultRows(scope, manifest), customised: false };
    },
    save(scope, rows) {
      const checked = checkRows(scope, rows, files());
      if (typeof checked !== "string") db.setSoundConfig(scope, checked);
      return checked;
    },
    reset(scope) {
      db.setSoundConfig(scope, null);
    },
  };
}
