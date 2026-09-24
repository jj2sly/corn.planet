// My Cob Escaped on a phone: your role, your lives, your response, your vote, your award.
// Views are keyed by phase and stage so typing survives the live updates streaming in.

import { el, notice, plural, store, timerEl } from "../common.js";
import {
  APPROACH_INFO,
  bestMoveEl,
  block,
  factsList,
  leaderboard,
  liveNarration,
  livesEl,
  outcomeStamp,
  PENDING_REPORT,
  recapCard,
  roleCard,
  shortReport,
  stampEl,
  standings,
  statChips,
  summaryTiles,
  TAG_INFO,
  whyAndCaused,
} from "./mycob-shared.js";
import { playCue, preloadSounds, soundControl, timerWarning } from "./mycob-sound.js";

const DRAFT_KEY = "cpst-party:mycob-draft";
const seenNotices = new Set();

function timerRow(timer, label) {
  const slot = el("span", {}, timerEl(timer));
  const node = el("div", { class: "row spread" }, el("span", { class: "eyebrow", text: label }), slot);
  return { node, set: (t) => slot.replaceChildren(timerEl(t)) };
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

const stageLabel = (g) => (g.stage ? `Stage ${g.stage} of ${g.totalStages}` : `Incident ${g.incident.code}`);

/** Your role, lives and anything that just happened to you. Rebuilt on every update. */
function youStrip(g) {
  const you = g.you;
  // The consequence's own alert already says it; don't say it twice.
  const shown = g.phase === "CONSEQUENCE" && you.lostLife ? you.notices.filter((n) => n.kind !== "life" && n.kind !== "down") : you.notices;
  const notices = shown.map((n) =>
    el("p", { class: `mc-notice k-${n.kind}`, role: n.kind === "life" || n.kind === "down" ? "alert" : "status", text: n.text }),
  );
  // Buzz once per new life-loss notice.
  for (const n of you.notices) {
    if (seenNotices.has(n.id)) continue;
    seenNotices.add(n.id);
    if (n.kind === "life" && navigator.userActivation?.hasBeenActive) {
      navigator.vibrate?.([200, 100, 200]);
      playCue("life_lost");
    }
  }
  return el(
    "div",
    { class: "stack" },
    el(
      "div",
      { class: `mc-you ${you.down ? "down" : ""}`.trim() },
      el("div", { class: "grow" }, el("p", { class: "eyebrow", text: you.identity ? `Playing as ${you.identity}` : "Your assignment" }), el("strong", { class: "mc-you-role", text: `${you.role.icon} ${you.role.name}` })),
      you.down ? stampEl("down", "danger") : livesEl(you.lives, you.maxLives),
    ),
    ...notices,
  );
}

/** Your own countdowns: a response you haven't filed, a vote you haven't cast. */
function warnKey(g) {
  const due = (g.phase === "RESPONSE" && !g.you.response) || (g.phase === "STAGE_VOTE" && g.you.canVote && !g.you.yourVote);
  return due ? `${g.incident.code}:${g.phase}:${g.stage}` : null;
}

/** Wraps a phase view with the you-strip on top; the strip refreshes on every update. */
function screen(s, nodes, onUpdate) {
  const strip = el("div", {}, youStrip(s.game));
  const node = el("div", { class: "stack" }, strip, ...nodes, soundControl());
  timerWarning(warnKey(s.game), s.timer);
  return {
    node,
    update(next) {
      strip.replaceChildren(youStrip(next.game));
      timerWarning(warnKey(next.game), next.timer);
      onUpdate?.(next);
    },
  };
}

// ------------------------------------------------------------------ briefing

function buildBriefing(s) {
  const g = s.game;
  const t = timerRow(s.timer, stageLabel(g));
  // Your role card is open while there's time to read it.
  const intel = el("div", { dataset: { role: g.you.role.id } }, roleCard(g, { open: true }));
  const narration = liveNarration(g.narration);
  const alert = g.phase === "ALERT";
  return screen(
    s,
    [
      t.node,
      alert ? el("div", { class: "warning", text: "Containment breach" }) : null,
      alert ? narration.node : null,
      alert ? el("p", { class: "phone-prompt", text: g.incident.problem }) : null,
      !alert && g.recap ? recapCard(g.recap) : null,
      intel,
    ],
    (next) => {
      t.set(next.timer);
      narration.set(next.game.narration);
      // Only changes when you were reassigned after going down.
      if (next.game.you.role.id !== intel.dataset.role) {
        intel.dataset.role = next.game.you.role.id;
        intel.replaceChildren(roleCard(next.game, { open: true }));
      }
    },
  );
}

// ------------------------------------------------------------------ the response

function loadDraft(key) {
  const d = store.get("sessionStorage", DRAFT_KEY);
  return d && d.key === key ? d : null;
}

function buildResponse(s, tools) {
  const g = s.game;
  const key = `${g.incident.code}:${g.stage}`;
  const t = timerRow(s.timer, stageLabel(g));
  const note = el("p", { class: "notice" });
  const filed = el("p", { class: "notice ok", role: "status" });
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
        dataset: { tag: id },
        onclick: () => {
          tag = id;
          for (const b of tagButtons) b.setAttribute("aria-pressed", String(b.dataset.tag === id));
          saveDraft();
        },
      },
      el("span", { class: "icon", "aria-hidden": "true", text: TAG_INFO[id].icon }),
      el("span", { class: "label", text: TAG_INFO[id].label }),
      strong ? el("span", { class: "strong", text: "★ role" }) : null,
    );
  });

  const textarea = el("textarea", { id: "mcText", maxlength: String(g.limits.textMax), rows: "4", autocomplete: "off", "aria-describedby": "mcCount", placeholder: "Anything at all. Be specific." });
  textarea.value = prior?.text ?? "";
  const counter = el("p", { class: "counter", id: "mcCount", "aria-live": "polite" });
  const updateCounter = () => {
    counter.textContent = `${textarea.value.length}/${g.limits.textMax}`;
    counter.classList.toggle("near", textarea.value.length > g.limits.textMax - 20);
  };
  updateCounter();
  textarea.addEventListener("input", () => (updateCounter(), saveDraft()));

  const approaches = el(
    "div",
    { class: "choices", role: "radiogroup", "aria-label": "Approach" },
    g.approaches.map((a) =>
      el(
        "label",
        { class: "choice", title: APPROACH_INFO[a].hint },
        el("input", { type: "radio", name: "mcApproach", value: a, checked: a === approach, onchange: () => ((approach = a), saveDraft()) }),
        el("span", { text: APPROACH_INFO[a].label }),
      ),
    ),
  );
  const sacrifice = el("input", { type: "checkbox", id: "mcSacrifice", checked: prior?.sacrifice === true, onchange: saveDraft });
  const submit = el("button", { class: "btn big", type: "submit", text: g.you.response ? "Update response" : "File response" });

  const form = el(
    "form",
    {
      class: "stack",
      onsubmit: async (e) => {
        e.preventDefault();
        if (!tag) return notice(note, "Pick what kind of response this is.", "error");
        if (!textarea.value.trim()) return notice(note, "Say what you do.", "error"), textarea.focus();
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
    el("p", { class: "phone-prompt", text: g.incident.problem }),
    el("p", { class: "label", id: "mcTagLabel", text: "What kind of response?" }),
    el("div", { class: "mc-tags", role: "group", "aria-labelledby": "mcTagLabel" }, tagButtons),
    el("label", { for: "mcText", text: "What do you do?" }),
    textarea,
    counter,
    el("fieldset", {}, el("legend", { text: "Approach" }), approaches, el("p", { class: "hint", text: "Careful is steadier. Reckless swings harder and stirs up chaos." })),
    el("label", { class: "mc-check", for: "mcSacrifice" }, sacrifice, el("span", { text: " Put myself in harm's way — more likely to work, more likely to cost me a life" })),
    submit,
    filed,
    note,
  );

  const setFiled = (next) => {
    filed.textContent = next.game.you.response ? `Response filed. You can change it until everyone's in (${next.game.progress.submitted}/${next.game.progress.needed}).` : "";
    submit.textContent = next.game.you.response ? "Update response" : "File response";
  };
  setFiled(s);

  return screen(s, [t.node, form, roleCard(g)], (next) => {
    t.set(next.timer);
    setFiled(next);
  });
}

// ------------------------------------------------------------------ consequences and votes

function buildProcessing(s) {
  const g = s.game;
  const t = timerRow(s.timer, stageLabel(g));
  return screen(s, [t.node, statusCard("⏳", "PROCESSING", "The Incident Director is working out what everyone just did. Watch the host screen.")], (next) => t.set(next.timer));
}

function buildConsequence(s) {
  const g = s.game;
  const c = g.consequence;
  const t = timerRow(s.timer, stageLabel(g));
  const a = g.you.action;
  const mine = g.you.lostLife ? c.lifeLosses.find((l) => l.playerId === g.you.playerId) : null;
  const others = c.actions.filter((x) => x.playerId !== g.you.playerId);
  const found = c.discoveries;
  const teamLosses = c.lifeLosses.filter((l) => l.playerId !== g.you.playerId).map((l) => `♡ ${l.name} ${l.down ? "is down" : "lost a life"}`);
  const otherChanges = [
    ...c.systemChanges.map((x) => `${x.name}: ${x.to.toUpperCase()}`),
    ...c.personnelChanges.map((x) => `${x.name}: ${x.to.toUpperCase()}`),
    ...c.objectiveChanges.map((x) => `Objective ${x.to}: ${x.text}`),
    ...c.objectivesAdded.map((x) => `New objective: ${x.text}`),
  ].slice(0, 3);
  const left = g.you.lives;
  return screen(
    s,
    [
      t.node,
      mine
        ? el(
            "div",
            { class: "mc-life-alert", role: "alert" },
            el("strong", { text: g.you.down ? "YOU'RE DOWN" : "YOU LOST A LIFE" }),
            mine.reason ? el("p", { text: mine.reason }) : null,
            el("p", { text: g.you.down ? "Next stage you're back as someone else, with a new role and 1 life." : `${left} ${left === 1 ? "life" : "lives"} left.` }),
          )
        : null,
      block(
        "What happened",
        a ? [el("p", {}, outcomeStamp(a.outcome, a.outcomeLabel)), el("p", { text: a.summary })] : el("p", { class: "muted", text: "You didn't file a response. The incident didn't wait for you." }),
        shortReport(g.narration.filter((n) => n.type === "consequence" || n.type === "special_event")),
      ),
      ...(a ? whyAndCaused(a) : []),
      block(
        "The incident now",
        c.terminated ? el("div", { class: "warning", text: "Entity terminated" }) : null,
        statChips(c.statusChanges),
        otherChanges.length ? el("ul", { class: "mc-recap-changes" }, otherChanges.map((t) => el("li", { text: t }))) : null,
        found.length ? [factsList(found.slice(0, 2)), found.length > 2 ? el("p", { class: "muted", text: `+${found.length - 2} more on the host screen` }) : null] : null,
      ),
      block(
        "The team",
        others.length
          ? el("ul", { class: "mc-quick", "aria-label": "Everyone else" }, others.map((x) => el("li", {}, el("span", { class: "grow", text: `${x.roleIcon} ${x.name}` }), outcomeStamp(x.outcome, x.outcomeLabel))))
          : null,
        teamLosses.length ? el("p", { class: "mc-team-losses", role: "status", text: teamLosses.join(" · ") }) : null,
      ),
      c.next ? el("p", { class: "mc-next", text: `Next: ${c.next.replace(/^Next: /, "")}` }) : null,
    ],
    (next) => t.set(next.timer),
  );
}

function buildVote(s, tools) {
  const g = s.game;
  const t = timerRow(s.timer, stageLabel(g));
  const note = el("p", { class: "notice" });
  const locked = el("p", { class: "notice ok", role: "status" });
  if (!g.you.canVote) {
    return screen(s, [t.node, statusCard("🗳", "NOTHING TO VOTE ON", "Nobody else acted this stage.")], (next) => t.set(next.timer));
  }
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
    locked.textContent = "Vote locked in. It's anonymous.";
  };
  apply(s);
  return screen(
    s,
    [t.node, el("p", { class: "phone-prompt", text: "Best move this stage?" }), el("div", { class: "vote-options" }, buttons), locked, note],
    (next) => {
      t.set(next.timer);
      apply(next);
    },
  );
}

// ------------------------------------------------------------------ ending and awards

const ENDING_ICON = { contained: "🏆", terminated: "💥", escaped: "🏃", everyone_dies: "💀" };

function buildOutcome(s) {
  const g = s.game;
  const o = g.outcome;
  const t = timerRow(s.timer, "Operation complete");
  const mine = o.breakdown.find((b) => b.playerId === g.you.playerId);
  const place = standings(o).find((r) => r.playerId === g.you.playerId);
  const report = el("p", { class: "muted", text: o.narration ?? PENDING_REPORT });
  const card = statusCard(ENDING_ICON[o.id] ?? "⚠", o.title, null, report);
  return screen(
    s,
    [
      t.node,
      el("div", { class: `mc-finale e-${o.id}` }, card),
      place ? el("p", { class: "mc-place" }, el("span", { class: "eyebrow", text: "You placed" }), el("strong", { text: `#${place.place} of ${o.breakdown.length}` }), el("span", { class: "mono", text: `${place.total} pts` })) : null,
      summaryTiles(o),
      bestMoveEl(o),
      el(
        "div",
        { class: "reference" },
        el("span", { class: "eyebrow", text: "The entity" }),
        el("a", { class: "reference-id", href: o.entity.url, target: "_blank", rel: "noopener noreferrer" }, `${o.entity.ref} — ${o.entity.title} →`),
      ),
      mine
        ? el(
            "details",
            {},
            el("summary", { text: "Your score, point by point" }),
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
    (next) => {
      t.set(next.timer);
      report.textContent = next.game.outcome.narration ?? PENDING_REPORT;
    },
  );
}

function buildAwardSubmit(s, tools) {
  const g = s.game;
  const t = timerRow(s.timer, "Create an award");
  const note = el("p", { class: "notice" });
  const mine = g.you.awards?.mine?.[0] ?? null;
  const name = el("input", { id: "mcAward", type: "text", maxlength: String(g.limits.awardNameMax), autocomplete: "off", placeholder: "WHY WOULD YOU DO THAT", value: mine?.name ?? "" });
  const description = el("textarea", { id: "mcAwardDesc", maxlength: String(g.limits.awardDescriptionMax), rows: "2", placeholder: "Optional: what it's for" });
  description.value = mine?.description ?? "";
  const submit = el("button", { class: "btn big", type: "submit", text: mine ? "Update award" : "Create award" });
  const done = el("p", { class: "notice ok", role: "status" });
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
      },
    },
    el("p", { class: "phone-prompt", text: "Invent an award. Everyone votes on who gets it." }),
    el("label", { for: "mcAward", text: "Award name" }),
    name,
    el("label", { for: "mcAwardDesc", text: "Description (optional)" }),
    description,
    submit,
    done,
    note,
  );
  const setDone = (next) => {
    const have = next.game.you.awards?.mine?.[0];
    done.textContent = have ? `Filed: “${have.name}”. You can still edit it.` : "";
    submit.textContent = have ? "Update award" : "Create award";
    s = next;
  };
  setDone(s);
  return screen(s, [t.node, form], (next) => {
    t.set(next.timer);
    setDone(next);
  });
}

function buildAwardVote(s, tools) {
  const g = s.game;
  const t = timerRow(s.timer, "Hand out the awards");
  const note = el("p", { class: "notice" });
  const groups = g.awards.list.map((award) => {
    const buttons = g.awards.recipients.map((r) =>
      el("button", {
        class: "btn ghost small",
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
  return screen(s, [t.node, el("p", { class: "phone-prompt", text: "Who gets each award? (Not you.)" }), ...groups.map((x) => x.node), note], (next) => {
    t.set(next.timer);
    apply(next);
  });
}

function buildAwardResults(s) {
  const g = s.game;
  const t = timerRow(s.timer, "The awards");
  const won = g.awards.results.filter((a) => a.winners.some((w) => w.playerId === g.you.playerId));
  return screen(
    s,
    [
      t.node,
      won.length ? el("div", { class: "mc-you-won", role: "status" }, el("span", { "aria-hidden": "true", text: "🏆 " }), `You won ${won.map((a) => `“${a.name}”`).join(" and ")}`) : null,
      el(
        "ul",
        { class: "list" },
        g.awards.results.map((a) =>
          el("li", {}, el("span", { class: "grow" }, el("strong", { text: a.name })), el("span", { text: a.winners.length ? a.winners.map((w) => w.name).join(" & ") : "—" })),
        ),
      ),
      el("h3", { text: "Final scores" }),
      leaderboard(g.outcome, { you: g.you.playerId }),
    ],
    (next) => t.set(next.timer),
  );
}

export function render(mount, state, tools) {
  const g = state.game;
  preloadSounds(["response_in", "life_lost", "timer_warning"]);
  const key = `mycob:${g.incident.code}:${g.phase}:${g.stage}`;
  switch (g.phase) {
    case "ALERT":
    case "UPDATE":
      return mount(key, (s) => buildBriefing(s), state);
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
