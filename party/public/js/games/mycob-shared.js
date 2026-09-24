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

/** A labelled block for phone screens: a small heading, then its lines. Nothing when empty. */
export function block(label, ...nodes) {
  const body = nodes.flat().filter(Boolean);
  return body.length ? el("section", { class: "mc-block" }, el("p", { class: "mc-block-label", text: label }), ...body) : null;
}

/** INCIDENT STATUS: situation, what changed, risks, the team, objectives. */
export function recapCard(recap) {
  const o = recap.objectives;
  const team = recap.team;
  const first = recap.stage === 1;
  return el(
    "section",
    { class: "mc-recap", "aria-label": "Incident status" },
    el("p", { class: "eyebrow", text: `Incident status · stage ${recap.stage}` }),
    block("Situation", el("p", { class: "mc-recap-now", text: recap.now }), first ? el("p", { class: "muted", text: recap.happened.join(" ") }) : null),
    first
      ? null
      : block(
          "Since last stage",
          el("ul", { class: "mc-recap-happened" }, recap.happened.map((t) => el("li", { text: t }))),
          recap.vote ? el("p", { class: "mc-recap-vote", text: `🗳 ${recap.vote}` }) : null,
          recap.changes.length ? el("ul", { class: "mc-recap-changes" }, recap.changes.map((t) => el("li", { text: t }))) : null,
        ),
    recap.risks.length ? block("⚠ Risks", el("p", { class: "mc-recap-risks", text: recap.risks.join(" · ") })) : null,
    block(
      "Team & objectives",
      el(
        "p",
        { class: "mc-recap-meta" },
        el("span", { text: `♥ ${team.lives}/${team.maxLives} lives` }),
        el("span", { text: `▢ ${o.done}/${o.total} objectives` }),
        el("span", { text: `Primary: ${o.primaryStatus === "active" ? "open" : o.primaryStatus}` }),
      ),
      team.lastLife?.length ? el("p", { class: "mc-recap-lastlife", text: `Last life: ${team.lastLife.join(", ")}` }) : null,
      o.deadline ? el("p", { class: "mc-recap-deadline", text: `⏱ ${o.deadline}` }) : null,
      team.back.length ? el("p", { class: "muted", text: team.back.join(" · ") }) : null,
    ),
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

/** Your role's one line that matters most right now. */
export function readLine(g) {
  return g.you.read ? el("p", { class: "mc-read" }, el("span", { class: "mc-read-label", text: `${g.you.role.icon} Your read` }), g.you.read) : null;
}

/** Your read, then the card: what your role is for, what only you see, what to try. */
export function roleCard(g, { open = false, read = true } = {}) {
  return el("div", { class: "mc-rolebox" }, read ? readLine(g) : null, roleDetails(g, open));
}

function roleDetails(g, open) {
  const role = g.you.role;
  return el(
    "details",
    { class: "mc-intel", open },
    el("summary", {}, `${role.icon} Your role: `, el("strong", { text: role.name })),
    el("p", { class: "mc-role-good" }, el("strong", { text: "Good at: " }), role.goodAt),
    el("p", { class: "hint", text: `★ Best with ${role.strongTags.map((t) => `${TAG_INFO[t].icon} ${TAG_INFO[t].label}`).join(", ")}` }),
    g.you.context.filter((section) => section.lines.length).map((section) => el("section", { class: "mc-role-intel" }, el("h3", { text: `${section.title} · only you` }), el("ul", { class: "list" }, section.lines.map((line) => el("li", { text: line }))))),
    el("p", { class: "mc-role-try-label", text: "Try" }),
    el("ul", { class: "mc-role-try" }, role.tryThis.map((t) => el("li", { text: t }))),
    el("p", { class: "muted", text: `${role.blurb} Yours all game.` }),
  );
}

/** Why your move went the way it did, and which way it pushed things. */
export function whyAndCaused(action) {
  const why = action.why ?? [];
  const caused = action.caused ?? [];
  return [
    block("Why", why.length ? el("ul", { class: "mc-why" }, why.map((w) => el("li", { text: w }))) : null),
    block(
      "You caused",
      el(
        "p",
        { class: "mc-caused" },
        caused.length
          ? caused.map((c, i) => el("span", { class: c.up === (c.name === "Chaos") ? "worse" : "better" }, `${i ? " · " : ""}${c.name} ${(c.up ? "▲" : "▼").repeat(c.big ? 2 : 1)}`))
          : el("span", { class: "muted", text: "No lasting change." }),
      ),
    ),
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

export const MEDALS = ["🥇", "🥈", "🥉"];

/** Final scores, best first; tied totals share a place. */
export function standings(o) {
  const rows = [...o.breakdown].sort((a, b) => b.total - a.total);
  return rows.map((r) => ({ ...r, place: 1 + rows.filter((x) => x.total > r.total).length }));
}

const rankRow = (r, you) =>
  el(
    "li",
    { class: r.playerId === you ? "you" : "" },
    el("span", { class: "place", text: MEDALS[r.place - 1] ?? `#${r.place}` }),
    el("span", { class: "grow", text: r.name }),
    el("strong", { class: "mono", text: String(r.total) }),
  );

export function leaderboard(o, { limit = Infinity, you = null } = {}) {
  return el(
    "ol",
    { class: "mc-leaderboard" },
    standings(o)
      .slice(0, limit)
      .map((r) => rankRow(r, you)),
  );
}

// ------------------------------------------------------------------ the finale

/** Under the ending stamp: an icon and one line of flavour. */
export const ENDING_FLAVOR = {
  contained: { icon: "🏆", line: "Back in the box. Nobody touch anything." },
  terminated: { icon: "💥", line: "Somebody has to explain the crater." },
  escaped: { icon: "🏃", line: "Check under your desk. Then check again." },
  everyone_dies: { icon: "💀", line: "Great teamwork, though." },
};

/** Makes `node` fade in `at` seconds after the screen opens. Set through CSSOM: the CSP forbids style attributes. */
export function reveal(node, at) {
  node.classList.add("mc-beat");
  node.style.setProperty("--at", `${at}s`);
  return node;
}

export const beat = (at, ...nodes) => reveal(el("div", { class: "stack" }, ...nodes), at);

/** The top three on a podium, third place revealed first and first place last, then everyone else. */
export function podium(o, { you = null, at = 0 } = {}) {
  const rows = standings(o);
  const top = rows.slice(0, 3);
  // Drawn 2nd, 1st, 3rd; revealed 3rd, 2nd, 1st.
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return el(
    "div",
    { class: "stack" },
    el(
      "ol",
      { class: "mc-podium", "aria-label": "Top three" },
      order.map((r) => {
        const i = top.indexOf(r);
        return reveal(
          el(
            "li",
            { class: `p${i + 1} ${r.playerId === you ? "you" : ""}`.trim() },
            el("span", { class: "medal", "aria-hidden": "true", text: MEDALS[r.place - 1] ?? `#${r.place}` }),
            el("span", { class: "name", text: r.name }),
            el("span", { class: "step" }, el("strong", { class: "mono", text: String(r.total) }), el("span", { class: "muted", text: " pts" })),
          ),
          at + (top.length - 1 - i) * 1.1,
        );
      }),
    ),
    rows.length > 3 ? reveal(el("ol", { class: "mc-leaderboard", start: "4" }, rows.slice(3).map((r) => rankRow(r, you))), at + 3.3) : null,
  );
}

/**
 * The last word: glory (the move of the incident, the most commended) and shame (the most lives lost,
 * the most chaos caused). Straight from the scores and votes; nothing is made up.
 */
export function hallOfFame(o) {
  const leaders = (key) => {
    const max = Math.max(0, ...o.breakdown.map((r) => r[key]));
    return max > 0 ? { names: o.breakdown.filter((r) => r[key] === max).map((r) => r.name).join(" & "), value: max } : null;
  };
  const commended = new Map();
  for (const m of o.mvps) for (const name of m.names) commended.set(name, (commended.get(name) ?? 0) + 1);
  const most = Math.max(0, ...commended.values());
  const lives = leaders("livesLost");
  const chaos = leaders("chaos");
  const row = (icon, label, who) => el("li", {}, el("span", { class: "mc-hall-icon", "aria-hidden": "true", text: icon }), el("span", { class: "grow" }, el("span", { class: "eyebrow", text: label }), el("strong", { text: who })));
  const glory = [most ? row("🎖️", "Most commended", `${[...commended].filter(([, n]) => n === most).map(([name]) => name).join(" & ")} ×${most}`) : null].filter(Boolean);
  const shame = [lives ? row("💀", "Most lives lost", `${lives.names} (${lives.value})`) : null, chaos ? row("🌀", "Most chaos caused", chaos.names) : null].filter(Boolean);
  return el(
    "div",
    { class: "mc-hall" },
    el(
      "section",
      { class: "glory" },
      el("h2", { text: "Hall of glory" }),
      bestMoveEl(o),
      glory.length ? el("ul", { class: "mc-hall-list" }, glory) : null,
      !o.bestMove && !glory.length ? el("p", { class: "muted", text: "No commendations. Nobody could agree on anything." }) : null,
    ),
    el(
      "section",
      { class: "shame" },
      el("h2", { text: "Hall of shame" }),
      shame.length ? el("ul", { class: "mc-hall-list" }, shame) : el("p", { class: "muted", text: "Nobody embarrassed themselves. Suspicious." }),
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
