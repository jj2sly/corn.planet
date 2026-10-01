// Budget Cuts on a phone: your department file, quick budget controls, deals and the vote.
// The arguing happens out loud; the phone only needs taps.

import { el, notice, timerEl } from "../common.js";

const TIER_CLASS = ["t0", "t1", "t2", "t3", "t4"];

function top(s) {
  const g = s.game;
  const d = g.you?.dept;
  const slot = el("span", {}, timerEl(s.timer));
  const node = el(
    "div",
    { class: "bc-phone-top" },
    d ? el("strong", { text: `${d.glyph} ${d.name}` }) : el("strong", { text: "Budget Cuts" }),
    el("span", { class: "muted", text: `Cycle ${g.cycle}/${g.totalCycles} · Stability ${g.stability}%` }),
    slot,
  );
  return { node, set: (t) => slot.replaceChildren(timerEl(t)) };
}

function todo(what, doThis) {
  return el("div", { class: "bc-todo" }, el("p", { class: "muted", text: what }), el("p", {}, el("strong", { text: doThis })));
}

function fundingLine(d) {
  if (d.allocated === null) return el("p", {}, `You asked for `, el("strong", { text: String(d.request) }), " kernels.");
  return el(
    "p",
    {},
    "You get ",
    el("strong", { text: String(d.allocated) }),
    ` of ${d.request} asked → `,
    el("span", { class: `bc-tier ${TIER_CLASS[d.tier]}`, text: d.tierLabel }),
  );
}

function fileEl(g) {
  const you = g.you;
  const d = you.dept;
  return el(
    "div",
    { class: "stack" },
    el(
      "div",
      { class: "bc-file" },
      el("p", { class: "muted", text: `“${d.motto}”` }),
      el("p", {}, el("strong", { text: "Good at: " }), d.good),
      el("p", {}, el("strong", { text: "Weak at: " }), d.weak),
      el("p", {}, el("strong", { text: "Status: " }), d.healthLabel, d.emergency ? " — emergency top-up included" : ""),
      fundingLine(d),
      el("p", { class: "muted", text: `Pitch: ${d.pitch}` }),
    ),
    el(
      "div",
      { class: "bc-secret" },
      el("span", { class: "stamp danger", text: "Hidden priority · eyes only" }),
      el("p", { text: you.objective }),
      you.objectiveOnTrack !== null ? el("p", { class: "muted", text: you.objectiveOnTrack ? "Currently on track." : "Not there yet." }) : null,
    ),
    you.intel.length ? el("div", { class: "bc-intel" }, el("span", { class: "eyebrow", text: "Private intel" }), el("ul", {}, you.intel.map((l) => el("li", { text: l })))) : null,
  );
}

function buildBriefing(s) {
  const t = top(s);
  return {
    node: el("div", { class: "stack bc-phone" }, t.node, todo(`${s.game.pool} kernels for ${s.game.depts.length} departments.`, "Read your file. Negotiation opens in a moment."), fileEl(s.game)),
    update: (n) => t.set(n.timer),
  };
}

// ------------------------------------------------------------------ negotiation

function buildNegotiate(s, tools) {
  const t = top(s);
  const note = el("p", { class: "notice", role: "status" });
  let tab = "plan";
  let latest = s;

  const send = async (action, payload = {}) => {
    const result = await tools.request("game:input", { action, payload });
    if (!result.ok) notice(note, result.message ?? "That didn't go through.", "error");
    else notice(note, "");
    return result.ok;
  };

  // The editor keeps its own draft so live updates never wipe what you're typing in.
  const g0 = s.game;
  const leadAlloc = () => latest.game.proposals.find((p) => p.id === latest.game.leadingId)?.alloc ?? {};
  let draft = { ...(g0.you.proposal ?? leadAlloc()) };
  const step = Math.max(5, Math.round(g0.pool / 20 / 5) * 5);
  const used = () => Object.values(draft).reduce((a, b) => a + b, 0);

  const remaining = el("strong");
  const submit = el("button", { class: "btn", type: "button", text: "Submit my plan", onclick: () => send("propose", { alloc: draft }) });
  const rows = el("div", { class: "bc-editor" });
  const drawEditor = () => {
    const g = latest.game;
    remaining.textContent = String(g.pool - used());
    remaining.classList.toggle("bad", used() > g.pool);
    submit.disabled = used() > g.pool;
    submit.textContent = used() > g.pool ? `Over by ${used() - g.pool}` : "Submit my plan";
    rows.replaceChildren(
      ...g.depts.map((d) => {
        const v = draft[d.id] ?? 0;
        const change = (delta) => {
          draft[d.id] = Math.max(0, (draft[d.id] ?? 0) + delta);
          drawEditor();
        };
        return el(
          "div",
          { class: `bc-row ${d.id === g.you.dept.id ? "mine" : ""}` },
          el("span", { class: "bc-row-name" }, `${d.glyph} ${d.name}`, el("span", { class: "muted", text: ` asks ${d.request}` })),
          el("button", { class: "btn small ghost", type: "button", "aria-label": `Less for ${d.name}`, onclick: () => change(-step), text: "−" }),
          el("strong", { class: "bc-row-v", text: String(v) }),
          el("button", { class: "btn small ghost", type: "button", "aria-label": `More for ${d.name}`, onclick: () => change(step), text: "+" }),
        );
      }),
    );
  };

  const planTab = el(
    "div",
    { class: "stack" },
    el("p", { class: "muted" }, "Kernels left to hand out: ", remaining),
    rows,
    el(
      "div",
      { class: "row" },
      el("button", { class: "btn ghost small", type: "button", text: "Copy leading plan", onclick: () => ((draft = { ...leadAlloc() }), drawEditor()) }),
      submit,
    ),
  );

  const backList = el("div", { class: "bc-back" });
  const dealList = el("div", { class: "bc-deal-list" });
  const lockBtn = el("button", { class: "btn big bc-lock", type: "button" });
  const panel = el("div");
  const tabs = el("div", { class: "bc-tabs", role: "tablist" });

  const drawTabs = () => {
    tabs.replaceChildren(
      ...[["plan", "Budget"], ["file", "My file"], ["deals", "Deals"]].map(([id, label]) =>
        el("button", { class: `btn small ${tab === id ? "" : "ghost"}`, type: "button", role: "tab", "aria-selected": String(tab === id), text: label, onclick: () => ((tab = id), draw()) }),
      ),
    );
  };

  const draw = () => {
    const g = latest.game;
    const you = g.you;
    drawTabs();
    backList.replaceChildren(
      el("span", { class: "eyebrow", text: "Back a plan (the most-backed plan goes to the vote)" }),
      ...g.proposals.map((p) =>
        el(
          "button",
          { class: `vote-option ${you.backing === p.id ? "chosen" : ""}`, type: "button", onclick: () => send("back", { proposalId: p.id }) },
          el("span", { class: "letter", text: `${p.backers.length} backing${p.id === g.leadingId ? " · LEADING" : ""}` }),
          `${p.label} — you get ${p.alloc[you.dept.id] ?? 0}`,
        ),
      ),
    );
    dealList.replaceChildren(
      el("p", { class: "muted", text: "A deal pays +80 to both of you if both departments end this cycle Adequate or better. Say what you're offering out loud." }),
      ...g.depts
        .filter((d) => d.id !== you.dept.id)
        .map((d) => {
          const accepted = you.dealsAccepted.includes(d.id);
          const incoming = you.dealsIn.includes(d.id);
          const offered = you.dealsOut.some((o) => o.dept === d.id);
          const label = accepted ? "🤝 DEAL MADE" : incoming ? "Accept their deal" : offered ? "Offer sent…" : "Offer a deal";
          return el(
            "div",
            { class: "bc-row" },
            el("span", { class: "bc-row-name", text: `${d.glyph} ${d.name} (${d.player})` }),
            el("button", { class: `btn small ${incoming ? "" : "ghost"}`, type: "button", disabled: accepted || (offered && !incoming), text: label, onclick: () => send("deal", { dept: d.id }) }),
          );
        }),
    );
    lockBtn.textContent = you.locked ? `LOCKED IN ✓ (${g.lockedCount}/${g.playerCount}) — tap to unlock` : `LOCK IN (${g.lockedCount}/${g.playerCount})`;
    lockBtn.classList.toggle("ghost", you.locked);
    lockBtn.onclick = () => send(you.locked ? "unlock" : "lock");
    panel.replaceChildren(tab === "plan" ? el("div", { class: "stack" }, planTab, backList) : tab === "file" ? fileEl(g) : dealList);
    if (tab === "plan") drawEditor();
  };

  draw();
  return {
    node: el(
      "div",
      { class: "stack bc-phone" },
      t.node,
      todo(s.game.voteAttempt > 0 ? "The vote failed. Short renegotiation." : "Argue it out loud!", "Back a plan (or submit your own), then LOCK IN."),
      tabs,
      panel,
      note,
      lockBtn,
    ),
    update(n) {
      latest = n;
      t.set(n.timer);
      draw();
    },
  };
}

// ------------------------------------------------------------------ vote and after

function buildVote(s, tools) {
  const t = top(s);
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
    status.textContent = v === null ? "" : `You voted ${v ? "APPROVE" : "REJECT"}. Votes in: ${n.game.votesCast}/${n.game.playerCount}.`;
  };
  apply(s);
  return {
    node: el(
      "div",
      { class: "stack bc-phone" },
      t.node,
      todo(`Vote ${s.game.voteAttempt} of ${s.game.maxVotes} on the leading plan.`, "APPROVE or REJECT."),
      el("div", { class: "bc-file" }, fundingLine(s.game.you.dept)),
      el("div", { class: "bc-vote-buttons" }, yes, no),
      status,
      note,
    ),
    update(n) {
      t.set(n.timer);
      apply(n);
    },
  };
}

function simple(s, what, doThis, ...extra) {
  const t = top(s);
  return { node: el("div", { class: "stack bc-phone" }, t.node, todo(what, doThis), ...extra), update: (n) => t.set(n.timer) };
}

function buildIncident(s) {
  const g = s.game;
  const inc = g.incidents[g.incidentIndex];
  const mine = g.you.dept.id;
  const mineFunding = inc?.funding.find((f) => f.id === mine);
  let result;
  if (!inc) result = null;
  else if (!mineFunding) result = el("p", { class: "muted", text: "Not your department's problem this time. Enjoy it." });
  else if (inc.blamed === g.you.dept.name) result = el("div", { class: "bc-secret" }, el("span", { class: "stamp danger", text: "BLAMED" }), el("p", { text: `You went in ${mineFunding.tierLabel}. It went badly. −40 points.` }));
  else if (inc.outcome !== "FAILED" && mineFunding.tier >= 2) result = el("div", { class: "bc-file" }, el("span", { class: "stamp ok", text: "YOU HELPED" }), el("p", { text: `You were ${mineFunding.tierLabel}. +60 points.` }));
  else result = el("div", { class: "bc-file" }, el("p", { text: `You were ${mineFunding.tierLabel} for this one.` }));
  return simple(s, inc ? `${inc.title}: ${inc.outcome}` : "Incident incoming…", "Watch the big screen.", inc ? el("p", { class: "bc-line", text: inc.line }) : null, result);
}

function buildConsequences(s) {
  const g = s.game;
  const me = g.you.dept;
  const change = g.summary.healthChanges.find((c) => c.dept === me.id);
  return simple(
    s,
    g.collapsed ? "The CPI has collapsed." : `End of cycle ${g.cycle}.`,
    change ? `${me.name}: ${change.fromLabel} → ${change.toLabel}` : `${me.name} is ${me.healthLabel}.`,
    change ? el("p", { class: "muted", text: change.reason }) : null,
    el("div", { class: "bc-secret" }, el("span", { class: "stamp danger", text: "Hidden priority" }), el("p", { text: g.you.objective }), el("p", { class: "muted", text: g.you.objectiveOnTrack ? "On track so far." : "Not met yet." })),
  );
}

function buildAudit(s) {
  const g = s.game;
  const row = g.audit.rows.find((r) => r.dept === g.you.dept.id);
  return simple(
    s,
    g.audit.survived ? `The CPI survived at ${g.audit.stability}% stability.` : "The CPI collapsed.",
    row?.objectiveMet ? "Hidden priority: MET" : "Hidden priority: missed",
    row
      ? el(
          "div",
          { class: "bc-file" },
          el("p", { text: row.objective }),
          el("p", { text: `Objective +${row.objectivePts} · Department (${row.health}) +${row.healthPts} · CPI stability +${row.groupPts}` }),
        )
      : null,
  );
}

export function render(mount, state, tools) {
  const g = state.game;
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
      return mount(key, (s) => simple(s, `${s.game.lastVote.approve} approve · ${s.game.lastVote.reject} reject`, s.game.lastVote.passed ? "BUDGET APPROVED" : "BUDGET REJECTED"), state);
    case "FORCED":
      return mount(key, (s) => simple(s, s.game.forced.text, s.game.forced.name, el("div", { class: "bc-file" }, fundingLine(s.game.you.dept))), state);
    case "INCIDENTS":
      return mount(key, buildIncident, state);
    case "CONSEQUENCES":
      return mount(key, buildConsequences, state);
    case "AUDIT":
      return mount(key, buildAudit, state);
  }
}
