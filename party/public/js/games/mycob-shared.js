// My Cob Escaped: pieces the host screen and phones both draw. Everything shown comes from the
// server's view for this screen; nothing here knows more than it is sent.

import { el } from "../common.js";

export const TAG_INFO = {
  CONTAIN: { icon: "🔒", label: "Contain", hint: "Lock it down, seal it in, put it back" },
  EVACUATE: { icon: "🏃", label: "Evacuate", hint: "Get people out of danger" },
  INVESTIGATE: { icon: "🔍", label: "Investigate", hint: "Find out what it is and how it works" },
  COMMUNICATE: { icon: "📻", label: "Communicate", hint: "Radio, staff, coordination" },
  DEPLOY: { icon: "🚨", label: "Deploy", hint: "Send people or yourself in" },
  EQUIPMENT: { icon: "🔧", label: "Equipment", hint: "Fix, use or improvise gear" },
  STRATEGIZE: { icon: "🧠", label: "Strategize", hint: "Plan, prioritize, direct" },
  OTHER: { icon: "❓", label: "Other", hint: "Anything else at all" },
};

export const APPROACH_INFO = {
  careful: { label: "Careful", hint: "More reliable, smaller effect" },
  standard: { label: "Standard", hint: "" },
  reckless: { label: "Reckless", hint: "Bigger swings, more chaos, more danger" },
};

export const OBJECTIVE_MARK = { active: "▢", completed: "✓", failed: "✕", impossible: "⊘" };

export function livesEl(lives, max) {
  const hearts = [];
  for (let i = 0; i < Math.max(max, lives); i++) hearts.push(i < lives ? "♥" : "♡");
  return el("span", { class: "mc-lives", "aria-label": `${lives} of ${max} lives`, text: hearts.join("") });
}

export function stampEl(text, tone = "") {
  return el("span", { class: `stamp ${tone}`.trim(), text });
}

/** The unknown-or-known entity, as far as this screen may know it. */
export function entityCard(inc) {
  const e = inc.entity;
  if (!e.known) {
    return el(
      "div",
      { class: "mc-entity unknown" },
      el("p", { class: "eyebrow", text: "Entity" }),
      el("p", { class: "mc-entity-name", text: "UNKNOWN" }),
      el("p", { class: "muted", text: "Identity not on record. Investigate." }),
    );
  }
  return el(
    "div",
    { class: "mc-entity", dataset: { class: e.classification } },
    el("p", { class: "eyebrow", text: `Entity · ${e.ref}` }),
    el("p", { class: "mc-entity-name", text: e.title }),
    el("p", {}, stampEl(e.classification), stampEl(`Containment ${e.containment}`, "muted")),
  );
}

export function statusGrid(inc) {
  return el(
    "ul",
    { class: "mc-stats", "aria-label": "Incident status" },
    inc.statuses.map((s) =>
      el("li", { class: `mc-stat tone-${s.tone}` }, el("span", { class: "name", text: s.name }), el("span", { class: "value", text: s.value })),
    ),
  );
}

export function systemsList(inc) {
  return el(
    "ul",
    { class: "mc-systems", "aria-label": "Facility systems" },
    inc.systems.map((s) =>
      el("li", { class: `cond-${s.condition}` }, el("span", { class: "grow", text: s.name }), el("span", { class: "mono", text: s.condition === "nominal" ? "ONLINE" : s.condition.toUpperCase() })),
    ),
  );
}

export function objectivesList(objectives, { onlyActive = false } = {}) {
  const list = onlyActive ? objectives.filter((o) => o.status === "active") : objectives;
  return el(
    "ul",
    { class: "mc-objectives", "aria-label": "Objectives" },
    list.map((o) =>
      el(
        "li",
        { dataset: { status: o.status, kind: o.kind } },
        el("span", { class: "mark", "aria-hidden": "true", text: OBJECTIVE_MARK[o.status] ?? "▢" }),
        el("span", { class: "grow" }, o.kind === "primary" ? el("strong", { text: o.text }) : o.text),
        o.status !== "active" ? stampEl(o.status, o.status === "completed" ? "ok" : "danger") : null,
      ),
    ),
  );
}

export function factsList(facts) {
  if (!facts.length) return el("p", { class: "muted", text: "Nothing discovered yet." });
  return el(
    "ul",
    { class: "mc-facts" },
    facts.map((f) =>
      el(
        "li",
        {},
        el("span", { class: "eyebrow", text: f.ref ? `${f.label} · ${f.ref}` : f.label }),
        el("span", { class: f.redacted ? "redacted" : "", text: f.text }),
        f.source === "generated" ? stampEl("game-only", "muted") : null,
      ),
    ),
  );
}

export function personnelList(inc) {
  return el(
    "ul",
    { class: "mc-personnel", "aria-label": "Personnel" },
    inc.personnel.map((p) =>
      el(
        "li",
        { dataset: { status: p.status } },
        el("span", { class: "grow" }, el("strong", { text: p.name }), el("span", { class: "muted", text: ` · ${p.department}` })),
        p.controlledBy ? stampEl(p.controlledBy) : null,
        stampEl(p.status, ["dead", "critical", "trapped", "missing", "injured"].includes(p.status) ? "danger" : "muted"),
      ),
    ),
  );
}

/** Shown while the director is still writing the closing report. */
export const PENDING_REPORT = "The final report is being filed…";

/** The narrator's lines, redrawn when new ones arrive mid-phase (the director's opening, say). */
export function liveNarration(events) {
  const node = el("div");
  let ids = "";
  const set = (next) => {
    const key = next.map((n) => n.id).join(",");
    if (key === ids) return;
    ids = key;
    node.replaceChildren(narrationEl(next));
  };
  set(events);
  return { node, set };
}

/** The narrator's current lines. */
export function narrationEl(events) {
  return el(
    "div",
    { class: "mc-narration", "aria-live": "polite" },
    events.map((n) => el("p", { class: `n-${n.type}`, text: n.text })),
  );
}

export function outcomeStamp(outcome, label) {
  return el("span", { class: `mc-outcome o-${outcome}`, text: label });
}

/** The first sentence or two of `text`, at most `max` characters. */
export function shortText(text, max = 160) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
}

/** Narration kept short on a phone, with the rest a tap away. */
export function shortReport(events) {
  const text = events.map((n) => n.text).join(" ");
  if (!text) return null;
  const short = shortText(text);
  return el(
    "section",
    { class: "mc-report" },
    el("p", { class: "mc-report-short", text: short }),
    short.length < text.length ? el("details", {}, el("summary", { text: "Full report" }), el("p", { class: "muted", text })) : null,
  );
}

/** INCIDENT STATUS: what just happened, what matters now, what changed, risks, the team, objectives. */
export function recapCard(recap) {
  const o = recap.objectives;
  return el(
    "section",
    { class: "mc-recap", "aria-label": "Incident status" },
    el("p", { class: "eyebrow", text: `Incident status · stage ${recap.stage}` }),
    el("ul", { class: "mc-recap-happened" }, recap.happened.map((t) => el("li", { text: t }))),
    el("p", { class: "mc-recap-now" }, el("strong", { text: "Now: " }), recap.now),
    recap.changes.length ? el("ul", { class: "mc-recap-changes" }, recap.changes.map((t) => el("li", { text: t }))) : null,
    recap.risks.length ? el("p", { class: "mc-recap-risks" }, el("strong", { text: "⚠ Risks: " }), recap.risks.join(" · ")) : null,
    el(
      "p",
      { class: "mc-recap-meta" },
      el("span", { text: `♥ ${recap.team.lives}/${recap.team.maxLives} lives` }),
      el("span", { text: `▢ ${o.done}/${o.total} objectives` }),
      el("span", { text: `Primary: ${o.primaryStatus === "active" ? "open" : o.primaryStatus}` }),
    ),
    o.deadline ? el("p", { class: "mc-recap-deadline", text: `⏱ ${o.deadline}` }) : null,
    recap.team.back.length ? el("p", { class: "muted", text: recap.team.back.join(" · ") }) : null,
  );
}

/** Status changes as chips: which way each went, and where it is now. */
export function statChips(changes) {
  if (!changes.length) return null;
  return el(
    "ul",
    { class: "mc-chips", "aria-label": "Status changes" },
    changes.map((c) =>
      el("li", { class: c.better ? "better" : "worse" }, el("span", { "aria-hidden": "true", text: c.better ? "▲ " : "▼ " }), `${c.name} `, el("strong", { text: c.value })),
    ),
  );
}

/** Your role's one line that matters most right now, then the card: what it's for, what only you see, what to try. */
export function roleCard(g, { open = false } = {}) {
  const role = g.you.role;
  return el(
    "div",
    { class: "mc-rolebox" },
    g.you.read ? el("p", { class: "mc-read" }, el("span", { class: "mc-read-label", text: `${role.icon} Your read` }), g.you.read) : null,
    roleDetails(g, open),
  );
}

function roleDetails(g, open) {
  const role = g.you.role;
  return el(
    "details",
    { class: "mc-intel", open },
    el("summary", {}, `${role.icon} Your role: `, el("strong", { text: role.name })),
    el("p", { class: "mc-role-good" }, el("strong", { text: "Good at: " }), role.goodAt),
    el("p", { class: "hint", text: `★ Strongest with ${role.strongTags.map((t) => `${TAG_INFO[t].icon} ${TAG_INFO[t].label}`).join(", ")}. Anything else works, just less reliably.` }),
    el("p", { class: "mc-role-only" }, el("strong", { text: "Only you see: " }), role.onlyYou),
    g.you.context.map((section) => el("section", { class: "mc-role-intel" }, el("h3", { text: section.title }), el("ul", { class: "list" }, section.lines.map((line) => el("li", { text: line }))))),
    el("p", { class: "mc-role-try-label", text: "Try something like" }),
    el("ul", { class: "mc-role-try" }, role.tryThis.map((t) => el("li", { text: t }))),
    el("p", { class: "muted", text: role.blurb }),
  );
}

/** Why your move went the way it did, and which way it pushed things. */
export function whyAndCaused(action) {
  const why = action.why ?? [];
  const caused = action.caused ?? [];
  return [
    why.length ? el("ul", { class: "mc-why", "aria-label": "Why" }, why.map((w) => el("li", { text: w }))) : null,
    caused.length
      ? el(
          "p",
          { class: "mc-caused" },
          el("strong", { text: "You caused: " }),
          caused.map((c, i) => el("span", { class: c.up === (c.name === "Chaos") ? "worse" : "better" }, `${i ? " · " : ""}${c.name} ${(c.up ? "▲" : "▼").repeat(c.big ? 2 : 1)}`)),
        )
      : null,
  ];
}

/** The incident in numbers, for the final screen. */
export function summaryTiles(o) {
  const s = o.summary;
  const tiles = [
    ["Stages", String(o.stagesPlayed)],
    ["Objectives", `${s.objectives.completed}/${s.objectives.total}`],
    ["Discoveries", String(s.discoveries)],
    ["Lives lost", String(s.livesLost)],
    ["Staff evacuated", String(s.staffEvacuated)],
    ["Staff lost", String(s.staffLost)],
    ["Final chaos", s.chaos],
  ];
  if (o.initiallyUnknown) tiles.splice(2, 0, ["Identified", s.identifiedAt ? `Stage ${s.identifiedAt}` : "Never"]);
  return el(
    "ul",
    { class: "mc-tiles", "aria-label": "Incident summary" },
    tiles.map(([label, value]) => el("li", {}, el("span", { class: "value", text: value }), el("span", { class: "label", text: label }))),
  );
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** Final scores, best first; tied totals share a place. */
export function standings(o) {
  const rows = [...o.breakdown].sort((a, b) => b.total - a.total);
  return rows.map((r) => ({ ...r, place: 1 + rows.filter((x) => x.total > r.total).length }));
}

export function leaderboard(o, { limit = Infinity, you = null } = {}) {
  return el(
    "ol",
    { class: "mc-leaderboard" },
    standings(o)
      .slice(0, limit)
      .map((r) =>
        el(
          "li",
          { class: r.playerId === you ? "you" : "" },
          el("span", { class: "place", text: MEDALS[r.place - 1] ?? `#${r.place}` }),
          el("span", { class: "grow", text: r.name }),
          el("strong", { class: "mono", text: String(r.total) }),
        ),
      ),
  );
}

/** The most-voted move of the incident. */
export function bestMoveEl(o) {
  if (!o.bestMove) return null;
  const b = o.bestMove;
  return el(
    "blockquote",
    { class: "mc-bestmove" },
    el("p", { class: "eyebrow", text: `Move of the incident · stage ${b.stage} · ${b.votes} vote${b.votes === 1 ? "" : "s"}` }),
    el("p", { text: b.summary }),
  );
}
