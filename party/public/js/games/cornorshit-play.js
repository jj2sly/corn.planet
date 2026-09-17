// Corn or Shit on a phone: pick the claim you think the CPI Database actually holds.
// Reuses the vote-option controls Cornlashing already uses, so the touch targets match.

import { el, letter, notice, timerEl } from "../common.js";

function statusCard(icon, title, body, ...extra) {
  return el(
    "div",
    { class: "big-status" },
    el("div", { class: "icon", "aria-hidden": "true", text: icon }),
    el("h2", { text: title }),
    body ? el("p", { class: "muted", text: body }) : null,
    ...extra,
  );
}

function timerRow(timer, label) {
  const slot = el("span", {}, timerEl(timer));
  const node = el("div", { class: "row spread" }, el("span", { class: "eyebrow", text: label }), slot);
  return { node, set: (t) => slot.replaceChildren(timerEl(t)) };
}

const roundLabel = (g) => `Round ${g.round} of ${g.totalRounds}`;

function buildIntro(s) {
  const g = s.game;
  const t = timerRow(s.timer, roundLabel(g));
  const node = el(
    "div",
    { class: "stack" },
    t.node,
    statusCard("🌽", "PULLING A RECORD…", `Next up: ${g.subject}. Two claims, one is real.`),
  );
  return { node, update: (next) => t.set(next.timer) };
}

function buildGuessing(s, tools) {
  const g = s.game;
  const t = timerRow(s.timer, roundLabel(g));
  const note = el("p", { class: "notice" });
  const locked = el("p", { class: "notice ok", role: "status" });

  const buttons = g.options.map((option, i) =>
    el(
      "button",
      {
        class: "vote-option",
        type: "button",
        "aria-pressed": "false",
        dataset: { optionId: option.id },
        onclick: async () => {
          for (const b of buttons) b.disabled = true;
          const result = await tools.request("game:input", { action: "guess", payload: { optionId: option.id } });
          if (!result.ok && result.error !== "ALREADY_VOTED") {
            notice(note, result.message, "error");
            for (const b of buttons) b.disabled = false;
          }
        },
      },
      el("span", { class: "letter", text: `CLAIM ${letter(i)}` }),
      option.text,
    ),
  );

  const applyGuess = (next) => {
    const guess = next.game.yourGuess;
    if (!guess) return;
    for (const b of buttons) {
      const chosen = b.dataset.optionId === guess;
      b.disabled = true;
      b.classList.toggle("chosen", chosen);
      b.setAttribute("aria-pressed", String(chosen));
    }
    locked.textContent = "Call locked in. Watch the host screen.";
  };

  const node = el(
    "div",
    { class: "stack" },
    t.node,
    el("p", { class: "phone-prompt", text: `Which one does the database actually say about ${g.subject}?` }),
    el("p", { class: "label", id: "claimLabel", text: "Corn is on record. Shit is not." }),
    el("div", { class: "vote-options", role: "group", "aria-labelledby": "claimLabel" }, buttons),
    locked,
    note,
  );
  applyGuess(s);

  return {
    node,
    update(next) {
      t.set(next.timer);
      applyGuess(next);
    },
  };
}

function buildReveal(s) {
  const g = s.game;
  const mine = g.yourResult;
  const real = g.options.find((o) => o.real);

  const card =
    !mine || !mine.guessed
      ? statusCard("–", "NO CALL FILED", "You didn't call this one.")
      : mine.correct
        ? statusCard("★", `+${g.pointsForCorrect} POINTS`, "That one really is on record.")
        : statusCard("✕", "FABRICATED", "You went for the claim that isn't in the database.");

  return {
    node: el(
      "div",
      { class: "stack" },
      card,
      // Labelled, because this is the true claim and it sits right under the word "FABRICATED".
      el("p", { class: "eyebrow", text: "On record" }),
      el("p", {}, el("strong", { text: `“${real.text}”` })),
      el(
        "div",
        { class: "reference" },
        el("span", { class: "eyebrow", text: "Database reference" }),
        el(
          "a",
          { class: "reference-id", href: g.reference.url, target: "_blank", rel: "noopener noreferrer" },
          `${g.reference.ref} — inspect the record →`,
        ),
      ),
    ),
  };
}

export function render(mount, state, tools) {
  const g = state.game;
  switch (g.phase) {
    case "INTRO":
      return mount(`cornorshit:intro:${g.round}`, buildIntro, state);
    case "GUESSING":
      return mount(`cornorshit:guess:${g.round}`, (s) => buildGuessing(s, tools), state);
    case "REVEAL":
      return mount(`cornorshit:reveal:${g.round}`, buildReveal, state);
  }
}
