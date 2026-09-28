// My Cob Escaped on a phone. One thing at a time: a bar across the top says where you are, what you
// are and how long you have; under it, only what this moment needs. The alert says what escaped and
// what your job is; the briefing what just happened and what's wrong now; the response is the
// situation, a big box and a button; the result is what you did, what happened and how bad things
// are. Everything else (the full alert, your role's details, why a move went the way it did, the
// rest of the report) is folded away, one tap from sight.
// Views are keyed by phase and stage so typing survives the live updates streaming in.

import { el, notice, store, timerEl } from "../common.js";
import {
  APPROACH_INFO,
  block,
  ENDING_FLAVOR,
  factsList,
  leaderboard,
  liveNarration,
  livesEl,
  MEDALS,
  outcomeStamp,
  PENDING_REPORT,
  reveal,
  roleBody,
  situationEl,
  stampEl,
  standings,
  statChips,
  TAG_INFO,
  whyAndCaused,
} from "./mycob-shared.js";
import { playCue, preloadSounds, soundControl, timerWarning } from "./mycob-sound.js";

const DRAFT_KEY = "cpst-party:mycob-draft";
const seenNotices = new Set();

const PHASE_NAME = { ALERT: "Alert", UPDATE: "Briefing", RESPONSE: "Your move", PROCESSING: "Processing", CONSEQUENCE: "Result", STAGE_VOTE: "Vote" };

/** Where you are, as short as it goes: "2/5 · Your move". */
function whereLabel(g, fallback) {
  if (!g.stage) return PHASE_NAME[g.phase] ?? fallback ?? "";
  return `${g.stage}/${g.totalStages} · ${PHASE_NAME[g.phase] ?? ""}`;
}

/**
 * The bar across the top, on every screen: where you are, your role and lives, and the time left
 * (big; it pulses in the last ten seconds). Life-changing news for you sits right under it.
 */
function topBar(s, label) {
  const timerSlot = el("span", { class: "mc-top-timer" });
  const where = el("span", { class: "mc-top-where" });
  const you = el("span", { class: "mc-top-you" });
  const node = el("div", { class: "mc-top" }, el("div", { class: "mc-top-left" }, where, you), timerSlot);
  const notices = el("div", { class: "stack" });
  const set = (next) => {
    const g = next.game;
    where.textContent = label ?? whereLabel(g);
    const role = g.you.role;
    you.replaceChildren(el("span", { text: `${role.icon} ${role.name}` }), g.you.down ? stampEl("down", "danger") : livesEl(g.you.lives, g.you.maxLives));
    timerSlot.replaceChildren(timerEl(next.timer));
    // Only news that changes things for you: a life lost, going down, coming back as someone else.
    // The result screen says a lost life itself.
    const shown = g.phase === "CONSEQUENCE" ? g.you.notices.filter((n) => n.kind === "reassigned") : g.you.notices;
    notices.replaceChildren(...shown.map((n) => el("p", { class: `mc-notice k-${n.kind}`, role: n.kind === "reassigned" ? "status" : "alert", text: n.text })));
    for (const n of g.you.notices) {
      if (seenNotices.has(n.id)) continue;
      seenNotices.add(n.id);
      if (n.kind === "life" && navigator.userActivation?.hasBeenActive) {
        navigator.vibrate?.([200, 100, 200]);
        playCue("life_lost");
      }
    }
  };
  set(s);
  return { node: el("div", { class: "stack" }, node, notices), set };
}

/** Your own countdowns: a response you haven't filed, a vote you haven't cast. */
function warnKey(g) {
  const due = (g.phase === "RESPONSE" && !g.you.response) || (g.phase === "STAGE_VOTE" && g.you.canVote && !g.you.yourVote);
  return due ? `${g.incident.code}:${g.phase}:${g.stage}` : null;
}

/** A phase's screen: the top bar, then its own nodes. `label` overrides the where-you-are text. */
function screen(s, nodes, onUpdate, { label = null } = {}) {
  const top = topBar(s, label);
  const node = el("div", { class: "stack mc-phone" }, top.node, ...nodes);
  timerWarning(warnKey(s.game), s.timer);
  return {
    node,
    update(next) {
      top.set(next);
      timerWarning(warnKey(next.game), next.timer);
      onUpdate?.(next);
    },
  };
}

const primaryObjective = (g) => g.incident.objectives.find((o) => o.kind === "primary" && o.status === "active") ?? g.incident.objectives.find((o) => o.kind === "primary");

// ------------------------------------------------------------------ the alert and the briefing

/** The alert: what escaped, where, and what your job is. The rest is a tap away. */
function buildAlert(s) {
  const g = s.game;
  const inc = g.incident;
  const role = g.you.role;
  const narration = liveNarration(g.narration);
  const goal = primaryObjective(g);
  return screen(s, [
    el("div", { class: "warning", text: "Containment breach" }),
    el("p", { class: "phone-prompt", text: inc.problem }),
    el(
      "ul",
      { class: "mc-alert-facts" },
      el("li", {}, el("strong", { text: "Entity: " }), inc.entity.known ? inc.entity.title : "UNKNOWN"),
      el("li", {}, el("strong", { text: "Where: " }), inc.location.name),
      inc.environment.map((e) => el("li", { class: "warn" }, `⚠ ${e}`)),
    ),
    el(
      "section",
      { class: "mc-job" },
      el("p", { class: "mc-block-label", text: "Your job" }),
      el("p", { class: "mc-job-role", text: `${role.icon} ${role.name}` }),
      el("p", { text: role.goodAt }),
      goal ? el("p", { class: "mc-job-goal" }, el("strong", { text: "Team goal: " }), goal.text) : null,
    ),
    el("details", { class: "mc-more" }, el("summary", { text: "More about your role" }), ...roleBody(g)),
    el("details", { class: "mc-more" }, el("summary", { text: "The full alert" }), narration.node),
    soundControl(),
  ], (next) => narration.set(next.game.narration));
}

/** Between stages: what just happened, and what's wrong now. */
function buildBriefing(s) {
  const g = s.game;
  const r = g.recap;
  const roleFold = (next) => el("details", { class: "mc-more" }, el("summary", { text: `${next.you.role.icon} Your role: ${next.you.role.name}` }), el("p", {}, el("strong", { text: "Good at: " }), next.you.role.goodAt), ...roleBody(next));
  const intel = el("div", { dataset: { role: g.you.role.id } }, roleFold(g));
  return screen(
    s,
    [
      r && r.stage > 1 ? block("What happened", el("p", { class: "mc-brief-line", text: r.happened.slice(0, 2).join(" ") }), r.vote ? el("p", { class: "muted", text: `🗳 ${r.vote}` }) : null) : null,
      block("Now", el("p", { class: "phone-prompt", text: r?.now ?? g.incident.problem })),
      situationEl(g.incident.statuses),
      g.you.read ? el("p", { class: "mc-read" }, el("span", { class: "mc-read-label", text: `${g.you.role.icon} Your read` }), g.you.read) : null,
      intel,
    ],
    (next) => {
      // Only changes when you were reassigned after going down: open the new role.
      if (next.game.you.role.id !== intel.dataset.role) {
        intel.dataset.role = next.game.you.role.id;
        const fold = roleFold(next.game);
        fold.open = true;
        intel.replaceChildren(el("section", { class: "mc-job" }, el("p", { class: "mc-block-label", text: "Your new job" }), fold));
      }
    },
  );
}

// ------------------------------------------------------------------ the response

function loadDraft(key) {
  const d = store.get("sessionStorage", DRAFT_KEY);
  return d && d.key === key ? d : null;
}

/** What's happening, the box, the kind of move, the button. Risk options fold away. */
function buildResponse(s, tools) {
  const g = s.game;
  const key = `${g.incident.code}:${g.stage}`;
  const note = el("p", { class: "notice" });
  const filed = el("p", { class: "mc-filed", role: "status" });
  const prior = g.you.response ?? loadDraft(key);
  let tag = prior?.tag ?? null;
  let approach = prior?.approach ?? "standard";

  const saveDraft = () => store.set("sessionStorage", DRAFT_KEY, { key, tag, text: textarea.value, approach, sacrifice: sacrifice.checked });

  const tagButtons = g.tags.map((id) => {
    const strong = g.you.role.strongTags.includes(id);
    return el(
      "button",
      {
        class: "mc-tag",
        type: "button",
        "aria-pressed": String(tag === id),
        "aria-label": `${TAG_INFO[id].label}${strong ? " (your role's strength)" : ""}`,
        dataset: { tag: id },
        onclick: () => {
          tag = id;
          for (const b of tagButtons) b.setAttribute("aria-pressed", String(b.dataset.tag === id));
          saveDraft();
        },
      },
      el("span", { class: "icon", "aria-hidden": "true", text: TAG_INFO[id].icon }),
      el("span", { class: "label", text: TAG_INFO[id].label }),
      strong ? el("span", { class: "strong", title: "Your role's strength", text: "★" }) : null,
    );
  });

  const textarea = el("textarea", { id: "mcText", class: "mc-answer", maxlength: String(g.limits.textMax), rows: "4", autocomplete: "off", "aria-describedby": "mcCount", placeholder: "Anything at all. Be specific." });
  textarea.value = prior?.text ?? "";
  // The character count only shows near the limit.
  const counter = el("p", { class: "counter", id: "mcCount", "aria-live": "polite" });
  const updateCounter = () => {
    const left = g.limits.textMax - textarea.value.length;
    counter.textContent = left <= 30 ? `${left} left` : "";
    counter.classList.toggle("near", left <= 20);
  };
  updateCounter();
  textarea.addEventListener("input", () => (updateCounter(), saveDraft()));

  const riskSummary = el("span");
  const approaches = el(
    "div",
    { class: "choices", role: "radiogroup", "aria-label": "Approach" },
    g.approaches.map((a) =>
      el(
        "label",
        { class: "choice", title: APPROACH_INFO[a].hint },
        el("input", { type: "radio", name: "mcApproach", value: a, checked: a === approach, onchange: () => ((approach = a), saveDraft(), paintRisk()) }),
        el("span", { text: APPROACH_INFO[a].label }),
      ),
    ),
  );
  const sacrifice = el("input", { type: "checkbox", id: "mcSacrifice", checked: prior?.sacrifice === true, onchange: () => (saveDraft(), paintRisk()) });
  const paintRisk = () => (riskSummary.textContent = `Risk: ${APPROACH_INFO[approach].label}${sacrifice.checked ? " · in harm's way" : ""}`);
  paintRisk();
  const risk = el(
    "details",
    { class: "mc-more mc-risk", open: approach !== "standard" || sacrifice.checked },
    el("summary", {}, riskSummary),
    approaches,
    el("p", { class: "hint", text: "Careful: steadier. Reckless: bigger swing, more chaos." }),
    el("label", { class: "mc-check", for: "mcSacrifice" }, sacrifice, el("span", { text: " Put myself in harm's way (better odds, might cost a life)" })),
  );
  const submit = el("button", { class: "btn big mc-submit", type: "submit", text: "Submit" });

  const form = el(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        if (!textarea.value.trim()) return notice(note, "Say what you do.", "error"), textarea.focus();
        if (!tag) return notice(note, "Pick what kind of move it is.", "error");
        submit.disabled = true;
        const result = await tools.request("game:input", {
          action: "respond",
          payload: { tag, text: textarea.value, approach, sacrifice: sacrifice.checked },
        });
        submit.disabled = false;
        if (!result.ok) return notice(note, result.message, "error");
        notice(note, "");
        playCue("response_in");
      },
    },
    el("label", { class: "mc-answer-label", for: "mcText", text: "Your response" }),
    textarea,
    counter,
    el("p", { class: "label", id: "mcTagLabel", text: "What kind of move?" }),
    el("div", { class: "mc-tags", role: "group", "aria-labelledby": "mcTagLabel" }, tagButtons),
    risk,
    submit,
    filed,
    note,
  );

  // Out of time with a response typed but never filed: file it rather than lose it.
  let hasFiled = !!g.you.response;
  let autoFile = 0;
  const armAutoFile = (timer) => {
    clearTimeout(autoFile);
    if (hasFiled || !timer || timer.paused) return;
    autoFile = setTimeout(() => {
      if (form.isConnected && !hasFiled && tag && textarea.value.trim()) form.requestSubmit();
    }, Math.max(0, timer.remainingMs - 2000));
  };

  const setFiled = (next) => {
    hasFiled = !!next.game.you.response;
    const p = next.game.progress;
    filed.textContent = hasFiled ? `✓ Submitted · ${p.submitted}/${p.needed} in · you can still change it` : "";
    submit.textContent = hasFiled ? "Update" : "Submit";
    armAutoFile(next.timer);
  };
  setFiled(s);

  // One risk at most, and not one the headline already says.
  const now = g.recap?.now ?? g.incident.problem;
  const warning = (g.recap?.risks ?? []).find((r) => !now.toUpperCase().includes((r.split(" ")[0] ?? r).toUpperCase()));
  return screen(
    s,
    [
      el("section", { class: "mc-now" }, el("p", { class: "mc-block-label", text: "What's happening" }), el("p", { class: "phone-prompt", text: now }), warning ? el("p", { class: "mc-recap-risks", text: `⚠ ${warning}` }) : null),
      form,
    ],
    setFiled,
  );
}

// ------------------------------------------------------------------ the result and the vote

function buildProcessing(s) {
  return screen(s, [el("div", { class: "big-status" }, el("div", { class: "icon", "aria-hidden": "true", text: "⏳" }), el("h2", { text: "Working out what happened…" }))]);
}

/** What you did, what happened, how bad it is now. The rest folds away. */
function buildConsequence(s) {
  const g = s.game;
  const c = g.consequence;
  const a = g.you.action;
  const mine = g.you.lostLife ? c.lifeLosses.find((l) => l.playerId === g.you.playerId) : null;
  const others = c.actions.filter((x) => x.playerId !== g.you.playerId);
  const teamLosses = c.lifeLosses.filter((l) => l.playerId !== g.you.playerId).map((l) => `♡ ${l.name} ${l.down ? "is down" : "lost a life"}`);
  const otherChanges = [
    ...c.systemChanges.map((x) => `${x.name}: ${x.to.toUpperCase()}`),
    ...c.personnelChanges.map((x) => `${x.name}: ${x.to.toUpperCase()}`),
    ...c.objectiveChanges.map((x) => `Objective ${x.to}: ${x.text}`),
    ...c.objectivesAdded.map((x) => `New objective: ${x.text}`),
  ];
  const left = g.you.lives;
  const report = g.narration.filter((n) => n.type === "consequence" || n.type === "special_event").map((n) => n.text).join(" ");
  const you = g.you.response?.text;
  return screen(s, [
    you ? el("p", { class: "mc-you-did" }, el("span", { class: "mc-block-label", text: "You" }), you) : null,
    a
      ? el("section", { class: "mc-result" }, el("p", { class: "mc-block-label", text: "What happened" }), outcomeStamp(a.outcome, a.outcomeLabel), el("p", { class: "mc-result-summary", text: a.summary }))
      : el("section", { class: "mc-result" }, el("p", { class: "mc-result-summary", text: "You didn't respond. The incident didn't wait." })),
    mine
      ? el(
          "div",
          { class: "mc-life-alert", role: "alert" },
          el("strong", { text: g.you.down ? "YOU'RE DOWN" : "YOU LOST A LIFE" }),
          mine.reason ? el("p", { text: mine.reason }) : null,
          el("p", { text: g.you.down ? "Next stage you're back as someone else, with 1 life." : `${left} ${left === 1 ? "life" : "lives"} left.` }),
        )
      : null,
    teamLosses.length ? el("p", { class: "mc-team-losses", role: "status", text: teamLosses.join(" · ") }) : null,
    c.terminated ? el("div", { class: "warning", text: "Entity terminated" }) : null,
    situationEl(g.incident.statuses, { label: "Now" }),
    el(
      "details",
      { class: "mc-more" },
      el("summary", { text: "Details" }),
      statChips(c.statusChanges),
      ...(a ? whyAndCaused(a) : []),
      others.length ? block("Everyone else", el("ul", { class: "mc-quick" }, others.map((x) => el("li", {}, el("span", { class: "grow", text: `${x.roleIcon} ${x.name}` }), outcomeStamp(x.outcome, x.outcomeLabel))))) : null,
      otherChanges.length || c.discoveries.length ? block("Also", otherChanges.length ? el("ul", { class: "mc-recap-changes" }, otherChanges.map((t) => el("li", { text: t }))) : null, c.discoveries.length ? factsList(c.discoveries) : null) : null,
      report ? block("The full report", el("p", { class: "muted", text: report })) : null,
    ),
  ]);
}

function buildVote(s, tools) {
  const g = s.game;
  const note = el("p", { class: "notice" });
  const locked = el("p", { class: "mc-filed", role: "status" });
  if (!g.you.canVote) return screen(s, [el("div", { class: "big-status" }, el("div", { class: "icon", "aria-hidden": "true", text: "🗳" }), el("h2", { text: "Nothing to vote on" }))]);
  const buttons = g.vote.candidates.map((c) =>
    el(
      "button",
      {
        class: "vote-option",
        type: "button",
        "aria-pressed": "false",
        dataset: { playerId: c.playerId },
        onclick: async () => {
          for (const b of buttons) b.disabled = true;
          const result = await tools.request("game:input", { action: "vote", payload: { playerId: c.playerId } });
          if (!result.ok && result.error !== "ALREADY_VOTED") {
            notice(note, result.message, "error");
            for (const b of buttons) b.disabled = false;
          }
        },
      },
      el("span", { class: "letter", text: c.name }),
      c.summary,
    ),
  );
  const apply = (next) => {
    const vote = next.game.you.yourVote;
    if (!vote) return;
    for (const b of buttons) {
      b.disabled = true;
      b.classList.toggle("chosen", b.dataset.playerId === vote);
      b.setAttribute("aria-pressed", String(b.dataset.playerId === vote));
    }
    locked.textContent = "✓ Voted";
  };
  apply(s);
  return screen(s, [el("p", { class: "phone-prompt", text: "Which move helped most?" }), el("div", { class: "vote-options" }, buttons), locked, note], apply);
}

// ------------------------------------------------------------------ ending and awards

// The ending: the stamp, one line, where you placed. The report and your points fold away.
function buildOutcome(s) {
  const g = s.game;
  const o = g.outcome;
  const mine = o.breakdown.find((b) => b.playerId === g.you.playerId);
  const place = standings(o).find((r) => r.playerId === g.you.playerId);
  const flavor = ENDING_FLAVOR[o.id];
  const report = el("p", { class: "muted", text: o.narration ?? PENDING_REPORT });
  return screen(
    s,
    [
      el(
        "div",
        { class: `mc-finale e-${o.id}` },
        el("div", { class: "big-status" }, el("div", { class: "icon mc-stamp", "aria-hidden": "true", text: flavor?.icon ?? "⚠" }), el("h2", { class: "mc-stamp", text: o.title }), flavor ? reveal(el("p", { class: "mc-ending-line", text: flavor.line }), 0.7) : null),
      ),
      place
        ? reveal(el("p", { class: "mc-place" }, el("span", { class: "eyebrow", text: "You placed" }), el("strong", { text: `${MEDALS[place.place - 1] ?? ""} #${place.place} of ${o.breakdown.length}`.trim() }), el("span", { class: "mono", text: `${place.total} pts` })), 1.6)
        : null,
      el("div", { class: "reference" }, el("span", { class: "eyebrow", text: "The entity" }), el("a", { class: "reference-id", href: o.entity.url, target: "_blank", rel: "noopener noreferrer" }, `${o.entity.ref} — ${o.entity.title} →`)),
      el("details", { class: "mc-more" }, el("summary", { text: "The final report" }), report),
      mine
        ? el(
            "details",
            { class: "mc-more" },
            el("summary", { text: "Your points" }),
            el(
              "ul",
              { class: "list" },
              [
                ["Impact", mine.impact],
                ["Chaos", mine.chaos],
                ["Creativity", mine.creativity],
                ["Role", mine.role],
                ["Votes", mine.votes],
                ["Sacrifice", mine.sacrifice],
                ["Team", mine.team],
                ["Total", mine.total],
              ].map(([label, value]) => el("li", {}, el("span", { class: "grow", text: label }), el("strong", { class: "mono", text: String(value) }))),
            ),
          )
        : null,
    ],
    (next) => (report.textContent = next.game.outcome.narration ?? PENDING_REPORT),
    { label: "Operation complete" },
  );
}

function buildAwardSubmit(s, tools) {
  const g = s.game;
  const note = el("p", { class: "notice" });
  const mine = g.you.awards?.mine?.[0] ?? null;
  const name = el("input", { id: "mcAward", type: "text", maxlength: String(g.limits.awardNameMax), autocomplete: "off", placeholder: "WHY WOULD YOU DO THAT", value: mine?.name ?? "" });
  const description = el("textarea", { id: "mcAwardDesc", maxlength: String(g.limits.awardDescriptionMax), rows: "2", placeholder: "What it's for (optional)" });
  description.value = mine?.description ?? "";
  const submit = el("button", { class: "btn big", type: "submit", text: mine ? "Update award" : "Create award" });
  const done = el("p", { class: "mc-filed", role: "status" });
  const form = el(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        if (!name.value.trim()) return notice(note, "Give your award a name.", "error"), name.focus();
        submit.disabled = true;
        const current = s.game.you.awards?.mine?.[0];
        const result = await tools.request("game:input", {
          action: "award:submit",
          payload: { name: name.value, description: description.value, ...(current ? { awardId: current.id } : {}) },
        });
        submit.disabled = false;
        if (!result.ok) return notice(note, result.message, "error");
        notice(note, "");
        playCue("response_in");
      },
    },
    el("p", { class: "phone-prompt", text: "Invent an award. Everyone votes on who gets it." }),
    el("label", { for: "mcAward", text: "Award name" }),
    name,
    description,
    submit,
    done,
    note,
  );
  const setDone = (next) => {
    const have = next.game.you.awards?.mine?.[0];
    done.textContent = have ? `✓ Filed: “${have.name}”` : "";
    submit.textContent = have ? "Update award" : "Create award";
    s = next;
  };
  setDone(s);
  return screen(s, [form], setDone, { label: "Awards" });
}

function buildAwardVote(s, tools) {
  const g = s.game;
  const note = el("p", { class: "notice" });
  const groups = g.awards.list.map((award) => {
    const buttons = g.awards.recipients.map((r) =>
      el("button", {
        class: "btn ghost small mc-recipient",
        type: "button",
        text: r.name,
        dataset: { playerId: r.playerId },
        onclick: async () => {
          const result = await tools.request("game:input", { action: "award:vote", payload: { awardId: award.id, playerId: r.playerId } });
          if (!result.ok && result.error !== "ALREADY_VOTED") notice(note, result.message, "error");
        },
      }),
    );
    const node = el(
      "section",
      { class: "panel quiet stack" },
      el("p", { class: "mc-award-name", text: award.name }),
      award.description ? el("p", { class: "muted", text: award.description }) : null,
      el("div", { class: "row" }, buttons),
    );
    return { award, buttons, node };
  });
  const apply = (next) => {
    const votes = next.game.you.awards?.votes ?? {};
    for (const group of groups) {
      const chosen = votes[group.award.id];
      for (const b of group.buttons) {
        b.disabled = !!chosen;
        b.classList.toggle("chosen", b.dataset.playerId === chosen);
      }
    }
  };
  apply(s);
  return screen(s, [el("p", { class: "phone-prompt", text: "Who gets each award?" }), ...groups.map((x) => x.node), note], apply, { label: "Awards" });
}

function buildAwardResults(s) {
  const g = s.game;
  const results = g.awards.results;
  const won = results.filter((a) => a.winners.some((w) => w.playerId === g.you.playerId));
  const step = Math.min(1.6, 8 / Math.max(1, results.length));
  const after = 0.6 + results.length * step;
  return screen(
    s,
    [
      el(
        "ul",
        { class: "list mc-award-list" },
        results.map((a, i) =>
          reveal(el("li", {}, el("span", { class: "grow" }, el("span", { "aria-hidden": "true", text: "🏆 " }), el("strong", { text: a.name })), el("span", { text: a.winners.length ? a.winners.map((w) => w.name).join(" & ") : "—" })), 0.6 + i * step),
        ),
      ),
      won.length ? reveal(el("div", { class: "mc-you-won", role: "status" }, el("span", { "aria-hidden": "true", text: "🏆 " }), `You won ${new Intl.ListFormat("en", { type: "conjunction" }).format(won.map((a) => `“${a.name}”`))}`), after) : null,
      reveal(el("div", { class: "stack" }, el("h3", { text: "Final standings" }), leaderboard(g.outcome, { you: g.you.playerId })), after + 0.6),
    ],
    null,
    { label: "The awards" },
  );
}

export function render(mount, state, tools) {
  const g = state.game;
  preloadSounds(["response_in", "life_lost", "timer_warning"]);
  const key = `mycob:${g.incident.code}:${g.phase}:${g.stage}`;
  switch (g.phase) {
    case "ALERT":
      return mount(key, buildAlert, state);
    case "UPDATE":
      return mount(key, buildBriefing, state);
    case "RESPONSE":
      return mount(key, (s) => buildResponse(s, tools), state);
    case "PROCESSING":
      return mount(key, buildProcessing, state);
    case "CONSEQUENCE":
      return mount(key, buildConsequence, state);
    case "STAGE_VOTE":
      return mount(key, (s) => buildVote(s, tools), state);
    case "OUTCOME":
      return mount(key, buildOutcome, state);
    case "AWARD_SUBMIT":
      return mount(key, (s) => buildAwardSubmit(s, tools), state);
    case "AWARD_VOTE":
      return mount(key, (s) => buildAwardVote(s, tools), state);
    case "AWARD_RESULTS":
      return mount(key, buildAwardResults, state);
  }
}
