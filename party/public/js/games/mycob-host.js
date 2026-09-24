// My Cob Escaped on the big screen: the incident board, the narrator, the combined consequence,
// the vote, the ending and the awards. Players' raw responses never reach this screen; it shows
// the director's interpretation of them.

import { el, plural, timerEl } from "../common.js";
import {
  bestMoveEl,
  entityCard,
  factsList,
  leaderboard,
  liveNarration,
  livesEl,
  narrationEl,
  PENDING_REPORT,
  objectivesList,
  outcomeStamp,
  personnelList,
  recapCard,
  stampEl,
  statChips,
  statusGrid,
  summaryTiles,
  systemsList,
  TAG_INFO,
} from "./mycob-shared.js";
import { playNewCues, soundToggle } from "./mycob-sound.js";
import { speakNew } from "./mycob-voice.js";

function header(eyebrow, title, timer) {
  const timerSlot = el("div", {}, timerEl(timer));
  const node = el("div", { class: "phase-head" }, el("div", {}, el("p", { class: "eyebrow", text: eyebrow }), el("h1", { text: title })), timerSlot);
  return { node, setTimer: (t) => timerSlot.replaceChildren(timerEl(t)) };
}

const stageLabel = (g) => (g.stage ? `Incident ${g.incident.code} · Stage ${g.stage} of ${g.totalStages}` : `Incident ${g.incident.code}`);

/** The incident board down the side: entity, status, systems, objectives, crew. */
function board(g) {
  const inc = g.incident;
  return el(
    "aside",
    { class: "mc-board", "aria-label": "Incident board" },
    entityCard(inc),
    el("section", {}, el("h3", { text: "Status" }), statusGrid(inc)),
    el("section", {}, el("h3", { text: "Objectives" }), objectivesList(inc.objectives)),
    el("section", {}, el("h3", { text: "Facility" }), systemsList(inc)),
    el(
      "section",
      {},
      el("h3", { text: "Response team" }),
      el(
        "ul",
        { class: "mc-crew" },
        inc.crew.map((c) =>
          el(
            "li",
            { class: [c.connected ? "" : "offline", c.down ? "down" : ""].join(" ").trim() },
            el("span", { class: "grow" }, el("strong", { text: c.name }), el("span", { class: "muted", text: ` · ${c.role}` }), c.identity ? el("span", { class: "muted", text: ` (as ${c.identity})` }) : null),
            c.submitted === true ? stampEl("filed", "ok") : null,
            c.down ? stampEl("down", "danger") : livesEl(c.lives, g.maxLives),
          ),
        ),
      ),
    ),
    soundToggle(),
  );
}

/** Main column + board. `main` is rebuilt per phase; the board refreshes on every update. */
function layout(s, mainNodes, onUpdate) {
  const side = el("div", {}, board(s.game));
  const node = el("div", { class: "mc-layout" }, el("div", { class: "mc-main stack" }, ...mainNodes), side);
  speakNew(s.game.incident.code, s.game.narration);
  // A screen that opens on a fresh incident plays its opening klaxon; one that joins later plays nothing old.
  playNewCues(s.game.incident.code, s.game.cues, { fresh: s.game.phase === "ALERT" });
  return {
    node,
    update(next) {
      side.replaceChildren(board(next.game));
      speakNew(next.game.incident.code, next.game.narration);
      playNewCues(next.game.incident.code, next.game.cues);
      onUpdate?.(next);
    },
  };
}

function situation(inc) {
  return el(
    "div",
    { class: "mc-situation" },
    el("p", { class: "eyebrow", text: `${inc.breach.name}${inc.breach.entitySpecific ? " · entity-specific" : ""} · ${inc.location.name}` }),
    el("p", { class: "mc-problem", text: inc.problem }),
    inc.environment.length ? el("ul", { class: "mc-env" }, inc.environment.map((t) => el("li", { text: t }))) : null,
    inc.anomalies.length ? el("p", { class: "banner" }, el("strong", { text: "Anomaly: " }), inc.anomalies.map((a) => `${a.name} — ${a.text}`).join(" · ")) : null,
  );
}

// ------------------------------------------------------------------ phases

function buildAlert(s) {
  const g = s.game;
  const head = header(`${g.incident.mode.emoji} ${g.incident.mode.name}`, `INCIDENT ${g.incident.code}`, s.timer);
  const crew = el(
    "ul",
    { class: "mc-roles" },
    g.incident.crew.map((c) => el("li", {}, el("strong", { text: c.name }), el("span", { text: c.role }))),
  );
  const narration = liveNarration(g.narration);
  return layout(
    s,
    [
      head.node,
      el("div", { class: "warning mc-siren", text: `Containment breach · ${g.incident.breach.name}` }),
      narration.node,
      situation(g.incident),
      el("h2", { text: "Temporary assignments" }),
      crew,
      el("p", { class: "muted", text: "Roles are for this incident only, and everyone keeps theirs until the end." }),
    ],
    (next) => {
      head.setTimer(next.timer);
      narration.set(next.game.narration);
      crew.replaceChildren(...next.game.incident.crew.map((c) => el("li", {}, el("strong", { text: c.name }), el("span", { text: c.role }))));
    },
  );
}

function buildUpdate(s) {
  const g = s.game;
  const head = header(stageLabel(g), "INCIDENT UPDATE", s.timer);
  const facts = g.incident.facts;
  return layout(
    s,
    [
      head.node,
      g.recap ? recapCard(g.recap) : null,
      narrationEl(g.narration),
      situation(g.incident),
      facts.length ? el("section", {}, el("h2", { text: "What we know" }), factsList(facts)) : null,
      el("section", {}, el("h2", { text: "Personnel" }), personnelList(g.incident)),
    ],
    (next) => head.setTimer(next.timer),
  );
}

function buildResponse(s) {
  const g = s.game;
  const head = header(stageLabel(g), "WHAT DO YOU DO?", s.timer);
  const meter = el("p", { class: "vote-meter", role: "status" });
  const setMeter = (next) =>
    meter.replaceChildren("Responses filed: ", el("strong", { text: `${next.game.progress.submitted} / ${next.game.progress.needed}` }), " · respond on your phone");
  setMeter(s);
  return layout(
    s,
    [
      head.node,
      el("div", { class: "prompt-card mc-prompt", text: g.incident.problem }),
      situation(g.incident),
      el(
        "ul",
        { class: "mc-taglist", "aria-label": "Response types" },
        g.tags.map((t) => el("li", {}, el("span", { "aria-hidden": "true", text: TAG_INFO[t].icon }), ` ${TAG_INFO[t].label}`)),
      ),
      meter,
    ],
    (next) => {
      head.setTimer(next.timer);
      setMeter(next);
    },
  );
}

function buildProcessing(s) {
  const g = s.game;
  const head = header(stageLabel(g), "PROCESSING", s.timer);
  return layout(
    s,
    [
      head.node,
      el(
        "div",
        { class: "mc-processing" },
        el("p", { class: "mc-processing-text", text: "INCIDENT DIRECTOR IS WORKING OUT WHAT YOU ALL JUST DID" }),
        el("p", { class: "muted", text: `${plural(g.processing.actions, "response")} received. Consequences incoming.` }),
      ),
    ],
    // The timer shortens once the director has answered.
    (next) => head.setTimer(next.timer),
  );
}

function actionCards(consequence) {
  return el(
    "ul",
    { class: "mc-actions" },
    consequence.actions.map((a) =>
      el(
        "li",
        { dataset: { outcome: a.outcome } },
        el(
          "div",
          { class: "row spread" },
          el("span", {}, el("strong", { text: a.name }), el("span", { class: "muted", text: ` · ${a.role} · ${TAG_INFO[a.tag].icon} ${TAG_INFO[a.tag].label}` })),
          outcomeStamp(a.outcome, a.outcomeLabel),
        ),
        el("p", { text: a.summary }),
      ),
    ),
  );
}

function changesPanel(c) {
  const items = [
    ...c.systemChanges.map((x) => `${x.name}: ${x.to.toUpperCase()}`),
    ...c.personnelChanges.map((x) => `${x.name}: ${x.to.toUpperCase()}`),
    ...c.objectiveChanges.map((x) => `Objective ${x.to}: ${x.text}`),
    ...c.objectivesAdded.map((x) => `New objective: ${x.text}`),
  ];
  if (!items.length) return null;
  return el("section", { class: "panel quiet" }, el("h3", { text: "Changes" }), el("ul", { class: "mc-changes" }, items.map((t) => el("li", { text: t }))));
}

function buildConsequence(s) {
  const g = s.game;
  const c = g.consequence;
  const head = header(stageLabel(g), c.terminated ? "ENTITY TERMINATED" : "CONSEQUENCES", s.timer);
  return layout(
    s,
    [
      head.node,
      c.lifeLosses.length
        ? el(
            "div",
            { class: "mc-life-alert", role: "alert" },
            c.lifeLosses.map((l) => el("p", {}, el("strong", { text: l.down ? `${l.name} IS DOWN` : `${l.name} LOST A LIFE` }), ` — ${l.reason}`)),
          )
        : null,
      statChips(c.statusChanges),
      // Lives, discoveries and objective changes have their own panels below.
      narrationEl(g.narration.filter((n) => n.type === "consequence" || n.type === "special_event")),
      actionCards(c),
      c.discoveries.length ? el("section", {}, el("h2", { text: "Discovered" }), factsList(c.discoveries)) : null,
      changesPanel(c),
    ],
    (next) => head.setTimer(next.timer),
  );
}

function buildVote(s) {
  const g = s.game;
  const head = header(stageLabel(g), "BEST MOVE THIS STAGE?", s.timer);
  const meter = el("p", { class: "vote-meter", role: "status" });
  const setMeter = (next) =>
    meter.replaceChildren("Anonymous votes: ", el("strong", { text: `${next.game.vote.cast} / ${next.game.vote.needed}` }), " · vote on your phone");
  setMeter(s);
  return layout(
    s,
    [
      head.node,
      el("p", { class: "muted", text: "Brilliant, heroic, catastrophic — your call. You can't vote for yourself." }),
      el(
        "ul",
        { class: "mc-actions" },
        g.vote.candidates.map((c) => el("li", {}, el("strong", { text: c.name }), el("p", { text: c.summary }))),
      ),
      meter,
    ],
    (next) => {
      head.setTimer(next.timer);
      setMeter(next);
    },
  );
}

function breakdownTable(outcome) {
  const rows = [...outcome.breakdown].sort((a, b) => b.total - a.total);
  const cols = [
    ["impact", "Impact"],
    ["chaos", "Chaos"],
    ["creativity", "Creativity"],
    ["role", "Role"],
    ["votes", "Votes"],
    ["sacrifice", "Sacrifice"],
    ["team", "Team"],
    ["total", "Total"],
  ];
  return el(
    "div",
    { class: "table-wrap" },
    el(
      "table",
      { class: "mc-breakdown" },
      el("thead", {}, el("tr", {}, el("th", { text: "Agent" }), cols.map(([, label]) => el("th", { text: label })), el("th", { text: "Lives lost" }))),
      el(
        "tbody",
        {},
        rows.map((r) => el("tr", {}, el("td", { text: r.name }), cols.map(([key]) => el("td", { class: "mono", text: String(r[key]) })), el("td", { class: "mono", text: String(r.livesLost) }))),
      ),
    ),
  );
}

function endingBlock(g) {
  const o = g.outcome;
  const text = el("p", { class: "mc-ending-text", text: o.narration ?? PENDING_REPORT });
  const node = el(
    "div",
    { class: `mc-ending e-${o.id}` },
    el("p", { class: "eyebrow", text: `Incident ${g.incident.code} · ${plural(o.stagesPlayed, "stage")}` }),
    el("h1", { class: "flicker", text: o.title }),
    text,
    el(
      "div",
      { class: "reference" },
      el("span", { class: "eyebrow", text: o.initiallyUnknown ? "The unknown entity was" : "Entity" }),
      el("strong", { class: "reference-id", text: o.entity.ref }),
      el("span", { class: "muted", text: `${o.entity.title} · ${o.entity.classification}` }),
    ),
  );
  return { node, set: (next) => (text.textContent = next.outcome.narration ?? PENDING_REPORT) };
}

function buildOutcome(s) {
  const g = s.game;
  const head = header("Operation complete", "", s.timer);
  const ending = endingBlock(g);
  return layout(
    s,
    [
      head.node,
      ending.node,
      summaryTiles(g.outcome),
      el(
        "div",
        { class: "mc-finale-grid" },
        el("section", {}, el("h2", { text: "Final scores" }), leaderboard(g.outcome)),
        el(
          "section",
          { class: "stack" },
          el("h2", { text: "Highlights" }),
          bestMoveEl(g.outcome),
          g.outcome.mvps.length
            ? el("p", {}, el("strong", { text: "Stage commendations: " }), g.outcome.mvps.map((m) => `S${m.stage} ${m.names.join(" & ")}`).join(" · "))
            : el("p", { class: "muted", text: "No commendations. Nobody could agree on anything." }),
        ),
      ),
      el("h2", { text: "Debrief" }),
      breakdownTable(g.outcome),
      el("p", { class: "muted", text: "Everything that happened in this incident is game-only. The CPI Database is unchanged." }),
    ],
    (next) => {
      head.setTimer(next.timer);
      ending.set(next.game);
    },
  );
}

function buildAwardSubmit(s) {
  const g = s.game;
  const head = header("End of incident", "CREATE THE AWARDS", s.timer);
  const meter = el("p", { class: "vote-meter", role: "status" });
  const setMeter = (next) => meter.replaceChildren("Awards created: ", el("strong", { text: `${next.game.awards.submitted} / ${next.game.awards.needed}` }));
  setMeter(s);
  return layout(
    s,
    [
      head.node,
      el("div", { class: "prompt-card mc-prompt", text: "Invent an award. Any award. Then everyone votes on who gets it." }),
      el("p", { class: "muted", text: "“WHY WOULD YOU DO THAT” · “CPI Employee of the Month” · “Bro Had a Plan” · “OSHA Would Like a Word”" }),
      meter,
    ],
    (next) => {
      head.setTimer(next.timer);
      setMeter(next);
    },
  );
}

function buildAwardVote(s) {
  const g = s.game;
  const head = header("End of incident", "WHO GETS WHAT?", s.timer);
  const meter = el("p", { class: "vote-meter", role: "status" });
  const setMeter = (next) => meter.replaceChildren("Ballots complete: ", el("strong", { text: `${next.game.awards.done} / ${next.game.awards.needed}` }));
  setMeter(s);
  return layout(
    s,
    [
      head.node,
      el(
        "ul",
        { class: "mc-awards" },
        g.awards.list.map((a) => el("li", {}, el("p", { class: "mc-award-name", text: a.name }), a.description ? el("p", { class: "muted", text: a.description }) : null)),
      ),
      meter,
    ],
    (next) => {
      head.setTimer(next.timer);
      setMeter(next);
    },
  );
}

function buildAwardResults(s) {
  const g = s.game;
  const o = g.outcome;
  const head = header(`End of incident · ${o.title}`, "THE AWARDS", s.timer);
  return layout(
    s,
    [
      head.node,
      el(
        "ul",
        { class: "mc-awards mc-trophies" },
        g.awards.results.map((a) =>
          el(
            "li",
            {},
            el("span", { class: "mc-trophy", "aria-hidden": "true", text: "🏆" }),
            el("p", { class: "mc-award-name", text: a.name }),
            a.description ? el("p", { class: "muted", text: a.description }) : null,
            el("p", { class: "mc-award-winner", text: a.winners.length ? a.winners.map((w) => w.name).join(" & ") : "No votes" }),
            a.winners.length ? el("p", { class: "muted mono", text: plural(a.winners[0].votes, "vote") }) : null,
          ),
        ),
      ),
      el("section", {}, el("h2", { text: "Final scores" }), leaderboard(o)),
    ],
    (next) => head.setTimer(next.timer),
  );
}

const BUILDERS = {
  ALERT: buildAlert,
  UPDATE: buildUpdate,
  RESPONSE: buildResponse,
  PROCESSING: buildProcessing,
  CONSEQUENCE: buildConsequence,
  STAGE_VOTE: buildVote,
  OUTCOME: buildOutcome,
  AWARD_SUBMIT: buildAwardSubmit,
  AWARD_VOTE: buildAwardVote,
  AWARD_RESULTS: buildAwardResults,
};

export function render(mount, state) {
  const g = state.game;
  const build = BUILDERS[g.phase];
  if (build) mount(`mycob:${g.incident.code}:${g.phase}:${g.stage}`, build, state);
}
