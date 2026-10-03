// Channel Cob on a phone. Top: my role and whether I'm on air. Middle: ONE current task (a breaking
// update or quick call replaces the on-air card rather than piling on). Lower: my private notes.
// Bottom: the one action. No typing: you say it out loud.

import { el, notice, timerEl } from "../common.js";
import { currentTask, stateLabel } from "./channelcob-task.js";
import { rememberTutorialSeen, renderPhoneTutorial } from "./party-tutorial.js";

/** Role (small, always on top) with its one-line job, the state chip and the clock. */
function roleBar(s) {
  const g = s.game;
  const y = g.you;
  const state = stateLabel(g);
  const chip = state === "ON AIR" ? el("span", { class: "cc-live small", text: "● ON AIR" }) : el("span", { class: `cc-tag ${state === "UP NEXT" ? "hot" : ""}`.trim(), text: state });
  return el(
    "div",
    { class: "cc-who" },
    el("span", { class: "cc-who-glyph", "aria-hidden": "true", text: y.glyph }),
    el("div", {}, el("strong", { text: y.roleName }), el("span", { class: "cc-who-job", text: y.job })),
    chip,
    el("span", { class: "cc-clock" }, timerEl(s.timer)),
  );
}

function send(tools, note, action, payload) {
  return tools.request("game:input", { action, payload }).then((r) => {
    if (!r.ok) notice(note, r.message ?? "That didn't go through.", "error");
    return r.ok;
  });
}

/** The strongest thing on screen: one card for the one thing to do now. */
function taskCard(task, tools, note) {
  if (task.kind === "intro") {
    return el("div", { class: "cc-task intro" }, el("h2", { class: "cc-task-title", text: task.title }), el("p", { class: "cc-task-text", text: task.text }), task.note ? el("p", { class: "muted", text: task.note }) : null);
  }
  if (task.kind === "breaking") {
    return el(
      "div",
      { class: "cc-task breaking" },
      el("span", { class: "cc-breaking", text: task.tag }),
      el("p", { class: "cc-task-text", text: task.text }),
      el("p", { class: "cc-task-job" }, el("strong", { text: "YOUR JOB: " }), task.job),
      el("button", { class: "btn big danger", type: "button", text: "GO LIVE WITH IT", onclick: () => send(tools, note, "golive", { id: task.id }) }),
      task.more ? el("p", { class: "muted", text: `+${task.more} more waiting` }) : null,
    );
  }
  if (task.kind === "decision") {
    return el(
      "div",
      { class: "cc-task decision" },
      el("h2", { class: "cc-task-title", text: task.title }),
      el("p", { class: "cc-task-text", text: task.text }),
      el("div", { class: `cc-choices ${task.options.length > 2 ? "col" : ""}`.trim() }, task.options.map((label, i) => el("button", { class: "btn big", type: "button", text: label, onclick: () => send(tools, note, "choose", { id: task.id, option: i }) }))),
    );
  }
  return el("div", { class: `cc-task ${task.kind}` }, el("h2", { class: "cc-task-title", text: task.title }), el("p", { class: "cc-task-text", text: task.text }), task.note ? el("p", { class: "muted", text: task.note }) : null);
}

/** 1–3 short private bullets; anything learned earlier is tucked away. */
function notesEl(y) {
  return el(
    "div",
    { class: "cc-know" },
    el("span", { class: "eyebrow", text: "You know" }),
    el("ul", {}, y.brief.map((line) => el("li", { text: line }))),
    y.known.length ? el("details", { class: "cc-earlier" }, el("summary", { text: `Earlier news (${y.known.length})` }), el("ul", {}, y.known.map((k) => el("li", { text: k })))) : null,
  );
}

function buildBrief(s) {
  const y = s.game.you;
  return { node: el("div", { class: "stack cc-phone" }, roleBar(s), taskCard(currentTask(s.game)), notesEl(y)) };
}

function buildLive(s, tools) {
  const g = s.game;
  const y = g.you;
  const note = el("p", { class: "notice", role: "status" });
  const task = currentTask(g);
  const handoff = y.canHandOff ? el("button", { class: `btn ${task.kind === "live" ? "" : "ghost"}`.trim(), type: "button", text: y.onAir ? "DONE — HAND OFF ▸" : "CUT TO NEXT SPEAKER ▸", onclick: () => send(tools, note, "handoff") }) : null;
  return { node: el("div", { class: "stack cc-phone" }, roleBar(s), taskCard(task, tools, note), notesEl(y), handoff, note) };
}

function buildPoll(s, tools) {
  const g = s.game;
  const y = g.you;
  const note = el("p", { class: "notice", role: "status" });
  const others = g.roster.filter((r) => r.playerId !== s.you?.id && r.role !== y.role);
  const chips = (action, chosen) =>
    el(
      "div",
      { class: "cc-chips" },
      others.map((r) => el("button", { class: `btn small ${chosen === r.playerId ? "chosen" : "ghost"}`, type: "button", text: r.name, onclick: () => send(tools, note, action, { playerId: r.playerId }) })),
    );
  // The fact check is the job; the two votes appear once it's answered.
  const votes = y.answer && others.length ? [el("span", { class: "eyebrow", text: "🏆 MVP" }), chips("mvp", y.mvp), el("span", { class: "eyebrow", text: "🌀 Lost the story" }), chips("lost", y.lost)] : [];
  return {
    node: el(
      "div",
      { class: "stack cc-phone" },
      el("div", { class: "cc-who" }, el("strong", { text: "OFF AIR" }), el("span", { class: "cc-tag", text: "FACT CHECK" }), el("span", { class: "cc-clock" }, timerEl(s.timer))),
      el("div", { class: "cc-task decision" }, el("h2", { class: "cc-task-title", text: g.poll.question }), el("div", { class: "cc-choices col" }, g.poll.options.map((o) => el("button", { class: `btn big ${y.answer === o.id ? "chosen" : y.answer ? "ghost" : ""}`.trim(), type: "button", text: o.text, onclick: () => send(tools, note, "answer", { id: o.id }) })))),
      ...votes,
      note,
    ),
  };
}

function buildRecap(s) {
  const r = s.game.recap;
  return {
    node: el(
      "div",
      { class: "stack cc-phone" },
      el("div", { class: "cc-who" }, el("strong", { text: "RECAP" }), el("span", { class: "cc-clock" }, timerEl(s.timer))),
      el("div", { class: "cc-task" }, el("p", { class: "cc-stars", text: "★".repeat(r.stars) + "☆".repeat(5 - r.stars) }), el("p", { class: "cc-task-text" }, "The truth: ", el("strong", { text: r.truth })), el("p", { class: "muted", text: `Accuracy ${r.accuracy}%` })),
      el("p", { class: "muted", text: s.game.segment < s.game.totalSegments ? "Next: new roles." : "Final results next." }),
    ),
  };
}

function buildFinale(s) {
  const f = s.game.finale;
  const mine = f.awards.filter((a) => a.winner === s.game.roster.find((r) => r.role === s.game.you.role)?.name);
  return {
    node: el(
      "div",
      { class: "stack cc-phone" },
      el("div", { class: "cc-who" }, el("strong", { text: "THAT'S A WRAP" })),
      el("div", { class: "cc-task" }, el("p", { class: "cc-stars", text: "★".repeat(f.stars) + "☆".repeat(5 - f.stars) }), el("p", { class: "cc-task-text", text: `Rating: ${f.rating}` })),
      mine.length ? el("div", { class: "cc-know" }, el("span", { class: "eyebrow", text: "Your awards" }), el("ul", {}, mine.map((a) => el("li", { text: a.title })))) : el("p", { class: "muted", text: "No awards tonight." }),
    ),
  };
}

export function render(mount, state, tools) {
  const g = state.game;
  if (g.phase === "TUTORIAL") return renderPhoneTutorial(mount, state, tools);
  rememberTutorialSeen(state);
  if (!g.you) return mount("channelcob:watch", () => ({ node: el("div", { class: "big-status" }, el("h2", { text: "Watching Channel Cob" }), el("p", { class: "muted", text: "Follow the big screen." })) }), state);
  const y = g.you;
  const key = `channelcob:${g.phase}:${g.segment}:${JSON.stringify([g.turn, y.onAir, y.upNext, y.prompt, y.breaking, y.decision, y.known.length, y.answer, y.mvp, y.lost])}`;
  switch (g.phase) {
    case "INTRO":
    case "PREP":
      return mount(key, buildBrief, state);
    case "LIVE":
      return mount(key, (s) => buildLive(s, tools), state);
    case "POLL":
      return mount(key, (s) => buildPoll(s, tools), state);
    case "RECAP":
      return mount(key, buildRecap, state);
    case "FINALE":
      return mount(key, buildFinale, state);
  }
}
