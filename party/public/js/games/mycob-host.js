// My Cob Escaped on the big screen: the incident board, the narrator, the combined consequence,
// the vote, the ending and the awards. Players' raw responses never reach this screen; it shows
// the director's interpretation of them.

import { el, plural, timerEl } from "../common.js";
import {
  beat,
  ENDING_FLAVOR,
  entityCard,
  factsList,
  hallOfFame,
  leaderboard,
  liveNarration,
  livesEl,
  narrationEl,
  PENDING_REPORT,
  objectivesList,
  outcomeStamp,
  personnelList,
  podium,
  reveal,
  situationEl,
  stampEl,
  statusGrid,
  summaryTiles,
  systemsList,
} from "./mycob-shared.js";
import { playNewCues, preloadSounds, soundControl, timerWarning } from "./mycob-sound.js";
import { speakNew } from "./mycob-voice.js";

function header(eyebrow, title, timer) {
  const timerSlot = el("div", {}, timerEl(timer));
  const node = el("div", { class: "phase-head" }, el("div", {}, el("p", { class: "eyebrow", text: eyebrow }), el("h1", { text: title })), timerSlot);
  return { node, setTimer: (t) => timerSlot.replaceChildren(timerEl(t)) };
}

const stageLabel = (g) => (g.stage ? `Incident ${g.incident.code} · Stage ${g.stage} of ${g.totalStages}` : `Incident ${g.incident.code}`);

/**
 * The incident board down the side: what it is, how bad it is, what we're trying to do, who's on
 * it. The status of every stat, system and staff member folds away under "Full status".
 */
function board(g) {
  const inc = g.incident;
  const open = inc.objectives.filter((o) => o.status === "active");
  const done = inc.objectives.length - open.length;
  return el(
    "aside",
    { class: "mc-board", "aria-label": "Incident board" },
    entityCard(inc),
    situationEl(inc.statuses),
    el("section", {}, el("h3", { text: `Objectives${done ? ` · ${done} resolved` : ""}` }), objectivesList(open.length ? open : inc.objectives)),
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
            el("span", { class: "grow" }, el("strong", { text: c.name }), el("span", { class: "muted", text: ` · ${c.roleIcon}` })),
            c.submitted === true ? stampEl("filed", "ok") : null,
            c.down ? stampEl("down", "danger") : livesEl(c.lives, g.maxLives),
          ),
        ),
      ),
    ),
    el(
      "details",
      { class: "mc-more" },
      el("summary", { text: "Full status" }),
      statusGrid(inc),
      el("h3", { text: "Facility" }),
      systemsList(inc),
      el("h3", { text: "Personnel" }),
      personnelList(inc),
      inc.facts.length ? [el("h3", { text: "What we know" }), factsList(inc.facts)] : null,
    ),
  );
}

/** The countdown worth a warning on the big screen: the responses. (Phones warn their own late voters.) */
const warnKey = (g) => (g.phase === "RESPONSE" ? `${g.incident.code}:${g.phase}:${g.stage}` : null);

/** Main column + board. `main` is rebuilt per phase; the board refreshes on every update. */
function layout(s, mainNodes, onUpdate) {
  const side = el("div", {}, board(s.game));
  // Outside the board, which is rebuilt on every update: a slider being dragged must survive it.
  const node = el("div", { class: "mc-layout" }, el("div", { class: "mc-main stack" }, ...mainNodes), el("div", {}, side, soundControl()));
  speakNew(s.game.incident.code, s.game.narration);
  preloadSounds();
  // A screen that opens on a fresh incident plays its opening klaxon; one that joins later plays nothing old.
  playNewCues(s.game.incident.code, s.game.cues, { fresh: s.game.phase === "ALERT" });
  timerWarning(warnKey(s.game), s.timer);
  return {
    node,
    update(next) {
      side.replaceChildren(board(next.game));
      speakNew(next.game.incident.code, next.game.narration);
      playNewCues(next.game.incident.code, next.game.cues);
      timerWarning(warnKey(next.game), next.timer);
      onUpdate?.(next);
    },
  };
}

function situation(inc) {
  return el(
    "div",
    { class: "mc-situation" },
    el("p", { class: "eyebrow", text: `${inc.breach.name} · ${inc.location.name}` }),
    el("p", { class: "mc-problem", text: inc.problem }),
    inc.environment.length ? el("ul", { class: "mc-env" }, inc.environment.map((t) => el("li", { text: `⚠ ${t}` }))) : null,
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
    g.incident.crew.map((c) => el("li", {}, el("strong", { text: c.name }), el("span", { text: `${c.roleIcon} ${c.role}` }))),
  );
  const narration = liveNarration(g.narration);
  return layout(
    s,
    [
      head.node,
      el("div", { class: "warning mc-siren", text: "Containment breach" }),
      situation(g.incident),
      narration.node,
      el("h2", { text: "Your roles" }),
      crew,
    ],
    (next) => {
      head.setTimer(next.timer);
      narration.set(next.game.narration);
      crew.replaceChildren(...next.game.incident.crew.map((c) => el("li", {}, el("strong", { text: c.name }), el("span", { text: `${c.roleIcon} ${c.role}` }))));
    },
  );
}

function buildUpdate(s) {
  const g = s.game;
  const head = header(stageLabel(g), "INCIDENT UPDATE", s.timer);
  const r = g.recap;
  return layout(
    s,
    [
      head.node,
      r && r.stage > 1 ? el("section", {}, el("h2", { text: "What happened" }), el("ul", { class: "mc-recap-happened" }, r.happened.map((t) => el("li", { text: t }))), r.vote ? el("p", { class: "mc-recap-vote", text: `🗳 ${r.vote}` }) : null) : null,
      el("div", { class: "prompt-card mc-prompt", text: r?.now ?? g.incident.problem }),
      r?.risks?.length ? el("p", { class: "mc-recap-risks", text: `⚠ ${r.risks.join(" · ")}` }) : null,
      narrationEl(g.narration),
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
      el("div", { class: "prompt-card mc-prompt", text: g.recap?.now ?? g.incident.problem }),
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
        el("p", { class: "mc-processing-text", text: "WORKING OUT WHAT YOU ALL JUST DID" }),
      ),
    ],
    // The timer shortens once the director has answered.
    (next) => head.setTimer(next.timer),
  );
}

/** Each move's result, one line each: the narration above tells the story. */
function actionCards(consequence) {
  return el(
    "ul",
    { class: "mc-actions" },
    consequence.actions.map((a) =>
      el(
        "li",
        { dataset: { outcome: a.outcome } },
        el("div", { class: "row spread" }, el("strong", { text: a.name }), outcomeStamp(a.outcome, a.outcomeLabel)),
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
  return el("section", { class: "panel quiet" }, el("h3", { text: "Changes" }), el("ul", { class: "mc-changes" }, items.slice(0, 4).map((t) => el("li", { text: t }))));
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
      narrationEl(g.narration.filter((n) => n.type === "consequence" || n.type === "special_event")),
      actionCards(c),
      c.discoveries.length ? el("section", {}, el("h2", { text: "Discovered" }), factsList(c.discoveries.slice(0, 2))) : null,
      changesPanel(c),
      el("p", { class: "mc-next", text: c.next }),
    ],
    (next) => head.setTimer(next.timer),
  );
}

function buildVote(s) {
  const g = s.game;
  const head = header(stageLabel(g), "WHICH MOVE HELPED MOST?", s.timer);
  const meter = el("p", { class: "vote-meter", role: "status" });
  const setMeter = (next) =>
    meter.replaceChildren("Anonymous votes: ", el("strong", { text: `${next.game.vote.cast} / ${next.game.vote.needed}` }), " · vote on your phone");
  setMeter(s);
  return layout(
    s,
    [
      head.node,
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

/** The ending stamp, the entity unmasked, and the closing report a beat later. */
function endingBlock(g) {
  const o = g.outcome;
  const flavor = ENDING_FLAVOR[o.id];
  const text = el("p", { class: "mc-ending-text", text: o.narration ?? PENDING_REPORT });
  const node = el(
    "div",
    { class: `mc-ending e-${o.id} stack` },
    el("p", { class: "eyebrow", text: `Incident ${g.incident.code} · ${plural(o.stagesPlayed, "stage")}` }),
    el("h1", { class: "mc-stamp" }, el("span", { "aria-hidden": "true", text: `${flavor?.icon ?? "⚠"} ` }), o.title),
    flavor ? reveal(el("p", { class: "mc-ending-line", text: flavor.line }), 0.7) : null,
    reveal(
      el(
        "div",
        { class: "reference" },
        el("span", { class: "eyebrow", text: o.initiallyUnknown ? "The unknown entity was" : "Entity" }),
        el("strong", { class: "reference-id", text: o.entity.ref }),
        el("span", { class: "muted", text: `${o.entity.title} · ${o.entity.classification}` }),
      ),
      1.2,
    ),
    reveal(text, 2),
  );
  return { node, set: (next) => (text.textContent = next.outcome.narration ?? PENDING_REPORT) };
}

// The finale reveals itself in beats, well inside the outcome timer: the stamp, the report, the team,
// the podium, then the halls of glory and shame. The full debrief stays a tap away.
function buildOutcome(s) {
  const g = s.game;
  const o = g.outcome;
  const head = header("Operation complete", "", s.timer);
  const ending = endingBlock(g);
  return layout(
    s,
    [
      head.node,
      ending.node,
      beat(3.5, el("h2", { text: "Final scores" })),
      podium(o, { at: 4 }),
      beat(8, hallOfFame(o)),
      beat(
        9,
        el("details", { class: "mc-debrief" }, el("summary", { text: "Full debrief" }), summaryTiles(o), el("p", { class: "muted", text: `Team bonus for everyone: +${o.team}` }), breakdownTable(o)),
        el("p", { class: "muted", text: "Everything that happened in this incident is game-only. The CPI Database is unchanged." }),
      ),
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
  const results = g.awards.results;
  // One trophy at a time, then the final standings, all inside the results timer.
  const step = Math.min(1.6, 8 / Math.max(1, results.length));
  const after = 0.6 + results.length * step;
  return layout(
    s,
    [
      head.node,
      el(
        "ul",
        { class: "mc-awards mc-trophies" },
        results.map((a, i) =>
          reveal(
            el(
              "li",
              {},
              el("span", { class: "mc-trophy", "aria-hidden": "true", text: "🏆" }),
              el("p", { class: "mc-award-name", text: a.name }),
              a.description ? el("p", { class: "muted", text: a.description }) : null,
              el("p", { class: "mc-award-winner", text: a.winners.length ? a.winners.map((w) => w.name).join(" & ") : "No votes" }),
              a.winners.length ? el("p", { class: "muted mono", text: plural(a.winners[0].votes, "vote") }) : null,
            ),
            0.6 + i * step,
          ),
        ),
      ),
      beat(after, el("h2", { text: "Final standings" }), leaderboard(o)),
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
