import { chaosGame } from "./chaos.ts";
import { cornOrShitGame } from "./cornorshit.ts";
import { entityAuctionGame } from "./entityauction.ts";
import type { GameDefinition } from "./types.ts";

// To add a minigame: implement GameDefinition in games/<id>.ts, add it here, and add
// public/js/games/<id>-host.js and <id>-play.js renderers. Nothing else needs to change.
const INSTALLED: GameDefinition[] = [
  chaosGame as GameDefinition,
  cornOrShitGame as GameDefinition,
  entityAuctionGame as GameDefinition,
];

export const GAMES: ReadonlyMap<string, GameDefinition> = new Map(INSTALLED.map((g) => [g.id, g]));

export function gameSummaries() {
  return INSTALLED.map(({ id, name, tagline, description, minPlayers, maxPlayers, defaultSettings }) => ({
    id,
    name,
    tagline,
    description,
    minPlayers,
    maxPlayers,
    defaultSettings,
  }));
}
