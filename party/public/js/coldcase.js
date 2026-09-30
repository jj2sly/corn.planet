// CPI: Cold Case — the browser game. Wires the mission simulation (coldcase/sim.js) to the canvas
// renderer, the HUD, input and sound, and runs the frame loop. Solo and local for now: the
// simulation is deterministic and has no DOM, so a server could run it later for co-op.
//
// URL flags for testing: ?autopilot plays the mission with the scripted agent; ?debug exposes the
// live state as window.__coldcase.

import { store } from "./common.js";
import { isMuted, setMuted } from "./games/mycob-sound.js";
import { createAudio } from "./coldcase/audio.js";
import { createHud } from "./coldcase/hud.js";
import { createInput } from "./coldcase/input.js";
import { createRenderer } from "./coldcase/render.js";
import { beginMission, createGame, drainEvents, NO_INPUT, objectiveInfo, routeTo, stepGame } from "./coldcase/sim.js";

const BEST_KEY = "cpst-party:coldcase-best";
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const seedNow = () => Date.now() % 2147483647 || 1;

const canvas = $("view");
let state = createGame({ seed: seedNow() });
const renderer = createRenderer(canvas, state.map);
const hud = createHud();
const audio = createAudio();
let paused = false;
let bot = null;
let guide = null;
let guideT = 0;
let objective = objectiveInfo(state);
let last = performance.now();

const input = createInput({
  stickZone: $("stickZone"),
  stick: $("stick"),
  useBtn: $("touchUse"),
  heatBtn: $("touchHeat"),
  panelMinus: $("panelMinus"),
  panelPlus: $("panelPlus"),
  panelPrimary: $("panelPrimary"),
  onPause: () => togglePause(),
  onMap: () => {
    if (state.phase === "PLAYING" || state.phase === "DOWNED") hud.toggleMap(state, objective);
  },
  onBegin: () => {
    if (state.phase === "BRIEFING") begin();
    else if (state.phase === "COMPLETE") restart();
  },
  onTouch: () => hud.fillBriefing(true, best()),
  panelOpen: () => Boolean(state.panel),
});

function best() {
  const v = store.get("localStorage", BEST_KEY);
  return typeof v === "number" && v > 0 ? v : null;
}

function begin() {
  if (!beginMission(state)) return;
  $("briefing").hidden = true;
  input.reset();
}

function restart() {
  state = createGame({ seed: seedNow(), map: state.map });
  beginMission(state);
  hud.resetZones();
  renderer.snap(state.player.x, state.player.y);
  for (const id of ["briefing", "debrief", "pause", "mapView"]) $(id).hidden = true;
  paused = false;
  guide = null;
  input.reset();
}

function togglePause(force) {
  const canPause = state.phase === "PLAYING" || state.phase === "DOWNED";
  const next = force ?? !paused;
  if (next && !canPause) return;
  paused = next;
  $("pause").hidden = !paused;
  if (paused) {
    hud.fillControls($("pauseControls"), input.touchMode);
    input.reset();
    audio.stop();
    $("resume").focus();
  }
}

function showDebrief() {
  const time = state.missionTime;
  const previous = best();
  const isBest = !previous || time < previous;
  if (isBest) store.set("localStorage", BEST_KEY, Math.round(time));
  hud.fillDebrief(state, previous, isBest);
  setTimeout(() => {
    $("debrief").hidden = false;
    $("replay").focus();
  }, 1600);
}

function updateGuide(dt) {
  guideT -= dt;
  if (guideT > 0) return;
  guideT = 0.35;
  const target = objective.target;
  const p = state.player;
  if (!target || state.phase !== "PLAYING") {
    guide = null;
    return;
  }
  const route = routeTo(state, p.x, p.y, target.x, target.y);
  if (route.length) {
    let dist = 0;
    let px = p.x;
    let py = p.y;
    for (const r of route) {
      dist += Math.hypot(r.x - px, r.y - py);
      px = r.x;
      py = r.y;
    }
    const ahead = route[Math.min(4, route.length - 1)];
    guide = { x: ahead.x, y: ahead.y, dist };
  } else guide = { x: target.x, y: target.y, dist: Math.hypot(target.x - p.x, target.y - p.y) };
}

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const running = !paused && (state.phase === "PLAYING" || state.phase === "DOWNED");
  if (running) {
    let remaining = dt;
    let first = true;
    while (remaining > 1e-6) {
      const step = Math.min(1 / 60, remaining);
      const controls = bot ? bot.next(state) : input.poll(step, first);
      stepGame(state, controls, step);
      remaining -= step;
      first = false;
    }
  } else if (!paused) stepGame(state, NO_INPUT, dt);

  for (const e of drainEvents(state)) {
    renderer.onEvent(state, e);
    hud.onEvent(state, e);
    audio.onEvent(state, e);
    if (e.type === "phase" && e.phase === "COMPLETE") showDebrief();
  }

  objective = objectiveInfo(state);
  updateGuide(dt);
  if (!paused) renderer.update(state, dt);
  renderer.draw(state, { objective, guide });
  hud.update(state, { objective, dt, touch: input.touchMode, paused });
  audio.update(state, paused);
  $("touch").hidden = !(input.touchMode && state.phase === "PLAYING" && !paused);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ page wiring

$("begin").addEventListener("click", begin);
$("resume").addEventListener("click", () => togglePause(false));
$("restart").addEventListener("click", restart);
$("replay").addEventListener("click", restart);
$("pauseBtn").addEventListener("click", () => togglePause());
$("panelClose").addEventListener("click", () => {
  if (state.panel) stepGame(state, { ...NO_INPUT, cancelPressed: true }, 0);
});
$("minimapBtn").addEventListener("click", () => hud.toggleMap(state, objective));
$("mapView").addEventListener("click", () => hud.toggleMap(state, objective));
const muteBtn = $("muteBtn");
const paintMute = () => {
  muteBtn.textContent = isMuted() ? "MUTE" : "SND";
  muteBtn.setAttribute("aria-pressed", String(isMuted()));
};
muteBtn.addEventListener("click", () => {
  setMuted(!isMuted());
  paintMute();
});
paintMute();
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("resize", () => renderer.resize());
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.phase === "PLAYING") togglePause(true);
});

hud.fillBriefing(input.touchMode, best());
if (params.has("autopilot")) {
  import("./coldcase/bot.js").then(({ createBot }) => {
    bot = createBot();
    begin();
  });
}
if (params.has("debug")) {
  globalThis.__coldcase = {
    get state() {
      return state;
    },
    begin,
    restart,
    renderer,
    setBot: (b) => (bot = b),
  };
}
requestAnimationFrame(frame);
