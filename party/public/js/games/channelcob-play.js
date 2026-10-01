// Channel Cob on a phone: a glanceable role card. Who am I, what do I know, what do I do right now.
// No typing — you say it out loud.

import { el, notice, timerEl } from "../common.js";

function whoAmI(s) {
  const g = s.game;
  const y = g.you;
  const status = y.onAir ? el("span", { class: "cc-live small", text: "● ON AIR" }) : y.upNext ? el("span", { class: "cc-tag", text: "UP NEXT" }) : null;
  return el(
    "div",
    { class: "cc-who" },
    el("span", { class: "cc-who-glyph", "aria-hidden": "true", text: y.glyph }),
    el("div", {}, el("span", { class: "eyebrow", text: "Who am I" }), el("strong", { text: y.roleName })),
    status,
    el("span", { class: "cc-clock" }, timerEl(s.timer)),
  );
}

function doNow(text, hot = false) {
  return el("div", { class: `cc-do ${hot ? "hot" : ""}` }, el("span", { class: "eyebrow", text: "What to do right now" }), el("p", { text }));
}

function knowEl(y) {
  return el(
    "div",
    { class: "cc-know" },
    el("span", { class: "eyebrow", text: "What I know (private)" }),
    el("ul", {}, [...y.brief, ...y.known.map((k) => `UPDATE: ${k}`)].map((line) => el("li", { text: line }))),
  );
}

function send(tools, note, action, payload) {
  return tools.request("game:input", { action, payload }).then((r) => {
    if (!r.ok) notice(note, r.message ?? "That didn't go through.", "error");
    return r.ok;
  });
}

function buildBrief(s) {
  const g = s.game;
  const y = g.you;
  const what = g.phase === "INTRO" ? (g.segment > 1 ? "New segment — you have a new role." : "Breaking news! You're on the Channel Cob team.") : `${y.job}`;
  return { node: el("div", { class: "stack cc-phone" }, whoAmI(s), doNow(g.phase === "INTRO" ? what : `Read your notes. ${y.job} Don't show your phone.`), knowEl(y)) };
}

function buildLive(s, tools) {
  const g = s.game;
  const y = g.you;
  const note = el("p", { class: "notice", role: "status" });
  const instruction = y.onAir ? (y.prompt ? `You're ON AIR. ${y.prompt}` : "You're ON AIR. Talk!") : y.upNext ? `You're up next. ${y.prompt ?? "Get ready."}` : `Listen. React if you're asked. ${g.speaker ? `On air: ${g.speaker.roleName}.` : ""}`;

  const breaking = y.breaking.map((b) =>
    el(
      "div",
      { class: "cc-breakcard" },
      el("span", { class: "cc-breaking", text: "BREAKING · ONLY YOU KNOW" }),
      el("p", { text: b.text }),
      el("button", { class: "btn big danger", type: "button", text: "GO LIVE WITH IT", onclick: () => send(tools, note, "golive", { id: b.id }) }),
    ),
  );

  const d = y.decision;
  const decision = d
    ? el(
        "div",
        { class: "cc-decision" },
        el("span", { class: "eyebrow", text: "Quick call — tap now" }),
        el("p", { text: d.question }),
        el(
          "div",
          { class: "cc-choices" },
          d.options.map((label, i) =>
            el("button", { class: `btn ${d.chosen === i ? "chosen" : d.chosen === null ? "" : "ghost"}`, type: "button", disabled: d.chosen !== null, text: label, onclick: () => send(tools, note, "choose", { id: d.id, option: i }) }),
          ),
        ),
        d.chosen !== null ? el("p", { class: "muted", text: "Now act it out on air." }) : null,
      )
    : null;

  return {
    node: el(
      "div",
      { class: "stack cc-phone" },
      whoAmI(s),
      doNow(instruction, y.onAir),
      breaking,
      decision,
      knowEl(y),
      y.canHandOff ? el("button", { class: "btn ghost", type: "button", text: y.onAir ? "DONE — HAND OFF ▸" : "CUT TO NEXT SPEAKER ▸", onclick: () => send(tools, note, "handoff") }) : null,
      note,
    ),
  };
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
  return {
    node: el(
      "div",
      { class: "stack cc-phone" },
      el("div", { class: "cc-who" }, el("strong", { text: "OFF AIR · FACT CHECK" }), el("span", { class: "cc-clock" }, timerEl(s.timer))),
      el("p", { class: "phone-prompt", text: g.poll.question }),
      el(
        "div",
        { class: "cc-choices col" },
        g.poll.options.map((o) => el("button", { class: `btn ${y.answer === o.id ? "chosen" : "ghost"}`, type: "button", text: o.text, onclick: () => send(tools, note, "answer", { id: o.id }) })),
      ),
      others.length ? el("span", { class: "eyebrow", text: "🏆 MVP of the segment" }) : null,
      others.length ? chips("mvp", y.mvp) : null,
      others.length ? el("span", { class: "eyebrow", text: "🌀 Who lost the story?" }) : null,
      others.length ? chips("lost", y.lost) : null,
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
      el("div", { class: "cc-who" }, el("strong", { text: "SEGMENT RECAP" }), el("span", { class: "cc-clock" }, timerEl(s.timer))),
      el("p", { class: "cc-stars", text: "★".repeat(r.stars) + "☆".repeat(5 - r.stars) }),
      el("p", {}, "The truth: ", el("strong", { text: r.truth })),
      el("p", { class: "muted", text: `Accuracy ${r.accuracy}% · Panic ${r.panicLabel} · CPI ${r.repLabel}` }),
      doNow(s.game.segment < s.game.totalSegments ? "Next segment: roles rotate. Watch your phone." : "Final results next."),
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
      el("p", { class: "cc-stars", text: "★".repeat(f.stars) + "☆".repeat(5 - f.stars) }),
      el("p", { text: `Channel Cob rating: ${f.rating}` }),
      mine.length ? el("div", { class: "cc-know" }, el("span", { class: "eyebrow", text: "Your awards" }), el("ul", {}, mine.map((a) => el("li", { text: a.title })))) : el("p", { class: "muted", text: "No awards for you tonight. There's always the late show." }),
    ),
  };
}

export function render(mount, state, tools) {
  const g = state.game;
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
