// Cornlashing on the host screen. Each phase is built once and then updated in place.

import { el, letter, plural, rank, scoreboardEl, timerEl } from "../common.js";

const INTRO_FLAVOR = [
  "Incident reporting window opening. Check your device.",
  "COB-AI has assigned your incidents. It is not sorry.",
  "Records Division reminds you: brevity is a containment strategy.",
];

const STEPS = [
  ["ANSWERING", "WRITE"],
  ["VOTING", "VOTE"],
  ["VERDICT", "RULING"],
];

/** WRITE → VOTE → RULING, with the current step lit, so the loop reads at a glance. */
function steps(phase) {
  return el("ol", { class: "phase-steps", "aria-label": "Round steps" }, STEPS.map(([id, label]) => el("li", { class: id === phase ? "on" : "", text: label })));
}

function header({ eyebrow, title, timer, phase }) {
  const timerSlot = el("div", {}, timerEl(timer));
  const node = el(
    "div",
    { class: "phase-head" },
    el("div", {}, el("p", { class: "eyebrow", text: eyebrow }), el("h1", { text: title }), phase ? steps(phase) : null),
    timerSlot,
  );
  return { node, setTimer: (t) => timerSlot.replaceChildren(timerEl(t)) };
}

function roundLabel(g) {
  return g.breach ? `Final round · Total Breach · points ×${g.multiplier}` : `Round ${g.round} of ${g.totalRounds} · points ×${g.multiplier}`;
}

function buildIntro(s) {
  const g = s.game;
  const timerSlot = el("div", {}, timerEl(s.timer));
  const node = el(
    "div",
    { class: "intro" },
    g.breach ? el("div", { class: "warning breach-head", text: "Containment breach · total breach protocol engaged" }) : null,
    el("p", { class: "eyebrow", text: roundLabel(g) }),
    el("div", { class: "round flicker", text: g.breach ? "TOTAL BREACH" : `ROUND ${g.round}` }),
    el(
      "p",
      { class: "flavor" },
      g.breach
        ? `Every agent. One incident. Everyone votes. Points ×${g.multiplier}.`
        : INTRO_FLAVOR[(g.round - 1) % INTRO_FLAVOR.length],
    ),
    timerSlot,
  );
  return { node, update: (next) => timerSlot.replaceChildren(timerEl(next.timer)) };
}

function buildAnswering(s) {
  const g = s.game;
  const head = header({ eyebrow: roundLabel(g), title: "WRITE YOUR REPORTS", timer: s.timer, phase: "ANSWERING" });
  const grid = el("ul", { class: "agent-grid", "aria-label": "Report filing progress" });
  const node = el(
    "div",
    { class: "stack" },
    head.node,
    el("p", {
      class: "lede",
      text: g.breach ? "Everyone has the same incident. Write on your phone." : "Write on your phone. Reports stay anonymous until the ruling.",
    }),
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
            complete ? el("span", { class: "stamp ok", text: "✓ Filed" }) : el("span", { class: "stamp muted", text: `${done}/${needed} filed` }),
            player?.connected ? null : el("span", { class: "stamp danger", text: "Signal lost" }),
          );
        }),
      );
    },
  };
}

function incidentEyebrow(g, suffix) {
  return g.breach ? `Total Breach · ${suffix}` : `Round ${g.round} · incident ${g.incidentNumber} of ${g.incidentCount} · ${suffix}`;
}

function buildVoting(s) {
  const g = s.game;
  const head = header({ eyebrow: incidentEyebrow(g, "vote"), title: "VOTE FOR THE BEST REPORT", timer: s.timer, phase: "VOTING" });
  const meter = el("p", { class: "vote-meter", role: "status" });
  const node = el(
    "div",
    {},
    head.node,
    el("div", { class: "prompt-card", text: g.prompt }),
    el(
      "div",
      { class: `reports ${g.reports.length > 2 ? "many" : ""}` },
      g.reports.map((r, i) =>
        el("article", { class: "report" }, el("span", { class: "letter", text: `REPORT ${letter(i)}` }), el("p", { class: "text", text: r.text })),
      ),
    ),
    meter,
  );
  return {
    node,
    update(next) {
      head.setTimer(next.timer);
      meter.replaceChildren(
        "Votes in: ",
        el("strong", { text: `${next.game.votesCast} / ${next.game.votesNeeded}` }),
        next.game.breach ? " · you can't vote for your own" : " · the two authors sit this one out",
      );
    },
  };
}

function verdictTitle(verdict) {
  if (verdict.defaulted) return "DEFAULT RULING";
  if (verdict.totalVotes === 0) return "NO VOTES CAST";
  if (verdict.winningReportIds.length > 1) return "SPLIT DECISION";
  return "RULING ISSUED";
}

function buildVerdict(s) {
  const g = s.game;
  const { verdict } = g;
  const head = header({ eyebrow: incidentEyebrow(g, "ruling"), title: verdictTitle(verdict), timer: s.timer, phase: "VERDICT" });
  const node = el(
    "div",
    {},
    head.node,
    el("div", { class: "prompt-card", text: g.prompt }),
    verdict.defaulted ? el("p", { class: "banner", text: "Only one agent filed a report. It is accepted by default." }) : null,
    el(
      "div",
      { class: `reports ${verdict.entries.length > 2 ? "many" : ""}` },
      verdict.entries.map((entry, i) => {
        const won = verdict.winningReportIds.includes(entry.reportId);
        const stamp = verdict.defaulted
          ? el("span", { class: "stamp solid verdict-stamp", text: "Default" })
          : entry.unanimous
            ? el("span", { class: "stamp solid verdict-stamp", text: "Unanimous" })
            : won
              ? el("span", { class: "stamp verdict-stamp", text: verdict.winningReportIds.length > 1 ? "Split" : "Accepted" })
              : el("span", { class: "stamp muted verdict-stamp", text: "Denied" });
        return el(
          "article",
          { class: `report ${won || verdict.defaulted ? "winner" : ""}` },
          stamp,
          el("span", { class: "letter", text: `REPORT ${letter(i)}` }),
          el("p", { class: "text", text: entry.text }),
          el(
            "div",
            { class: "meta" },
            el("span", { class: "author", text: `— ${entry.authorName}` }),
            el("span", { class: "muted", text: verdict.defaulted ? "" : plural(entry.votes, "vote") }),
            el("span", { class: "points", text: `+${entry.points}` }),
          ),
        );
      }),
    ),
  );
  return { node, update: (next) => head.setTimer(next.timer) };
}

function buildStandings(s) {
  const g = s.game;
  const last = g.round >= g.totalRounds;
  const head = header({
    eyebrow: g.breach ? "Total Breach complete" : `Round ${g.round} of ${g.totalRounds} complete`,
    title: last ? "FINAL STANDINGS INCOMING" : "CURRENT STANDINGS",
    timer: s.timer,
  });
  const board = el("div");
  const node = el(
    "div",
    { class: "stack" },
    head.node,
    board,
    el("p", {
      class: "muted",
      text: last ? "Stand by for the final debrief." : g.round + 1 === g.totalRounds && g.totalRounds > 1 ? "Next: the final round." : `Next: round ${g.round + 1}.`,
    }),
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

export function render(mount, state) {
  const g = state.game;
  const build = BUILDERS[g.phase];
  if (build) mount(`chaos:${g.phase}:${g.round}:${g.incidentId ?? ""}`, build, state);
}
