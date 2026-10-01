// Angry Thud's Revenge on a phone (or a laptop), inside the CPI handheld. The whole page is the
// device: the screen takes every spare pixel and shows the battlefield, following what matters to
// you (your build zone, the sling when it's your shot, your bird in flight), with a HUD on the glass
// for what you need right now (corruption, the weather, your bird, and a bar with whatever you have
// to do before the timer runs out: ready, place, skip, give a bird). Everything else lives in the
// device's menu, the bar of tabs printed under the screen: BIRDS, BUILD, SKY, TEAM, MENU. On a phone
// a tab slides a sheet over the screen (GAME closes it); on a wide screen the tab's page sits beside
// the device instead, and the screen stays whole.
//
// The device's own buttons do the playing: the d-pad aims (◀ ▶ angle, ▲ ▼ power) or moves what
// you're placing, A launches / uses your bird's ability / confirms, B cancels, X picks your next bird,
// Y shows the whole map. You can also drag back on the screen like a slingshot.
// Keyboard: arrows, Space / Enter, Esc, X, M, and 1–6 for the menu tabs.
//
// Aim, steering and your build cursor go over tools.stream (fire-and-forget); everything that
// changes the game (launch, ability, build, donate…) over tools.request, and the server decides.

import { el } from "../common.js";
import { animateBirds } from "../cpi/bird.js";
import { createHandheld, dpad, faceButton, systemCard } from "../cpi/handheld.js";
import { isMuted, playSfx, setMuted, soundControl } from "./mycob-sound.js";
import { birdType, SKINS } from "./thud-birds.js";
import { abilityHow } from "./thud-howto.js";
import { aimFromPull, clearOf, placement } from "./thud-rules.js";
import { closeTutorial, FIRST_CARDS, showHintOnce, showTutorial, tutorialSeen } from "./thud-tutorial.js";
import { birdBadge, birdCards, cowBand, forecastPanel, gameTitle, launchSteps, levelCard, liveTimer, meters, overReport, PHASE_TITLE, processBanner } from "./thud-ui.js";
import { createThudView } from "./thud-world.js";

/** Steam My Deck's cover art for this game. */
export { paintCover as cover } from "./thud-ui.js";

const buzz = (pattern) => {
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(pattern);
};

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** A button that fires on press (quicker for a game), and on Enter / Space for keyboards. */
function tappable(button, fn) {
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

/** Held down: repeats `fn` while pressed (d-pad nudges), or calls down / up once (steering). */
function holdable(button, { down, up, repeat = null }) {
  let timer = 0;
  let held = false;
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (button.disabled) return;
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable: it still works, it just lets go on leave.
    }
    held = true;
    button.classList.add("pressed");
    down?.();
    if (repeat) {
      repeat();
      timer = setInterval(repeat, 70);
    }
  });
  const release = () => {
    if (!held) return;
    held = false;
    button.classList.remove("pressed");
    clearInterval(timer);
    up?.();
  };
  for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) button.addEventListener(type, release);
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  return button;
}

function muteButton() {
  const b = el("button", { class: "cpi-hh-sysbtn", type: "button" });
  const paint = () => {
    b.textContent = isMuted() ? "🔇" : "🔊";
    b.setAttribute("aria-label", isMuted() ? "Sound off (tap for on)" : "Sound on (tap for off)");
  };
  b.addEventListener("click", () => {
    setMuted(!isMuted());
    paint();
    playSfx("ui_click");
  });
  paint();
  return b;
}

const ACTION_LABEL = { AIM: "LAUNCH", FLIGHT: "ABILITY", BUILD: "PLACE" };

/** The device's menu, in the order it's printed under the screen. */
const TABS = [
  { id: "game", icon: "🎮", label: "GAME", title: "Game" },
  { id: "birds", icon: "🐦", label: "BIRDS", title: "Your birds" },
  { id: "build", icon: "🔨", label: "BUILD", title: "Build" },
  { id: "sky", icon: "⛅", label: "SKY", title: "Weather" },
  { id: "team", icon: "👥", label: "TEAM", title: "Team" },
  { id: "menu", icon: "☰", label: "MENU", title: "Menu" },
];

const WEATHER_ICON = { wind: "🌬️", strong_wind: "🌬️", tornado: "🌪️", dust_storm: "🌫️", acid_rain: "🧪", heavy_rain: "🌧️", hailstorm: "🧊", flood: "🌊", lightning_storm: "⚡", thunderstorm: "⛈️", fog: "🌫️", heat_wave: "🔥", earthquake: "🌋" };

/** Wide enough to put the menu's pages beside the device rather than over its screen. */
const WIDE = "(orientation: landscape) and (min-width: 1200px)";

function buildScreen(s, tools) {
  const g0 = s.game;
  const me = g0.you.playerId;
  let g = g0;
  let room = s;
  let phase = null;
  let paused = false;
  const aim = { a: 38, p: 0.75 };
  let aimDirty = false;
  let lastAimSent = 0;
  let placing = null;
  let steer = 0;
  let tab = "game";
  const wideQuery = globalThis.matchMedia?.(WIDE);
  let wide = wideQuery?.matches === true;

  const request = async (action, payload = {}) => {
    const result = await tools.request("game:input", { action, payload });
    if (!result.ok) {
      hh.notify(result.message ?? "That didn't work.", { kind: "danger", icon: "✗", ms: 2600 });
      buzz([30, 40, 30]);
    }
    return result;
  };

  // ---------------------------------------------------------------- the device

  const timer = liveTimer();
  const left = el("button", { class: "cpi-hh-dir", type: "button", "aria-label": "Left (angle up / move left)" }, "◀");
  const right = el("button", { class: "cpi-hh-dir", type: "button", "aria-label": "Right (angle down / move right)" }, "▶");
  const up = el("button", { class: "cpi-hh-dir", type: "button", "aria-label": "More power" }, "▲");
  const down = el("button", { class: "cpi-hh-dir", type: "button", "aria-label": "Less power" }, "▼");
  const aBtn = faceButton("A", { label: "LAUNCH", cls: "l-A", keyHint: "Space" });
  const bBtn = faceButton("B", { label: "BACK", cls: "l-B", keyHint: "Esc" });
  const xBtn = faceButton("X", { label: "NEXT BIRD", cls: "l-X", keyHint: "X" });
  const yBtn = faceButton("Y", { label: "MAP", cls: "l-Y", keyHint: "M" });
  const leftGrip = el("div", { class: "cpi-hh-cluster" }, dpad({ left, right, up, down }));
  const rightGrip = el("div", { class: "cpi-hh-cluster td-face" }, el("div", { class: "cpi-hh-abxy real" }, yBtn, xBtn, bBtn, aBtn));

  // The menu bar, printed on the bezel under the screen.
  const tabButtons = new Map();
  const tabBar = el(
    "div",
    { class: "td-tabs", role: "tablist", "aria-label": "Device menu" },
    TABS.map((t, i) => {
      const badge = el("span", { class: "td-tab-badge", "aria-hidden": "true", hidden: true });
      const b = el("button", { class: `td-tab t-${t.id}`, type: "button", role: "tab", id: `td-tab-${t.id}`, "aria-selected": "false", "aria-controls": "td-sheet", title: `${t.title} (${i + 1})` }, el("span", { class: "td-tab-icon", "aria-hidden": "true", text: t.icon }), el("span", { class: "td-tab-label", text: t.label }), badge);
      b.addEventListener("click", () => setTab(t.id === tab && t.id !== "game" && !wide ? "game" : t.id, { user: true }));
      tabButtons.set(t.id, { b, badge });
      return b;
    }),
  );
  const hh = createHandheld({ title: gameTitle(), owner: g0.roster.find((p) => p.id === me)?.name?.toUpperCase() ?? null, layout: "auto", left: leftGrip, right: rightGrip, label: gameTitle(), className: "sd-device td-device td-phone", under: tabBar });
  hh.setStatus({ extra: [timer.node, muteButton()] });
  const howTo = () => showTutorial(g, { me });

  const canvas = el("canvas", { class: "sd-canvas td-canvas", "aria-label": "The battlefield. Drag back from the slingshot to aim." });
  hh.screen.append(canvas);
  const view = createThudView(canvas, {
    mode: "phone",
    you: me,
    sound: true,
    windBadge: false,
    onFx: (e) => {
      if (e.t === "boom" || e.t === "quake") buzz(e.t === "quake" ? [80, 60, 80] : 40);
    },
  });
  view.setAim(() => aim);

  // The HUD on the glass: corruption and the Red Cow (top left), the sky (top right), and the bar
  // along the bottom: your bird, what's happening, and whatever you have to do about it.
  const corrFill = el("span", { class: "td-hud-fill" });
  const corrValue = el("span", { class: "td-hud-value" });
  const cowValue = el("span", { class: "td-hud-cow" });
  const cowFill = el("span", { class: "td-hud-fill" });
  const corrChip = el("div", { class: "td-hud-chip corruption", role: "meter", "aria-label": "Corruption", "aria-valuemin": "0", "aria-valuemax": "100" }, el("span", { class: "td-hud-label", text: "☣" }), el("span", { class: "td-hud-bar" }, corrFill), corrValue);
  const cowChip = el("div", { class: "td-hud-chip cow", role: "meter", "aria-label": "Red Cow construction", "aria-valuemin": "0", "aria-valuemax": "100" }, el("span", { class: "td-hud-label", text: "🐄" }), el("span", { class: "td-hud-bar" }, cowFill), cowValue);
  // The objective, always on the glass: what wins and what loses.
  const goal = el("p", { class: "td-hud-goal" }, el("span", { class: "win", text: "WIN: ☣ → 0%" }), el("span", { class: "lose", text: "LOSE: 🐄 → 100%" }));
  const skyChip = el("button", { class: "td-hud-chip sky", type: "button" });
  skyChip.addEventListener("click", () => setTab("sky", { user: true }));
  const hudTop = el("div", { class: "td-hud-top" }, el("div", { class: "td-hud-meters" }, corrChip, cowChip, goal), skyChip);
  const birdChip = el("button", { class: "td-bird-chip", type: "button", "aria-label": "Your birds" });
  birdChip.addEventListener("click", () => setTab("birds", { user: true }));
  const barMain = el("div", { class: "td-bar-main", role: "status" });
  // One short line saying what's happening and what you should do: the coach.
  const coach = el("p", { class: "td-coach", "aria-live": "polite" });
  const bar = el("div", { class: "td-bar" }, coach, birdChip, barMain);
  hh.screen.append(hudTop, bar);

  // The menu's page: a sheet over the screen on a phone, a column beside the device when wide.
  const sheetTitle = el("h2", { class: "td-sheet-title" });
  const sheetClose = el("button", { class: "td-sheet-close", type: "button", "aria-label": "Back to the game", text: "✕" });
  sheetClose.addEventListener("click", () => setTab("game", { user: true }));
  const sheetBody = el("div", { class: "td-sheet-body" });
  const sheet = el("section", { class: "td-sheet", id: "td-sheet", role: "tabpanel", hidden: true }, el("header", { class: "td-sheet-head" }, sheetTitle, sheetClose), sheetBody);
  const aside = el("aside", { class: "td-aside", "aria-label": "Device menu" });
  const node = el("div", { class: "td-phone-wrap" }, hh.node, aside);

  // Clicked buttons let go of focus, so Space / Enter go back to launching, not re-pressing them.
  node.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest("button") : null;
    if (b && e.detail > 0) b.blur();
  });

  const mine = () => g.roster.find((p) => p.id === me);
  const shooting = () => g.phase === "ACTION" && g.action?.shooterId === me;
  const stage = () => (shooting() ? g.action.stage : null);

  // ---------------------------------------------------------------- aiming

  const sendAim = (force = false) => {
    if (!shooting() || stage() !== "AIM") return;
    const now = performance.now();
    if (!force && now - lastAimSent < 66) {
      aimDirty = true;
      return;
    }
    aimDirty = false;
    lastAimSent = now;
    tools.stream({ a: aim.a, p: aim.p });
  };
  const aimTimer = setInterval(() => {
    if (!node.isConnected) return clearInterval(aimTimer);
    if (aimDirty) sendAim(true);
  }, 80);
  const nudgeAim = (da, dp) => {
    aim.a = Math.max(g.level.sling.minAngle, Math.min(g.level.sling.maxAngle, Math.round((aim.a + da) * 10) / 10));
    aim.p = Math.max(g.level.sling.minPower, Math.min(1, Math.round((aim.p + dp) * 100) / 100));
    sendAim();
    if (Math.random() < 0.3) playSfx("thud_stretch", { volume: 0.4 });
  };
  const launch = async () => {
    buzz(30);
    await request("launch", { angle: aim.a, power: aim.p });
  };

  // Drag back on the screen, like a slingshot (anywhere: it's the direction and length that count).
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (placing) {
      const [wx] = view.toWorld(e.clientX, e.clientY);
      movePlacement(wx, true);
      drag = { place: true };
      canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (stage() === "FLIGHT") return useAbility();
    if (stage() !== "AIM") return;
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.place) {
      const [wx] = view.toWorld(e.clientX, e.clientY);
      return movePlacement(wx, true);
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) < 8) return;
    const next = aimFromPull(dx, dy, { maxPull: Math.min(220, canvas.clientWidth * 0.35), minAngle: g.level.sling.minAngle, maxAngle: g.level.sling.maxAngle, minPower: g.level.sling.minPower });
    aim.a = next.angle;
    aim.p = next.power;
    sendAim();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const wasPlace = drag.place;
    const dx = e.clientX - (drag.x ?? 0);
    const dy = e.clientY - (drag.y ?? 0);
    drag = null;
    if (!wasPlace && Math.hypot(dx, dy) > 30 && stage() === "AIM") launch();
  });
  canvas.addEventListener("pointercancel", () => (drag = null));

  const useAbility = async () => {
    const type = g.action?.flying?.bird;
    const ab = birdType(type)?.ability;
    if (!ab || ab.trigger !== "tap") return;
    buzz(25);
    await request("ability");
  };
  const setSteer = (dir) => {
    if (steer === dir) return;
    steer = dir;
    tools.stream({ s: dir });
  };

  // ---------------------------------------------------------------- building

  const def = (type) => g.build.catalog.find((c) => c.type === type);
  const startPlacing = (type) => {
    const d = def(type);
    const cursor = mine()?.cursor;
    placing = { type, w: d.w, h: d.h, x: cursor ?? (g.level.zones[0][0] + g.level.zones[0][1]) / 2, ok: false, reason: "" };
    // Placing happens on the battlefield: the sheet gets out of the way.
    if (!wide) setTab("game");
    movePlacement(placing.x, true);
    refresh(true);
  };
  const movePlacement = (x, stream) => {
    if (!placing) return;
    const spot = placement({ x, w: placing.w, h: placing.h }, { zones: g.level.zones, groundY: g.level.groundY, clear: clearOf(g.world.rows) });
    Object.assign(placing, { x: spot.x, ok: spot.ok, reason: spot.reason });
    view.setGhost({ type: placing.type, x: placing.x, w: placing.w, h: placing.h, ok: placing.ok });
    if (stream) tools.stream({ bx: placing.x });
    renderBar(false);
  };
  const cancelPlacing = () => {
    placing = null;
    view.setGhost(null);
    refresh(true);
  };
  const confirmPlacing = async () => {
    if (!placing) return;
    const { type, x } = placing;
    const result = await request("build", { type, x });
    if (result.ok) {
      buzz(40);
      cancelPlacing();
    }
  };

  // ---------------------------------------------------------------- buttons and keys

  holdable(left, { repeat: () => (placing ? movePlacement(placing.x - 10, true) : stage() === "AIM" ? nudgeAim(1, 0) : null), down: () => stage() === "FLIGHT" && setSteer(-1), up: () => setSteer(0) });
  holdable(right, { repeat: () => (placing ? movePlacement(placing.x + 10, true) : stage() === "AIM" ? nudgeAim(-1, 0) : null), down: () => stage() === "FLIGHT" && setSteer(1), up: () => setSteer(0) });
  holdable(up, { repeat: () => stage() === "AIM" && nudgeAim(0, 0.02) });
  holdable(down, { repeat: () => stage() === "AIM" && nudgeAim(0, -0.02) });
  const primary = () => {
    if (placing) return confirmPlacing();
    if (stage() === "AIM") return launch();
    if (stage() === "FLIGHT") return useAbility();
  };
  const nextBird = () => {
    const p = mine();
    if (p?.birds.length > 1) request("select", { index: (p.selected + 1) % p.birds.length });
  };
  const toggleMap = () => view.setCamera(view.camera === "map" ? "auto" : "map");
  tappable(aBtn, primary);
  tappable(bBtn, () => (placing ? cancelPlacing() : tab !== "game" && !wide ? setTab("game") : null));
  tappable(xBtn, nextBird);
  tappable(yBtn, toggleMap);
  const onKey = (e) => {
    if (!node.isConnected) return removeEventListener("keydown", onKey);
    if (e.target?.closest?.("input, textarea, select")) return;
    const k = e.key;
    // A focused button (reached with Tab) takes its own Enter / Space.
    if ((k === " " || k === "Enter") && e.target?.closest?.("button, a")) return;
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const dir = k === "ArrowLeft" ? -1 : 1;
      if (placing) movePlacement(placing.x + dir * 10, true);
      else if (stage() === "AIM") nudgeAim(-dir, 0);
      else if (stage() === "FLIGHT" && !e.repeat) setSteer(dir);
    } else if (k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      if (stage() === "AIM") nudgeAim(0, k === "ArrowUp" ? 0.02 : -0.02);
    } else if ((k === " " || k === "Enter") && !e.repeat) {
      e.preventDefault();
      primary();
    } else if (k === "Escape") {
      if (placing) cancelPlacing();
      else if (tab !== "game") setTab("game", { user: true });
    } else if (k === "x" || k === "X") nextBird();
    else if (k === "m" || k === "M") toggleMap();
    else if (/^[1-6]$/.test(k) && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) setTab(TABS[Number(k) - 1].id, { user: true });
  };
  const onKeyUp = (e) => {
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && stage() === "FLIGHT") setSteer(0);
  };
  addEventListener("keydown", onKey);
  addEventListener("keyup", onKeyUp);

  // ---------------------------------------------------------------- the menu

  const btn = (text, fn, cls = "") => {
    const b = el("button", { class: `btn ${cls}`.trim(), type: "button", text });
    b.addEventListener("click", fn);
    return b;
  };
  const h = (text) => el("h3", { class: "td-h", text });

  /** Which page a wide screen shows beside the device when you haven't picked one. */
  const phaseTab = () => {
    if (g.phase === "BUILD") return "build";
    if (g.phase === "OVER" || g.phase === "PROCESS" || g.phase === "COW") return "team";
    if (g.phase === "ACTION" && g.action?.stage === "NEED_BIRD" && g.action.shooterId !== me) return "team";
    return "birds";
  };
  const shownTab = () => (wide && tab === "game" ? phaseTab() : tab);

  function setTab(next, { user = false } = {}) {
    if (next === "game" && wide) next = phaseTab();
    if (user) playSfx("ui_click");
    const changed = next !== tab;
    tab = next;
    for (const [id, { b }] of tabButtons) {
      const on = id === shownTab() || (id === "game" && tab === "game");
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    const open = shownTab() !== "game";
    if (!wide) {
      if (open && sheet.hidden) {
        sheet.hidden = false;
        sheet.classList.remove("leaving");
      } else if (!open && !sheet.hidden) {
        sheet.classList.add("leaving");
        setTimeout(() => sheet.classList.contains("leaving") && ((sheet.hidden = true), sheet.classList.remove("leaving")), reducedMotion() ? 0 : 160);
      }
    }
    sheet.setAttribute("aria-labelledby", `td-tab-${shownTab()}`);
    if (changed || open) renderSheet(true);
  }

  /** Put the menu's page where it goes for this screen size. */
  function place() {
    wide = wideQuery?.matches === true;
    node.classList.toggle("wide", wide);
    if (wide) {
      aside.append(sheet);
      sheet.hidden = false;
      sheet.classList.remove("leaving");
    } else {
      hh.screen.append(sheet);
      sheet.hidden = tab === "game";
    }
    setTab(tab);
  }
  wideQuery?.addEventListener?.("change", () => node.isConnected && place());

  function birdsPage() {
    const p = mine();
    if (!p) return [];
    if (g.phase === "SELECT") {
      const skins = el(
        "div",
        { class: "td-skins", role: "radiogroup", "aria-label": "Skin (looks only)" },
        SKINS.map((skin) => {
          const b = el("button", { class: `td-skin ${p.skin === skin.id ? "on" : ""}`, type: "button", role: "radio", "aria-checked": String(p.skin === skin.id) }, birdBadge(p.bird, skin.id, { size: 40 }), el("span", { text: skin.name }));
          b.addEventListener("click", () => request("choose", { skin: skin.id }));
          return b;
        }),
      );
      animateBirds([...skins.querySelectorAll("canvas")]);
      return [h("1 · Pick your bird (how it plays)"), birdCards(p.bird, p.skin, (bird) => request("choose", { bird })), h("2 · Pick a skin (just looks)"), skins];
    }
    const out = [];
    const canvases = [];
    out.push(h(p.birds.length ? `Your birds · ${p.birds.length}` : "No birds · ask the team for one"));
    out.push(
      el(
        "div",
        { class: "td-inventory", role: "radiogroup", "aria-label": "Your birds" },
        p.birds.map((type, i) => {
          const c = birdBadge(type, p.skin, { size: 40 });
          canvases.push(c);
          const b = el("button", { class: `td-inv ${i === p.selected ? "on" : ""}`, type: "button", role: "radio", "aria-checked": String(i === p.selected), "aria-label": `${birdType(type)?.name}${i === p.selected ? " (selected)" : ""}` }, c, el("span", { class: "td-inv-name", text: birdType(type)?.name ?? "" }));
          b.addEventListener("click", () => request("select", { index: i }));
          return b;
        }),
      ),
    );
    const type = p.birds[p.selected];
    const b = birdType(type ?? p.bird);
    if (b) {
      const c = birdBadge(b.id, p.skin, { size: 64, state: "fly" });
      canvases.push(c);
      out.push(
        el(
          "div",
          { class: "td-bird-card" },
          c,
          el("div", {}, el("p", { class: "td-bird-name", text: `${b.icon} ${b.name}` }), el("p", { class: "td-bird-role", text: `${b.title} · ${b.role}` }), el("p", { class: "td-bird-blurb", text: b.blurb }), el("p", { class: "td-bird-how", text: `HOW: ${abilityHow(b)}` })),
        ),
      );
    }
    if (g.phase === "BUILD") {
      out.push(h("More birds"));
      const crate = btn(`Buy a ${birdType(p.bird)?.name ?? "bird"} crate · ${g.build.birdCrate} 🌽`, () => request("buy_bird"), "ghost");
      crate.disabled = g.kernels.balance < g.build.birdCrate;
      out.push(crate);
      for (const tank of g.build.structures.filter((q) => q.type === "clone")) {
        const cb = btn(type ? `🧪 Clone my ${birdType(type)?.name} (one use)` : "🧪 Clone tank (you need a bird to copy)", () => request("clone", { tank: tank.id }), "ghost");
        cb.disabled = !type || tank.disabled > 0;
        out.push(cb);
      }
    }
    animateBirds(canvases);
    return out;
  }

  function buildPage() {
    const out = [];
    const k = g.kernels.balance;
    const open = g.phase === "BUILD";
    out.push(el("p", { class: "td-page-lead" }, el("strong", { text: `🌽 ${k} team kernels` }), open ? " · one pile, shared by everyone. Pick something, then place it in your zone." : " · one pile, shared by everyone. You can spend them in the next Build Phase."));
    const hurt = g.build.structures.filter((q) => q.maxHp && q.hp < q.maxHp * 0.5);
    if (hurt.length) out.push(el("p", { class: "td-alert", text: `⚠ Needs protection: ${hurt.map((q) => `${def(q.type)?.name ?? q.type} ${Math.round((q.hp / q.maxHp) * 100)}%`).join(", ")}` }));
    out.push(
      el(
        "div",
        { class: "td-catalog" },
        g.build.catalog.map((c) => {
          const full = c.count >= c.max;
          const b = el("button", { class: "td-build", type: "button", disabled: !open || full || k < c.cost }, el("strong", { text: c.name }), el("span", { class: "mono", text: `${c.cost} 🌽 · ${c.count}/${c.max}${full ? " MAX" : ""}` }), el("span", { class: "td-build-blurb", text: c.blurb }));
          b.addEventListener("click", () => startPlacing(c.type));
          return b;
        }),
      ),
    );
    return out;
  }

  const forecast = forecastPanel();
  function skyPage() {
    const out = [];
    const w = g.weather;
    const wind = g.world.wind ?? 0;
    if (w) out.push(el("p", { class: "td-sky-now" }, el("span", { class: "td-sky-icon", text: WEATHER_ICON[w.type] ?? "☁️" }), el("span", {}, el("strong", { text: w.label.toUpperCase() }), ` · ${w.severity}${w.secondary ? ` + ${w.secondary}` : ""}${wind ? ` · wind ${wind > 0 ? "→" : "←"} ${Math.abs(Math.round(wind / 10))}` : ""}`)));
    else if (!g.forecast) out.push(el("p", { class: "td-page-lead", text: "No weather right now, and no Weather Machine to say what's coming. Build one in BUILD (it's cheap)." }));
    else out.push(el("p", { class: "td-page-lead", text: g.phase === "BUILD" ? "Weather hits when the shooting starts. Here's what the machine sees coming:" : "No weather right now." }));
    if (g.forecast) {
      forecast.update(g);
      out.push(forecast.node);
    }
    const f = g.forecast;
    if (g.phase === "BUILD") {
      if (f?.status === "BROKEN") out.push(btn(`Repair Weather Machine · ${f.repair} 🌽`, () => request("repair_weather")));
      else if (f?.next) out.push(btn(`Upgrade to ${f.next.name} · ${f.next.price} 🌽`, () => request("upgrade_weather"), "ghost"));
      else if (!f) out.push(el("p", { class: "muted", text: "Build a Weather Machine (BUILD tab) to see what's coming." }));
    }
    return out;
  }

  const teamMeters = meters();
  function teamPage() {
    if (g.phase === "OVER") return [overReport({ ...g, scores: Object.fromEntries(room.players.map((q) => [q.id, q.score])) }, { me })];
    const out = [];
    teamMeters.update(g);
    out.push(teamMeters.node);
    const p = mine();
    const give = p?.birds[p.selected];
    const a = g.action;
    const rows = g.roster.map((q) => {
      const tags = [];
      if (!q.here) tags.push("AWAY");
      if (g.phase === "SELECT") tags.push(q.ready ? "READY" : "PICKING");
      if (g.phase === "BUILD" && q.vote) tags.push("SKIP ✓");
      if (a?.shooterId === q.id) tags.push(a.stage === "NEED_BIRD" ? "NEEDS A BIRD" : "SHOOTING");
      else if (a && a.queue.indexOf(q.id) > a.index) tags.push(`UP IN ${a.queue.indexOf(q.id) - a.index}`);
      const c = birdBadge(q.birds[q.selected] ?? q.bird, q.skin, { size: 32 });
      const needs = q.id !== me && q.here && q.birds.length === 0 && (g.phase === "BUILD" || g.phase === "ACTION");
      const gift = needs && give ? btn(`🎁 Give ${birdType(give)?.name}`, () => request("donate", { to: q.id, index: p.selected }), "small") : null;
      // The page's CSP allows styles set through the CSSOM, not style attributes.
      const dot = el("i", { class: "td-dot" });
      dot.style.setProperty("background", q.color);
      return el("li", { class: q.id === me ? "me" : "" }, c, el("span", { class: "td-team-name" }, dot, q.id === me ? `${q.name} (you)` : q.name), el("span", { class: "mono td-team-birds", text: `🐦×${q.birds.length}` }), el("span", { class: "td-team-tags", text: tags.join(" · ") }), gift);
    });
    animateBirds(rows.map((r) => r.querySelector("canvas")).filter(Boolean));
    out.push(h("The team"), el("ul", { class: "td-team" }, rows));
    const nests = g.build.structures.filter((q) => q.type === "nest");
    if (nests.length) {
      out.push(h("Nests · breeding"));
      for (const n of nests) {
        const joined = n.breeders.includes(me);
        const others = n.breeders.filter((id) => id !== me).map((id) => g.roster.find((q) => q.id === id)?.name);
        const label = g.phase !== "BUILD" ? "Breed in the Build Phase" : n.breeds ? "Bred this turn" : joined ? "Waiting for a partner… (tap to leave)" : others.length ? `Breed with ${others.join(", ")} · ${g.build.breedCost} 🌽` : `Breed here · ${g.build.breedCost} 🌽 · needs 2`;
        const b = btn(`🥚 Nest ${Math.round((n.progress ?? 0) * 100)}% · ${label}`, () => request("breed", { nest: n.id }), others.length && !joined ? "" : "ghost");
        b.disabled = g.phase !== "BUILD" || n.breeds > 0 || n.disabled > 0 || n.waterlogged;
        out.push(b);
      }
    }
    return out;
  }

  const sound = soundControl();
  function menuPage() {
    const mapBtn = btn(view.camera === "map" ? "🗺 Back to the action view" : "🗺 Show the whole map", () => {
      toggleMap();
      renderSheet(true);
    }, "ghost");
    return [
      btn("? How to play (the tutorial)", howTo, ""),
      mapBtn,
      h("Sound"),
      sound,
      h("Controls"),
      el(
        "table",
        { class: "td-controls" },
        el(
          "tbody",
          {},
          [
            ["Aim", "Drag back on the screen · ◀ ▶ ▲ ▼", "← → ↑ ↓"],
            ["Launch", "Let go · A", "Space / Enter"],
            ["Ability", "Tap the screen · A (hold ◀ ▶ to glide)", "Space (hold ← →)"],
            ["Next bird", "X · tap your bird", "X"],
            ["Build", "BUILD tab · drag or ◀ ▶ · A to place", "← → · Enter · Esc"],
            ["Map", "Y", "M"],
            ["Menu", "The tabs under the screen", "1–6 · Esc"],
          ].map(([what, touch, keys]) => el("tr", {}, el("th", { scope: "row", text: what }), el("td", { text: touch }), el("td", { class: "mono", text: keys }))),
        ),
      ),
    ];
  }

  const PAGES = { birds: birdsPage, build: buildPage, sky: skyPage, team: teamPage, menu: menuPage };
  let sheetKey = "";

  /** What each page shows, as a key: a page only redraws when that changes. */
  function pageKey(id) {
    const p = mine();
    const a = g.action;
    switch (id) {
      case "birds":
        return JSON.stringify([g.phase, p?.bird, p?.skin, p?.birds, p?.selected, g.phase === "BUILD" ? [g.kernels.balance >= g.build.birdCrate, g.build.structures.filter((q) => q.type === "clone").map((q) => [q.id, q.disabled])] : null]);
      case "build":
        return JSON.stringify([g.phase, g.kernels.balance, g.build.catalog.map((c) => c.count), g.build.structures.map((q) => [q.id, q.maxHp && q.hp < q.maxHp * 0.5 ? Math.round((q.hp / q.maxHp) * 100) : 0])]);
      case "sky":
        return JSON.stringify([g.phase, g.weather, g.forecast, g.world.wind, g.turn]);
      case "team":
        return JSON.stringify([g.phase, g.phase === "OVER" ? g.over : null, g.roster.map((q) => [q.birds.length, q.selected, q.ready, q.vote, q.here]), a ? [a.shooterId, a.stage, a.index] : null, g.build.structures.filter((q) => q.type === "nest").map((q) => [q.id, q.breeders, q.breeds, q.disabled, q.waterlogged, Math.round((q.progress ?? 0) * 10)]), p?.selected, g.corruption, g.cow.progress, g.kernels.balance]);
      default:
        return id;
    }
  }

  function renderSheet(force) {
    const id = shownTab();
    if (id === "game") return;
    const key = `${id}:${pageKey(id)}`;
    if (!force && key === sheetKey) return;
    sheetKey = key;
    const t = TABS.find((x) => x.id === id);
    sheetTitle.textContent = t.title.toUpperCase();
    sheetBody.replaceChildren(...PAGES[id]().filter(Boolean));
  }

  /** Little marks on the tabs: something there wants you. */
  function paintBadges() {
    const p = mine();
    const set = (id, text, kind = "") => {
      const { badge } = tabButtons.get(id);
      badge.textContent = text;
      badge.className = `td-tab-badge ${kind}`.trim();
      badge.hidden = !text;
    };
    set("birds", p && g.phase !== "SELECT" && g.phase !== "LAUNCH" ? String(p.birds.length) : "", p && p.birds.length === 0 ? "warn" : "");
    set("build", g.phase === "BUILD" ? "●" : "", "ok");
    const f = g.forecast;
    set("sky", g.weather ? "!" : f?.status === "BROKEN" ? "!" : "", g.weather ? "warn" : "danger");
    const needy = g.roster.some((q) => q.id !== me && q.here && q.birds.length === 0 && (g.phase === "BUILD" || g.phase === "ACTION"));
    const partner = g.phase === "BUILD" && g.build.structures.some((q) => q.type === "nest" && !q.breeds && q.breeders.length === 1 && q.breeders[0] !== me);
    set("team", g.phase === "OVER" ? "★" : needy || partner ? "!" : "", g.phase === "OVER" ? "ok" : "warn");
  }

  // ---------------------------------------------------------------- the HUD

  let hudKey = "";
  function renderHud() {
    const c = g.corruption;
    corrFill.style.setProperty("--pct", `${c}%`);
    corrValue.textContent = `${c.toFixed(c % 1 ? 1 : 0)}%`;
    corrChip.setAttribute("aria-valuenow", String(Math.round(c)));
    corrChip.title = `Corruption ${c}%: get it to 0% to win`;
    const cowPct = Math.round(g.cow.progress * 100);
    cowFill.style.setProperty("--pct", `${cowPct}%`);
    cowValue.textContent = `${cowPct}%`;
    cowChip.setAttribute("aria-valuenow", String(cowPct));
    cowChip.title = `Red Cow ${cowPct}% built: if it reaches 100%, the team loses`;
    cowChip.classList.toggle("danger", g.cow.progress >= 0.6);
    const w = g.weather;
    const wind = g.world.wind ?? 0;
    const windText = wind ? ` ${wind > 0 ? "→" : "←"}${Math.abs(Math.round(wind / 10))}` : "";
    let sky = "";
    let kind = "";
    if (w && (g.phase === "ACTION" || g.phase === "PROCESS")) {
      sky = `${WEATHER_ICON[w.type] ?? "☁️"} ${w.label.toUpperCase()}${windText}`;
      kind = "warn";
    } else {
      const line = g.forecast?.status === "OK" ? g.forecast.lines?.find((l) => !l.clear) : null;
      if (g.forecast?.status === "BROKEN") [sky, kind] = ["📡 MACHINE BROKEN", "danger"];
      else if (line) sky = `📡 NEXT: ${line.label ? line.label.toUpperCase() : line.category}`;
      else if (g.forecast?.status === "OK") sky = "📡 CLEAR AHEAD";
      else sky = "☁️ SKY: ?";
    }
    const hurt = g.phase === "BUILD" ? g.build.structures.filter((q) => q.maxHp && q.hp < q.maxHp * 0.5).length : 0;
    if (hurt) [sky, kind] = [`⚠ ${hurt} HURT · ${sky}`, "danger"];
    skyChip.textContent = sky;
    skyChip.className = `td-hud-chip sky ${kind}`.trim();
    skyChip.setAttribute("aria-label", `Weather: ${sky}. Open the SKY tab.`);
    const p = mine();
    const type = p?.birds[p.selected] ?? p?.bird;
    const key = JSON.stringify([type, p?.skin, p?.birds.length, g.phase === "SELECT" || g.phase === "LAUNCH"]);
    if (key !== hudKey) {
      hudKey = key;
      const b = birdType(type);
      const c2 = birdBadge(type, p?.skin ?? "classic", { size: 34 });
      const n = p?.birds.length ?? 0;
      birdChip.replaceChildren(c2, el("span", { class: "td-bird-chip-text" }, el("strong", { text: b?.name ?? "—" }), el("span", { text: g.phase === "SELECT" || g.phase === "LAUNCH" ? "PICK" : n ? `${n} LEFT` : "NONE" })));
      birdChip.setAttribute("aria-label", `Your bird: ${b?.name ?? "none"}, ${p?.birds.length ?? 0} in hand. Open BIRDS.`);
      birdChip.classList.toggle("empty", !p?.birds.length);
      animateBirds([c2]);
    }
  }

  /** A bar button. `short` is what it says when the bar is narrow (a small phone). */
  const act = (text, fn, cls = "", short = null) => {
    const b = el("button", { class: `td-act ${cls}`.trim(), type: "button", "aria-label": text }, el("span", { class: "full", text }), short ? el("span", { class: "short", "aria-hidden": "true", text: short }) : null);
    if (!short) b.classList.add("one");
    b.addEventListener("click", fn);
    return b;
  };
  const say = (text, cls = "") => el("span", { class: `td-say ${cls}`.trim(), text });
  let barKey = "";

  const names = (ids) => ids.map((id) => (id === me ? "YOU" : g.roster.find((q) => q.id === id)?.name ?? "?"));

  /** One line: which phase this is, whose turn, and what you should do next. */
  function coachText() {
    const p = mine();
    const a = g.action;
    const st = stage();
    if (placing) return ["PLACING · drag or ◀ ▶ to move it inside your zone, then ✓ PLACE", ""];
    switch (g.phase) {
      case "LAUNCH":
        return [`Loading ${g.level.name}…`, ""];
      case "SELECT":
        return p?.ready ? ["Ready ✓ · waiting for the team", "go"] : ["① Pick a bird  ② Tap READY", "go"];
      case "BUILD":
        return [`BUILD PHASE · spend the team's 🌽 on walls & nests, then SKIP to start shooting`, ""];
      case "ACTION": {
        const shooter = g.roster.find((q) => q.id === a?.shooterId);
        if (a?.stage === "NEED_BIRD") return a.shooterId === me ? ["You're out of birds · a teammate can give you one", "bad"] : [`${shooter?.name} has no birds · give one!`, "bad"];
        if (st === "AIM") return ["YOUR TURN · drag back & let go · hit the 🐷 piggies and their fort", "go"];
        if (st === "FLIGHT") return ["IN FLIGHT", "go"];
        return [`LAUNCH PHASE · ${shooter?.name ?? "?"}'s turn · one bird each`, ""];
      }
      case "PROCESS":
        return ["PIGGIES' TURN · they strike back · just watch", "bad"];
      case "COW":
        return ["RED COW GROWS · at 100% the team loses · purge ☣ faster", "bad"];
      case "OVER":
        return g.over?.result === "victory" ? ["TEAM VICTORY · corruption purged", "go"] : ["TEAM DEFEAT · the Red Cow was finished", "bad"];
    }
    return ["", ""];
  }

  /** The bar along the bottom of the screen: what's happening and what you can do about it now. */
  function renderBar(force) {
    const p = mine();
    const a = g.action;
    const st = stage();
    const key = JSON.stringify([g.phase, a?.stage, a?.shooterId, a?.uses, st === "FLIGHT" ? Math.round((a?.fuel ?? 0) * 10) : null, g.phase === "BUILD" ? [g.kernels.balance, g.build.votes, g.build.needed, p?.vote] : null, placing ? [placing.type, placing.ok, placing.reason] : null, g.phase === "SELECT" ? [p?.ready, p?.bird] : null, a?.stage === "NEED_BIRD" ? [p?.birds.length, p?.selected] : null, g.process?.index, a ? a.queue.indexOf(me) - a.index : null]);
    if (!force && key === barKey) return;
    barKey = key;
    const [line, tone] = coachText();
    coach.textContent = line;
    coach.className = `td-coach ${tone}`.trim();
    coach.hidden = !line;
    const out = [];
    if (placing) {
      const d = def(placing.type);
      out.push(say(placing.ok ? d.name : placing.reason, placing.ok ? "" : "bad"), act(`✓ PLACE ${d.cost}🌽`, confirmPlacing, placing.ok ? "go" : "off", `✓ ${d.cost}🌽`), act("✕", cancelPlacing, "ghost"));
    } else if (g.phase === "SELECT") {
      out.push(act("🐦 PICK BIRD", () => setTab("birds", { user: true }), "ghost", "🐦 BIRD"), act(p?.ready ? "READY ✓" : "READY", () => request("ready", { ready: !p?.ready }), p?.ready ? "done" : "go"));
    } else if (g.phase === "BUILD") {
      const k = g.kernels.balance;
      const votes = `${g.build.votes}/${g.build.needed}`;
      out.push(act(`🔨 BUILD · TEAM 🌽${k}`, () => setTab(tab === "build" && !wide ? "game" : "build", { user: true }), "go", `🔨 🌽${k}`), act(p?.vote ? `SKIP ✓ ${votes}` : `⏭ DONE, SKIP ${votes}`, () => request("vote_skip", { vote: !p?.vote }), p?.vote ? "done" : "ghost", p?.vote ? `✓ ${votes}` : `⏭ ${votes}`));
    } else if (g.phase === "ACTION") {
      const shooter = g.roster.find((q) => q.id === a.shooterId);
      if (a.stage === "NEED_BIRD" && a.shooterId !== me) {
        const type = p?.birds[p.selected];
        out.push(type ? act(`🎁 GIVE ${shooter?.name?.toUpperCase()} YOUR ${birdType(type)?.name?.toUpperCase()}`, () => request("donate", { to: a.shooterId, index: p.selected }), "go", `🎁 GIVE ${shooter?.name?.toUpperCase()} A BIRD`) : say(`${shooter?.name} needs a bird (you have none)`, "bad"));
      } else if (a.stage === "NEED_BIRD") out.push(say("OUT OF BIRDS · waiting for a teammate to give you one", "bad"));
      else if (st === "AIM") {
        const b = birdType(p?.birds[p.selected]);
        out.push(say(b ? `${b.icon} ${b.name} · ability: ${abilityHow(b).replace(/^In flight, /, "in flight, ").replace(/ \(.*\)\.?$|\.$/, "")}` : "Drag back, let go", "go"));
      }
      else if (st === "FLIGHT") {
        const b = birdType(a.flying?.bird);
        const ab = b?.ability;
        const verb = { pop: "POP", boost: "AFTERBURNER", split: "SPLIT", ricochet: "RICOCHET", slam: "SLAM", magnet: "MAGNET", bunker: "BUNKER" }[ab?.kind];
        if (ab?.trigger === "tap") out.push(say(a.uses ? `TAP (or A): ${verb} · ${a.uses} left` : `${verb}: done`, a.uses ? "go" : ""));
        else if (ab?.trigger === "hold") out.push(say(`HOLD ◀ ▶: GLIDE · ${a.fuel.toFixed(1)}s`, "go"));
        else out.push(say(`${b?.name}: ${b?.usage.toLowerCase()}`));
      } else {
        // Turn order, with whoever's shooting in brackets and you marked.
        const pos = a.queue.indexOf(me) - a.index;
        const order = names(a.queue.slice(a.index)).map((n, i) => (i === 0 ? `[${n}]` : n)).join(" ▸ ");
        out.push(say(pos > 0 ? `${order} · you're up in ${pos}` : `${order} · you've fired this turn`));
      }
    } else if (g.phase === "PROCESS") out.push(say(g.process ? `PIGGY TURN ${g.process.index + 1}/${g.process.total} · ${g.process.label}` : "PIGGY TURN", "bad"));
    else if (g.phase === "COW") out.push(say("THE RED COW GROWS", "bad"));
    else if (g.phase === "OVER") out.push(say(g.over?.result === "victory" ? "TEAM VICTORY" : "TEAM DEFEAT", g.over?.result === "victory" ? "go" : "bad"), act("📋 REPORT", () => setTab("team", { user: true }), "go"));
    barMain.replaceChildren(...out);
    aBtn.querySelector(".cpi-hh-label").textContent = placing ? "PLACE" : ACTION_LABEL[st] ?? "A";
  }

  /** Tell the camera what the HUD covers, so it frames the action clear of it. */
  const measure = () => view.setInsets({ top: hudTop.offsetHeight + 8, bottom: bar.offsetHeight + 8 });
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => (node.isConnected ? measure() : ro.disconnect()));
    ro.observe(hudTop);
    ro.observe(bar);
  }

  function refresh(force) {
    renderHud();
    renderBar(force);
    paintBadges();
    renderSheet(force);
  }

  // ---------------------------------------------------------------- phases

  const enter = (next, remainingMs) => {
    const p = next.phase;
    const live = phase !== null;
    if (p !== "BUILD" && placing) cancelPlacing();
    // A phone opens the page this phase needs (choosing a bird, the report); a wide screen shows
    // the phase's page beside the device.
    if (wide) setTab(phaseTab());
    else if (p === "SELECT") setTab("birds");
    else if (p === "OVER") setTab("team");
    else if (p === "LAUNCH") setTab("game");
    if (p === "LAUNCH" && (remainingMs ?? 0) > 3000) hh.sequence(launchSteps(next));
    else if (p === "BUILD") {
      hh.clearOverlay();
      if (live) hh.notify(`BUILD PHASE · the team has ${next.kernels.balance} 🌽 to spend`, { kind: "info", icon: "🔨", replace: true });
    } else if (p === "ACTION") {
      hh.clearOverlay();
      if (live && next.weather) hh.notify(`WEATHER: ${next.weather.label.toUpperCase()} · ${next.weather.severity}`, { kind: "warn", icon: "⛈", ms: 3000 });
      else if (live && next.action?.shooterId !== me) hh.notify("LAUNCH PHASE · everyone fires one bird, in turn", { kind: "info", icon: "🎯", ms: 2600 });
    } else if (p === "PROCESS") hh.overlay(processBanner(next), "band");
    else if (p === "COW") {
      hh.overlay(cowBand(next), "band");
      hh.flash("danger");
      buzz([60, 40, 120]);
    } else if (p === "OVER") hh.overlay(systemCard({ eyebrow: "OPERATION OVER", title: next.over?.result === "victory" ? "TEAM VICTORY" : "TEAM DEFEAT", text: "The report is in TEAM." }), "card");
    else if (p === "SELECT") hh.overlay(levelCard(next), "card");
    phase = p;
  };

  let lastStage = null;
  let lastProcess = null;
  let lastLog = g0.log.at(-1)?.id ?? 0;

  function update(next) {
    room = next;
    g = next.game;
    timer.set(next.timer);
    if (next.paused !== paused) {
      paused = next.paused;
      if (paused) hh.overlay(systemCard({ eyebrow: "SYSTEM", title: "PAUSED", text: "The host display dropped out. Hang on." }), "card");
      else {
        phase = null;
        enter(g, 0);
      }
    }
    if (g.phase !== phase && !paused) enter(g, next.timer?.remainingMs);
    if (g.phase === "PROCESS" && g.process?.index !== lastProcess) {
      lastProcess = g.process?.index;
      hh.overlay(processBanner(g), "band");
    }
    // Your turn: say so, loudly, and clear the glass.
    const st = stage();
    if (st !== lastStage) {
      if (st === "AIM") {
        // Your shot beats the tutorial and any menu page: they get out of the way.
        closeTutorial();
        if (!wide) setTab("game");
        aim.a = g.action.aim.a;
        aim.p = g.action.aim.p;
        hh.notify("YOUR SHOT", { kind: "ok", icon: "🎯", replace: true });
        hh.flash("ok");
        buzz([60, 40, 60]);
        playSfx("achievement");
      }
      // Your bird's in the air: whatever page was open, watch the shot.
      if (st === "FLIGHT" && !wide) setTab("game");
      if (st !== "FLIGHT") setSteer(0);
      lastStage = st;
    }
    if (g.phase === "ACTION" && g.action?.stage === "NEED_BIRD" && g.action.shooterId !== me && mine()?.birds.length) buzz(20);
    // News that's about you (or bad for everyone) reaches your device too.
    const myName = mine()?.name ?? "\u0000";
    for (const line of g.log) {
      if (line.id <= lastLog) continue;
      lastLog = line.id;
      if (line.kind === "danger" || line.text.includes(myName)) hh.notify(line.text, { kind: line.kind === "danger" ? "danger" : line.kind === "ok" ? "ok" : "info", icon: line.kind === "danger" ? "⚠" : "•", ms: 2400 });
    }
    const p = mine();
    hh.setStatus({ title: `${PHASE_TITLE[g.phase]}${g.turn ? ` · T${g.turn}` : ""}`, battery: Math.max(0.03, g.corruption / 100) });
    view.update(g);
    if (placing) movePlacement(placing.x, false);
    refresh(false);
    const aiming = st === "AIM";
    for (const bt of [left, right, up, down]) bt.disabled = !(aiming || placing || st === "FLIGHT");
    aBtn.disabled = !(aiming || placing || st === "FLIGHT");
    xBtn.disabled = !(p?.birds.length > 1) || st === "FLIGHT";
    bBtn.disabled = !placing && (tab === "game" || wide);
  }

  view.update(g0);
  place();
  queueMicrotask(measure);
  return { node, update };
}

/** A player's first game: three cards once the screen has settled (never again after). */
function firstTimeTutorial(state) {
  if (tutorialSeen()) return;
  const g = state.game;
  setTimeout(() => {
    const shooting = g.phase === "ACTION" && g.action?.shooterId === g.you?.playerId;
    if (document.querySelector(".td-phone") && !shooting) showTutorial(g, { me: g.you?.playerId, only: FIRST_CARDS, onClose: () => latest && buildHint(latest) });
  }, 700);
}

let latest = null;

/** The build card, the first time a Build Phase starts, and only after the first cards. */
function buildHint(state) {
  const g = state.game;
  if (g.phase !== "BUILD" || !tutorialSeen()) return;
  setTimeout(() => showHintOnce(g, "build", { me: g.you?.playerId }), 600);
}

export function render(mount, state, tools) {
  const g = state.game;
  if (!g) return;
  if (!g.you || g.you.spectator) return mount(`thud:${g.session}:watch`, (s) => ({ node: systemCard({ eyebrow: gameTitle(), title: "Watching", text: "This game started without you. Watch the big screen!" }) }), state);
  mount(
    `thud:${g.session}`,
    (s) => {
      firstTimeTutorial(s);
      return buildScreen(s, tools);
    },
    state,
  );
  latest = state;
  buildHint(state);
}
