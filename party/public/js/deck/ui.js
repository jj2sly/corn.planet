// Steam My Deck: the pieces every screen shares. Game covers, title cards, the launch, agents'
// avatars, the settings page and the in-game quick menu behind every device's KERNEL button.
// Games get all of it for free: the shells (host.js, play.js) install the library and the menu once,
// and a game only registers itself on the server (its `deck` entry) and, if it likes, exports a
// `cover` painter from its renderer modules. Sound is the party's one sound manager (mycob-sound.js).

import { el, store } from "../common.js";
import { characterCanvas, createCharacter } from "../cpi/character.js";
import { setHomeHandler } from "../cpi/handheld.js";
import { fitCanvas } from "../drawing-canvas.js";
import { getSfxVolume, getVolume, isMuted, playSfx, setMuted, setSfxVolume, setVolume } from "../games/mycob-sound.js";
import { AGENT_COLORS, gameInfo, library, OS_VERSION, PLATFORM, PLATFORM_NAME, withRecent } from "./library.js";

export const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** The CPI KERNEL logo: a corn kernel (styled in party.css). */
export const kernelLogo = (cls = "") => el("span", { class: `cpi-hh-kernel ${cls}`.trim(), "aria-hidden": "true" });

// ------------------------------------------------------------------ covers

const painters = new Map();

/**
 * Cover painters, by game id: a shell's renderer modules ({ id: module }), each of which may export
 * `cover(ctx, { width, height })`, or plain painter functions.
 */
export function setCoverPainters(map) {
  for (const [id, entry] of Object.entries(map ?? {})) {
    const fn = typeof entry === "function" ? entry : entry?.cover;
    if (typeof fn === "function") painters.set(id, fn);
  }
}

// Painted covers are drawn once, then again only when their size changes (no animation loop).
const painted = new Set();
const shown = new WeakSet();
const paintOf = new WeakMap();
const coverObserver =
  typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => {
        for (const e of entries) paintCover(e.target);
      })
    : null;

function paintCover(canvas) {
  if (!canvas.isConnected) {
    coverObserver?.unobserve(canvas);
    painted.delete(canvas);
    return;
  }
  const { width, height, dpr } = fitCanvas(canvas, 2);
  if (width < 2 || height < 2) return;
  shown.add(canvas);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  try {
    paintOf.get(canvas)?.(ctx, { width, height });
  } catch {
    // A painter that throws leaves the plain cover showing.
  }
}

function watchCover(canvas, painter) {
  // Forget covers that were on the page and have left it (not ones still being built).
  for (const c of painted) if (!c.isConnected && shown.has(c)) (coverObserver?.unobserve(c), painted.delete(c));
  paintOf.set(canvas, painter);
  painted.add(canvas);
  if (coverObserver) coverObserver.observe(canvas);
  else requestAnimationFrame(() => paintCover(canvas));
}

/**
 * A game's cover: its colours, pattern and glyph, the game's own painting over them if it has one,
 * the title, and a shelf badge. `size`: "mini" | "tile" | "card" | "hero".
 */
export function cover(info, { size = "tile", label = true } = {}) {
  const painter = painters.get(info.id);
  const node = el("div", { class: `deck-cover s-${size} m-${info.art.motif} ${painter ? "painted" : ""}`.trim(), role: "img", "aria-label": `${info.title} cover art` });
  node.style.setProperty("--from", info.art.from);
  node.style.setProperty("--to", info.art.to);
  node.style.setProperty("--accent", info.art.accent);
  node.append(el("span", { class: "deck-cover-glyph", "aria-hidden": "true", text: info.art.glyph }));
  if (painter) {
    const canvas = el("canvas", { class: "deck-cover-art", "aria-hidden": "true" });
    node.append(canvas);
    watchCover(canvas, painter);
  }
  node.append(el("span", { class: "deck-cover-shine", "aria-hidden": "true" }));
  if (label) node.append(el("span", { class: "deck-cover-title", "aria-hidden": "true", text: info.title }));
  node.append(el("span", { class: `deck-cover-badge ${info.shelf}`, "aria-hidden": "true", text: info.shelf === "handheld" ? "HANDHELD" : "PARTY" }));
  return node;
}

/** The small facts under a title: shelf, genre, players, length. */
export function facts(info) {
  return el(
    "ul",
    { class: "deck-facts", "aria-label": "About this game" },
    el("li", { class: `deck-fact shelf ${info.shelf}`, text: info.shelf === "handheld" ? "HANDHELD" : "PARTY" }),
    el("li", { class: "deck-fact", text: info.genre }),
    el("li", { class: "deck-fact", text: info.players }),
    info.length ? el("li", { class: "deck-fact", text: info.length }) : null,
  );
}

/**
 * A title card: the game as you'd see it selected on a handheld. `actions` go right under the title
 * (the launch is never below the fold), then `note`, `extra` (say, the game's options), the controls
 * and the description.
 */
export function titleCard(info, { actions = [], note = null, extra = [], selected = false } = {}) {
  return el(
    "article",
    { class: `deck-card ${selected ? "selected" : ""}`.trim(), "aria-labelledby": `deck-card-${info.id}` },
    el("div", { class: "deck-card-art" }, cover(info, { size: "card", label: false })),
    el(
      "div",
      { class: "deck-card-body" },
      el("p", { class: "deck-kicker", text: selected ? "SELECTED GAME" : "GAME DETAILS" }),
      el("h2", { class: "deck-card-title", id: `deck-card-${info.id}`, tabindex: "-1", text: info.title }),
      el("p", { class: "deck-card-tagline", text: info.tagline }),
      facts(info),
      actions.length ? el("div", { class: "deck-actions" }, actions) : null,
      note,
      ...extra,
      info.controls.length ? el("section", { class: "deck-card-section" }, el("h3", { text: "CONTROLS" }), el("ul", { class: "deck-controls" }, info.controls.map((c) => el("li", { text: c })))) : null,
      info.description ? el("section", { class: "deck-card-section" }, el("h3", { text: "ABOUT" }), el("p", { class: "deck-card-desc", text: info.description })) : null,
    ),
  );
}

// ------------------------------------------------------------------ the launch

/**
 * The launch: the Deck opens the game with a short splash (its cover, title and a loading bar) over
 * the whole page while the game gets going underneath. Tap or any key skips it. Resolves when gone.
 */
export function playLaunch(info, { ms = 1600 } = {}) {
  document.querySelector(".deck-launch")?.remove();
  const total = reducedMotion() ? 700 : ms;
  const fill = el("span", { class: "deck-launch-fill" });
  fill.style.setProperty("--ms", `${Math.max(300, total - 300)}ms`);
  const node = el(
    "div",
    { class: "deck-launch", role: "status", "aria-live": "polite" },
    el(
      "div",
      { class: "deck-launch-inner" },
      el("p", { class: "deck-launch-brand" }, kernelLogo(), el("span", { text: PLATFORM })),
      cover(info, { size: "hero", label: false }),
      el("p", { class: "deck-launch-now", text: "NOW LAUNCHING" }),
      el("p", { class: "deck-launch-title", text: info.title }),
      el("span", { class: "deck-launch-bar" }, fill),
    ),
  );
  node.style.setProperty("--accent", info.art.accent);
  document.body.append(node);
  playSfx("device_boot");
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      removeEventListener("keydown", finish, true);
      node.classList.add("leaving");
      setTimeout(() => node.remove(), 260);
      resolve();
    };
    const timer = setTimeout(finish, total);
    node.addEventListener("pointerdown", finish);
    addEventListener("keydown", finish, true);
  });
}

// ------------------------------------------------------------------ recently played (this device)

const RECENT_KEY = "cpst-party:deck-recent";
export const recentGames = () => {
  const list = store.get("localStorage", RECENT_KEY);
  return Array.isArray(list) ? list : [];
};
export function rememberPlayed(id) {
  store.set("localStorage", RECENT_KEY, withRecent(recentGames(), id));
}

// ------------------------------------------------------------------ agents

/**
 * An agent's CPI character in the hub: their look comes from their name (so it's the same every
 * session) and their colour from their place in the room (the one the games give them).
 */
export function agentCharacter(player, index = 0) {
  const name = String(player?.name ?? "Agent");
  return createCharacter({ id: `agent:${name.toLowerCase()}`, name, color: AGENT_COLORS[Math.max(0, index) % AGENT_COLORS.length] });
}

export function avatar(player, index, { size = 40, state = "idle" } = {}) {
  return characterCanvas(agentCharacter(player, index), { size, state, label: `${player?.name ?? "Agent"}'s CPI character` });
}

// ------------------------------------------------------------------ settings

function slider(label, value, onInput) {
  const id = `deck-${label.toLowerCase().replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
  const input = el("input", { id, type: "range", min: "0", max: "100", step: "5", value: String(Math.round(value * 100)), class: "deck-range" });
  const out = el("output", { class: "deck-range-value mono", for: id, text: `${Math.round(value * 100)}%` });
  input.addEventListener("input", () => {
    out.textContent = `${input.value}%`;
    onInput(Number(input.value) / 100);
  });
  return el("div", { class: "deck-setting" }, el("label", { for: id, text: label }), input, out);
}

/** Mute, the master volume and the effects volume: the sound manager's own settings, remembered on this device. */
export function soundSettings({ compact = false } = {}) {
  const mute = el("button", { class: "deck-switch", type: "button", role: "switch", "data-nav": "" });
  const paint = () => {
    mute.setAttribute("aria-checked", String(!isMuted()));
    mute.replaceChildren(el("span", { class: "deck-switch-knob", "aria-hidden": "true" }), el("span", { text: isMuted() ? "SOUND OFF" : "SOUND ON" }));
  };
  mute.addEventListener("click", () => {
    setMuted(!isMuted());
    paint();
    playSfx("ui_click");
  });
  paint();
  const master = slider("Master volume", getVolume(), (v) => {
    setVolume(v);
    if (isMuted() && v > 0) (setMuted(false), paint());
  });
  master.querySelector("input").addEventListener("change", () => playSfx("ui_click"));
  const effects = slider("Effects", getSfxVolume(), (v) => setSfxVolume(v));
  effects.querySelector("input").addEventListener("change", () => playSfx("achievement", { volume: 0.7 }));
  return el("div", { class: `deck-sound ${compact ? "compact" : ""}`.trim(), role: "group", "aria-label": "Sound" }, mute, master, compact ? null : effects);
}

const NAV_HELP = [
  ["Move", "D-pad · arrow keys · or just tap"],
  ["Select", "A · Enter"],
  ["Back", "B · Esc"],
  ["Pages", "The menu bar under the screen · 1–4"],
];

/** The hub's SETTINGS page: sound, how to drive the Deck, motion, and what's installed. */
export function settingsPanel() {
  const motion = reducedMotion();
  return el(
    "div",
    { class: "deck-settings" },
    el("section", { class: "deck-panel" }, el("h3", { text: "SOUND" }), soundSettings(), el("p", { class: "deck-hint", text: "Saved on this device. Effects are the in-game clicks, jumps and crashes." })),
    el(
      "section",
      { class: "deck-panel" },
      el("h3", { text: "CONTROLS" }),
      el("table", { class: "deck-keys" }, el("tbody", {}, NAV_HELP.map(([what, how]) => el("tr", {}, el("th", { scope: "row", text: what }), el("td", { text: how }))))),
      el("p", { class: "deck-hint", text: "Each game's own controls are on its title card." }),
    ),
    el(
      "section",
      { class: "deck-panel" },
      el("h3", { text: "MOTION" }),
      el("p", { class: "deck-hint", text: motion ? "Reduced motion is on (from your device's settings): no zooms, shakes or slides." : "Follows your device's Reduce Motion setting. It's off, so the Deck animates." }),
    ),
    el(
      "section",
      { class: "deck-panel about" },
      el("h3", { text: "ABOUT THIS DECK" }),
      el("p", { class: "deck-about" }, kernelLogo(), el("span", { text: `${PLATFORM_NAME} · ${OS_VERSION}` })),
      el("p", { class: "deck-hint", text: `${library().length} games installed. Warranty void if shaken (it will be shaken).` }),
    ),
  );
}

// ------------------------------------------------------------------ the quick menu (KERNEL button)

let system = null;

/**
 * What the quick menu can do right now, from the shell: { gameId, canEnd, end(), leave() }. `end`
 * takes everyone back to Steam My Deck; `leave` leaves the session (phones). null outside a game.
 */
export function setSystem(context) {
  system = context;
}

let dialog = null;

/** Opens the quick menu: resume, sound, controls, and the ways back to Steam My Deck. */
export function openQuickMenu() {
  dialog?.close();
  dialog?.remove();
  const ctx = system;
  const info = ctx?.gameId ? gameInfo(ctx.gameId) : null;
  const note = el("p", { class: "deck-hint" });
  const close = () => dialog?.close();
  const resume = el("button", { class: "deck-btn go", type: "button", text: info ? "▶ RESUME" : "CLOSE", onclick: close });
  const endBtn =
    ctx?.canEnd && ctx.end
      ? el("button", {
          class: "deck-btn warn",
          type: "button",
          text: `⌂ END GAME · BACK TO ${PLATFORM}`,
          onclick: async () => {
            if (!confirm(`End ${info?.title ?? "this game"} for everyone and go back to ${PLATFORM_NAME}? Scores from this game won't be saved.`)) return;
            const result = await ctx.end();
            if (result?.ok === false) note.textContent = result.message ?? "That didn't work.";
            else close();
          },
        })
      : null;
  const leaveBtn = ctx?.leave ? el("button", { class: "deck-btn ghost", type: "button", text: "Leave session", onclick: async () => ((await ctx.leave()) ? close() : null) }) : null;
  dialog = el(
    "dialog",
    { class: "deck-menu", "aria-labelledby": "deck-menu-title" },
    el("div", { class: "deck-menu-head" }, kernelLogo(), el("span", { class: "deck-menu-brand", text: PLATFORM }), el("span", { class: "deck-menu-sub", text: "QUICK MENU" })),
    el("h2", { class: "deck-menu-title", id: "deck-menu-title", text: info?.title ?? PLATFORM_NAME }),
    info ? el("p", { class: "deck-hint", text: info.tagline }) : null,
    el("div", { class: "deck-actions stack-actions" }, resume, endBtn),
    ctx?.gameId && !ctx.canEnd ? el("p", { class: "deck-hint", text: "The host or the session leader can end the game and take everyone back." }) : null,
    el("section", { class: "deck-panel" }, el("h3", { text: "SOUND" }), soundSettings({ compact: true })),
    info?.controls.length ? el("section", { class: "deck-panel" }, el("h3", { text: "CONTROLS" }), el("ul", { class: "deck-controls" }, info.controls.map((c) => el("li", { text: c })))) : null,
    leaveBtn,
    note,
  );
  dialog.addEventListener("close", () => dialog?.remove());
  // Keys pressed in the menu stay in the menu: the game underneath doesn't aim or jump.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  dialog.addEventListener("click", (e) => e.target === dialog && close());
  document.body.append(dialog);
  dialog.showModal?.() ?? dialog.setAttribute("open", "");
  resume.focus();
  playSfx("ui_click");
}

/** Makes every device's KERNEL button open the quick menu (games don't have to do anything). */
export function installQuickMenu() {
  setHomeHandler(() => openQuickMenu(), `${PLATFORM_NAME} menu`);
}

/** A button for chrome outside a device (a phone's top bar) that opens the quick menu. */
export function quickMenuButton() {
  return el("button", { class: "deck-menu-btn", type: "button", "aria-label": `${PLATFORM_NAME} menu`, title: `${PLATFORM_NAME} menu`, onclick: openQuickMenu }, kernelLogo(), el("span", { text: "MENU" }));
}
