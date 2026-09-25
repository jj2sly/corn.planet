// CPI handheld: a fictional CPI games handheld (the "CPI KERNEL") that any game can run inside.
// It's DOM + CSS only (see "CPI handheld" in party.css); the game draws into `screen` as usual.
//
//   const hh = createHandheld({ title: "ESCAPE THAD'S STEAM DECK", owner: "THAD" });
//   hh.screen.append(canvas);          // the game
//   hh.setStatus({ battery: 0.6 });    // status bar: battery, signal, the title
//   hh.notify("Spikes incoming", { kind: "warn" });   // system notification (never over the game)
//   hh.flash("danger"); hh.shake(); hh.setTilt(-0.4); // device feedback
//   hh.sequence([{ ms: 1400, render: () => bootScreen() }, …]).done  // boot / title cards, skippable
//
// Layout: "landscape" (grips either side of the screen) or "portrait" (controls under it); "auto"
// picks by the device's own width. Grips hold decorative controls unless a game passes real ones
// (`left`, `right`): a phone's runner controls *are* the device's buttons.
//
// Nothing here copies any real product's look or UI; it's a generic handheld with CPI branding.

import { el } from "../common.js";

const PORTRAIT_BELOW = 600;

/** A d-pad. Each direction is a button you pass in, or null for a moulded, inactive one. */
export function dpad({ left = null, right = null, up = null, down = null } = {}) {
  const slot = (node, dir) => {
    if (node) {
      node.classList.add("cpi-hh-dir", dir);
      return node;
    }
    return el("span", { class: `cpi-hh-dir ${dir} inert`, "aria-hidden": "true" });
  };
  return el("div", { class: "cpi-hh-dpad" }, slot(up, "up"), slot(left, "left"), el("span", { class: "cpi-hh-dpad-hub", "aria-hidden": "true" }), slot(right, "right"), slot(down, "down"));
}

/** A round face button: `letter` moulded on it, `label` printed beside it (e.g. A / JUMP). */
export function faceButton(letter, { label = "", cls = "", aria = label || letter, keyHint = "" } = {}) {
  return el(
    "button",
    { class: `cpi-hh-face-btn ${cls}`.trim(), type: "button", "aria-label": aria, dataset: { letter } },
    el("span", { class: "cpi-hh-letter", "aria-hidden": "true", text: letter }),
    label ? el("span", { class: "cpi-hh-label", text: label }) : null,
    keyHint ? el("span", { class: "cpi-hh-key", "aria-hidden": "true", text: keyHint }) : null,
  );
}

/** An analog stick (decorative); its nub follows setTilt(). */
function stick(which) {
  return el("div", { class: `cpi-hh-stick ${which}`, "aria-hidden": "true" }, el("span", { class: "cpi-hh-nub" }));
}

function abxy() {
  return el(
    "div",
    { class: "cpi-hh-abxy", "aria-hidden": "true" },
    ["Y", "X", "B", "A"].map((l) => el("span", { class: `cpi-hh-face-btn inert l-${l}`, dataset: { letter: l } }, el("span", { class: "cpi-hh-letter", text: l }))),
  );
}

const grille = () => el("span", { class: "cpi-hh-grille", "aria-hidden": "true" });

/** The standard left grip: stick over d-pad, a speaker grille. */
export const decorativeLeft = () => el("div", { class: "cpi-hh-cluster" }, stick("left"), dpad(), grille());
/** The standard right grip: face buttons over a stick. */
export const decorativeRight = () => el("div", { class: "cpi-hh-cluster" }, abxy(), stick("right"), grille());

function batteryIcon() {
  return el("span", { class: "cpi-hh-battery", "aria-hidden": "true" }, el("span", { class: "cpi-hh-battery-fill" }));
}

function signalIcon() {
  return el("span", { class: "cpi-hh-signal", "aria-hidden": "true" }, [1, 2, 3, 4].map((i) => el("span", { class: `bar b${i}` })));
}

/** The CPI KERNEL wordmark: a kernel, and the name. */
export function kernelMark(extra = "") {
  return el("span", { class: `cpi-hh-mark ${extra}`.trim() }, el("span", { class: "cpi-hh-kernel", "aria-hidden": "true" }), el("span", { text: "CPI KERNEL" }));
}

/**
 * The device. Options: title, owner (a "PROPERTY OF" sticker), layout ("auto" | "landscape" |
 * "portrait"), left / right (grip contents; decorative by default), below (portrait-only extras
 * under the controls), shoulders ({ left, right } buttons, or decorative), rock (the device leans a
 * little with setTilt), label (the screen's accessible name).
 */
export function createHandheld({ title = "", owner = null, layout = "auto", left = null, right = null, below = null, shoulders = null, rock = false, label = "Game screen", className = "" } = {}) {
  const screen = el("div", { class: "cpi-hh-screen", role: "group", "aria-label": label });
  const glass = el("div", { class: "cpi-hh-glass", "aria-hidden": "true" });
  const overlay = el("div", { class: "cpi-hh-overlay", hidden: true });
  const titleEl = el("span", { class: "cpi-hh-title", text: title });
  const noteEl = el("span", { class: "cpi-hh-note", role: "status", "aria-live": "polite" });
  const clockEl = el("span", { class: "cpi-hh-clock" });
  const pctEl = el("span", { class: "cpi-hh-pct" });
  const battery = batteryIcon();
  const signal = signalIcon();
  const extraEl = el("span", { class: "cpi-hh-extra" });
  const status = el("div", { class: "cpi-hh-status" }, kernelMark(), el("span", { class: "cpi-hh-center" }, titleEl, noteEl), el("span", { class: "cpi-hh-sys" }, extraEl, signal, clockEl, battery, pctEl));
  const shoulder = (side) => {
    const given = shoulders?.[side];
    if (given) {
      given.classList.add("cpi-hh-shoulder", side);
      return given;
    }
    return el("span", { class: `cpi-hh-shoulder ${side} inert`, "aria-hidden": "true" }, el("span", { text: side === "left" ? "L" : "R" }));
  };
  const lShoulder = shoulder("left");
  const rShoulder = shoulder("right");
  const gripL = el("div", { class: "cpi-hh-grip left" }, left ?? decorativeLeft());
  const gripR = el("div", { class: "cpi-hh-grip right" }, right ?? decorativeRight());
  const sticker = owner ? el("span", { class: "cpi-hh-sticker", "aria-hidden": "true", text: `PROPERTY OF ${owner}` }) : null;
  const face = el(
    "div",
    { class: "cpi-hh-face" },
    el("div", { class: "cpi-hh-bezel" }, status, el("div", { class: "cpi-hh-screen-wrap" }, screen, glass, overlay)),
    el("div", { class: "cpi-hh-under", "aria-hidden": "true" }, kernelMark("small"), el("span", { class: "cpi-hh-led" }), sticker),
  );
  const node = el(
    "div",
    { class: `cpi-hh ${className}`.trim(), dataset: { layout: layout === "auto" ? "landscape" : layout } },
    el("div", { class: "cpi-hh-shoulders" }, lShoulder, rShoulder),
    el("div", { class: "cpi-hh-body" }, gripL, face, gripR, below ? el("div", { class: "cpi-hh-below" }, below) : null),
  );

  // ---- layout: measured as soon as the device is on the page (the microtask after it's mounted),
  // so the first frame is already right, then again whenever it's resized.
  let observer = null;
  const measure = () => {
    const width = node.offsetWidth;
    if (width > 0) node.dataset.layout = width < PORTRAIT_BELOW ? "portrait" : "landscape";
  };
  if (layout === "auto") {
    queueMicrotask(() => node.isConnected && measure());
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => (node.isConnected ? measure() : observer.disconnect()));
      observer.observe(node);
    }
  }

  // ---- status bar
  const tickClock = () => {
    const now = new Date();
    clockEl.textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  };
  tickClock();
  const clockTimer = setInterval(() => (node.isConnected ? tickClock() : clearInterval(clockTimer)), 15_000);

  const setStatus = ({ title: t, battery: level, signal: bars, extra, alert } = {}) => {
    if (t !== undefined) titleEl.textContent = t;
    if (typeof level === "number") {
      const pct = Math.round(Math.max(0, Math.min(1, level)) * 100);
      battery.style.setProperty("--level", `${pct}%`);
      battery.classList.toggle("low", pct <= 20);
      pctEl.textContent = `${pct}%`;
    }
    if (typeof bars === "number") {
      const n = Math.round(Math.max(0, Math.min(1, bars)) * 4);
      signal.querySelectorAll(".bar").forEach((b, i) => b.classList.toggle("on", i < n));
    }
    if (extra !== undefined) extraEl.replaceChildren(...[extra].flat().filter(Boolean));
    if (alert !== undefined) node.classList.toggle("alert", !!alert);
  };
  setStatus({ battery: 1, signal: 1 });

  // ---- notifications: in the status bar, so they never cover the game
  const queue = [];
  let showing = null;
  let noteTimer = 0;
  const showNext = () => {
    clearTimeout(noteTimer);
    const item = queue.shift();
    if (!item || !node.isConnected) {
      showing = null;
      status.classList.remove("noting");
      return;
    }
    showing = item;
    noteEl.className = `cpi-hh-note ${item.kind}`;
    noteEl.textContent = `${item.icon ? `${item.icon} ` : ""}${item.text}`;
    status.classList.add("noting");
    noteTimer = setTimeout(showNext, item.ms);
  };
  /** `replace`: this news makes what's queued stale (a new phase): show it now, drop the rest. */
  const notify = (text, { kind = "info", icon = "", ms = 2400, replace = false } = {}) => {
    if (!text) return;
    if (replace) queue.length = 0;
    // A burst of news: keep the newest few, drop the rest.
    if (queue.length >= 3) queue.shift();
    queue.push({ text, kind, icon, ms });
    if (!showing || replace) showNext();
  };

  // ---- feedback
  let flashTimer = 0;
  const flash = (kind = "warn", ms = 1200) => {
    clearTimeout(flashTimer);
    glass.dataset.flash = "";
    void glass.offsetWidth; // restart the animation
    glass.dataset.flash = kind;
    flashTimer = setTimeout(() => (glass.dataset.flash = ""), ms);
  };
  let shakeTimer = 0;
  const shake = (ms = 420) => {
    clearTimeout(shakeTimer);
    node.classList.remove("shake");
    void node.offsetWidth;
    node.classList.add("shake");
    shakeTimer = setTimeout(() => node.classList.remove("shake"), ms);
  };
  const nubs = () => node.querySelectorAll(".cpi-hh-stick.left .cpi-hh-nub");
  let lastTilt = null;
  const setTilt = (v) => {
    const tilt = Math.max(-1, Math.min(1, Number(v) || 0));
    if (lastTilt !== null && Math.abs(tilt - lastTilt) < 0.01) return;
    lastTilt = tilt;
    nubs().forEach((n) => n.style.setProperty("--x", `${Math.round(tilt * 34)}%`));
    lShoulder.classList.toggle("lit", tilt < -0.25);
    rShoulder.classList.toggle("lit", tilt > 0.25);
    if (rock) node.style.setProperty("--rock", `${(tilt * 1.2).toFixed(2)}deg`);
  };

  // ---- overlays and sequences (boot, launch, title cards), all skippable
  let overlayToken = 0;
  let running = null;
  const paint = (content, cls) => {
    const token = ++overlayToken;
    overlay.className = `cpi-hh-overlay ${cls}`.trim();
    overlay.replaceChildren(...[content].flat().filter(Boolean));
    overlay.hidden = false;
    return token;
  };
  /**
   * Shows something over the screen (`cls`: "band", "band bottom", "stamp", "card"…); `ms` clears
   * it. It replaces whatever was there, a running sequence included: the game has moved on.
   */
  const showOverlay = (content, cls = "", { ms = 0 } = {}) => {
    running?.skip();
    const token = paint(content, cls);
    if (ms) setTimeout(() => token === overlayToken && hide(), ms);
  };
  const clearOverlay = () => {
    running?.skip();
    hide();
  };
  const hide = () => {
    const token = ++overlayToken;
    overlay.classList.add("leaving");
    setTimeout(() => {
      if (token !== overlayToken) return;
      overlay.hidden = true;
      overlay.replaceChildren();
      overlay.className = "cpi-hh-overlay";
    }, 220);
  };

  /**
   * Plays steps ({ ms, render(): Node, cls?, enter?() }) in the screen overlay, then clears it.
   * A tap, click or key skips the rest. Returns { skip(), done: Promise<boolean skipped> }.
   */
  const sequence = (steps) => {
    running?.skip();
    let finished = false;
    let timer = 0;
    let resolve;
    const done = new Promise((r) => (resolve = r));
    const finish = (skipped) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      removeEventListener("keydown", onKey, true);
      node.removeEventListener("pointerdown", onTap, true);
      node.classList.remove("in-sequence");
      running = null;
      hide();
      resolve(skipped);
    };
    const onKey = (e) => {
      if (e.repeat || e.target?.closest?.("input, textarea, select")) return;
      finish(true);
    };
    const onTap = () => finish(true);
    const run = (i) => {
      if (finished) return;
      if (i >= steps.length || !node.isConnected) return finish(false);
      const step = steps[i];
      paint(step.render?.() ?? null, `seq ${step.cls ?? ""}`);
      step.enter?.();
      timer = setTimeout(() => run(i + 1), step.ms);
    };
    addEventListener("keydown", onKey, true);
    node.addEventListener("pointerdown", onTap, true);
    node.classList.add("in-sequence");
    run(0);
    running = { skip: () => finish(true), done };
    return running;
  };

  return {
    node,
    screen,
    setStatus,
    notify,
    flash,
    shake,
    setTilt,
    overlay: showOverlay,
    clearOverlay,
    sequence,
    get layout() {
      return node.dataset.layout;
    },
    destroy() {
      observer?.disconnect();
      running?.skip();
      clearInterval(clockTimer);
    },
  };
}

// ------------------------------------------------------------------ standard screens

/**
 * The CPI KERNEL boot screen: logo, a few boot lines and a progress bar that fills over `ms`.
 * `lines` are the silly checks it "runs".
 */
export function bootScreen({ lines = [], ms = 1400, version = "KERNEL OS 4.20" } = {}) {
  const bar = el("span", { class: "cpi-boot-bar" }, el("span", { class: "cpi-boot-fill" }));
  bar.style.setProperty("--ms", `${ms}ms`);
  return el(
    "div",
    { class: "cpi-boot" },
    el("div", { class: "cpi-boot-logo" }, el("span", { class: "cpi-hh-kernel big", "aria-hidden": "true" }), el("span", { class: "cpi-boot-name", text: "CPI KERNEL" })),
    el("p", { class: "cpi-boot-ver", text: version }),
    el(
      "ul",
      { class: "cpi-boot-lines" },
      lines.map((line, i) => {
        const li = el("li", { text: line });
        li.style.setProperty("--i", String(i));
        return li;
      }),
    ),
    bar,
  );
}

/** A full-screen system card: a big line, a smaller one, and an optional kind for colour. */
export function systemCard({ eyebrow = "", title = "", text = "", kind = "", children = [] } = {}) {
  return el(
    "div",
    { class: `cpi-card ${kind}`.trim() },
    eyebrow ? el("p", { class: "cpi-card-eyebrow", text: eyebrow }) : null,
    title ? el("p", { class: "cpi-card-title", text: title }) : null,
    text ? el("p", { class: "cpi-card-text", text }) : null,
    ...children,
  );
}
