// Cornlashing on the host screen: prompt → two answers side by side → vote split → next matchup,
// and after each round the cob scoreboard. Each phase is built once and then updated in place.

import { el, letter, ordinal, plural, timerEl } from "../common.js";
import { avatar, reducedMotion } from "../deck/ui.js";
import {
  COB_COLUMNS,
  COB_PERSPECTIVE,
  cobGeometry,
  cobKernelSlot,
  cobLeaders,
  cobOutline,
  cobPopDelays,
  cobPopSpan,
  cobRail,
  cobRowsPerLane,
  cobSheen,
  cobShading,
  cobStandings,
  cobTaper,
  cobTimeline,
} from "./chaos-cob.js";
import { playSfx } from "./mycob-sound.js";

function header({ eyebrow, title, timer }) {
  const timerSlot = el("div", {}, timerEl(timer));
  const node = el("div", { class: "phase-head" }, el("div", {}, el("p", { class: "eyebrow", text: eyebrow }), el("h1", { text: title })), timerSlot);
  return { node, setTimer: (t) => timerSlot.replaceChildren(timerEl(t)) };
}

function roundLabel(g) {
  const pts = g.multiplier > 1 ? ` · points ×${g.multiplier}` : "";
  return g.breach ? `Final round · Total Breach${pts}` : `Round ${g.round} of ${g.totalRounds}${pts}`;
}

function matchupLabel(g) {
  return g.breach ? "Total Breach · everyone answered" : `Round ${g.round} · matchup ${g.incidentNumber} of ${g.incidentCount}`;
}

function promptCard(text) {
  return el("div", { class: "prompt-card", "data-label": "PROMPT", text });
}

function buildIntro(s) {
  const g = s.game;
  const timerSlot = el("div", {}, timerEl(s.timer));
  const node = el(
    "div",
    { class: `intro ${g.breach ? "final" : ""}`.trim() },
    el("p", { class: "eyebrow", text: roundLabel(g) }),
    el("div", { class: "round flicker", text: g.breach ? "TOTAL BREACH" : `ROUND ${g.round}` }),
    el("p", { class: "flavor", text: g.breach ? "One prompt. Everyone answers. Everyone votes." : "Phones out. Be funny." }),
    timerSlot,
  );
  return { node, update: (next) => timerSlot.replaceChildren(timerEl(next.timer)) };
}

function buildAnswering(s) {
  const g = s.game;
  const head = header({ eyebrow: roundLabel(g), title: "ANSWER ON YOUR PHONE", timer: s.timer });
  const grid = el("ul", { class: "agent-grid", "aria-label": "Who has answered" });
  const node = el(
    "div",
    { class: "stack" },
    head.node,
    el("p", { class: "lede", text: g.breach ? "One prompt for everyone." : "Each prompt goes to two agents. Answers stay anonymous until the votes are in." }),
    grid,
  );
  return {
    node,
    update(next) {
      head.setTimer(next.timer);
      const names = new Map(next.players.map((p) => [p.id, p]));
      grid.replaceChildren(
        ...next.game.progress.map(({ playerId, done, needed }) => {
          const player = names.get(playerId);
          const complete = done >= needed;
          return el(
            "li",
            { class: `agent filled ${complete ? "done" : ""} ${player?.connected ? "" : "offline"}` },
            el("span", { class: "status-dot", "aria-hidden": "true" }),
            el("span", { class: "name", text: player?.name ?? "Agent" }),
            el("span", { class: complete ? "stamp ok" : "stamp muted", text: complete ? "✓ Done" : `${done}/${needed}` }),
          );
        }),
      );
    },
  };
}

/** The answers, side by side with a VS between two of them. `extra(i)` adds per-card content. */
function answerCards(items, extra) {
  const cards = items.map((item, i) => el("article", { class: `report lash-card ${item.className ?? ""}` }, ...extra(item, i)));
  if (cards.length === 2) return el("div", { class: "lash-duel" }, cards[0], el("div", { class: "lash-vs", "aria-hidden": "true", text: "VS" }), cards[1]);
  return el("div", { class: `reports ${cards.length > 2 ? "many" : ""}` }, cards);
}

function buildVoting(s, tools) {
  const g = s.game;
  const head = header({ eyebrow: matchupLabel(g), title: g.roomJudges ? "ROOM: PICK ONE" : "VOTE ON YOUR PHONE", timer: s.timer });
  const meter = el("p", { class: "vote-meter", role: "status" });
  const buttons = [];
  const cards = answerCards(g.reports, (r, i) => {
    const parts = [el("span", { class: "letter", text: letter(i) }), el("p", { class: "text", text: r.text })];
    if (g.roomJudges && tools?.hostRequest) {
      const b = el("button", {
        class: "btn big",
        type: "button",
        text: `Pick ${letter(i)}`,
        onclick: async () => {
          for (const x of buttons) x.disabled = true;
          const result = await tools.hostRequest("judge", { reportId: r.id });
          if (!result.ok) for (const x of buttons) x.disabled = false;
        },
      });
      buttons.push(b);
      parts.push(b);
    }
    return parts;
  });
  const node = el("div", { class: `lash-stage ${g.breach ? "final" : ""}`.trim() }, head.node, promptCard(g.prompt), cards, meter);
  return {
    node,
    update(next) {
      head.setTimer(next.timer);
      if (next.game.roomJudges) meter.textContent = "Room decides: tap a winner.";
      else meter.replaceChildren("Votes in: ", el("strong", { text: `${next.game.votesCast} / ${next.game.votesNeeded}` }));
    },
  };
}

/** Set through the CSSOM: the CSP blocks inline style attributes. */
function barFill(pct) {
  const fill = el("span");
  fill.style.width = `${pct}%`;
  return fill;
}

function verdictTitle(verdict) {
  if (verdict.defaulted) return "ONLY ONE ANSWER";
  if (verdict.totalVotes === 0) return "NO VOTES";
  if (verdict.winningReportIds.length > 1) return "IT'S A TIE";
  return verdict.entries.some((e) => e.unanimous) ? "CORNLASH!" : "WINNER";
}

function buildVerdict(s) {
  const g = s.game;
  const { verdict } = g;
  const head = header({ eyebrow: matchupLabel(g), title: verdictTitle(verdict), timer: s.timer });
  const total = Math.max(1, verdict.totalVotes);
  const items = verdict.entries.map((entry) => ({
    ...entry,
    className: verdict.winningReportIds.includes(entry.reportId) || verdict.defaulted ? "winner" : "",
  }));
  const cards = answerCards(items, (entry) => {
    const pct = verdict.defaulted ? 100 : Math.round((entry.votes / total) * 100);
    return [
      entry.unanimous ? el("span", { class: "stamp solid verdict-stamp", text: "Cornlash! +bonus" }) : null,
      el("p", { class: "text", text: entry.text }),
      verdict.defaulted
        ? null
        : el("div", { class: "lash-bar", "aria-hidden": "true" }, barFill(pct)),
      el(
        "div",
        { class: "meta" },
        el("span", { class: "author", text: entry.authorName }),
        el("span", { class: "muted", text: verdict.defaulted ? "no rival" : `${plural(entry.votes, "vote")} · ${pct}%` }),
        el("span", { class: "points", text: `+${entry.points}` }),
      ),
    ];
  });
  // Comedy first, scoring after: votes close, the bars fill, the winner takes the hit, then the authors
  // and points come in (all CSS delays, finite). One sting on the winner, via the moderated list.
  const tie = verdict.winningReportIds.length > 1;
  const node = el("div", { class: `lash-stage reveal ${tie ? "tie" : ""} ${verdict.defaulted ? "default" : ""} ${g.breach ? "final" : ""}`.replace(/\s+/g, " ").trim() }, head.node, promptCard(g.prompt), cards);
  if (verdict.totalVotes > 0 && !reducedMotion()) setTimeout(() => node.isConnected && playSfx("cob_sting", { volume: 0.5 }), 1500);
  return { node, update: (next) => head.setTimer(next.timer) };
}

// ------------------------------------------------------------------ the cob scoreboard

// Everyone's score as each round began, so the cob can pop this round's points in on top. Taken from
// the first state of a round this screen sees; a screen that joins mid-standings just shows the cob.
let roundStart = null; // { round, scores: Map<id, score>, used }

function noteRoundStart(state) {
  const g = state.game;
  if (g.phase === "STANDINGS" || (roundStart && roundStart.round === g.round && !roundStart.used)) return;
  roundStart = { round: g.round, scores: new Map(state.players.map((p) => [p.id, p.score])), used: false };
}

function takeRoundStart(g) {
  if (!roundStart || roundStart.round !== g.round || roundStart.used) return null;
  roundStart.used = true;
  return roundStart.scores;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  node.append(...children);
  return node;
}

const ms = (n) => `${Math.round(n)}ms`;
const num = (n) => String(Math.round(n * 100) / 100);
let boardSeq = 0;

/** A gradient from [offset, color, opacity] stops (objectBoundingBox, so it follows whatever it fills). */
function gradient(id, [x1, y1, x2, y2], stops) {
  return svg("linearGradient", { id, x1, y1, x2, y2 }, ...stops.map(([offset, color, opacity = 1]) => svg("stop", { offset, "stop-color": color, "stop-opacity": opacity })));
}

function radial(id, stops) {
  return svg("radialGradient", { id }, ...stops.map(([offset, color, opacity = 1]) => svg("stop", { offset, "stop-color": color, "stop-opacity": opacity })));
}

const pathOf = (points) => `M${points.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;

// Husk leaves, drawn once in a unit box and placed at each end of the cob: x runs from the stalk (-1)
// toward the cob (0 is the cob's end, +x wraps onto it), y is a fraction of the cob's half height
// (negative: upward). Their inner tips only reach well onto the cob out at the rim, past the lanes.
const CUP = "M-1 -0.14 C-0.92 -0.62 -0.56 -1.02 0.06 -1.05 C0.2 -1.05 0.3 -1.02 0.36 -0.98 C0.1 -0.72 0.01 -0.38 0.01 0 C0.01 0.38 0.1 0.72 0.36 0.98 C0.3 1.02 0.2 1.05 0.06 1.05 C-0.56 1.02 -0.92 0.62 -1 0.14Z";
const LEAVES = [
  ["back", "M-1 -0.04 C-0.88 -0.42 -0.58 -0.9 -0.04 -1.03 C0.2 -1.08 0.44 -1.04 0.62 -0.95 C0.36 -0.92 0.2 -0.8 0.12 -0.62 C-0.04 -0.34 -0.5 -0.12 -1 -0.04Z"],
  ["mid", "M-1 0 C-0.82 -0.3 -0.52 -0.76 -0.1 -0.9 C0.1 -0.96 0.3 -0.95 0.46 -0.9 C0.22 -0.84 0.08 -0.7 0 -0.5 C-0.12 -0.28 -0.54 -0.08 -1 0Z"],
  ["front", "M-1 0.02 C-0.82 -0.2 -0.58 -0.52 -0.24 -0.72 C-0.08 -0.8 0.06 -0.78 0.16 -0.72 C0.02 -0.6 -0.06 -0.44 -0.12 -0.3 C-0.3 -0.14 -0.62 -0.04 -1 0.02Z"],
];
const LEAF_VEINS = ["M-0.95 -0.04 C-0.7 -0.4 -0.3 -0.8 0.2 -0.98", "M-0.95 0 C-0.62 -0.26 -0.3 -0.6 0 -0.82"];

/**
 * The husk wrapped round both ends of the cob, in the stage's own coordinates. The stem end gets
 * the big layered leaves (taller above than below), the tip a shorter, ragged set and some silk.
 * Static: the top agent's glow lands on it from the board's glow layer.
 */
function huskSvg(outline, uid) {
  const [w, h] = outline.viewBox;
  const cy = (outline.top + outline.bottom) / 2;
  const half = (outline.bottom - outline.top) / 2;
  const defs = svg(
    "defs",
    {},
    gradient(`${uid}-back`, [0, 0, 1, 0], [[0, "#4d6420"], [0.7, "#74902f"], [1, "#8ea43e"]]),
    gradient(`${uid}-mid`, [0, 0, 1, 0], [[0, "#6c8a2c"], [0.55, "#a2a850"], [1, "#c3b365"]]),
    gradient(`${uid}-front`, [0, 0, 1, 0], [[0, "#8da13b"], [0.5, "#c4bb69"], [1, "#e6d493"]]),
  );
  // One end's leaves, upper half then lower half (a touch shorter and shifted, so it isn't a mirror).
  const side = (anchor, dir, length, upper, lower, layers) => {
    const g = svg("g", { class: "cob-husk-side" });
    g.append(svg("path", { d: CUP, class: "cob-leaf cup", fill: `url(#${uid}-back)`, transform: `translate(${num(anchor)} ${num(cy)}) scale(${num(dir * length)} ${num(half * (upper + lower) / 2)})` }));
    for (const [flip, reach, shift] of [[1, upper, 0], [-1, lower, 0.06]]) {
      for (const [name, d] of LEAVES.slice(0, layers)) {
        const transform = `translate(${num(anchor)} ${num(cy)}) scale(${num(dir * length)} ${num(flip * half * reach)}) translate(${shift} 0)`;
        g.append(svg("path", { d, class: `cob-leaf ${name}`, fill: `url(#${uid}-${name})`, transform }));
      }
    }
    return g;
  };
  const stem = side(outline.left + 6, 1, outline.left * 0.92, 1, 0.9, 3);
  const tip = side(outline.right - 6, -1, (w - outline.right) * 0.78, 0.9, 0.82, 2);
  // The stalk behind the stem leaves, and the silk fanning off the tip.
  const stalk = svg("path", { d: `M0 ${num(cy - half * 0.13)} L${num(outline.left * 0.5)} ${num(cy - half * 0.2)} L${num(outline.left * 0.5)} ${num(cy + half * 0.2)} L0 ${num(cy + half * 0.13)}Z`, class: "cob-stalk" });
  const silk = svg("g", { class: "cob-silk" });
  for (let i = -3; i <= 3; i++) {
    const x0 = outline.right - 4;
    const reach = (w - x0) * (0.7 + 0.06 * ((i * 7) % 4));
    silk.append(svg("path", { d: `M${num(x0)} ${num(cy + i * 3)} C${num(x0 + reach * 0.4)} ${num(cy + i * 7)} ${num(x0 + reach * 0.7)} ${num(cy + i * 16 + (i % 2) * 6)} ${num(x0 + reach)} ${num(cy + i * 24)}` }));
  }
  const veins = svg("g", { class: "cob-veins" });
  for (const d of LEAF_VEINS) {
    veins.append(svg("path", { d, transform: `translate(${num(outline.left + 6)} ${num(cy)}) scale(${num(outline.left * 0.92)} ${num(-half)})` }), svg("path", { d, transform: `translate(${num(outline.left + 6)} ${num(cy)}) scale(${num(outline.left * 0.92)} ${num(half * 0.9)})` }));
  }
  return svg("svg", { class: "cob-husk", viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true" }, defs, stalk, stem, veins, silk, tip);
}

/** Everything flat behind and in front of the kernels: floor shadow, the cob's body, its lighting, the grooves between lanes, the husk. */
function cobArt(outline, uid, shading, seams, sheenY) {
  const [w, h] = outline.viewBox;
  const body = pathOf(outline.points);
  const width = outline.right - outline.left;
  const back = svg(
    "svg",
    { class: "cob-back", viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true" },
    svg("defs", {}, radial(`${uid}-floor`, [[0, "#000", 0.6], [0.6, "#000", 0.25], [1, "#000", 0]]), gradient(`${uid}-core`, [0, 0, 1, 0], [[0, "#3a2a0c"], [0.5, "#2a1f0a"], [1, "#1c1507"]])),
    svg("ellipse", { cx: 500, cy: num(outline.bottom + 6), rx: num(width * 0.47), ry: num((h - outline.bottom) * 0.62), fill: `url(#${uid}-floor)` }),
    svg("path", { d: body, class: "cob-core", fill: `url(#${uid}-core)` }),
  );
  // The light: a dark layer (the unlit side and the rim) and a bright layer (where it hits), from the
  // light model, then a soft streak where the sheen sits and darkening toward both ends of the cob.
  const lightDefs = svg(
    "defs",
    {},
    gradient(`${uid}-dark`, [0, 0, 0, 1], shading.map((s) => [s.at, "#0b0703", s.dark])),
    gradient(`${uid}-bright`, [0, 0, 0, 1], shading.map((s) => [s.at, "#fff2c4", s.light])),
    gradient(`${uid}-ends`, [0, 0, 1, 0], [[0, "#0b0703", 0.62], [0.09, "#0b0703", 0.2], [0.22, "#fff2c4", 0.07], [0.5, "#000", 0], [0.78, "#0b0703", 0.12], [0.93, "#0b0703", 0.34], [1, "#0b0703", 0.66]]),
    radial(`${uid}-sheen`, [[0, "#fff8da", 0.3], [0.55, "#fff2c4", 0.09], [1, "#fff2c4", 0]]),
  );
  const light = svg(
    "svg",
    { class: "cob-light", viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true" },
    lightDefs,
    svg("path", { d: body, fill: `url(#${uid}-dark)` }),
    svg("path", { d: body, fill: `url(#${uid}-bright)` }),
    svg("path", { d: body, fill: `url(#${uid}-ends)` }),
    svg("ellipse", { cx: num(outline.left + width * 0.4), cy: num(sheenY), rx: num(width * 0.3), ry: num((outline.bottom - outline.top) * 0.075), fill: `url(#${uid}-sheen)` }),
    ...seams.map((points) => svg("path", { d: `M${points.map(([x, y]) => `${x} ${y}`).join(" L")}`, class: "cob-groove" })),
  );
  return { back, light, husk: huskSvg(outline, uid) };
}

// The reveal (chaos-cob.js has the timeline): lanes light up one by one as the cob rolls into view,
// this round's kernels pop out of the surface in short bursts, the lanes slide round the cob into their
// new order, then the top agent is crowned. With reduced motion (or nothing to reveal) the board is
// drawn already settled.

/** The cob for this room's scores, given the scores as the round began (or null: no reveal). */
function cobBoard(state, previous) {
  const lanes = state.players.length;
  const bands = cobRowsPerLane(lanes);
  const perLane = COB_COLUMNS * bands;
  const data = cobStandings(state.players, previous, { kernels: perLane });
  const calm = reducedMotion();
  const live = previous !== null && !calm;
  const geo = cobGeometry(Math.max(1, lanes), bands);
  const time = cobTimeline({ lanes, rows: data.rows, moved: data.moved, live });
  const outline = cobOutline(geo);
  const uid = `cob${++boardSeq}`;
  const start = live ? data.previousOrder : data.rows;
  const leaders = cobLeaders(data.rows);
  const art = cobArt(outline, uid, cobShading(geo), Array.from({ length: Math.max(0, geo.lanes - 1) }, (_, i) => cobRail(geo, geo.seam(i + 1))), cobSheen(geo));

  // Labels are sized from the closest pair of lane centres (in stage widths) against a guess at the stage's width.
  const closest = Math.min(1, ...geo.slots.slice(1).map((s, i) => (s.y - geo.slots[i].y) * geo.aspect));
  const stagePx = Math.min((globalThis.innerWidth || 1280) * 0.56, ((globalThis.innerHeight || 720) * 0.62 - 100) / geo.aspect);
  const faceSize = Math.round(Math.min(52, Math.max(24, closest * stagePx * 0.85)));

  const list = el("ol", { class: "cob-lanes", "aria-label": "Standings" });
  const parts = new Map();
  const place = (part, slot) => {
    const at = geo.slots[slot];
    part.slot = slot;
    part.li.style.top = `${num(at.y * 100)}%`;
    part.li.style.setProperty("--lane-h", String(at.height));
    part.li.style.setProperty("--lead", String(at.ends[0]));
    part.sector.style.transform = `rotateX(${num(at.angle)}deg)`;
    part.rows.forEach((row, band) => {
      row.style.transform = rowTransform(slot, band);
      row.style.height = rowHeight(slot, band);
    });
  };
  const rowTransform = (slot, band) => `rotateX(${num(geo.rowAngle(slot, band) - geo.slots[slot].angle)}deg) translateZ(var(--R)) translate(-50%, -50%)`;
  const rowHeight = (slot, band) => `calc(var(--R) * ${geo.rowH(slot * bands + band)})`;

  const sectors = el("div", { class: "cob-roll" });
  const counting = [];
  // Built in final rank order (so the DOM never has to move, which would restart its animations), placed in the starting order.
  data.rows.forEach((r) => {
    const i = start.indexOf(r);
    const sector = el("div", { class: "cob-sector" });
    const rows = Array.from({ length: bands }, (_, band) => el("div", { class: `cob-row ${band % 2 ? "odd" : ""}`.trim() }));
    // This lane's pops: a burst at a time, the kernels either side of the new run reacting a beat later.
    const pops = Math.max(0, r.kernelsAfter - r.kernelsBefore);
    const delays = cobPopDelays(pops);
    for (let k = 0; k < perLane; k++) {
      const { band, column, u } = cobKernelSlot(k, bands);
      const kernel = el("span", { class: "cob-k" });
      const taper = cobTaper(u);
      kernel.style.setProperty("--t", num(taper));
      kernel.style.setProperty("--tz", String(Math.round((taper - 1) * 1000) / 1000));
      kernel.style.setProperty("--c", String(column));
      if (k < r.kernelsBefore) {
        kernel.classList.add("lit");
        kernel.style.setProperty("--d", ms(time.activate + i * time.activateStep + column * 8));
      } else if (k < r.kernelsAfter) {
        kernel.classList.add("pop");
        kernel.style.setProperty("--d", ms(time.popAt + delays[k - r.kernelsBefore]));
      } else if (live && pops > 0 && k < r.kernelsAfter + bands + 1) {
        kernel.classList.add("react");
        kernel.style.setProperty("--d", ms(time.popAt + delays[pops - 1] + 60));
      }
      if (live && pops > 0 && k >= r.kernelsBefore - bands && k < r.kernelsBefore) {
        kernel.classList.add("react");
        kernel.style.setProperty("--d", ms(time.popAt + 40));
      }
      rows[band].append(kernel);
    }
    sector.append(...rows);
    sectors.append(sector);

    // The label, score and TOP COB tag sit beside the cob, level with the lane's strip, joined to it by a short line.
    const rankEl = el("span", { class: "cob-rank", text: data.known && live ? ordinal(r.previousPlacement) : live ? "" : ordinal(r.placement) });
    const moveEl = el("span", { class: "cob-move" });
    // A long name gets smaller rather than cut off (down to 62%, then an ellipsis).
    const nameEl = el("span", { class: "cob-name", text: r.name, title: r.name });
    nameEl.style.setProperty("--fit", String(Math.max(0.62, Math.min(1, 9 / Math.max(1, r.name.length))).toFixed(2)));
    const number = el("span", { class: "cob-num", text: (live ? r.previous : r.score).toLocaleString() });
    const gain = r.gain > 0 && previous !== null ? el("span", { class: "cob-gain", text: `+${r.gain.toLocaleString()}` }) : null;
    gain?.style.setProperty("--d", ms(time.popAt));
    const li = el(
      "li",
      { class: `cob-lane ${r.connected ? "" : "offline"}`.trim(), "aria-label": `${ordinal(r.placement)}: ${r.name}, ${r.score.toLocaleString()} points${r.gain > 0 && previous !== null ? `, plus ${r.gain.toLocaleString()} this round` : ""}` },
      el("div", { class: "cob-glow", "aria-hidden": "true" }),
      el("div", { class: "cob-label", "aria-hidden": "true" }, el("div", { class: "cob-who" }, rankEl, el("span", { class: "cob-face" }, avatar(r, r.index, { size: faceSize })), nameEl, moveEl), el("span", { class: "cob-link" })),
      el("div", { class: "cob-score", "aria-hidden": "true" }, el("span", { class: "cob-link" }), number, gain),
      el("span", { class: "cob-tag", text: "TOP COB" }),
    );
    li.style.setProperty("--act", ms(time.activate + i * time.activateStep));
    const part = { r, li, sector, rows, number, slot: i };
    part.finish = () => {
      number.textContent = r.score.toLocaleString();
      rankEl.textContent = ordinal(r.placement);
      if (data.known && r.move !== 0) {
        moveEl.textContent = r.move > 0 ? `▲${r.move}` : `▼${-r.move}`;
        moveEl.classList.add(r.move > 0 ? "up" : "down");
      }
    };
    place(part, i);
    parts.set(r.id, part);
    list.append(li);
    if (live && r.gain > 0) counting.push({ part, span: Math.max(300, cobPopSpan(pops)) });
  });

  const world = el("div", { class: "cob-world", "aria-hidden": "true" }, sectors);
  const stage = el("div", { class: "cob-stage" }, art.back, world, art.light, art.husk, list);
  stage.style.setProperty("--persp", String(COB_PERSPECTIVE));
  stage.style.setProperty("--rho", String(geo.rho));
  stage.style.setProperty("--aspect", String(geo.aspect));
  stage.style.setProperty("--axis", String(num(geo.axis / geo.height)));
  stage.style.setProperty("--roww", String(geo.rowW));
  stage.style.setProperty("--closest", String(num(closest)));
  stage.style.setProperty("--edge-l", String(outline.left / 1000));
  stage.style.setProperty("--edge-r", String(outline.right / 1000));
  stage.style.setProperty("--roll-ms", ms(time.roll));
  const board = el("div", { class: `cob-board ${live ? "" : "still"}`.trim() }, stage);

  const crown = () => {
    for (const r of leaders) {
      const part = parts.get(r.id);
      part?.li.classList.add("crowned");
      part?.sector.classList.add("lead");
    }
    if (leaders.length) board.classList.add("crowned");
  };

  if (!live) {
    for (const p of parts.values()) p.finish();
    crown();
    if (calm && previous !== null && leaders.length) setTimeout(() => board.isConnected && playSfx("cob_sting", { volume: 0.8 }), 300);
    return board;
  }

  // Numbers count up while their kernels pop (one short animation frame loop that ends).
  const countFrom = performance.now() + time.popAt;
  const tick = (now) => {
    if (!board.isConnected) return;
    let running = false;
    for (const { part, span } of counting) {
      const t = Math.min(1, Math.max(0, (now - countFrom) / span));
      if (t < 1) running = true;
      part.number.textContent = Math.round(part.r.previous + part.r.gain * (1 - (1 - t) ** 3)).toLocaleString();
    }
    if (running) requestAnimationFrame(tick);
  };
  if (counting.length) setTimeout(() => requestAnimationFrame(tick), time.popAt);

  // A few grouped pop cues for the kernels, a sting for the top agent.
  for (const at of time.cues) setTimeout(() => board.isConnected && playSfx("cob_pop", { volume: 0.4 }), at);

  setTimeout(() => {
    if (!board.isConnected) return;
    for (const p of parts.values()) p.finish();
    if (!data.moved) return;
    // The lanes roll round the cob from the old order into the new one, risers lifting over fallers; the labels slide with them.
    const all = [...parts.values()];
    const before = new Map(all.map((p) => [p, { top: p.li.offsetTop, angle: geo.slots[p.slot].angle, slot: p.slot, rows: p.rows.map((_, band) => ({ transform: rowTransform(p.slot, band), height: rowHeight(p.slot, band) })) }]));
    data.rows.forEach((r, slot) => place(parts.get(r.id), slot));
    for (const p of all) {
      const was = before.get(p);
      const now = geo.slots[p.slot].angle;
      const dy = was.top - p.li.offsetTop;
      if (!dy) continue;
      const lift = p.slot < was.slot ? 0.07 : -0.04;
      const rotate = (angle, z) => `rotateX(${num(angle)}deg) translateZ(calc(var(--R) * ${z}))`;
      const options = { duration: 520, easing: "cubic-bezier(0.25, 0.8, 0.3, 1)" };
      p.li.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], options);
      p.sector.animate([{ transform: rotate(was.angle, 0) }, { transform: rotate((was.angle + now) / 2, lift), offset: 0.5 }, { transform: rotate(now, 0) }], options);
      p.rows.forEach((row, band) => row.animate([{ transform: was.rows[band].transform, height: was.rows[band].height }, { transform: rowTransform(p.slot, band), height: rowHeight(p.slot, band) }], options));
    }
  }, time.settleAt);

  setTimeout(() => {
    if (!board.isConnected) return;
    crown();
    if (leaders.length) playSfx("cob_sting", { volume: 0.8 });
  }, time.crownAt);
  return board;
}

function buildStandings(s) {
  const g = s.game;
  const last = g.round >= g.totalRounds;
  const head = header({ eyebrow: g.breach ? "Total Breach complete" : `Round ${g.round} of ${g.totalRounds} complete`, title: last ? "FINAL STANDINGS" : "COB STANDINGS", timer: s.timer });
  const node = el(
    "div",
    { class: "cob-standings" },
    head.node,
    cobBoard(s, takeRoundStart(g)),
    el("p", { class: "muted cob-next", text: last ? "Winner up next." : g.round + 1 === g.totalRounds && g.totalRounds > 1 ? "Next: the final round." : `Next: round ${g.round + 1}.` }),
  );
  return { node, update: (next) => head.setTimer(next.timer) };
}

const BUILDERS = {
  INTRO: buildIntro,
  ANSWERING: buildAnswering,
  VOTING: buildVoting,
  VERDICT: buildVerdict,
  STANDINGS: buildStandings,
};

export function render(mount, state, tools) {
  const g = state.game;
  noteRoundStart(state);
  const build = BUILDERS[g.phase];
  if (build) mount(`chaos:${g.phase}:${g.round}:${g.incidentId ?? ""}`, (s) => build(s, tools), state);
}
