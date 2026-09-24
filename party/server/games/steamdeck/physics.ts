// Just enough platformer for Escape Thad's Steam Deck: boxes, solid rects, one-way planks, hazards,
// an exit, and a sideways pull from Thad tilting the Deck. Server-authoritative and deterministic:
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
}

export type StepEvent = "died" | "escaped" | "jumped";

export function newBody(spawn: [number, number]): Body {
  return { x: spawn[0], y: spawn[1], vx: 0, vy: 0, facing: 1, grounded: false, coyote: 0, jumpBuffer: 0, lastJumpSeq: 0, deadFor: 0, escaped: false };
}

const overlaps = (x: number, y: number, [rx, ry, rw, rh]: Rect) => x < rx + rw && x + PHYS.width > rx && y < ry + rh && y + PHYS.height > ry;

/**
 * Advances one body by `dt` seconds. `tiltAccel` is the sideways pull (units/s²; positive = right).
 * Returns what happened.
 */
export function stepBody(b: Body, input: RunnerInput, arena: Arena, tiltAccel: number, dt: number): StepEvent[] {
  const events: StepEvent[] = [];
  if (b.escaped) return events;
  if (b.deadFor > 0) {
    b.deadFor = Math.max(0, b.deadFor - dt);
    if (b.deadFor === 0) Object.assign(b, newBody(arena.spawn), { lastJumpSeq: b.lastJumpSeq });
    return events;
  }

  if (input.jumpSeq !== b.lastJumpSeq) {
    b.lastJumpSeq = input.jumpSeq;
    b.jumpBuffer = PHYS.jumpBufferS;
  }
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir) b.facing = dir > 0 ? 1 : -1;

  // Horizontal: your own push, Thad's tilt, and friction when you let go on the ground.
  const own = dir * (b.grounded ? PHYS.moveAccel : PHYS.airAccel);
  b.vx += (own + tiltAccel) * dt;
  if (!dir && b.grounded) b.vx -= b.vx * Math.min(1, PHYS.friction * dt);
  // Going the way the Deck leans, you can slide faster than you can run.
  const cap = tiltAccel !== 0 && Math.sign(b.vx) === Math.sign(tiltAccel) ? PHYS.maxSlideSpeed : PHYS.maxRunSpeed;
  b.vx = Math.max(-cap, Math.min(cap, b.vx));

  // Jump: buffered presses and a little coyote time, so it feels fair on a phone.
  b.coyote = b.grounded ? PHYS.coyoteS : Math.max(0, b.coyote - dt);
  b.jumpBuffer = Math.max(0, b.jumpBuffer - dt);
  if (b.jumpBuffer > 0 && b.coyote > 0) {
    b.vy = -PHYS.jumpVelocity;
    b.jumpBuffer = 0;
    b.coyote = 0;
    b.grounded = false;
    events.push("jumped");
  }

  b.vy = Math.min(PHYS.maxFall, b.vy + PHYS.gravity * dt);

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

  if (b.y > WORLD.height + 40 || arena.hazards.some((h) => overlaps(b.x, b.y, h))) {
    b.deadFor = PHYS.respawnS;
    b.vx = b.vy = 0;
    events.push("died");
  } else if (overlaps(b.x, b.y, arena.exit)) {
    b.escaped = true;
    events.push("escaped");
  }
  return events;
}

/** The sideways pull for a tilt of -1..1 at a maximum angle in degrees. */
export function tiltAccel(tilt: number, maxDegrees: number): number {
  return PHYS.gravity * Math.sin((tilt * maxDegrees * Math.PI) / 180);
}
