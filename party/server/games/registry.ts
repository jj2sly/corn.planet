import { chaosGame } from "./chaos.ts";
import { cornOrShitGame } from "./cornorshit.ts";
import { entityAuctionGame } from "./entityauction.ts";
import { createMyCobGame, type MyCobOptions } from "./mycob/game.ts";
import { steamDeckGame } from "./steamdeck/game.ts";
import type { GameDefinition } from "./types.ts";

// To add a minigame: implement GameDefinition in games/<id>.ts, add it here, and add
// public/js/games/<id>-host.js and <id>-play.js renderers. Nothing else needs to change.
function installed(mycob: MyCobOptions = {}): GameDefinition[] {
  return [
    chaosGame as GameDefinition,
    cornOrShitGame as GameDefinition,
    entityAuctionGame as GameDefinition,
    createMyCobGame(mycob) as GameDefinition,
    steamDeckGame as GameDefinition,
  ];
}
const INSTALLED = installed();

export const GAMES: ReadonlyMap<string, GameDefinition> = new Map(INSTALLED.map((g) => [g.id, g]));

/** The installed games, with My Cob Escaped set up differently (e.g. another Incident Director). */
export function gamesWith(mycob: MyCobOptions): ReadonlyMap<string, GameDefinition> {
  return new Map(installed(mycob).map((g) => [g.id, g]));
}

export function gameSummaries() {
  return INSTALLED.map(({ id, name, tagline, description, minPlayers, maxPlayers, defaultSettings, catalog }) => ({
    id,
    name,
    tagline,
    description,
    minPlayers,
    maxPlayers,
    defaultSettings,
    catalog: catalog ?? null,
  }));
}
