// Budget Cuts on a phone. Three questions are always answered at the top: who am I (department),
// what do I want (my ask, the funding zone to aim for, my hidden goal) and what can I do now (one
// obvious action at the bottom). The arguing happens out loud; the phone only needs taps.

import { el, notice, timerEl } from "../common.js";
import { okZone, planTotals, TIER_SHORT, tierOf } from "./budgetcuts-funding.js";
import { rememberTutorialSeen, renderPhoneTutorial } from "./party-tutorial.js";

const TIER_CLASS = ["t0", "t1", "t2", "t3", "t4"];

const chip = (tier, text) => el("span", { class: `bc-tier ${TIER_CLASS[tier]}`, text });

// ------------------------------------------------------------------ the top card: who, what I want

function meCard(s, { showAim = true } = {}) {
  const g = s.game;
  const you = g.you;
  const d = you?.dept;
  const slot = el("span", { class: "bc-me-timer" }, timerEl(s.timer));
  const nodes = [
    el(
      "div",
      { class: "bc-me-head" },
      el("strong", { class: "bc-me-name", text: d ? `${d.glyph} ${d.name}` : "Budget Cuts" }),
      slot,
    ),
    el("p", { class: "bc-me-sub", text: `Cycle ${g.cycle}/${g.totalCycles} · Stability ${g.stability}%` }),
  ];
  if (d) {
    const [lo, hi] = okZone(d.request);
    nodes.push(
      el(
        "div",
        { class: "bc-want" },
        el("span", { class: "bc-want-n", text: d.request.toLocaleString() }),
        el("span", { class: "bc-want-l", text: "you ask" }),
        d.allocated !== null
          ? el("span", { class: "bc-want-get" }, `you get `, el("strong", { text: d.allocated.toLocaleString() }), " ", chip(d.tier, TIER_SHORT[d.tier]))
          : showAim
            ? el("span", { class: "bc-want-get", text: `aim ${lo}–${hi}` })
            : null,
      ),
      you.objective
        ? el(
            "p",
            { class: "bc-goal" },
            el("span", { "aria-hidden": "true", text: "🤫 " }),
            you.objective,
            you.objectiveOnTrack === null ? null : el("span", { class: `bc-goal-state ${you.objectiveOnTrack ? "ok" : ""}`.trim(), text: you.objectiveOnTrack ? "on track" : "not yet" }),
          )
        : null,
    );
  }
  return { node: el("div", { class: "bc-me" }, ...nodes), set: (t) => slot.replaceChildren(timerEl(t)) };
}

/** The department details and private tips, tucked away until wanted. */
function moreEl(you, { tips = true } = {}) {
  const d = you.dept;
  const showTips = tips && you.intel.length > 0;
  return el(
    "details",
    { class: "bc-more" },
    el("summary", { text: showTips ? `My department · ${you.intel.length} ${you.intel.length === 1 ? "tip" : "tips"}` : "My department" }),
    showTips ? el("ul", { class: "bc-tips" }, you.intel.map((l) => el("li", { text: l }))) : null,
    el("p", { class: "muted", text: `“${d.motto}”` }),
    el("p", {}, el("strong", { text: "Good at: " }), d.good),
    el("p", {}, el("strong", { text: "Weak at: " }), d.weak),
    el("p", {}, el("strong", { text: "Status: " }), d.healthLabel),
  );
}

/** The private tips, shown plainly while the briefing waits. */
function tipsEl(you) {
  return you.intel.length ? el("ul", { class: "bc-tips" }, you.intel.map((l) => el("li", { text: l }))) : null;
}

/** The one line that says what to do right now. */
function nudge(text, { strong = true } = {}) {
  return el("p", { class: `bc-nudge ${strong ? "strong" : ""}`.trim(), role: "status", text });
}

function simple(s, big, small, ...extra) {
  const me = meCard(s, { showAim: false });
  return { node: el("div", { class: "stack bc-phone" }, me.node, el("div", { class: "bc-todo" }, el("p", { class: "bc-todo-big", text: big }), small ? el("p", { class: "muted", text: small }) : null), ...extra), update: (n) => me.set(n.timer) };
}

// ------------------------------------------------------------------ briefing

function buildBriefing(s) {
  const g = s.game;
  const me = meCard(s);
  return {
    node: el("div", { class: "stack bc-phone" }, me.node, nudge("Read your goal. Negotiation opens soon."), tipsEl(g.you), moreEl(g.you, { tips: false })),
    update: (n) => me.set(n.timer),
  };
}

// ------------------------------------------------------------------ negotiation

function buildNegotiate(s, tools) {
  const me = meCard(s);
  const note = el("p", { class: "notice", role: "status" });
  let tab = "plans";
  let latest = s;

  const send = async (action, payload = {}) => {
    const result = await tools.request("game:input", { action, payload });
    if (!result.ok) notice(note, result.message ?? "That didn't go through.", "error");
    else notice(note, "");
    return result.ok;
  };

  // The editor keeps its own draft so live updates never wipe what you're tapping.
  const g0 = s.game;
  const leadAlloc = () => latest.game.proposals.find((p) => p.id === latest.game.leadingId)?.alloc ?? {};
  let draft = { ...(g0.you.proposal ?? leadAlloc()) };
  const step = Math.max(5, Math.round(g0.pool / 20 / 5) * 5);
  const used = () => planTotals(draft, g0.pool).total;

  // POOL / PLAN / LEFT, with a bar that turns red when the plan asks for too much.
  const barFill = el("span", { class: "bc-budget-fill" });
  const left = el("strong", { class: "bc-budget-left" });
  const budget = el(
    "div",
    { class: "bc-budget" },
    el("div", { class: "bc-budget-nums" }, el("span", { class: "bc-budget-pool" }), el("span", { class: "bc-budget-plan" }), left),
    el("span", { class: "bc-budget-bar" }, barFill),
  );
  const paintBudget = (g) => {
    const total = used();
    const over = total > g.pool;
    budget.classList.toggle("over", over);
    budget.querySelector(".bc-budget-pool").textContent = `POOL ${g.pool.toLocaleString()}`;
    budget.querySelector(".bc-budget-plan").textContent = `PLAN ${total.toLocaleString()}`;
    left.textContent = over ? `OVER ${(total - g.pool).toLocaleString()}` : `LEFT ${(g.pool - total).toLocaleString()}`;
    barFill.style.setProperty("--pct", `${Math.min(100, (total / Math.max(1, g.pool)) * 100)}%`);
  };

  const submit = el("button", { class: "btn", type: "button", onclick: () => send("propose", { alloc: draft }) });
  const rows = el("div", { class: "bc-editor" });
  const paintNudge = () => {
    const text = nudgeText(latest.game);
    guide.replaceChildren(...(text ? [nudge(text)] : []));
  };
  const drawEditor = () => {
    const g = latest.game;
    const over = used() > g.pool;
    paintBudget(g);
    paintNudge();
    submit.disabled = over;
    submit.textContent = over ? `Cut ${(used() - g.pool).toLocaleString()} first` : "Submit my plan";
    rows.replaceChildren(
      ...g.depts.map((d) => {
        const v = draft[d.id] ?? 0;
        const change = (delta) => {
          draft[d.id] = Math.max(0, (draft[d.id] ?? 0) + delta);
          drawEditor();
        };
        const mine = d.id === g.you.dept.id;
        return el(
          "div",
          { class: `bc-row ${mine ? "mine" : ""}`.trim() },
          el("span", { class: "bc-row-name" }, el("span", { text: `${d.glyph} ${d.name}` }), el("span", { class: "bc-row-ask", text: `asks ${d.request}` })),
          el("button", { class: "btn small ghost", type: "button", "aria-label": `Less for ${d.name}`, onclick: () => change(-step), text: "−" }),
          el("span", { class: "bc-row-mid" }, el("strong", { class: "bc-row-v", text: String(v) }), chip(tierOf(v, d.request), TIER_SHORT[tierOf(v, d.request)])),
          el("button", { class: "btn small ghost", type: "button", "aria-label": `More for ${d.name}`, onclick: () => change(step), text: "+" }),
        );
      }),
    );
  };

  const plansList = el("div", { class: "bc-back" });
  const dealList = el("div", { class: "bc-deal-list" });
  const lockBtn = el("button", { class: "btn big bc-lock", type: "button" });
  const guide = el("div", { class: "bc-guide-slot" });
  const panel = el("div");
  const tabs = el("div", { class: "bc-tabs", role: "tablist" });

  const drawTabs = () => {
    tabs.replaceChildren(
      ...[["plans", "Plans"], ["mine", "My plan"], ["deals", "Deals"]].map(([id, label]) =>
        el("button", { class: `btn small ${tab === id ? "" : "ghost"}`, type: "button", role: "tab", "aria-selected": String(tab === id), text: label, onclick: () => ((tab = id), draw()) }),
      ),
    );
  };

  // First-cycle nudges that say what to do next; they go away after cycle 1.
  const nudgeText = (g) => {
    const you = g.you;
    if (g.cycle > 1) return g.voteAttempt > 0 ? "Last vote failed. Fix the plan." : "";
    if (tab === "mine") return used() > g.pool ? "Too much asked. Someone must cut." : "Budget fits. Submit it.";
    if (you.locked) return "Locked. Waiting for the others.";
    if (you.backing) return "Happy with it? Lock in.";
    return "Back a plan below.";
  };

  const draw = () => {
    const g = latest.game;
    const you = g.you;
    drawTabs();
    paintNudge();
    plansList.replaceChildren(
      el("span", { class: "eyebrow", text: "Back one plan" }),
      ...g.proposals.map((p) => {
        const mine = p.alloc[you.dept.id] ?? 0;
        const t = tierOf(mine, you.dept.request);
        return el(
          "button",
          { class: `vote-option bc-plan ${you.backing === p.id ? "chosen" : ""}`.trim(), type: "button", onclick: () => send("back", { proposalId: p.id }) },
          el("span", { class: "bc-plan-label", text: p.label }),
          el("span", { class: "bc-plan-get" }, `you get `, el("strong", { text: String(mine) }), " ", chip(t, TIER_SHORT[t])),
          el("span", { class: "bc-plan-meta", text: `${you.backing === p.id ? "✓ backed · " : ""}${p.backers.length} backing${p.id === g.leadingId ? " · LEADING" : ""}` }),
        );
      }),
      el("button", { class: "btn small ghost", type: "button", text: "+ Build my own plan", onclick: () => ((tab = "mine"), draw()) }),
    );
    dealList.replaceChildren(
      el("p", { class: "muted", text: "Deal: +80 each if you both end OK or better." }),
      ...g.depts
        .filter((d) => d.id !== you.dept.id)
        .map((d) => {
          const accepted = you.dealsAccepted.includes(d.id);
          const incoming = you.dealsIn.includes(d.id);
          const offered = you.dealsOut.some((o) => o.dept === d.id);
          const label = accepted ? "🤝 Deal" : incoming ? "Accept" : offered ? "Sent…" : "Offer";
          return el(
            "div",
            { class: "bc-row" },
            el("span", { class: "bc-row-name", text: `${d.glyph} ${d.name} (${d.player})` }),
            el("button", { class: `btn small ${incoming ? "" : "ghost"}`, type: "button", disabled: accepted || (offered && !incoming), text: label, onclick: () => send("deal", { dept: d.id }) }),
          );
        }),
    );
    lockBtn.textContent = you.locked ? `✓ LOCKED ${g.lockedCount}/${g.playerCount} · tap to undo` : `LOCK IN ${g.lockedCount}/${g.playerCount}`;
    lockBtn.classList.toggle("ghost", you.locked);
    lockBtn.onclick = () => send(you.locked ? "unlock" : "lock");
    const mineView = el("div", { class: "stack" }, budget, rows, el("div", { class: "row" }, el("button", { class: "btn ghost small", type: "button", text: "Copy leading plan", onclick: () => ((draft = { ...leadAlloc() }), drawEditor()) }), submit));
    panel.replaceChildren(tab === "plans" ? plansList : tab === "mine" ? mineView : dealList);
    if (tab === "mine") drawEditor();
  };

  draw();
  return {
    node: el("div", { class: "stack bc-phone" }, me.node, guide, tabs, panel, note, moreEl(s.game.you), lockBtn),
    update(n) {
      latest = n;
      me.set(n.timer);
      draw();
    },
  };
}

// ------------------------------------------------------------------ vote and after

function buildVote(s, tools) {
  const me = meCard(s);
  const note = el("p", { class: "notice", role: "status" });
  const status = el("p", { class: "notice ok", role: "status" });
  const vote = async (approve) => {
    const r = await tools.request("game:input", { action: "vote", payload: { approve } });
    if (!r.ok && r.error !== "ALREADY_VOTED") notice(note, r.message, "error");
  };
  const yes = el("button", { class: "btn big bc-approve", type: "button", text: "APPROVE", onclick: () => vote(true) });
  const no = el("button", { class: "btn big danger bc-reject", type: "button", text: "REJECT", onclick: () => vote(false) });
  const apply = (n) => {
    const v = n.game.you.vote;
    yes.disabled = no.disabled = v !== null;
    yes.classList.toggle("chosen", v === true);
    no.classList.toggle("chosen", v === false);
    status.textContent = v === null ? "" : `You voted ${v ? "APPROVE" : "REJECT"}. ${n.game.votesCast}/${n.game.playerCount} in.`;
  };
  apply(s);
  return {
    node: el("div", { class: "stack bc-phone" }, me.node, nudge(`Vote ${s.game.voteAttempt} of ${s.game.maxVotes}. Majority passes the top plan.`), el("div", { class: "bc-vote-buttons" }, yes, no), status, note),
    update(n) {
      me.set(n.timer);
      apply(n);
    },
  };
}

function buildIncident(s) {
  const g = s.game;
  const inc = g.incidents[g.incidentIndex];
  const mine = g.you.dept.id;
  const mineFunding = inc?.funding.find((f) => f.id === mine);
  let result = null;
  if (inc && !mineFunding) result = el("p", { class: "muted", text: "Not your department this time." });
  else if (inc && inc.blamed === g.you.dept.name) result = el("div", { class: "bc-secret" }, el("span", { class: "stamp danger", text: "BLAMED −40" }), el("p", { class: "muted", text: `You were ${mineFunding.tierLabel}.` }));
  else if (inc && inc.outcome !== "FAILED" && mineFunding.tier >= 2) result = el("div", { class: "bc-file" }, el("span", { class: "stamp ok", text: "YOU HELPED +60" }), el("p", { class: "muted", text: `You were ${mineFunding.tierLabel}.` }));
  else if (inc) result = el("p", { class: "muted", text: `You were ${mineFunding.tierLabel}.` });
  return simple(s, inc ? `${inc.title}: ${inc.outcome}` : "Incident incoming…", "Watch the big screen.", result);
}

function buildConsequences(s) {
  const g = s.game;
  const me = g.you.dept;
  const change = g.summary.healthChanges.find((c) => c.dept === me.id);
  return simple(s, g.collapsed ? "The CPI has collapsed." : change ? `${me.name}: ${change.fromLabel} → ${change.toLabel}` : `${me.name} is ${me.healthLabel}.`, g.collapsed ? "" : `End of cycle ${g.cycle}.`);
}

function buildAudit(s) {
  const g = s.game;
  const row = g.audit.rows.find((r) => r.dept === g.you.dept.id);
  return simple(
    s,
    row?.objectiveMet ? "Goal met!" : "Goal missed.",
    g.audit.survived ? `CPI survived at ${g.audit.stability}%.` : "The CPI collapsed.",
    row ? el("div", { class: "bc-file" }, el("p", { text: `Goal +${row.objectivePts} · Department +${row.healthPts} · CPI +${row.groupPts}` })) : null,
  );
}

export function render(mount, state, tools) {
  const g = state.game;
  if (g.phase === "TUTORIAL") return renderPhoneTutorial(mount, state, tools);
  rememberTutorialSeen(state);
  if (!g.you) return mount("budgetcuts:spectator", (s) => simple(s, "You're watching this one.", "Follow the big screen."), state);
  const key = `budgetcuts:${g.phase}:${g.cycle}:${g.voteAttempt}:${g.incidentIndex}`;
  switch (g.phase) {
    case "BRIEFING":
      return mount(key, buildBriefing, state);
    case "NEGOTIATE":
      return mount(key, (s) => buildNegotiate(s, tools), state);
    case "VOTE":
      return mount(key, (s) => buildVote(s, tools), state);
    case "VERDICT":
      return mount(key, (s) => simple(s, s.game.lastVote.passed ? "BUDGET APPROVED" : "BUDGET REJECTED", `${s.game.lastVote.approve} approve · ${s.game.lastVote.reject} reject`), state);
    case "FORCED":
      return mount(key, (s) => simple(s, s.game.forced.name, s.game.forced.text), state);
    case "INCIDENTS":
      return mount(key, buildIncident, state);
    case "CONSEQUENCES":
      return mount(key, buildConsequences, state);
    case "AUDIT":
      return mount(key, buildAudit, state);
  }
}
