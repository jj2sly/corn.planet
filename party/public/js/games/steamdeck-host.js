// Escape Thad's Steam Deck on the big screen: who's Thad, the level, the world live (leaning with
// Thad's tilt), and each round's results. Sounds go through the My Cob sound manager.

import { el, timerEl } from "../common.js";
import { playNewCues, preloadSounds, soundControl } from "./mycob-sound.js";
import { createWorldView } from "./steamdeck-world.js";

const PHASE_TITLE = {
  ASSIGNMENT: "ROLES ASSIGNED",
  INTRO: "GET READY",
  ESCAPE: "ESCAPE!",
  ESCALATION: "THAD IS ANGRY",
  FINAL: "FINAL ESCAPE WINDOW",
  RESULTS: "ROUND OVER",
};

function header(g, timer) {
  const slot = el("div", {}, timerEl(timer));
  const node = el(
    "div",
    { class: "phase-head" },
    el("div", {}, el("p", { class: "eyebrow", text: `Round ${g.round} of ${g.totalRounds} · ${g.level.name}` }), el("h1", { class: `sd-title p-${g.phase}`, text: PHASE_TITLE[g.phase] })),
    el("div", { class: "row" }, slot, soundControl()),
  );
  return { node, setTimer: (t) => slot.replaceChildren(timerEl(t)) };
}

function rosterChips(g) {
  return el(
    "ul",
    { class: "sd-roster" },
    g.roster.map((r) =>
      el(
        "li",
        { class: r.escapedMs !== null ? "out" : "" },
        el("span", { class: "sd-swatch", "aria-hidden": "true" }),
        r.name,
        el("span", { class: "muted", text: r.escapedMs !== null ? ` ✓ ${(r.escapedMs / 1000).toFixed(1)}s` : r.deaths ? ` 💀${r.deaths}` : "" }),
      ),
    ),
  );
}

/** Paints each chip's swatch in the runner's colour (CSSOM, not a style attribute: CSP). */
function paintSwatches(node, g) {
  node.querySelectorAll(".sd-swatch").forEach((s, i) => s.style.setProperty("background", g.roster[i]?.color ?? "#fff"));
  return node;
}

function screen(s, nodes, onUpdate) {
  const node = el("div", { class: "stack sd-host" }, ...nodes);
  preloadSounds();
  playNewCues(`steamdeck:${s.game.session}`, s.game.cues, { fresh: s.game.phase === "ASSIGNMENT" && s.game.round === 1 });
  return {
    node,
    update(next) {
      playNewCues(`steamdeck:${next.game.session}`, next.game.cues);
      onUpdate?.(next);
    },
  };
}

function buildAssignment(s) {
  const g = s.game;
  const head = header(g, s.timer);
  return screen(
    s,
    [
      head.node,
      el("p", { class: "sd-thad" }, "🎮 Thad this round: ", el("strong", { text: g.thad.name })),
      el("p", { class: "muted", text: "Everyone else is trapped inside the Steam Deck. Get to the EXIT." }),
      paintSwatches(rosterChips(g), g),
      el(
        "ul",
        { class: "sd-howto" },
        el("li", { text: "Runners: ◀ ▶ / ← → to move, JUMP / Space to jump, ✏️ / E for a plank across a gap." }),
        el("li", { text: "Thad: lean the whole level with ← → or the slider. It gets worse every phase." }),
        el("li", { text: "Red spikes kill. Dashed red boxes are spikes that haven't arrived yet." }),
      ),
    ],
    (next) => head.setTimer(next.timer),
  );
}

function bannerFor(g) {
  if (g.phase === "INTRO") return el("p", { class: "sd-banner", text: `${g.level.name}: ${g.level.tagline}` });
  if (g.phase === "ESCALATION") return el("p", { class: "sd-banner warn", text: "ESCALATION: more tilt, more spikes." });
  if (g.phase === "FINAL") return el("p", { class: "sd-banner danger", text: "FINAL WINDOW: get out now." });
  return null;
}

// One build from the intro to the final window, so the canvas and its animation carry straight on.
function buildWorld(s) {
  const g = s.game;
  let phase = g.phase;
  let head = header(g, s.timer);
  const top = el("div", { class: "stack" }, head.node, bannerFor(g));
  const canvas = el("canvas", { class: "sd-canvas", "aria-label": `${g.level.name}: the level, live` });
  const view = createWorldView(canvas, { rotate: true, labels: true });
  view.update(g);
  const chips = el("div", {}, paintSwatches(rosterChips(g), g));
  return screen(s, [top, el("div", { class: "sd-stage" }, canvas), chips], (next) => {
    if (next.game.phase !== phase) {
      phase = next.game.phase;
      head = header(next.game, next.timer);
      top.replaceChildren(head.node, ...[bannerFor(next.game)].filter(Boolean));
    }
    head.setTimer(next.timer);
    view.update(next.game);
    chips.replaceChildren(paintSwatches(rosterChips(next.game), next.game));
  });
}

function buildResults(s) {
  const g = s.game;
  const head = header(g, s.timer);
  const points = g.results?.points ?? {};
  const escaped = g.roster.filter((r) => r.escapedMs !== null).sort((a, b) => a.escapedMs - b.escapedMs);
  const trapped = g.roster.filter((r) => r.escapedMs === null);
  const verdict = !g.roster.length ? "" : escaped.length === g.roster.length ? "Everyone got out. Thad is furious." : escaped.length === 0 ? "Nobody got out. Thad wins. Thad is insufferable." : "Some got out. Thad is only mildly smug.";
  return screen(
    s,
    [
      head.node,
      el("p", { class: "sd-verdict", text: verdict }),
      el(
        "div",
        { class: "sd-results" },
        el(
          "section",
          {},
          el("h2", { text: "Escaped" }),
          escaped.length
            ? el("ol", { class: "list" }, escaped.map((r) => el("li", {}, el("span", { class: "grow", text: r.name }), el("span", { class: "mono", text: `${(r.escapedMs / 1000).toFixed(1)}s · +${points[r.id] ?? 0}` }))))
            : el("p", { class: "muted", text: "Nobody." }),
        ),
        el(
          "section",
          {},
          el("h2", { text: "Still inside" }),
          trapped.length
            ? el("ul", { class: "list" }, trapped.map((r) => el("li", {}, el("span", { class: "grow", text: r.name }), el("span", { class: "mono", text: `💀 ${r.deaths}` }))))
            : el("p", { class: "muted", text: "Nobody." }),
        ),
        el("section", {}, el("h2", { text: "Thad" }), el("p", {}, el("strong", { text: g.thad.name }), ` +${points[g.thad.id] ?? 0}`)),
      ),
      el("p", { class: "muted", text: g.round < g.totalRounds ? "Next round: someone new holds the Deck." : "Final scores next." }),
    ],
    (next) => head.setTimer(next.timer),
  );
}

const BUILDERS = { ASSIGNMENT: buildAssignment, INTRO: buildWorld, ESCAPE: buildWorld, ESCALATION: buildWorld, FINAL: buildWorld, RESULTS: buildResults };

const GROUP = { INTRO: "play", ESCAPE: "play", ESCALATION: "play", FINAL: "play" };

export function render(mount, state) {
  const g = state.game;
  const build = BUILDERS[g.phase];
  if (build) mount(`steamdeck:${g.session}:${g.round}:${GROUP[g.phase] ?? g.phase}`, build, state);
}
