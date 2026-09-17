// Corn or Shit on the big screen: two claims about one CPI Database record, then the reveal.
// Reuses the report-card layout Cornlashing already uses for head-to-head reading.

import { el, letter, plural, rank, scoreboardEl, timerEl } from "../common.js";

function header({ eyebrow, title, timer }) {
  const timerSlot = el("div", {}, timerEl(timer));
  const node = el(
    "div",
    { class: "phase-head" },
    el("div", {}, el("p", { class: "eyebrow", text: eyebrow }), el("h1", { text: title })),
    timerSlot,
  );
  return { node, setTimer: (t) => timerSlot.replaceChildren(timerEl(t)) };
}

const roundLabel = (g) => `Round ${g.round} of ${g.totalRounds}`;

/** One claim. `verdict` is null while guessing, or "real" / "fake" at the reveal. */
function claimCard(option, index, verdict) {
  const stamp =
    verdict === "real"
      ? el("span", { class: "stamp solid verdict-stamp", text: "Corn" })
      : verdict === "fake"
        ? el("span", { class: "stamp muted verdict-stamp", text: "Shit" })
        : null;

  return el(
    "article",
    { class: `report ${verdict === "real" ? "winner" : ""}`.trim() },
    stamp,
    el("span", { class: "letter", text: `CLAIM ${letter(index)}` }),
    el("p", { class: "text", text: option.text }),
    typeof option.picked === "number"
      ? el("div", { class: "meta" }, el("span", { class: "muted", text: `${plural(option.picked, "agent")} called it` }))
      : null,
  );
}

function referenceBlock(g) {
  return el(
    "div",
    { class: "reference" },
    el("span", { class: "eyebrow", text: "Database reference" }),
    el("strong", { class: "reference-id", text: g.reference.ref }),
    el("span", { class: "muted", text: g.reference.title }),
  );
}

function buildIntro(s) {
  const g = s.game;
  const head = header({ eyebrow: roundLabel(g), title: "PULLING A RECORD…", timer: s.timer });
  const node = el(
    "div",
    {},
    head.node,
    el("div", { class: "intro" }, el("p", { class: "round flicker", text: g.subject }), el("p", { class: "flavor", text: "Two claims. One is documented. One is not." })),
  );
  return { node, update: (next) => head.setTimer(next.timer) };
}

function buildGuessing(s) {
  const g = s.game;
  const head = header({ eyebrow: roundLabel(g), title: "CORN OR SHIT?", timer: s.timer });
  const meter = el("p", { class: "vote-meter", role: "status" });

  const node = el(
    "div",
    {},
    head.node,
    el("div", { class: "prompt-card", text: `Both claims are about ${g.subject}. One of them is in the database.` }),
    el("div", { class: "reports" }, g.options.map((o, i) => claimCard(o, i, null))),
    meter,
  );

  const setMeter = (next) => {
    meter.replaceChildren(
      "Calls filed: ",
      el("strong", { text: `${next.game.guessesCast} / ${next.game.guessesNeeded}` }),
      " · call it on your device",
    );
  };
  setMeter(s);

  return {
    node,
    update(next) {
      head.setTimer(next.timer);
      setMeter(next);
    },
  };
}

function buildReveal(s) {
  const g = s.game;
  const right = g.scoreboard.filter((p) => p.correct).length;
  const head = header({
    eyebrow: roundLabel(g),
    title: right === 0 ? "NOBODY CALLED IT" : "THE RECORD SAYS…",
    timer: s.timer,
  });

  const node = el(
    "div",
    {},
    head.node,
    el("div", { class: "reports" }, g.options.map((o, i) => claimCard(o, i, o.real ? "real" : "fake"))),
    referenceBlock(g),
    el("p", {
      class: "banner",
      text: `The fabrication borrowed that line from ${g.fabricatedFrom.ref} — ${g.fabricatedFrom.title}. It is not canon.`,
    }),
    el("p", { class: "vote-meter", text: `${plural(right, "agent")} called it correctly.` }),
    scoreboardEl(rank(s.players)),
  );
  return { node, update: (next) => head.setTimer(next.timer) };
}

const BUILDERS = {
  INTRO: buildIntro,
  GUESSING: buildGuessing,
  REVEAL: buildReveal,
};

export function render(mount, state) {
  const g = state.game;
  const build = BUILDERS[g.phase];
  if (build) mount(`cornorshit:${g.phase}:${g.round}`, build, state);
}
