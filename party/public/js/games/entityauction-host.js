// Entity Auction on the big screen: the containment facility, the bay under the hammer, the door
// reveal, the Action Round and the final net-worth tally. Every value comes from the server;
// this file only draws it. The doors themselves live in entityauction-bay.js.

import { el, ordinal, timerEl } from "../common.js";
import { bayEl, bayLabel, facilityEl, kernels, modifierBadge, outcomeList } from "./entityauction-bay.js";

function header(eyebrow, title, timer) {
  const eyebrowNode = el("p", { class: "eyebrow", text: eyebrow });
  const titleNode = el("h1", { text: title });
  const timerSlot = el("div", {}, timerEl(timer));
  const node = el("div", { class: "phase-head" }, el("div", {}, eyebrowNode, titleNode), timerSlot);
  return {
    node,
    set(nextEyebrow, nextTitle, nextTimer) {
      eyebrowNode.textContent = nextEyebrow;
      titleNode.textContent = nextTitle;
      timerSlot.replaceChildren(timerEl(nextTimer));
    },
  };
}

/** Label/value rows. rows: [label, value, className?] */
function readoutRows(node, rows) {
  node.replaceChildren(...rows.flatMap(([label, value, cls]) => [el("dt", { text: label }), el("dd", { class: cls ?? "" }, value)]));
}

function agentsStrip(g) {
  const per = g.rules.entitiesPerPlayer;
  return el(
    "ul",
    { class: "ea-agents", "aria-label": "Agents" },
    g.agents.map((a) =>
      el(
        "li",
        { class: a.left ? "left" : "" },
        el("span", { class: "name", text: a.name }),
        el("span", { class: "mono", text: kernels(a.kernels) }),
        el("span", { class: "muted mono", text: `${per - a.slotsLeft}/${per}` }),
      ),
    ),
  );
}

function holdingRow(h) {
  const trend = h.value > h.baseValue ? "up" : h.value < h.baseValue ? "down" : "";
  return el(
    "li",
    { class: h.active ? "" : "lost" },
    el("span", { class: "mono", text: h.ref }),
    el("span", { class: "grow", text: h.bayNumber === null ? `${h.title} (copy)` : h.title }),
    modifierBadge(h.modifier),
    el("span", { class: `mono ${trend}`.trim(), text: h.active ? kernels(h.value) : "LOST" }),
  );
}

function board(g) {
  return el(
    "div",
    { class: "ea-board" },
    g.agents.map((a) =>
      el(
        "section",
        { class: `ea-agent ${a.left ? "left" : ""}`.trim() },
        el("header", {}, el("strong", { text: a.name }), el("span", { class: "mono", text: kernels(a.netWorth) })),
        el("p", { class: "muted mono", text: `${kernels(a.kernels)} in hand · ${kernels(a.entityValue)} in entities` }),
        el("ul", { class: "ea-holdings" }, a.collection.map(holdingRow)),
      ),
    ),
  );
}

/** The audit reveals many modifiers: they land one after another instead of all at once. */
function staggered(list, on) {
  if (on) [...list.children].forEach((li, i) => { li.classList.add("ea-stagger"); li.style.animationDelay = `${Math.min(i * 0.45, 8)}s`; });
  return list;
}

/** Agents ranked by net worth, one line each. */
function worthStrip(g) {
  const ranked = [...g.agents].sort((a, b) => b.netWorth - a.netWorth);
  return el(
    "ol",
    { class: "ea-agents ea-worth-strip", "aria-label": "Net worth" },
    ranked.map((a) => el("li", { class: a.left ? "left" : "" }, el("span", { class: "name", text: a.name }), el("span", { class: "mono", text: kernels(a.netWorth) }))),
  );
}

// ------------------------------------------------------------------ phases

function buildBriefing(s) {
  const g = s.game;
  const head = header("Entity Auction · containment facility", "SEALED BAYS", s.timer);
  const node = el(
    "div",
    { class: "ea" },
    head.node,
    el(
      "div",
      { class: "panel ea-brief" },
      el("p", { class: "ea-brief-lead", text: `${g.lot.total} bays · ${kernels(g.rules.startingKernels)} each · win ${g.rules.entitiesPerPlayer}` }),
      el(
        "ol",
        { class: "steps" },
        el("li", { text: "Bid on sealed bays." }),
        el("li", { text: "Each entity hides a buff or debuff." }),
        el("li", { text: "Most net worth wins." }),
      ),
    ),
    facilityEl(g.bays).node,
    agentsStrip(g),
  );
  return { node, update: (next) => head.set("Entity Auction · containment facility", "SEALED BAYS", next.timer) };
}

const LOT_TITLES = {
  BIDDING: (a) => `${bayLabel(a.bayId)} · BID NOW`,
  OPENING: () => "BIDDING CLOSED",
  REVEALED: () => "ENTITY REVEALED",
};

function lotRows(g) {
  const a = g.active;
  const acquired = a.ownerName ?? "Unclaimed";
  const price = a.byLottery ? "No bids · issued free" : kernels(a.winningBid ?? 0);
  if (g.phase === "BIDDING") {
    return [
      ["Current bid", a.currentBid === null ? "NO BIDS" : kernels(a.currentBid), "big"],
      ["Leader", a.highestBidder ?? "—", "big"],
    ];
  }
  if (g.phase === "OPENING") {
    return [
      ["Won by", acquired, "big"],
      ["Paid", price],
    ];
  }
  const e = a.entity;
  return [
    ["Entity", `${e.ref} · ${e.title}`, "big"],
    ["Worth", `${kernels(e.baseValue)} · ${e.classification}`, `class-${e.classification}`],
    ["Owner", `${acquired} · paid ${price}`],
  ];
}

function buildLot(s) {
  const g = s.game;
  const head = header("", "", s.timer);
  const door = bayEl(g.active, { size: "large" });
  const info = el("dl", { class: "ea-readout" });
  const log = el("ol", { class: "ea-bidlog", "aria-label": "Latest bids" });
  const extra = el("p", { class: "ea-summary" });
  const facility = facilityEl(g.bays);
  const agents = el("div");
  const node = el(
    "div",
    { class: "ea ea-show" },
    head.node,
    el("div", { class: "ea-lot" }, door.node, el("div", { class: "panel stack ea-panel" }, info, log, extra)),
    facility.node,
    agents,
  );

  return {
    node,
    update(next) {
      const ng = next.game;
      const a = ng.active;
      if (!a) return;
      door.update(a);
      door.setCountdown(ng.phase === "BIDDING" ? next.timer : null);
      facility.update(ng.bays);
      head.set(`Containment auction · bay ${ng.lot.number} of ${ng.lot.total}`, LOT_TITLES[ng.phase](a), next.timer);
      readoutRows(info, lotRows(ng));
      log.replaceChildren(
        ...(ng.phase === "BIDDING" ? a.recentBids.map((b, i) => el("li", { class: i === 0 ? "top" : "" }, el("span", { text: b.name }), el("span", { class: "mono", text: kernels(b.amount) }))) : []),
      );
      extra.textContent = ng.phase === "BIDDING" ? `Next bid ${kernels(a.minimumBid)}+` : ng.phase === "REVEALED" ? a.entity.summary : "";
      node.dataset.phase = ng.phase;
      agents.replaceChildren(agentsStrip(ng));
    },
  };
}

function actionText(g) {
  if (g.phase === "EVENT") {
    return { eyebrow: `Action Round · event ${g.event.number} of ${g.event.total}`, title: g.event.name, body: g.event.description, outcomes: g.event.outcomes };
  }
  if (g.phase === "AUDIT") {
    return {
      eyebrow: "Action Round · final containment audit",
      title: "MODIFIERS REVEALED",
      body: "Hidden buffs and debuffs hit now.",
      outcomes: g.audit,
    };
  }
  return {
    eyebrow: "Action Round",
    title: "ACTION ROUND",
    body: g.rules.eventCount > 0 ? `${g.rules.eventCount} events. Each hits everyone.` : "Hidden modifiers are live.",
    outcomes: null,
  };
}

function buildAction(s) {
  const text = actionText(s.game);
  const head = header(text.eyebrow, text.title, s.timer);
  const boardSlot = el("div");
  const node = el(
    "div",
    { class: "ea" },
    head.node,
    el("div", { class: `ea-event ${s.game.phase === "EVENT" ? "alarm" : ""}`.trim() }, el("p", { text: text.body })),
    text.outcomes ? staggered(outcomeList(text.outcomes), s.game.phase === "AUDIT") : null,
    boardSlot,
  );
  return {
    node,
    update(next) {
      head.set(text.eyebrow, text.title, next.timer);
      // Full holdings only at the audit, when they matter; events just show the running order.
      boardSlot.replaceChildren(next.game.phase === "AUDIT" ? board(next.game) : worthStrip(next.game));
    },
  };
}

function buildTally(s) {
  const g = s.game;
  const head = header("Final net worth", "THE BOOKS ARE CLOSED", s.timer);
  const rows = g.standings.map((a) => {
    const placement = 1 + g.standings.filter((o) => o.netWorth > a.netWorth).length;
    return el(
      "tr",
      { class: placement === 1 ? "first" : "" },
      el("td", { class: "mono", text: ordinal(placement) }),
      el("th", { scope: "row", text: a.left ? `${a.name} (left)` : a.name }),
      el("td", { class: "mono", text: kernels(a.kernels) }),
      el(
        "td",
        {},
        el(
          "ul",
          { class: "ea-holdings" },
          a.collection.map((h) =>
            el(
              "li",
              { class: h.active ? "" : "lost" },
              el("span", { class: "mono", text: h.bayNumber === null ? `${h.ref} (copy)` : h.ref }),
              el("span", { class: "mono", text: h.active ? kernels(h.value) : "LOST" }),
            ),
          ),
        ),
      ),
      el("td", { class: "mono", text: kernels(a.entityValue) }),
      el("td", { class: "mono ea-worth", text: kernels(a.netWorth) }),
    );
  });
  const node = el(
    "div",
    { class: "ea" },
    head.node,
    el(
      "div",
      { class: "table-wrap" },
      el(
        "table",
        { class: "ea-tally" },
        el(
          "thead",
          {},
          el("tr", {}, ...["", "Agent", "Kernels left", "Entities", "+ Entity value", "= Net worth"].map((t) => el("th", { scope: "col", text: t }))),
        ),
        el("tbody", {}, rows),
      ),
    ),
  );
  return { node, update: (next) => head.set("Final net worth", "THE BOOKS ARE CLOSED", next.timer) };
}

export function render(mount, state) {
  const g = state.game;
  switch (g.phase) {
    case "BRIEFING":
      return mount("ea:briefing", buildBriefing, state);
    case "BIDDING":
    case "OPENING":
    case "REVEALED":
      // One mount per bay, so the same door stays on screen from bidding through the reveal.
      return mount(`ea:lot:${g.lot.number}`, buildLot, state);
    case "ACTION_INTRO":
    case "EVENT":
    case "AUDIT":
      return mount(`ea:${g.phase}:${g.event?.number ?? 0}`, buildAction, state);
    case "TALLY":
      return mount("ea:tally", buildTally, state);
  }
}
