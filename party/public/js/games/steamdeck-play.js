// Escape Thad's Steam Deck on a phone (or the Deck itself). Runners get a small view of the level,
// big buttons, and a plank to draw; Thad gets the level leaning under their hands and a tilt panel.
// Buttons and tilt go over `tools.stream` (fire-and-forget); planks over `tools.request`.

import { el, notice, timerEl } from "../common.js";
import { createDrawingPad } from "../drawing-canvas.js";
import { plankFromStroke } from "./steamdeck-rules.js";
import { createTiltInput } from "./steamdeck-tilt.js";
import { createWorldView } from "./steamdeck-world.js";

const PHASE_NAME = { ASSIGNMENT: "Roles", INTRO: "Get ready", ESCAPE: "Escape!", ESCALATION: "Thad is angry", FINAL: "Final window", RESULTS: "Round over" };
const PLAYING = ["ESCAPE", "ESCALATION", "FINAL"];

let tilt = null;
/** One tilt input for the page, so motion permission and calibration survive screen changes. */
const tiltInput = () => (tilt ??= createTiltInput());

function topBar(g, timer) {
  const slot = el("span", {}, timerEl(timer));
  const label = el("span", { class: "eyebrow", text: `R${g.round}/${g.totalRounds} · ${PHASE_NAME[g.phase]}` });
  const node = el("div", { class: "row spread sd-top" }, label, slot);
  return {
    node,
    set(next) {
      label.textContent = `R${next.game.round}/${next.game.totalRounds} · ${PHASE_NAME[next.game.phase]}`;
      slot.replaceChildren(timerEl(next.timer));
    },
  };
}

/** Keeps a held button held while the finger drifts off it. Best-effort: some pointers can't be captured. */
function capture(node, e) {
  try {
    node.setPointerCapture(e.pointerId);
  } catch {
    // Not capturable (e.g. a synthetic pointer): the button still works, it just releases on leave.
  }
}

function swatch(color) {
  const s = el("span", { class: "sd-swatch big", "aria-hidden": "true" });
  s.style.setProperty("background", color);
  return s;
}

// ------------------------------------------------------------------ assignment

function buildAssignment(s) {
  const g = s.game;
  const bar = topBar(g, s.timer);
  return {
    node: el(
      "div",
      { class: "stack sd-phone" },
      bar.node,
      el(
        "div",
        { class: "big-status" },
        el("div", { class: "icon", "aria-hidden": "true", text: "🏃" }),
        el("h2", { text: "YOU'RE TRAPPED IN THE DECK" }),
        el("p", { class: "muted", text: `${g.thad.name} is holding the Deck. Reach the EXIT.` }),
      ),
      el("p", { class: "sd-you" }, swatch(g.you.color), " That's you."),
      el("ul", { class: "sd-howto" }, el("li", { text: "◀ ▶ move · JUMP jump" }), el("li", { text: "✏️ draw a flat plank across a gap" }), el("li", { text: "Red spikes kill. You respawn." })),
    ),
    update: (next) => bar.set(next),
  };
}

// ------------------------------------------------------------------ Thad

/** The tilt panel: meter, where the tilt comes from, and the controls to fix it. */
function thadPanel(g, { stream } = {}) {
  const input = tiltInput();
  const needle = el("div", { class: "sd-needle" });
  const meter = el("div", { class: "sd-meter", role: "meter", "aria-label": "Tilt", "aria-valuemin": "-100", "aria-valuemax": "100" }, needle);
  const reading = el("p", { class: "sd-reading" });
  const sourceLine = el("p", { class: "muted sd-source" });
  const slider = el("input", { type: "range", min: "-100", max: "100", step: "1", value: "0", "aria-label": "Manual tilt", class: "sd-slider" });
  const note = el("p", { class: "notice" });
  const motionBtn = el("button", { class: "btn ghost small", type: "button" });

  slider.addEventListener("input", () => input.setManual(Number(slider.value) / 100));
  const level = el("button", { class: "btn ghost small", type: "button", text: "Level", onclick: () => ((slider.value = "0"), input.setManual(0)) });
  const calibrate = el("button", { class: "btn ghost small", type: "button", text: "Calibrate", onclick: () => (input.calibrate(), notice(note, "Calibrated: this angle is level now.", "ok")) });
  motionBtn.addEventListener("click", async () => {
    if (input.motion === "on") return input.disableMotion();
    const status = await input.enableMotion();
    if (status === "denied") notice(note, "Motion permission denied. Use the stick, arrow keys or the slider.", "error");
    else if (status === "unavailable") notice(note, "No motion sensor here. Use the stick, arrow keys or the slider.", "error");
    else notice(note, "");
  });

  const SOURCE = { motion: "MOTION ✓", stick: "STICK 🎮", keys: "ARROW KEYS ⌨", manual: "SLIDER" };
  let sentAt = 0;
  let sent = null;
  const off = input.onChange(({ value, source, motion }) => {
    if (!needle.isConnected && sent !== null) return off();
    needle.style.setProperty("left", `${50 + value * 50}%`);
    meter.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    const pct = Math.round(Math.abs(value) * 100);
    reading.textContent = pct < 3 ? "LEVEL" : `${value < 0 ? "◀ LEFT" : "RIGHT ▶"} ${pct}%`;
    reading.classList.toggle("hot", pct > 50);
    sourceLine.textContent = `Input: ${SOURCE[source] ?? source}`;
    motionBtn.textContent = motion === "on" ? "Motion off" : motion === "asking" ? "Asking…" : "Use motion";
    if (source !== "manual" && document.activeElement !== slider) slider.value = String(Math.round(value * 100));
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

  const node = el(
    "div",
    { class: "stack sd-panel" },
    el("div", { class: "row spread" }, reading, sourceLine),
    meter,
    slider,
    el("div", { class: "row sd-panel-buttons" }, motionBtn, calibrate, level),
    note,
  );
  return { node };
}

function buildThad(s, tools) {
  const g = s.game;
  const bar = topBar(g, s.timer);
  const canvas = el("canvas", { class: "sd-canvas", "aria-label": "The level, leaning with your tilt" });
  const view = createWorldView(canvas, { rotate: true, labels: true });
  view.update(g);
  const panel = thadPanel(g, { stream: tools.stream });
  const status = el("p", { class: "sd-status" });
  const setStatus = (next) => {
    const out = next.game.roster.filter((r) => r.escapedMs !== null).length;
    const phase = next.game.phase;
    status.textContent =
      phase === "ASSIGNMENT"
        ? "🎮 You're Thad. Try your tilt now: motion, the Deck's stick, arrow keys or the slider."
        : phase === "INTRO"
          ? "🎮 Get ready to tilt."
          : `🏃 ${out}/${next.game.roster.length} escaped · 💀 ${next.game.roster.reduce((n, r) => n + r.deaths, 0)}`;
  };
  setStatus(s);
  return {
    node: el("div", { class: "stack sd-phone sd-thad-screen" }, bar.node, el("div", { class: "sd-thad-layout" }, el("div", { class: "sd-stage" }, canvas), el("div", { class: "stack" }, status, panel.node))),
    update(next) {
      bar.set(next);
      view.update(next.game);
      setStatus(next);
    },
  };
}

// ------------------------------------------------------------------ runner

function buildRunner(s, tools) {
  const g = s.game;
  const me = g.you.playerId;
  const bar = topBar(g, s.timer);
  const canvas = el("canvas", { class: "sd-canvas", "aria-label": "The level. You have the white outline." });
  const overlay = el("canvas", { class: "sd-draw", hidden: true, "aria-label": "Draw a plank" });
  const view = createWorldView(canvas, { you: me });
  view.update(g);
  const status = el("p", { class: "sd-status", role: "status" });
  const note = el("p", { class: "notice" });
  let game = g;

  // Buttons. Held ones send on press and release; a heartbeat covers dropped packets.
  const input = { l: 0, r: 0, j: g.you.jumpSeq };
  const send = () => tools.stream(input);
  const hold = (label, key, cls) => {
    const b = el("button", { class: `sd-btn ${cls}`, type: "button", "aria-label": key === "l" ? "Move left" : "Move right", text: label });
    const on = (e) => {
      e.preventDefault();
      capture(b, e);
      input[key] = 1;
      b.classList.add("down");
      send();
    };
    const offKey = () => {
      if (!input[key]) return;
      input[key] = 0;
      b.classList.remove("down");
      send();
    };
    b.addEventListener("pointerdown", on);
    for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) b.addEventListener(type, offKey);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  };
  const jump = () => {
    input.j += 1;
    send();
  };
  const jumpBtn = el("button", { class: "sd-btn jump", type: "button", text: "JUMP" });
  jumpBtn.addEventListener("pointerdown", (e) => (e.preventDefault(), jump()));
  jumpBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  const left = hold("◀", "l", "left");
  const right = hold("▶", "r", "right");
  const drawBtn = el("button", { class: "sd-btn draw", type: "button", "aria-label": "Draw a plank", text: "✏️" });
  const controls = el("div", { class: "sd-controls" }, left, right, drawBtn, jumpBtn);

  const onKey = (e) => {
    if (!controls.isConnected) return window.removeEventListener("keydown", onKey), window.removeEventListener("keyup", onKey);
    const down = e.type === "keydown";
    if (e.key === "ArrowLeft" || e.key === "a") (input.l = down ? 1 : 0), send();
    else if (e.key === "ArrowRight" || e.key === "d") (input.r = down ? 1 : 0), send();
    else if ((e.key === " " || e.key === "ArrowUp" || e.key === "w") && down && !e.repeat) jump();
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  const beat = setInterval(() => (controls.isConnected ? send() : clearInterval(beat)), 300);

  // Drawing a plank: a preview of the exact plank you'll get, then place it.
  let pad = null;
  const world = () => ({ width: game.level.width, height: game.level.height, minLength: game.limits.plankMin, maxLength: game.limits.plankMax });
  const preview = (ctx, w, h, drawing) => {
    const stroke = drawing.strokes.at(-1);
    if (!stroke) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Draw a line across the gap", w / 2, 22);
      return;
    }
    const plank = plankFromStroke(stroke, world());
    const sx = w / game.level.width;
    const sy = h / game.level.height;
    if (plank) {
      ctx.fillStyle = "rgba(57, 211, 83, 0.9)";
      ctx.fillRect(plank.x1 * sx, plank.y * sy, (plank.x2 - plank.x1) * sx, Math.max(4, 10 * sy));
    } else {
      ctx.fillStyle = "#ff4d4d";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Draw it sideways: planks are flat", w / 2, 22);
    }
  };
  const place = el("button", { class: "btn big", type: "button", text: "Place plank" });
  const drawBar = el(
    "div",
    { class: "sd-drawbar", hidden: true },
    el("button", { class: "btn ghost", type: "button", text: "Undo", onclick: () => pad?.undo() }),
    el("button", { class: "btn ghost", type: "button", text: "Cancel", onclick: () => setDrawing(false) }),
    place,
  );
  const setDrawing = (on) => {
    overlay.hidden = !on;
    drawBar.hidden = !on;
    controls.hidden = on;
    pad?.destroy();
    pad = on ? createDrawingPad(overlay, { playerId: me, tool: "plank", width: 0.01, maxStrokes: 1, color: "rgba(255, 255, 255, 0.7)", decorate: preview }) : null;
    pad?.redraw();
    if (on) (input.l = input.r = 0), send();
  };
  drawBtn.addEventListener("click", () => setDrawing(true));
  place.addEventListener("click", async () => {
    const stroke = pad?.drawing.strokes.at(-1);
    if (!stroke || !plankFromStroke(stroke, world())) return notice(note, "Draw a flat line first.", "error");
    place.disabled = true;
    const result = await tools.request("game:input", { action: "plank", payload: { drawing: pad.serialize() } });
    place.disabled = false;
    if (!result.ok) return notice(note, result.message, "error");
    notice(note, "");
    setDrawing(false);
  });

  const setStatus = (next) => {
    const g2 = next.game;
    const mine = g2.world.runners.find((r) => r[0] === me);
    const r = g2.roster.find((x) => x.id === me);
    const state = mine?.[4];
    const ready = g2.you.plankReadyMs;
    const plank = ready > 0 ? `✏️ in ${Math.ceil(ready / 1000)}s` : "✏️ ready";
    status.textContent =
      g2.phase === "INTRO"
        ? "Get ready…"
        : state === 2
          ? `✓ ESCAPED${r?.escapedMs != null ? ` in ${(r.escapedMs / 1000).toFixed(1)}s` : ""}. Draw planks to help! · ${plank}`
          : state === 1
            ? "💀 Respawning…"
            : `💀 ${r?.deaths ?? 0} · ${plank}`;
    drawBtn.disabled = ready > 0 || !PLAYING.includes(g2.phase);
    // Escaped: no need to move, but you can still build.
    left.hidden = right.hidden = jumpBtn.hidden = state === 2;
  };
  setStatus(s);

  let lastDeaths = g.roster.find((x) => x.id === me)?.deaths ?? 0;
  return {
    node: el("div", { class: "stack sd-phone sd-runner" }, bar.node, el("div", { class: "sd-stage" }, canvas, overlay), status, controls, drawBar, note),
    update(next) {
      game = next.game;
      bar.set(next);
      view.update(next.game);
      setStatus(next);
      const deaths = next.game.roster.find((x) => x.id === me)?.deaths ?? 0;
      if (deaths > lastDeaths && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(120);
      lastDeaths = deaths;
    },
  };
}

// ------------------------------------------------------------------ results

function buildResults(s) {
  const g = s.game;
  const bar = topBar(g, s.timer);
  const me = g.you.playerId;
  const points = g.results?.points?.[me] ?? 0;
  const r = g.roster.find((x) => x.id === me);
  const [icon, title, line] =
    g.you.role === "thad"
      ? ["🎮", `+${points}`, `${g.results.total - g.results.escaped} of ${g.results.total} still trapped.`]
      : r?.escapedMs != null
        ? ["✓", "ESCAPED", `${(r.escapedMs / 1000).toFixed(1)} s · +${points}`]
        : ["💀", "TRAPPED", `${r?.deaths ?? 0} deaths. The Deck keeps you.`];
  return {
    node: el("div", { class: "stack sd-phone" }, bar.node, el("div", { class: "big-status" }, el("div", { class: "icon", "aria-hidden": "true", text: icon }), el("h2", { text: title }), el("p", { class: "muted", text: line }))),
    update: (next) => bar.set(next),
  };
}

export function render(mount, state, tools) {
  const g = state.game;
  const role = g.you?.role ?? "spectator";
  const key = `steamdeck:${g.session}:${g.round}`;
  if (g.phase === "RESULTS") return mount(`${key}:results`, buildResults, state);
  if (role === "thad") return mount(`${key}:thad`, (s) => buildThad(s, tools), state);
  if (g.phase === "ASSIGNMENT") return mount(`${key}:assign`, buildAssignment, state);
  if (role === "runner") return mount(`${key}:run`, (s) => buildRunner(s, tools), state);
  return mount(`${key}:watch`, (s) => ({ node: el("p", { class: "muted", text: "Watching this round from the host screen." }) }), state);
}
