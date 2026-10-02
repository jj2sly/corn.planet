// The host screen's launch: a CPI case-file transition, the same for every game. A dark operations
// table; incident forms, a containment sheet, a redacted memo and an entity photo land on it; the
// case folder slides in on top and gets stamped AUTHORIZED; the game's title is declassified (the
// redaction bars peel off) with a short popcorn POP; then the table fades into the game, which has
// been running underneath all along.
//
// It's a few dozen DOM nodes and finite CSS animations (party.css "case-file launch"): nothing
// loops, nothing is fetched, and the whole thing is removed when it's done. It takes ~3.2 s the
// first time, ~2.3 s after that (repeat games shouldn't drag), and a calm ~1.5 s still frame with
// prefers-reduced-motion. A tap or any key skips it. Sounds are the menus' moderated launch_* tags.

import { el } from "../common.js";
import { playSfx } from "../games/mycob-sound.js";
import { cover, reducedMotion } from "./ui.js";

/** Milliseconds from the start: when each beat happens, per pace. */
const PACES = {
  full: { paper: 60, stagger: 85, fly: 480, folder: 620, folderFly: 520, stamp: 1180, declass: 1440, pop: 1980, exit: 2880, leave: 340 },
  quick: { paper: 30, stagger: 50, fly: 360, folder: 330, folderFly: 400, stamp: 760, declass: 940, pop: 1330, exit: 2020, leave: 300 },
  calm: { paper: 0, stagger: 0, fly: 0, folder: 0, folderFly: 0, stamp: 0, declass: 0, pop: 260, exit: 1250, leave: 260 },
};

/**
 * The papers around the folder: where each lands (left / top in % of a 16:9 table, a tilt) and
 * where it flies in from (an offset and a tilt). Sizes and contents are party.css's.
 */
const PAPERS = [
  { kind: "form", at: [7, 8], tilt: -9, from: [-60, -40, -40] },
  { kind: "memo", at: [70, 5], tilt: 11, from: [55, -55, 35] },
  { kind: "sheet", at: [71, 47], tilt: 6, from: [60, 45, 30] },
  { kind: "photo", at: [6, 53], tilt: -13, from: [-55, 50, -40] },
  { kind: "tag", at: [29, 79], tilt: 15, from: [-10, 70, 50] },
  { kind: "note", at: [60, 2], tilt: -7, from: [20, -70, -30] },
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
  current?.();
}

/**
 * Plays the launch for a game (a library entry: title, tagline, genre, players, art), over the
 * whole page. Resolves when it has gone.
 */
export function playCaseFileLaunch(info) {
  stopCaseFileLaunch();
  document.querySelector(".deck-launch")?.remove();
  const calm = reducedMotion();
  const pace = calm ? "calm" : launches > 0 ? "quick" : "full";
  launches += 1;
  const t = PACES[pace];

  const papers = PAPERS.map((p, i) => {
    const node = el("div", { class: `cf-paper cf-${p.kind}` }, paper(p.kind));
    node.style.setProperty("--x", `${p.at[0]}%`);
    node.style.setProperty("--y", `${p.at[1]}%`);
    node.style.setProperty("--r", `${p.tilt}deg`);
    node.style.setProperty("--fx", `${p.from[0]}cqw`);
    node.style.setProperty("--fy", `${p.from[1]}cqh`);
    node.style.setProperty("--fr", `${p.tilt + p.from[2]}deg`);
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
  const folder = el(
    "div",
    { class: "cf-folder" },
    el("span", { class: "cf-folder-tab" }, el("span", { text: "CASE FILE" })),
    el(
      "div",
      { class: "cf-folder-face" },
      el("div", { class: "cf-snap" }, cover(info, { size: "hero", label: false }), el("span", { class: "cf-clip" })),
      el(
        "div",
        { class: "cf-file-text" },
        el("p", { class: "cf-file-org", text: "CORN PLANET INSTITUTION · CPST" }),
        el("p", { class: "cf-file-kicker", text: "NOW LAUNCHING" }),
        titleBox,
        info.tagline ? el("p", { class: "cf-file-tag", text: info.tagline }) : null,
        el("p", { class: "cf-file-meta", text: [info.genre, info.players].filter(Boolean).join(" · ") }),
      ),
    ),
    el("span", { class: "cf-stamp" }, el("span", { class: "cf-stamp-main", text: "AUTHORIZED" }), el("span", { class: "cf-stamp-sub", text: "CLEARED FOR PLAY" })),
    pop,
  );
  folder.style.setProperty("--d", ms(t.folder));
  folder.style.setProperty("--dur", ms(t.folderFly));

  const table = el("div", { class: "cf-stage" }, papers, folder);
  const node = el(
    "div",
    { class: `cf-launch ${pace}`, "aria-hidden": "true" },
    el("div", { class: "cf-desk" }, el("span", { class: "cf-desk-label", text: "CPST OPERATIONS · CASE INTAKE" }), table, el("span", { class: "cf-desk-edge" })),
  );
  node.style.setProperty("--accent", info.art.accent);
  node.style.setProperty("--t-stamp", ms(t.stamp));
  node.style.setProperty("--t-declass", ms(t.declass));
  node.style.setProperty("--t-pop", ms(t.pop));
  document.body.append(node);

  // Sparse: papers (quietly), the stamp, the pop. A calm launch skips the rustle.
  const timers = [];
  const at = (when, fn) => timers.push(setTimeout(fn, when));
  if (!calm) at(t.paper, () => playSfx("launch_shuffle", { volume: 0.55, scope: "lobby" }));
  at(Math.max(0, t.stamp), () => playSfx("launch_stamp", { volume: 0.8, scope: "lobby" }));
  at(t.pop, () => playSfx("launch_pop", { volume: 0.85, scope: "lobby" }));

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (current === finish) current = null;
      for (const id of timers) clearTimeout(id);
      removeEventListener("keydown", finish, true);
      node.classList.add("leaving");
      setTimeout(() => node.remove(), t.leave);
      resolve();
    };
    current = finish;
    at(t.exit, finish);
    node.addEventListener("pointerdown", finish);
    addEventListener("keydown", finish, true);
  });
}
