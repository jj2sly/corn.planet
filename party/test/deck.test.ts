// Steam My Deck, the handheld hub every game launches from: the library comes from the game
// registry (one source of truth), every game carries its own title and presentation, and the hub's
// data helpers (ordering, recent games, d-pad navigation) behave. Browser code, run here without a
// browser: library.js has no DOM.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_COLORS,
  gameInfo,
  homeOrder,
  initials,
  libraryEntry,
  libraryFrom,
  pagesFor,
  PLATFORM_NAME,
  playersLabel,
  setLibrary,
  spatialMove,
  titleOf,
  withRecent,
} from "../public/js/deck/library.js";
import { GAMES, gameSummaries } from "../server/games/registry.ts";
import { COLORS as DECK_COLORS } from "../server/games/steamdeck/game.ts";
import { COLORS as THUD_COLORS } from "../server/games/thud/game.ts";

const HEX = /^#[0-9a-f]{6}$/i;

describe("Steam My Deck: every installed game is in the library", () => {
  it("gives every registered game a complete library entry", () => {
    for (const game of GAMES.values()) {
      const deck = game.deck;
      assert.ok(deck, `${game.id} has a deck entry`);
      assert.ok(deck.shelf === "handheld" || deck.shelf === "party", `${game.id}: shelf`);
      assert.ok(deck.genre.length > 0 && deck.genre.length <= 24, `${game.id}: a short genre`);
      assert.ok(deck.controls.length > 0 && deck.controls.every((c) => c.length > 0 && c.length <= 70), `${game.id}: short control lines`);
      assert.ok(deck.length.length > 0, `${game.id}: length`);
      for (const key of ["from", "to", "accent"] as const) assert.match(deck.art[key], HEX, `${game.id}: art.${key}`);
      assert.ok(deck.art.glyph.length > 0, `${game.id}: a glyph`);
    }
  });

  it("publishes it with the game in /api/config, so the hub needs no list of its own", () => {
    const summaries = gameSummaries();
    assert.equal(summaries.length, GAMES.size);
    for (const s of summaries) assert.deepEqual(s.deck, GAMES.get(s.id)!.deck, `${s.id}'s deck entry is the registry's`);
  });

  it("titles every game as itself: the Escape game is not the platform", () => {
    const names = gameSummaries().map((g) => g.name);
    assert.equal(new Set(names).size, names.length, "no two games share a title");
    assert.equal(GAMES.get("steamdeck")!.name, "Escape Thad's Steam Deck");
    assert.equal(GAMES.get("thud")!.name, "Angry Thud's Revenge");
    assert.ok(!names.includes(PLATFORM_NAME), "Steam My Deck is the handheld, not one of its games");
  });

  it("puts the handheld games on the handheld shelf, first", () => {
    const lib = libraryFrom(gameSummaries());
    assert.deepEqual(lib.filter((e) => e.shelf === "handheld").map((e) => e.id).sort(), ["steamdeck", "thud"]);
    const firstParty = lib.findIndex((e) => e.shelf === "party");
    assert.ok(lib.slice(firstParty).every((e) => e.shelf === "party"), "shelves don't interleave");
    assert.deepEqual(lib.map((e) => e.id).sort(), [...GAMES.keys()].sort(), "every game, nothing invented");
  });

  it("looks each game's title up from the installed library", () => {
    assert.equal(titleOf("no-such-game", "Fallback"), "Fallback");
    setLibrary(gameSummaries());
    assert.equal(titleOf("thud"), "Angry Thud's Revenge");
    assert.equal(titleOf("steamdeck"), "Escape Thad's Steam Deck");
    const thud = gameInfo("thud")!;
    assert.equal(thud.players, "2–8 players");
    assert.equal(thud.shelf, "handheld");
    assert.equal(gameInfo("no-such-game"), null);
  });

  it("dresses a future game that brings no art of its own, the same way every time", () => {
    const game = { id: "draw", name: "Corn Planet Draw", tagline: "Sketch it.", description: "…", minPlayers: 3, maxPlayers: 8, deck: null };
    const a = libraryEntry(game);
    assert.equal(a.title, "Corn Planet Draw");
    assert.equal(a.shelf, "party");
    assert.equal(a.art.glyph, "CPD");
    for (const key of ["from", "to", "accent"] as const) assert.match(a.art[key], HEX);
    assert.deepEqual(libraryEntry(game), a, "the same cover every time");
    // Bad values from anywhere never break a cover.
    const odd = libraryEntry({ id: "x", name: "X", deck: { shelf: "moon", art: { from: "red", to: 7, glyph: "" } } });
    assert.equal(odd.shelf, "party");
    assert.match(odd.art.from, HEX);
    assert.equal(odd.art.glyph, "X");
    assert.equal(libraryEntry(null).title, "Untitled");
  });

  it("dresses agents in the colours the games give them", () => {
    assert.deepEqual([...AGENT_COLORS], DECK_COLORS);
    assert.deepEqual([...AGENT_COLORS], THUD_COLORS);
  });
});

describe("Steam My Deck: the hub's helpers", () => {
  it("counts players and makes initials", () => {
    assert.equal(playersLabel(2, 8), "2–8 players");
    assert.equal(playersLabel(1, 1), "1 player");
    assert.equal(playersLabel(4, 4), "4 players");
    assert.equal(initials("My Cob Escaped, What Do I Do Now???"), "MCE");
  });

  it("keeps recently played games newest first, once each", () => {
    assert.deepEqual(withRecent([], "thud"), ["thud"]);
    assert.deepEqual(withRecent(["chaos", "thud", "mycob"], "thud"), ["thud", "chaos", "mycob"]);
    assert.deepEqual(withRecent(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
    assert.deepEqual(withRecent("junk", "thud"), ["thud"], "a corrupted store is just empty");
  });

  it("orders the home shelf: selected, then recent, then the rest", () => {
    const lib = libraryFrom(gameSummaries());
    const order = homeOrder(lib, ["chaos", "gone-game", "thud"], "steamdeck").map((e) => e.id);
    assert.deepEqual(order.slice(0, 3), ["steamdeck", "chaos", "thud"]);
    assert.equal(order.length, lib.length, "everything installed, once, nothing uninstalled");
  });

  it("has the same four pages everywhere, with AGENTS on the big screen", () => {
    assert.deepEqual(pagesFor("player").map((p) => p.label), ["HOME", "LIBRARY", "PROFILE", "SETTINGS"]);
    assert.deepEqual(pagesFor("host").map((p) => p.label), ["HOME", "LIBRARY", "AGENTS", "SETTINGS"]);
  });

  it("moves the d-pad cursor by rows and columns", () => {
    // A 3 × 2 grid of 100 × 80 tiles, 10 apart, and a wide button under it.
    const tiles = [0, 1, 2, 3, 4, 5].map((i) => ({ x: (i % 3) * 110, y: Math.floor(i / 3) * 90, w: 100, h: 80 }));
    const rects = [...tiles, { x: 0, y: 190, w: 320, h: 44 }];
    assert.equal(spatialMove(rects, 0, "right"), 1);
    assert.equal(spatialMove(rects, 1, "ArrowDown"), 4);
    assert.equal(spatialMove(rects, 5, "left"), 4);
    assert.equal(spatialMove(rects, 4, "up"), 1);
    assert.equal(spatialMove(rects, 2, "right"), 2, "nothing further right: stay");
    assert.equal(spatialMove(rects, 0, "up"), 0);
    assert.equal(spatialMove(rects, 5, "down"), 6, "down from the grid reaches the button");
    assert.equal(spatialMove(rects, 6, "up"), 4, "and back up to the nearest tile in line");
    assert.equal(spatialMove(rects, 0, "sideways"), 0);
  });
});
