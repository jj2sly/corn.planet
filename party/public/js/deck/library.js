// Steam My Deck: the CPI handheld's game library, as data. The games come from the server's
// registry (/api/config `games`, each with its optional `deck` entry): this only tidies them up for
// the screens, so a newly registered game appears in the library, the title cards and the launch
// without any change here. No DOM in this file (the tests run it in Node).

export const PLATFORM = "STEAM MY DECK";
export const PLATFORM_NAME = "Steam My Deck";
export const OS_VERSION = "KERNEL OS 4.20";

/**
 * Agents' colours, by join order: the same palette, in the same order, the games dress everyone in
 * (server/games/steamdeck/game.ts and thud/game.ts `COLORS`), so the colour you have in the hub is the
 * one you play in. The tests check they match.
 */
export const AGENT_COLORS = Object.freeze(["#ffd400", "#4dd4ff", "#ff5fa2", "#7dff6a", "#ff9a3d", "#b58cff", "#f4f4f4", "#ff4d4d"]);

/** The library's shelves, in the order they're shown. */
export const SHELVES = Object.freeze([
  { id: "handheld", label: "HANDHELD", blurb: "Runs on the Deck itself, on every screen" },
  { id: "party", label: "PARTY", blurb: "The big screen plus everyone's phones" },
]);

/** Covers for a game that didn't bring its own art: picked from its id, so they never change. */
const FALLBACK_ART = [
  { from: "#26303d", to: "#07090c", accent: "#9ecbff", motif: "grid" },
  { from: "#3a2a12", to: "#0d0904", accent: "#ffc36b", motif: "stripes" },
  { from: "#123330", to: "#040c0b", accent: "#6bf0d8", motif: "dots" },
  { from: "#35163a", to: "#0c050d", accent: "#f08bff", motif: "rays" },
];
const MOTIFS = new Set(["grid", "rays", "stripes", "dots", "scan"]);
const HEX = /^#[0-9a-f]{6}$/i;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** "2–8 players", "3+ players", "1 player". */
export function playersLabel(min, max) {
  if (!Number.isFinite(min)) return "";
  if (!Number.isFinite(max) || max === min) return `${min} player${min === 1 ? "" : "s"}`;
  return `${min}–${max} players`;
}

/** Up to three initials from a title, for a cover with no glyph ("Corn Planet Draw" → "CPD"). */
export function initials(title) {
  return String(title)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** One registered game (a /api/config `games` item) as a library entry. Never throws. */
export function libraryEntry(game) {
  const deck = game?.deck ?? null;
  const id = String(game?.id ?? "");
  const title = String(game?.name || id || "Untitled");
  const fallback = FALLBACK_ART[hash(id) % FALLBACK_ART.length];
  const art = deck?.art ?? {};
  const pick = (value, other) => (typeof value === "string" && HEX.test(value) ? value : other);
  return Object.freeze({
    id,
    title,
    tagline: String(game?.tagline ?? ""),
    description: String(game?.description ?? ""),
    minPlayers: Number(game?.minPlayers) || 1,
    maxPlayers: Number(game?.maxPlayers) || Number(game?.minPlayers) || 1,
    players: playersLabel(Number(game?.minPlayers) || 1, Number(game?.maxPlayers) || Number(game?.minPlayers) || 1),
    shelf: deck?.shelf === "handheld" ? "handheld" : "party",
    genre: typeof deck?.genre === "string" && deck.genre ? deck.genre : "Party game",
    length: typeof deck?.length === "string" ? deck.length : "",
    controls: Array.isArray(deck?.controls) ? deck.controls.filter((c) => typeof c === "string" && c) : [],
    art: Object.freeze({
      from: pick(art.from, fallback.from),
      to: pick(art.to, fallback.to),
      accent: pick(art.accent, fallback.accent),
      glyph: typeof art.glyph === "string" && art.glyph ? art.glyph : initials(title),
      motif: MOTIFS.has(art.motif) ? art.motif : fallback.motif,
    }),
  });
}

/** The whole library: handheld games first, then party games, each shelf in registry order. */
export function libraryFrom(games) {
  const entries = (Array.isArray(games) ? games : []).filter((g) => g && g.id).map(libraryEntry);
  return SHELVES.flatMap((s) => entries.filter((e) => e.shelf === s.id));
}

// ------------------------------------------------------------------ the installed library

let installed = [];

/** Installs the registry's games (from /api/config) as this page's library. */
export function setLibrary(games) {
  installed = libraryFrom(games);
  return installed;
}

export const library = () => installed;

/** A game's library entry, or null if it isn't installed. */
export function gameInfo(id) {
  return installed.find((e) => e.id === id) ?? null;
}

/** A game's title, as the library knows it; `fallback` before the library has loaded. */
export function titleOf(id, fallback = "") {
  return gameInfo(id)?.title ?? fallback;
}

// ------------------------------------------------------------------ recently played

/** The recent list with `id` played just now: newest first, no repeats, at most `max`. */
export function withRecent(list, id, max = 6) {
  const ids = (Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && x && x !== id);
  return id ? [id, ...ids].slice(0, max) : ids.slice(0, max);
}

/**
 * The home screen's shelf: the selected game, then recently played ones, then everything else
 * installed. Ids that aren't installed any more are skipped.
 */
export function homeOrder(entries, recent = [], selectedId = null) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out = [];
  const add = (id) => {
    const e = byId.get(id);
    if (e && !out.includes(e)) out.push(e);
  };
  add(selectedId);
  for (const id of recent) add(id);
  for (const e of entries) add(e.id);
  return out;
}

// ------------------------------------------------------------------ navigation

/** The hub's pages, in the order the device's menu bar shows them. The host has AGENTS for PROFILE. */
export function pagesFor(role) {
  return [
    { id: "home", label: "HOME", icon: "⌂" },
    { id: "library", label: "LIBRARY", icon: "▦" },
    role === "host" ? { id: "profile", label: "AGENTS", icon: "☺" } : { id: "profile", label: "PROFILE", icon: "☺" },
    { id: "settings", label: "SETTINGS", icon: "⚙" },
  ];
}

const DIRS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/**
 * Spatial navigation: from the item at `from`, the nearest item in direction `dir` (an arrow key
 * name or left / right / up / down). `rects` are the items' boxes ({ x, y, w, h }); returns an index,
 * or `from` when nothing lies that way. Items mostly in line with the move win over nearer ones
 * off to the side, so a grid moves by rows and columns.
 */
export function spatialMove(rects, from, dir) {
  const d = DIRS[dir];
  const a = rects[from];
  if (!d || !a) return from;
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  let best = from;
  let bestScore = Infinity;
  rects.forEach((b, i) => {
    if (i === from || !b) return;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const along = (bx - ax) * d[0] + (by - ay) * d[1];
    if (along <= 1) return;
    // How far off the line of travel it is, relative to the item's own size.
    const across = Math.abs((bx - ax) * d[1] + (by - ay) * d[0]);
    const overlap = d[0] ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const score = along + across * (overlap > 0 ? 0.5 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
