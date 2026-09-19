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
