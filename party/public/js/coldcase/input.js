// CPI: Cold Case — input. Keyboard (by key position, so WASD works on any layout), touch and a
// gamepad all become the simulation's logical controls: move, interact, action, adjust, cancel.
// Presses are edges: they are handed to the simulation once, on the first step of a frame.

const MOVE = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const SCROLL_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const STICK_RADIUS = 52;

/** Pointer capture can throw (e.g. for a pointer that is already gone); losing it is harmless. */
function capture(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* keep going without capture */
  }
}
const DEADZONE = 0.14;

export function createInput({ stickZone, stick, useBtn, heatBtn, panelMinus, panelPlus, panelPrimary, onPause, onCancel, onMap, onBegin, onTouch, panelOpen }) {
  const keys = new Set();
  const edges = { interact: false, action: false, cancel: false };
  const touch = { id: null, ox: 0, oy: 0, vx: 0, vy: 0, use: false, heat: false, minus: false, plus: false, primary: false };
  const pad = { prev: [], index: -1 };
  let lastPad = null;
  let adjustPrev = 0;
  let repeatT = 0;
  let adjustEdge = 0;
  let touchMode = false;

  // A click queued straight from a press, so a tap shorter than a frame still counts.
  function queueAdjust(direction) {
    adjustEdge = direction;
    adjustPrev = direction;
    repeatT = 0.32;
  }

  function enterTouchMode() {
    if (touchMode) return;
    touchMode = true;
    onTouch?.();
  }

  addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();
    const first = !e.repeat;
    keys.add(e.code);
    if (!first) return;
    if (LEFT.has(e.code) && panelOpen()) queueAdjust(-1);
    else if (RIGHT.has(e.code) && panelOpen()) queueAdjust(1);
    if (e.code === "KeyE") edges.interact = true;
    else if (e.code === "Space") edges.action = true;
    else if (e.code === "Escape" || e.code === "KeyP" || e.code === "Backspace") {
      if (panelOpen()) {
        edges.cancel = true;
        onCancel?.();
      } else if (e.code !== "Backspace") onPause?.();
    } else if (e.code === "KeyM") onMap?.();
    else if (e.code === "Enter" || e.code === "NumpadEnter") onBegin?.();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => {
    keys.clear();
    releaseTouch();
  });

  // ---------------------------------------------------------------- touch stick

  stickZone.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || touch.id !== null) return;
    enterTouchMode();
    touch.id = e.pointerId;
    touch.ox = e.clientX;
    touch.oy = e.clientY;
    touch.vx = 0;
    touch.vy = 0;
    capture(stickZone, e.pointerId);
    stick.hidden = false;
    stick.style.left = `${e.clientX}px`;
    stick.style.top = `${e.clientY}px`;
    stick.firstElementChild.style.transform = "";
    e.preventDefault();
  });
  stickZone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== touch.id) return;
    let dx = (e.clientX - touch.ox) / STICK_RADIUS;
    let dy = (e.clientY - touch.oy) / STICK_RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    const k = len < DEADZONE ? 0 : 1;
    touch.vx = dx * k;
    touch.vy = dy * k;
    stick.firstElementChild.style.transform = `translate(${dx * STICK_RADIUS * 0.72}px, ${dy * STICK_RADIUS * 0.72}px)`;
    e.preventDefault();
  });
  const endStick = (e) => {
    if (e.pointerId !== touch.id) return;
    touch.id = null;
    touch.vx = 0;
    touch.vy = 0;
    stick.hidden = true;
  };
  stickZone.addEventListener("pointerup", endStick);
  stickZone.addEventListener("pointercancel", endStick);

  // ---------------------------------------------------------------- buttons

  function holdButton(el, key, { onPress } = {}) {
    const down = (e) => {
      if (e.pointerType !== "mouse") enterTouchMode();
      touch[key] = true;
      el.classList.add("active");
      capture(el, e.pointerId);
      onPress?.();
      e.preventDefault();
    };
    const up = () => {
      touch[key] = false;
      el.classList.remove("active");
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  holdButton(useBtn, "use", { onPress: () => (edges.interact = true) });
  holdButton(heatBtn, "heat", { onPress: () => (edges.action = true) });
  holdButton(panelMinus, "minus", { onPress: () => queueAdjust(-1) });
  holdButton(panelPlus, "plus", { onPress: () => queueAdjust(1) });
  holdButton(panelPrimary, "primary", { onPress: () => (edges.interact = true) });

  function releaseTouch() {
    for (const key of ["use", "heat", "minus", "plus", "primary"]) touch[key] = false;
    for (const el of [useBtn, heatBtn, panelMinus, panelPlus, panelPrimary]) el.classList.remove("active");
  }

  // ---------------------------------------------------------------- gamepad

  function readPad() {
    const pads = globalThis.navigator?.getGamepads?.() ?? [];
    let gp = null;
    for (const p of pads) {
      if (p && p.connected) {
        gp = p;
        break;
      }
    }
    if (!gp) return null;
    const pressed = gp.buttons.map((b) => Boolean(b?.pressed));
    const was = pad.prev;
    const edge = (i) => pressed[i] && !was[i];
    pad.prev = pressed;
    let x = gp.axes[0] ?? 0;
    let y = gp.axes[1] ?? 0;
    if (Math.hypot(x, y) < 0.2) {
      x = 0;
      y = 0;
    }
    if (pressed[14]) x = -1;
    if (pressed[15]) x = 1;
    if (pressed[12]) y = -1;
    if (pressed[13]) y = 1;
    if (edge(0)) edges.interact = true;
    if (edge(2)) edges.action = true;
    if (edge(1) && panelOpen()) {
      edges.cancel = true;
      onCancel?.();
    }
    if (edge(9)) onPause?.();
    if (edge(8) || edge(3)) onMap?.();
    return { x, y, interact: pressed[0], action: pressed[2] };
  }

  /**
   * The controls for this simulation step. `consume` hands over (and clears) the presses; pass it
   * on the first step of each frame only.
   */
  function poll(dt, consume) {
    let mx = 0;
    let my = 0;
    for (const code of keys) {
      const m = MOVE[code];
      if (!m) continue;
      mx += m[0];
      my += m[1];
    }
    mx = Math.max(-1, Math.min(1, mx));
    my = Math.max(-1, Math.min(1, my));
    if (touch.id !== null) {
      mx = touch.vx;
      my = touch.vy;
    }
    // The pad is read once a frame; later steps of the same frame reuse the reading.
    const gp = consume ? (lastPad = readPad()) : lastPad;
    if (gp && (gp.x || gp.y)) {
      mx = gp.x;
      my = gp.y;
    }

    let adjustHeld = 0;
    for (const code of keys) {
      if (LEFT.has(code)) adjustHeld -= 1;
      if (RIGHT.has(code)) adjustHeld += 1;
    }
    if (touch.minus) adjustHeld -= 1;
    if (touch.plus) adjustHeld += 1;
    if (gp && panelOpen() && Math.abs(gp.x) > 0.4) adjustHeld += Math.sign(gp.x);
    adjustHeld = Math.max(-1, Math.min(1, adjustHeld));
    // Adjust clicks: one on press, then repeating while held.
    if (consume) {
      if (adjustHeld && adjustHeld !== adjustPrev) {
        adjustEdge = adjustHeld;
        repeatT = 0.32;
      } else if (adjustHeld) {
        repeatT -= dt;
        if (repeatT <= 0) {
          adjustEdge = adjustHeld;
          repeatT = 0.085;
        }
      }
      adjustPrev = adjustHeld;
    }

    const input = {
      moveX: mx,
      moveY: my,
      interact: keys.has("KeyE") || touch.use || touch.primary || Boolean(gp?.interact),
      interactPressed: false,
      action: keys.has("Space") || touch.heat || Boolean(gp?.action),
      actionPressed: false,
      cancelPressed: false,
      adjust: 0,
      adjustHeld,
    };
    if (consume) {
      input.interactPressed = edges.interact;
      input.actionPressed = edges.action;
      input.cancelPressed = edges.cancel;
      input.adjust = adjustEdge;
      edges.interact = false;
      edges.action = false;
      edges.cancel = false;
      adjustEdge = 0;
    }
    return input;
  }

  function reset() {
    keys.clear();
    edges.interact = false;
    edges.action = false;
    edges.cancel = false;
    adjustEdge = 0;
    releaseTouch();
  }

  if (globalThis.matchMedia?.("(pointer: coarse)").matches) enterTouchMode();
  addEventListener("touchstart", enterTouchMode, { passive: true, once: true });

  return {
    poll,
    reset,
    get touchMode() {
      return touchMode;
    },
  };
}
