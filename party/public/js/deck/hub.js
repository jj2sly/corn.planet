// Steam My Deck: the hub. The room's lobby, shown as the CPI handheld's home screen, on the big
// screen and on every phone: HOME (the selected game, the way in, who's here), LIBRARY (every
// installed game), a game's title card (what it is, its controls and options, LAUNCH), PROFILE (or,
// on the big screen, AGENTS) and SETTINGS.
//
// Nothing here is a second source of truth. The games are the server's registry (library.js),
// picking one is `room:configure`, launching is `room:start`, and the room's own lifecycle takes it
// from there: the game runs, finishes (or the host ends it), and the room comes back to the lobby,
// which is this hub again. Only the host and the session leader can pick or launch; everyone else
// can browse.
//
// Driving it: tap anything; or the device's d-pad (moves a cursor), A (select) and B (back); or the
// keyboard (arrows, Enter, Esc, 1–4 for the pages). The browser's Back button closes a title card.

import { el, notice, plural } from "../common.js";
import { bootScreen, createHandheld, dpad, faceButton } from "../cpi/handheld.js";
import { playSfx } from "../games/mycob-sound.js";
import { gameInfo, homeOrder, library, pagesFor, PLATFORM, SHELVES, SOLO_GAMES, spatialMove } from "./library.js";
import { avatar, cover, facts, recentGames, reducedMotion, settingsPanel, titleCard } from "./ui.js";

/** Fires on press (a game button's feel), and on Enter / Space for keyboards; never steals focus. */
function press(button, fn) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.classList.add("pressed");
    fn();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(type, () => button.classList.remove("pressed"));
  button.addEventListener("click", (e) => {
    if (e.detail === 0 && !button.disabled) fn();
  });
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  return button;
}

const moreAgents = (n) => plural(n, "more agent").toUpperCase();

/** The join link, allowed to wrap before its query (the code) rather than mid-word. */
function joinUrlEl(url) {
  const at = url.indexOf("?");
  return el("p", { class: "deck-join-url mono" }, at > 0 ? [url.slice(0, at), el("wbr"), url.slice(at)] : url);
}

/** The Deck powers on once per page load (a second or so, skippable), not every time it's shown. */
let booted = false;
const bootLines = () => [
  `MOUNTING LIBRARY ............ ${library().length} GAMES`,
  "CHECKING CORN LEVELS ........ OK",
  "WARRANTY .................... VOID",
  `STARTING ${PLATFORM} ...... OK`,
];

/**
 * The hub for one room. opts:
 *   role: "host" | "player"
 *   act(event, payload): Promise<{ ok, message? }>, a room request
 *   host only: join: { url, localhost }, options(gameId, room, configure): Node[] (the game's lobby
 *     settings), warning: { node, update(gameId, contentMode, room) } (not enough source material)
 *   player only: leave(): Promise<boolean>, account: { loggedIn, displayName, guestNote: Node | null }
 */
export function buildHub(s, opts) {
  const host = opts.role === "host";
  const pages = pagesFor(opts.role);
  let room = s;
  let page = "home";
  let card = null; // the game whose title card is open
  let cardFrom = null; // what opened it, to go back to
  let cardEntry = null; // the history entry it pushed, so the browser's Back closes it
  // An entry left over from before a reload is just the page now.
  if (history.state?.deckCard) history.replaceState(null, "");
  const ownEntry = () => cardEntry !== null && history.state?.deckEntry === cardEntry;
  let current = null;
  let cursor = null;

  const controller = () => host || room.you?.isLeader === true;
  const selected = () => gameInfo(room.config.gameId) ?? library()[0];
  const connected = () => room.players.filter((p) => p.connected).length;
  const missing = (info) => Math.max(0, info.minPlayers - connected());
  const meIndex = () => room.players.findIndex((p) => p.id === room.you?.playerId);

  // ---------------------------------------------------------------- the device

  const tabButtons = new Map();
  const tabs = el(
    "div",
    { class: "deck-tabs", role: "tablist", "aria-label": `${PLATFORM} menu` },
    pages.map((p, i) => {
      const b = el("button", { class: `deck-tab t-${p.id}`, type: "button", role: "tab", id: `deck-tab-${p.id}`, "aria-controls": "deck-view", "aria-selected": "false", tabindex: "-1", title: `${p.label} (${i + 1})` }, el("span", { class: "deck-tab-icon", "aria-hidden": "true", text: p.icon }), el("span", { class: "deck-tab-label", text: p.label }));
      b.addEventListener("click", () => go(p.id, { user: true }));
      tabButtons.set(p.id, b);
      return b;
    }),
  );
  // Arrow keys move along the menu bar, as a tab list should.
  tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = pages.findIndex((p) => tabButtons.get(p.id) === document.activeElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? pages.length - 1 : (i + (e.key === "ArrowLeft" ? -1 : 1) + pages.length) % pages.length;
    go(pages[next].id, { user: true });
    tabButtons.get(pages[next].id).focus();
  });

  const dirBtn = (dir, label, glyph) => press(el("button", { type: "button", "aria-label": label, text: glyph }), () => nav(dir));
  const aBtn = press(faceButton("A", { label: "SELECT", aria: "A: select", keyHint: "Enter" }), () => activate());
  const bBtn = press(faceButton("B", { label: "BACK", aria: "B: back", keyHint: "Esc" }), () => back());
  const codeChip = el("span", { class: "cpi-hh-chip deck-code-chip" });
  const agentsChip = el("span", { class: "cpi-hh-chip deck-agents-chip" });
  const hh = createHandheld({
    title: PLATFORM,
    owner: host ? "THE PARTY" : null,
    layout: host ? "landscape" : "auto",
    left: el("div", { class: "cpi-hh-cluster" }, dpad({ up: dirBtn("up", "Up", "▲"), left: dirBtn("left", "Left", "◀"), right: dirBtn("right", "Right", "▶"), down: dirBtn("down", "Down", "▼") })),
    right: el("div", { class: "cpi-hh-cluster deck-face" }, el("div", { class: "deck-ab" }, bBtn, aBtn)),
    under: tabs,
    label: `${PLATFORM} home screen`,
    className: `deck-device ${host ? "deck-host" : "deck-phone"}`,
    home: () => go("home", { user: true }),
  });
  hh.setStatus({ battery: 1, extra: host ? [codeChip, agentsChip] : [codeChip] });
  const view = el("div", { class: "deck-view", id: "deck-view", role: "tabpanel", tabindex: "-1" });
  hh.screen.append(el("div", { class: "deck-wall", "aria-hidden": "true" }), view);
  const node = el("div", { class: `deck-hub ${host ? "deck-hub-host" : "deck-hub-phone"}` }, hh.node);

  view.addEventListener("focusin", (e) => {
    if (e.target instanceof Element && e.target.matches("[data-nav]")) cursor = e.target;
  });
  // Touch or a mouse: no d-pad cursor ring until the d-pad or arrow keys are used again.
  view.addEventListener("pointerdown", () => hh.node.classList.remove("nav-mode"));

  // ---------------------------------------------------------------- shared pieces

  /** LAUNCH (or SELECT) for one game, with a line saying what's going on. */
  function launchControls(info, { details = false, backButton = false } = {}) {
    let launching = false;
    const launch = el("button", { class: "deck-btn go big", type: "button", "data-nav": "", dataset: { key: `launch:${info.id}` } });
    const choose = el("button", { class: "deck-btn", type: "button", "data-nav": "", dataset: { key: `select:${info.id}` }, text: "SELECT THIS GAME" });
    const more = details ? el("button", { class: "deck-btn ghost", type: "button", "data-nav": "", dataset: { key: `details:${info.id}` }, text: "DETAILS" }) : null;
    const back = backButton ? el("button", { class: "deck-btn ghost", type: "button", "data-nav": "", dataset: { key: "back" }, text: "‹ BACK" }) : null;
    const status = el("p", { class: "deck-status", role: "status" });
    const note = el("p", { class: "notice" });
    const fail = (message) => {
      notice(note, message, "error");
      hh.notify(message, { kind: "danger", icon: "✗", ms: 3200 });
      hh.flash("danger", 600);
    };
    launch.addEventListener("click", async () => {
      if (launch.disabled || launching) return;
      launching = true;
      paint();
      playSfx("ui_click");
      const result = await opts.act("room:start", {});
      launching = false;
      if (!result.ok) {
        fail(result.message);
        paint();
      } else if (ownEntry()) history.back();
    });
    choose.addEventListener("click", async () => {
      playSfx("ui_click");
      const result = await opts.act("room:configure", { gameId: info.id });
      if (!result.ok) fail(result.message);
    });
    more?.addEventListener("click", () => openCard(info.id, `details:${info.id}`));
    back?.addEventListener("click", () => closeCard());
    const paint = () => {
      const isSelected = room.config.gameId === info.id;
      const need = missing(info);
      launch.hidden = !controller() || !isSelected;
      choose.hidden = !controller() || isSelected;
      launch.disabled = launching || need > 0;
      launch.textContent = launching ? "LAUNCHING…" : need > 0 ? `NEED ${moreAgents(need)}` : "▶ LAUNCH";
      const picked = selected()?.title ?? "a game";
      status.textContent = controller()
        ? isSelected
          ? need > 0
            ? `${info.title} needs ${info.minPlayers} agents: ${connected()} connected so far.`
            : `${plural(connected(), "agent")} ready.${host ? "" : " Options are on the host screen."}`
          : `Selected right now: ${picked}.`
        : isSelected
          ? need > 0
            ? `Waiting for ${plural(need, "more agent")} to join…`
            : "Selected. Waiting for the host or session leader to launch."
          : `The host picked ${picked}. Only the host or session leader chooses.`;
    };
    paint();
    return { node: el("div", { class: "deck-launch-row" }, el("div", { class: "deck-actions" }, launch, choose, more, back), status, note), update: paint };
  }

  /** A game in the library: its cover (title on it), genre and players, and a SELECTED flag. */
  function tile(info, { size = "tile" } = {}) {
    const isSelected = room.config.gameId === info.id;
    const b = el(
      "button",
      { class: `deck-tile s-${size} ${isSelected ? "selected" : ""}`.trim(), type: "button", "data-nav": "", dataset: { key: `tile:${size}:${info.id}` }, "aria-label": `${info.title}. ${info.genre}, ${info.players}.${isSelected ? " Selected." : ""}` },
      cover(info, { size, label: size === "tile" }),
      el("span", { class: "deck-tile-meta", "aria-hidden": "true" }, size === "tile" ? null : el("span", { class: "deck-tile-title", text: info.title }), el("span", { class: "deck-tile-sub", text: `${info.genre} · ${info.players}` })),
      isSelected ? el("span", { class: "deck-tile-flag", "aria-hidden": "true", text: "SELECTED" }) : null,
    );
    b.addEventListener("click", () => openCard(info.id, b.dataset.key));
    return b;
  }

  /** Everyone in the room as their CPI characters, in a row (the home screen). */
  function agentRow() {
    const list = el("ul", { class: "deck-agent-row", "aria-label": "Agents in this session" });
    let sig = "";
    return {
      node: list,
      update(r) {
        const next = JSON.stringify([r.players, r.leaderId]);
        if (next === sig) return;
        sig = next;
        list.replaceChildren(
          ...r.players.map((p, i) =>
            el(
              "li",
              { class: `${p.connected ? "" : "offline"} ${p.id === r.you?.playerId ? "me" : ""}`.trim(), title: p.name },
              avatar(p, i, { size: host ? 54 : 42 }),
              el("span", { class: "deck-agent-row-name", text: p.id === r.you?.playerId ? `${p.name} (you)` : p.name }),
              p.id === r.leaderId ? el("span", { class: "deck-crown", "aria-label": "leader", text: "★" }) : null,
            ),
          ),
          ...(r.players.length ? [] : [el("li", { class: "deck-empty", text: "Nobody yet. Join on your phone!" })]),
        );
      },
    };
  }

  // ---------------------------------------------------------------- pages

  function homePage() {
    const info = selected();
    const launch = launchControls(info, { details: true });
    const warningSlot = el("div", { class: "deck-warning-slot" });
    const hero = el(
      "section",
      { class: "deck-hero", "aria-labelledby": "deck-hero-title" },
      el(
        "button",
        { class: "deck-hero-art", type: "button", "data-nav": "", dataset: { key: `hero:${info.id}` }, "aria-label": `${info.title}: title card`, onclick: () => openCard(info.id, `hero:${info.id}`) },
        cover(info, { size: "hero", label: false }),
        // The big screen stamps the selected game once enough agents are in (party.css shows it).
        host ? el("span", { class: "deck-hero-stamp", "aria-hidden": "true", text: "CLEARED FOR LAUNCH" }) : null,
      ),
      el(
        "div",
        { class: "deck-hero-body" },
        el("p", { class: "deck-kicker", text: "SELECTED GAME" }),
        el("h2", { class: `deck-hero-title ${info.title.length > 22 ? "long" : ""}`.trim(), id: "deck-hero-title", text: info.title }),
        el("p", { class: "deck-hero-tag", text: info.tagline }),
        facts(info),
        launch.node,
        host ? null : warningSlot,
      ),
      // On the TV a heads-up sits under the cover, so it doesn't push the shelf off the screen.
      host ? warningSlot : null,
    );
    const others = homeOrder(library(), recentGames(), info.id).filter((g) => g.id !== info.id);
    const shelf = el(
      "section",
      { class: "deck-strip-wrap", "aria-labelledby": "deck-strip-title" },
      el("header", { class: "deck-row-head" }, el("h3", { id: "deck-strip-title", text: recentGames().some((id) => id !== info.id && gameInfo(id)) ? "RECENT & INSTALLED" : "INSTALLED" }), el("button", { class: "deck-link", type: "button", "data-nav": "", dataset: { key: "all-games" }, text: `ALL ${library().length} ›`, onclick: () => go("library", { user: true }) })),
      el("ul", { class: "deck-strip" }, others.map((g) => el("li", {}, tile(g, { size: "mini" })))),
    );
    const agents = agentRow();
    let side;
    let paintSide = () => {};
    if (host) {
      // The TV's join plate: the code is the thing to read from across the room; the link is
      // secondary. Under it, how close the selected game is to launching.
      const code = el("p", { class: "deck-join-code mono", role: "img" });
      const count = el("span", { class: "deck-row-count" });
      const pips = el("span", { class: "deck-ready-pips", "aria-hidden": "true" });
      const readiness = el("p", { class: "deck-ready-text", role: "status" });
      side = el(
        "aside",
        { class: "deck-side" },
        el(
          "section",
          { class: "deck-join", "aria-label": "How to join" },
          el("p", { class: "deck-kicker deck-join-kicker", text: "JOIN ON YOUR PHONE" }),
          el("p", { class: "deck-join-label", "aria-hidden": "true", text: "ACCESS CODE" }),
          code,
          joinUrlEl(opts.join?.url ?? ""),
          el("p", { class: "deck-hint", text: "Open the link, enter the code and an agent name. The first agent in leads the session." }),
          opts.join?.localhost ? el("p", { class: "deck-warn", text: "Phones can't open “localhost”. Open this page at this computer's network address (it's in the server console) so the link works." }) : null,
        ),
        el(
          "section",
          { class: "deck-agents-mini", "aria-label": "Agents" },
          el("header", { class: "deck-row-head" }, el("h3", {}, "AGENTS ", count), el("button", { class: "deck-link", type: "button", "data-nav": "", dataset: { key: "agents" }, text: "MANAGE ›", onclick: () => go("profile", { user: true }) })),
          el("div", { class: "deck-ready" }, pips, readiness),
          agents.node,
        ),
      );
      paintSide = (r) => {
        if (code.dataset.code !== r.code) {
          code.dataset.code = r.code;
          code.replaceChildren(...[...r.code].map((ch) => el("span", { class: "deck-code-char", text: ch })));
          code.setAttribute("aria-label", `Session code ${r.code.split("").join(" ")}`);
        }
        count.textContent = `${r.players.length}/${r.maxPlayers}`;
        const info = selected();
        const here = connected();
        const need = missing(info);
        const slots = Math.min(r.maxPlayers, Math.max(info.minPlayers, here));
        if (pips.childElementCount !== slots || pips.dataset.here !== String(here)) {
          pips.dataset.here = String(here);
          pips.replaceChildren(...Array.from({ length: slots }, (_, i) => el("span", { class: i < here ? "on" : "" })));
        }
        readiness.textContent = need > 0 ? `WAITING FOR ${moreAgents(need)}` : `READY · ${plural(here, "agent").toUpperCase()} CONNECTED`;
        nodeOut.dataset.ready = String(need === 0);
      };
    } else {
      const who = el("div", { class: "deck-me" });
      let sig = "";
      side = who;
      paintSide = (r) => {
        const me = r.players[meIndex()];
        const next = JSON.stringify([me?.name, meIndex(), r.you?.isLeader, r.players.length, r.code]);
        if (next === sig) return;
        sig = next;
        who.replaceChildren(
          el("button", { class: "deck-me-avatar", type: "button", "data-nav": "", dataset: { key: "me" }, "aria-label": "Your profile", onclick: () => go("profile", { user: true }) }, avatar(me ?? { name: r.you?.name }, Math.max(0, meIndex()), { size: 52, state: "cheer" })),
          el(
            "div",
            { class: "deck-me-text" },
            el("p", { class: "deck-me-name" }, el("span", { text: me?.name ?? r.you?.name ?? "Agent" }), r.you?.isLeader ? el("span", { class: "deck-badge lead", text: "LEADER" }) : null),
            el("p", { class: "deck-hint", text: `Session ${r.code} · ${plural(r.players.length, "agent")}${r.you?.isLeader ? " · you pick and launch" : ""}` }),
          ),
        );
      };
    }
    const nodeOut = el("div", { class: `deck-home ${host ? "host" : "phone"}` }, host ? null : side, hero, host ? side : null, shelf, host ? null : el("section", { class: "deck-agents-mini", "aria-label": "Agents" }, el("h3", { text: "IN THIS SESSION" }), agents.node));
    return {
      node: nodeOut,
      update(r) {
        launch.update();
        agents.update(r);
        paintSide(r);
        if (opts.warning) {
          if (opts.warning.node.parentNode !== warningSlot) warningSlot.append(opts.warning.node);
          opts.warning.update(r.config.gameId, r.config.contentMode, r);
        }
      },
    };
  }

  function libraryPage() {
    const blocks = SHELVES.map((shelf) => {
      const games = library().filter((g) => g.shelf === shelf.id);
      if (!games.length) return null;
      return el(
        "section",
        { class: "deck-shelf", "aria-labelledby": `deck-shelf-${shelf.id}` },
        el("header", { class: "deck-row-head" }, el("h2", { id: `deck-shelf-${shelf.id}`, text: shelf.label }), el("span", { class: "deck-row-count", text: plural(games.length, "game") })),
        el("p", { class: "deck-hint", text: shelf.blurb }),
        el("ul", { class: "deck-grid" }, games.map((g) => el("li", {}, tile(g)))),
      );
    });
    const solo = el(
      "section",
      { class: "deck-shelf", "aria-labelledby": "deck-shelf-solo" },
      el("header", { class: "deck-row-head" }, el("h2", { id: "deck-shelf-solo", text: "SOLO" }), el("span", { class: "deck-row-count", text: plural(SOLO_GAMES.length, "game") })),
      el("p", { class: "deck-hint", text: "Play on this screen, on your own. Opens in a new tab; your session stays put" }),
      el(
        "ul",
        { class: "deck-grid" },
        SOLO_GAMES.map((g) =>
          el(
            "li",
            {},
            el(
              "a",
              { class: "deck-tile s-tile", href: g.href, target: "_blank", rel: "noopener", "data-nav": "", dataset: { key: `solo:${g.id}` }, "aria-label": `${g.title}. ${g.genre}, ${g.players}. Opens in a new tab.` },
              cover(g, { size: "tile", label: true }),
              el("span", { class: "deck-tile-meta", "aria-hidden": "true" }, el("span", { class: "deck-tile-sub", text: `${g.genre} · ${g.players}` })),
            ),
          ),
        ),
      ),
    );
    return { node: el("div", { class: "deck-library" }, el("p", { class: "deck-kicker", text: `LIBRARY · ${library().length + SOLO_GAMES.length} INSTALLED` }), ...blocks, solo) };
  }

  function cardPage(id) {
    const info = gameInfo(id);
    const isSelected = room.config.gameId === id;
    const launch = launchControls(info, { backButton: true });
    const optionsBox = el("div", { class: "deck-options" });
    const warningSlot = el("div", { class: "deck-warning-slot" });
    const extra = [];
    if (host && isSelected) extra.push(el("section", { class: "deck-card-section" }, el("h3", { text: "OPTIONS" }), optionsBox));
    extra.push(warningSlot);
    let optionsSig = null;
    return {
      node: el("div", { class: "deck-card-page" }, titleCard(info, { actions: [launch.node], extra, selected: isSelected })),
      update(r) {
        launch.update();
        if (opts.warning && isSelected) {
          if (opts.warning.node.parentNode !== warningSlot) warningSlot.append(opts.warning.node);
          opts.warning.update(r.config.gameId, r.config.contentMode, r);
        }
        if (!(host && isSelected && opts.options)) return;
        // Rebuilt only when the settings change, keeping keyboard focus on the same choice.
        const sig = JSON.stringify(r.config);
        if (sig === optionsSig) return;
        optionsSig = sig;
        const focusedName = document.activeElement?.closest?.(".deck-options") ? document.activeElement.name : null;
        optionsBox.replaceChildren(...opts.options(id, r, (patch) => opts.act("room:configure", patch).then((res) => (res.ok ? res : (hh.notify(res.message, { kind: "danger", icon: "✗" }), res)))));
        if (focusedName) optionsBox.querySelector(`input[name="${focusedName}"]:checked`)?.focus();
      },
    };
  }

  function agentsPage() {
    const head = el("p", { class: "deck-kicker" });
    const list = el("ul", { class: "deck-agents" });
    let sig = "";
    return {
      node: el("div", { class: "deck-agents-page" }, head, list, el("p", { class: "deck-hint", text: "The first agent to join leads: they can pick and launch games from their phone too. Removing an agent mid-game takes them out of it." })),
      update(r) {
        head.textContent = `AGENTS · ${r.players.length} OF ${r.maxPlayers} · ${connected()} CONNECTED`;
        const next = JSON.stringify([r.players, r.leaderId]);
        if (next === sig) return;
        sig = next;
        const focused = document.activeElement?.dataset?.key;
        list.replaceChildren(
          ...r.players.map((p, i) =>
            el(
              "li",
              { class: `deck-agent ${p.connected ? "" : "offline"}`.trim() },
              avatar(p, i, { size: 46 }),
              el("span", { class: "deck-agent-name", text: p.name }),
              el("span", { class: "deck-agent-tags" }, p.id === r.leaderId ? el("span", { class: "deck-badge lead", text: "LEADER" }) : null, p.connected ? null : el("span", { class: "deck-badge off", text: "SIGNAL LOST" })),
              el("button", {
                class: "deck-icon-btn",
                type: "button",
                "data-nav": "",
                dataset: { key: `kick:${p.id}` },
                "aria-label": `Remove ${p.name}`,
                text: "✕",
                onclick: () => confirm(`Remove ${p.name} from the session?`) && opts.act("room:kick", { playerId: p.id }),
              }),
            ),
          ),
          r.players.length < r.maxPlayers ? el("li", { class: "deck-agent open", text: `${plural(r.maxPlayers - r.players.length, "open slot")} · join at ${opts.join?.url ?? "/play"} with code ${r.code}` }) : null,
        );
        if (focused) list.querySelector(`[data-key="${focused}"]`)?.focus();
      },
    };
  }

  function profilePage() {
    const top = el("div", { class: "deck-profile-top" });
    const agents = agentRow();
    const leave = el("button", { class: "deck-btn ghost danger", type: "button", "data-nav": "", dataset: { key: "leave" }, text: "Leave session" });
    leave.addEventListener("click", () => opts.leave?.());
    const account = opts.account ?? {};
    let sig = "";
    return {
      node: el(
        "div",
        { class: "deck-profile" },
        top,
        el("section", { class: "deck-panel" }, el("h3", { text: "ACCOUNT" }), el("p", { class: "deck-hint", text: account.loggedIn ? `Signed in as ${account.displayName}. Your stats are recorded.` : "Playing as a guest." }), account.loggedIn ? null : account.guestNote ?? null),
        el("section", { class: "deck-panel" }, el("h3", { text: "IN THIS SESSION" }), agents.node),
        leave,
      ),
      update(r) {
        agents.update(r);
        const i = meIndex();
        const me = r.players[i];
        const next = JSON.stringify([me?.name, i, r.you?.isLeader, r.code]);
        if (next === sig) return;
        sig = next;
        top.replaceChildren(
          avatar(me ?? { name: r.you?.name }, Math.max(0, i), { size: 96, state: "cheer" }),
          el(
            "div",
            {},
            el("p", { class: "deck-kicker", text: "AGENT PROFILE" }),
            el("h2", { class: "deck-profile-name", text: me?.name ?? r.you?.name ?? "Agent" }),
            el("p", { class: "deck-profile-tags" }, r.you?.isLeader ? el("span", { class: "deck-badge lead", text: "SESSION LEADER" }) : el("span", { class: "deck-badge", text: "AGENT" }), el("span", { class: "deck-badge", text: `SESSION ${r.code}` })),
            el("p", { class: "deck-hint", text: "Your agent (and your colour) follow you into every game." }),
          ),
        );
      },
    };
  }

  // ---------------------------------------------------------------- showing pages

  function keyNow() {
    if (card) return `card:${card}:${room.config.gameId === card}:${controller()}`;
    if (page === "home") return `home:${room.config.gameId}:${controller()}`;
    if (page === "library") return `library:${room.config.gameId}`;
    return `${page}:${controller()}`;
  }

  function render({ fresh = false } = {}) {
    const key = keyNow();
    if (!current || current.key !== key) {
      // The same button stays focused across a redraw (the selection moved, the leader changed).
      const focusKey = view.contains(document.activeElement) ? document.activeElement?.dataset?.key : null;
      const scroll = view.scrollTop;
      const built = card && gameInfo(card) ? cardPage(card) : page === "library" ? libraryPage() : page === "profile" ? (host ? agentsPage() : profilePage()) : page === "settings" ? { node: settingsPanel() } : homePage();
      current = { key, ...built };
      // A new page slides in; the same page redrawn (the selection changed) just updates.
      if (fresh) current.node.classList.add("deck-enter");
      view.replaceChildren(current.node);
      view.scrollTop = fresh ? 0 : scroll;
      if (focusKey) view.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    }
    current.update?.(room);
    const onTab = card ? "library" : page;
    for (const [id, b] of tabButtons) {
      b.classList.toggle("on", id === onTab);
      b.setAttribute("aria-selected", String(id === onTab));
      b.tabIndex = id === onTab ? 0 : -1;
    }
    view.setAttribute("aria-labelledby", `deck-tab-${onTab}`);
  }

  function go(next, { user = false } = {}) {
    if (card) {
      card = null;
      if (ownEntry()) history.back();
      cardEntry = null;
    }
    const changed = next !== page;
    page = next;
    if (user) playSfx("ui_click", { volume: 0.6 });
    render({ fresh: changed || user });
  }

  function openCard(id, from = null) {
    if (!gameInfo(id)) return;
    cardFrom = from;
    card = id;
    playSfx("ui_click", { volume: 0.6 });
    try {
      if (ownEntry()) history.replaceState({ deckCard: id, deckEntry: cardEntry }, "");
      else {
        cardEntry = `${Date.now()}-${Math.random()}`;
        history.pushState({ deckCard: id, deckEntry: cardEntry }, "");
      }
    } catch {
      // No history (a sandboxed frame): B, Esc and BACK still close it.
      cardEntry = null;
    }
    render({ fresh: true });
    view.querySelector(".deck-card-title")?.focus({ preventScroll: true });
  }

  function closeCard({ fromHistory = false } = {}) {
    if (!card) return;
    card = null;
    if (!fromHistory && ownEntry()) history.back();
    cardEntry = null;
    render({ fresh: true });
    const back = cardFrom ? view.querySelector(`[data-key="${CSS.escape(cardFrom)}"]`) : null;
    back?.focus({ preventScroll: true });
    back?.scrollIntoView({ block: "nearest" });
  }

  function back() {
    if (card) return closeCard();
    if (page !== "home") return go("home", { user: true });
  }

  /** The d-pad and arrow keys: move the cursor to the nearest thing that way. */
  function nav(dir) {
    const items = [...view.querySelectorAll("[data-nav]")].filter((n) => !n.disabled && !n.hidden && n.getClientRects().length);
    if (!items.length) return;
    hh.node.classList.add("nav-mode");
    let from = items.indexOf(document.activeElement);
    if (from < 0) from = items.indexOf(cursor);
    const to = from < 0 ? 0 : spatialMove(items.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }), from, dir);
    if (to === from) return;
    cursor = items[to];
    cursor.focus({ preventScroll: true });
    cursor.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    playSfx("ui_click", { volume: 0.35 });
  }

  function activate() {
    const target = view.contains(document.activeElement) && document.activeElement.matches("[data-nav]") ? document.activeElement : cursor?.isConnected ? cursor : null;
    if (target && !target.disabled) target.click();
    else nav("down");
  }

  const onKey = (e) => {
    if (!node.isConnected) return removeEventListener("keydown", onKey);
    if (document.querySelector("dialog[open]") || e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : null;
    const typing = t?.closest("input, textarea, select");
    if (e.key === "Escape" || (e.key === "Backspace" && !typing)) {
      if (card || page !== "home") {
        e.preventDefault();
        back();
      }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-4]$/.test(e.key) && !e.repeat) {
      const p = pages[Number(e.key) - 1];
      if (p) go(p.id, { user: true });
      return;
    }
    if (e.key.startsWith("Arrow") && !t?.closest(".deck-tabs")) {
      e.preventDefault();
      nav(e.key);
    }
  };
  addEventListener("keydown", onKey);
  const onPop = () => {
    if (!node.isConnected) return removeEventListener("popstate", onPop);
    if (card && cardEntry !== null && history.state?.deckEntry !== cardEntry) closeCard({ fromHistory: true });
  };
  addEventListener("popstate", onPop);

  // ---------------------------------------------------------------- live updates

  let lastIds = null;
  let lastNames = new Map();
  let lastGame = room.config.gameId;
  let wasLeader = room.you?.isLeader === true;

  function update(next) {
    room = next;
    const info = selected();
    // The screen's wallpaper takes the selected game's colours.
    hh.screen.style.setProperty("--wall-from", info.art.from);
    hh.screen.style.setProperty("--wall-accent", info.art.accent);
    codeChip.textContent = `CODE ${room.code}`;
    agentsChip.textContent = `👥 ${connected()}/${room.maxPlayers}`;
    hh.setStatus({ signal: room.players.length ? connected() / room.players.length : 1 });
    // News, in the status bar.
    const ids = new Set(room.players.map((p) => p.id));
    if (lastIds) {
      for (const p of room.players) if (!lastIds.has(p.id)) hh.notify(`${p.name} joined`, { kind: "ok", icon: "+" });
      for (const id of lastIds) if (!ids.has(id)) hh.notify(`${lastNames.get(id) ?? "An agent"} left`, { kind: "info", icon: "−" });
    }
    lastIds = ids;
    lastNames = new Map(room.players.map((p) => [p.id, p.name]));
    if (room.config.gameId !== lastGame) {
      lastGame = room.config.gameId;
      hh.notify(`Selected: ${info.title}`, { kind: "info", icon: "▶", replace: true });
    }
    const leader = room.you?.isLeader === true;
    if (leader && !wasLeader && !host) hh.notify("You lead the session: pick and launch games", { kind: "ok", icon: "★", ms: 3200 });
    wasLeader = leader;
    render();
  }

  if (!booted) {
    booted = true;
    queueMicrotask(() => node.isConnected && hh.sequence([{ ms: 1300, cls: "boot", render: () => bootScreen({ lines: bootLines(), ms: 1100 }), enter: () => playSfx("device_boot", { volume: 0.6 }) }]));
  }
  return { node, update };
}
