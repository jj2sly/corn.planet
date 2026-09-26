// CPI rigid bodies: a small, deterministic 2D physics engine for server-authoritative games.
// Rotating boxes and circles, static and dynamic; contacts solved with sequential impulses
// (accumulated, clamped and warm-started, so stacks stand), islands that fall asleep when they
// settle, wind, water (buoyancy and drag) and per-contact impact speeds a game can turn into damage.
//
//   const world = createWorld({ gravity: 800 });
//   const crate = world.add({ x: 400, y: 300, shape: { kind: "box", hw: 20, hh: 20 }, density: 1 });
//   world.step(1 / 120);                 // fixed steps; same inputs → same result, every time
//   world.onImpact = (a, b, speed, mass) => …   // hard hits, once per contact point per step
//   world.settled()                      // everything dynamic asleep (or gone)
//
// Units are the game's world units (y down). Nothing here knows about any one game: bodies carry a
// `tag` and a `data` slot for the game's own bookkeeping.

export type Shape = { kind: "box"; hw: number; hh: number } | { kind: "circle"; r: number };

export interface BodyDef {
  x: number;
  y: number;
  angle?: number;
  shape: Shape;
  /** Mass per 1000 square units. 0 or `fixed` makes a static body. */
  density?: number;
  fixed?: boolean;
  friction?: number;
  restitution?: number;
  vx?: number;
  vy?: number;
  w?: number;
  gravityScale?: number;
  /** How much the wind pushes it (0 = not at all). */
  windScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  tag?: string;
  data?: unknown;
  /** Starts asleep (a structure that was already standing). */
  asleep?: boolean;
}

export interface Body {
  readonly id: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  w: number;
  shape: Shape;
  mass: number;
  invMass: number;
  invI: number;
  density: number;
  friction: number;
  restitution: number;
  gravityScale: number;
  windScale: number;
  linearDamping: number;
  angularDamping: number;
  fixed: boolean;
  asleep: boolean;
  sleepTime: number;
  removed: boolean;
  /** Forces for the next step only (cleared after it). */
  fx: number;
  fy: number;
  tag: string;
  data: unknown;
}

export interface WorldOptions {
  gravity?: number;
  iterations?: number;
  /** Penetration allowed before position correction pushes back. */
  slop?: number;
  /** Fraction of penetration corrected per step. */
  bias?: number;
  /** Relative speeds below this don't bounce. */
  bounceThreshold?: number;
  sleepSpeed?: number;
  sleepAngular?: number;
  sleepSeconds?: number;
  /** Anything that falls past these is removed (and reported). */
  bounds?: { left: number; right: number; bottom: number };
}

interface ContactPoint {
  key: number;
  x: number;
  y: number;
  sep: number;
  rAx: number;
  rAy: number;
  rBx: number;
  rBy: number;
  massN: number;
  massT: number;
  bias: number;
  bounce: number;
  pn: number;
  pt: number;
  /** Approach speed along the normal when the step began (positive: closing). */
  closing: number;
}

interface Arbiter {
  a: Body;
  b: Body;
  nx: number;
  ny: number;
  points: ContactPoint[];
  friction: number;
  restitution: number;
  seen: number;
}

interface Manifold {
  nx: number;
  ny: number;
  points: { x: number; y: number; sep: number; key: number }[];
}

// ------------------------------------------------------------------ geometry

function vertices(b: Body): { vx: number[]; vy: number[]; nx: number[]; ny: number[] } {
  const { hw, hh } = b.shape as { hw: number; hh: number };
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const lx = [-hw, hw, hw, -hw];
  const ly = [-hh, -hh, hh, hh];
  const vx: number[] = [];
  const vy: number[] = [];
  for (let i = 0; i < 4; i++) {
    vx.push(b.x + lx[i]! * c - ly[i]! * s);
    vy.push(b.y + lx[i]! * s + ly[i]! * c);
  }
  // Outward face normals: top (edge 0→1) is -y locally, then right, bottom, left.
  const lnx = [0, 1, 0, -1];
  const lny = [-1, 0, 1, 0];
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < 4; i++) {
    nx.push(lnx[i]! * c - lny[i]! * s);
    ny.push(lnx[i]! * s + lny[i]! * c);
  }
  return { vx, vy, nx, ny };
}

type Poly = ReturnType<typeof vertices>;

/** The face of `p` with the largest separation from `q`'s vertices. */
function maxSeparation(p: Poly, q: Poly): { edge: number; sep: number } {
  let best = -Infinity;
  let edge = 0;
  for (let i = 0; i < 4; i++) {
    const n1 = p.nx[i]!;
    const n2 = p.ny[i]!;
    let min = Infinity;
    for (let j = 0; j < 4; j++) {
      const d = (q.vx[j]! - p.vx[i]!) * n1 + (q.vy[j]! - p.vy[i]!) * n2;
      if (d < min) min = d;
    }
    if (min > best) {
      best = min;
      edge = i;
    }
  }
  return { edge, sep: best };
}

function collideBoxes(A: Body, B: Body): Manifold | null {
  const pa = vertices(A);
  const pb = vertices(B);
  const sa = maxSeparation(pa, pb);
  if (sa.sep > 0) return null;
  const sb = maxSeparation(pb, pa);
  if (sb.sep > 0) return null;
  // Prefer A as the reference unless B is clearly better: keeps contacts from flickering.
  const flip = sb.sep > sa.sep * 0.95 + 0.01;
  const ref = flip ? pb : pa;
  const inc = flip ? pa : pb;
  const edge = flip ? sb.edge : sa.edge;
  const nx = ref.nx[edge]!;
  const ny = ref.ny[edge]!;
  // Incident edge: the one facing most against the reference normal.
  let incEdge = 0;
  let minDot = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = inc.nx[i]! * nx + inc.ny[i]! * ny;
    if (d < minDot) {
      minDot = d;
      incEdge = i;
    }
  }
  const i1 = incEdge;
  const i2 = (incEdge + 1) % 4;
  let cx = [inc.vx[i1]!, inc.vx[i2]!];
  let cy = [inc.vy[i1]!, inc.vy[i2]!];
  let ck = [i1, i2];
  const r1 = edge;
  const r2 = (edge + 1) % 4;
  const v1x = ref.vx[r1]!;
  const v1y = ref.vy[r1]!;
  const v2x = ref.vx[r2]!;
  const v2y = ref.vy[r2]!;
  let tx = v2x - v1x;
  let ty = v2y - v1y;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len;
  ty /= len;
  // Clip the incident edge to the reference edge's extent.
  const clip = (ox: number, oy: number, offset: number, side: number): boolean => {
    const d0 = ox * cx[0]! + oy * cy[0]! - offset;
    const d1 = ox * cx[1]! + oy * cy[1]! - offset;
    const nxs: number[] = [];
    const nys: number[] = [];
    const nks: number[] = [];
    if (d0 <= 0) {
      nxs.push(cx[0]!);
      nys.push(cy[0]!);
      nks.push(ck[0]!);
    }
    if (d1 <= 0) {
      nxs.push(cx[1]!);
      nys.push(cy[1]!);
      nks.push(ck[1]!);
    }
    if (d0 * d1 < 0) {
      const t = d0 / (d0 - d1);
      nxs.push(cx[0]! + t * (cx[1]! - cx[0]!));
      nys.push(cy[0]! + t * (cy[1]! - cy[0]!));
      nks.push(4 + side);
    }
    if (nxs.length < 2) return false;
    cx = nxs;
    cy = nys;
    ck = nks;
    return true;
  };
  if (!clip(-tx, -ty, -(tx * v1x + ty * v1y), 0)) return null;
  if (!clip(tx, ty, tx * v2x + ty * v2y, 1)) return null;
  const front = nx * v1x + ny * v1y;
  const points: Manifold["points"] = [];
  for (let i = 0; i < cx.length; i++) {
    const sep = nx * cx[i]! + ny * cy[i]! - front;
    if (sep <= 0.5) points.push({ x: cx[i]!, y: cy[i]!, sep, key: (flip ? 100 : 0) + edge * 10 + ck[i]! });
  }
  if (!points.length) return null;
  return flip ? { nx: -nx, ny: -ny, points } : { nx, ny, points };
}

function collideBoxCircle(A: Body, B: Body): Manifold | null {
  // A is the box, B the circle; the normal points from A to B.
  const { hw, hh } = A.shape as { hw: number; hh: number };
  const r = (B.shape as { r: number }).r;
  const c = Math.cos(A.angle);
  const s = Math.sin(A.angle);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const qx = Math.max(-hw, Math.min(hw, lx));
  const qy = Math.max(-hh, Math.min(hh, ly));
  let nlx: number;
  let nly: number;
  let sep: number;
  let px: number;
  let py: number;
  if (qx === lx && qy === ly) {
    // Centre inside the box: out through the nearest face.
    const ex = hw - Math.abs(lx);
    const ey = hh - Math.abs(ly);
    if (ex < ey) {
      nlx = Math.sign(lx) || 1;
      nly = 0;
      sep = -ex - r;
      px = nlx * hw;
      py = ly;
    } else {
      nlx = 0;
      nly = Math.sign(ly) || 1;
      sep = -ey - r;
      px = lx;
      py = nly * hh;
    }
  } else {
    const ox = lx - qx;
    const oy = ly - qy;
    const d = Math.hypot(ox, oy);
    if (d > r) return null;
    nlx = ox / (d || 1);
    nly = oy / (d || 1);
    sep = d - r;
    px = qx;
    py = qy;
  }
  const nx = nlx * c - nly * s;
  const ny = nlx * s + nly * c;
  return { nx, ny, points: [{ x: A.x + px * c - py * s, y: A.y + px * s + py * c, sep, key: 0 }] };
}

function collideCircles(A: Body, B: Body): Manifold | null {
  const ra = (A.shape as { r: number }).r;
  const rb = (B.shape as { r: number }).r;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const d = Math.hypot(dx, dy);
  if (d > ra + rb) return null;
  const nx = d > 1e-9 ? dx / d : 0;
  const ny = d > 1e-9 ? dy / d : 1;
  return { nx, ny, points: [{ x: A.x + nx * ra, y: A.y + ny * ra, sep: d - ra - rb, key: 0 }] };
}

function collide(A: Body, B: Body): Manifold | null {
  const a = A.shape.kind;
  const b = B.shape.kind;
  if (a === "box" && b === "box") return collideBoxes(A, B);
  if (a === "box" && b === "circle") return collideBoxCircle(A, B);
  if (a === "circle" && b === "box") {
    const m = collideBoxCircle(B, A);
    return m && { nx: -m.nx, ny: -m.ny, points: m.points };
  }
  return collideCircles(A, B);
}

/** Axis-aligned bounds, for the broad phase. */
export function bounds(b: Body): [number, number, number, number] {
  if (b.shape.kind === "circle") return [b.x - b.shape.r, b.y - b.shape.r, b.x + b.shape.r, b.y + b.shape.r];
  const c = Math.abs(Math.cos(b.angle));
  const s = Math.abs(Math.sin(b.angle));
  const ex = b.shape.hw * c + b.shape.hh * s;
  const ey = b.shape.hw * s + b.shape.hh * c;
  return [b.x - ex, b.y - ey, b.x + ex, b.y + ey];
}

export function area(shape: Shape): number {
  return shape.kind === "box" ? shape.hw * shape.hh * 4 : Math.PI * shape.r * shape.r;
}

// ------------------------------------------------------------------ the world

export interface World {
  readonly bodies: Body[];
  gravity: number;
  /** Sideways acceleration on bodies with a windScale. */
  wind: number;
  /** Water surface (y), or null for none. */
  waterLevel: number | null;
  time: number;
  add(def: BodyDef): Body;
  remove(body: Body): void;
  get(id: number): Body | undefined;
  wake(body: Body): void;
  step(dt: number): void;
  /** Every dynamic body asleep. */
  settled(): boolean;
  /** Bodies touching this one right now. */
  touching(body: Body): Body[];
  /** A pair to skip this step (return false): e.g. a drill passing through. */
  filter: ((a: Body, b: Body) => boolean) | null;
  /** A hard hit: `speed` is the closing speed, `mass` the pair's effective mass. */
  onImpact: ((a: Body, b: Body, speed: number, mass: number) => void) | null;
  /** A body left the world through its bounds. */
  onLost: ((b: Body) => void) | null;
  /** Radial push: every dynamic body within `radius` gets up to `strength` velocity away from (x, y). */
  blast(x: number, y: number, radius: number, strength: number): Body[];
}

export function createWorld(options: WorldOptions = {}): World {
  const opts = {
    gravity: options.gravity ?? 800,
    iterations: options.iterations ?? 10,
    slop: options.slop ?? 0.4,
    bias: options.bias ?? 0.2,
    bounceThreshold: options.bounceThreshold ?? 70,
    sleepSpeed: options.sleepSpeed ?? 7,
    sleepAngular: options.sleepAngular ?? 0.09,
    sleepSeconds: options.sleepSeconds ?? 0.45,
    bounds: options.bounds ?? { left: -400, right: 4000, bottom: 1400 },
  };
  const bodies: Body[] = [];
  const byId = new Map<number, Body>();
  let arbiters = new Map<string, Arbiter>();
  let nextId = 1;
  let stepSeq = 0;

  const world: World = {
    bodies,
    gravity: opts.gravity,
    wind: 0,
    waterLevel: null,
    time: 0,
    filter: null,
    onImpact: null,
    onLost: null,
    add(def) {
      const fixed = def.fixed === true || !def.density;
      const density = def.density ?? 0;
      const mass = fixed ? 0 : (density * area(def.shape)) / 1000;
      const inertia = fixed ? 0 : def.shape.kind === "box" ? (mass * ((2 * def.shape.hw) ** 2 + (2 * def.shape.hh) ** 2)) / 12 : (mass * def.shape.r * def.shape.r) / 2;
      const body: Body = {
        id: nextId++,
        x: def.x,
        y: def.y,
        angle: def.angle ?? 0,
        vx: def.vx ?? 0,
        vy: def.vy ?? 0,
        w: def.w ?? 0,
        shape: def.shape,
        mass,
        invMass: fixed ? 0 : 1 / mass,
        invI: fixed ? 0 : 1 / inertia,
        density,
        friction: def.friction ?? 0.6,
        restitution: def.restitution ?? 0.1,
        gravityScale: def.gravityScale ?? 1,
        windScale: def.windScale ?? 0,
        linearDamping: def.linearDamping ?? 0.02,
        angularDamping: def.angularDamping ?? (def.shape.kind === "circle" ? 1.2 : 0.05),
        fixed,
        asleep: fixed || def.asleep === true,
        sleepTime: 0,
        removed: false,
        fx: 0,
        fy: 0,
        tag: def.tag ?? "",
        data: def.data ?? null,
      };
      bodies.push(body);
      byId.set(body.id, body);
      return body;
    },
    remove(body) {
      if (body.removed) return;
      body.removed = true;
      byId.delete(body.id);
      const i = bodies.indexOf(body);
      if (i >= 0) bodies.splice(i, 1);
      // Whatever it was holding up has to notice it's gone.
      for (const arb of arbiters.values()) {
        if (arb.a === body) world.wake(arb.b);
        if (arb.b === body) world.wake(arb.a);
      }
      for (const [k, arb] of arbiters) if (arb.a === body || arb.b === body) arbiters.delete(k);
    },
    get: (id) => byId.get(id),
    wake(body) {
      if (body.fixed || !body.asleep) return;
      body.asleep = false;
      body.sleepTime = 0;
    },
    settled: () => bodies.every((b) => b.fixed || b.asleep),
    touching(body) {
      const out: Body[] = [];
      for (const arb of arbiters.values()) {
        if (arb.seen !== stepSeq) continue;
        if (arb.a === body) out.push(arb.b);
        else if (arb.b === body) out.push(arb.a);
      }
      return out;
    },
    blast(x, y, radius, strength) {
      const hit: Body[] = [];
      for (const b of bodies) {
        if (b.fixed) continue;
        const dx = b.x - x;
        const dy = b.y - y;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const k = strength * (1 - d / radius);
        const ux = d > 1e-6 ? dx / d : 0;
        const uy = d > 1e-6 ? dy / d : -1;
        b.vx += ux * k;
        b.vy += uy * k;
        b.w += ((ux >= 0 ? 1 : -1) * k) / 200;
        world.wake(b);
        hit.push(b);
      }
      return hit;
    },
    step(dt) {
      stepSeq += 1;
      world.time += dt;
      const gravity = world.gravity;
      const water = world.waterLevel;

      // Forces: gravity, wind, water, damping.
      for (const b of bodies) {
        if (b.fixed || b.asleep) continue;
        let ax = b.fx * b.invMass + world.wind * b.windScale;
        let ay = b.fy * b.invMass + gravity * b.gravityScale;
        let damp = b.linearDamping;
        if (water !== null) {
          const [, top, , bottom] = bounds(b);
          const under = bottom <= water ? 0 : top >= water ? 1 : (bottom - water) / (bottom - top);
          if (under > 0) {
            // Buoyancy (water is density 1) and drag.
            ay -= gravity * under * Math.min(3, 1 / Math.max(0.05, b.density));
            damp += 2.4 * under;
            b.w *= 1 - Math.min(1, 2 * under * dt);
          }
        }
        b.vx += ax * dt;
        b.vy += ay * dt;
        const k = Math.max(0, 1 - damp * dt);
        b.vx *= k;
        b.vy *= k;
        b.w *= Math.max(0, 1 - b.angularDamping * dt);
        b.fx = 0;
        b.fy = 0;
      }

      // Broad phase: sweep along x.
      const boxes = bodies.map((b) => ({ b, box: bounds(b) }));
      boxes.sort((p, q) => p.box[0] - q.box[0] || p.b.id - q.b.id);
      const next = new Map<string, Arbiter>();
      for (let i = 0; i < boxes.length; i++) {
        const { b: A, box: ba } = boxes[i]!;
        for (let j = i + 1; j < boxes.length; j++) {
          const { b: B, box: bb } = boxes[j]!;
          if (bb[0] > ba[2]) break;
          if (bb[1] > ba[3] || bb[3] < ba[1]) continue;
          if ((A.fixed || A.asleep) && (B.fixed || B.asleep)) {
            // Nothing moving: keep what they had, so waking up doesn't lose the warm start.
            const key = A.id < B.id ? `${A.id}:${B.id}` : `${B.id}:${A.id}`;
            const old = arbiters.get(key);
            if (old) next.set(key, old);
            continue;
          }
          const [a, b] = A.id < B.id ? [A, B] : [B, A];
          if (world.filter && !world.filter(a, b)) continue;
          const m = collide(a, b);
          if (!m) continue;
          const key = `${a.id}:${b.id}`;
          const old = arbiters.get(key);
          const arb: Arbiter = { a, b, nx: m.nx, ny: m.ny, points: [], friction: Math.sqrt(a.friction * b.friction), restitution: Math.max(a.restitution, b.restitution), seen: stepSeq };
          for (const p of m.points) {
            // Same feature as last step, or failing that (a corner clipped one step, not the next)
            // the old point right next to it: either way the warm start carries over.
            const prior = old?.points.find((q) => q.key === p.key) ?? old?.points.find((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < 1.5);
            arb.points.push({ key: p.key, x: p.x, y: p.y, sep: p.sep, rAx: 0, rAy: 0, rBx: 0, rBy: 0, massN: 0, massT: 0, bias: 0, bounce: 0, pn: prior?.pn ?? 0, pt: prior?.pt ?? 0, closing: 0 });
          }
          // A moving body wakes what it touches.
          if (a.asleep && !b.asleep && !b.fixed) world.wake(a);
          if (b.asleep && !a.asleep && !a.fixed) world.wake(b);
          next.set(key, arb);
        }
      }
      arbiters = next;
      // A stable order (by the pair's ids), whatever the broad phase found first: the solver converges
      // the same way every step instead of wobbling with the sort.
      const live = [...arbiters.values()]
        .filter((arb) => arb.seen === stepSeq && !((arb.a.fixed || arb.a.asleep) && (arb.b.fixed || arb.b.asleep)))
        .sort((p, q) => p.a.id - q.a.id || p.b.id - q.b.id);

      // Pre-step: masses, biases, impacts, warm start.
      const inv = 1 / dt;
      for (const arb of live) {
        const { a, b, nx, ny } = arb;
        const tx = -ny;
        const ty = nx;
        const ima = a.asleep ? 0 : a.invMass;
        const imb = b.asleep ? 0 : b.invMass;
        const iia = a.asleep ? 0 : a.invI;
        const iib = b.asleep ? 0 : b.invI;
        for (const c of arb.points) {
          c.rAx = c.x - a.x;
          c.rAy = c.y - a.y;
          c.rBx = c.x - b.x;
          c.rBy = c.y - b.y;
          const rnA = c.rAx * ny - c.rAy * nx;
          const rnB = c.rBx * ny - c.rBy * nx;
          c.massN = 1 / (ima + imb + iia * rnA * rnA + iib * rnB * rnB);
          const rtA = c.rAx * ty - c.rAy * tx;
          const rtB = c.rBx * ty - c.rBy * tx;
          c.massT = 1 / (ima + imb + iia * rtA * rtA + iib * rtB * rtB);
          // Closing speed as the step began: before any warm start, or a resting stack would see the
          // pushes of its neighbours as impacts and bounce itself apart.
          const dvx = b.vx - b.w * c.rBy - a.vx + a.w * c.rAy;
          const dvy = b.vy + b.w * c.rBx - a.vy - a.w * c.rAx;
          const vn = dvx * nx + dvy * ny;
          // A point still apart (a speculative contact) may close its gap this step, no more; one that
          // touches is pushed back out a little at a time.
          c.bias = c.sep > 0 ? -c.sep * inv : -opts.bias * inv * Math.min(0, c.sep + opts.slop);
          const touches = c.sep <= 0 || -vn * dt > c.sep;
          c.closing = touches ? -vn : 0;
          c.bounce = touches && vn < -opts.bounceThreshold ? -arb.restitution * vn : -Infinity;
        }
      }
      for (const arb of live) {
        const { a, b, nx, ny } = arb;
        const tx = -ny;
        const ty = nx;
        const ima = a.asleep ? 0 : a.invMass;
        const imb = b.asleep ? 0 : b.invMass;
        const iia = a.asleep ? 0 : a.invI;
        const iib = b.asleep ? 0 : b.invI;
        for (const c of arb.points) {
          const px = c.pn * nx + c.pt * tx;
          const py = c.pn * ny + c.pt * ty;
          a.vx -= px * ima;
          a.vy -= py * ima;
          a.w -= iia * (c.rAx * py - c.rAy * px);
          b.vx += px * imb;
          b.vy += py * imb;
          b.w += iib * (c.rBx * py - c.rBy * px);
        }
      }
      if (world.onImpact) {
        for (const arb of live) {
          let best = 0;
          for (const c of arb.points) best = Math.max(best, c.closing);
          if (best <= 0) continue;
          const ma = arb.a.fixed ? Infinity : arb.a.mass;
          const mb = arb.b.fixed ? Infinity : arb.b.mass;
          const mass = ma === Infinity ? mb : mb === Infinity ? ma : (ma * mb) / (ma + mb);
          world.onImpact(arb.a, arb.b, best, mass);
        }
      }

      // Iterate.
      for (let it = 0; it < opts.iterations; it++) {
        for (const arb of live) {
          const { a, b, nx, ny } = arb;
          const tx = -ny;
          const ty = nx;
          const ima = a.asleep ? 0 : a.invMass;
          const imb = b.asleep ? 0 : b.invMass;
          const iia = a.asleep ? 0 : a.invI;
          const iib = b.asleep ? 0 : b.invI;
          for (const c of arb.points) {
            let dvx = b.vx - b.w * c.rBy - a.vx + a.w * c.rAy;
            let dvy = b.vy + b.w * c.rBx - a.vy - a.w * c.rAx;
            const vn = dvx * nx + dvy * ny;
            let dpn = c.massN * (-vn + Math.max(c.bias, c.bounce));
            const pn0 = c.pn;
            c.pn = Math.max(pn0 + dpn, 0);
            dpn = c.pn - pn0;
            let px = dpn * nx;
            let py = dpn * ny;
            a.vx -= px * ima;
            a.vy -= py * ima;
            a.w -= iia * (c.rAx * py - c.rAy * px);
            b.vx += px * imb;
            b.vy += py * imb;
            b.w += iib * (c.rBx * py - c.rBy * px);

            dvx = b.vx - b.w * c.rBy - a.vx + a.w * c.rAy;
            dvy = b.vy + b.w * c.rBx - a.vy - a.w * c.rAx;
            const vt = dvx * tx + dvy * ty;
            let dpt = c.massT * -vt;
            const maxPt = arb.friction * c.pn;
            const pt0 = c.pt;
            c.pt = Math.max(-maxPt, Math.min(maxPt, pt0 + dpt));
            dpt = c.pt - pt0;
            px = dpt * tx;
            py = dpt * ty;
            a.vx -= px * ima;
            a.vy -= py * ima;
            a.w -= iia * (c.rAx * py - c.rAy * px);
            b.vx += px * imb;
            b.vy += py * imb;
            b.w += iib * (c.rBx * py - c.rBy * px);
          }
        }
      }

      // Rolling resistance: a ball on something slows its spin (and, through friction, its roll)
      // instead of creeping along a hair's-width slope forever.
      for (const arb of live) {
        let pushed = false;
        for (const c of arb.points) if (c.pn > 0) pushed = true;
        if (!pushed) continue;
        for (const body of [arb.a, arb.b]) {
          if (body.shape.kind !== "circle" || body.fixed || body.asleep) continue;
          body.w *= Math.max(0, 1 - 2.5 * dt);
          const stop = 3 * dt;
          body.w = Math.abs(body.w) <= stop ? 0 : body.w - Math.sign(body.w) * stop;
        }
      }

      // Integrate positions; lose what fell out of the world.
      const lost: Body[] = [];
      for (const b of bodies) {
        if (b.fixed || b.asleep) continue;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.angle += b.w * dt;
        if (b.y > opts.bounds.bottom || b.x < opts.bounds.left || b.x > opts.bounds.right) lost.push(b);
      }
      for (const b of lost) {
        world.remove(b);
        world.onLost?.(b);
      }

      // Sleep: islands of touching bodies that have all been still long enough.
      const parent = new Map<number, number>();
      const find = (id: number): number => {
        let r = id;
        while (parent.get(r) !== r) r = parent.get(r)!;
        let n = id;
        while (n !== r) {
          const p = parent.get(n)!;
          parent.set(n, r);
          n = p;
        }
        return r;
      };
      for (const b of bodies) {
        if (b.fixed || b.asleep) continue;
        parent.set(b.id, b.id);
        const still = b.vx * b.vx + b.vy * b.vy < opts.sleepSpeed ** 2 && Math.abs(b.w) < opts.sleepAngular;
        b.sleepTime = still ? b.sleepTime + dt : 0;
      }
      for (const arb of live) {
        if (arb.a.fixed || arb.b.fixed || arb.a.asleep || arb.b.asleep) continue;
        const ra = find(arb.a.id);
        const rb = find(arb.b.id);
        if (ra !== rb) parent.set(ra, rb);
      }
      const islandMin = new Map<number, number>();
      for (const id of parent.keys()) {
        const r = find(id);
        islandMin.set(r, Math.min(islandMin.get(r) ?? Infinity, byId.get(id)!.sleepTime));
      }
      for (const b of bodies) {
        if (b.fixed || b.asleep) continue;
        if ((islandMin.get(find(b.id)) ?? 0) >= opts.sleepSeconds) {
          b.asleep = true;
          b.vx = b.vy = b.w = 0;
        }
      }
    },
  };
  return world;
}

/** Wakes every body in `world` within `radius` of a point (after something there changes). */
export function wakeAround(world: World, x: number, y: number, radius: number): void {
  for (const b of world.bodies) {
    if (b.fixed) continue;
    const [l, t, r, bt] = bounds(b);
    if (x + radius > l && x - radius < r && y + radius > t && y - radius < bt) world.wake(b);
  }
}
