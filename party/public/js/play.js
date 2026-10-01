// Phone controller: join, reconnect, the lobby (Steam My Deck's hub, deck/hub.js), game input and
// results.

import { $, announce, createMount, el, loadConfig, notice, ordinal, rank, startCountdowns, store } from "./common.js";
import { connect } from "./connection.js";
import { buildHub } from "./deck/hub.js";
import { gameInfo, PLATFORM_NAME, setLibrary } from "./deck/library.js";
import { installQuickMenu, playLaunch, quickMenuButton, rememberPlayed, setCoverPainters, setSystem } from "./deck/ui.js";
import * as chaos from "./games/chaos-play.js";
import * as budgetcuts from "./games/budgetcuts-play.js";
import * as channelcob from "./games/channelcob-play.js";
import * as cornorshit from "./games/cornorshit-play.js";
import * as entityauction from "./games/entityauction-play.js";
import * as mycob from "./games/mycob-play.js";
import * as steamdeck from "./games/steamdeck-play.js";
import * as thud from "./games/thud-play.js";

const RENDERERS = { budgetcuts, channelcob, chaos, cornorshit, entityauction, mycob, steamdeck, thud };
const SESSION_KEY = "cpst-party:player"; // { code, token, name }
const NAME_KEY = "cpst-party:last-name";

const main = $("#main");
const mount = createMount(main);
let config = null;
let conn = null;
let hello = { loggedIn: false, displayName: null };
let state = null;
let session = store.get("sessionStorage", SESSION_KEY);
let lastPhase = null;
// Why the last session ended ("The server is restarting…"). Kept until the player joins again so a
// reconnect re-mounting the join form doesn't wipe the explanation.
let endedMessage = null;
let helloReceived = () => {};
const helloReady = new Promise((resolve) => (helloReceived = resolve));

function saveSession(value) {
  session = value;
  if (value) {
    endedMessage = null;
    store.set("sessionStorage", SESSION_KEY, value);
    store.set("localStorage", SESSION_KEY, value);
    store.set("localStorage", NAME_KEY, value.name);
  } else {
    store.remove("sessionStorage", SESSION_KEY);
    store.remove("localStorage", SESSION_KEY);
  }
}

function setBanner(...nodes) {
  $("#banner").replaceChildren(...nodes.filter(Boolean));
}

// ------------------------------------------------------------------ connection

async function init() {
  startCountdowns();
  try {
    config = await loadConfig();
  } catch {
    main.replaceChildren(el("div", { class: "banner danger", role: "alert", text: "Can't reach the Corn Planet Party server. Refresh to try again." }));
    return;
  }
  // Steam My Deck: the registry's games are the library, and the renderers bring their covers.
  setLibrary(config.games);
  setCoverPainters(RENDERERS);
  installQuickMenu();
  $(".topbar nav")?.prepend(menuButton);
  conn = await connect({
    onState,
    onEnded,
    onStatus,
    onHello: (h) => {
      hello = h;
      helloReceived();
      $("#whoami").textContent = h.loggedIn ? h.displayName : "Guest";
    },
    onAuthFallback: () =>
      setBanner(el("div", { class: "banner", role: "status", text: "Your login expired, so you're playing as a guest. Log in again to record stats." })),
  });
}

async function onStatus(status) {
  if (status !== "connected") {
    setBanner(el("div", { class: "banner danger", role: "alert", text: "Signal lost — reconnecting…" }));
    return;
  }
  setBanner();
  await Promise.race([helloReady, new Promise((r) => setTimeout(r, 1500))]);
  if (session) {
    const resumed = await conn.request("player:resume", { code: session.code, token: session.token });
    if (resumed.ok) return saveSession({ code: resumed.code, token: resumed.token, name: resumed.name });
    saveSession(null);
    return showJoin(resumed.error === "NETWORK" ? resumed.message : "Your previous session has ended. Join the new one with the code on the host screen.");
  }
  showJoin();
}

function onEnded(info) {
  bannerKey = null;
  saveSession(null);
  state = null;
  lastPhase = null;
  lastStatus = null;
  setSystem(null);
  menuButton.hidden = true;
  setBanner();
  endedMessage = info.message ?? null;
  showJoin(info.message);
}

// ------------------------------------------------------------------ join

function showJoin(message = endedMessage) {
  state = null;
  lastStatus = null;
  setSystem(null);
  menuButton.hidden = true;
  document.title = "Corn Planet Party — Join";
  mount(`join:${Date.now()}`, buildJoin, message);
}

function buildJoin(message) {
  const params = new URLSearchParams(location.search);
  const previous = store.get("localStorage", SESSION_KEY);
  const note = el("p", { class: "notice" });
  const code = el("input", {
    id: "code",
    type: "text",
    class: "code-input",
    maxlength: "4",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    inputmode: "text",
    required: true,
    "aria-describedby": "codeHint",
    value: (params.get("code") ?? "").toUpperCase().slice(0, 4),
  });
  const name = el("input", {
    id: "name",
    type: "text",
    maxlength: String(config.limits.nameMax),
    autocomplete: "nickname",
    required: true,
    value: (hello.loggedIn ? hello.displayName : null) ?? store.get("localStorage", NAME_KEY) ?? "",
  });
  const submit = el("button", { class: "btn big", type: "submit", text: "Join session" });

  code.addEventListener("input", () => {
    code.value = code.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  });

  const form = el(
    "form",
    {
      class: "stack",
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (code.value.length !== 4) return notice(note, "Session codes are 4 letters — check the host screen.", "error"), code.focus();
        if (!name.value.trim()) return notice(note, "Enter an agent name.", "error"), name.focus();
        submit.disabled = true;
        notice(note, "Requesting clearance…");
        const joined = await conn.request("player:join", { code: code.value, name: name.value });
        submit.disabled = false;
        if (!joined.ok) {
          notice(note, joined.message, "error");
          (joined.error === "NAME_TAKEN" || joined.error === "INVALID_NAME" ? name : code).focus();
          return;
        }
        saveSession({ code: joined.code, token: joined.token, name: joined.name });
      },
    },
    el("div", { class: "field" }, el("label", { for: "code", text: "Session code" }), code, el("p", { class: "hint", id: "codeHint", text: "4 letters, shown on the host screen." })),
    el("div", { class: "field" }, el("label", { for: "name", text: "Agent name" }), name),
    submit,
    note,
  );

  const rejoin =
    previous && previous.code
      ? el("button", {
          class: "btn ghost big",
          type: "button",
          text: `Rejoin ${previous.code} as ${previous.name}`,
          onclick: async () => {
            const resumed = await conn.request("player:resume", { code: previous.code, token: previous.token });
            if (resumed.ok) return saveSession({ code: resumed.code, token: resumed.token, name: resumed.name });
            store.remove("localStorage", SESSION_KEY);
            rejoin.remove();
            notice(note, resumed.message, "error");
          },
        })
      : null;

  const node = el(
    "div",
    { class: "stack" },
    el("div", { class: "masthead" }, el("h1", { text: "JOIN SESSION" }), el("p", { text: "Authorized personnel only" })),
    message ? el("p", { class: "banner", role: "status", text: message }) : null,
    rejoin,
    form,
    el(
      "p",
      { class: "muted" },
      hello.loggedIn
        ? "You're logged in — your stats will be recorded."
        : config.auth.mode === "none"
          ? "Guest play."
          : el("span", {}, "Playing as a guest. ", el("a", { href: "/account", text: "Log in" }), " to record your stats."),
    ),
  );

  queueMicrotask(() => (code.value ? name : code).focus());
  return { node };
}

// ------------------------------------------------------------------ in a room

/** The top bar's way into the quick menu (games that don't run inside the handheld). */
const menuButton = quickMenuButton();
menuButton.hidden = true;
let lastStatus = null;

function onState(next) {
  state = next;
  const info = gameInfo(next.config.gameId);
  document.title = next.status === "IN_GAME" ? `${info?.title ?? "Corn Planet Party"} — ${PLATFORM_NAME}` : `${PLATFORM_NAME} — ${next.code}`;
  if (next.status !== lastStatus) {
    // Seen live (not on a reload mid-game): Steam My Deck launches the game.
    if (next.status === "IN_GAME" && lastStatus !== null && info) playLaunch(info);
    if (next.status === "IN_GAME") rememberPlayed(next.config.gameId);
    lastStatus = next.status;
  }
  // The quick menu (KERNEL button, or MENU in the top bar): the leader can end the game for
  // everyone; anyone can leave.
  setSystem(next.status === "IN_GAME" ? { gameId: next.config.gameId, canEnd: isLeader(), end: () => conn.request("room:lobby"), leave: leaveSession } : null);
  menuButton.hidden = next.status !== "IN_GAME";
  const phase = next.status === "IN_GAME" ? next.game?.phase : next.status;
  if (phase !== lastPhase) {
    lastPhase = phase;
    announce(PHASE_ANNOUNCEMENTS[phase] ?? "");
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
  }
  renderBanner();
  render();
}

const PHASE_ANNOUNCEMENTS = {
  LOBBY: "You're in the lobby.",
  INTRO: "New round starting.",
  ANSWERING: "File your incident reports now.",
  VOTING: "Voting is open.",
  VERDICT: "The ruling is on the host screen.",
  STANDINGS: "Standings on the host screen.",
  BRIEFING: "Sealed bays ahead.",
  BIDDING: "Bidding is open.",
  OPENING: "Containment unlocking.",
  REVEALED: "Contents revealed.",
  ACTION_INTRO: "Action Round.",
  EVENT: "Market event.",
  AUDIT: "Hidden modifiers revealed.",
  TALLY: "Final net worth.",
  ALERT: "Incident alert. Check your role.",
  UPDATE: "Incident update.",
  RESPONSE: "What do you do? Respond now.",
  PROCESSING: "Processing responses.",
  CONSEQUENCE: "Consequences are in.",
  STAGE_VOTE: "Vote for the best move.",
  OUTCOME: "The incident is over.",
  AWARD_SUBMIT: "Create an award.",
  AWARD_VOTE: "Vote on the awards.",
  AWARD_RESULTS: "The awards.",
  FINAL_RESULTS: "Final results.",
};

async function act(event, payload, noteTarget) {
  const result = await conn.request(event, payload);
  if (!result.ok && noteTarget) notice(noteTarget, result.message, "error");
  return result;
}

function isLeader() {
  return state?.you?.isLeader === true;
}

let bannerKey = null;
function renderBanner() {
  const key = state?.paused ? `paused:${isLeader()}` : "none";
  if (key === bannerKey) return;
  bannerKey = key;
  if (!state?.paused) return setBanner();
  const note = el("p", { class: "notice" });
  setBanner(
    el(
      "div",
      { class: "banner", role: "status" },
      el("strong", { text: "HOST DISPLAY OFFLINE — GAME PAUSED" }),
      el("p", { class: "muted", text: "Timers are frozen until the host screen reconnects." }),
      isLeader()
        ? el("button", { class: "btn small", type: "button", text: "Continue without display", onclick: () => act("room:resume", {}, note) })
        : null,
      note,
    ),
  );
}

function render() {
  if (!state) return;
  if (state.status === "LOBBY") return mount(`lobby:${state.code}`, buildLobby, state);
  if (state.status === "FINAL_RESULTS") return mount(`results:${isLeader()}`, buildResults, state);
  const renderer = RENDERERS[state.config.gameId];
  if (renderer && state.game) renderer.render(mount, state, { request: conn.request, stream: conn.stream, leaveButton });
}

/** Leaves the session after asking. Resolves true if they left. */
async function leaveSession() {
  if (!confirm(state?.status === "IN_GAME" ? "Leave mid-game? You can't rejoin this game." : "Leave this session?")) return false;
  await conn.request("room:leave");
  saveSession(null);
  showJoin("You left the session.");
  return true;
}

function leaveButton() {
  return el("button", { class: "btn subtle small", type: "button", text: "Leave session", onclick: leaveSession });
}

/**
 * The lobby is Steam My Deck's hub on the phone (deck/hub.js): browse the library, see who's here,
 * your agent, settings. The session leader can also pick and launch games from here.
 */
function buildLobby(s) {
  return buildHub(s, {
    role: "player",
    act: (event, payload) => conn.request(event, payload),
    leave: leaveSession,
    account: {
      loggedIn: hello.loggedIn,
      displayName: hello.displayName,
      guestNote: config.auth.mode === "none" ? null : el("p", { class: "deck-hint" }, el("a", { href: "/account", text: "Log in" }), " to record your stats."),
    },
  });
}

function buildResults(s) {
  const results = s.results;
  const me = results.standings.find((st) => st.playerId === s.you.playerId);
  const note = el("p", { class: "notice" });
  const node = el(
    "div",
    { class: "stack" },
    el(
      "div",
      { class: "big-status" },
      el("p", { class: "eyebrow", text: `${gameInfo(results.gameId)?.title ?? results.gameName} · final debrief` }),
      me ? el("div", { class: "placement", text: ordinal(me.placement) }) : null,
      me ? el("h2", { text: `${me.score.toLocaleString()} points` }) : null,
      el("p", { class: "muted", text: me?.placement === 1 ? "Commendation filed. Try not to let it go to your head." : "Your debrief is on the host screen." }),
    ),
    el(
      "ol",
      { class: "list", "aria-label": "Final standings" },
      rank(results.standings).map((st) =>
        el(
          "li",
          {},
          el("span", { class: "mono", text: ordinal(st.placement) }),
          el("span", { class: "grow", text: st.name }),
          el("strong", { class: "mono", text: st.score.toLocaleString() }),
        ),
      ),
    ),
    isLeader()
      ? el(
          "div",
          { class: "row" },
          el("button", { class: "btn", type: "button", text: "▶ Play again", onclick: () => act("room:start", {}, note) }),
          el("button", { class: "btn ghost", type: "button", text: `⌂ Back to ${PLATFORM_NAME}`, onclick: () => act("room:lobby", {}, note) }),
        )
      : el("p", { class: "muted", text: `The host or session leader can play again or take everyone back to ${PLATFORM_NAME}.` }),
    note,
    el("div", { class: "row" }, leaveButton()),
  );
  return { node };
}

init();
