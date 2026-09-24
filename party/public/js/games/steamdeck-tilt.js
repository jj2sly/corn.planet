// Escape Thad's Steam Deck: Thad's tilt, from whatever the device has, as one number -1..1.
//
// Sources, best first: the motion sensor (after permission, calibrated), a gamepad stick (the Steam
// Deck's left stick shows up as one), the arrow keys, and the on-screen slider, which always works.
// Every source gets the same dead zone, clamp and smoothing, so devices don't behave wildly differently.

const DEAD_ZONE = 0.08;
/** Degrees of physical tilt that count as full tilt. */
const MOTION_RANGE = 30;
const STICK_DEAD_ZONE = 0.15;
/** A sensor that has said nothing for this long counts as gone. */
const MOTION_STALE_MS = 800;

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
  let keys = 0;
  let offset = 0;
  let lastRoll = 0;
  let motionAt = 0;
  let motion = "off"; // off | asking | on | denied | unavailable
  let raf = 0;

  const emit = () => listeners.forEach((fn) => fn({ value, source, motion }));

  const onOrientation = (e) => {
    if (e.beta === null && e.gamma === null) return;
    // Recorded always, used only once Thad turns motion on (Android sends these without asking).
    lastRoll = rawRoll(e);
    motionAt = performance.now();
  };

  const onKey = (e) => {
    if (e.target?.closest?.("input, textarea")) return;
    const left = e.key === "ArrowLeft" || e.key === "a";
    const right = e.key === "ArrowRight" || e.key === "d";
    if (!left && !right) return;
    const down = e.type === "keydown";
    keys = down ? (left ? -1 : 1) : 0;
  };

  const read = () => {
    let target = manual;
    let from = "manual";
    const pad = [...(globalThis.navigator?.getGamepads?.() ?? [])].find((g) => g?.connected);
    const stick = pad ? deadZone(pad.axes[0] ?? 0, STICK_DEAD_ZONE) : 0;
    if (motion === "on" && performance.now() - motionAt < MOTION_STALE_MS) {
      target = deadZone(clamp((lastRoll - offset) / MOTION_RANGE), DEAD_ZONE);
      from = "motion";
    } else if (stick !== 0) {
      target = stick;
      from = "stick";
    } else if (keys !== 0) {
      target = keys;
      from = "keys";
    } else if (pad && manual === 0) {
      from = "stick";
    }
    // Smoothing: jitter never reaches the level, big moves still land fast.
    const next = clamp(value + (target - value) * 0.3);
    const changed = Math.abs(next - value) > 0.002 || from !== source;
    value = Math.abs(next) < 0.005 ? 0 : next;
    source = from;
    if (changed) emit();
    raf = requestAnimationFrame(read);
  };

  globalThis.addEventListener?.("deviceorientation", onOrientation);
  globalThis.addEventListener?.("keydown", onKey);
  globalThis.addEventListener?.("keyup", onKey);
  raf = requestAnimationFrame(read);

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
      fn({ value, source, motion });
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
    /** Whatever angle the device is at now becomes level. */
    calibrate() {
      offset = lastRoll;
      manual = 0;
      emit();
    },
    setManual(v) {
      manual = clamp(Number(v) || 0);
    },
    destroy() {
      cancelAnimationFrame(raf);
      globalThis.removeEventListener?.("deviceorientation", onOrientation);
      globalThis.removeEventListener?.("keydown", onKey);
      globalThis.removeEventListener?.("keyup", onKey);
      listeners.clear();
    },
  };
}
