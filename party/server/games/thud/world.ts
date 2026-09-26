// Angry Thud's Revenge: the physical world. Everything that exists (terrain, the piggies' blocks,
// piggies, the team's buildings, birds in flight, cob bombs) is a body in one rigid-body world
// (kit/rigid.ts) that lasts the whole game and is only stepped while something moves: a shot, the
// piggies' bombs, a tornado. Damage comes from real impacts; this file turns hits into health lost,
// breaks, kills and effects, and reports each outcome (with who caused it) to the game.

import { BIRDS, birdType, type BirdType } from "../../../public/js/games/thud-birds.js";
import { blockHealth, crackStage, impactDamage } from "../kit/destructible.ts";
import { area, bounds, createWorld, wakeAround, type Body, type World } from "../kit/rigid.ts";
import { ATTACK, BARREL, BUILDINGS, DAMAGE, MATERIALS, PIG_DAMAGE, PIGS, SHIELD, SLINGSHOT, WORLD, type BuildingKind, type MaterialId, type PigKind } from "./config.ts";
import type { Level } from "./levels.ts";

export type Cause = { kind: "shot"; playerId: string; shotId: number } | { kind: "pigs" } | { kind: "weather"; type: string } | { kind: "none" };

export interface BuildingState {
  type: BuildingKind;
  tier: number;
  /** Turns it still does nothing (lightning). */
  disabled: number;
  /** Shield dome charge left this turn. */
  charge: number;
  /** Nests: progress toward the next bird (1 = a bird). */
  progress: number;
  /** Nests: who's breeding here this build phase. */
  breeders: string[];
  breeds: number;
  waterlogged: boolean;
  /** Weather machines: broken (hp gone but kept standing as a wreck to repair). */
  broken: boolean;
  builtBy: string;
}

export interface FlyingBird {
  shotId: number;
  playerId: string;
  type: BirdType;
  skin: string;
  primary: boolean;
  uses: number;
  fuel: number;
  steer: number;
  burnUntil: number;
  damageMult: number;
  bounces: number;
  pierce: number;
  magnetUntil: number;
  slammed: boolean;
  lastBounceAt: number;
}

export interface Entity {
  kind: "terrain" | "block" | "pig" | "bird" | "building" | "bomb";
  /** Whose side it's on: the piggies' fortress, the team's, or nobody's. */
  team: "pig" | "player" | "none";
  material: MaterialId | null;
  pig: PigKind | null;
  hp: number;
  maxHp: number;
  /** Level blueprint index for the fortress's own blocks (what repairs put back). */
  bp: number;
  reinforced: boolean;
  building: BuildingState | null;
  bird: FlyingBird | null;
  /** Pierced this step (so a drill doesn't count a block twice). */
  gone: boolean;
  /** Last shot that hit this pig (so a hit counts once per shot). */
  hitShot: number;
  /** A reinforcement still under its parachute: drifts down, can't be hurt until it lands. */
  dropping: boolean;
}

export interface Blueprint {
  x: number;
  y: number;
  angle: number;
  w: number;
  h: number;
  m: MaterialId;
}

/** What happened, for the game's books (corruption, kernels, points) and the screens' effects. */
export interface Outcomes {
  broke(e: Entity, cause: Cause, chained: boolean, at: { x: number; y: number }): void;
  killed(kind: PigKind, cause: Cause, chained: boolean, at: { x: number; y: number }): void;
  pigHit(kind: PigKind, cause: Cause): void;
  buildingLost(state: BuildingState, cause: Cause): void;
  /** Damage done to the piggies' structures (feeds the repair budget). */
  structural(amount: number): void;
}

export interface Fx {
  id: number;
  t: string;
  x: number;
  y: number;
  a?: string | number;
}

export interface ShotRecord {
  id: number;
  playerId: string;
  bird: string;
  power: number;
  angle: number;
  path: number;
  maxX: number;
  apex: number;
  bounces: number;
  reversals: number;
  abilityUsed: boolean;
  abilityHit: boolean;
  kills: number;
  broke: number;
  damage: number;
  flightMs: number;
  /** Distance from the sling to the first kill (long shots). */
  firstKillDistance: number;
}

const SUBSTEP = 1 / 120;
/** What piggy repairs put back. */
const REBUILDS = new Set<MaterialId>(["wood", "glass", "stone", "metal", "ice", "corn"]);
const W = (b: Body) => b.data as Entity;

function entity(kind: Entity["kind"], team: Entity["team"], extra: Partial<Entity> = {}): Entity {
  return { kind, team, material: null, pig: null, hp: 1, maxHp: 1, bp: -1, reinforced: false, building: null, bird: null, gone: false, hitShot: -1, dropping: false, ...extra };
}

export function buildingHeight(type: BuildingKind, tier: number, tiers: readonly { h: number }[]): number {
  return type === "weather" ? (tiers[Math.max(0, tier - 1)]?.h ?? BUILDINGS.weather.h) : BUILDINGS[type].h;
}

export class ThudWorld {
  readonly world: World;
  readonly level: Level;
  readonly blueprint: Blueprint[] = [];
  private readonly out: Outcomes;
  private readonly random: () => number;
  private readonly weatherTiers: readonly { h: number }[];
  cause: Cause = { kind: "none" };
  /** A running shot's record, for awards. */
  shot: ShotRecord | null = null;
  private shotSeq = 0;
  private shotStart = 0;
  private lastVxSign = 0;
  private lastSample: [number, number] | null = null;
  private pending: { body: Body; cause: Cause; chained: boolean }[] = [];
  private booms: { x: number; y: number; radius: number; push: number; damage: number; cause: Cause; chained: boolean; kind: string }[] = [];
  private fxList: Fx[] = [];
  private fxSeq = 0;
  /** Physics-driven weather, while it lasts. */
  private vortex: { x: number; radius: number; lift: number; until: number } | null = null;
  private quake: { until: number; shove: number } | null = null;
  private magnet: { body: Body; until: number; radius: number; pull: number } | null = null;
  private frictionScale = 1;
  /** Bumped whenever a body is added or removed (screens redraw their shapes). */
  version = 0;

  constructor(level: Level, out: Outcomes, random: () => number, weatherTiers: readonly { h: number }[]) {
    this.level = level;
    this.out = out;
    this.random = random;
    this.weatherTiers = weatherTiers;
    this.world = createWorld({ gravity: WORLD.gravity, bounds: { left: -300, right: WORLD.width + 300, bottom: WORLD.height + 300 } });
    for (const [x, y, w, h] of level.terrain) this.world.add({ x: x + w / 2, y: y + h / 2, shape: { kind: "box", hw: w / 2, hh: h / 2 }, fixed: true, friction: 0.85, data: entity("terrain", "none") });
    level.blocks.forEach((b, i) => this.addBlock(b.x, b.y, 0, b.w, b.h, b.m, i, false));
    for (const p of level.pigs) this.addPig(p.kind, p.x, p.y, false);
    // Let everything find its feet once, quietly, then remember where it stands: that's what
    // the piggies rebuild to.
    for (let i = 0; i < 360 && !this.world.settled(); i++) this.world.step(SUBSTEP);
    for (const b of this.world.bodies) {
      if (b.fixed) continue;
      b.asleep = true;
      b.vx = b.vy = b.w = 0;
    }
    const byBp = new Map(this.world.bodies.filter((b) => W(b).bp >= 0).map((b) => [W(b).bp, b]));
    level.blocks.forEach((spec, i) => {
      const b = byBp.get(i);
      this.blueprint.push({ x: b?.x ?? spec.x, y: b?.y ?? spec.y, angle: b?.angle ?? 0, w: spec.w, h: spec.h, m: spec.m });
    });
    this.world.onImpact = (a, b, speed, mass) => this.impact(a, b, speed, mass);
    this.world.onLost = (b) => this.lost(b);
    this.world.filter = (a, b) => this.pierce(a, b);
  }

  // ---------------------------------------------------------------- building the world

  private addBlock(x: number, y: number, angle: number, w: number, h: number, m: MaterialId, bp: number, asleep: boolean, team: Entity["team"] = "pig"): Body {
    const mat = MATERIALS[m];
    const hp = blockHealth(mat, w * h);
    this.version += 1;
    return this.world.add({
      x,
      y,
      angle,
      shape: { kind: "box", hw: w / 2, hh: h / 2 },
      density: mat.density,
      friction: mat.friction * this.frictionScale,
      restitution: mat.restitution,
      asleep,
      data: entity("block", team, { material: m, hp, maxHp: hp, bp }),
    });
  }

  addPig(kind: PigKind, x: number, y: number, asleep = true, parachute = false): Body {
    const spec = PIGS[kind];
    this.version += 1;
    return this.world.add({
      x,
      y,
      shape: { kind: "circle", r: spec.r },
      density: 0.8,
      friction: 0.7,
      restitution: 0.15,
      asleep,
      gravityScale: parachute ? 0.2 : 1,
      linearDamping: parachute ? 2 : 0.02,
      data: entity("pig", "pig", { pig: kind, hp: spec.hp, maxHp: spec.hp, dropping: parachute }),
    });
  }

  /** A parachuting piggy has touched down: the chute goes, normal physics resumes. */
  private landed(b: Body): void {
    const e = W(b);
    if (!e.dropping) return;
    e.dropping = false;
    b.gravityScale = 1;
    b.linearDamping = 0.02;
    this.fx("land", b.x, b.y, e.pig ?? "");
  }

  pigs(): Body[] {
    return this.world.bodies.filter((b) => W(b).kind === "pig");
  }

  buildings(): Body[] {
    return this.world.bodies.filter((b) => W(b).kind === "building");
  }

  fortressBlocks(): Body[] {
    return this.world.bodies.filter((b) => W(b).kind === "block" && W(b).team === "pig");
  }

  /** Is there room for a box here (nothing solid overlapping it)? */
  clear(x: number, y: number, w: number, h: number, pad = 1): boolean {
    const [l, t, r, btm] = [x - w / 2 + pad, y - h / 2 + pad, x + w / 2 - pad, y + h / 2 - pad];
    return !this.world.bodies.some((b) => {
      const [bl, bt, br, bb] = bounds(b);
      return bl < r && br > l && bt < btm && bb > t;
    });
  }

  placeBuilding(type: BuildingKind, x: number, builtBy: string, tier = 1): Body {
    const def = BUILDINGS[type];
    const h = buildingHeight(type, tier, this.weatherTiers);
    const mat = MATERIALS[def.material];
    this.version += 1;
    const state: BuildingState = { type, tier, disabled: 0, charge: type === "shield" ? SHIELD.chargePerTurn : 0, progress: 0, breeders: [], breeds: 0, waterlogged: false, broken: false, builtBy };
    const hp = type === "weather" ? def.hp : def.hp;
    const body = this.world.add({
      x,
      y: WORLD.groundY - h / 2,
      shape: { kind: "box", hw: def.w / 2, hh: h / 2 },
      density: mat.density * 1.4,
      friction: 0.9,
      restitution: 0.05,
      asleep: true,
      data: entity("building", "player", { material: def.material, hp, maxHp: hp, building: state }),
    });
    this.fx("build", x, WORLD.groundY - h, type);
    return body;
  }

  /** A weather machine gets a new tier: taller, tougher, same spot. */
  upgradeWeather(body: Body, tier: number, hp: number): Body {
    const e = W(body);
    const state = e.building!;
    this.world.remove(body);
    const next = this.placeBuilding("weather", body.x, state.builtBy, tier);
    const n = W(next);
    n.building = { ...state, tier, broken: false };
    n.hp = n.maxHp = hp;
    return next;
  }

  removeBuilding(body: Body, fx = "poof"): void {
    this.fx(fx, body.x, body.y, W(body).building?.type ?? "");
    this.world.remove(body);
    this.version += 1;
  }

  // ---------------------------------------------------------------- effects for the screens

  fx(t: string, x: number, y: number, a?: string | number): void {
    this.fxList.push({ id: ++this.fxSeq, t, x: Math.round(x), y: Math.round(y), ...(a !== undefined ? { a } : {}) });
    if (this.fxList.length > 60) this.fxList.splice(0, this.fxList.length - 60);
  }

  recentFx(): Fx[] {
    return this.fxList;
  }

  // ---------------------------------------------------------------- damage

  private shieldFactor(pig: Body): number {
    for (const b of this.world.bodies) {
      const e = W(b);
      if (e.kind !== "pig" || e.pig !== "shield" || b === pig) continue;
      if (Math.hypot(b.x - pig.x, b.y - pig.y) < PIGS.shield.shieldRadius) return PIGS.shield.shieldFactor;
    }
    return 1;
  }

  /** Damage to a team building, soaked first by any kernel shield it stands under. */
  private shielded(target: Body, amount: number): number {
    for (const b of this.world.bodies) {
      const s = W(b).building;
      if (!s || s.type !== "shield" || s.disabled > 0 || s.charge <= 0 || b === target) continue;
      if (Math.abs(b.x - target.x) > SHIELD.radius) continue;
      const soak = Math.min(s.charge, amount);
      s.charge -= soak;
      amount -= soak;
      this.fx("shield", b.x, b.y - 40);
      if (amount <= 0) return 0;
    }
    return amount;
  }

  damage(body: Body, amount: number, cause: Cause, chained: boolean): void {
    const e = W(body);
    if (e.gone || body.removed || amount <= 0.5) return;
    if (e.kind === "pig") {
      amount *= PIG_DAMAGE * this.shieldFactor(body);
      if (cause.kind === "shot" && e.hitShot !== cause.shotId) {
        e.hitShot = cause.shotId;
        this.out.pigHit(e.pig!, cause);
        this.fx("hit", body.x, body.y, e.pig!);
      }
    } else if (e.kind === "building") {
      amount = this.shielded(body, amount);
      if (amount <= 0) return;
    } else if (e.kind !== "block") return;
    if (e.building?.broken) return;
    const before = e.hp;
    e.hp -= amount;
    if (e.kind === "block" && e.team === "pig") this.out.structural(Math.min(before, amount));
    if (e.hp > 0) return;
    if (e.building?.type === "weather") {
      // A Weather Machine doesn't vanish: it stands there broken until someone pays to fix it.
      e.hp = 0;
      e.building.broken = true;
      this.fx("broke", body.x, body.y, "weather");
      return;
    }
    this.destroy(body, cause, chained);
  }

  private destroy(body: Body, cause: Cause, chained: boolean): void {
    const e = W(body);
    if (e.gone) return;
    e.gone = true;
    this.pending.push({ body, cause, chained });
  }

  private impact(a: Body, b: Body, speed: number, mass: number): void {
    const ea = W(a);
    const eb = W(b);
    if (ea.kind === "bomb" || eb.kind === "bomb") {
      const bomb = ea.kind === "bomb" ? a : b;
      if (!W(bomb).gone) {
        W(bomb).gone = true;
        this.booms.push({ x: bomb.x, y: bomb.y, radius: ATTACK.radius, push: ATTACK.push, damage: ATTACK.damage, cause: { kind: "pigs" }, chained: false, kind: "bomb" });
        this.pending.push({ body: bomb, cause: { kind: "pigs" }, chained: false });
      }
      return;
    }
    // A reinforcement landing under its chute: a soft touchdown, not a hit.
    if (ea.dropping || eb.dropping) {
      if (ea.dropping) this.landed(a);
      if (eb.dropping) this.landed(b);
      return;
    }
    const birdA = ea.bird;
    const birdB = eb.bird;
    if (birdA && birdB) return;
    const bird = birdA ?? birdB;
    if (bird && speed > 150 && this.world.time - bird.lastBounceAt > 0.12) {
      bird.lastBounceAt = this.world.time;
      bird.bounces += 1;
      if (bird.primary && this.shot) this.shot.bounces += 1;
      if (bird.type.ability.kind === "ricochet" && bird.bounces <= (bird.type.ability.maxBounces ?? 4)) bird.damageMult += bird.type.ability.bounceBonus ?? 0.3;
      this.fx("bounce", bird === birdA ? a.x : b.x, bird === birdA ? a.y : b.y);
    }
    let base = impactDamage(mass, speed, DAMAGE);
    if (base <= 0) return;
    if (bird) base *= bird.burnUntil > this.world.time ? (bird.type.ability.damage ?? 1) : bird.damageMult;
    const cause = this.cause;
    const hit = (target: Body, other: Body) => {
      const t = W(target);
      if (t.kind !== "block" && t.kind !== "pig" && t.kind !== "building") return;
      const byBird = W(other).kind === "bird";
      if (byBird && this.shot) this.shot.damage += base;
      if (byBird && this.shot?.abilityUsed) this.shot.abilityHit = true;
      this.damage(target, base, cause, !byBird && cause.kind === "shot");
    };
    hit(a, b);
    hit(b, a);
    if (speed > 260) this.fx("dust", (a.x + b.x) / 2, (a.y + b.y) / 2, Math.round(speed));
  }

  /** Drills go straight through what they can afford to. */
  private pierce(a: Body, b: Body): boolean {
    const ea = W(a);
    const eb = W(b);
    const drill = ea.bird?.type.ability.kind === "pierce" ? a : eb.bird?.type.ability.kind === "pierce" ? b : null;
    if (!drill) return true;
    const other = drill === a ? b : a;
    const eo = W(other);
    const bird = W(drill).bird!;
    if (eo.gone) return false;
    if (eo.kind !== "block" || eo.hp > bird.pierce) return true;
    // Only when it's actually touching (the broad phase is generous).
    const [dl, dt, dr, db] = bounds(drill);
    const [ol, ot, or, ob] = bounds(other);
    if (dl > or || dr < ol || dt > ob || db < ot) return true;
    bird.pierce -= eo.hp;
    if (this.shot) {
      this.shot.damage += eo.hp;
      this.shot.abilityHit = true;
    }
    if (eo.team === "pig") this.out.structural(eo.hp);
    eo.hp = 0;
    this.destroy(other, this.cause, false);
    drill.vx *= bird.type.ability.slow ?? 0.85;
    drill.vy *= bird.type.ability.slow ?? 0.85;
    this.fx("drill", other.x, other.y, eo.material ?? "");
    return false;
  }

  private lost(b: Body): void {
    const e = W(b);
    if (e.gone) return;
    e.gone = true;
    this.version += 1;
    if (e.kind === "pig") {
      this.out.killed(e.pig!, this.cause, this.cause.kind === "shot", { x: b.x, y: Math.min(b.y, WORLD.height) });
      if (this.shot) this.shot.kills += 1;
      this.fx("splash", b.x, Math.min(b.y, WORLD.groundY), e.pig!);
    } else if (e.kind === "block") {
      if (e.team === "pig") this.out.structural(Math.max(0, e.hp));
      this.out.broke(e, this.cause, this.cause.kind === "shot", { x: b.x, y: Math.min(b.y, WORLD.height) });
      if (this.shot) this.shot.broke += 1;
    } else if (e.kind === "building" && e.building) this.out.buildingLost(e.building, this.cause);
  }

  /** Removes what broke this step and sets off what explodes (which may break more). */
  private settleDestruction(): void {
    for (let guard = 0; guard < 20 && (this.pending.length || this.booms.length); guard++) {
      const pending = this.pending.splice(0);
      for (const { body, cause, chained } of pending) {
        if (body.removed) continue;
        const e = W(body);
        this.world.remove(body);
        this.version += 1;
        if (e.kind === "bomb") continue;
        if (e.kind === "pig") {
          this.fx("pop", body.x, body.y, e.pig!);
          this.out.killed(e.pig!, cause, chained, { x: body.x, y: body.y });
          if (this.shot && cause.kind === "shot") {
            this.shot.kills += 1;
            if (!this.shot.firstKillDistance) this.shot.firstKillDistance = Math.hypot(body.x - SLINGSHOT.x, body.y - SLINGSHOT.y);
          }
        } else if (e.kind === "block") {
          this.fx("break", body.x, body.y, e.material ?? "wood");
          this.out.broke(e, cause, chained, { x: body.x, y: body.y });
          if (this.shot && cause.kind === "shot") this.shot.broke += 1;
          if (e.material === "barrel") this.booms.push({ x: body.x, y: body.y, radius: BARREL.radius, push: BARREL.push, damage: BARREL.damage, cause, chained: true, kind: "barrel" });
        } else if (e.kind === "building" && e.building) {
          this.fx("break", body.x, body.y, "building");
          this.out.buildingLost(e.building, cause);
        }
      }
      const booms = this.booms.splice(0);
      for (const boom of booms) this.explode(boom.x, boom.y, boom.radius, boom.push, boom.damage, boom.cause, boom.chained, boom.kind);
    }
  }

  explode(x: number, y: number, radius: number, push: number, damage: number, cause: Cause, chained: boolean, kind = "pop"): void {
    this.fx("boom", x, y, `${kind}:${radius}`);
    const hit = this.world.blast(x, y, radius, push);
    for (const b of hit) {
      const d = Math.hypot(b.x - x, b.y - y);
      this.damage(b, damage * Math.max(0.2, 1 - d / radius), cause, chained);
    }
  }

  // ---------------------------------------------------------------- birds

  /** Launches a bird from the sling: angle in degrees above the horizon, power 0..1. */
  launch(playerId: string, typeId: string, skin: string, angle: number, power: number): ShotRecord {
    const type = birdType(typeId) ?? BIRDS[0]!;
    const speed = SLINGSHOT.maxSpeed * power;
    const rad = (angle * Math.PI) / 180;
    const id = ++this.shotSeq;
    this.cause = { kind: "shot", playerId, shotId: id };
    this.addBird(playerId, type, skin, id, true, SLINGSHOT.x, SLINGSHOT.y, Math.cos(rad) * speed, -Math.sin(rad) * speed, 1);
    this.shot = { id, playerId, bird: type.id, power, angle, path: 0, maxX: SLINGSHOT.x, apex: SLINGSHOT.y, bounces: 0, reversals: 0, abilityUsed: false, abilityHit: false, kills: 0, broke: 0, damage: 0, flightMs: 0, firstKillDistance: 0 };
    this.shotStart = this.world.time;
    this.lastVxSign = 1;
    this.lastSample = [SLINGSHOT.x, SLINGSHOT.y];
    this.fx("launch", SLINGSHOT.x, SLINGSHOT.y, type.id);
    return this.shot;
  }

  private addBird(playerId: string, type: BirdType, skin: string, shotId: number, primary: boolean, x: number, y: number, vx: number, vy: number, scale: number): Body {
    const r = type.body.r * scale;
    const bird: FlyingBird = {
      shotId,
      playerId,
      type,
      skin,
      primary,
      uses: primary ? (type.ability.uses ?? 1) : 0,
      fuel: type.ability.fuel ?? 0,
      steer: 0,
      burnUntil: 0,
      damageMult: 1,
      bounces: 0,
      pierce: type.ability.kind === "pierce" ? (type.ability.budget ?? 0) : 0,
      magnetUntil: 0,
      slammed: false,
      lastBounceAt: -1,
    };
    this.version += 1;
    return this.world.add({ x, y, vx, vy, shape: { kind: "circle", r }, density: type.body.density, restitution: type.body.restitution, friction: 0.6, windScale: 1, linearDamping: 0.01, data: entity("bird", "none", { bird }) });
  }

  birds(): Body[] {
    return this.world.bodies.filter((b) => W(b).kind === "bird");
  }

  private primary(): Body | null {
    return this.birds().find((b) => W(b).bird!.primary) ?? null;
  }

  /** The shooter taps: whatever their bird does. False if there's nothing to do (used up, gone). */
  ability(): boolean {
    const body = this.primary();
    if (!body) return false;
    const bird = W(body).bird!;
    const ab = bird.type.ability;
    if (ab.trigger !== "tap" || bird.uses <= 0) return false;
    bird.uses -= 1;
    if (this.shot) this.shot.abilityUsed = true;
    const speed = Math.hypot(body.vx, body.vy) || 1;
    this.fx("ability", body.x, body.y, ab.kind);
    switch (ab.kind) {
      case "pop":
        this.explode(body.x, body.y, ab.radius ?? 150, ab.push ?? 800, ab.damage ?? 60, this.cause, false, "pop");
        if (this.shot) this.shot.abilityHit = true;
        this.world.remove(body);
        this.version += 1;
        this.settleDestruction();
        break;
      case "boost": {
        const next = Math.min(ab.maxSpeed ?? 1600, speed * (ab.factor ?? 1.6));
        body.vx = (body.vx / speed) * next;
        body.vy = (body.vy / speed) * next;
        bird.burnUntil = this.world.time + (ab.burnS ?? 0.4);
        break;
      }
      case "split": {
        const n = (ab.count ?? 3) - 1;
        const spread = ab.spread ?? 0.2;
        const ang = Math.atan2(body.vy, body.vx);
        for (let i = 0; i < n; i++) {
          const da = (i % 2 === 0 ? -1 : 1) * spread * (1 + Math.floor(i / 2));
          const r = bird.type.body.r;
          this.addBird(bird.playerId, bird.type, bird.skin, bird.shotId, false, body.x + Math.cos(ang + da) * r * 1.6, body.y + Math.sin(ang + da) * r * 1.6, Math.cos(ang + da) * speed, Math.sin(ang + da) * speed, ab.scale ?? 0.72);
        }
        break;
      }
      case "ricochet": {
        const target = this.pigs().sort((p, q) => Math.hypot(p.x - body.x, p.y - body.y) - Math.hypot(q.x - body.x, q.y - body.y))[0];
        if (target) {
          const dx = target.x - body.x;
          const dy = target.y - body.y;
          const d = Math.hypot(dx, dy) || 1;
          body.vx = (dx / d) * Math.max(speed, 700);
          body.vy = (dy / d) * Math.max(speed, 700);
        }
        break;
      }
      case "slam":
        body.vx *= 0.15;
        body.vy = ab.speed ?? 1200;
        body.mass *= ab.massFactor ?? 3;
        body.invMass = 1 / body.mass;
        body.invI /= ab.massFactor ?? 3;
        bird.damageMult = ab.damage ?? 1.8;
        bird.slammed = true;
        break;
      case "magnet":
        this.magnet = { body, until: this.world.time + (ab.seconds ?? 1), radius: ab.radius ?? 220, pull: ab.pull ?? 1400 };
        body.gravityScale = 0;
        break;
      case "bunker": {
        const size = ab.size ?? 56;
        const x = body.x;
        const y = body.y;
        const { vx, vy } = body;
        this.world.remove(body);
        const block = this.addBlock(x, y, 0, size, size, "metal", -1, false, "player");
        block.vx = vx * 0.8;
        block.vy = vy * 0.8;
        const e = W(block);
        e.hp = e.maxHp = ab.hp ?? 160;
        if (this.shot) this.shot.abilityHit = true;
        break;
      }
      default:
        return false;
    }
    return true;
  }

  /** Gliders steer while the shooter holds a direction (-1, 0, 1). */
  steer(dir: number): void {
    const body = this.primary();
    if (!body) return;
    const bird = W(body).bird!;
    if (bird.type.ability.kind !== "glide") return;
    bird.steer = Math.max(-1, Math.min(1, Math.round(dir)));
  }

  // ---------------------------------------------------------------- the piggies and the weather

  /** A cob bomb from a piggy toward a spot, with a little error. */
  lob(from: Body, toX: number, toY: number): void {
    const T = ATTACK.flightS * (1 + (this.random() - 0.5) * ATTACK.error * 2);
    const x0 = from.x;
    const y0 = from.y - (W(from).pig ? PIGS[W(from).pig!].r + ATTACK.r + 4 : 30);
    const vx = (toX - x0) / T;
    const vy = (toY - y0 - 0.5 * WORLD.gravity * T * T) / T;
    this.version += 1;
    this.world.add({ x: x0, y: y0, vx, vy, shape: { kind: "circle", r: ATTACK.r }, density: ATTACK.density, restitution: 0, windScale: 1, data: entity("bomb", "pig") });
    this.fx("lob", x0, y0, W(from).pig ?? "");
  }

  tornado(x: number, radius: number, lift: number, damage: number, seconds: number): void {
    this.vortex = { x, radius, lift, until: this.world.time + seconds };
    this.fx("tornado", x, WORLD.groundY, radius);
    for (const b of [...this.world.bodies]) {
      if (b.fixed || Math.abs(b.x - x) > radius) continue;
      this.world.wake(b);
      this.damage(b, damage * (1 - Math.abs(b.x - x) / radius) + damage * 0.25, this.cause, false);
    }
    this.settleDestruction();
  }

  earthquake(seconds: number, shove: number): void {
    this.quake = { until: this.world.time + seconds, shove };
    for (const b of this.world.bodies) this.world.wake(b);
    this.fx("quake", WORLD.width / 2, WORLD.groundY, seconds);
  }

  bolt(target: Body, damage: number): void {
    this.fx("bolt", target.x, bounds(target)[1], W(target).building?.type ?? W(target).material ?? "");
    this.damage(target, damage, this.cause, false);
    wakeAround(this.world, target.x, target.y, 60);
    this.settleDestruction();
  }

  /** Nothing above it (rain and hail reach it). */
  exposed(body: Body): boolean {
    const [l, t, r] = bounds(body);
    return !this.world.bodies.some((b) => {
      if (b === body || W(b).kind === "bird") return false;
      const [bl, bt, br, bb] = bounds(b);
      return bl < r - 2 && br > l + 2 && bb <= t + 2 && bt < t;
    });
  }

  setWater(level: number | null): void {
    this.world.waterLevel = level;
    if (level !== null) for (const b of this.world.bodies) if (!b.fixed && bounds(b)[3] > level) this.world.wake(b);
  }

  setFriction(scale: number): void {
    if (scale === this.frictionScale) return;
    for (const b of this.world.bodies) {
      const e = W(b);
      if (e.kind !== "block" || !e.material) continue;
      b.friction = MATERIALS[e.material].friction * scale;
    }
    this.frictionScale = scale;
  }

  /** The piggies rebuild: destroyed blueprint blocks first (bottom up), then patch damage. */
  repair(budget: number): { rebuilt: number; healed: number; restoredBlocks: Entity[] } {
    let left = budget;
    const restoredBlocks: Entity[] = [];
    const standing = new Set(this.fortressBlocks().map((b) => W(b).bp).filter((i) => i >= 0));
    const missing = this.blueprint.map((bp, i) => ({ bp, i })).filter(({ i }) => !standing.has(i)).sort((p, q) => q.bp.y - p.bp.y);
    let rebuilt = 0;
    for (const { bp, i } of missing) {
      // Specials (vaults, totems, barrels) are one-offs: once they're gone, they're gone.
      if (!REBUILDS.has(bp.m)) continue;
      const hp = blockHealth(MATERIALS[bp.m], bp.w * bp.h);
      if (left < hp * 0.5) continue;
      if (!this.clear(bp.x, bp.y, bp.w, bp.h, 2)) continue;
      // Only on something: never a slab hanging in the air where its posts used to be.
      if (!this.supported(bp)) continue;
      const body = this.addBlock(bp.x, bp.y, bp.angle, bp.w, bp.h, bp.m, i, true);
      const e = W(body);
      const paid = Math.min(left, hp);
      e.hp = Math.max(1, Math.round(paid));
      left -= paid;
      rebuilt += 1;
      restoredBlocks.push(e);
      this.fx("rebuild", bp.x, bp.y, bp.m);
    }
    let healed = 0;
    for (const b of this.fortressBlocks()) {
      const e = W(b);
      if (left <= 0) break;
      const need = e.maxHp - e.hp;
      if (need <= 0.5) continue;
      const add = Math.min(need, left);
      e.hp += add;
      left -= add;
      healed += add;
      this.fx("heal", b.x, b.y, e.material ?? "");
    }
    return { rebuilt, healed: Math.round(healed), restoredBlocks };
  }

  /** Is there something solid right under where this blueprint block would sit? */
  private supported(bp: Blueprint): boolean {
    const bottom = bp.y + (Math.abs(Math.cos(bp.angle)) * bp.h + Math.abs(Math.sin(bp.angle)) * bp.w) / 2;
    return !this.clear(bp.x, bottom + 3, Math.max(8, bp.w - 4), 5, 0);
  }

  /** A builder piggy's reinforcement: one plain block gets tougher. */
  reinforce(count: number): number {
    const plain = this.fortressBlocks().filter((b) => !W(b).reinforced && ["wood", "glass", "corn", "ice"].includes(W(b).material ?? ""));
    let n = 0;
    for (let i = 0; i < count && plain.length; i++) {
      const b = plain.splice(Math.floor(this.random() * plain.length), 1)[0]!;
      const e = W(b);
      e.reinforced = true;
      e.maxHp = Math.round(e.maxHp * 1.4);
      e.hp = Math.min(e.maxHp, e.hp * 1.4);
      this.fx("reinforce", b.x, b.y, e.material ?? "");
      n += 1;
    }
    return n;
  }

  // ---------------------------------------------------------------- stepping

  /** Advances by `seconds` in fixed steps. */
  advance(seconds: number): void {
    const steps = Math.round(seconds / SUBSTEP);
    for (let i = 0; i < steps; i++) {
      this.forces();
      this.world.step(SUBSTEP);
      this.settleDestruction();
    }
    this.track();
  }

  private forces(): void {
    const t = this.world.time;
    for (const b of this.birds()) {
      const bird = W(b).bird!;
      // A bird that has hit something and is only crawling now has done its job: let it stop
      // instead of rolling for seconds while everyone waits.
      if (bird.bounces > 0 && Math.hypot(b.vx, b.vy) < 140) {
        b.vx *= 0.93;
        b.vy = b.vy > 0 ? b.vy : b.vy * 0.93;
        b.w *= 0.9;
      }
      if (bird.steer && bird.fuel > 0) {
        bird.fuel = Math.max(0, bird.fuel - SUBSTEP);
        b.fx += bird.steer * (bird.type.ability.steer ?? 900) * b.mass;
        b.gravityScale = 1 - (bird.type.ability.lift ?? 0.5);
        b.vy = Math.min(b.vy, 420);
        if (this.shot) this.shot.abilityUsed = true;
      } else if (bird.type.ability.kind === "glide") b.gravityScale = 1;
    }
    for (const b of this.world.bodies) {
      const e = W(b);
      if (!e.dropping) continue;
      // Under a chute: a gentle, steady descent.
      if (b.vy > 140) b.vy = 140;
      if (this.world.touching(b).length) this.landed(b);
    }
    const m = this.magnet;
    if (m) {
      if (t > m.until || m.body.removed) {
        if (!m.body.removed) m.body.gravityScale = 1;
        this.magnet = null;
      } else {
        m.body.vx *= 0.9;
        m.body.vy *= 0.9;
        for (const b of this.world.bodies) {
          const e = W(b);
          if (b.fixed || b === m.body || (e.kind !== "block" && e.kind !== "pig")) continue;
          const dx = m.body.x - b.x;
          const dy = m.body.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > m.radius || d < 1) continue;
          this.world.wake(b);
          // Toward her, and a little up, so the pull beats friction and towers lean over.
          const k = m.pull * Math.sqrt(1 - d / m.radius) * SUBSTEP;
          b.vx += (dx / d) * k;
          b.vy += (dy / d) * k * 0.6 - WORLD.gravity * 0.35 * SUBSTEP;
          if (this.shot) this.shot.abilityHit = true;
        }
      }
    }
    const v = this.vortex;
    if (v) {
      if (t > v.until) this.vortex = null;
      else
        for (const b of this.world.bodies) {
          if (b.fixed) continue;
          const dx = v.x - b.x;
          if (Math.abs(dx) > v.radius) continue;
          this.world.wake(b);
          const k = 1 - Math.abs(dx) / v.radius;
          b.vy -= v.lift * k * SUBSTEP * 1.6;
          b.vx += Math.sign(dx || 1) * v.lift * 0.5 * k * SUBSTEP + v.lift * 0.35 * k * SUBSTEP;
          b.w += 3 * k * SUBSTEP;
        }
    }
    const q = this.quake;
    if (q) {
      if (t > q.until) this.quake = null;
      else {
        const ax = q.shove * 2 * Math.PI * 3 * Math.cos(2 * Math.PI * 3 * t);
        for (const b of this.world.bodies) {
          if (b.fixed) continue;
          this.world.wake(b);
          b.vx += ax * SUBSTEP;
          b.vy += (Math.sin(2 * Math.PI * 5 * t) * q.shove * 3 * SUBSTEP) / 2;
        }
      }
    }
  }

  /** Records the shot's flight for awards (sampled per tick). */
  private track(): void {
    const s = this.shot;
    if (!s) return;
    const body = this.primary();
    s.flightMs = Math.round((this.world.time - this.shotStart) * 1000);
    if (!body) return;
    if (this.lastSample) s.path += Math.hypot(body.x - this.lastSample[0], body.y - this.lastSample[1]);
    this.lastSample = [body.x, body.y];
    s.maxX = Math.max(s.maxX, body.x);
    s.apex = Math.min(s.apex, body.y);
    const sign = Math.abs(body.vx) > 40 ? Math.sign(body.vx) : 0;
    if (sign && this.lastVxSign && sign !== this.lastVxSign) s.reversals += 1;
    if (sign) this.lastVxSign = sign;
  }

  /** True while anything moves (or a weather effect is still going). */
  busy(): boolean {
    return !this.world.settled() || this.vortex !== null || this.quake !== null || this.magnet !== null || this.pending.length > 0;
  }

  /** Ends a shot: the birds retire (they were used up), the record is returned. */
  endShot(): ShotRecord | null {
    for (const b of this.birds()) {
      this.fx("poof", b.x, b.y, W(b).bird!.type.id);
      this.world.remove(b);
      this.version += 1;
    }
    const shot = this.shot;
    this.shot = null;
    this.cause = { kind: "none" };
    this.magnet = null;
    return shot;
  }

  /** Stops everything where it is (a step that ran too long). */
  freeze(): void {
    for (const b of this.world.bodies) {
      if (b.fixed) continue;
      b.vx = b.vy = b.w = 0;
      b.asleep = true;
    }
    this.vortex = this.quake = this.magnet = null;
    for (const b of this.world.bodies) if (W(b).kind === "bomb") this.world.remove(b);
  }

  // ---------------------------------------------------------------- what the screens get

  /**
   * Every body: [id, kind, sub, x, y, angle×1000, halfW | r, halfH, crack 0-4, flags, owner].
   * kind: b block, p pig, B bird, h building, x bomb. flags: 1 reinforced, 2 player's side,
   * 4 disabled, 8 broken, 16 waterlogged, 32 burning (boost), 64 magnet, 128 shield piggy's bubble,
   * 256 parachuting.
   */
  rows(ids: Map<string, number>): (string | number)[][] {
    const out: (string | number)[][] = [];
    for (const b of this.world.bodies) {
      const e = W(b);
      if (e.kind === "terrain") continue;
      const code = e.kind === "block" ? "b" : e.kind === "pig" ? "p" : e.kind === "bird" ? "B" : e.kind === "building" ? "h" : "x";
      const sub = e.kind === "pig" ? e.pig! : e.kind === "bird" ? `${e.bird!.type.id}:${e.bird!.skin}` : e.kind === "building" ? `${e.building!.type}:${e.building!.tier}` : (e.material ?? "");
      const [hw, hh] = b.shape.kind === "box" ? [b.shape.hw, b.shape.hh] : [b.shape.r, b.shape.r];
      let flags = 0;
      if (e.reinforced) flags |= 1;
      if (e.team === "player") flags |= 2;
      if (e.building?.disabled) flags |= 4;
      if (e.building?.broken) flags |= 8;
      if (e.building?.waterlogged) flags |= 16;
      if (e.bird && e.bird.burnUntil > this.world.time) flags |= 32;
      if (this.magnet?.body === b) flags |= 64;
      if (e.pig === "shield") flags |= 128;
      if (e.dropping) flags |= 256;
      const owner = e.bird ? (ids.get(e.bird.playerId) ?? -1) : e.building ? (ids.get(e.building.builtBy) ?? -1) : -1;
      out.push([b.id, code, sub, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.angle * 1000), Math.round(hw * 10) / 10, Math.round(hh * 10) / 10, crackStage(e.hp, e.maxHp), flags, owner]);
    }
    return out;
  }
}

export const entityOf = W;
export { area };
