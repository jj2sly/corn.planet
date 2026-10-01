// Channel Cob on the big screen: a live news broadcast. The screen always says who is on air and
// who is up next; everything private stays on the phones.

import { el, rank, scoreboardEl, timerEl } from "../common.js";
import { playNewCues } from "./mycob-sound.js";
import { renderHostTutorial } from "./party-tutorial.js";

const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

function chrome(g, timer, { live = false, label = "" } = {}) {
  const slot = el("div", { class: "cc-clock" }, timerEl(timer));
  const node = el(
    "div",
    { class: "cc-top" },
    el("div", { class: "cc-logo" }, el("span", { class: "cc-logo-mark", text: "📺" }), el("span", {}, "CHANNEL ", el("strong", { text: "COB" }))),
    live ? el("span", { class: "cc-live", text: "● LIVE" }) : el("span", { class: "cc-tag", text: label }),
    el("span", { class: "muted", text: `Segment ${g.segment} of ${g.totalSegments}` }),
    slot,
  );
  return { node, setTimer: (t) => slot.replaceChildren(timerEl(t)) };
}

function banner(g) {
  return el("div", { class: "cc-banner" }, el("span", { class: "cc-breaking", text: "BREAKING NEWS" }), el("span", { class: "cc-headline", text: g.headline }));
}

function ticker(g) {
  const items = g.ticker.join("  ◆  ");
  return el("div", { class: "cc-ticker", "aria-label": "News ticker" }, el("span", { class: "cc-ticker-label", text: "CHANNEL COB" }), el("div", { class: "cc-ticker-track" }, el("span", { class: "cc-ticker-text", text: `${items}  ◆  ${items}` })));
}

function meters(g) {
  const meter = (label, value, word, bad) => {
    const fill = el("span", { class: "cc-meter-fill" });
    fill.style.setProperty("--pct", `${value}%`);
    return el("div", { class: `cc-meter ${bad ? "bad" : ""}` }, el("span", { class: "eyebrow", text: label }), el("span", { class: "cc-meter-bar" }, fill), el("strong", { text: word }));
  };
  return el("div", { class: "cc-meters" }, meter("Public panic", g.panic, g.panicLabel, g.panic >= 55), meter("CPI reputation", g.rep, g.repLabel, g.rep < 45), el("div", { class: "cc-meter" }, el("span", { class: "eyebrow", text: "Chaos" }), el("strong", { text: String(g.chaos) })));
}

function rosterEl(g, { speaker = null, next = null } = {}) {
  return el(
    "div",
    { class: `cc-roster n${g.roster.length}` },
    g.roster.map((r) =>
      el(
        "div",
        { class: `cc-tile ${speaker === r.role ? "on" : ""} ${next === r.role ? "next" : ""}`.trim() },
        el("span", { class: "cc-tile-glyph", "aria-hidden": "true", text: r.glyph }),
        el("strong", { text: r.name }),
        el("span", { class: "cc-tile-role", text: r.roleName }),
        speaker === r.role ? el("span", { class: "cc-live small", text: "ON AIR" }) : next === r.role ? el("span", { class: "cc-tag", text: "UP NEXT" }) : null,
      ),
    ),
  );
}

function guide(what, todo) {
  return el("div", { class: "cc-guide" }, el("p", {}, el("span", { class: "eyebrow", text: "What's happening " }), what), el("p", {}, el("span", { class: "eyebrow", text: "What to do " }), el("strong", { text: todo })));
}

// ------------------------------------------------------------------ phases

function buildIntro(s) {
  const g = s.game;
  const c = chrome(g, s.timer, { label: "INTERRUPTING YOUR PROGRAMME" });
  return {
    node: el(
      "div",
      { class: "cc cc-intro" },
      c.node,
      el("div", { class: "cc-sting" }, el("span", { class: "cc-breaking big", text: g.segment === 1 ? "BREAKING NEWS" : g.segment === g.totalSegments ? "FINAL BROADCAST" : "DEVELOPING STORY" }), el("h1", { text: g.headline }), el("p", { class: "cc-sub", text: `📍 ${g.location}` })),
      el("p", { class: "eyebrow cc-center", text: g.segment > 1 ? "Roles have rotated. Your new desk:" : "Tonight's news team" }),
      rosterEl(g),
      ticker(g),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

function buildPrep(s) {
  const g = s.game;
  const c = chrome(g, s.timer, { label: "GOING LIVE IN" });
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      banner(g),
      guide("The news team is getting briefed. Everyone knows something different.", "Read your phone: WHO you are, WHAT you know, WHAT to do. Don't show anyone."),
      rosterEl(g),
      meters(g),
      ticker(g),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

function buildLive(s) {
  const g = s.game;
  const c = chrome(g, s.timer, { live: true });
  const sp = g.speaker;
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      banner(g),
      el(
        "div",
        { class: "cc-stage" },
        el(
          "div",
          { class: `cc-onair ${sp?.breaking ? "breaking" : ""}` },
          el("span", { class: "cc-onair-glyph", "aria-hidden": "true", text: sp?.glyph ?? "🎙️" }),
          el(
            "div",
            { class: "cc-lower-third" },
            el("span", { class: "cc-lt-role", text: sp?.breaking ? `BREAKING · ${sp.roleName}` : (sp?.roleName ?? "") }),
            el("strong", { class: "cc-lt-name", text: sp?.name ?? "" }),
            el("span", { class: "cc-lt-loc", text: `📍 ${g.location}` }),
          ),
          el("p", { class: "cc-turn", text: `Turn ${g.turn} of ${g.totalTurns}${g.next ? ` · Up next: ${g.next.roleName} (${g.next.name})` : " · Last word"}` }),
        ),
        el(
          "div",
          { class: "cc-side" },
          g.incoming.length ? el("div", { class: "cc-incoming" }, `⚡ Incoming to the ${g.incoming.join(" & ")}…`) : null,
          g.decisionLive && !g.decisionLive.done ? el("div", { class: "cc-incoming soft" }, `⏳ The ${g.decisionLive.roleName} has a call to make`) : null,
          meters(g),
          rosterEl(g, { speaker: sp?.role, next: g.next?.role }),
        ),
      ),
      ticker(g),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

function buildPoll(s) {
  const g = s.game;
  const c = chrome(g, s.timer, { label: "OFF AIR · FACT CHECK" });
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      guide("We're off air. Time to see if anyone actually got the story.", `On your phone: answer the fact check, then vote MVP and who lost the story. ${g.poll.answered}/${g.poll.players} answered.`),
      el("div", { class: "cc-poll" }, el("h2", { text: g.poll.question }), el("ol", {}, g.poll.options.map((o) => el("li", { text: o.text })))),
      ticker(g),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

function stat(label, value, word) {
  return el("div", { class: "cc-stat" }, el("span", { class: "eyebrow", text: label }), el("strong", { text: value }), word ? el("span", { class: "muted", text: word }) : null);
}

function buildRecap(s) {
  const g = s.game;
  const r = g.recap;
  const c = chrome(g, s.timer, { label: "SEGMENT RECAP" });
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      el("div", { class: "cc-sting small" }, el("span", { class: "cc-stars", text: stars(r.stars) }), el("p", { class: "cc-sub", text: `The truth: ${r.truth}` })),
      el(
        "div",
        { class: "cc-stats" },
        stat("Accuracy", `${r.accuracy}%`),
        stat("Coherence", `${r.coherence}%`, r.coherenceLabel),
        stat("Breaking-news reactions", `${r.reactions}%`),
        stat("Public panic", r.panicLabel),
        stat("CPI reputation", r.repLabel),
      ),
      el("div", { class: "cc-highlights" }, r.mvp ? el("p", {}, "🏆 Segment MVP: ", el("strong", { text: r.mvp })) : null, r.lost ? el("p", {}, "🌀 Lost the story: ", el("strong", { text: r.lost })) : null, r.highlights.map((h) => el("p", { class: "cc-moment", text: `“${h}”` }))),
      ticker(g),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

function buildFinale(s) {
  const g = s.game;
  const f = g.finale;
  const c = chrome(g, s.timer, { label: "THAT'S ALL FOR TONIGHT" });
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      el("div", { class: "cc-sting small" }, el("span", { class: "cc-stars", text: stars(f.stars) }), el("h1", { text: `CHANNEL COB RATING: ${f.rating}` })),
      el("div", { class: "cc-stats" }, stat("Accuracy", `${f.accuracy}%`), stat("CPI reputation", f.repLabel), stat("Public panic", `${f.panic}%`), stat("Chaos caused", String(f.chaos))),
      el(
        "div",
        { class: "cc-finale" },
        el("div", { class: "cc-awards" }, f.awards.map((a) => el("div", { class: "cc-award" }, el("span", { class: "eyebrow", text: a.title }), el("strong", { text: a.winner }), el("span", { class: "muted", text: a.detail })))),
        el("div", {}, el("span", { class: "eyebrow", text: "Standout moments" }), f.moments.map((m) => el("p", { class: "cc-moment", text: `“${m}”` })), scoreboardEl(rank(s.players))),
      ),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

const BUILDERS = { INTRO: buildIntro, PREP: buildPrep, LIVE: buildLive, POLL: buildPoll, RECAP: buildRecap, FINALE: buildFinale };

export function render(mount, state, tools) {
  const g = state.game;
  playNewCues(`channelcob:${state.code}`, g.cues ?? []);
  if (g.phase === "TUTORIAL") return renderHostTutorial(mount, state, { hostRequest: tools.hostRequest, title: "Channel Cob" });
  const build = BUILDERS[g.phase];
  if (!build) return;
  // No inputs on the host, so it rebuilds whenever the on-screen state changes.
  const live = JSON.stringify([g.turn, g.speaker, g.incoming, g.decisionLive, g.ticker[0], g.panic, g.rep, g.poll?.answered]);
  mount(`channelcob:${g.phase}:${g.segment}:${live}`, build, state);
}
