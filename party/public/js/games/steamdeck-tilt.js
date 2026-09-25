// Steam My Deck: Thad's tilt as one number -1..1, from any device. No special hardware:
//
//   Keyboard  ← → (or A D) lean the world, further the longer you hold; ↓, S or Space levels it.
//   Mouse / touch  the slider (and its Level button), or hold the device's L / R shoulder buttons
//             (exactly like holding ← →).
//   Gamepad   the left stick, while it's pushed (a Steam Deck's controls show up as a gamepad).
//   Motion    optional: only if Thad turns it on and the device reports.
//
// The keys and the slider share one value, so they never fight. A pushed stick wins while pushed;
// otherwise live motion; otherwise that shared value. Using the keys or the slider turns motion off.
// Every source gets the same dead zone, clamp and smoothing, so devices don't behave wildly differently.

const DEAD_ZONE = 0.08;
/** Degrees of physical tilt that count as full tilt. */
const MOTION_RANGE = 30;
const STICK_DEAD_ZONE = 0.15;
/** A sensor that has said nothing for this long counts as gone. */
const MOTION_STALE_MS = 800;
/** How fast held arrow keys lean the world, in full tilts per second. */
const KEY_RATE = 1.6;
const TICK_MS = 33;

const clamp = (n) => Math.max(-1, Math.min(1, n));
const deadZone = (n, zone) => (Math.abs(n) < zone ? 0 : Math.sign(n) * ((Math.abs(n) - zone) / (1 - zone)));

/** Left/right tilt in degrees for how the screen is held right now. */
function rawRoll(e) {
  const angle = globalThis.screen?.orientation?.angle ?? globalThis.orientation ?? 0;
  if (angle === 90) return e.beta ?? 0;
  if (angle === -90 || angle === 270) return -(e.beta ?? 0);
  if (angle === 180) return -(e.gamma ?? 0);
  return e.gamma ?? 0;
}

export function createTiltInput() {
  const listeners = new Set();
  let value = 0;
  let source = "manual";
  let manual = 0;
  const held = { left: false, right: false };
  let offset = 0;
  let lastRoll = 0;
  let motionAt = 0;
  let motion = "off"; // off | asking | on | denied | unavailable
  let lastLive = false;

  const live = () => motion === "on" && performance.now() - motionAt < MOTION_STALE_MS;
  const emit = () => listeners.forEach((fn) => fn({ value, source, motion, live: live() }));

  const onOrientation = (e) => {
    if (e.beta === null && e.gamma === null) return;
    // Recorded always, used only once Thad turns motion on (Android sends these without asking).
    lastRoll = rawRoll(e);
    motionAt = performance.now();
  };

  const onKey = (e) => {
    // Only while a Thad screen is listening, and never while typing (the slider handles its own keys).
    if (!listeners.size || e.target?.closest?.("input, textarea, select")) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const left = k === "ArrowLeft" || k === "a";
    const right = k === "ArrowRight" || k === "d";
    const level = k === "ArrowDown" || k === "s" || k === " ";
    if (!left && !right && !level) return;
    e.preventDefault();
    const down = e.type === "keydown";
    if (left) held.left = down;
    if (right) held.right = down;
    if (level && down) manual = 0;
    if (down && motion === "on") motion = "off";
  };

  const read = () => {
    const keyDir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    if (keyDir) manual = clamp(manual + (keyDir * KEY_RATE * TICK_MS) / 1000);
    let target = manual;
    let from = keyDir ? "keys" : "manual";
    const pad = [...(globalThis.navigator?.getGamepads?.() ?? [])].find((g) => g?.connected);
    const stick = pad ? deadZone(pad.axes[0] ?? 0, STICK_DEAD_ZONE) : 0;
    if (stick !== 0) {
      target = stick;
      from = "stick";
    } else if (!keyDir && live()) {
      target = deadZone(clamp((lastRoll - offset) / MOTION_RANGE), DEAD_ZONE);
      from = "motion";
    } else if (!keyDir && pad && manual === 0) {
      // A gamepad is plugged in and nothing else is leaning: say the stick is ready.
      from = "stick";
    }
    // Smoothing: jitter never reaches the level, big moves still land fast.
    const next = clamp(value + (target - value) * 0.3);
    const wasLive = lastLive;
    lastLive = live();
    const changed = Math.abs(next - value) > 0.002 || from !== source || wasLive !== lastLive;
    value = Math.abs(next) < 0.005 ? 0 : next;
    source = from;
    if (changed) emit();
  };

  globalThis.addEventListener?.("deviceorientation", onOrientation);
  globalThis.addEventListener?.("keydown", onKey);
  globalThis.addEventListener?.("keyup", onKey);
  // An interval, not animation frames: it keeps reading the stick and keys even if the page is hidden.
  const loop = setInterval(read, TICK_MS);

  return {
    get value() {
      return value;
    },
    get source() {
      return source;
    },
    get motion() {
      return motion;
    },
    onChange(fn) {
      listeners.add(fn);
      fn({ value, source, motion, live: live() });
      return () => listeners.delete(fn);
    },
    /** Asks for the motion sensor (iOS needs a tap and a permission prompt). Resolves to its status. */
    async enableMotion() {
      const Orientation = globalThis.DeviceOrientationEvent;
      if (!Orientation) {
        motion = "unavailable";
        emit();
        return motion;
      }
      motion = "asking";
      emit();
      try {
        if (typeof Orientation.requestPermission === "function") {
          const answer = await Orientation.requestPermission();
          if (answer !== "granted") {
            motion = "denied";
            emit();
            return motion;
          }
        }
      } catch {
        motion = "denied";
        emit();
        return motion;
      }
      // Desktops and the Deck's browser often have the API but no sensor: wait for a reading.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      motion = performance.now() - motionAt > MOTION_STALE_MS ? "unavailable" : "on";
      if (motion === "on") offset = lastRoll;
      emit();
      return motion;
    },
    disableMotion() {
      motion = "off";
      emit();
    },
    /** Whatever angle the device is at now becomes level (and the slider goes back to level). */
    calibrate() {
      offset = lastRoll;
      manual = 0;
      emit();
      return live();
    },
    setManual(v) {
      manual = clamp(Number(v) || 0);
    },
    /** An on-screen button held or let go: "left" / "right" behave exactly like the arrow keys. */
    hold(side, down) {
      if (side !== "left" && side !== "right") return;
      held[side] = !!down;
      if (down && motion === "on") motion = "off";
    },
    get manual() {
      return manual;
    },
    destroy() {
      clearInterval(loop);
      globalThis.removeEventListener?.("deviceorientation", onOrientation);
      globalThis.removeEventListener?.("keydown", onKey);
      globalThis.removeEventListener?.("keyup", onKey);
      listeners.clear();
    },
  };
}
