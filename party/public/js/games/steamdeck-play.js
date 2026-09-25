// Escape Thad's Steam Deck on a phone (or the Deck itself), inside a CPI handheld. Runners see the
// level on its screen (the camera follows them on small screens) and play with the device's own
// buttons: the d-pad moves, A jumps, B draws a plank (and in draw mode A places, B cancels, X undoes,
// the d-pad nudges). Thad holds the device: the level leans under their hands, the L / R shoulder
// buttons lean it, and a console beside it shows the tilt, the limit, the input and what's coming.
// Buttons and tilt go over `tools.stream` (fire-and-forget); planks over `tools.request`.

import { el, notice } from "../common.js";
import { characterCanvas, createCharacter } from "../cpi/character.js";
import { createHandheld, dpad, faceButton, systemCard } from "../cpi/handheld.js";
import { createDrawingPad, fitCanvas, renderDrawing } from "../drawing-canvas.js";
import { isMuted, playSfx, setMuted } from "./mycob-sound.js";
import { plankFromStroke, strokeAhead } from "./steamdeck-rules.js";
import { paintPlank } from "./steamdeck-scenery.js";
import { createTiltInput } from "./steamdeck-tilt.js";
import { animateBadges, assignmentBand, battery, launchSteps, levelCard, liveTimer, PHASE_SHORT, phaseNotice, PLAYING, quip, roundReport, thadLine } from "./steamdeck-ui.js";
import { createWorldView } from "./steamdeck-world.js";

let tilt = null;
/** One tilt input for the page, so motion permission and calibration survive screen changes. */
const tiltInput = () => (tilt ??= createTiltInput());

const buzz = (pattern) => {
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(pattern);
};

/** Keeps a held button held while the finger drifts off it. Best-effort: some pointers can't be captured. */
function capture(node, e) {
  try {
    node.setPointerCapture(e.pointerId);
  } catch {
    // Not capturable (e.g. a synthetic pointer): the button still works, it just releases on leave.
  }
}

/** A button that's "down" while pressed: calls onDown / onUp once each, however the press ends. */
function holdable(button, onDown, onUp) {
  let held = false;
  const down = (e) => {
    e.preventDefault();
    if (button.disabled) return;
    capture(button, e);
    held = true;
    button.classList.add("pressed");
    onDown();
  };
  const up = () => {
    if (!held) return;
    held = false;
    button.classList.remove("pressed");
    onUp?.();
  };
  button.addEventListener("pointerdown", down);
  for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) button.addEventListener(type, up);
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  return { release: up };
}

/** A tap that fires on press (not on release): quicker for a game button. */
function tappable(button, fn) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.classList.add("pressed");
    fn();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(type, () => button.classList.remove("pressed"));
  // Keyboard users activate with Enter / Space, which fire click without a pointerdown.
  button.addEventListener("click", (e) => {
    if (e.detail === 0 && !button.disabled) fn();
  });
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

// ------------------------------------------------------------------ the device, for every role

/**
 * The handheld with this round's status bar and phase transitions. `personal(next)` returns the
 * RESULTS card for this player; `intro(next)` what to show while roles are assigned.
 */
function roundDevice(s, { left = null, right = null, shoulders = null, className = "", label, intro, personal, rock = false }) {
  const g0 = s.game;
  const timer = liveTimer({ compact: true });
  const hh = createHandheld({ title: "", owner: g0.thad.name.toUpperCase(), layout: "auto", left, right, shoulders, rock, label, className: `sd-device ${className}`.trim() });
  hh.setStatus({ extra: [timer.node, muteButton()] });
  let phase = null;
  let paused = false;

  const enter = (next, remainingMs) => {
    const g = next;
    const p = g.phase;
    // A transition only for a change seen live: a reconnect mid-phase just shows where things are.
    const live = phase !== null;
    const news = phaseNotice(g);
    if (news && live) hh.notify(news.text, { ...news, replace: true });
    if (p === "ASSIGNMENT") intro(g, remainingMs ?? 0);
    else if (p === "INTRO") hh.overlay(levelCard(g), "card");
    else if (!live && p !== "RESULTS") hh.clearOverlay();
    else if (p === "ESCAPE") hh.overlay(el("div", { class: "sd-stamp-big ok", text: "GO!" }), "stamp", { ms: 800 });
    else if (p === "ESCALATION" || p === "FINAL") {
      const danger = p === "FINAL";
      hh.overlay(el("div", { class: `sd-stamp-big ${danger ? "danger" : "warn"}`, text: danger ? "FINAL WINDOW" : "THAD IS ANGRY" }), "band", { ms: 1500 });
      hh.flash(danger ? "danger" : "warn");
      buzz(60);
    } else if (p === "RESULTS") hh.overlay(personal(g), "card result");
    phase = p;
  };

  return {
    hh,
    update(next) {
      const g = next.game;
      timer.set(next.timer);
      hh.setStatus({ title: `R${g.round}/${g.totalRounds} · ${PHASE_SHORT[g.phase]}`, battery: battery(g.phase, next.timer) });
      if (next.paused !== paused) {
        paused = next.paused;
        if (paused) hh.overlay(systemCard({ eyebrow: "SYSTEM", title: "PAUSED", text: "The host display dropped out. Hang on." }), "card");
        else {
          // Back where we were, without replaying the phase's entrance.
          phase = null;
          enter(g, 0);
        }
      }
      if (g.phase !== phase && !paused) enter(g, next.timer?.remainingMs);
    },
    get phase() {
      return phase;
    },
  };
}

/** The personal result card inside the device. */
function resultCard(g, { me, role }) {
  const points = g.results?.points?.[me] ?? 0;
  if (role === "thad") {
    const ch = createCharacter({ id: me, name: g.thad.name, color: g.thad.color });
    const c = characterCanvas(ch, { size: 64, state: points ? "cheer" : "sad" });
    animateBadges([{ canvas: c, state: points ? "cheer" : "sad" }]);
    return el("div", { class: "sd-result" }, c, el("div", {}, el("p", { class: "cpi-card-eyebrow", text: "YOU HELD THE DECK" }), el("p", { class: "cpi-card-title", text: `+${points}` }), el("p", { class: "cpi-card-text", text: `${g.results.total - g.results.escaped} of ${g.results.total} still trapped. ${thadLine(g, points)}` })));
  }
  const r = g.roster.find((x) => x.id === me);
  const out = r?.escapedMs != null;
  const ch = createCharacter({ id: me, name: r?.name ?? "", color: r?.color ?? "#ffd400" });
  const c = characterCanvas(ch, { size: 64, state: out ? "cheer" : "sad" });
  animateBadges([{ canvas: c, state: out ? "cheer" : "sad" }]);
  return el(
    "div",
    { class: `sd-result ${out ? "ok" : "danger"}` },
    c,
    el(
      "div",
      {},
      el("p", { class: "cpi-card-eyebrow", text: out ? `OUT IN ${(r.escapedMs / 1000).toFixed(1)} S` : `${r?.deaths ?? 0} DEATHS` }),
      el("p", { class: "cpi-card-title", text: out ? `ESCAPED +${points}` : "TRAPPED" }),
      el("p", { class: "cpi-card-text", text: quip(me, out, g.round) }),
    ),
  );
}

// ------------------------------------------------------------------ Thad

const SOURCE_CHIPS = [
  ["keys", "⌨ KEYS · L/R"],
  ["stick", "🎮 STICK"],
  ["manual", "▭ SLIDER"],
  ["motion", "📱 MOTION"],
];

/** The tilt gauge: an arc for the Deck's lean, the phase's limit marked, the needle where it is. */
function drawDial(canvas, value, maxTilt) {
  const { width, height, dpr } = fitCanvas(canvas);
  if (width < 2) return;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height * 0.92;
  const r = Math.min(width / 2 - 8, height * 0.82);
  const RANGE = 30; // degrees either side, the most any phase allows
  const at = (deg) => -Math.PI / 2 + (deg / RANGE) * (Math.PI / 2.4);
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(6, r * 0.12);
  ctx.strokeStyle = "#23262d";
  ctx.beginPath();
  ctx.arc(cx, cy, r, at(-RANGE), at(RANGE));
  ctx.stroke();
  // The phase's limit: how far this phase lets the Deck go.
  ctx.strokeStyle = "rgba(255, 212, 0, 0.35)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, at(-maxTilt), at(maxTilt));
  ctx.stroke();
  const deg = value * maxTilt;
  ctx.strokeStyle = Math.abs(value) > 0.5 ? "#ff6b5e" : "#ffd400";
  ctx.beginPath();
  ctx.arc(cx, cy, r, at(0), at(deg), deg < 0);
  ctx.stroke();
  // Ticks at each phase's limit.
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#8b919c";
  for (const d of [-30, -22, -14, 0, 14, 22, 30]) {
    const a = at(d);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12));
    ctx.lineTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20));
    ctx.stroke();
  }
  // Needle.
  const a = at(deg);
  ctx.strokeStyle = "#f4f4f4";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
  ctx.stroke();
  ctx.fillStyle = "#f4f4f4";
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
}

/** Thad's console: the reading, the limit, where the tilt comes from, and what's coming. */
function thadConsole({ stream }) {
  const input = tiltInput();
  const dial = el("canvas", { class: "sd-dial", "aria-hidden": "true" });
  const meter = el("div", { class: "sd-meter", role: "meter", "aria-label": "Tilt", "aria-valuemin": "-100", "aria-valuemax": "100" }, el("div", { class: "sd-needle" }));
  const needle = meter.firstChild;
  const reading = el("p", { class: "sd-reading" });
  const influence = el("p", { class: "sd-influence mono" });
  const limits = el("div", { class: "sd-limits", "aria-label": "Lean limit by phase" }, ["ESCAPE", "ESCALATION", "FINAL"].map((p, i) => el("span", { class: "sd-limit", dataset: { phase: p }, text: `${[14, 22, 30][i]}°` })));
  const chips = el("div", { class: "sd-sources", role: "list", "aria-label": "Tilt input" }, SOURCE_CHIPS.map(([id, text]) => el("span", { class: "sd-chip", role: "listitem", dataset: { source: id }, text })));
  const motionLine = el("p", { class: "sd-motion" });
  const slider = el("input", { type: "range", min: "-100", max: "100", step: "1", value: "0", "aria-label": "Manual tilt", class: "sd-slider" });
  const note = el("p", { class: "notice" });
  const motionBtn = el("button", { class: "btn ghost small", type: "button" });
  const coming = el("p", { class: "sd-coming mono" });
  const runners = el("p", { class: "sd-runners mono" });
  const log = el("ol", { class: "sd-log", "aria-label": "Recent events" });

  // Dragging the slider means "use the slider": it takes over from motion.
  slider.addEventListener("input", () => {
    if (input.motion === "on") {
      input.disableMotion();
      notice(note, "Motion off: you're on the slider now. Tap Use motion to switch back.", "ok");
    }
    input.setManual(Number(slider.value) / 100);
  });
  const level = el("button", { class: "btn ghost small", type: "button", text: "Level", onclick: () => ((slider.value = "0"), input.setManual(0)) });
  const calibrate = el("button", {
    class: "btn ghost small",
    type: "button",
    text: "Calibrate",
    onclick: () => {
      slider.value = "0";
      const motion = input.calibrate();
      notice(note, motion ? "Calibrated ✓ Hold the Deck like this for no tilt." : "Slider back to level. (Calibrate sets level for motion: turn motion on first.)", "ok");
    },
  });
  motionBtn.addEventListener("click", async () => {
    if (input.motion === "on") return input.disableMotion();
    const status = await input.enableMotion();
    if (status === "denied") notice(note, "No motion permission. That's fine: use ← →, L / R or the slider.", "ok");
    else if (status === "unavailable") notice(note, "No motion sensor here. That's fine: use ← →, L / R or the slider.", "ok");
    else notice(note, "");
  });

  const MOTION = { off: "Motion: off (optional)", asking: "Motion: asking…", denied: "Motion: blocked (optional, carry on)", unavailable: "Motion: no sensor (optional, carry on)" };
  let maxTilt = 14;
  // The dial repaints when the tilt, the limit or its own size changes (it has no size until it's
  // on the page, so the first paint happens on the first state after that).
  const readout = (value) => {
    const pct = Math.round(Math.abs(value) * 100);
    const deg = Math.abs(value * maxTilt);
    reading.textContent = pct < 3 ? "LEVEL" : `${value < 0 ? "◀ LEFT" : "RIGHT ▶"} ${deg.toFixed(1)}° · ${pct}%`;
    reading.classList.toggle("hot", pct > 50);
    // How hard the lean shoves a runner, as a share of gravity (sin of the angle).
    influence.textContent = `Shove: ${Math.round(Math.sin((deg * Math.PI) / 180) * 100)}% of gravity · limit ${maxTilt}°`;
  };
  let painted = "";
  const paintDial = (value) => {
    const key = `${value.toFixed(3)}:${maxTilt}:${dial.clientWidth}`;
    if (key === painted || !dial.clientWidth) return;
    painted = key;
    drawDial(dial, value, maxTilt);
  };
  let sentAt = 0;
  let sent = null;
  const listeners = new Set();
  const off = input.onChange(({ value, source, motion, live }) => {
    if (!meter.isConnected && sent !== null) return off();
    needle.style.setProperty("left", `${50 + value * 50}%`);
    meter.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    readout(value);
    chips.querySelectorAll(".sd-chip").forEach((c) => c.classList.toggle("on", c.dataset.source === source));
    motionLine.textContent = motion === "on" ? (live ? "Motion: on ✓ (Calibrate sets level)" : "Motion: on, no signal (using the slider)") : MOTION[motion];
    motionLine.className = `sd-motion ${motion === "on" && live ? "ok" : motion === "denied" || motion === "unavailable" || motion === "on" ? "warn" : ""}`.trim();
    motionBtn.textContent = motion === "on" ? "Motion off" : motion === "asking" ? "Asking…" : "Use motion";
    // The slider shows the keys' and slider's shared value; a stick or motion shows what it's doing.
    if (document.activeElement !== slider) slider.value = String(Math.round((source === "keys" || source === "manual" ? input.manual : value) * 100));
    paintDial(value);
    for (const fn of listeners) fn(value);
    // Throttled: the server smooths anyway, and the socket has a rate budget.
    const now = performance.now();
    if (stream && (sent === null || (Math.abs(value - sent) > 0.01 && now - sentAt > 80))) {
      stream({ tilt: Math.round(value * 1000) / 1000 });
      sent = value;
      sentAt = now;
    }
  });
  // Heartbeat, in case a packet was dropped.
  const beat = stream
    ? setInterval(() => {
        if (!meter.isConnected) return clearInterval(beat);
        stream({ tilt: Math.round(input.value * 1000) / 1000 });
      }, 400)
    : 0;

  let lastRoster = null;
  const node = el(
    "section",
    { class: "sd-console", "aria-label": "Thad's controls" },
    el("div", { class: "sd-console-head" }, el("span", { class: "sd-console-title", text: "DECK CONTROL" }), el("span", { class: "sd-console-sub", text: "YOU HOLD THE DECK" })),
    el("div", { class: "sd-dial-wrap" }, dial, reading),
    influence,
    limits,
    meter,
    slider,
    el("p", { class: "sd-keys", text: "Keys: ← → lean (hold for more) · ↓ or Space: level · or hold L / R on the Deck" }),
    chips,
    el("div", { class: "row sd-panel-buttons" }, motionBtn, calibrate, level),
    motionLine,
    note,
    el("div", { class: "sd-console-status" }, coming, runners),
    log,
  );
  return {
    node,
    input,
    onTilt: (fn) => (listeners.add(fn), fn(input.value)),
    update(next) {
      const g = next.game;
      if (g.world.maxTilt !== maxTilt) {
        maxTilt = g.world.maxTilt;
        readout(input.value);
      }
      paintDial(input.value);
      limits.querySelectorAll(".sd-limit").forEach((c) => c.classList.toggle("on", c.dataset.phase === (PLAYING.includes(g.phase) ? g.phase : "ESCAPE")));
      const secs = next.timer ? Math.ceil(next.timer.remainingMs / 1000) : 0;
      const arriving = g.level.hazards.filter((h) => !h[4]).length;
      coming.textContent =
        g.phase === "ESCAPE"
          ? `⚠ ESCALATION in ${secs}s: up to 22°${arriving ? `, ${arriving} spike strip${arriving === 1 ? "" : "s"}` : ""}`
          : g.phase === "ESCALATION"
            ? `⚠ FINAL in ${secs}s: up to 30°${arriving ? `, ${arriving} more spikes` : ""}`
            : g.phase === "FINAL"
              ? `⏱ Round ends in ${secs}s`
              : g.phase === "RESULTS"
                ? "Round over."
                : `Play starts soon. Try the tilt now.`;
      coming.classList.toggle("hot", g.phase === "FINAL" || (PLAYING.includes(g.phase) && secs <= 5));
      const out = g.roster.filter((r) => r.escapedMs !== null).length;
      runners.textContent = `🏃 ${out}/${g.roster.length} out · 💀 ${g.roster.reduce((n, r) => n + r.deaths, 0)}`;
      // The last few things that happened to the runners.
      if (lastRoster) {
        for (const r of g.roster) {
          const was = lastRoster.get(r.id);
          if (!was) continue;
          if (r.escapedMs !== null && was.escapedMs === null) push(`✓ ${r.name} got out`, "ok");
          else if (r.deaths > was.deaths) push(`💀 ${r.name} fell`, "hit");
        }
      }
      lastRoster = new Map(g.roster.map((r) => [r.id, { ...r }]));
    },
  };
  function push(text, kind) {
    log.prepend(el("li", { class: kind, text }));
    while (log.children.length > 3) log.lastChild.remove();
  }
}

function buildThad(s, tools) {
  const g = s.game;
  const input = tiltInput();
  const lBtn = el("button", { type: "button", "aria-label": "Lean left (hold)" }, el("span", { text: "L" }), el("small", { text: "◀ LEAN" }));
  const rBtn = el("button", { type: "button", "aria-label": "Lean right (hold)" }, el("span", { text: "R" }), el("small", { text: "LEAN ▶" }));
  holdable(lBtn, () => input.hold("left", true), () => input.hold("left", false));
  holdable(rBtn, () => input.hold("right", true), () => input.hold("right", false));
  const panel = thadConsole({ stream: tools.stream });
  const device = roundDevice(s, {
    shoulders: { left: lBtn, right: rBtn },
    className: "sd-thad-device",
    rock: true,
    label: "The level, leaning with your tilt",
    intro: (next, remainingMs) => {
      if (remainingMs > 4_000) {
        device.hh.sequence([{ ms: 1500, cls: "boot", render: () => launchSteps(next)[0].render(), enter: () => playSfx("device_boot") }, { ms: 1800, cls: "card", render: () => systemCard({ eyebrow: "ROLE ASSIGNED", title: "YOU HOLD THE DECK", text: "Everyone else is inside it. Lean it and keep them there." }) }]).done.then(() => {
          if (device.phase === "ASSIGNMENT") device.hh.overlay(assignmentBand(next), "band bottom");
        });
      } else device.hh.overlay(assignmentBand(next), "band bottom");
    },
    personal: (next) => resultCard(next, { me: next.you.playerId, role: "thad" }),
  });
  const canvas = el("canvas", { class: "sd-canvas", "aria-hidden": "true" });
  device.hh.screen.append(canvas);
  const view = createWorldView(canvas, { rotate: true, labels: true });
  view.update(g);
  // The device answers Thad's hands at once, not a network round trip later.
  panel.onTilt((v) => device.hh.setTilt(v));
  const report = el("div", { class: "sd-phone-report" });
  return {
    node: el("div", { class: "sd-phone sd-thad-screen" }, el("div", { class: "sd-thad-layout" }, device.hh.node, panel.node), report),
    update(next) {
      device.update(next);
      view.update(next.game);
      panel.update(next);
      if (next.game.phase === "RESULTS" && !report.childElementCount) report.append(roundReport(next.game, { compact: true }));
    },
  };
}

// ------------------------------------------------------------------ runner

function buildRunner(s, tools) {
  const g = s.game;
  const me = g.you.playerId;
  let game = g;
  const myColor = g.you.color;

  // ---- the device's buttons
  const leftBtn = el("button", { type: "button", "aria-label": "Move left", text: "◀" });
  const rightBtn = el("button", { type: "button", "aria-label": "Move right", text: "▶" });
  const upBtn = el("button", { type: "button", "aria-label": "Nudge plank up", text: "▲", disabled: true });
  const downBtn = el("button", { type: "button", "aria-label": "Nudge plank down", text: "▼", disabled: true });
  const mapBtn = el("button", { class: "cpi-hh-pill", type: "button", "aria-label": "Toggle the whole-level map", text: "MAP" });
  const undoBtn = faceButton("X", { label: "UNDO", cls: "sd-undo", keyHint: "Z" });
  const aBtn = faceButton("A", { label: "JUMP", cls: "sd-a", keyHint: "SPACE" });
  const bBtn = faceButton("B", { label: "PLANK", cls: "sd-b", keyHint: "E" });
  const bCount = el("span", { class: "sd-cooldown", "aria-hidden": "true" });
  bBtn.append(bCount);
  const left = el("div", { class: "cpi-hh-cluster sd-left" }, dpad({ left: leftBtn, right: rightBtn, up: upBtn, down: downBtn }), el("div", { class: "sd-sys-row" }, mapBtn, undoBtn));
  const right = el("div", { class: "cpi-hh-cluster sd-right" }, el("div", { class: "sd-ab" }, bBtn, aBtn));

  const status = el("p", { class: "sd-status", role: "status" });
  const note = el("p", { class: "notice" });

  const device = roundDevice(s, {
    left,
    right,
    className: "sd-runner-device",
    label: "The level. You have the white outline and the YOU tag.",
    intro: (next, remainingMs) => {
      const r = next.roster.find((x) => x.id === me);
      const ch = createCharacter({ id: me, name: r?.name ?? "", color: myColor });
      const card = () => {
        const c = characterCanvas(ch, { size: 70, state: "cheer" });
        animateBadges([{ canvas: c, state: "cheer" }]);
        return el("div", { class: "sd-result" }, c, el("div", {}, el("p", { class: "cpi-card-eyebrow", text: "THIS IS YOU" }), el("p", { class: "cpi-card-title", text: "TRAPPED IN THE DECK" }), el("p", { class: "cpi-card-text", text: `${next.thad.name} is holding it. Reach the EXIT.` })));
      };
      if (remainingMs > 4_000)
        device.hh.sequence([{ ms: 3200, cls: "card", render: card }]).done.then(() => {
          if (device.phase === "ASSIGNMENT") device.hh.overlay(assignmentBand(next), "band bottom");
        });
      else device.hh.overlay(assignmentBand(next), "band bottom");
    },
    personal: (next) => resultCard(next, { me, role: "runner" }),
  });
  const hh = device.hh;

  // ---- the screen: the level, and a drawing layer over it
  const canvas = el("canvas", { class: "sd-canvas", "aria-hidden": "true" });
  const overlay = el("canvas", { class: "sd-draw", hidden: true, "aria-label": "Draw a plank" });
  const stage = el("div", { class: "sd-stage" }, canvas, overlay);
  hh.screen.append(stage);
  const view = createWorldView(canvas, {
    you: me,
    follow: true,
    labels: "others",
    onEvent: (type, { mine, strength }) => {
      if (!mine) return;
      if (type === "jump") playSfx("jump", { volume: 0.5 });
      else if (type === "land" && strength > 0.35) playSfx("land", { volume: 0.7 });
      else if (type === "plank") playSfx("plank_place");
      else if (type === "die") buzz(120);
      else if (type === "escape") buzz([30, 40, 30]);
    },
  });
  view.update(g);

  // ---- movement: held buttons send on press and release; a heartbeat covers dropped packets
  const input = { l: 0, r: 0, j: g.you.jumpSeq };
  const send = () => tools.stream(input);
  let drawing = false;
  const move = (key, on) => {
    if (drawing) return;
    input[key] = on ? 1 : 0;
    send();
  };
  const jump = () => {
    input.j += 1;
    send();
  };
  const holdL = holdable(leftBtn, () => (drawing ? nudge(-20, 0) : move("l", true)), () => move("l", false));
  const holdR = holdable(rightBtn, () => (drawing ? nudge(20, 0) : move("r", true)), () => move("r", false));
  tappable(upBtn, () => nudge(0, -20));
  tappable(downBtn, () => nudge(0, 20));
  tappable(aBtn, () => (drawing ? place() : jump()));
  tappable(bBtn, () => (drawing ? setDrawing(false) : setDrawing(true)));
  tappable(undoBtn, () => undo());
  mapBtn.addEventListener("click", () => {
    view.setMode(view.mode === "map" ? "follow" : "map");
    mapBtn.classList.toggle("on", view.mode === "map");
    playSfx("ui_click");
  });
  const beat = setInterval(() => (stage.isConnected ? send() : clearInterval(beat)), 300);

  // ---- drawing a plank: the exact plank you'll get, then place it
  let pad = null;
  const world = () => ({ width: game.level.width, height: game.level.height, minLength: game.limits.plankMin, maxLength: game.limits.plankMax });
  const preview = (ctx, w, h, d, info) => {
    // Blueprint mode: the level stays visible, with a grid so it reads as "drawing".
    ctx.save();
    ctx.fillStyle = "rgba(20, 70, 140, 0.18)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(140, 200, 255, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= 16; x++) {
      ctx.moveTo((x * w) / 16, 0);
      ctx.lineTo((x * w) / 16, h);
    }
    for (let y = 0; y <= 9; y++) {
      ctx.moveTo(0, (y * h) / 9);
      ctx.lineTo(w, (y * h) / 9);
    }
    ctx.stroke();
    ctx.restore();
    const stroke = d.strokes.at(-1);
    const plank = stroke ? plankFromStroke(stroke, world()) : null;
    if (stroke && plank) {
      ctx.save();
      ctx.scale(w / game.level.width, h / game.level.height);
      paintPlank(ctx, plank, { color: myColor, ghost: true, time: info.time });
      ctx.restore();
    } else if (stroke && !info.drawing) {
      renderDrawing(ctx, d, { width: w, height: h, color: "#ff6b5e" });
    }
    const message = !stroke ? "Draw a line across the gap" : plank ? (info.drawing ? "" : "✓ That's your plank. A / Enter places it") : "✗ Draw it sideways: planks are flat";
    if (message) hint(ctx, message, w, !stroke || plank ? "#ffffff" : "#ff6b5e");
  };
  const setDrawing = (on) => {
    if (on && (bBtn.disabled || !PLAYING.includes(game.phase))) return;
    drawing = on;
    overlay.hidden = !on;
    hh.node.classList.toggle("drawing", on);
    aBtn.querySelector(".cpi-hh-label").textContent = on ? "PLACE" : "JUMP";
    bBtn.querySelector(".cpi-hh-label").textContent = on ? "CANCEL" : "PLANK";
    upBtn.disabled = downBtn.disabled = !on;
    view.setMode(on ? "map" : mapBtn.classList.contains("on") ? "map" : "follow");
    view.setDrawing(on);
    pad?.destroy();
    pad = on
      ? createDrawingPad(overlay, {
          playerId: me,
          tool: "plank",
          width: 0.012,
          maxStrokes: 1,
          color: "rgba(255, 255, 255, 0.9)",
          glow: "rgba(0, 0, 0, 0.35)",
          decorate: preview,
          animate: true,
          onUndo: () => playSfx("ui_click"),
          // A fresh line: the last complaint no longer applies.
          onChange: () => note.textContent && notice(note, ""),
        })
      : null;
    pad?.redraw();
    if (on) {
      holdL.release();
      holdR.release();
      input.l = input.r = 0;
      send();
      hh.notify("Plank tool: draw a flat line", { kind: "info", icon: "✏️", ms: 1800 });
    }
    notice(note, "");
  };
  // Nudging moves the whole stroke (keyboard or d-pad), and it goes through the same plank rule.
  const nudge = (dx, dy) => {
    const stroke = pad?.drawing.strokes.at(-1);
    if (!stroke) return suggest([dx, dy]);
    const W = game.level.width;
    const H = game.level.height;
    for (const p of stroke.points) {
      p[0] = Math.round(Math.min(1, Math.max(0, p[0] + dx / W)) * 10000) / 10000;
      p[1] = Math.round(Math.min(1, Math.max(0, p[1] + dy / H)) * 10000) / 10000;
    }
    pad.redraw();
  };
  const suggest = (offset = [0, 0]) => {
    const r = game.world.runners.find((x) => x[0] === me);
    if (!r || !pad) return;
    const [rw, rh] = game.world.size;
    pad.drawing.strokes.length = 0;
    pad.drawing.strokes.push(strokeAhead({ x: r[1], y: r[2], facing: r[3], width: rw, height: rh }, game.level, offset));
    pad.redraw();
  };
  const undo = () => pad?.undo();
  const reject = (message) => {
    notice(note, message, "error");
    hh.shake(300);
    buzz(30);
  };
  let placing = false;
  const place = async () => {
    const stroke = pad?.drawing.strokes.at(-1);
    if (placing) return;
    if (!stroke || !plankFromStroke(stroke, world())) return reject("Draw a flat line first.");
    placing = true;
    aBtn.disabled = true;
    const result = await tools.request("game:input", { action: "plank", payload: { drawing: pad.serialize() } });
    placing = false;
    aBtn.disabled = false;
    if (!result.ok) return reject(result.message);
    setDrawing(false);
  };

  // ---- keyboard: a complete alternative to the buttons and the pen. ← → (A D) move, Space ↑ W
  // jump, E suggests a plank just ahead (arrows nudge it, Enter places, Esc cancels, Z undoes), M map.
  const STEP = { ArrowLeft: [-20, 0], a: [-20, 0], ArrowRight: [20, 0], d: [20, 0], ArrowUp: [0, -20], w: [0, -20], ArrowDown: [0, 20], s: [0, 20] };
  const press = (b) => {
    b.classList.add("pressed");
    setTimeout(() => b.classList.remove("pressed"), 120);
  };
  const onKey = (e) => {
    if (!stage.isConnected) {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      return;
    }
    if (e.target?.closest?.("input, textarea, select")) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const down = e.type === "keydown";
    if (drawing) {
      if (!down) return;
      const step = STEP[k];
      if (step) nudge(step[0], step[1]);
      else if ((k === "Enter" || k === "e") && !e.repeat) (press(aBtn), place());
      else if (k === "Escape") (press(bBtn), setDrawing(false));
      else if (k === "Backspace" || k === "z") (press(undoBtn), undo());
      else return;
      return e.preventDefault();
    }
    if (k === "ArrowLeft" || k === "a" || k === "ArrowRight" || k === "d") {
      if (!e.repeat) {
        const btn = k === "ArrowLeft" || k === "a" ? leftBtn : rightBtn;
        btn.classList.toggle("pressed", down);
        move(btn === leftBtn ? "l" : "r", down);
      }
    } else if (k === " " || k === "ArrowUp" || k === "w") {
      if (down && !e.repeat && !aBtn.disabled) (press(aBtn), jump());
    } else if (k === "e") {
      if (down && !e.repeat && !bBtn.disabled) {
        press(bBtn);
        setDrawing(true);
        suggest();
      }
    } else if (k === "m") {
      if (down && !e.repeat) mapBtn.click();
    } else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  const keys = el("p", { class: "sd-keys", text: "Keys: ← → move · Space jump · E plank (arrows nudge, Enter place) · M map" });

  const setStatus = (next) => {
    const g2 = next.game;
    const mine = g2.world.runners.find((r) => r[0] === me);
    const r = g2.roster.find((x) => x.id === me);
    const state = mine?.[4];
    const ready = g2.you.plankReadyMs;
    const playing = PLAYING.includes(g2.phase);
    const plank = ready > 0 ? `✏️ in ${Math.ceil(ready / 1000)}s` : "✏️ ready";
    status.textContent =
      g2.phase === "RESULTS"
        ? "Round over."
        : !playing
          ? "Get ready…"
          : state === 2
            ? `✓ ESCAPED${r?.escapedMs != null ? ` in ${(r.escapedMs / 1000).toFixed(1)}s` : ""}. Draw planks to help! · ${plank}`
            : state === 1
              ? "💀 Respawning…"
              : `💀 ${r?.deaths ?? 0} · ${plank}`;
    const cooling = ready > 0;
    bBtn.disabled = !drawing && (cooling || !playing);
    bBtn.classList.toggle("cooling", cooling);
    bBtn.style.setProperty("--cd", String(Math.min(1, ready / game.limits.cooldownMs)));
    bCount.textContent = cooling ? String(Math.ceil(ready / 1000)) : "";
    // Escaped: no need to move, but you can still build.
    const out = state === 2 || g2.phase === "RESULTS";
    leftBtn.disabled = rightBtn.disabled = (out || !playing) && !drawing;
    aBtn.disabled = !drawing && (out || !playing);
    if (drawing && !playing) setDrawing(false);
  };
  setStatus(s);

  const report = el("div", { class: "sd-phone-report" });
  return {
    node: el("div", { class: "sd-phone sd-runner" }, hh.node, status, note, keys, report),
    update(next) {
      game = next.game;
      device.update(next);
      view.update(next.game);
      setStatus(next);
      if (next.game.phase === "RESULTS" && !report.childElementCount) report.append(roundReport(next.game, { compact: true }));
    },
  };
}

/** A line of text at the top of the drawing layer, on a pill so it reads over anything. */
function hint(ctx, text, w, color) {
  ctx.save();
  ctx.font = `600 ${Math.max(12, Math.min(16, w / 26))}px "Oswald", Arial, sans-serif`;
  const tw = ctx.measureText(text).width + 20;
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(w / 2 - tw / 2, 6, tw, 24, 12);
  else ctx.rect(w / 2 - tw / 2, 6, tw, 24);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, 18.5);
  ctx.restore();
}

// ------------------------------------------------------------------ spectator

function buildWatch(s) {
  const device = roundDevice(s, {
    label: "The level, live",
    intro: (next) => device.hh.overlay(assignmentBand(next), "band bottom"),
    personal: (next) => systemCard({ eyebrow: "ROUND OVER", title: "REPORT FILED", text: "Watching this round. You'll be in the next one." }),
  });
  const canvas = el("canvas", { class: "sd-canvas", "aria-hidden": "true" });
  device.hh.screen.append(canvas);
  const view = createWorldView(canvas, { rotate: true, labels: true });
  view.update(s.game);
  return {
    node: el("div", { class: "sd-phone" }, device.hh.node, el("p", { class: "muted", text: "Watching this round. You'll be in the next one." })),
    update(next) {
      device.update(next);
      view.update(next.game);
    },
  };
}

export function render(mount, state, tools) {
  const g = state.game;
  const role = g.you?.role ?? "spectator";
  // One build per round and role: the device stays put from the launch to the report.
  const key = `steamdeck:${g.session}:${g.round}:${role}`;
  if (role === "thad") return mount(key, (s) => buildThad(s, tools), state);
  if (role === "runner") return mount(key, (s) => buildRunner(s, tools), state);
  return mount(key, buildWatch, state);
}
