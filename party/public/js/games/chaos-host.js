// Cornlashing on the host screen: prompt → two answers side by side → vote split → next matchup.
// Each phase is built once and then updated in place.

import { el, letter, plural, rank, scoreboardEl, timerEl } from "../common.js";

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

function buildStandings(s) {
  const g = s.game;
  const last = g.round >= g.totalRounds;
  const head = header({ eyebrow: g.breach ? "Total Breach complete" : `Round ${g.round} of ${g.totalRounds} complete`, title: last ? "FINAL SCORES" : "SCORES", timer: s.timer });
  const board = el("div");
  const node = el(
    "div",
    { class: "stack" },
    head.node,
    board,
    el("p", { class: "muted", text: last ? "Winner up next." : g.round + 1 === g.totalRounds && g.totalRounds > 1 ? "Next: the final round." : `Next: round ${g.round + 1}.` }),
  );
  return {
    node,
    update(next) {
      head.setTimer(next.timer);
      board.replaceChildren(scoreboardEl(rank(next.players)));
    },
  };
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
  const build = BUILDERS[g.phase];
  if (build) mount(`chaos:${g.phase}:${g.round}:${g.incidentId ?? ""}`, (s) => build(s, tools), state);
}
