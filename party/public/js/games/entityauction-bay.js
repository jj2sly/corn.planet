// Entity Auction's shared visuals, used by both the host screen and phones. Chiefly the
// containment door: one bay of the facility, drawn in HTML and CSS.
//
// The server only says which state a bay is in: sealed, active, opening, revealed or collected.
// How that looks and moves lives here and in the .bay rules in party.css, so the facility can be
// redesigned without touching the game rules. "Unlocking" is the first beat of the opening
// animation (the lock turns, then the doors part), not a separate server state.

import { el } from "../common.js";

const STATE_TEXT = {
  sealed: "SEALED",
  active: "CONTAINMENT SECURE",
  opening: "UNLOCKING",
  revealed: "BREACH · OPEN",
  collected: "COLLECTED",
};

export const kernels = (n) => `${Number(n).toLocaleString()} K`;

/** "BAY-07" -> "BAY 07" */
export const bayLabel = (bayId) => bayId.replace("-", " ");

/**
 * A containment bay. `size` is "small" (the facility row) or "large" (the bay under the hammer).
 * Returns { node, update(bay), setCountdown(timer) }.
 */
export function bayEl(bay, { size = "small" } = {}) {
  const contents = el("div", { class: "bay-contents" });
  const state = el("span", { class: "bay-state" });
  // Filled in by startCountdowns(); CSS only shows it for the last few seconds of bidding.
  const countdown = el("span", { class: "bay-countdown", "aria-hidden": "true" }, el("span", { class: "value" }), el("span", { class: "unit" }));
  const node = el(
    "div",
    { class: `bay bay-${size}`, role: "img" },
    el("span", { class: "bay-plate", text: bayLabel(bay.bayId) }),
    el(
      "div",
      { class: "bay-chamber" },
      contents,
      el("div", { class: "bay-door left", "aria-hidden": "true" }),
      el("div", { class: "bay-door right", "aria-hidden": "true" }),
      el("div", { class: "bay-lock", "aria-hidden": "true" }),
      size === "large" ? countdown : null,
    ),
    el("span", { class: "bay-light", "aria-hidden": "true" }),
    state,
  );

  let current = null;
  let filledWith = null;

  function update(next) {
    if (next.status !== current) {
      // Drawn first as still locked, so a screen that arrives mid-opening still sees the door move.
      const animate = current === null && next.status === "opening";
      current = next.status;
      node.dataset.status = animate ? "active" : current;
      if (animate) requestAnimationFrame(() => requestAnimationFrame(() => (node.dataset.status = current)));
    }
    state.textContent = next.status === "collected" && next.ownerName ? next.ownerName : STATE_TEXT[next.status];
    node.setAttribute(
      "aria-label",
      `${bayLabel(next.bayId)}: ${next.entity ? `${next.entity.ref}, ${next.entity.title}` : "contents unknown"}, ${STATE_TEXT[next.status].toLowerCase()}`,
    );

    const ref = next.entity?.ref ?? null;
    if (ref === filledWith) return;
    filledWith = ref;
    if (!next.entity) return contents.replaceChildren();
    contents.dataset.class = next.entity.classification;
    contents.replaceChildren(
      el("span", { class: "bay-specimen", "aria-hidden": "true" }),
      el("strong", { class: "bay-ref", text: next.entity.ref }),
      size === "large" ? el("span", { class: "bay-title", text: next.entity.title }) : null,
    );
  }

  function setCountdown(timer) {
    if (current !== "active" || !timer) {
      countdown.removeAttribute("data-deadline");
      return countdown.classList.remove("low");
    }
    countdown.dataset.deadline = String(Date.now() + timer.remainingMs);
    countdown.dataset.paused = String(timer.paused);
  }

  update(bay);
  return { node, update, setCountdown };
}

/** The facility: every bay in a row of small doors. Returns { node, update(bays) }. */
export function facilityEl(bays) {
  const doors = bays.map((b) => bayEl(b));
  const node = el("div", { class: "facility", role: "list", "aria-label": "Containment bays" }, doors.map((d) => el("div", { role: "listitem" }, d.node)));
  return { node, update: (next) => next.forEach((b, i) => doors[i]?.update(b)) };
}

/** A revealed modifier as a badge: buff, debuff or neutral. */
export function modifierBadge(modifier) {
  if (!modifier) return null;
  const kind = modifier.polarity === "buff" ? "ok" : modifier.polarity === "debuff" ? "danger" : "muted";
  return el("span", { class: `stamp ${kind}`, title: modifier.description, text: `${modifier.polarity}: ${modifier.name}` });
}

/** What an Action Round event or the audit did, one line per change. */
export function outcomeList(outcomes) {
  return el(
    "ul",
    { class: "ea-outcomes" },
    outcomes.map((o) =>
      el(
        "li",
        { class: `tone-${o.tone}` },
        o.playerName ? el("strong", { text: o.playerName }) : null,
        o.ref ? el("span", { class: "mono", text: o.ref }) : null,
        o.modifier ? modifierBadge(o.modifier) : null,
        el("span", { text: o.modifier ? o.modifier.description : o.text }),
      ),
    ),
  );
}
