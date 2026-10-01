// The group tutorial (server/games/tutorial.ts) on the big screen and on phones. One card at a time:
// a big question, a line or two, progress dots. The host can page on or skip it; phones tap
// "Got it". A phone that has seen this game's tutorial before taps "Got it" by itself, so the
// tutorial only waits for agents who are new to the game.

import { el, store, timerEl } from "../common.js";

const seenKey = (gameId) => `cpi-party:tutorial-seen:${gameId}`;
const autoSent = new Set();
const watched = new Set();

function dots(t) {
  return el("div", { class: "pt-dots", "aria-hidden": "true" }, t.steps.map((_, i) => el("span", { class: i === t.index ? "on" : i < t.index ? "done" : "" })));
}

function card(t, big) {
  return el(
    "div",
    { class: `pt-card ${big ? "big" : ""}` },
    el("span", { class: "pt-glyph", "aria-hidden": "true", text: t.step.glyph }),
    el("p", { class: "eyebrow", text: `How to play · ${t.index + 1} of ${t.total}` }),
    el("h2", { class: "pt-ask", text: t.step.ask }),
    el("ul", { class: "pt-lines" }, t.step.lines.map((l) => el("li", { text: l }))),
    dots(t),
  );
}

/** Host screen. `title` is the game's name. */
export function renderHostTutorial(mount, state, { hostRequest, title }) {
  const t = state.game.tutorial;
  mount(`tutorial:${state.config.gameId}:${t.index}:${t.readyCount}`, (s) => {
    const slot = el("span", {}, timerEl(s.timer));
    return {
      node: el(
        "div",
        { class: "pt" },
        el("div", { class: "row spread" }, el("p", { class: "eyebrow", text: `${title} · first time? Read along. Everyone else: tap “Got it” on your phone.` }), slot),
        card(t, true),
        el(
          "div",
          { class: "row pt-actions" },
          el("span", { class: "muted", text: `Ready: ${t.readyCount}/${t.players}` }),
          el("button", { class: "btn ghost", type: "button", text: "Next ▸", onclick: () => hostRequest("skip") }),
          el("button", { class: "btn", type: "button", text: "Skip tutorial ⏭", onclick: () => hostRequest("skipTutorial") }),
        ),
      ),
      update: (n) => slot.replaceChildren(timerEl(n.timer)),
    };
  }, state);
}

/** Phone. Remembers that this device has seen the tutorial for this game. */
export function renderPhoneTutorial(mount, state, tools) {
  const gameId = state.config.gameId;
  const t = state.game.tutorial;
  const send = () => tools.request("game:input", { action: "tutorialReady", payload: {} });
  const once = `${state.code}:${gameId}`;
  watched.add(gameId);
  if (!t.ready && store.get("localStorage", seenKey(gameId)) === true && !autoSent.has(once)) {
    autoSent.add(once);
    send();
  }
  mount(`tutorial:${gameId}:${t.index}:${t.ready}`, () => ({
    node: el(
      "div",
      { class: "stack pt-phone" },
      card(t, false),
      t.ready
        ? el("p", { class: "notice ok", text: `You're ready. Waiting for the others (${t.readyCount}/${t.players})…` })
        : el("button", {
            class: "btn big",
            type: "button",
            text: "GOT IT ✓",
            onclick: () => {
              store.set("localStorage", seenKey(gameId), true);
              send();
            },
          }),
    ),
  }), state);
}

/** Call on every render: once a game is past its tutorial, this device counts as having seen it. */
export function rememberTutorialSeen(state) {
  const gameId = state.config.gameId;
  if (state.game?.phase === "TUTORIAL") return;
  autoSent.clear();
  if (watched.has(gameId)) store.set("localStorage", seenKey(gameId), true);
}
