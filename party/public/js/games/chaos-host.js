// Cornlashing on the host screen: prompt → two answers side by side → vote split → next matchup,
// and after each round the cob scoreboard. Each phase is built once and then updated in place.

import { el, letter, ordinal, plural, timerEl } from "../common.js";
import { avatar, reducedMotion } from "../deck/ui.js";
import { COB_COLUMNS, cobRowsPerLane, cobStandings } from "./chaos-cob.js";
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
    { class: "intro" },
    el("p", { class: "eyebrow", text: roundLabel(g) }),
    el("div", { class: "round flicker", text: g.breach ? "TOTAL BREACH" : `ROUND ${g.round}` }),
    el("p", { class: "flavor", text: g.breach ? "Everyone gets the same prompt. Everyone votes." : "Check your phone. Answer your prompts. Be funny." }),
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
  const head = header({ eyebrow: matchupLabel(g), title: g.roomJudges ? "ROOM: PICK THE FUNNIER ONE" : "VOTE ON YOUR PHONE", timer: s.timer });
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
  const node = el("div", {}, head.node, promptCard(g.prompt), cards, meter);
  return {
    node,
    update(next) {
      head.setTimer(next.timer);
      if (next.game.roomJudges) meter.textContent = "Two agents: the room decides. Argue, then tap a winner.";
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
  return { node: el("div", {}, head.node, promptCard(g.prompt), cards), update: (next) => head.setTimer(next.timer) };
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

/** The husk leaves at the cob's stem end. */
function husk() {
  const leaf = (d, cls) => svg("path", { d, class: `cob-leaf ${cls}` });
  return svg(
    "svg",
    { class: "cob-husk", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" },
    svg(
      "defs",
      {},
      svg("linearGradient", { id: "cob-husk-shade", x1: "1", y1: "0", x2: "0", y2: "0" }, svg("stop", { offset: "0", "stop-color": "#7f9a33" }), svg("stop", { offset: "0.6", "stop-color": "#b6ad55" }), svg("stop", { offset: "1", "stop-color": "#d9c57c" })),
    ),
    leaf("M98 50 C 74 33, 40 9, 2 0 C 22 21, 54 40, 98 59 Z", "outer"),
    leaf("M98 50 C 74 67, 40 91, 2 100 C 22 79, 54 60, 98 41 Z", "outer"),
    leaf("M99 50 C 78 42, 48 29, 14 28 C 36 42, 64 50, 99 57 Z", "inner"),
    leaf("M99 50 C 78 58, 48 71, 14 72 C 36 58, 64 50, 99 43 Z", "inner"),
  );
}

// The reveal, in ms: lanes light up one by one, this round's kernels pop in (all lanes at once, one
// kernel after another), the lanes slide into their new order, then the top agent is crowned.
const COB_ACTIVATE = 200;
const COB_ACTIVATE_STEP = 70;
const COB_POP_STEP = 42;
const ms = (n) => `${Math.round(n)}ms`;

/** The cob for this room's scores, given the scores as the round began (or null: no reveal). */
function cobBoard(state, previous) {
  const lanes = state.players.length;
  const bands = cobRowsPerLane(lanes);
  const perLane = COB_COLUMNS * bands;
  const data = cobStandings(state.players, previous, { kernels: perLane });
  const calm = reducedMotion();
  const live = previous !== null && !calm;
  const start = live ? data.previousOrder : data.rows;
  // A thick band pops its kernels faster, so every lane fills in about the same time.
  const popStep = COB_POP_STEP / bands;
  const popAt = COB_ACTIVATE + lanes * COB_ACTIVATE_STEP + 180;
  const mostPops = Math.max(0, ...data.rows.map((r) => r.kernelsAfter - r.kernelsBefore));
  const settleAt = popAt + mostPops * popStep + 420;
  const crownAt = settleAt + (live && data.moved ? 520 : 140);
  const leaders = data.rows.filter((r) => r.placement === 1 && r.score > 0);
  const laneHeight = Math.min(64 * bands, Math.max(30, ((globalThis.innerHeight || 720) * 0.6 - 110) / Math.max(1, lanes)));
  const faceSize = Math.round(Math.min(52, Math.max(26, laneHeight * 0.8)));

  const list = el("ol", { class: "cob-lanes", "aria-label": "Standings" });
  const parts = new Map();
  start.forEach((r, i) => {
    const kernels = el("div", { class: "cob-row", "aria-hidden": "true" });
    for (let k = 0; k < perLane; k++) {
      const kernel = el("span", { class: "cob-k" });
      if (k < r.kernelsBefore) {
        kernel.classList.add("lit");
        kernel.style.setProperty("--d", ms(COB_ACTIVATE + i * COB_ACTIVATE_STEP + (k / bands) * 8));
      } else if (k < r.kernelsAfter) {
        kernel.classList.add("pop");
        kernel.style.setProperty("--d", ms(popAt + (k - r.kernelsBefore) * popStep));
      }
      kernels.append(kernel);
    }
    // Pinned to the end of the top agent's lane once they're crowned (party.css shows it).
    kernels.append(el("span", { class: "cob-tag", text: "TOP COB" }));
    const rankEl = el("span", { class: "cob-rank", text: data.known && live ? ordinal(r.previousPlacement) : live ? "" : ordinal(r.placement) });
    const moveEl = el("span", { class: "cob-move" });
    // A long name gets smaller rather than cut off (down to 62%, then an ellipsis).
    const nameEl = el("span", { class: "cob-name", text: r.name });
    nameEl.style.setProperty("--fit", String(Math.max(0.62, Math.min(1, 9 / Math.max(1, r.name.length))).toFixed(2)));
    const number = el("span", { class: "cob-num", text: (live ? r.previous : r.score).toLocaleString() });
    const gain = r.gain > 0 && previous !== null ? el("span", { class: "cob-gain", text: `+${r.gain.toLocaleString()}` }) : null;
    gain?.style.setProperty("--d", ms(popAt));
    const lane = el(
      "li",
      { class: `cob-lane ${r.connected ? "" : "offline"}`.trim(), "aria-label": `${ordinal(r.placement)}: ${r.name}, ${r.score.toLocaleString()} points${r.gain > 0 && previous !== null ? `, plus ${r.gain.toLocaleString()} this round` : ""}` },
      el("div", { class: "cob-label", "aria-hidden": "true" }, rankEl, el("span", { class: "cob-face" }, avatar(r, r.index, { size: faceSize })), nameEl, moveEl),
      kernels,
      el("div", { class: "cob-score", "aria-hidden": "true" }, number, gain),
    );
    lane.style.setProperty("--act", ms(COB_ACTIVATE + i * COB_ACTIVATE_STEP));
    const finish = () => {
      number.textContent = r.score.toLocaleString();
      rankEl.textContent = ordinal(r.placement);
      if (data.known && r.move !== 0) {
        moveEl.textContent = r.move > 0 ? `▲${r.move}` : `▼${-r.move}`;
        moveEl.classList.add(r.move > 0 ? "up" : "down");
      }
    };
    parts.set(r.id, { lane, number, row: r, finish });
    list.append(lane);
  });

  const board = el("div", { class: `cob-board ${live ? "" : "still"} ${bands > 1 ? "thick" : ""}`.replace(/\s+/g, " ").trim() }, el("div", { class: "cob-body", "aria-hidden": "true" }), husk(), list);
  board.style.setProperty("--lanes", String(Math.max(1, lanes)));
  board.style.setProperty("--rows", String(bands));

  const crown = () => {
    for (const r of leaders) parts.get(r.id)?.lane.classList.add("crowned");
    if (leaders.length) board.classList.add("crowned");
  };

  if (!live) {
    for (const p of parts.values()) p.finish();
    crown();
    if (calm && previous !== null && leaders.length) setTimeout(() => board.isConnected && playSfx("cob_sting", { volume: 0.8 }), 300);
    return board;
  }

  // Numbers count up while their kernels pop (one short animation frame loop that ends).
  const counting = [...parts.values()].filter((p) => p.row.gain > 0);
  const countFrom = performance.now() + popAt;
  const tick = (now) => {
    if (!board.isConnected) return;
    let running = false;
    for (const p of counting) {
      const span = Math.max(300, (p.row.kernelsAfter - p.row.kernelsBefore) * popStep);
      const t = Math.min(1, Math.max(0, (now - countFrom) / span));
      if (t < 1) running = true;
      const eased = 1 - (1 - t) ** 3;
      p.number.textContent = Math.round(p.row.previous + p.row.gain * eased).toLocaleString();
    }
    if (running) requestAnimationFrame(tick);
  };
  if (counting.length) setTimeout(() => requestAnimationFrame(tick), popAt);

  // A few kernel pops, not one per kernel; a sting for the top agent.
  for (let i = 0; i < Math.min(5, mostPops); i++) setTimeout(() => board.isConnected && playSfx("cob_pop", { volume: 0.4 }), popAt + i * 140);

  setTimeout(() => {
    if (!board.isConnected) return;
    for (const p of parts.values()) p.finish();
    if (!data.moved) return;
    // The lanes slide from the old order into the new one.
    const before = new Map([...parts.values()].map((p) => [p.lane, p.lane.offsetTop]));
    list.append(...data.rows.map((r) => parts.get(r.id).lane));
    for (const [lane, top] of before) {
      const dy = top - lane.offsetTop;
      if (dy) lane.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 480, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)" });
    }
  }, settleAt);

  setTimeout(() => {
    if (!board.isConnected) return;
    crown();
    if (leaders.length) playSfx("cob_sting", { volume: 0.8 });
  }, crownAt);
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
