// Budget Cuts on the big screen: the kernel pool in the middle, department cards with funding bars
// around it, and a "what is happening / what to do" strip on every phase so a first table can follow.

import { el, plural, rank, scoreboardEl, timerEl } from "../common.js";
import { playNewCues } from "./mycob-sound.js";

const TIER_CLASS = ["t0", "t1", "t2", "t3", "t4"];
const HEALTH_CLASS = ["h0", "h1", "h2", "h3"];

function guide(what, todo) {
  return el(
    "div",
    { class: "bc-guide" },
    el("div", {}, el("span", { class: "eyebrow", text: "What is happening" }), el("p", { text: what })),
    el("div", {}, el("span", { class: "eyebrow", text: "What you need to do" }), el("p", { text: todo })),
  );
}

function stabilityEl(g) {
  const meter = el("span", { class: "bc-meter-fill" });
  meter.style.setProperty("--pct", `${g.stability}%`);
  return el(
    "div",
    { class: `bc-stability ${g.stability <= 25 ? "low" : g.stability <= 50 ? "mid" : ""}`.trim() },
    el("span", { class: "eyebrow", text: "CPI Stability" }),
    el("span", { class: "bc-meter" }, meter),
    el("strong", { text: `${g.stability}%` }),
  );
}

function header(g, title, timer) {
  const slot = el("div", {}, timerEl(timer));
  const node = el(
    "div",
    { class: "phase-head bc-head" },
    el("div", {}, el("p", { class: "eyebrow", text: `Budget cycle ${g.cycle} of ${g.totalCycles} · CPI Emergency Finance Office` }), el("h1", { text: title })),
    stabilityEl(g),
    slot,
  );
  return { node, setTimer: (t) => slot.replaceChildren(timerEl(t)) };
}

function poolEl(g, label = "Kernels available") {
  return el(
    "div",
    { class: "bc-pool" },
    el("span", { class: "eyebrow", text: label }),
    el("strong", { class: "bc-pool-n", text: g.pool.toLocaleString() }),
    el("span", { class: "muted", text: `Departments asked for ${g.depts.reduce((s, d) => s + d.request, 0).toLocaleString()}` }),
  );
}

function bar(allocated, request) {
  // Full width is twice the request, so the request line sits in the middle.
  const fill = el("span", { class: "bc-bar-fill" });
  fill.style.setProperty("--pct", `${Math.min(100, ((allocated ?? 0) / Math.max(1, request)) * 50)}%`);
  return el("span", { class: "bc-bar" }, fill, el("span", { class: "bc-bar-req", title: "Request" }));
}

function deptCard(d, { highlight = false } = {}) {
  return el(
    "article",
    { class: `bc-dept ${HEALTH_CLASS[d.health]} ${highlight ? "hot" : ""}`.trim() },
    el(
      "div",
      { class: "bc-dept-top" },
      el("span", { class: "bc-glyph", "aria-hidden": "true", text: d.glyph }),
      el("div", {}, el("strong", { text: d.name }), el("span", { class: "muted bc-agent", text: d.player })),
      el("span", { class: `stamp ${d.health >= 2 ? "danger" : d.health === 1 ? "muted" : "ok"}`, text: d.healthLabel }),
    ),
    el(
      "div",
      { class: "bc-dept-nums" },
      el("span", {}, "Asked ", el("strong", { text: String(d.request) })),
      d.allocated !== null ? el("span", {}, "Gets ", el("strong", { text: String(d.allocated) })) : null,
    ),
    d.allocated !== null ? bar(d.allocated, d.request) : null,
    d.tierLabel ? el("span", { class: `bc-tier ${TIER_CLASS[d.tier]}`, text: d.tierLabel }) : null,
    d.emergency ? el("span", { class: "bc-emergency", text: "EMERGENCY REQUEST" }) : null,
  );
}

function deptGrid(g, hot = []) {
  return el("div", { class: `bc-depts n${g.depts.length}` }, g.depts.map((d) => deptCard(d, { highlight: hot.includes(d.id) })));
}

function forecastEl(g) {
  return el(
    "div",
    { class: "bc-panel bc-forecast" },
    el("span", { class: "eyebrow", text: `Risk forecast — ${g.forecastReal} of these will happen` }),
    el(
      "ul",
      {},
      g.forecast.map((f) => el("li", {}, el("strong", { text: f.category }), el("span", { class: "muted", text: ` usually needs ${f.needs.join(", ")}` }))),
    ),
  );
}

function proposalsEl(g) {
  return el(
    "div",
    { class: "bc-panel" },
    el("span", { class: "eyebrow", text: "Plans on the table" }),
    el(
      "ol",
      { class: "bc-props" },
      g.proposals.map((p) =>
        el(
          "li",
          { class: p.id === g.leadingId ? "lead" : "" },
          el("strong", { text: p.label }),
          el("span", { class: "muted", text: p.backers.length ? ` backed by ${p.backers.join(", ")}` : " no backers" }),
          p.id === g.leadingId ? el("span", { class: "stamp solid", text: "LEADING" }) : null,
        ),
      ),
    ),
  );
}

function dealsEl(g) {
  if (!g.deals.length) return null;
  return el(
    "div",
    { class: "bc-panel" },
    el("span", { class: "eyebrow", text: "Back-room deals" }),
    el(
      "ul",
      { class: "bc-deals" },
      g.deals.map((d) => el("li", {}, d.accepted ? `🤝 ${d.from} ⇄ ${d.to}` : `${d.from} → ${d.to}: deal offered…`)),
    ),
  );
}

function sum(g) {
  return g.depts.reduce((s, d) => s + d.request, 0);
}

// ------------------------------------------------------------------ phases

function buildBriefing(s) {
  const g = s.game;
  const h = header(g, `CYCLE ${g.cycle} BRIEFING`, s.timer);
  return {
    node: el(
      "div",
      { class: "bc" },
      h.node,
      guide(`${g.situation} There are ${g.pool} kernels for ${sum(g)} kernels of requests.`, "Check your department file on your phone: your request, your hidden priority and private intel. Negotiation opens next."),
      el(
        "div",
        { class: "bc-main" },
        el(
          "div",
          { class: "bc-side" },
          poolEl(g),
          g.surprise ? el("div", { class: "bc-panel bc-surprise" }, el("span", { class: "stamp danger", text: "Surprise expense" }), el("p", { text: `${g.surprise.name}: −${g.surprise.cost} kernels` })) : null,
          forecastEl(g),
        ),
        deptGrid(g),
      ),
    ),
    update: (n) => h.setTimer(n.timer),
  };
}

function buildNegotiate(s) {
  const g = s.game;
  const lead = g.proposals.find((p) => p.id === g.leadingId);
  const h = header(g, g.voteAttempt > 0 ? "RENEGOTIATION" : "NEGOTIATE", s.timer);
  return {
    node: el(
      "div",
      { class: "bc" },
      h.node,
      guide(
        `Departments are fighting over ${g.pool} kernels. The leading plan is “${lead?.label ?? "Comptroller's Draft"}”.${g.voteAttempt > 0 ? " The last vote failed — fix it or face Emergency Allocation." : ""}`,
        `ARGUE OUT LOUD. On your phone: build a plan, back a plan, offer deals, then LOCK IN. Locked in: ${g.lockedCount}/${g.playerCount}.`,
      ),
      el("div", { class: "bc-main" }, el("div", { class: "bc-side" }, poolEl(g), proposalsEl(g), dealsEl(g), forecastEl(g)), deptGrid(g)),
    ),
    update: (n) => h.setTimer(n.timer),
  };
}

function buildVote(s) {
  const g = s.game;
  const lead = g.proposals.find((p) => p.id === g.leadingId);
  const h = header(g, "BUDGET VOTE", s.timer);
  return {
    node: el(
      "div",
      { class: "bc" },
      h.node,
      guide(
        `Voting on “${lead?.label ?? "Comptroller's Draft"}”. Vote ${g.voteAttempt} of ${g.maxVotes}: if it fails ${g.maxVotes === g.voteAttempt ? "now" : "twice"}, Emergency Allocation decides for you.`,
        `APPROVE or REJECT on your phone. More approvals than rejections passes it. Votes in: ${g.votesCast}/${g.playerCount}.`,
      ),
      el("div", { class: "bc-main" }, el("div", { class: "bc-side" }, poolEl(g, "Pool"), el("div", { class: "bc-vote-big", text: "APPROVE / REJECT" })), deptGrid(g)),
    ),
    update: (n) => h.setTimer(n.timer),
  };
}

function buildVerdict(s) {
  const g = s.game;
  const v = g.lastVote;
  const h = header(g, v.passed ? "BUDGET APPROVED" : "BUDGET REJECTED", s.timer);
  const next = v.passed ? "The budget is locked. Incidents incoming." : g.voteAttempt >= g.maxVotes ? "Too many failed votes. Emergency Allocation is taking over." : "Back to the table for a short renegotiation.";
  return {
    node: el(
      "div",
      { class: "bc" },
      h.node,
      el(
        "div",
        { class: `bc-verdict ${v.passed ? "ok" : "bad"}` },
        el("span", { class: `stamp ${v.passed ? "ok" : "danger"} bc-big-stamp`, text: v.passed ? "APPROVED" : "REJECTED" }),
        el("p", { text: `${plural(v.approve, "approval")} · ${plural(v.reject, "rejection")}` }),
        el("p", { class: "muted", text: next }),
      ),
      deptGrid(g),
    ),
    update: (n) => h.setTimer(n.timer),
  };
}

function buildForced(s) {
  const g = s.game;
  const h = header(g, "EMERGENCY ALLOCATION", s.timer);
  return {
    node: el(
      "div",
      { class: "bc" },
      h.node,
      el("div", { class: "bc-verdict bad" }, el("span", { class: "stamp danger bc-big-stamp", text: g.forced.name }), el("p", { text: g.forced.text }), el("p", { class: "muted", text: "Oversight noticed the deadlock: −4 stability." })),
      deptGrid(g),
    ),
    update: (n) => h.setTimer(n.timer),
  };
}

const OUTCOME = { CONTAINED: ["ok", "CONTAINED"], PATCHED: ["muted", "PATCHED UP"], FAILED: ["danger", "FAILED"] };

function incidentCard(inc, big) {
  const [cls, label] = OUTCOME[inc.outcome];
  return el(
    "article",
    { class: `bc-incident ${big ? "big" : ""} ${inc.outcome.toLowerCase()}` },
    el("div", { class: "row spread" }, el("span", { class: "eyebrow", text: `⚠ ${inc.category}` }), el("span", { class: `stamp ${cls}`, text: label })),
    el("h2", { text: inc.title }),
    el("p", { class: "bc-setup", text: inc.setup }),
    big
      ? el(
          "div",
          { class: "bc-needs" },
          inc.funding.map((f) => el("span", { class: `bc-tier ${TIER_CLASS[f.tier]}` }, `${f.name}: ${f.tierLabel}`)),
          el("span", { class: "muted", text: `Response odds ${inc.chance}%` }),
        )
      : null,
    el("p", { class: "bc-line", text: inc.line }),
    el(
      "p",
      { class: "muted" },
      `Stability ${inc.stabilityDelta >= 0 ? "+" : ""}${inc.stabilityDelta}`,
      inc.kernelsLost ? ` · ${inc.kernelsLost} kernels of cleanup off next cycle` : "",
      inc.hero ? ` · Saved by ${inc.hero}` : "",
      inc.blamed ? ` · Blame: ${inc.blamed}` : "",
    ),
  );
}

function buildIncidents(s) {
  const g = s.game;
  const current = g.incidents[g.incidentIndex];
  const earlier = g.incidents.slice(0, g.incidentIndex);
  const h = header(g, `INCIDENT ${g.incidentIndex + 1}`, s.timer);
  return {
    node: el(
      "div",
      { class: "bc bc-alarm" },
      h.node,
      guide("Incidents are hitting the CPI. Each one checks how the departments it needs were funded — better funding means better odds, never a guarantee.", "Watch. Cheer. Assign blame loudly."),
      el("div", { class: "bc-main" }, el("div", { class: "bc-side" }, current ? incidentCard(current, true) : null, earlier.map((i) => incidentCard(i, false))), deptGrid(g, current?.needs.map((n) => n.id) ?? [])),
    ),
    update: (n) => h.setTimer(n.timer),
  };
}

function buildConsequences(s) {
  const g = s.game;
  const sm = g.summary;
  const h = header(g, g.collapsed ? "CATASTROPHIC BUREAUCRATIC FAILURE" : `CYCLE ${g.cycle} CONSEQUENCES`, s.timer);
  const delta = sm.stabilityAfter - sm.stabilityBefore;
  return {
    node: el(
      "div",
      { class: "bc" },
      h.node,
      guide(
        g.collapsed ? "CPI Stability hit zero. The institution has dissolved into a single unanswered memo." : `Stability ${delta >= 0 ? "+" : ""}${delta} this cycle. ${sm.kernelsLost ? `${sm.kernelsLost} kernels of cleanup come out of next cycle's pool.` : "No cleanup costs carried over."}`,
        g.collapsed || g.cycle >= g.totalCycles ? "The final audit is next." : "Next cycle: less money, bigger requests. Damaged departments will be asking for emergency funding.",
      ),
      el(
        "div",
        { class: "bc-main" },
        el(
          "div",
          { class: "bc-side" },
          el("div", { class: "bc-panel" }, el("span", { class: "eyebrow", text: "Incident report" }), g.incidents.map((i) => incidentCard(i, false))),
          sm.healthChanges.length
            ? el(
                "div",
                { class: "bc-panel" },
                el("span", { class: "eyebrow", text: "Department status" }),
                el("ul", {}, sm.healthChanges.map((c) => el("li", {}, el("strong", { text: c.name }), `: ${c.fromLabel} → ${c.toLabel} (${c.reason})`))),
              )
            : null,
          sm.deals.length
            ? el(
                "div",
                { class: "bc-panel" },
                el("span", { class: "eyebrow", text: "Deals" }),
                el("ul", {}, sm.deals.map((d) => el("li", {}, `${d.from} ⇄ ${d.to}: ${d.honored ? "HONORED (+80 each)" : "fell through"}`))),
              )
            : null,
          sm.notes.map((n) => el("p", { class: "bc-note", text: n })),
        ),
        deptGrid(g),
      ),
    ),
    update: (n) => h.setTimer(n.timer),
  };
}

function buildAudit(s) {
  const g = s.game;
  const a = g.audit;
  const h = header(g, a.survived ? "FINAL AUDIT: CPI SURVIVED" : "FINAL AUDIT: TOTAL COLLAPSE", s.timer);
  const award = (title, body) => (body ? el("div", { class: "bc-award" }, el("span", { class: "eyebrow", text: title }), el("p", { text: body })) : null);
  return {
    node: el(
      "div",
      { class: "bc" },
      h.node,
      el(
        "div",
        { class: "bc-audit" },
        el(
          "table",
          { class: "bc-table" },
          el("thead", {}, el("tr", {}, ["Department", "Agent", "Status", "Hidden priority", "Funded", "Final bonus"].map((t) => el("th", { text: t })))),
          el(
            "tbody",
            {},
            a.rows.map((r) =>
              el(
                "tr",
                {},
                el("td", { text: `${r.glyph} ${r.name}` }),
                el("td", { text: r.player }),
                el("td", { text: r.health }),
                el("td", {}, el("span", { class: `stamp ${r.objectiveMet ? "ok" : "muted"}`, text: r.objectiveMet ? "MET" : "MISSED" }), " ", r.objective),
                el("td", { text: `${r.funded}%` }),
                el("td", { text: `+${r.objectivePts + r.healthPts + r.groupPts}` }),
              ),
            ),
          ),
        ),
        el(
          "div",
          { class: "bc-awards" },
          award("CPI final stability", `${a.stability}% — ${a.survived ? "everyone gets the stability bonus" : "no stability bonus, hidden priorities halved"}`),
          award("Biggest budget disaster", a.disaster && `${a.disaster.title}: ${a.disaster.line}`),
          award("Best-funded department", a.bestFunded && `${a.bestFunded.name} (${a.bestFunded.funded}% of requests)`),
          award("Most underfunded department", a.worstFunded && `${a.worstFunded.name} (${a.worstFunded.funded}% of requests)`),
          award("Funniest consequence", a.funniest),
        ),
        scoreboardEl(rank(s.players)),
      ),
    ),
    update: (n) => h.setTimer(n.timer),
  };
}

const BUILDERS = {
  BRIEFING: buildBriefing,
  NEGOTIATE: buildNegotiate,
  VOTE: buildVote,
  VERDICT: buildVerdict,
  FORCED: buildForced,
  INCIDENTS: buildIncidents,
  CONSEQUENCES: buildConsequences,
  AUDIT: buildAudit,
};

export function render(mount, state) {
  const g = state.game;
  playNewCues(`budgetcuts:${state.code}`, g.cues ?? []);
  const build = BUILDERS[g.phase];
  if (!build) return;
  // The host has no inputs, so it simply rebuilds when anything on screen changes.
  const live = JSON.stringify([g.proposals, g.deals, g.lockedCount, g.votesCast, g.leadingId, g.depts.map((d) => d.allocated), g.stability]);
  mount(`budgetcuts:${g.phase}:${g.cycle}:${g.incidentIndex}:${g.voteAttempt}:${live}`, build, state);
}
