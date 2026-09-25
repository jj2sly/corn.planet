// CPI animation: turns what a screen already knows about a character (its authoritative position,
// sampled every server tick, and whether it's alive, dead or out) into an animation state for
// cpi/character.js, plus the moments worth an effect (jumped, landed, died, respawned, escaped).
//
// It only reads positions, so it needs nothing extra from the server and can never change a game:
// rules decide where a character is, this decides how that looks.
//
//   const anim = createAnimator();
//   anim.observe({ time, x, y, status: "alive", facing });  // every new server tick → events
//   anim.trigger("place", time);                          // one-off actions the game knows about
//   anim.setFlag("drawing", true);                         // held poses
//   const pose = anim.pose(time, x);                       // every frame → { state, t, squash, … }
//
// Positions are whole units (servers round them), so "not moving vertically" is exact: standing on
// something shows up as a vertical step of 0 twice running.

export const ANIM = Object.freeze({
  /** Horizontal speed (units/s) that counts as running rather than standing. */
  runSpeed: 45,
  /** Faster than this on the ground and you're sliding, not running. */
  slideSpeed: 400,
  /** Moving against the way you face at this speed (a push you're fighting) is a slip. */
  slipSpeed: 70,
  /** Distance per run cycle, in units. */
  stride: 36,
  landS: 0.14,
  jumpS: 0.14,
  placeS: 0.42,
  hitS: 0.28,
  spawnS: 0.45,
  escapeS: 0.9,
  /** A landing from this fall speed (units/s) or more is a hard one. */
  hardLanding: 900,
});

/** An animation state machine for one character. */
export function createAnimator(options = {}) {
  const cfg = { ...ANIM, ...options };
  let last = null; // previous sample
  let dy = 0; // vertical step of the latest sample (units)
  let prevDy = 0;
  let vx = 0;
  let vy = 0;
  let fallSpeed = 0; // the fastest it fell since leaving the ground
  let grounded = false;
  let status = "alive";
  let facing = 1;
  let action = null; // { name, at, length, strength }
  let landing = 0; // how hard the last landing was, 0..1
  let statusAt = 0;
  let airborneAt = 0;
  const flags = new Set();
  let cycle = 0;
  let cycleX = null;

  const act = (name, at, length, strength = 1) => (action = { name, at, length, strength });

  return {
    /**
     * One authoritative sample. Returns what happened since the last one: "jump", "land", "walkoff",
     * "die", "respawn", "escape" (each at most once).
     */
    observe({ time, x, y, status: next = "alive", facing: f = facing }) {
      const events = [];
      facing = f < 0 ? -1 : 1;
      if (next !== status) {
        if (next === "dead") events.push("die"), act("hit", time, cfg.hitS);
        else if (next === "escaped") events.push("escape"), act("escape", time, cfg.escapeS);
        else if (status === "dead") events.push("respawn"), act("spawn", time, cfg.spawnS);
        status = next;
        statusAt = time;
        // A teleport isn't movement: start measuring again from here.
        last = { time, x, y };
        dy = prevDy = 0;
        vx = vy = 0;
        grounded = false;
        cycleX = x;
        return events;
      }
      if (!last) {
        last = { time, x, y };
        cycleX = x;
        return events;
      }
      const dt = Math.max(0.001, time - last.time);
      prevDy = dy;
      dy = y - last.y;
      vx = (x - last.x) / dt;
      vy = dy / dt;
      last = { time, x, y };
      if (status !== "alive") return events;

      const still = Math.abs(dy) < 0.5;
      const wasGrounded = grounded;
      // Standing on something: no vertical step now, and not rising into this one (a jump's apex
      // can round to a zero step for one tick).
      grounded = still && prevDy >= -0.5;
      if (!wasGrounded && grounded && prevDy > 0.5) {
        events.push("land");
        landing = Math.min(1, fallSpeed / cfg.hardLanding);
        act("land", time, cfg.landS, landing);
      } else if (dy < -2 && prevDy >= -0.5) {
        events.push("jump");
        act("jump", time, cfg.jumpS);
      } else if (wasGrounded && !grounded && dy > 0.5) {
        events.push("walkoff");
      }
      if (!grounded) {
        if (wasGrounded) {
          airborneAt = time;
          fallSpeed = 0;
        }
        // The fastest, not the last: the tick you land in is only part-way down.
        fallSpeed = Math.max(fallSpeed, vy);
      }
      return events;
    },

    /** A one-off action the game knows about: "place" (built something), "hit", "cheer". */
    trigger(name, time, length = name === "place" ? cfg.placeS : name === "hit" ? cfg.hitS : 0.6) {
      act(name, time, length);
    },

    /** Held poses, e.g. "drawing". */
    setFlag(name, on) {
      if (on) flags.add(name);
      else flags.delete(name);
    },

    get grounded() {
      return grounded;
    },
    get velocity() {
      return { x: vx, y: vy };
    },
    /** How hard the last landing was: 0 (a hop) to 1 (a long fall). */
    get landing() {
      return landing;
    },
    get status() {
      return status;
    },
    /** Seconds in the air so far (0 on the ground). */
    airTime(time) {
      return grounded || status !== "alive" ? 0 : Math.max(0, time - airborneAt);
    },

    /**
     * How the character looks at `time`. `x` is where it's drawn this frame (interpolated), which
     * keeps the run cycle in step with the feet. Returns { state, t, cycle, squash, scale, alpha,
     * lift, effects, flash, gone }.
     */
    pose(time, x = last?.x ?? 0) {
      if (cycleX === null) cycleX = x;
      cycle += Math.abs(x - cycleX) / cfg.stride;
      cycleX = x;
      const out = { state: "idle", t: time - statusAt, cycle, squash: 1, scale: 1, alpha: 1, lift: 0, effects: [], flash: false, gone: false, speed: Math.abs(vx) };
      const a = action && time - action.at < action.length ? action : null;
      const at = a ? time - a.at : 0;
      const k = a ? at / a.length : 1;

      if (status === "escaped") {
        const e = Math.min(1, (time - statusAt) / cfg.escapeS);
        out.state = "escape";
        out.t = time - statusAt;
        out.scale = 1 - 0.75 * e * e;
        out.alpha = 1 - e * e;
        out.lift = -26 * e;
        out.effects = ["sparkle"];
        out.gone = e >= 1;
        return out;
      }
      if (status === "dead") {
        const since = time - statusAt;
        if (since < cfg.hitS) {
          out.state = "hit";
          out.t = since;
          out.flash = since < 0.1;
          out.effects = ["stunned"];
        } else {
          out.state = "dead";
          out.t = since - cfg.hitS;
          out.lift = -Math.min(40, out.t * 22);
          out.alpha = Math.max(0.25, 1 - out.t * 0.35);
        }
        return out;
      }

      if (a?.name === "spawn") {
        // Materialising: grows in from a flicker.
        out.scale = 0.6 + 0.4 * Math.min(1, k * 1.4);
        out.alpha = Math.min(1, 0.3 + k);
        out.effects = ["sparkle"];
      }
      if (a?.name === "place") {
        out.state = "place";
        out.t = at;
        return out;
      }
      if (a?.name === "cheer") {
        out.state = "cheer";
        out.t = at;
        return out;
      }
      if (flags.has("drawing") && grounded) {
        out.state = "draw";
        out.t = time - statusAt;
        return out;
      }
      if (!grounded) {
        out.state = vy < -60 ? "jump" : "fall";
        out.t = time - airborneAt;
        if (a?.name === "jump") out.squash = 1 + 0.2 * (1 - k); // stretch on take-off
        else if (vy > 1000) out.squash = 1.06;
        if (flags.has("drawing")) out.state = "draw";
        return out;
      }
      if (a?.name === "land") {
        out.state = "land";
        out.t = at;
        out.squash = 1 - (0.14 + 0.16 * a.strength) * Math.sin(Math.PI * Math.min(1, k * 1.2));
        return out;
      }
      const speed = Math.abs(vx);
      const against = vx !== 0 && Math.sign(vx) !== facing;
      // Dragged backwards fast is a slide; fighting a push is a slip; with it, you just run faster.
      if (against && speed > cfg.slideSpeed) {
        out.state = "slide";
        out.effects = ["speed", "sweat"];
      } else if (against && speed > cfg.slipSpeed) {
        out.state = "slip";
        out.effects = ["sweat"];
      } else if (speed > cfg.runSpeed) {
        out.state = "run";
        if (speed > cfg.slideSpeed) out.effects = ["speed"];
      }
      return out;
    },
  };
}
