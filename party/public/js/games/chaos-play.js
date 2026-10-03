// Cornlashing on a phone: prompt + answer box, then two buttons to vote, then a one-line result.
// Views are keyed so typing and focus survive live state updates.

import { el, letter, notice, ordinal, plural, rank, store, timerEl } from "../common.js";

const DRAFTS_KEY = "cpst-party:drafts";
const ANSWER_MAX = 80;

// Which already-filed incident the player chose to edit (null = next unfiled one).
let editing = null;
let rerender = () => {};

function drafts() {
  return store.get("sessionStorage", DRAFTS_KEY) ?? {};
}

function saveDraft(incidentId, text) {
  const all = drafts();
  if (text) all[incidentId] = text;
  else delete all[incidentId];
  store.set("sessionStorage", DRAFTS_KEY, all);
}

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

// ------------------------------------------------------------------ phases

function buildIntro(s) {
  const g = s.game;
  const t = timerRow(s.timer, g.breach ? "Final round" : `Round ${g.round}/${g.totalRounds}`);
  const node = el(
    "div",
    { class: "stack" },
    t.node,
    statusCard(
      g.breach ? "☢" : "🌽",
      g.breach ? "TOTAL BREACH" : `ROUND ${g.round}`,
      g.breach ? "Same prompt for everyone." : "Get ready to write.",
    ),
  );
  return { node, update: (next) => t.set(next.timer) };
}

function buildAnswerForm(s, assignment, index, total, tools) {
  const t = timerRow(s.timer, total > 1 ? `WRITE · ${index + 1}/${total}` : "WRITE");
  const note = el("p", { class: "notice" });
  const saved = drafts()[assignment.incidentId];
  const textarea = el("textarea", {
    id: "answer",
    maxlength: String(ANSWER_MAX),
    rows: "3",
    enterkeyhint: "send",
    autocomplete: "off",
    "aria-describedby": "answerCount",
  });
  textarea.value = saved ?? assignment.answer ?? "";
  const counter = el("p", { class: "counter", id: "answerCount", "aria-live": "polite" });
  const submit = el("button", { class: "btn big", type: "submit", text: assignment.answer ? "UPDATE" : "SEND" });

  const updateCounter = () => {
    const length = textarea.value.length;
    counter.textContent = `${length}/${ANSWER_MAX}`;
    counter.classList.toggle("near", length > ANSWER_MAX - 15);
  };
  updateCounter();
  textarea.addEventListener("input", () => {
    updateCounter();
    saveDraft(assignment.incidentId, textarea.value);
  });

  const form = el(
    "form",
    {
      class: "stack chaos-answer-form",
      onsubmit: async (e) => {
        e.preventDefault();
        if (!textarea.value.trim()) {
          notice(note, "Write something first.", "error");
          return textarea.focus();
        }
        submit.disabled = true;
        const result = await tools.request("game:input", {
          action: "answer",
          payload: { incidentId: assignment.incidentId, text: textarea.value },
        });
        submit.disabled = false;
        if (!result.ok) return notice(note, result.message, "error");
        saveDraft(assignment.incidentId, "");
        editing = null;
        rerender();
      },
    },
    el("p", { class: "phone-prompt", id: "prompt", text: assignment.prompt }),
    el("label", { class: "sr-only", for: "answer", text: "Your answer" }),
    textarea,
    counter,
    submit,
    editing ? el("button", { class: "btn subtle", type: "button", text: "Cancel edit", onclick: () => ((editing = null), rerender()) }) : null,
    note,
  );

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  queueMicrotask(() => textarea.focus());
  return { node: el("div", { class: "stack" }, t.node, form), update: (next) => t.set(next.timer) };
}

function buildFiled(s, tools) {
  const t = timerRow(s.timer, "WAIT");
  const list = el("ul", { class: "list" });
  const node = el(
    "div",
    { class: "stack" },
    t.node,
    statusCard("✓", "SENT", "Others are still writing."),
    list,
    tools.leaveButton(),
  );
  return {
    node,
    update(next) {
      t.set(next.timer);
      list.replaceChildren(
        ...next.game.assignments.map((a) =>
          el(
            "li",
            {},
            el("div", { class: "grow" }, el("p", { class: "muted", text: a.prompt }), el("p", {}, el("strong", { text: a.answer }))),
            el("button", { class: "btn subtle small", type: "button", text: "Edit", onclick: () => ((editing = a.incidentId), rerender()) }),
          ),
        ),
      );
    },
  };
}

function renderAnswering(mount, s, tools) {
  const assignments = s.game.assignments ?? [];
  if (editing && !assignments.some((a) => a.incidentId === editing)) editing = null;
  const targetIndex = editing ? assignments.findIndex((a) => a.incidentId === editing) : assignments.findIndex((a) => !a.answer);

  if (targetIndex === -1) return mount(`chaos:filed:${s.game.round}`, (st) => buildFiled(st, tools), s);
  const target = assignments[targetIndex];
  mount(`chaos:answer:${target.incidentId}:${editing ? "edit" : "new"}`, (st) => buildAnswerForm(st, target, targetIndex, assignments.length, tools), s);
}

function buildVoting(s, tools) {
  const g = s.game;
  const t = timerRow(s.timer, g.breach ? "PICK · Total Breach" : `PICK · ${g.incidentNumber}/${g.incidentCount}`);

  if (!g.canVote) {
    const mine = !!g.ownReportId;
    return {
      node: el(
        "div",
        { class: "stack" },
        t.node,
        g.roomJudges
          ? statusCard("📺", "ROOM VOTE", mine ? "Your answer is up. Make your case." : "Watch the TV.")
          : statusCard("📄", "YOURS IS UP", "Look innocent."),
        el("p", { class: "phone-prompt", text: g.prompt }),
      ),
      update: (next) => t.set(next.timer),
    };
  }

  const note = el("p", { class: "notice" });
  const locked = el("p", { class: "notice ok", role: "status" });
  const buttons = g.reports.map((r, i) => {
    const own = r.id === g.ownReportId;
    return el(
      "button",
      {
        class: "vote-option",
        type: "button",
        disabled: own,
        "aria-pressed": "false",
        dataset: { reportId: r.id },
        onclick: async () => {
          for (const b of buttons) b.disabled = true;
          const result = await tools.request("game:input", { action: "vote", payload: { incidentId: g.incidentId, reportId: r.id } });
          if (!result.ok && result.error !== "ALREADY_VOTED") {
            notice(note, result.message, "error");
            buttons.forEach((b, j) => (b.disabled = g.reports[j].id === g.ownReportId));
          }
        },
      },
      el("span", { class: "letter", text: own ? `${letter(i)} · YOURS` : letter(i) }),
      r.text,
    );
  });

  const node = el(
    "div",
    { class: "stack" },
    t.node,
    el("p", { class: "phone-prompt", text: g.prompt }),
    el("p", { class: "sr-only", id: "voteLabel", text: "Tap the funnier answer." }),
    el("div", { class: "vote-options", role: "group", "aria-labelledby": "voteLabel" }, buttons),
    locked,
    note,
  );

  return {
    node,
    update(next) {
      t.set(next.timer);
      const vote = next.game.yourVote;
      if (!vote) return;
      for (const b of buttons) {
        const chosen = b.dataset.reportId === vote;
        b.disabled = true;
        b.classList.toggle("chosen", chosen);
        b.setAttribute("aria-pressed", String(chosen));
      }
      locked.textContent = "Vote in. Watch the TV.";
    },
  };
}

function buildVerdict(s) {
  const g = s.game;
  const me = s.you.playerId;
  const mine = g.verdict.entries.filter((e) => e.authorId === me);
  const winners = g.verdict.entries.filter((e) => g.verdict.winningReportIds.includes(e.reportId));

  const total = g.verdict.totalVotes;
  let card;
  if (mine.length) {
    const entry = mine[0];
    const won = g.verdict.winningReportIds.includes(entry.reportId);
    card = statusCard(
      won || g.verdict.defaulted ? "★" : "✕",
      `+${g.yourPoints} POINTS`,
      g.verdict.defaulted
        ? "No rival answer — free points."
        : entry.unanimous
          ? `CORNLASH! Every vote went to you.`
          : `${plural(entry.votes, "vote")}${total ? ` (${Math.round((entry.votes / total) * 100)}%)` : ""}. ${won ? (g.verdict.winningReportIds.length > 1 ? "Tie!" : "You won this one.") : "Lost this one."}`,
      el("p", {}, el("strong", { text: `“${entry.text}”` })),
    );
  } else {
    card = statusCard(
      "⚖",
      winners.length > 1 ? "TIE" : "WINNER",
      winners.length ? winners.map((w) => `${w.authorName}: “${w.text}”`).join(" / ") : "No votes this time.",
    );
  }
  return { node: el("div", { class: "stack" }, el("p", { class: "phone-prompt", text: g.prompt }), card) };
}

function buildStandings(s) {
  const ranked = rank(s.players);
  const me = ranked.find((p) => p.id === s.you.playerId);
  return {
    node: statusCard(
      "📊",
      me ? `${ordinal(me.placement)} PLACE` : "STANDINGS",
      me ? `${me.score.toLocaleString()} points. Scores are on the big screen.` : "Scores are on the big screen.",
    ),
  };
}

export function render(mount, state, tools) {
  const g = state.game;
  rerender = () => render(mount, state, tools);
  if (g.phase !== "ANSWERING") editing = null;

  switch (g.phase) {
    case "INTRO":
      return mount(`chaos:intro:${g.round}`, buildIntro, state);
    case "ANSWERING":
      return renderAnswering(mount, state, tools);
    case "VOTING":
      return mount(`chaos:vote:${g.incidentId}`, (s) => buildVoting(s, tools), state);
    case "VERDICT":
      return mount(`chaos:verdict:${g.incidentId}`, buildVerdict, state);
    case "STANDINGS":
      return mount(`chaos:standings:${g.round}`, buildStandings, state);
  }
}
