// Host screen: creates or resumes a session, runs the lobby (Steam My Deck's hub, deck/hub.js),
// launches and shows the game, and the results.

import { $, announce, createMount, el, flavorLine, loadConfig, notice, plural, scoreboardEl, startCountdowns, store } from "./common.js";
import { connect } from "./connection.js";
import { buildHub } from "./deck/hub.js";
import { gameInfo, PLATFORM_NAME, setLibrary } from "./deck/library.js";
import { installQuickMenu, playLaunch, rememberPlayed, setCoverPainters, setSystem } from "./deck/ui.js";
import * as chaos from "./games/chaos-host.js";
import * as cornorshit from "./games/cornorshit-host.js";
import * as entityauction from "./games/entityauction-host.js";
import * as mycob from "./games/mycob-host.js";
import * as steamdeck from "./games/steamdeck-host.js";
import * as thud from "./games/thud-host.js";

const RENDERERS = { chaos, cornorshit, entityauction, mycob, steamdeck, thud };
const SESSION_KEY = "cpst-party:host";
const hostParams = new URLSearchParams(location.search);
const requestedGame = hostParams.get("game");
const requestedJoin = hostParams.get("join");
let requestedGameHandled = false;

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
  let url;
  if (requestedJoin) {
    try {
      const candidate = new URL(requestedJoin);
      if ((candidate.protocol === "http:" || candidate.protocol === "https:") && candidate.pathname === "/play" && !candidate.username && !candidate.password) {
        url = candidate;
      }
    } catch {}
  }
  url ??= new URL("/play", location.origin);
  if (state?.code) url.searchParams.set("code", state.code);
  return url.toString().replace(/\/$/, "");
}

// Warn only when the link phones will actually open is local-only; the desktop app passes a LAN
// ?join= address even though its host page itself is served from 127.0.0.1.
function joinIsLocalOnly() {
  try {
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(new URL(joinUrl()).hostname);
  } catch {
    return false;
  }
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
  // Steam My Deck: the registry's games are the library, and the renderers bring their covers.
  setLibrary(config.games);
  setCoverPainters(RENDERERS);
  installQuickMenu();
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

  if (!requestedGameHandled && state.status === "LOBBY" && requestedGame && config?.games?.some((g) => g.id === requestedGame)) {
    requestedGameHandled = true;
    if (state.config.gameId !== requestedGame) {
      void conn.request("room:configure", { gameId: requestedGame });
    }
  }

  const info = gameInfo(state.config.gameId);
  if (state.status !== lastStatus) {
    announce(state.status === "LOBBY" ? `${PLATFORM_NAME}: home` : state.status === "IN_GAME" ? `Launching ${info?.title ?? "the game"}` : "Final debrief");
    // Seen live (not on a reload mid-game): Steam My Deck launches the game.
    if (state.status === "IN_GAME" && lastStatus !== null && info) playLaunch(info);
    if (state.status === "IN_GAME") rememberPlayed(state.config.gameId);
    lastStatus = state.status;
  }
  document.title = state.status === "LOBBY" ? `${PLATFORM_NAME} — ${state.code}` : `${info?.title ?? "Corn Planet Party"} — ${PLATFORM_NAME}`;
  // The KERNEL button's quick menu: the host can always end a game and bring everyone back.
  setSystem(state.status === "IN_GAME" ? { gameId: state.config.gameId, canEnd: true, end: () => act("room:lobby") } : null);
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
        title: `End the game and go back to ${PLATFORM_NAME}`,
        onclick: () => confirm(`End this game and take everyone back to ${PLATFORM_NAME}? Scores from this game won't be saved.`) && act("room:lobby"),
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
  thud(settings, configure) {
    const levels = config.games.find((g) => g.id === "thud")?.catalog?.levels ?? [];
    const level = levels.find((l) => l.id === settings.level) ?? levels[0];
    return [
      choiceGroup("Level", "level", levels.map((l) => [l.id, `${l.difficulty}. ${l.name}`]), settings.level, (v) => configure({ settings: { level: v } })),
      el("p", { class: "hint", text: level ? `${"★".repeat(level.difficulty)} ${level.tagline} Co-op: everyone picks a bird, shares kernels, and launches one bird per turn. Keyboard, mouse or touch.` : "" }),
    ];
  },
  steamdeck(settings, configure) {
    // The Deck's games come from the server (levels.ts), so a new level shows up here by itself.
    const games = config.games.find((g) => g.id === "steamdeck")?.catalog?.games ?? [];
    const counts = games.map((_, i) => [i + 1, String(i + 1)]);
    return [
      choiceGroup("Games", "rounds", counts, settings.rounds, (v) => configure({ settings: { rounds: v } })),
      el("p", { class: "hint", text: `One game per round, picked at random: ${games.map((g) => g.name).join(", ")}. The session leader is Thad first, then Thad rotates. Keyboard, mouse or touch.` }),
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
    // Hidden unless the selected game has something to warn about (a warning never outlives its game).
    node.hidden = true;
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

    // The handheld games (Angry Thud's Revenge, Escape Thad's Steam Deck) don't use the CPI Database.
    if (gameId === "thud" || gameId === "steamdeck") return;
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

/**
 * The lobby is Steam My Deck's hub on the big screen (deck/hub.js): the library, title cards with
 * each game's settings form, the join code and the agents.
 */
function buildLobby(s) {
  return buildHub(s, {
    role: "host",
    act: (event, payload) => conn.request(event, payload),
    join: { url: joinUrl(), localhost: joinIsLocalOnly() },
    options: (gameId, room, configure) => SETTINGS_FORMS[gameId]?.(room.config.settings, configure, room) ?? [],
    warning: sourceWarning(),
  });
}

function buildResults(s) {
  const results = s.results;
  const note = el("p", { class: "notice" });
  const node = el(
    "div",
    { class: "stack" },
    el("p", { class: "eyebrow", text: `${gameInfo(results.gameId)?.title ?? results.gameName} · ${plural(results.rounds, "round")} · operation complete` }),
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
      el("button", { class: "btn", type: "button", text: "▶ Play again", onclick: () => act("room:start", {}, note) }),
      el("button", { class: "btn ghost", type: "button", text: `⌂ Back to ${PLATFORM_NAME}`, onclick: () => act("room:lobby", {}, note) }),
    ),
    note,
  );
  return { node };
}


init();
