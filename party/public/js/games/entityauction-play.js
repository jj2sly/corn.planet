// Entity Auction on a phone: bid on the sealed bay, watch its door open, follow your collection
// through the Action Round, and see how your net worth adds up. The server validates every bid;
// the buttons here only offer amounts it is likely to accept.

import { el, notice, ordinal, timerEl } from "../common.js";
import { bayEl, kernels, modifierBadge, outcomeList } from "./entityauction-bay.js";

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
  const labelNode = el("span", { class: "eyebrow", text: label });
  const slot = el("span", {}, timerEl(timer));
  const node = el("div", { class: "row spread" }, labelNode, slot);
  return {
    node,
    set(t, nextLabel = label) {
      labelNode.textContent = nextLabel;
      slot.replaceChildren(timerEl(t));
    },
  };
}

function rows(node, list) {
  node.replaceChildren(...list.flatMap(([label, value, cls]) => [el("dt", { text: label }), el("dd", { class: cls ?? "" }, value)]));
}

function collectionList(me) {
  if (!me.collection.length) return el("p", { class: "muted", text: "No entities yet." });
  return el(
    "ul",
    { class: "list ea-mine" },
    me.collection.map((h) =>
      el(
        "li",
        { class: h.active ? "" : "lost" },
        el("span", { class: "grow" }, el("strong", { class: "mono", text: h.ref }), " ", h.bayNumber === null ? `${h.title} (copy)` : h.title, " ", modifierBadge(h.modifier)),
        el("strong", { class: "mono", text: h.active ? kernels(h.value) : "LOST" }),
      ),
    ),
  );
}

/** Amounts worth offering as one-tap bids: the minimum, then a few bigger raises. */
function quickAmounts(a) {
  const base = a.currentBid ?? 0;
  const list = [a.minimumBid, base + 500, base + 1000, base + 2500].filter((v) => v >= a.minimumBid);
  return [...new Set(list)];
}

// ------------------------------------------------------------------ phases

function buildBriefing(s) {
  const g = s.game;
  const t = timerRow(s.timer, "Entity Auction");
  const node = el(
    "div",
    { class: "stack" },
    t.node,
    statusCard(
      "🔒",
      "SEALED BAYS AHEAD",
      `You have ${kernels(g.you.kernels)}. ${g.lot.total} bays, ${g.rules.entitiesPerPlayer} for each agent. Nobody knows what's inside until a door opens.`,
    ),
  );
  return { node, update: (next) => t.set(next.timer) };
}

function buildLot(s, tools) {
  const g = s.game;
  const label = (ng) => `Bay ${ng.lot.number} of ${ng.lot.total}`;
  const t = timerRow(s.timer, label(g));
  const door = bayEl(g.active, { size: "large" });
  const info = el("dl", { class: "ea-readout compact" });
  const note = el("p", { class: "notice" });
  const status = el("p", { class: "notice ok", role: "status" });
  const quick = el("div", { class: "bid-grid", role: "group", "aria-label": "Quick bids" });
  const amount = el("input", { id: "bidAmount", type: "number", inputmode: "numeric", min: "0", step: "100", autocomplete: "off" });
  const link = el("p");

  async function place(value) {
    if (!Number.isSafeInteger(value) || value < 0) return notice(note, "Enter a whole number of Kernels.", "error");
    notice(note, "");
    const result = await tools.request("game:input", { action: "bid", payload: { amount: value } });
    if (!result.ok) return notice(note, result.message, "error");
    amount.value = "";
  }

  const controls = el(
    "section",
    { class: "stack" },
    quick,
    el(
      "form",
      { class: "row", onsubmit: (e) => (e.preventDefault(), place(Number(amount.value))) },
      el("div", { class: "field grow" }, el("label", { for: "bidAmount", text: "Your own bid (Kernels)" }), amount),
      el("button", { class: "btn", type: "submit", text: "Bid" }),
    ),
  );

  const node = el("div", { class: "stack" }, t.node, door.node, el("section", { class: "panel quiet" }, info), status, controls, note, link);

  let quickKey = null;
  let wasHighest = false;

  return {
    node,
    update(next) {
      const ng = next.game;
      const a = ng.active;
      const me = ng.you;
      if (!a || !me) return;
      t.set(next.timer, label(ng));
      door.update(a);
      door.setCountdown(ng.phase === "BIDDING" ? next.timer : null);
      const mine = a.ownerId === me.playerId;
      const bidding = ng.phase === "BIDDING";
      controls.hidden = !bidding;

      if (bidding) {
        rows(info, [
          ["Status", "SEALED · SECURE", "alert"],
          ["Contents", "UNKNOWN"],
          ["Current bid", a.currentBid === null ? "NO BIDS" : kernels(a.currentBid), "big"],
          ["Highest bidder", a.highestBidder ? (me.isHighest ? "YOU" : a.highestBidder) : "—"],
          ["Your Kernels", kernels(me.kernels)],
        ]);
        status.textContent = me.isHighest
          ? "You hold the highest bid. Hold your nerve."
          : me.slotsLeft === 0
            ? "Your collection is full. Watch the doors."
            : me.kernels < a.minimumBid
              ? "Not enough Kernels to beat the current bid."
              : "";
        if (wasHighest && !me.isHighest && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(80);
        wasHighest = me.isHighest;
        amount.min = String(a.minimumBid);
        amount.max = String(me.kernels);
        amount.placeholder = `${a.minimumBid} or more`;

        // Rebuilt only when the offers change, so a tap isn't lost to an unrelated update.
        const amounts = quickAmounts(a);
        const allIn = me.kernels > Math.max(...amounts) && me.kernels >= a.minimumBid;
        const key = `${amounts}|${me.kernels}|${me.canBid}`;
        if (key !== quickKey) {
          quickKey = key;
          quick.replaceChildren(
            ...amounts.map((v, i) =>
              el(
                "button",
                { class: "vote-option bid-option", type: "button", disabled: !me.canBid || v > me.kernels, onclick: () => place(v) },
                el("span", { class: "letter", text: i === 0 ? "Minimum" : "Raise" }),
                `BID ${kernels(v)}`,
              ),
            ),
            allIn
              ? el(
                  "button",
                  { class: "vote-option bid-option all-in", type: "button", disabled: !me.canBid, onclick: () => place(me.kernels) },
                  el("span", { class: "letter", text: "Everything" }),
                  `ALL IN ${kernels(me.kernels)}`,
                )
              : null,
          );
        }
      } else if (ng.phase === "OPENING") {
        rows(info, [
          ["Status", "UNLOCKING", "alert"],
          ["Acquired by", mine ? "YOU" : (a.ownerName ?? "Unclaimed"), "big"],
          ["Winning bid", a.byLottery ? "No bids · issued free" : kernels(a.winningBid ?? 0)],
        ]);
        status.textContent = mine ? "It's yours. Whatever it is." : "";
      } else {
        const e = a.entity;
        rows(info, [
          ["Entity", `${e.ref} · ${e.title}`, "big"],
          ["Classification", e.classification, `class-${e.classification}`],
          ["Base value", kernels(e.baseValue)],
          ["Acquired by", mine ? "YOU" : (a.ownerName ?? "Unclaimed")],
          ["Winning bid", a.byLottery ? "No bids · issued free" : kernels(a.winningBid ?? 0)],
        ]);
        status.textContent = mine ? "Its hidden modifier stays sealed until the Action Round." : "";
        if (!link.firstChild) {
          link.append(el("a", { class: "reference-id", href: e.url, target: "_blank", rel: "noopener noreferrer" }, `${e.ref} — inspect the record →`));
        }
      }
    },
  };
}

function buildAction(s) {
  const g = s.game;
  const me = g.you;
  const title = g.phase === "EVENT" ? g.event.name : g.phase === "AUDIT" ? "MODIFIERS REVEALED" : "ACTION ROUND";
  const label = g.phase === "EVENT" ? `Event ${g.event.number} of ${g.event.total}` : "Action Round";
  const body =
    g.phase === "EVENT" ? g.event.description : g.phase === "AUDIT" ? "Every modifier no event triggered takes effect now." : "Hidden modifiers are live. Watch the host screen.";
  const outcomes = (g.phase === "EVENT" ? g.event.outcomes : g.phase === "AUDIT" ? g.audit : []).filter((o) => o.playerName === null || o.playerName === me.name);
  const t = timerRow(s.timer, label);
  const totals = el("dl", { class: "ea-readout compact" });
  const collection = el("div");
  const node = el(
    "div",
    { class: "stack" },
    t.node,
    el("div", { class: "ea-event" }, el("h2", { text: title }), el("p", { text: body })),
    outcomes.length ? el("section", { class: "stack" }, el("p", { class: "eyebrow", text: "What changed for you" }), outcomeList(outcomes)) : null,
    el("section", { class: "panel quiet" }, totals),
    el("p", { class: "eyebrow", text: "Your collection" }),
    collection,
  );
  return {
    node,
    update(next) {
      const you = next.game.you;
      t.set(next.timer, label);
      rows(totals, [
        ["Kernels", kernels(you.kernels)],
        ["Net worth", kernels(you.netWorth), "big"],
      ]);
      collection.replaceChildren(collectionList(you));
    },
  };
}

function buildTally(s) {
  const g = s.game;
  const me = g.you;
  const placement = 1 + g.standings.filter((a) => a.netWorth > me.netWorth).length;
  const t = timerRow(s.timer, "Final net worth");
  const sum = el("dl", { class: "ea-readout compact" });
  rows(sum, [
    ["Remaining Kernels", kernels(me.kernels)],
    ...me.collection.map((h) => [`${h.ref}${h.bayNumber === null ? " (copy)" : ""}`, h.active ? kernels(h.value) : "LOST"]),
    ["Entity value", kernels(me.entityValue)],
    ["Final net worth", kernels(me.netWorth), "big"],
  ]);
  const node = el(
    "div",
    { class: "stack" },
    t.node,
    el("div", { class: "big-status" }, el("div", { class: "placement", text: ordinal(placement) }), el("h2", { text: kernels(me.netWorth) })),
    el("section", { class: "panel quiet" }, sum),
  );
  return { node, update: (next) => t.set(next.timer) };
}

export function render(mount, state, tools) {
  const g = state.game;
  if (!g.you) return;
  switch (g.phase) {
    case "BRIEFING":
      return mount("ea:briefing", buildBriefing, state);
    case "BIDDING":
    case "OPENING":
    case "REVEALED":
      return mount(`ea:lot:${g.lot.number}`, (s) => buildLot(s, tools), state);
    case "ACTION_INTRO":
    case "EVENT":
    case "AUDIT":
      return mount(`ea:${g.phase}:${g.event?.number ?? 0}`, buildAction, state);
    case "TALLY":
      return mount("ea:tally", buildTally, state);
  }
}
