// The host screen's launch: a CPI case-file transition, the same for every game. The lamp comes up
// over a dark operations desk; incident forms, memos, a containment sheet, a personnel slip, a
// classification card and an evidence photo land on it; the case folder drops on top with a thud.
// Then the file is processed: the clip snaps onto the game's photo, an evidence tag slides in, a
// classification strip goes across, the case number prints and redaction bars cover the title.
// AUTHORIZED; the bars peel off the title; a short popcorn POP; the desk fades into the game, which
// has been running underneath all along.
//
// It's under a hundred DOM nodes and finite CSS animations (party.css "case-file launch"): nothing
// loops, nothing is fetched, and the whole thing is removed when it's done. About 6.5 s the first
// time, 5.3 s after that (every beat, tighter), and a 2 s still frame with prefers-reduced-motion.
// A tap or any key skips straight to the game. Sounds are the menus' moderated launch_* tags.

import { el } from "../common.js";
import { playSfx } from "../games/mycob-sound.js";
import { cover, reducedMotion } from "./ui.js";

/**
 * Milliseconds from the start: when each beat happens, per pace (exit + leave is the total).
 * paper / stagger / fly: the loose papers; folder / folderFly: the case folder (it lands at their
 * sum); clip, tag, strip, print, redact: the processing beat; then stamp, declass (the title
 * uncovered), pop, and exit (the fade into the game, `leave` long).
 */
export const LAUNCH_PACES = {
  full: { paper: 380, stagger: 120, fly: 620, folder: 1750, folderFly: 700, clip: 2600, tag: 2800, strip: 3000, print: 3200, redact: 3450, stamp: 3850, declass: 4450, pop: 5150, exit: 6050, leave: 400 },
  quick: { paper: 250, stagger: 85, fly: 520, folder: 1250, folderFly: 600, clip: 1980, tag: 2140, strip: 2300, print: 2460, redact: 2680, stamp: 3000, declass: 3500, pop: 4100, exit: 4900, leave: 350 },
  calm: { paper: 0, stagger: 0, fly: 0, folder: 0, folderFly: 0, clip: 0, tag: 0, strip: 0, print: 0, redact: 0, stamp: 250, declass: 0, pop: 950, exit: 1750, leave: 250 },
};

/** How fast a skipped launch gets out of the way. */
export const SKIP_LEAVE = 140;

/** The launch's sounds: the papers (not in a calm launch), one stamp, one pop. */
export function launchCues(t, { calm = false } = {}) {
  return [
    calm ? null : { at: t.paper, cue: "launch_shuffle", volume: 0.55 },
    { at: t.stamp, cue: "launch_stamp", volume: 0.85 },
    { at: t.pop, cue: "launch_pop", volume: 0.85 },
  ].filter(Boolean);
}

/**
 * The launch's clock, with no DOM: plays each cue once at its beat and calls `exit(skipped)` once,
 * at the end or on skip(). Skipping cancels everything still pending; after the end nothing fires.
 */
export function launchTimeline(t, { calm = false, sound, exit, schedule = setTimeout, cancel = clearTimeout }) {
  let over = false;
  const pending = new Set();
  const at = (when, fn) => {
    const id = schedule(() => {
      pending.delete(id);
      if (!over) fn();
    }, when);
    pending.add(id);
  };
  const end = (skipped) => {
    if (over) return;
    over = true;
    for (const id of pending) cancel(id);
    pending.clear();
    exit(skipped);
  };
  for (const c of launchCues(t, { calm })) at(c.at, () => sound(c.cue, c.volume));
  at(t.exit, () => end(false));
  return {
    skip: () => end(true),
    get over() {
      return over;
    },
  };
}

/**
 * Whether a room's change of status is a launch to show: only a game starting while this screen
 * watched (lobby or results → game). A host that loads or reloads mid-game (previous null) doesn't
 * replay it.
 */
export function shouldPlayLaunch(previous, next) {
  return next === "IN_GAME" && previous !== null && previous !== undefined && previous !== "IN_GAME";
}

/**
 * The loose papers: where each lands (left / top in % of a 16:9 table, a tilt) and where it flies
 * in from (an offset and a tilt). Later ones land on top of earlier ones.
 */
const PAPERS = [
  { kind: "form", at: [7, 8], tilt: -9, from: [-60, -40, -40] },
  { kind: "memo", at: [70, 5], tilt: 11, from: [55, -55, 35] },
  { kind: "sheet", at: [71, 47], tilt: 6, from: [60, 45, 30] },
  { kind: "photo", at: [6, 53], tilt: -13, from: [-55, 50, -40] },
  { kind: "slip", at: [24, 3], tilt: 4, from: [-25, -70, 22] },
  { kind: "card", at: [51, 80], tilt: -6, from: [25, 70, -30] },
  { kind: "tag", at: [29, 79], tilt: 15, from: [-10, 70, 45] },
  { kind: "note", at: [60, 2], tilt: -7, from: [20, -70, -26] },
];

/** Popcorn: where each piece flies (cqw from the title), its spin and size. Fixed, not random. */
const POPCORN = [
  [-15, -12, -160, 1.1], [-7, -17, 120, 0.9], [2, -19, -80, 1.2], [11, -15, 200, 1], [18, -8, -140, 0.85],
  [21, 2, 90, 1.05], [16, 10, -210, 0.95], [7, 14, 150, 1.15], [-4, 15, -100, 0.9], [-13, 10, 230, 1],
  [-20, 1, -60, 0.95], [-23, -6, 170, 0.8],
];

let launches = 0;
let current = null;

const ms = (n) => `${Math.round(n)}ms`;

/** A case number for the folder, the same every time for a game (decoration, not a record). */
export function caseNumber(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h >>>= 0;
  return `CF-${1000 + (h % 9000)}-${String.fromCharCode(65 + ((h >>> 13) % 26))}`;
}

function paper(kind) {
  const line = (w, cls = "") => el("span", { class: `cf-line ${cls}`.trim(), dataset: { w } });
  switch (kind) {
    case "form":
      return [
        el("span", { class: "cf-doc-head", text: "CPST INCIDENT FORM" }),
        el("span", { class: "cf-boxes" }, el("span"), el("span"), el("span")),
        line(92), line(78), line(86, "redacted"), line(64), line(90), line(55, "redacted"), line(80),
        el("span", { class: "cf-sign" }),
      ];
    case "memo":
      return [
        el("span", { class: "cf-doc-head", text: "INTERNAL MEMO" }),
        line(88), line(70, "redacted"), line(94), line(60, "redacted"), line(84, "redacted"), line(72),
        el("span", { class: "cf-doc-foot", text: "AUTHORIZED PERSONNEL ONLY" }),
      ];
    case "sheet":
      return [
        el("span", { class: "cf-sheet-band" }, el("span", { text: "CONTAINMENT SHEET" })),
        line(86), line(70), el("span", { class: "cf-checks" }, el("span", { class: "on" }), el("span"), el("span", { class: "on" })), line(78, "redacted"), line(58),
      ];
    case "photo":
      return [el("span", { class: "cf-photo-img" }, el("span", { class: "cf-entity" }), el("span", { class: "cf-eyes" })), el("span", { class: "cf-photo-cap", text: "EXHIBIT A" })];
    case "slip":
      return [
        el("span", { class: "cf-doc-head", text: "PERSONNEL SLIP" }),
        el("span", { class: "cf-slip-body" }, el("span", { class: "cf-slip-face" }), el("span", { class: "cf-slip-lines" }, line(90), line(70, "redacted"), line(80))),
      ];
    case "card":
      return [el("span", { class: "cf-card-head", text: "CLASSIFICATION" }), line(84, "redacted"), el("span", { class: "cf-card-foot", text: "DO NOT REMOVE FROM FILE" })];
    case "tag":
      return [el("span", { class: "cf-tag-text", text: "⚠ HAZARD" })];
    case "note":
      return [el("span", { class: "cf-note-text", text: "EYES ONLY" })];
    default:
      return [];
  }
}

/** Finishes the launch on screen now, if one is playing (the room left the game, say). */
export function stopCaseFileLaunch() {
  current?.skip();
}

/**
 * Plays the launch for a game (a library entry: id, title, tagline, genre, players, art), over the
 * whole page. Resolves when it has gone.
 */
export function playCaseFileLaunch(info) {
  stopCaseFileLaunch();
  document.querySelector(".deck-launch")?.remove();
  const calm = reducedMotion();
  const pace = calm ? "calm" : launches > 0 ? "quick" : "full";
  launches += 1;
  const t = LAUNCH_PACES[pace];

  const papers = PAPERS.map((p, i) => {
    const node = el("div", { class: `cf-paper cf-${p.kind}` }, paper(p.kind));
    node.style.setProperty("--x", `${p.at[0]}%`);
    node.style.setProperty("--y", `${p.at[1]}%`);
    node.style.setProperty("--r", `${p.tilt}deg`);
    node.style.setProperty("--fx", `${p.from[0]}cqw`);
    node.style.setProperty("--fy", `${p.from[1]}cqh`);
    node.style.setProperty("--fr", `${p.tilt + p.from[2]}deg`);
    node.style.setProperty("--wob", `${p.tilt > 0 ? 1.6 : -1.6}deg`);
    node.style.setProperty("--d", ms(t.paper + i * t.stagger));
    node.style.setProperty("--dur", ms(t.fly));
    for (const line of node.querySelectorAll(".cf-line")) line.style.setProperty("--w", `${line.dataset.w}%`);
    return node;
  });

  const title = el("span", { class: "cf-title-ink", text: info.title });
  const titleBox = el("h2", { class: "cf-title" }, title);
  // Oswald capitals run about 0.54em a letter: the longest word has to fit the folder's text column
  // (about 25cqw), and a long title gets two lines rather than three.
  const longest = Math.max(1, ...info.title.split(/\s+/).map((w) => w.length));
  titleBox.style.setProperty("--title", `${Math.min(4.6, 24 / (longest * 0.56), info.title.length > 18 ? 3.5 : 4.6).toFixed(2)}cqw`);
  const pop = el(
    "div",
    { class: "cf-burst" },
    POPCORN.map(([x, y, spin, size], i) => {
      const piece = el("span", { class: "cf-corn" });
      piece.style.setProperty("--px", `${x}cqw`);
      piece.style.setProperty("--py", `${y}cqw`);
      piece.style.setProperty("--spin", `${spin}deg`);
      piece.style.setProperty("--s", String(size));
      piece.style.setProperty("--pd", ms(i * 14));
      return piece;
    }),
    el("span", { class: "cf-pop" }, el("span", { text: "POP!" })),
  );
  const caseNo = caseNumber(info.id);
  const folder = el(
    "div",
    { class: "cf-folder" },
    el("span", { class: "cf-folder-tab" }, el("span", { text: "CASE FILE" })),
    el(
      "div",
      { class: "cf-folder-face" },
      el("span", { class: "cf-class-strip" }, el("span", { text: "CLASSIFIED // CPST // AUTHORIZED PERSONNEL ONLY" })),
      el("div", { class: "cf-snap" }, cover(info, { size: "hero", label: false }), el("span", { class: "cf-clip" })),
      el(
        "div",
        { class: "cf-file-text" },
        el("p", { class: "cf-file-org", text: "CORN PLANET INSTITUTION · CPST" }),
        el("p", { class: "cf-caseno" }, el("span", { class: "cf-caseno-text", text: `CASE ${caseNo}` }), el("span", { class: "cf-barcode" })),
        el("p", { class: "cf-file-kicker", text: "NOW LAUNCHING" }),
        titleBox,
        info.tagline ? el("p", { class: "cf-file-tag", text: info.tagline }) : null,
        el("p", { class: "cf-file-meta", text: [info.genre, info.players].filter(Boolean).join(" · ") }),
      ),
    ),
    el("span", { class: "cf-evidence" }, el("span", { class: "cf-evidence-hole" }), el("span", { class: "cf-evidence-text", text: "EVIDENCE" }), el("span", { class: "cf-evidence-no", text: caseNo })),
    el("span", { class: "cf-stamp" }, el("span", { class: "cf-stamp-main", text: "AUTHORIZED" }), el("span", { class: "cf-stamp-sub", text: "CLEARED FOR PLAY" })),
    pop,
  );
  folder.style.setProperty("--d", ms(t.folder));
  folder.style.setProperty("--dur", ms(t.folderFly));

  const table = el("div", { class: "cf-stage" }, papers, folder);
  const node = el(
    "div",
    { class: `cf-launch ${pace}`, "aria-hidden": "true" },
    el(
      "div",
      { class: "cf-desk" },
      el("span", { class: "cf-lamp" }),
      el("span", { class: "cf-desk-label", text: "CPST OPERATIONS · CASE INTAKE" }),
      table,
      el("span", { class: "cf-desk-edge" }),
      el("span", { class: "cf-dim" }),
    ),
  );
  node.style.setProperty("--accent", info.art.accent);
  const beats = { land: t.folder + t.folderFly, clip: t.clip, tag: t.tag, strip: t.strip, print: t.print, redact: t.redact, stamp: t.stamp, declass: t.declass, pop: t.pop, total: t.exit + t.leave };
  for (const [beat, when] of Object.entries(beats)) node.style.setProperty(`--t-${beat}`, ms(when));
  document.body.append(node);

  return new Promise((resolve) => {
    const onKey = () => timeline.skip();
    const timeline = launchTimeline(t, {
      calm,
      sound: (cue, volume) => playSfx(cue, { volume, scope: "lobby" }),
      exit: (skipped) => {
        if (current === timeline) current = null;
        removeEventListener("keydown", onKey, true);
        node.classList.add("leaving");
        if (skipped) node.classList.add("skipped");
        setTimeout(() => node.remove(), skipped ? SKIP_LEAVE : t.leave);
        resolve();
      },
    });
    current = timeline;
    node.addEventListener("pointerdown", () => timeline.skip());
    addEventListener("keydown", onKey, true);
  });
}
