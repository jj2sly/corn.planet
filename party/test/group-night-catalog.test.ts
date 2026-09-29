import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { CanonRecord } from "../server/canon.ts";
import { GAMES } from "../server/games/registry.ts";
import { makeRooms, roomWithPlayers, stubCanon, TEST_CANON } from "./helpers.ts";

const FRIDAY_GAMES = ["chaos", "cornorshit", "entityauction", "mycob", "steamdeck", "thud"] as const;

function groupCanon(): CanonRecord[] {
  const generated: CanonRecord[] = Array.from({ length: 30 }, (_, i) => ({
    ref: `CPE-${String(100 + i)}`,
    kind: "entity" as const,
    title: `Group Night Entity ${i + 1}`,
    fields: {
      classification: ["COSMIC", "EARTHLY", "LOCAL"][i % 3]!,
      containment: ["MAXIMUM", "STANDARD", "MINIMAL"][i % 3]!,
      description: `Distinct group-night entity description ${i + 1}.`,
      containmentProcedures: `Containment procedure number ${i + 1}.`,
    },
    links: {},
    url: `https://example.test/CPE-${100 + i}`,
  }));
  return [...TEST_CANON, ...generated];
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }));
afterEach(() => mock.timers.reset());

describe("Friday Group Night catalog smoke test", () => {
  for (const id of FRIDAY_GAMES) {
    it(`${id} configures and starts from the shared Party registry`, () => {
      const definition = GAMES.get(id);
      assert.ok(definition, `${id} must be installed in GAMES`);

      const rooms = makeRooms({ canon: stubCanon(groupCanon()) });
      try {
        const playerCount = Math.max(3, definition.minPlayers);
        const names = Array.from({ length: playerCount }, (_, i) => `Agent${i + 1}`);
        const { room } = roomWithPlayers(rooms.manager, names);

        room.configure({ gameId: id });
        assert.equal(room.viewFor({ kind: "host" }).config.gameId, id);

        room.startGame();
        const view = room.viewFor({ kind: "host" });
        assert.equal(room.status, "IN_GAME");
        assert.equal(view.config.gameId, id);
        assert.ok(view.game, `${id} must expose a host game view immediately after start`);

        room.returnToLobby();
        assert.equal(room.status, "LOBBY");
      } finally {
        rooms.db.close();
      }
    });
  }
});
