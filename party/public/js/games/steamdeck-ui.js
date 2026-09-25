// Escape Thad's Steam Deck: the presentation both screens share. The launch sequence, level and
// phase cards, the round report, and the CPI humour, all shown inside the CPI handheld
// (cpi/handheld.js). Words and pictures only: nothing here decides anything about the game.

import { el } from "../common.js";
import { characterCanvas, createCharacter, hashString } from "../cpi/character.js";
import { bootScreen, systemCard } from "../cpi/handheld.js";

export const TITLE = "ESCAPE THAD'S STEAM DECK";

export const PHASE_TITLE = {
  ASSIGNMENT: "ROLES ASSIGNED",
  INTRO: "GET READY",
  ESCAPE: "ESCAPE!",
  ESCALATION: "THAD IS ANGRY",
  FINAL: "FINAL ESCAPE WINDOW",
  RESULTS: "ROUND OVER",
};

export const PHASE_SHORT = { ASSIGNMENT: "Roles", INTRO: "Get ready", ESCAPE: "Escape!", ESCALATION: "Thad is angry", FINAL: "Final window", RESULTS: "Round over" };

export const PLAYING = ["ESCAPE", "ESCALATION", "FINAL"];

/** How long each play phase lasts, for the battery. Mirrors the server's TIMING (display only). */
const PLAY_MS = { ESCAPE: 35_000, ESCALATION: 25_000, FINAL: 15_000 };

/**
 * The Deck's battery is the round's clock: full until play starts, draining to empty as the escape
 * window closes. `timer` is the room timer ({ remainingMs, totalMs }).
 */
export function battery(phase, timer) {
  if (!PLAYING.includes(phase)) return phase === "RESULTS" ? 0.03 : 1;
  const total = PLAY_MS.ESCAPE + PLAY_MS.ESCALATION + PLAY_MS.FINAL;
  const before = PLAYING.slice(0, PLAYING.indexOf(phase)).reduce((n, p) => n + PLAY_MS[p], 0);
  const done = before + Math.max(0, (timer?.totalMs ?? PLAY_MS[phase]) - (timer?.remainingMs ?? 0));
  return Math.max(0.03, 1 - done / total);
}

/**
 * A countdown that's built once and re-aimed on every state (common.js keeps [data-deadline]
 * elements ticking), instead of a new element 20 times a second.
 */
export function liveTimer({ label = "Time remaining", compact = false } = {}) {
  const value = el("span", { class: "value" });
  const unit = el("span", { class: "unit", text: "SEC" });
  const node = el("span", { class: `timer ${compact ? "compact" : ""}`.trim(), role: "timer", "aria-label": label }, value, unit);
  let deadline = 0;
  return {
    node,
    set(timer) {
      node.hidden = !timer;
      if (!timer) return delete node.dataset.deadline;
      const next = Date.now() + timer.remainingMs;
      // Only re-aim on a real change: the countdown shouldn't jitter with network timing.
      if (Math.abs(next - deadline) > 400 || node.dataset.paused !== String(timer.paused)) {
        deadline = next;
        node.dataset.deadline = String(next);
        node.dataset.paused = String(timer.paused);
        if (!value.textContent) value.textContent = String(Math.ceil(timer.remainingMs / 1000));
      }
    },
  };
}

/** Everyone's character, Thad included, from what the game view already carries. */
export function castOf(g) {
  const cast = new Map(g.roster.map((r) => [r.id, createCharacter({ id: r.id, name: r.name, color: r.color })]));
  cast.set(g.thad.id, createCharacter({ id: g.thad.id, name: g.thad.name, color: g.thad.color }));
  return cast;
}

/** Keeps a set of badge canvases animating while they're on screen. */
export function animateBadges(badges) {
  const t0 = performance.now();
  const loop = () => {
    const live = badges.filter((b) => b.canvas.isConnected);
    if (!live.length) return;
    const t = (performance.now() - t0) / 1000;
    for (const b of live) b.canvas.paint({ state: b.state, t: t + (b.offset ?? 0), clock: t + (b.offset ?? 0), cycle: t * 2 });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** A character badge with its name under it. */
export function badge(ch, { size = 56, state = "idle", note = "" } = {}) {
  const canvas = characterCanvas(ch, { size, state });
  const node = el("figure", { class: "sd-badge" }, canvas, el("figcaption", {}, el("span", { class: "sd-badge-name", text: ch.name }), note ? el("span", { class: "sd-badge-note", text: note }) : null));
  node.style.setProperty("--agent", ch.colors.suit);
  return { node, canvas, state };
}

// ------------------------------------------------------------------ launch

const BOOT_LINES = (g) => [
  "CHECKING CORN LEVELS ........ OK",
  "MOUNTING THAD.SYS ........... OK",
  `OCCUPANTS DETECTED .......... ${g.roster.length}`,
  "GRAVITY ..................... OPTIONAL",
];

/**
 * The launch: the handheld boots, the game launches, the occupants are introduced, then the title.
 * `short` (a new round, or a phone) skips the boot. Returns handheld sequence steps.
 */
export function launchSteps(g, { short = false, size = 64, onBoot } = {}) {
  const cast = castOf(g);
  const steps = [];
  if (!short) steps.push({ ms: 1500, cls: "boot", render: () => bootScreen({ lines: BOOT_LINES(g), ms: 1300 }), enter: onBoot });
  steps.push({
    ms: 1000,
    cls: "launch",
    render: () => el("div", { class: "sd-launch" }, el("div", { class: "sd-cover" }, el("span", { class: "sd-cover-kicker", text: "CPI KERNEL EXCLUSIVE" }), el("span", { class: "sd-cover-title", text: TITLE })), el("p", { class: "sd-launch-note", text: "LAUNCHING…" })),
  });
  steps.push({
    ms: 2600,
    cls: "occupants",
    render: () => {
      const runners = g.roster.map((r, i) => {
        const b = badge(cast.get(r.id), { size, state: "idle" });
        b.node.style.setProperty("--i", String(i));
        return b;
      });
      const thad = badge(cast.get(g.thad.id), { size: Math.round(size * 1.15), state: "cheer", note: "HOLDS THE DECK" });
      thad.node.classList.add("is-thad");
      animateBadges([...runners, thad].map((b, i) => ({ ...b, offset: i * 0.37 })));
      return el(
        "div",
        { class: "sd-occupants" },
        el("p", { class: "cpi-card-eyebrow", text: "OCCUPANTS DETECTED" }),
        el("div", { class: "sd-occupant-row" }, runners.map((b) => b.node)),
        el("div", { class: "sd-held" }, el("span", { class: "sd-held-label", text: "HELD BY" }), thad.node),
      );
    },
  });
  steps.push({
    ms: 1700,
    cls: "title",
    render: () =>
      el(
        "div",
        { class: "sd-title-card" },
        el("p", { class: "sd-logo" }, el("span", { class: "a", text: "ESCAPE" }), el("span", { class: "b", text: "THAD'S" }), el("span", { class: "c", text: "STEAM DECK" })),
        el("p", { class: "sd-logo-sub", text: `Round ${g.round} of ${g.totalRounds} · ${g.level.name}` }),
      ),
  });
  return steps;
}

/** The strip along the bottom of the screen while roles are assigned. */
export function assignmentBand(g) {
  const role = g.you?.role;
  const tag = role === "thad" ? "YOU'RE THAD" : role === "runner" ? "YOU'RE INSIDE" : `ROUND ${g.round}`;
  const line =
    role === "thad"
      ? "You hold the Deck. Lean it: ← → , hold L / R, or the slider."
      : role === "runner"
        ? `${g.thad.name} holds the Deck. Reach the EXIT.`
        : `${g.thad.name} holds the Deck. Everyone else: reach the EXIT.`;
  return el("div", { class: "sd-band" }, el("span", { class: "sd-band-tag", text: tag }), el("span", { text: line }));
}

/** The level's title card (the intro); `howto` lines go under it on the big screen. */
export function levelCard(g, { howto = [] } = {}) {
  return systemCard({
    eyebrow: `LEVEL ${g.round} OF ${g.totalRounds} · LOADING`,
    title: g.level.name,
    text: g.level.tagline,
    kind: "level",
    children: [howto.length ? el("ul", { class: "sd-howto" }, howto.map((line) => el("li", { text: line }))) : null, el("p", { class: "sd-ready", text: "GET READY" })],
  });
}

/** What a phase change says in the device's notification bar. */
export function phaseNotice(g) {
  if (g.phase === "ESCAPE") return { text: "GO! Reach the EXIT", kind: "ok", icon: "▶" };
  if (g.phase === "ESCALATION") return { text: `THAD IS ANGRY · ${g.world.maxTilt}° · more spikes`, kind: "warn", icon: "⚠" };
  if (g.phase === "FINAL") return { text: `FINAL WINDOW · ${g.world.maxTilt}° · get out`, kind: "danger", icon: "⚠" };
  if (g.phase === "RESULTS") return { text: "Round over · report filed", kind: "info", icon: "■" };
  return null;
}

/** How many hazards arrive with the next phase (for warnings). */
export function incoming(g) {
  return g.level.hazards.filter((h) => !h[4]).length;
}

// ------------------------------------------------------------------ results

const OUT_QUIPS = ["Filed an exit interview.", "Left without saying goodbye.", "Out. Refuses to talk about it.", "Escaped with minor corn damage.", "Now banned from the Deck."];
const IN_QUIPS = ["Now lives in the Deck.", "Assigned to the Deck permanently.", "Will be fixed in a future update.", "Listed as 'installed'.", "Has been added to Thad's library."];

/** A line for a runner's outcome: the same one on every screen. */
export function quip(id, escaped, round = 1) {
  const list = escaped ? OUT_QUIPS : IN_QUIPS;
  return list[(hashString(String(id)) + round) % list.length];
}

export function verdict(g) {
  const out = g.roster.filter((r) => r.escapedMs !== null).length;
  const all = g.roster.length;
  if (!all) return { stamp: "NO OCCUPANTS", line: "Nobody was inside. Thad tilted an empty Deck.", kind: "" };
  if (out === all) return { stamp: "ALL AGENTS EXTRACTED", line: "Everyone got out. Thad is furious. Thad has been asked to stop shaking CPI equipment.", kind: "ok" };
  if (out === 0) return { stamp: "CONTAINMENT HELD", line: "Nobody got out. Thad wins. Thad is insufferable. HR has been notified (HR is also trapped).", kind: "danger" };
  return { stamp: "PARTIAL EXTRACTION", line: `${out} of ${all} got out. Thad is only mildly smug. The rest are legally part of the Deck now.`, kind: "warn" };
}

export function thadLine(g, points) {
  const trapped = g.roster.filter((r) => r.escapedMs === null).length;
  if (!points) return "Trapped nobody. Thad gets nothing. Thad has learned nothing.";
  return `Kept ${trapped} agent${trapped === 1 ? "" : "s"} inside. Tilting pays.`;
}

/** The round report, inside the device screen (host) or as a page (phones, `compact`). */
export function roundReport(g, { compact = false } = {}) {
  const points = g.results?.points ?? {};
  const cast = castOf(g);
  const v = verdict(g);
  const size = compact ? 34 : 46;
  const escaped = g.roster.filter((r) => r.escapedMs !== null).sort((a, b) => a.escapedMs - b.escapedMs);
  const trapped = g.roster.filter((r) => r.escapedMs === null);
  const badges = [];
  const row = (r, out) => {
    const b = badge(cast.get(r.id), { size, state: out ? "cheer" : "sad" });
    badges.push({ ...b, offset: badges.length * 0.31 });
    return el(
      "li",
      { class: `sd-row ${out ? "out" : "in"}` },
      b.node,
      el("span", { class: "sd-row-main" }, el("strong", { text: r.name }), el("span", { class: "sd-row-quip", text: quip(r.id, out, g.round) })),
      el("span", { class: "sd-row-stat mono", text: out ? `${(r.escapedMs / 1000).toFixed(1)}s` : `💀 ${r.deaths}` }),
      el("span", { class: "sd-row-pts mono", text: out ? `+${points[r.id] ?? 0}` : "—" }),
    );
  };
  const thadPts = points[g.thad.id] ?? 0;
  const thad = badge(cast.get(g.thad.id), { size, state: thadPts ? "cheer" : "sad" });
  badges.push(thad);
  animateBadges(badges);
  return el(
    "div",
    { class: `sd-report ${compact ? "compact" : ""}`.trim() },
    el("div", { class: "sd-report-head" }, el("span", { class: "cpi-card-eyebrow", text: `SESSION REPORT · ROUND ${g.round} OF ${g.totalRounds}` }), el("span", { class: `sd-stamp ${v.kind}`, text: v.stamp })),
    el("p", { class: "sd-report-line", text: v.line }),
    el(
      "div",
      { class: "sd-report-cols" },
      el("section", {}, el("h3", { text: `ESCAPED · ${escaped.length}` }), escaped.length ? el("ol", { class: "sd-rows" }, escaped.map((r) => row(r, true))) : el("p", { class: "muted", text: "Nobody." })),
      el("section", {}, el("h3", { text: `STILL INSIDE · ${trapped.length}` }), trapped.length ? el("ul", { class: "sd-rows" }, trapped.map((r) => row(r, false))) : el("p", { class: "muted", text: "Nobody." })),
    ),
    el(
      "div",
      { class: "sd-report-thad" },
      thad.node,
      el("span", { class: "sd-row-main" }, el("strong", { text: `${g.thad.name} held the Deck` }), el("span", { class: "sd-row-quip", text: thadLine(g, thadPts) })),
      el("span", { class: "sd-row-pts mono", text: `+${thadPts}` }),
    ),
    el("p", { class: "sd-report-next", text: g.round < g.totalRounds ? "Next round: someone new holds the Deck." : "Final scores next." }),
  );
}
