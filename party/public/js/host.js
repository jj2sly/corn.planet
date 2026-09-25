// Host screen: creates or resumes a session, runs the lobby, shows the game and results.

import { $, announce, createMount, el, flavorLine, loadConfig, notice, plural, scoreboardEl, startCountdowns, store } from "./common.js";
import { connect } from "./connection.js";
import * as chaos from "./games/chaos-host.js";
import * as cornorshit from "./games/cornorshit-host.js";
import * as entityauction from "./games/entityauction-host.js";
import * as mycob from "./games/mycob-host.js";
import * as steamdeck from "./games/steamdeck-host.js";

const RENDERERS = { chaos, cornorshit, entityauction, mycob, steamdeck };
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
    stage.replaceChildren(el("div", { class: "banner danger", text: "Can't reach the Corn Planet Party server. Refresh to try again." }));
    return;
  }
  conn = await connect({ onState, onEnded, onStatus });
}

async function onStatus(status) {
  $("#connStatus").textContent = status === "connected" ? "SECURE LINK ESTABLISHED" : "SIGNAL LOST — RECONNECTING…";
  if (status !== "connected") {
    setBanner(el("div", { class: "banner danger", role: "alert", text: "Connection to the Corn Planet Party server lost. Reconnecting…" }));
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

/** Per-game lobby settings. A game with no entry here simply shows no settings. */
const SETTINGS_FORMS = {
  chaos(settings, configure, next) {
    return [
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
    ];
  },
  cornorshit(settings, configure) {
    return [
      choiceGroup("Rounds", "rounds", [[3, "3"], [5, "5"], [8, "8"]], settings.rounds, (v) => configure({ settings: { rounds: v } })),
      choiceGroup("Call time", "guessSeconds", [[15, "15s"], [25, "25s"], [40, "40s"]], settings.guessSeconds, (v) =>
        configure({ settings: { guessSeconds: v } }),
      ),
      el("p", { class: "hint", text: "Claims are drawn from the CPI Database. Nothing this game makes up is ever written back to it." }),
    ];
  },
  entityauction(settings, configure) {
    return [
      choiceGroup("Starting Kernels", "startingKernels", [[5000, "5,000"], [10000, "10,000"], [20000, "20,000"]], settings.startingKernels, (v) =>
        configure({ settings: { startingKernels: v } }),
      ),
      choiceGroup("Entities per agent", "entitiesPerPlayer", [[2, "2"], [3, "3"], [4, "4"]], settings.entitiesPerPlayer, (v) =>
        configure({ settings: { entitiesPerPlayer: v } }),
      ),
      choiceGroup("Time per bay", "auctionSeconds", [[20, "20s"], [30, "30s"], [45, "45s"]], settings.auctionSeconds, (v) =>
        configure({ settings: { auctionSeconds: v } }),
      ),
      choiceGroup("Action Round events", "eventCount", [[3, "3"], [5, "5"], [7, "7"]], settings.eventCount, (v) =>
        configure({ settings: { eventCount: v } }),
      ),
      el("p", {
        class: "hint",
        text: "Every bay holds a real CPI Database entity. Values, owners and modifiers exist for this game only; nothing is written back.",
      }),
    ];
  },
  mycob(settings, configure) {
    const catalog = config.games.find((g) => g.id === "mycob")?.catalog;
    if (!catalog) return [];
    const upcoming = catalog.modes.filter((m) => !m.available);
    const mode = catalog.modes.find((m) => m.id === settings.mode);
    const stages = [];
    for (let n = catalog.stages.min; n <= catalog.stages.max; n++) stages.push([n, String(n)]);
    return [
      choiceGroup(
        "Mode",
        "mode",
        catalog.modes.filter((m) => m.available).map((m) => [m.id, `${m.emoji} ${m.name}`]),
        settings.mode,
        (v) => configure({ settings: { mode: v } }),
      ),
      mode ? el("p", { class: "hint", text: mode.tagline }) : null,
      upcoming.length ? el("p", { class: "hint", text: `Coming later: ${upcoming.map((m) => `${m.emoji} ${m.name}`).join(" · ")}` }) : null,
      choiceGroup(
        "Length",
        "length",
        catalog.lengths.map((l) => [l.id, `${l.id[0].toUpperCase()}${l.id.slice(1)} (${l.stages} stages)`]),
        settings.length,
        (v) => configure({ settings: { length: v, stages: null } }),
      ),
      choiceGroup("Stages", "stages", stages, settings.stages, (v) => configure({ settings: { stages: v } })),
      el("p", {
        class: "hint",
        text: "The escaped entity is a real CPI Database record. Everything that happens to it, the facility and the staff is game-only; nothing is written back.",
      }),
    ];
  },
  steamdeck(settings, configure) {
    return [
      choiceGroup("Games", "rounds", [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], settings.rounds, (v) => configure({ settings: { rounds: v } })),
      el("p", { class: "hint", text: "One game per round, picked at random: Blockcraft, SLIM, Fire Kid & Ice Girl, Astro Blaster. The session leader is Thad first, then Thad rotates. Keyboard, mouse or touch." }),
    ];
  },
};

/**
 * A heads-up when the selected game has too little material: prompts for Cornlashing, CPI
 * Database records for the canon-driven games.
 */
function sourceWarning() {
  const node = el("p", { class: "banner", role: "status", hidden: true });
  let counts = null;
  let canon = null;
  let mode = null;
  let gameId = null;
  let room = null;

  const show = () => {
    node.classList.remove("danger");
    if (gameId === "entityauction") {
      if (!canon || !room) return;
      // Every bay needs its own entity; the server refuses to start rather than reuse one.
      const agents = room.players.length;
      const per = room.config.settings.entitiesPerPlayer;
      const needed = agents * per;
      const n = canon.entity;
      node.hidden = n > 0 && n >= needed;
      node.classList.toggle("danger", !node.hidden);
      node.textContent =
        n === 0
          ? "The CPI Database has no entities yet. Add some in the Records Division first."
          : `INSUFFICIENT CONTAINMENT MATERIAL — ${plural(agents, "agent")} × ${per} needs ${needed} sealed entities, but only ${n} are available. ` +
            "Lower “Entities per agent” or add entities in the Records Division.";
      return;
    }

    if (gameId === "mycob") {
      if (!canon) return;
      node.hidden = canon.entity > 0;
      node.classList.add("danger");
      node.textContent = "The CPI Database has no entities yet, so nothing can escape. Add one in the Records Division first.";
      return;
    }

    if (gameId === "chaos") {
      if (!counts || !mode) return;
      const safeOnly = mode === "safe";
      const n = safeOnly ? counts.safe : counts.total;
      const kind = safeOnly ? "safe prompts" : "prompts";
      node.hidden = n >= 20;
      node.textContent =
        n === 0
          ? `The prompt library has no ${kind} yet, so games will use a few placeholder incidents. Logged-in agents can add prompts at ${location.host}/prompts.`
          : `Only ${n} ${kind} in the library, so incidents will repeat. Add more at ${location.host}/prompts.`;
      return;
    }

    if (!canon) return;
    const n = canon.entity + canon.incident + canon.personnel;
    node.hidden = n >= 8;
    node.textContent =
      n === 0
        ? "The CPI Database has no records this game can use yet. Add entities in the Records Division first."
        : `Only ${plural(n, "CPI Database record")} available, so records will repeat. Add more in the Records Division.`;
  };

  // Fresh counts (not the cached page config), since records and prompts may have changed.
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => ((counts = c.promptCounts), (canon = c.canonCounts), show()))
    .catch(() => {});

  return {
    node,
    update: (nextGameId, nextMode, nextRoom) => ((gameId = nextGameId), (mode = nextMode), (room = nextRoom), show()),
  };
}

function buildLobby(s) {
  const grid = el("ul", { class: "agent-grid", "aria-label": "Agents in this session" });
  const count = el("span");
  const leader = el("p", { class: "muted" });
  const gameList = el("div", { class: "game-list", role: "group", "aria-label": "Available operations" });
  const gameCard = el("div", { class: "game-card" });
  const settingsBox = el("div", { class: "settings-grid" });
  const start = el("button", { class: "btn big", type: "button", text: "Start operation", onclick: () => act("room:start", {}, startNote) });
  const startNote = el("p", { class: "notice" });
  const source = sourceWarning();

  const gameFor = (state) => config.games.find((g) => g.id === state.config.gameId) ?? config.games[0];

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
      el("div", { class: "row spread" }, el("h2", {}, "Agents ", count), null),
      grid,
      leader,
    ),
    el(
      "section",
      { class: "panel stack" },
      el("h2", { text: "Select operation" }),
      gameList,
      gameCard,
      settingsBox,
      source.node,
      start,
      startNote,
    ),
  );

  return {
    node,
    update(next) {
      grid.replaceChildren(...agentCards(next, { kick: true }));
      count.textContent = `(${next.players.length}/${next.maxPlayers})`;
      const leaderPlayer = next.players.find((p) => p.id === next.leaderId);
      leader.textContent = leaderPlayer ? `Session leader: ${leaderPlayer.name}` : "Waiting for the first agent…";

      const game = gameFor(next);
      source.update(game.id, next.config.contentMode, next);

      // Rebuild the picker only when the selection changed, so a click isn't lost mid-press.
      if (gameList.dataset.selected !== game.id) {
        gameList.dataset.selected = game.id;
        gameList.replaceChildren(
          ...config.games.map((g) =>
            el("button", {
              class: `game-choice ${g.id === game.id ? "selected" : ""}`.trim(),
              type: "button",
              "aria-pressed": String(g.id === game.id),
              text: g.name,
              onclick: () => act("room:configure", { gameId: g.id }, startNote),
            }),
          ),
        );
        gameCard.replaceChildren(
          el("h3", { text: game.name }),
          el("p", { class: "muted", text: game.tagline }),
          el("p", { text: game.description }),
          el("p", { class: "mono", text: `${game.minPlayers}–${game.maxPlayers} agents` }),
        );
      }

      // Rebuild settings only when they changed, so keyboard focus isn't lost on every update.
      const signature = JSON.stringify(next.config);
      if (settingsBox.dataset.signature !== signature) {
        const focusedName = document.activeElement?.name;
        settingsBox.dataset.signature = signature;
        const configure = (patch) => act("room:configure", patch, startNote);
        const form = SETTINGS_FORMS[game.id];
        settingsBox.replaceChildren(...(form ? form(next.config.settings, configure, next) : []));
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
