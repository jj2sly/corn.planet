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
      el("p", { class: "ea-brief-lead", text: `${g.lot.total} sealed bays. ${kernels(g.rules.startingKernels)} per agent. Everyone leaves with ${g.rules.entitiesPerPlayer}.` }),
      el(
        "ol",
        { class: "steps" },
        el("li", { text: "You bid on the bay, not the entity. Nobody knows what is inside until its door opens." }),
        el("li", { text: "Every entity carries a hidden buff or debuff. It stays sealed until the Action Round." }),
        el("li", { text: "Highest net worth wins: Kernels left plus the value of every entity you still hold." }),
      ),
    ),
    facilityEl(g.bays).node,
    agentsStrip(g),
  );
  return { node, update: (next) => head.set("Entity Auction · containment facility", "SEALED BAYS", next.timer) };
}

const LOT_TITLES = {
  BIDDING: (a) => `${bayLabel(a.bayId)} · ACTIVE AUCTION`,
  OPENING: () => "CONTAINMENT UNLOCKED",
  REVEALED: (a) => (a.entity ? `${a.entity.ref} RECOVERED` : "CONTENTS IDENTIFIED"),
};

function lotRows(g) {
  const a = g.active;
  const acquired = a.ownerName ?? "Unclaimed";
  const price = a.byLottery ? "No bids · issued free" : kernels(a.winningBid ?? 0);
  if (g.phase === "BIDDING") {
    return [
      ["Status", "SEALED", "alert"],
      ["Contents", "UNKNOWN"],
      ["Current bid", a.currentBid === null ? "NO BIDS" : kernels(a.currentBid), "big"],
      ["Highest bidder", a.highestBidder ?? "—"],
      ["Next bid", `at least ${kernels(a.minimumBid)}`],
    ];
  }
  if (g.phase === "OPENING") {
    return [
      ["Status", "UNLOCKING", "alert"],
      ["Contents", "IDENTIFYING…"],
      ["Acquired by", acquired, "big"],
      ["Winning bid", price],
    ];
  }
  const e = a.entity;
  return [
    ["Entity", `${e.ref} · ${e.title}`, "big"],
    ["Classification", e.classification, `class-${e.classification}`],
    ["Base value", kernels(e.baseValue)],
    ["Acquired by", acquired],
    ["Winning bid", price],
    ["Hidden modifier", "Sealed until the Action Round"],
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
    { class: "ea" },
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
      extra.textContent = ng.phase === "BIDDING" ? "Bid from your phone. Contents unknown." : ng.phase === "REVEALED" ? a.entity.summary : "";
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
      body: "Every hidden modifier no event triggered is revealed and takes effect now.",
      outcomes: g.audit,
    };
  }
  return {
    eyebrow: "Action Round",
    title: "ACTION ROUND",
    body:
      g.rules.eventCount > 0
        ? `Hidden modifiers are live. ${g.rules.eventCount} random events will hit the whole market: every agent, every entity, at once.`
        : "Hidden modifiers are live.",
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
    text.outcomes ? outcomeList(text.outcomes) : null,
    boardSlot,
  );
  return {
    node,
    update(next) {
      head.set(text.eyebrow, text.title, next.timer);
      boardSlot.replaceChildren(board(next.game));
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
