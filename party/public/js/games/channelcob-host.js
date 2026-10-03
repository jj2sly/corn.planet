// Channel Cob on the big screen: a live news broadcast. The screen always says who is on air (name
// and role), who is up next and what the story is; everything private stays on the phones.

import { el, rank, scoreboardEl, timerEl } from "../common.js";
import { SEGMENT_STEPS, segmentStep } from "./channelcob-task.js";
import { playNewCues } from "./mycob-sound.js";
import { renderHostTutorial } from "./party-tutorial.js";

const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

/** Where we are in the segment: PREP → LIVE → FACT CHECK → RECAP, the current one lit. */
function steps(g) {
  const at = segmentStep(g.phase);
  return el("ol", { class: "cc-steps", "aria-label": "Segment steps" }, SEGMENT_STEPS.map((name, i) => el("li", { class: i === at ? "on" : i < at ? "done" : "", "aria-current": i === at ? "step" : null, text: name })));
}

function chrome(g, timer, { live = false } = {}) {
  const slot = el("div", { class: "cc-clock" }, timerEl(timer));
  const node = el(
    "div",
    { class: "cc-top" },
    el("div", { class: "cc-logo" }, el("span", { class: "cc-logo-mark", text: "📺" }), el("span", {}, "CHANNEL ", el("strong", { text: "COB" }))),
    live ? el("span", { class: "cc-live", text: "● LIVE" }) : null,
    steps(g),
    el("span", { class: "muted", text: `Segment ${g.segment}/${g.totalSegments}` }),
    slot,
  );
  return { node, setTimer: (t) => slot.replaceChildren(timerEl(t)) };
}

/** The headline strip. It turns red BREAKING, with the new ticker line, only while someone is breaking news. */
function banner(g, { breaking = false } = {}) {
  return el("div", { class: `cc-banner ${breaking ? "breaking" : ""}`.trim() }, el("span", { class: breaking ? "cc-breaking" : "cc-topstory", text: breaking ? "BREAKING NEWS" : "TOP STORY" }), el("span", { class: "cc-headline", text: breaking ? (g.ticker[0] ?? g.headline).replace(/^BREAKING:\s*/, "") : g.headline }));
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

/** One line: what to do now (big), a little context (small). */
function guide(todo, context) {
  return el("p", { class: "cc-guide" }, el("strong", { text: todo }), context ? el("span", { class: "muted", text: context }) : null);
}

// ------------------------------------------------------------------ phases

function buildIntro(s) {
  const g = s.game;
  const c = chrome(g, s.timer);
  return {
    node: el(
      "div",
      { class: "cc cc-intro" },
      c.node,
      el("div", { class: "cc-sting" }, el("span", { class: "cc-breaking big", text: g.segment === 1 ? "BREAKING NEWS" : g.segment === g.totalSegments ? "FINAL BROADCAST" : "DEVELOPING STORY" }), el("h1", { text: g.headline }), el("p", { class: "cc-sub", text: `📍 ${g.location}` })),
      el("p", { class: "eyebrow cc-center", text: g.segment > 1 ? "New roles this segment" : "Tonight's news team" }),
      rosterEl(g),
      ticker(g),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

function buildPrep(s) {
  const g = s.game;
  const c = chrome(g, s.timer);
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      banner(g),
      guide("READ YOUR PHONE", "Don't show anyone. Going live soon."),
      rosterEl(g),
      ticker(g),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

function buildLive(s) {
  const g = s.game;
  const c = chrome(g, s.timer, { live: true });
  const sp = g.speaker;
  const breaking = !!sp?.breaking;
  // One status line for what's waiting off-screen: breaking news first, else a quick call.
  const waiting = g.incoming.length ? `⚡ News coming for the ${g.incoming.join(" & ")}…` : g.decisionLive && !g.decisionLive.done ? `⏳ ${g.decisionLive.roleName} has a call to make` : null;
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      banner(g, { breaking }),
      el(
        "div",
        { class: "cc-stage" },
        el(
          "div",
          { class: "cc-onair" },
          el("span", { class: "cc-onair-glyph", "aria-hidden": "true", text: sp?.glyph ?? "🎙️" }),
          el(
            "div",
            { class: "cc-lower-third" },
            el("span", { class: "cc-lt-loc", text: `LIVE FROM ${g.location.toUpperCase()}` }),
            el("strong", { class: "cc-lt-name", text: sp?.name ?? "" }),
            el("span", { class: "cc-lt-role", text: sp?.roleName ?? "" }),
          ),
          el("p", { class: "cc-turn", text: g.next ? `Up next: ${g.next.roleName} · ${g.next.name}` : "Last word" }),
        ),
        el("div", { class: "cc-side" }, waiting ? el("div", { class: `cc-incoming ${g.incoming.length ? "" : "soft"}`.trim() }, waiting) : null, meters(g), rosterEl(g, { speaker: sp?.role, next: g.next?.role })),
      ),
      ticker(g),
    ),
    update: (n) => c.setTimer(n.timer),
  };
}

function buildPoll(s) {
  const g = s.game;
  const c = chrome(g, s.timer);
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      guide("FACT CHECK ON YOUR PHONE", `${g.poll.answered}/${g.poll.players} answered`),
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
  const c = chrome(g, s.timer);
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
        stat("Breaking news", `${r.reactions}%`),
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
  const c = chrome(g, s.timer);
  return {
    node: el(
      "div",
      { class: "cc" },
      c.node,
      el("div", { class: "cc-sting small" }, el("span", { class: "cc-stars", text: stars(f.stars) }), el("h1", { text: `CHANNEL COB RATING: ${f.rating}` })),
      el("div", { class: "cc-stats" }, stat("Accuracy", `${f.accuracy}%`), stat("CPI reputation", f.repLabel), stat("Public panic", `${f.panic}%`)),
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
