// Host screen: creates or resumes a session, runs the lobby, shows the game and results.

import { $, announce, createMount, el, flavorLine, loadConfig, notice, plural, scoreboardEl, startCountdowns, store } from "./common.js";
import { connect } from "./connection.js";
import * as chaos from "./games/chaos-host.js";

const RENDERERS = { chaos };
const SESSION_KEY = "cpst-party:host";

const stage = $("#stage");
const mount = createMount(stage);
let config = null;
let conn = null;
let state = null;
let session = store.get("sessionStorage", SESSION_KEY);
let lastStatus = null;

function saveSession(value) {
  session = value;
  if (value) {
    store.set("sessionStorage", SESSION_KEY, value);
    store.set("localStorage", SESSION_KEY, value);
  } else {
    store.remove("sessionStorage", SESSION_KEY);
    store.remove("localStorage", SESSION_KEY);
  }
}

function joinUrl() {
  return `${location.host}/play`;
}

function setBanner(node) {
  $("#banner").replaceChildren(...(node ? [node] : []));
}

// ------------------------------------------------------------------ connection

async function init() {
  startCountdowns();
  setInterval(() => ($("#ticker").textContent = flavorLine()), 9000);
  try {
    config = await loadConfig();
  } catch {
    stage.replaceChildren(el("div", { class: "banner danger", text: "Can't reach the CPST Party server. Refresh to try again." }));
    return;
  }
  conn = await connect({ onState, onEnded, onStatus });
}

async function onStatus(status) {
  $("#connStatus").textContent = status === "connected" ? "SECURE LINK ESTABLISHED" : "SIGNAL LOST — RECONNECTING…";
  if (status !== "connected") {
    setBanner(el("div", { class: "banner danger", role: "alert", text: "Connection to the CPST Party server lost. Reconnecting…" }));
    return;
  }
  setBanner(null);
  await attach();
}

async function attach() {
  if (session) {
    const resumed = await conn.request("host:resume", session);
    if (resumed.ok) return;
    saveSession(null);
  }
  const previous = store.get("localStorage", SESSION_KEY);
  if (previous) return showResumeChoice(previous);
  await createSession();
}

async function createSession() {
  barStatus = null;
  stage.replaceChildren(el("p", { class: "boot", text: "OPENING CLASSIFIED PARTY SESSION..." }));
  const created = await conn.request("host:create");
  if (created.ok) {
    saveSession({ code: created.code, hostKey: created.hostKey });
    return;
  }
  lastStatus = null;
  stage.replaceChildren(
    el(
      "div",
      { class: "panel stack" },
      el("h1", { text: "SESSION COULD NOT BE OPENED" }),
      el("p", { text: created.message }),
      el("button", { class: "btn", type: "button", text: "Try again", onclick: createSession }),
    ),
  );
}

function showResumeChoice(previous) {
  lastStatus = null;
  const note = el("p", { class: "notice" });
  stage.replaceChildren(
    el(
      "div",
      { class: "panel stack shell narrow" },
      el("h1", { text: "PREVIOUS SESSION FOUND" }),
      el("p", {}, "This screen was hosting session ", el("strong", { class: "mono", text: previous.code }), ". Resume it, or open a new one."),
      el(
        "div",
        { class: "row" },
        el("button", {
          class: "btn",
          type: "button",
          text: `Resume ${previous.code}`,
          onclick: async () => {
            const resumed = await conn.request("host:resume", previous);
            if (resumed.ok) return saveSession(previous);
            saveSession(null);
            notice(note, `${resumed.message} Opening a new session instead…`, "error");
            setTimeout(createSession, 1500);
          },
        }),
        el("button", { class: "btn ghost", type: "button", text: "Open new session", onclick: () => (saveSession(null), createSession()) }),
      ),
      note,
    ),
  );
}

function onEnded(info) {
  saveSession(null);
  state = null;
  lastStatus = null;
  $("#joinHint").hidden = true;
  $("#hostControls").replaceChildren();
  barStatus = null;
  stage.replaceChildren(
    el(
      "div",
      { class: "panel stack shell narrow" },
      el("h1", { text: "SESSION CLOSED" }),
      el("p", { text: info.message }),
      el("button", { class: "btn", type: "button", text: "Open a new session", onclick: createSession }),
    ),
  );
}

// ------------------------------------------------------------------ actions

async function act(event, payload, noticeTarget) {
  const result = await conn.request(event, payload);
  if (!result.ok) {
    if (noticeTarget) notice(noticeTarget, result.message, "error");
    else setBanner(el("div", { class: "banner danger", role: "alert", text: result.message }));
  }
  return result;
}

/** Skips only the phase currently on screen (a stale skip is silently ignored by the server). */
async function skip() {
  const result = await conn.request("game:host", { action: "skip", step: state?.step });
  if (!result.ok && result.error !== "PHASE_CLOSED") setBanner(el("div", { class: "banner danger", role: "alert", text: result.message }));
}

// ------------------------------------------------------------------ rendering

function onState(next) {
  state = next;
  if (state.status !== lastStatus) {
    announce(state.status === "LOBBY" ? "Lobby open" : state.status === "IN_GAME" ? "Operation started" : "Final debrief");
    lastStatus = state.status;
  }
  render();
}

function render() {
  $("#joinHint").hidden = false;
  $("#joinUrl").textContent = joinUrl();
  $("#barCode").textContent = state.code;
  renderBarControls();

  if (state.status === "LOBBY") return mount(`lobby:${state.code}`, buildLobby, state);
  if (state.status === "FINAL_RESULTS") return mount(`results:${state.code}:${JSON.stringify(state.results?.standings)}`, buildResults, state);
  const renderer = RENDERERS[state.config.gameId];
  if (renderer && state.game) renderer.render(mount, state);
}

let barStatus = null;
function renderBarControls() {
  // Rebuilt only when the room status changes, so keyboard focus survives live updates.
  if (barStatus === state.status) return;
  barStatus = state.status;
  const controls = $("#hostControls");
  const buttons = [];
  if (state.status === "IN_GAME") {
    buttons.push(
      el("button", { class: "btn ghost small", type: "button", text: "Skip ▸", title: "Advance to the next phase", onclick: () => skip() }),
      el("button", {
        class: "btn subtle small",
        type: "button",
        text: "End game",
        onclick: () => confirm("End this game and return everyone to the lobby? Scores from this game won't be saved.") && act("room:lobby"),
      }),
    );
  } else {
    buttons.push(
      el("button", {
        class: "btn subtle small",
        type: "button",
        text: "Close session",
        onclick: () => confirm("Close this session for everyone?") && act("room:close"),
      }),
    );
  }
  controls.replaceChildren(...buttons);
}

function agentCards(s, { kick = false } = {}) {
  const cards = s.players.map((p) =>
    el(
      "li",
      { class: `agent filled ${p.connected ? "" : "offline"}` },
      el("span", { class: "status-dot", "aria-hidden": "true" }),
      el("span", { class: "name", text: p.name }),
      p.id === s.leaderId ? el("span", { class: "stamp", text: "Leader" }) : null,
      p.connected ? null : el("span", { class: "stamp danger", text: "Signal lost" }),
      kick
        ? el("button", {
            class: "btn subtle small",
            type: "button",
            "aria-label": `Remove ${p.name}`,
            text: "✕",
            onclick: () => confirm(`Remove ${p.name} from the session?`) && act("room:kick", { playerId: p.id }),
          })
        : null,
    ),
  );
  for (let i = s.players.length; i < s.maxPlayers; i++) {
    cards.push(el("li", { class: "agent empty", text: "AWAITING AGENT" }));
  }
  return cards;
}

function choiceGroup(legend, name, options, current, onChange) {
  return el(
    "fieldset",
    {},
    el("legend", { text: legend }),
    el(
      "div",
      { class: "choices" },
      options.map(([value, label]) =>
        el(
          "label",
          { class: "choice" },
          el("input", { type: "radio", name, value: String(value), checked: String(current) === String(value), onchange: () => onChange(value) }),
          el("span", { text: label }),
        ),
      ),
    ),
  );
}

const CONTENT_LABELS = {
  safe: ["Safe", "General silly humor only."],
  chaos: ["Chaos", "Adds the edgier, more absurd friend-group prompts."],
  custom: ["Custom", "Only prompts written by your group's accounts, safe and chaos."],
};

/** A heads-up on the host screen when the prompt library is too small for good games. */
function libraryWarning() {
  const node = el("p", { class: "banner", role: "status", hidden: true });
  let counts = null;
  let mode = null;
  const show = () => {
    if (!counts || !mode) return;
    const safeOnly = mode === "safe";
    const n = safeOnly ? counts.safe : counts.total;
    const kind = safeOnly ? "safe prompts" : "prompts";
    node.hidden = n >= 20;
    node.textContent =
      n === 0
        ? `The prompt library has no ${kind} yet, so games will use a few placeholder incidents. Logged-in agents can add prompts at ${location.host}/prompts.`
        : `Only ${n} ${kind} in the library, so incidents will repeat. Add more at ${location.host}/prompts.`;
  };
  // Fresh counts (not the cached page config), since prompts may have been added since this page loaded.
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => ((counts = c.promptCounts), show()))
    .catch(() => {});
  return { node, update: (nextMode) => ((mode = nextMode), show()) };
}

function buildLobby(s) {
  const grid = el("ul", { class: "agent-grid", "aria-label": "Agents in this session" });
  const count = el("span");
  const leader = el("p", { class: "muted" });
  const settingsBox = el("div", { class: "settings-grid" });
  const start = el("button", { class: "btn big", type: "button", text: "Start operation", onclick: () => act("room:start", {}, startNote) });
  const startNote = el("p", { class: "notice" });
  const library = libraryWarning();
  const game = config.games.find((g) => g.id === s.config.gameId) ?? config.games[0];

  const node = el(
    "div",
    { class: "lobby" },
    el(
      "section",
      { class: "stack" },
      el("p", { class: "eyebrow", text: "Classified party session · access code" }),
      el("div", { class: "big-code", "aria-label": `Session code ${s.code.split("").join(" ")}`, text: s.code }),
      el(
        "ol",
        { class: "steps" },
        el("li", {}, "On your phone, open ", el("strong", { class: "mono", text: joinUrl() })),
        el("li", {}, "Enter code ", el("strong", { class: "mono", text: s.code }), " and your agent name"),
        el("li", { text: "The first agent to join is session leader and can start from their phone." }),
      ),
      location.hostname === "localhost" || location.hostname === "127.0.0.1"
        ? el("p", { class: "banner", text: "Phones can't open “localhost”. Open this page using this computer's network address (shown in the server console) so the join link works." })
        : null,
      el("h2", {}, "Agents ", count),
      grid,
      leader,
    ),
    el(
      "section",
      { class: "panel stack" },
      el("h2", { text: "Select operation" }),
      el(
        "div",
        { class: "game-card" },
        el("h3", { text: game.name }),
        el("p", { class: "muted", text: game.tagline }),
        el("p", { text: game.description }),
        el("p", { class: "mono", text: `${game.minPlayers}–${game.maxPlayers} agents` }),
      ),
      settingsBox,
      library.node,
      start,
      startNote,
    ),
  );

  return {
    node,
    update(next) {
      grid.replaceChildren(...agentCards(next, { kick: true }));
      count.textContent = `(${next.players.length}/${next.maxPlayers})`;
      library.update(next.config.contentMode);
      const leaderPlayer = next.players.find((p) => p.id === next.leaderId);
      leader.textContent = leaderPlayer ? `Session leader: ${leaderPlayer.name}` : "Waiting for the first agent…";

      // Rebuild settings only when they changed, so keyboard focus isn't lost on every update.
      const signature = JSON.stringify(next.config);
      if (settingsBox.dataset.signature !== signature) {
        const focusedName = document.activeElement?.name;
        settingsBox.dataset.signature = signature;
        const settings = next.config.settings;
        const configure = (patch) => act("room:configure", patch, startNote);
        settingsBox.replaceChildren(
          choiceGroup("Paired rounds", "rounds", [[1, "1"], [2, "2"], [3, "3"]], settings.rounds, (v) => configure({ settings: { rounds: v } })),
          choiceGroup(
            "Final round",
            "totalBreach",
            [[true, "Total Breach"], [false, "None"]],
            settings.totalBreach,
            (v) => configure({ settings: { totalBreach: v } }),
          ),
          choiceGroup("Report time", "answerSeconds", [[60, "60s"], [90, "90s"], [120, "120s"]], settings.answerSeconds, (v) =>
            configure({ settings: { answerSeconds: v } }),
          ),
          choiceGroup("Vote time", "voteSeconds", [[15, "15s"], [25, "25s"], [40, "40s"]], settings.voteSeconds, (v) =>
            configure({ settings: { voteSeconds: v } }),
          ),
          choiceGroup(
            "Humor level",
            "contentMode",
            config.contentModes.map((m) => [m, CONTENT_LABELS[m][0]]),
            next.config.contentMode,
            (v) => configure({ contentMode: v }),
          ),
          el("p", { class: "hint", text: CONTENT_LABELS[next.config.contentMode][1] }),
        );
        if (focusedName) settingsBox.querySelector(`input[name="${focusedName}"]:checked`)?.focus();
      }

      const connected = next.players.filter((p) => p.connected).length;
      const needed = game.minPlayers - connected;
      start.disabled = needed > 0;
      start.textContent = needed > 0 ? `Need ${plural(needed, "more agent")}` : "Start operation";
    },
  };
}

function buildResults(s) {
  const results = s.results;
  const note = el("p", { class: "notice" });
  const node = el(
    "div",
    { class: "stack" },
    el("p", { class: "eyebrow", text: `${results.gameName} · ${plural(results.rounds, "round")} · operation complete` }),
    el("h1", { class: "flicker", text: "FINAL DEBRIEF" }),
    scoreboardEl(results.standings.map((st) => ({ ...st, note: st.left ? "Left" : null }))),
    results.highlights.length
      ? el(
          "div",
          { class: "highlights" },
          results.highlights.map((h) =>
            el(
              "div",
              { class: "panel quiet" },
              el("p", { class: "eyebrow", text: h.title }),
              h.text ? el("p", { class: "quote", text: `“${h.text}”` }) : null,
              h.playerName ? el("p", {}, el("strong", { text: h.playerName })) : null,
              el("p", { class: "muted", text: h.detail }),
            ),
          ),
        )
      : null,
    el(
      "div",
      { class: "row" },
      el("button", { class: "btn", type: "button", text: "Replay", onclick: () => act("room:start", {}, note) }),
      el("button", { class: "btn ghost", type: "button", text: "Return to lobby", onclick: () => act("room:lobby", {}, note) }),
    ),
    note,
  );
  return { node };
}


init();
