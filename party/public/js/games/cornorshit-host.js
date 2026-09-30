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
    el("span", { class: "eyebrow", text: "Source: CPI Database" }),
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
    el("div", { class: "intro" }, el("p", { class: "round flicker", text: g.subject }), el("p", { class: "flavor", text: "One claim is CPI canon. One is shit." })),
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
    el("div", { class: "prompt-card", dataset: { label: "THE RECORD" }, text: `${g.subject}: one claim is CPI canon. One is shit.` }),
    el("div", { class: "reports" }, g.options.map((o, i) => claimCard(o, i, null))),
    meter,
  );

  const setMeter = (next) => {
    meter.replaceChildren(
      "Calls filed: ",
      el("strong", { text: `${next.game.guessesCast} / ${next.game.guessesNeeded}` }),
      " · pick on your phone",
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
  const winners = g.scoreboard.filter((p) => p.correct);
  const head = header({
    eyebrow: roundLabel(g),
    title: winners.length === 0 ? "NOBODY CALLED IT" : "THIS ONE IS CANON",
    timer: s.timer,
  });

  const node = el(
    "div",
    {},
    head.node,
    el("div", { class: "reports" }, g.options.map((o, i) => claimCard(o, i, o.real ? "real" : "fake"))),
    referenceBlock(g),
    el("p", { class: "muted", text: `The shit was borrowed from ${g.fabricatedFrom.ref} (${g.fabricatedFrom.title}).` }),
    el("p", { class: "vote-meter" }, winners.length ? ["Called it: ", el("strong", { text: winners.map((w) => w.name).join(", ") })] : "No points this round."),
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
