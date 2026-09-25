// Just enough platformer for Escape Thad's Steam Deck: boxes, solid rects, one-way planks, hazards,
// water, an exit (which can be locked), and a sideways pull from Thad tilting the Deck. Server-authoritative and deterministic:
// the same inputs give the same result.

import { WORLD, type Rect } from "./levels.ts";

export const PHYS = {
  gravity: 2400,
  moveAccel: 3200,
  airAccel: 2000,
  maxRunSpeed: 380,
  /** Tilt can push a runner past their own top speed, up to this. */
  maxSlideSpeed: 560,
  jumpVelocity: 920,
  maxFall: 1400,
  /** Per second, on the ground with no input. */
  friction: 10,
  width: 28,
  height: 36,
  coyoteS: 0.1,
  jumpBufferS: 0.15,
  respawnS: 1.5,
  // Water: slow sinking, a jump press is a swim stroke up, and a press with your head out of the
  // water leaps out. Stay under too long and you drown.
  waterGravity: 0.22,
  waterMaxFall: 180,
  waterRun: 0.65,
  swimStroke: 380,
  leap: 0.8,
  breathS: 7,
} as const;

export interface RunnerInput {
  left: boolean;
  right: boolean;
  /** Bumped by the client on every jump press. */
  jumpSeq: number;
}

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  coyote: number;
  jumpBuffer: number;
  lastJumpSeq: number;
  /** Seconds until respawn while dead; 0 when alive. */
  deadFor: number;
  escaped: boolean;
  /** In water now, and seconds spent with your head under. */
  wet: boolean;
  breath: number;
}

export interface Plank {
  x1: number;
  x2: number;
  y: number;
}

export interface Arena {
  spawn: [number, number];
  exit: Rect;
  platforms: readonly Rect[];
  hazards: readonly Rect[];
  planks: readonly Plank[];
  water?: readonly Rect[];
  /** False while the exit is locked (items still to find). */
  exitOpen?: boolean;
}

export type StepEvent = "died" | "escaped" | "jumped";

/** A character's movement: multipliers on top speed and acceleration, and on the jump. 1 is normal. */
export interface Stats {
  run: number;
  jump: number;
}

const NORMAL: Stats = { run: 1, jump: 1 };

export function newBody(spawn: [number, number]): Body {
  return { x: spawn[0], y: spawn[1], vx: 0, vy: 0, facing: 1, grounded: false, coyote: 0, jumpBuffer: 0, lastJumpSeq: 0, deadFor: 0, escaped: false, wet: false, breath: 0 };
}

/** Kills a runner (a hazard, a fall, drowning, or something in the woods). False if they can't die now. */
export function kill(b: Body): boolean {
  if (b.deadFor > 0 || b.escaped) return false;
  b.deadFor = PHYS.respawnS;
  b.vx = b.vy = 0;
  b.breath = 0;
  return true;
}

const inside = (x: number, y: number, [rx, ry, rw, rh]: Rect) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

const overlaps = (x: number, y: number, [rx, ry, rw, rh]: Rect) => x < rx + rw && x + PHYS.width > rx && y < ry + rh && y + PHYS.height > ry;

/**
 * Advances one body by `dt` seconds. `tiltAccel` is the sideways pull (units/s²; positive = right).
 * Returns what happened.
 */
export function stepBody(b: Body, input: RunnerInput, arena: Arena, tiltAccel: number, dt: number, stats: Stats = NORMAL): StepEvent[] {
  const events: StepEvent[] = [];
  if (b.escaped) return events;
  if (b.deadFor > 0) {
    b.deadFor = Math.max(0, b.deadFor - dt);
    if (b.deadFor === 0) Object.assign(b, newBody(arena.spawn), { lastJumpSeq: b.lastJumpSeq });
    return events;
  }

  // In water when your middle is.
  const wet = arena.water?.find((r) => inside(b.x + PHYS.width / 2, b.y + PHYS.height / 2, r));
  b.wet = !!wet;
  if (wet) tiltAccel *= 0.5;

  if (input.jumpSeq !== b.lastJumpSeq) {
    b.lastJumpSeq = input.jumpSeq;
    b.jumpBuffer = PHYS.jumpBufferS;
  }
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir) b.facing = dir > 0 ? 1 : -1;

  // Horizontal: your own push, Thad's tilt, and friction when you let go on the ground.
  const own = dir * (b.grounded ? PHYS.moveAccel : PHYS.airAccel) * stats.run;
  b.vx += (own + tiltAccel) * dt;
  if (!dir && (b.grounded || wet)) b.vx -= b.vx * Math.min(1, (wet ? 3 : PHYS.friction) * dt);
  // Going the way the Deck leans, you can slide faster than you can run.
  const cap = (tiltAccel !== 0 && Math.sign(b.vx) === Math.sign(tiltAccel) ? PHYS.maxSlideSpeed : PHYS.maxRunSpeed) * stats.run * (wet ? PHYS.waterRun : 1);
  b.vx = Math.max(-cap, Math.min(cap, b.vx));

  // Jump: buffered presses and a little coyote time, so it feels fair on a phone.
  b.coyote = b.grounded ? PHYS.coyoteS : Math.max(0, b.coyote - dt);
  b.jumpBuffer = Math.max(0, b.jumpBuffer - dt);
  if (wet && b.jumpBuffer > 0) {
    // A stroke up, or with your head out, a leap onto the bank.
    const surfacing = b.y < wet[1] + 16;
    b.vy = -(surfacing ? PHYS.jumpVelocity * PHYS.leap : PHYS.swimStroke) * stats.jump;
    b.jumpBuffer = 0;
    b.coyote = 0;
    b.grounded = false;
    events.push("jumped");
  } else if (b.jumpBuffer > 0 && b.coyote > 0) {
    b.vy = -PHYS.jumpVelocity * stats.jump;
    b.jumpBuffer = 0;
    b.coyote = 0;
    b.grounded = false;
    events.push("jumped");
  }

  b.vy = wet ? Math.min(PHYS.waterMaxFall, b.vy + PHYS.gravity * PHYS.waterGravity * dt) : Math.min(PHYS.maxFall, b.vy + PHYS.gravity * dt);

  // Move and resolve x against solids.
  b.x += b.vx * dt;
  b.x = Math.max(0, Math.min(WORLD.width - PHYS.width, b.x));
  for (const r of arena.platforms) {
    if (!overlaps(b.x, b.y, r)) continue;
    b.x = b.vx > 0 ? r[0] - PHYS.width : r[0] + r[2];
    b.vx = 0;
  }

  // Move and resolve y: solids both ways, planks only when landing from above.
  const prevBottom = b.y + PHYS.height;
  b.y += b.vy * dt;
  b.grounded = false;
  for (const r of arena.platforms) {
    if (!overlaps(b.x, b.y, r)) continue;
    if (b.vy > 0) {
      b.y = r[1] - PHYS.height;
      b.grounded = true;
    } else {
      b.y = r[1] + r[3];
    }
    b.vy = 0;
  }
  if (b.vy >= 0) {
    for (const p of arena.planks) {
      const bottom = b.y + PHYS.height;
      if (prevBottom <= p.y + 0.5 && bottom >= p.y && b.x < p.x2 && b.x + PHYS.width > p.x1) {
        b.y = p.y - PHYS.height;
        b.vy = 0;
        b.grounded = true;
      }
    }
  }

  b.breath = wet && b.y > wet[1] + 2 ? b.breath + dt : 0;
  if (b.y > WORLD.height + 40 || b.breath > PHYS.breathS || arena.hazards.some((h) => overlaps(b.x, b.y, h))) {
    kill(b);
    events.push("died");
  } else if (arena.exitOpen !== false && overlaps(b.x, b.y, arena.exit)) {
    b.escaped = true;
    events.push("escaped");
  }
  return events;
}

/**
 * Thad's shake: throws a runner standing on something up and sideways. Airborne, dead or escaped
 * runners ride it out. Returns whether it hit.
 */
export function jolt(b: Body, vx: number, vy: number): boolean {
  if (!b.grounded || b.deadFor > 0 || b.escaped) return false;
  b.vx += vx;
  b.vy = -Math.abs(vy);
  b.grounded = false;
  b.coyote = 0;
  return true;
}

/** The sideways pull for a tilt of -1..1 at a maximum angle in degrees. */
export function tiltAccel(tilt: number, maxDegrees: number): number {
  return PHYS.gravity * Math.sin((tilt * maxDegrees * Math.PI) / 180);
}
