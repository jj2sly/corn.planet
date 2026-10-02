// The final debrief on the host screen, the same frame for every game: the big outcome first (the
// team's result if the game has one, then the winner), the standings second, the game's highlights
// as case notes after that. It takes the game's own colours and cover, and reveals itself in a short
// stagger (party.css "final debrief"; none with prefers-reduced-motion). Nothing loops.

import { el, ordinal, plural } from "../common.js";
import { gameInfo } from "./library.js";
import { avatar, cover } from "./ui.js";

/**
 * A team result to lead with: the first highlight when it names nobody (Angry Thud's TEAM VICTORY,
 * Budget Cuts' fiscal year, Channel Cob's rating), or My Cob Escaped's ending.
 */
export function teamOutcome(results) {
  const first = results?.highlights?.[0];
  if (!first || first.playerName) return null;
  return !first.text || results.gameId === "mycob" ? first : null;
}

/** Who the headline names: { label, names, score } or null when nobody scored. */
export function headline(results, { outcome = teamOutcome(results) } = {}) {
  const standings = results?.standings ?? [];
  const top = standings.filter((st) => st.placement === 1);
  if (!top.length || top[0].score <= 0) return null;
  const tied = top.length > 1;
  const label = outcome ? (tied ? "TOP AGENTS" : "MVP") : tied && top.length === standings.length ? "DEAD HEAT" : tied ? "JOINT WINNERS" : "WINNER";
  return { label, top, score: top[0].score };
}

/**
 * The debrief for a room in FINAL_RESULTS. actions: { again(note), lobby(note), lobbyLabel }.
 * Returns { node } for the host's mount.
 */
export function buildDebrief(s, actions) {
  const results = s.results;
  const info = gameInfo(results.gameId);
  const standings = results.standings ?? [];
  const outcome = teamOutcome(results);
  const notes = outcome ? results.highlights.slice(1) : results.highlights;
  const head = headline(results, { outcome });
  const roomIndex = (st, i) => {
    const at = s.players.findIndex((p) => p.id === st.playerId);
    return at >= 0 ? at : i;
  };
  const max = Math.max(1, ...standings.map((st) => st.score));
  // Character sizes follow the TV's height (canvases take pixel sizes).
  const tall = globalThis.innerHeight || 720;
  const faceSize = Math.round(Math.min(170, Math.max(96, tall * 0.13)));
  const rowFace = standings.length > 5 ? Math.round(Math.max(28, tall * 0.034)) : Math.round(Math.max(36, tall * 0.044));
  let beat = 0; // the stagger: each part enters a little after the one before
  const enter = (node, delay) => (node.style.setProperty("--in", `${Math.round(delay)}ms`), node);

  const note = el("p", { class: "notice" });
  const kicker = [info?.title ?? results.gameName, plural(results.rounds, "round")].join(" · ");

  const outcomeNode = outcome
    ? enter(
        el(
          "section",
          { class: "debrief-outcome", "aria-label": "Outcome" },
          el("p", { class: "debrief-outcome-title", text: outcome.title }),
          outcome.text ? el("p", { class: "debrief-outcome-text", text: outcome.text }) : null,
          outcome.detail ? el("p", { class: "debrief-outcome-detail", text: outcome.detail }) : null,
        ),
        (beat += 120),
      )
    : null;

  const winnerNode = head
    ? enter(
        el(
          "section",
          { class: `debrief-winner ${head.top.length > 1 ? "tied" : ""}`.trim(), "aria-label": `${head.label}: ${head.top.map((t) => t.name).join(" and ")}` },
          el(
            "div",
            { class: "debrief-winner-faces", "aria-hidden": "true" },
            head.top.slice(0, 4).map((st) => el("span", { class: "debrief-face" }, avatar(st, roomIndex(st, standings.indexOf(st)), { size: head.top.length > 2 ? Math.round(faceSize * 0.7) : faceSize, state: "cheer" }))),
          ),
          el(
            "div",
            { class: "debrief-winner-body" },
            el("p", { class: "debrief-winner-label", text: head.label }),
            el("p", { class: "debrief-winner-name", text: head.top.map((t) => t.name).join(" & ") }),
            el("p", { class: "debrief-winner-score" }, el("strong", { text: head.score.toLocaleString() }), " POINTS"),
          ),
          el("span", { class: "debrief-stamp", "aria-hidden": "true", text: "COMMENDED" }),
        ),
        (beat += 140),
      )
    : null;

  beat += 260;
  const board = el(
    "ol",
    { class: `debrief-board ${standings.length > 5 ? "many" : ""}`.trim(), "aria-label": "Final standings" },
    standings.map((st, i) => {
      const bar = el("span", { class: "debrief-bar", "aria-hidden": "true" }, el("span"));
      bar.style.setProperty("--pct", `${Math.round((Math.max(0, st.score) / max) * 100)}%`);
      return enter(
        el(
          "li",
          { class: `${st.placement === 1 ? "first" : ""} ${st.left ? "left" : ""}`.trim() },
          el("span", { class: "debrief-rank", text: ordinal(st.placement) }),
          el("span", { class: "debrief-row-face", "aria-hidden": "true" }, avatar(st, roomIndex(st, i), { size: rowFace })),
          el("span", { class: "debrief-row-name" }, st.name, st.left ? el("span", { class: "stamp muted", text: "Left" }) : null),
          bar,
          el("span", { class: "debrief-row-score", text: st.score.toLocaleString() }),
        ),
        beat + i * 90,
      );
    }),
  );
  beat += standings.length * 90 + 120;

  const notesNode = notes.length
    ? el(
        "section",
        { class: "debrief-notes", "aria-label": "Highlights" },
        notes.map((h, i) =>
          enter(
            el(
              "article",
              { class: "debrief-note" },
              el("p", { class: "debrief-note-title", text: h.title }),
              h.text ? el("p", { class: "debrief-note-quote", text: `“${h.text}”` }) : null,
              h.playerName ? el("p", { class: "debrief-note-who", text: h.playerName }) : null,
              h.detail ? el("p", { class: "debrief-note-detail", text: h.detail }) : null,
            ),
            beat + i * 110,
          ),
        ),
      )
    : null;

  // The host's buttons sit in the header: always on screen, never the headline.
  const node = el(
    "div",
    { class: "debrief" },
    el(
      "header",
      { class: "debrief-head" },
      el("div", { class: "debrief-head-text" }, el("p", { class: "debrief-kicker", text: `OPERATION COMPLETE · ${kicker}` }), el("h1", { class: "debrief-title", text: "FINAL DEBRIEF" })),
      el(
        "div",
        { class: "debrief-actions" },
        el(
          "div",
          { class: "row" },
          el("button", { class: "btn", type: "button", text: "▶ Play again", onclick: () => actions.again(note) }),
          el("button", { class: "btn ghost", type: "button", text: `⌂ Back to ${actions.lobbyLabel}`, onclick: () => actions.lobby(note) }),
        ),
        note,
      ),
      info ? el("div", { class: "debrief-cover", "aria-hidden": "true" }, cover(info, { size: "card", label: false })) : null,
    ),
    el("div", { class: `debrief-main ${head || outcome ? "" : "board-only"}`.trim() }, head || outcome ? el("div", { class: "debrief-lead" }, outcomeNode, winnerNode) : null, board),
    notesNode,
  );
  if (info) {
    node.style.setProperty("--accent", info.art.accent);
    node.style.setProperty("--from", info.art.from);
  }
  return { node };
}
