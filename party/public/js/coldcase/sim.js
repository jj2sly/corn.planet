// CPI: Cold Case — the mission simulation. Deterministic and renderer-free: the browser steps it
// every frame, the tests step it with a scripted agent (bot.js), and a later multiplayer server
// could run the same rules. Positions are in tiles (1 tile = 1 m), time in seconds, °C.
//
// The loop: briefing → open the fridge → food storage thermostat (thaws the power room hatch) →
// breakers + main bus → freezer valves + compressor → technician outpost (Chuck) → deep interior
// → core (coils, pressure, temperature, hold) → emergency lift → exit → debrief.
//
// Temperature is the spine: every zone has one, heat sources raise it locally, the agent's felt
// temperature follows it, warmth drains in the cold, and each food threat has its own response.

import { buildMap, CORE_CENTER, ZONE_INDEX } from "./map.js";
import { TEXT } from "./content.js";

export const CONFIG = Object.freeze({
  player: { radius: 0.32, speed: 4.6, accel: 34, friction: 38, iceAccel: 6.5, iceFriction: 2.2, maxHp: 100, maxWarmth: 100, maxHeatPacks: 4 },
  temp: { zoneRate: 1.6, feltRate: 0.9 },
  // Warmth changes by (felt - neutralLow) * drain per second below neutralLow, and gains
  // (felt - neutralHigh) * gain (capped) above neutralHigh. At zero warmth the cold takes health.
  cold: { neutralLow: -4, neutralHigh: 4, drain: 0.2, gain: 1.2, maxGain: 14, hypothermia: 2.5, slowBelow: 30, slowMin: 0.72 },
  safeRegen: 6,
  thaw: { point: 2, rate: 1 / 8 },
  loop: { min: -8, max: 12, start: -6 },
  heat: { falloff: 1.6 },
  milk: { frozenBelow: 0, spoilAbove: 6.5, radius: 0.34, wander: 0.9, curious: 1.6, curiousRange: 3.5, curiousTime: 2.5, curiousRest: 3, hunt: 3, huntRange: 11, lurkDamage: 6, huntDamage: 12, backoff: 0.6 },
  icecream: { hardBelow: -6, radius: 0.42, crawl: 0.7, crawlRange: 5, stickySlow: 1.2, hunt: 2.1, huntRange: 12, lungeRange: 3.2, windup: 0.55, lunge: 7.5, lungeTime: 0.5, stun: 1.4, recover: 0.8, cooldown: 1.6, softDamage: 2, bumpDamage: 6, lungeDamage: 15, backoff: 0.7 },
  contact: { iframes: 0.7, knock: 5.5, lungeKnock: 8, cooldown: 1 },
  heatPack: { warmth: 35, radius: 2.6, temp: 12, duration: 7 },
  lamp: { radius: 3, temp: 14 },
  spark: { warn: 0.7, arc: 0.35, damage: 6 },
  vent: { charge: 1.2, blast: 0.6, warmth: 15, damage: 4, slow: 1.5, slowFactor: 0.6 },
  core: { ring: 3.4, hold: 15, surgeEvery: 3.2, surgeStart: 1.6, surgeSpeed: 5.5, surgeMax: 9, surgeWarmth: 9, surgeDamage: 3 },
  respawn: { downTime: 2.6, hp: 75, warmth: 75, iframes: 2 },
  timing: { need: 3, window: 0.2, minWindow: 0.12, speed: 0.75, speedUp: 0.12, faultDamage: 4, cooldown: 0.35 },
  pressure: { need: 2, rise: 0.38, accel: 0.25, bleed: 0.22, bands: [[0.62, 0.78], [0.66, 0.8]], overDamage: 5 },
  balance: { need: 4, start: -6, band: [-19, -15], push: 7, bias: 1.2, drift: 14, maxDrift: 4, min: -30, max: 5 },
  panelResult: 0.7,
});

/** The mission in order. `done` moves the objective on; several can pass in one step. */
export const OBJECTIVES = Object.freeze([
  { id: "OPEN_FRIDGE", done: (s) => s.flags.fridgeOpened },
  { id: "ENTER", done: (s) => s.flags.entered },
  { id: "ADJUST_TEMP", done: (s) => s.flags.setpointOk },
  { id: "REACH_POWER", done: (s) => zoneId(s) === "POWER" },
  { id: "RESTORE_POWER", done: (s) => s.flags.powerRestored },
  { id: "REACH_FREEZER", done: (s) => zoneId(s) === "FREEZER" },
  { id: "REPAIR_COOLING", done: (s) => s.flags.coolingRepaired },
  { id: "REACH_OUTPOST", done: (s) => zoneId(s) === "OUTPOST" },
  { id: "FIND_CHUCK", done: (s) => s.flags.outpostFound },
  { id: "REACH_CORE", done: (s) => zoneId(s) === "CORE" },
  { id: "REPAIR_CORE", done: (s) => s.flags.coreStabilized },
  { id: "EXTRACT", done: (s) => s.flags.extracted },
]);

const BREAKERS = ["breakerA", "breakerB", "breakerC"];
const VALVES = ["valve1", "valve2", "valve3"];
const COILS = ["coil1", "coil2", "coil3"];
const LAMPS = ["lamp1", "lamp2", "lamp3", "lamp4"];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const tri = (x) => {
  const m = ((x % 2) + 2) % 2;
  return m < 1 ? m : 2 - m;
};

/** mulberry32: small, fast, deterministic. */
function makeRandom(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NO_INPUT = Object.freeze({
  moveX: 0,
  moveY: 0,
  interact: false,
  interactPressed: false,
  action: false,
  actionPressed: false,
  cancelPressed: false,
  adjust: 0,
  adjustHeld: 0,
});

// ------------------------------------------------------------------ creation

export function createGame({ seed = 1, map = buildMap(), skipBriefing = false } = {}) {
  const P = CONFIG.player;
  const zones = map.zones.map((z) => ({ id: z.id, name: z.name, temp: z.temp, target: z.temp, dark: z.dark, safe: Boolean(z.safe) }));
  const state = {
    map,
    random: makeRandom(seed),
    seed,
    time: 0,
    missionTime: 0,
    phase: skipBriefing ? "PLAYING" : "BRIEFING",
    objective: 0,
    setpoint: CONFIG.loop.start,
    zones,
    discovered: new Uint8Array(zones.length),
    flags: {
      fridgeOpened: false,
      entered: false,
      thermostatUsed: false,
      setpointOk: false,
      thaw: 0,
      current: false,
      powerRestored: false,
      coolingRepaired: false,
      outpostFound: false,
      lockerOpened: false,
      coreStage: 0,
      coreStabilized: false,
      liftArrived: false,
      extracted: false,
      done: Object.create(null),
    },
    player: {
      x: map.start.x,
      y: map.start.y,
      vx: 0,
      vy: 0,
      r: P.radius,
      facing: map.start.facing,
      hp: P.maxHp,
      warmth: P.maxWarmth,
      felt: 21,
      zone: ZONE_INDEX.KITCHEN,
      iframes: 0,
      lastHurt: -99,
      slowUntil: -99,
      heatPacks: 0,
      moving: false,
      warnedLow: false,
      warnedHypo: false,
    },
    doors: map.doors.map((d) => ({ id: d.id, kind: d.kind, unlocked: false, open: 0, passable: false })),
    threats: map.threats.map((t) => makeThreat(t, map)),
    heat: [],
    pickups: map.pickups.map((p) => ({ ...p, taken: false })),
    checkpoint: "kitchen",
    colliders: [{ x: 69.9, y: 67.35, r: 0.38 }],
    hazards: map.hazards.map((h) => ({ ...h, state: "idle", hit: -1 })),
    core: { progress: 0, surges: [], surgeT: 0 },
    target: null,
    hold: null,
    panel: null,
    transition: null,
    downT: 0,
    completeT: -1,
    fields: new Map(),
    said: new Set(),
    panelProgress: Object.create(null),
    events: [],
    stats: { downs: 0, damage: 0, heatPacksUsed: 0, spoiled: false, threats: Object.create(null), checkpoints: 0 },
  };
  for (const id of LAMPS) {
    const h = map.heaters.find((x) => x.id === id);
    state.heat.push({ id, x: h.x, y: h.y, r: CONFIG.lamp.radius, temp: CONFIG.lamp.temp, on: false, until: Infinity, follow: false });
  }
  discover(state);
  return state;
}

function makeThreat(t, map) {
  const cfg = CONFIG[t.kind];
  return {
    id: t.id,
    kind: t.kind,
    leash: ZONE_INDEX[t.leash],
    homeX: t.x,
    homeY: t.y,
    x: t.x,
    y: t.y,
    vx: 0,
    vy: 0,
    r: cfg.radius,
    facing: Math.PI / 2,
    temper: t.kind === "milk" ? "FROZEN" : "SOFT",
    mode: "idle",
    modeT: 0,
    cooldown: 0,
    contactCooldown: 0,
    aimX: 0,
    aimY: 0,
    lungeHit: false,
    wanderX: t.x,
    wanderY: t.y,
    wanderT: 0,
    curiousRest: 0,
    temp: map.zones[ZONE_INDEX[t.leash]].temp,
    homeField: null,
  };
}

/** Starts the mission from the briefing. */
export function beginMission(state) {
  if (state.phase !== "BRIEFING") return false;
  state.phase = "PLAYING";
  emit(state, { type: "phase", phase: "PLAYING" });
  return true;
}

// ------------------------------------------------------------------ queries

export const zoneId = (state) => state.zones[state.player.zone]?.id ?? "";

export function tileSolid(state, tx, ty) {
  const { map } = state;
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  const i = ty * map.w + tx;
  if (!map.floor[i] || map.block[i]) return true;
  const d = map.door[i];
  return d > 0 && !state.doors[d - 1].passable;
}

/** Temperature at a point: its zone's, raised by any heat source in range. */
export function localTemp(state, x, y) {
  const zi = state.map.zoneAt(Math.floor(x), Math.floor(y));
  const base = zi >= 0 ? state.zones[zi].temp : -10;
  let t = base;
  for (const h of state.heat) {
    if (!h.on) continue;
    const dx = x - h.x;
    const dy = y - h.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= h.r * h.r) continue;
    const w = Math.min(1, (1 - Math.sqrt(d2) / h.r) * CONFIG.heat.falloff);
    const v = base + (h.temp - base) * w;
    if (v > t) t = v;
  }
  return t;
}

/** True when the agent is standing in a heat source's warm core. */
export function inHeat(state, x, y) {
  for (const h of state.heat) {
    if (!h.on) continue;
    if (Math.hypot(x - h.x, y - h.y) < h.r * 0.6) return true;
  }
  return false;
}

export const doorState = (state, id) => state.doors.find((d) => d.id === id) ?? null;
const mapDoor = (state, id) => state.map.doors.find((d) => d.id === id);
const station = (state, id) => state.map.stations.find((s) => s.id === id);
const done = (state, id) => Boolean(state.flags.done[id]);
const countDone = (state, ids) => ids.filter((id) => done(state, id)).length;

/** Distance from a point to a door's rectangle. */
function doorDistance(state, door, x, y) {
  const d = mapDoor(state, door.id);
  const cx = clamp(x, d.x, d.x + d.w);
  const cy = clamp(y, d.y, d.y + d.h);
  return Math.hypot(x - cx, y - cy);
}

function lineOfSight(state, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / 0.25);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (tileSolid(state, Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
  }
  return true;
}

/**
 * Breadth-first distances (in steps) from a goal tile over tiles `passable` allows, 8-connected
 * without cutting corners. -1 = unreachable. Shared by the threats, the HUD's guidance and the bot.
 */
export function distanceField(state, gx, gy, passable) {
  const { w, h } = state.map;
  const dist = new Int16Array(w * h).fill(-1);
  if (gx < 0 || gy < 0 || gx >= w || gy >= h) return dist;
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  dist[gy * w + gx] = 0;
  queue[tail++] = gy * w + gx;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    const nd = dist[i] + 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] !== -1 || !passable(nx, ny)) continue;
        if (dx && dy && (!passable(x + dx, y) || !passable(x, y + dy))) continue;
        dist[j] = nd;
        queue[tail++] = j;
      }
    }
  }
  return dist;
}

/**
 * A walkable route from (x, y) toward (tx, ty) as tile centres, using doors as they are now.
 * Returns [] when there is none. Used by the HUD's objective arrow and the bot.
 */
export function routeTo(state, x, y, tx, ty, { maxLength = 400 } = {}) {
  const { map } = state;
  const { w } = map;
  const gx = Math.floor(tx);
  const gy = Math.floor(ty);
  // Unlocked doors count as open: they slide open as the agent arrives.
  const passable = (px, py) => {
    if (px === gx && py === gy) return true;
    if (!tileSolid(state, px, py)) return true;
    if (px < 0 || py < 0 || px >= map.w || py >= map.h) return false;
    const i = py * map.w + px;
    const d = map.door[i];
    return d > 0 && !map.block[i] && state.doors[d - 1].unlocked;
  };
  const dist = distanceField(state, gx, gy, passable);
  let cx = Math.floor(x);
  let cy = Math.floor(y);
  if (dist[cy * w + cx] < 0) return [];
  const route = [];
  while (!(cx === gx && cy === gy) && route.length < maxLength) {
    let best = -1;
    let bx = cx;
    let by = cy;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        const d = dist[ny * w + nx];
        if (d < 0 || d >= dist[cy * w + cx]) continue;
        if (dx && dy && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
        // Prefer straight moves on ties: fewer zig-zags.
        const score = d * 2 + (dx && dy ? 1 : 0);
        if (best < 0 || score < best) {
          best = score;
          bx = nx;
          by = ny;
        }
      }
    }
    if (best < 0) break;
    cx = bx;
    cy = by;
    route.push({ x: cx + 0.5, y: cy + 0.5 });
  }
  return route;
}

// ------------------------------------------------------------------ stations and objectives

/** What a station offers right now: whether it can be used, and what the prompt says. */
export function stationInfo(state, st) {
  const f = state.flags;
  const S = TEXT.stations;
  const id = st.id;
  const info = (available, label, locked = null) => ({ available, label, locked, visible: available || locked !== null });
  if (id === "fridge") return info(!f.fridgeOpened, S.fridge);
  if (id === "thermostat") return info(f.entered, S.thermostat);
  if (BREAKERS.includes(id)) return info(!done(state, id), `${S.breaker} ${id.slice(-1)}`);
  if (id === "mainbus") {
    if (f.powerRestored) return info(false, S.mainbus);
    const n = countDone(state, BREAKERS);
    return n < 3 ? info(false, S.mainbus, `${S.mainbusLocked} ${n}/3`) : info(true, S.mainbus);
  }
  if (VALVES.includes(id)) return info(!done(state, id), S.valve);
  if (id === "compressor") {
    if (f.coolingRepaired) return info(false, S.compressor);
    const n = countDone(state, VALVES);
    return n < 3 ? info(false, S.compressor, `${S.compressorLocked} ${n}/3`) : info(true, S.compressor);
  }
  if (id === "chuck") return info(!f.outpostFound, S.chuck);
  if (id === "locker") return f.outpostFound ? info(!f.lockerOpened, S.locker) : info(false, S.locker, S.lockerLocked);
  if (LAMPS.includes(id)) return info(!done(state, id), S.lamp);
  if (COILS.includes(id)) return info(f.coreStage === 0 && !done(state, id), S.coil);
  if (id === "console") {
    if (f.coreStage === 0) return info(false, S.consolePressure, `${S.consoleLocked} ${countDone(state, COILS)}/3`);
    if (f.coreStage === 1) return info(true, S.consolePressure);
    if (f.coreStage === 2) return info(true, S.consoleTemp);
    if (f.coreStage === 3) return info(false, S.consoleHold, S.consoleHold);
    return info(false, S.consoleTemp);
  }
  return info(false, id);
}

const nearestUndone = (state, ids) => {
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (const id of ids) {
    if (done(state, id)) continue;
    const st = station(state, id);
    const d = Math.hypot(st.x - p.x, st.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = st;
    }
  }
  return best;
};

/** The current objective for the HUD: its text, a progress detail and where it is. */
export function objectiveInfo(state) {
  const f = state.flags;
  const O = TEXT.objectives;
  const obj = OBJECTIVES[state.objective];
  if (!obj) return { id: "COMPLETE", text: O.COMPLETE, detail: "", progress: null, target: null };
  const at = (st) => (st ? { x: st.x, y: st.y } : null);
  switch (obj.id) {
    case "OPEN_FRIDGE":
      return { id: obj.id, text: O.OPEN_FRIDGE, detail: "", progress: null, target: at(station(state, "fridge")) };
    case "ENTER":
      return { id: obj.id, text: O.ENTER, detail: "", progress: null, target: { x: 84.95, y: 3.5 } };
    case "ADJUST_TEMP":
      return { id: obj.id, text: f.thermostatUsed ? O.ADJUST_TEMP_LOW : O.ADJUST_TEMP, detail: "", progress: null, target: at(station(state, "thermostat")) };
    case "REACH_POWER": {
      const hatch = doorState(state, "hatch");
      if (!hatch.unlocked) return { id: obj.id, text: O.THAWING, detail: `${Math.floor(f.thaw * 100)}%`, progress: f.thaw, target: { x: 34.5, y: 47.5 } };
      return { id: obj.id, text: O.REACH_POWER, detail: "", progress: null, target: { x: 34.5, y: 50.5 } };
    }
    case "RESTORE_POWER": {
      const n = countDone(state, BREAKERS);
      if (n < 3) return { id: obj.id, text: O.BREAKERS, detail: `${n}/3`, progress: n / 3, target: at(nearestUndone(state, BREAKERS)) };
      return { id: obj.id, text: O.MAIN_BUS, detail: "", progress: null, target: at(station(state, "mainbus")) };
    }
    case "REACH_FREEZER":
      return { id: obj.id, text: O.REACH_FREEZER, detail: "", progress: null, target: { x: 51.8, y: 43.5 } };
    case "REPAIR_COOLING": {
      const n = countDone(state, VALVES);
      if (n < 3) return { id: obj.id, text: O.VALVES, detail: `${n}/3`, progress: n / 3, target: at(nearestUndone(state, VALVES)) };
      return { id: obj.id, text: O.COMPRESSOR, detail: "", progress: null, target: at(station(state, "compressor")) };
    }
    case "REACH_OUTPOST":
      return { id: obj.id, text: O.REACH_OUTPOST, detail: "", progress: null, target: { x: 69.9, y: 63.6 } };
    case "FIND_CHUCK":
      return { id: obj.id, text: O.FIND_CHUCK, detail: "", progress: null, target: at(station(state, "chuck")) };
    case "REACH_CORE":
      return { id: obj.id, text: O.REACH_CORE, detail: "", progress: null, target: { x: 26.5, y: 92.5 } };
    case "REPAIR_CORE": {
      const stage = f.coreStage;
      if (stage === 0) {
        const n = countDone(state, COILS);
        return { id: obj.id, text: O.COILS, detail: `${n}/3`, progress: n / 3, target: at(nearestUndone(state, COILS)) };
      }
      if (stage === 1) return { id: obj.id, text: O.CORE_PRESSURE, detail: "", progress: null, target: at(station(state, "console")) };
      if (stage === 2) return { id: obj.id, text: O.CORE_TEMP, detail: "", progress: null, target: at(station(state, "console")) };
      return { id: obj.id, text: O.CORE_HOLD, detail: `${Math.floor(state.core.progress * 100)}%`, progress: state.core.progress, target: { x: CORE_CENTER.x + 2.4, y: CORE_CENTER.y + 0.5 } };
    }
    case "EXTRACT": {
      const z = zoneId(state);
      if (!f.liftArrived && (z === "CORE" || z === "DEEP")) return { id: obj.id, text: O.EXTRACT_LIFT, detail: "", progress: null, target: { x: 19.5, y: 83.9 } };
      return { id: obj.id, text: O.EXTRACT, detail: "", progress: null, target: { x: 14.95, y: 48.8 } };
    }
    default:
      return { id: obj.id, text: obj.id, detail: "", progress: null, target: null };
  }
}

// ------------------------------------------------------------------ events

function emit(state, event) {
  state.events.push(event);
}

function say(state, text, tone = "info", extra = {}) {
  if (extra.once) {
    if (state.said.has(extra.once)) return;
    state.said.add(extra.once);
  }
  emit(state, { type: "message", text, tone, ...extra });
}

/** Removes and returns the events since the last call. */
export function drainEvents(state) {
  const out = state.events;
  state.events = [];
  return out;
}

// ------------------------------------------------------------------ the step

/**
 * Advances the mission by `dt` seconds (clamped to 1/20). `input` is the agent's controls for this
 * step (see NO_INPUT); edge fields (…Pressed, adjust) must be true for one step only.
 */
export function stepGame(state, input = NO_INPUT, dt = 1 / 60) {
  dt = clamp(dt, 0, 0.05);
  state.time += dt;
  if (state.phase === "BRIEFING" || state.phase === "COMPLETE") return state;
  state.missionTime += dt;

  updateZones(state, dt);
  updateHeat(state);

  if (state.transition) updateTransition(state, dt);
  else if (state.phase === "DOWNED") updateDowned(state, dt);
  else {
    if (state.panel) updatePanel(state, input, dt);
    else updateAgent(state, input, dt);
    arrive(state);
  }

  updateDoors(state, dt);
  if (state.phase === "PLAYING" && !state.transition) {
    updateHazards(state, dt);
    updateCore(state, dt);
  }
  updateThreats(state, dt);
  if (state.phase === "PLAYING") updateVitals(state, dt);
  updateObjective(state);

  if (state.completeT >= 0) {
    state.completeT -= dt;
    if (state.completeT < 0 && state.phase !== "COMPLETE") {
      state.phase = "COMPLETE";
      emit(state, { type: "phase", phase: "COMPLETE" });
      say(state, TEXT.messages.extracted, "good", { big: true });
    }
  }
  return state;
}

function zoneTarget(state, id) {
  const f = state.flags;
  switch (id) {
    case "CENTRAL":
    case "PANTRY":
      return state.setpoint;
    case "POWER":
      return f.powerRestored ? 7 : 3;
    case "FREEZER":
      return f.coolingRepaired ? -14 : -3;
    case "OUTPOST":
      return f.outpostFound ? 14 : 1;
    case "DEEP":
      return f.coreStabilized ? -16 : -24;
    case "CORE":
      return f.coreStabilized ? -12 : -20;
    default:
      return null;
  }
}

function updateZones(state, dt) {
  const step = CONFIG.temp.zoneRate * dt;
  for (const z of state.zones) {
    const target = zoneTarget(state, z.id);
    if (target !== null) z.target = target;
    if (z.temp < z.target) z.temp = Math.min(z.target, z.temp + step);
    else if (z.temp > z.target) z.temp = Math.max(z.target, z.temp - step);
  }
  // The power room hatch thaws while the storage loop is above the thaw point.
  const f = state.flags;
  const hatch = doorState(state, "hatch");
  if (!hatch.unlocked) {
    const t = state.zones[ZONE_INDEX.CENTRAL].temp;
    if (t >= CONFIG.thaw.point) f.thaw = Math.min(1, f.thaw + (t - CONFIG.thaw.point + 1) * CONFIG.thaw.rate * dt);
  }
}

function updateHeat(state) {
  const p = state.player;
  state.heat = state.heat.filter((h) => h.until > state.time);
  for (const h of state.heat) {
    if (h.follow) {
      h.x = p.x;
      h.y = p.y;
    }
  }
}

// ------------------------------------------------------------------ the agent

function agentSolid(state) {
  return (tx, ty) => tileSolid(state, tx, ty);
}

/**
 * Moves a circle by (dx, dy) and pushes it out of solid tiles and static colliders, sliding along
 * walls. Returns the fraction of the requested move that happened (for "hit a wall" checks).
 */
function moveCircle(state, body, dx, dy, solid) {
  const startX = body.x;
  const startY = body.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(length / (body.r * 0.5)));
  for (let s = 0; s < steps; s++) {
    body.x += dx / steps;
    body.y += dy / steps;
    for (let pass = 0; pass < 2; pass++) pushOut(state, body, solid);
  }
  if (length < 1e-6) return 1;
  const moved = ((body.x - startX) * dx + (body.y - startY) * dy) / (length * length);
  return clamp(moved, 0, 1);
}

function pushOut(state, body, solid) {
  const r = body.r;
  const x0 = Math.floor(body.x - r);
  const x1 = Math.floor(body.x + r);
  const y0 = Math.floor(body.y - r);
  const y1 = Math.floor(body.y + r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!solid(tx, ty)) continue;
      const cx = clamp(body.x, tx, tx + 1);
      const cy = clamp(body.y, ty, ty + 1);
      let nx = body.x - cx;
      let ny = body.y - cy;
      let d = Math.hypot(nx, ny);
      if (d >= r) continue;
      if (d < 1e-6) {
        // Centre inside the tile: leave by the nearest edge.
        const left = body.x - tx;
        const right = tx + 1 - body.x;
        const top = body.y - ty;
        const bottom = ty + 1 - body.y;
        const m = Math.min(left, right, top, bottom);
        nx = m === left ? -1 : m === right ? 1 : 0;
        ny = m === top ? -1 : m === bottom ? 1 : 0;
        d = -m;
      } else {
        nx /= d;
        ny /= d;
      }
      const push = r - d;
      body.x += nx * push;
      body.y += ny * push;
      const vn = body.vx * nx + body.vy * ny;
      if (vn < 0) {
        body.vx -= vn * nx;
        body.vy -= vn * ny;
      }
    }
  }
  for (const c of state.colliders) {
    const dx = body.x - c.x;
    const dy = body.y - c.y;
    const d = Math.hypot(dx, dy);
    const min = body.r + c.r;
    if (d >= min || d < 1e-6) continue;
    body.x = c.x + (dx / d) * min;
    body.y = c.y + (dy / d) * min;
  }
}

function updateAgent(state, input, dt) {
  const p = state.player;
  const P = CONFIG.player;
  let mx = Number(input.moveX) || 0;
  let my = Number(input.moveY) || 0;
  const len = Math.hypot(mx, my);
  // Normalized: diagonals are never faster than straight lines.
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  const moving = len > 0.05;
  const warmthSlow = p.warmth < CONFIG.cold.slowBelow ? CONFIG.cold.slowMin + (1 - CONFIG.cold.slowMin) * (p.warmth / CONFIG.cold.slowBelow) : 1;
  const ventSlow = state.time < p.slowUntil ? CONFIG.vent.slowFactor : 1;
  const speed = P.speed * warmthSlow * ventSlow;
  const tile = Math.floor(p.y) * state.map.w + Math.floor(p.x);
  const onIce = state.map.ice[tile] === 1;
  const rate = (moving ? (onIce ? P.iceAccel : P.accel) : onIce ? P.iceFriction : P.friction) * dt;
  const tvx = mx * speed;
  const tvy = my * speed;
  const dvx = tvx - p.vx;
  const dvy = tvy - p.vy;
  const dv = Math.hypot(dvx, dvy);
  if (dv <= rate) {
    p.vx = tvx;
    p.vy = tvy;
  } else {
    p.vx += (dvx / dv) * rate;
    p.vy += (dvy / dv) * rate;
  }
  moveCircle(state, p, p.vx * dt, p.vy * dt, agentSolid(state));
  p.moving = Math.hypot(p.vx, p.vy) > 0.4;
  if (moving) {
    const want = Math.atan2(my, mx);
    let diff = want - p.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    p.facing += diff * Math.min(1, dt * 14);
  }

  // Interaction.
  state.target = findTarget(state);
  const target = state.target;
  const st = target?.type === "station" ? station(state, target.id) : null;
  if (st && target.available && st.kind === "hold") {
    if (input.interact) {
      if (!state.hold || state.hold.id !== st.id) state.hold = { id: st.id, t: 0, dur: st.dur };
      state.hold.t += dt;
      faceToward(p, st);
      if (state.hold.t >= st.dur) {
        state.hold = null;
        completeStation(state, st.id);
      }
    } else decayHold(state, dt);
  } else {
    decayHold(state, dt);
    if (st && target.available && input.interactPressed) {
      faceToward(p, st);
      if (st.kind === "panel") openPanel(state, st.id);
      else completeStation(state, st.id);
    }
  }

  if (input.actionPressed) useHeatPack(state);
}

function faceToward(p, point) {
  p.facing = Math.atan2(point.y - p.y, point.x - p.x);
}

function decayHold(state, dt) {
  if (!state.hold) return;
  state.hold.t -= dt * 2;
  if (state.hold.t <= 0) state.hold = null;
}

function findTarget(state) {
  const p = state.player;
  let best = null;
  let bestScore = Infinity;
  for (const st of state.map.stations) {
    const d = Math.hypot(p.x - st.x, p.y - st.y);
    if (d > st.r) continue;
    const info = stationInfo(state, st);
    if (!info.visible) continue;
    const score = d - (info.available ? 10 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { type: "station", id: st.id, kind: st.kind, available: info.available, label: info.available ? info.label : info.locked };
    }
  }
  if (best) return best;
  for (const door of state.doors) {
    if (door.passable || door.id === "fridge") continue;
    if (doorDistance(state, door, p.x, p.y) > 1.6) continue;
    const label = TEXT.doors[door.id];
    if (!label) continue;
    const extra = door.id === "hatch" && state.flags.thaw > 0 ? ` · THAW ${Math.floor(state.flags.thaw * 100)}%` : "";
    return { type: "door", id: door.id, kind: "door", available: false, label: label + extra };
  }
  return null;
}

function useHeatPack(state) {
  const p = state.player;
  const H = CONFIG.heatPack;
  if (p.heatPacks <= 0) {
    say(state, TEXT.messages.noHeatpack, "warn");
    return;
  }
  p.heatPacks -= 1;
  p.warmth = Math.min(CONFIG.player.maxWarmth, p.warmth + H.warmth);
  state.heat.push({ id: "pack", x: p.x, y: p.y, r: H.radius, temp: H.temp, on: true, until: state.time + H.duration, follow: true });
  state.stats.heatPacksUsed += 1;
  say(state, TEXT.messages.heatpack, "good");
  emit(state, { type: "sound", cue: "cc_heatpack" });
  emit(state, { type: "effect", kind: "heatpack", x: p.x, y: p.y });
}

// ------------------------------------------------------------------ station effects

function completeStation(state, id) {
  const f = state.flags;
  const M = TEXT.messages;
  const st = station(state, id);
  f.done[id] = true;
  emit(state, { type: "station", id });
  if (id === "fridge") {
    f.fridgeOpened = true;
    say(state, M.fridgeOpen, "info");
    emit(state, { type: "sound", cue: "cc_fridge" });
    emit(state, { type: "effect", kind: "fog", x: 84.95, y: 3.6 });
  } else if (BREAKERS.includes(id)) {
    f.current = true;
    say(state, `${M.breaker} // ${id.slice(-1)}`, "good");
    emit(state, { type: "sound", cue: "cc_breaker" });
    emit(state, { type: "effect", kind: "sparks", x: st.x, y: st.y });
  } else if (VALVES.includes(id)) {
    say(state, `${M.valve} // ${countDone(state, VALVES)}/3`, "good");
    emit(state, { type: "sound", cue: "cc_valve" });
    emit(state, { type: "effect", kind: "shards", x: st.x, y: st.y });
  } else if (id === "chuck") {
    f.outpostFound = true;
    say(state, M.chuck, "good", { big: true });
    say(state, M.override, "info");
    say(state, M.heater, "good");
    emit(state, { type: "dialogue", speaker: TEXT.chuck.speaker, lines: TEXT.chuck.lines });
    emit(state, { type: "sound", cue: "cc_discovery" });
    setCheckpoint(state, "outpost");
  } else if (id === "locker") {
    f.lockerOpened = true;
    const p = state.player;
    p.heatPacks = Math.min(CONFIG.player.maxHeatPacks, p.heatPacks + 2);
    p.hp = Math.min(CONFIG.player.maxHp, p.hp + 35);
    say(state, M.locker, "good");
    emit(state, { type: "sound", cue: "cc_pickup" });
  } else if (LAMPS.includes(id)) {
    const lamp = state.heat.find((h) => h.id === id);
    if (lamp) lamp.on = true;
    say(state, M.lamp, "good");
    emit(state, { type: "sound", cue: "cc_lamp" });
    emit(state, { type: "effect", kind: "warm", x: st.x, y: st.y });
  } else if (COILS.includes(id)) {
    const n = countDone(state, COILS);
    say(state, `${M.coil} // ${n}/3`, "good");
    emit(state, { type: "sound", cue: "cc_coil" });
    emit(state, { type: "effect", kind: "coil", x: st.x, y: st.y });
    if (n === 3) f.coreStage = 1;
  }
}

function setCheckpoint(state, id) {
  if (state.checkpoint === id) return;
  state.checkpoint = id;
  state.stats.checkpoints += 1;
  say(state, TEXT.messages.checkpoint, "good");
  emit(state, { type: "checkpoint", id });
  emit(state, { type: "sound", cue: "cc_checkpoint" });
}

function checkpointAvailable(state, id) {
  const f = state.flags;
  if (id === "entry") return f.entered;
  if (id === "power") return f.powerRestored;
  if (id === "outpost") return f.outpostFound;
  return true;
}

// ------------------------------------------------------------------ repair panels

function openPanel(state, id) {
  const p = state.player;
  const f = state.flags;
  p.vx = 0;
  p.vy = 0;
  state.hold = null;
  const base = { id, t: 0, result: null, resultT: 0, flash: null, flashT: 0, armed: false, held: false };
  // Progress made before a panel was closed or interrupted is kept for the next attempt.
  const saved = (kind) => state.panelProgress[`${id}:${kind}`] ?? 0;
  if (id === "thermostat") {
    state.panel = { ...base, kind: "dial", value: state.setpoint, min: CONFIG.loop.min, max: CONFIG.loop.max, current: state.zones[ZONE_INDEX.PANTRY].temp };
  } else if (id === "mainbus") {
    const T = CONFIG.timing;
    const hits = saved("timing");
    state.panel = {
      ...base,
      kind: "timing",
      phase: 0,
      needle: 0,
      speed: T.speed + hits * T.speedUp,
      window: newWindow(state, Math.max(T.minWindow, T.window - hits * 0.03)),
      hits,
      need: T.need,
      cooldown: 0,
    };
  } else if (id === "compressor" || (id === "console" && f.coreStage === 1)) {
    const P = CONFIG.pressure;
    const locks = saved("pressure");
    state.panel = { ...base, kind: "pressure", value: 0.08, band: P.bands[Math.min(locks, P.bands.length - 1)], locks, need: P.need };
  } else if (id === "console" && f.coreStage === 2) {
    const B = CONFIG.balance;
    state.panel = { ...base, kind: "balance", value: B.start, drift: 0, band: B.band, inBand: saved("balance"), need: B.need };
  } else return;
  emit(state, { type: "panel", id, kind: state.panel.kind });
  emit(state, { type: "sound", cue: "cc_panel" });
}

function newWindow(state, width) {
  const a = 0.08 + state.random() * (0.84 - width);
  return [a, a + width];
}

function closePanel(state, reason = "closed") {
  const panel = state.panel;
  if (!panel) return;
  const progress = panel.kind === "timing" ? panel.hits : panel.kind === "pressure" ? panel.locks : panel.kind === "balance" ? panel.inBand * 0.5 : 0;
  state.panelProgress[`${panel.id}:${panel.kind}`] = panel.result ? 0 : progress;
  emit(state, { type: "panelClosed", id: panel.id, reason });
  state.panel = null;
}

function panelFlash(panel, kind) {
  panel.flash = kind;
  panel.flashT = 0.45;
}

function updatePanel(state, input, dt) {
  const panel = state.panel;
  const p = state.player;
  panel.t += dt;
  if (panel.flashT > 0) panel.flashT = Math.max(0, panel.flashT - dt);
  // Braking: the agent stops while working a panel.
  p.vx = 0;
  p.vy = 0;
  if (panel.result) {
    panel.resultT += dt;
    if (panel.resultT >= CONFIG.panelResult) closePanel(state, panel.result);
    return;
  }
  if (input.cancelPressed) {
    closePanel(state, "cancelled");
    return;
  }
  const primary = Boolean(input.interact || input.action);
  const pressed = Boolean(input.interactPressed || input.actionPressed);
  // A panel ignores the press that opened it: controls count once they are let go.
  if (!primary) panel.armed = true;

  if (panel.kind === "dial") {
    if (input.adjust) panel.value = clamp(panel.value + Math.sign(input.adjust), panel.min, panel.max);
    panel.current = state.zones[ZONE_INDEX.PANTRY].temp;
    if (pressed && panel.t > 0.05) confirmDial(state, panel);
  } else if (panel.kind === "timing") {
    const T = CONFIG.timing;
    panel.phase += dt * panel.speed;
    panel.needle = tri(panel.phase);
    panel.cooldown = Math.max(0, panel.cooldown - dt);
    if (pressed && panel.t > 0.05 && panel.cooldown <= 0) {
      panel.cooldown = T.cooldown;
      if (panel.needle >= panel.window[0] && panel.needle <= panel.window[1]) {
        panel.hits += 1;
        panelFlash(panel, "good");
        say(state, `${TEXT.messages.relayGood} // ${panel.hits}/${panel.need}`, "good");
        emit(state, { type: "sound", cue: "cc_relay" });
        if (panel.hits >= panel.need) finishPanel(state, panel);
        else {
          panel.window = newWindow(state, Math.max(T.minWindow, panel.window[1] - panel.window[0] - 0.03));
          panel.speed += T.speedUp;
        }
      } else {
        panelFlash(panel, "bad");
        say(state, TEXT.messages.relayFault, "bad");
        emit(state, { type: "sound", cue: "cc_fault" });
        emit(state, { type: "effect", kind: "sparks", x: p.x, y: p.y - 0.4 });
        hurt(state, T.faultDamage, "spark", { interrupt: false });
      }
    }
  } else if (panel.kind === "pressure") {
    const P = CONFIG.pressure;
    const holding = primary && panel.armed;
    if (holding) panel.value += (P.rise + panel.value * P.accel) * dt;
    else panel.value = Math.max(0.05, panel.value - P.bleed * dt);
    if (panel.value >= 1) {
      panel.value = 0.25;
      panel.armed = false;
      panelFlash(panel, "bad");
      say(state, TEXT.messages.overpressure, "bad");
      emit(state, { type: "sound", cue: "cc_overpressure" });
      emit(state, { type: "effect", kind: "steam", x: p.x, y: p.y });
      hurt(state, P.overDamage, "pressure", { interrupt: false });
    } else if (panel.held && !holding) {
      if (panel.value >= panel.band[0] && panel.value <= panel.band[1]) {
        panel.locks += 1;
        panelFlash(panel, "good");
        say(state, `${TEXT.messages.pressureLock} // ${panel.locks}/${panel.need}`, "good");
        emit(state, { type: "sound", cue: "cc_relay" });
        panel.value = 0.12;
        panel.band = P.bands[Math.min(panel.locks, P.bands.length - 1)];
        if (panel.locks >= panel.need) finishPanel(state, panel);
      } else panelFlash(panel, "miss");
    }
    panel.held = holding;
  } else if (panel.kind === "balance") {
    const B = CONFIG.balance;
    panel.drift = clamp(panel.drift + (state.random() - 0.5) * B.drift * dt, -B.maxDrift, B.maxDrift);
    const push = clamp(Number(input.adjustHeld) || 0, -1, 1) * B.push;
    panel.value = clamp(panel.value + (panel.drift + B.bias + push) * dt, B.min, B.max);
    if (panel.value >= panel.band[0] && panel.value <= panel.band[1]) panel.inBand += dt;
    else panel.inBand = Math.max(0, panel.inBand - dt * 0.6);
    if (panel.inBand >= panel.need) finishPanel(state, panel);
  }
}

function confirmDial(state, panel) {
  const f = state.flags;
  const M = TEXT.messages;
  state.setpoint = panel.value;
  f.thermostatUsed = true;
  f.done.thermostat = true;
  if (panel.value >= CONFIG.thaw.point) {
    f.setpointOk = true;
    say(state, `${M.tempShifted} // ${panel.value > 0 ? "+" : ""}${panel.value}°C`, "good");
  } else say(state, M.tempTooLow, "warn");
  emit(state, { type: "sound", cue: "cc_dial" });
  panel.result = "success";
  panelFlash(panel, "good");
}

function finishPanel(state, panel) {
  const f = state.flags;
  const M = TEXT.messages;
  panel.result = "success";
  f.done[panel.id] = true;
  if (panel.id === "mainbus") {
    f.powerRestored = true;
    say(state, M.power, "good", { big: true });
    emit(state, { type: "sound", cue: "cc_power" });
    emit(state, { type: "power" });
    setCheckpoint(state, "power");
  } else if (panel.id === "compressor") {
    f.coolingRepaired = true;
    say(state, M.cooling, "good", { big: true });
    say(state, M.hatchOpen, "info");
    say(state, M.freezerWakes, "warn");
    emit(state, { type: "sound", cue: "cc_cooling" });
  } else if (panel.id === "console" && panel.kind === "pressure") {
    f.coreStage = 2;
    say(state, M.corePressure, "good");
    emit(state, { type: "sound", cue: "cc_relay" });
  } else if (panel.id === "console" && panel.kind === "balance") {
    f.coreStage = 3;
    state.core.progress = 0;
    state.core.surgeT = 0;
    say(state, M.coreTemp, "good");
    say(state, M.coreHold, "warn", { big: true });
    emit(state, { type: "sound", cue: "cc_surge" });
  }
}

// ------------------------------------------------------------------ arriving somewhere

function arrive(state) {
  const p = state.player;
  const { map } = state;
  const zi = map.zoneAt(Math.floor(p.x), Math.floor(p.y));
  if (zi >= 0 && zi !== p.zone) {
    p.zone = zi;
    emit(state, { type: "zone", zone: state.zones[zi].id, name: state.zones[zi].name });
  }
  discover(state);

  for (const cp of map.checkpoints) {
    if (state.checkpoint === cp.id || !checkpointAvailable(state, cp.id)) continue;
    if (Math.hypot(p.x - cp.x, p.y - cp.y) <= 1.1) setCheckpoint(state, cp.id);
  }

  for (const item of state.pickups) {
    if (item.taken || Math.hypot(p.x - item.x, p.y - item.y) > 0.75) continue;
    if (item.kind === "heatpack") {
      if (p.heatPacks >= CONFIG.player.maxHeatPacks) continue;
      p.heatPacks += 1;
      say(state, TEXT.messages.heatpackPickup, "good");
    } else {
      if (p.hp >= CONFIG.player.maxHp) continue;
      p.hp = Math.min(CONFIG.player.maxHp, p.hp + 35);
      say(state, TEXT.messages.fieldkit, "good");
    }
    item.taken = true;
    emit(state, { type: "pickup", id: item.id, kind: item.kind });
    emit(state, { type: "sound", cue: "cc_pickup" });
  }

  for (const portal of map.portals) {
    if (state.flags.extracted) break;
    const door = doorState(state, portal.door);
    if (!door.passable) continue;
    if (!map.inRect(p.x, p.y, portal.rect)) continue;
    startTransition(state, portal);
    break;
  }
}

function discover(state) {
  const p = state.player;
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const zi = state.map.zoneAt(tx + dx, ty + dy);
      if (zi < 0 || state.discovered[zi]) continue;
      state.discovered[zi] = 1;
      emit(state, { type: "discover", zone: state.zones[zi].id });
    }
  }
}

function startTransition(state, portal) {
  const lift = portal.kind === "lift";
  state.transition = { portal: portal.id, kind: portal.kind, t: 0, dur: lift ? 1.6 : 1.1, swap: lift ? 0.8 : 0.5, swapped: false };
  state.panel = null;
  state.hold = null;
  state.player.vx = 0;
  state.player.vy = 0;
  emit(state, { type: "transition", kind: portal.kind, id: portal.id });
  emit(state, { type: "sound", cue: lift ? "cc_lift" : "cc_portal" });
}

function updateTransition(state, dt) {
  const tr = state.transition;
  const p = state.player;
  const f = state.flags;
  const M = TEXT.messages;
  tr.t += dt;
  if (!tr.swapped && tr.t >= tr.swap) {
    tr.swapped = true;
    const portal = state.map.portals.find((x) => x.id === tr.portal);
    p.x = portal.offsetX !== undefined ? clamp(p.x + portal.offsetX, portal.to.x - 0.55, portal.to.x + 0.55) : portal.to.x;
    p.y = portal.to.y;
    p.facing = portal.to.facing;
    p.felt = p.felt + (localTemp(state, p.x, p.y) - p.felt) * 0.35;
    p.zone = state.map.zoneAt(Math.floor(p.x), Math.floor(p.y));
    emit(state, { type: "zone", zone: state.zones[p.zone].id, name: state.zones[p.zone].name });
    emit(state, { type: "teleport", x: p.x, y: p.y });
    discover(state);
    if (portal.id === "intoFridge") {
      f.entered = true;
      say(state, M.entered, "info", { big: true });
      say(state, M.sealed, "warn");
      emit(state, { type: "sound", cue: "cc_slam" });
      setCheckpoint(state, "entry");
    } else if (portal.id === "liftUp") {
      f.liftArrived = true;
    } else if (portal.id === "outOfFridge") {
      f.extracted = true;
      state.completeT = 1.4;
    }
  }
  if (tr.t >= tr.dur) state.transition = null;
}

// ------------------------------------------------------------------ doors

function doorUnlocked(state, id) {
  const f = state.flags;
  switch (id) {
    case "fridge":
      return f.fridgeOpened;
    case "exit":
    case "liftCore":
      return f.coreStabilized;
    case "hatch":
      return f.thaw >= 1;
    case "freezerDoor":
      return f.powerRestored;
    case "maintHatch":
      return f.coolingRepaired;
    case "deepHatch":
      return f.outpostFound;
    case "liftPower":
      return f.liftArrived;
    default:
      return false;
  }
}

function updateDoors(state, dt) {
  const p = state.player;
  for (const door of state.doors) {
    if (!door.unlocked && doorUnlocked(state, door.id)) {
      door.unlocked = true;
      emit(state, { type: "doorUnlocked", id: door.id });
      if (door.id === "hatch") {
        say(state, TEXT.messages.thawed, "good");
        emit(state, { type: "sound", cue: "cc_thaw" });
        emit(state, { type: "effect", kind: "shards", x: 34.5, y: 48.5 });
      }
      if (door.id === "exit") say(state, TEXT.messages.exitOpen, "good");
      if (door.id === "liftCore") say(state, TEXT.messages.lift, "good");
    }
    if (!door.unlocked) continue;
    // Most doors open when the agent comes close and then stay open; the hatch breaks free and the
    // lifts open on arrival.
    const always = door.id === "fridge" || door.id === "hatch" || door.id === "liftPower";
    if (always || door.open > 0 || doorDistance(state, door, p.x, p.y) < 2.4) {
      if (door.open === 0 && !always) emit(state, { type: "sound", cue: "cc_door" });
      door.open = Math.min(1, door.open + dt * (door.id === "fridge" ? 1.6 : 2.8));
    }
    const threshold = door.kind === "fridge" || door.kind === "fridgeInner" ? 0.85 : 0.55;
    door.passable = door.open >= threshold;
  }
}

// ------------------------------------------------------------------ hazards and the core

function updateHazards(state, dt) {
  const p = state.player;
  const S = CONFIG.spark;
  const V = CONFIG.vent;
  for (const hz of state.hazards) {
    const cycle = (state.time + hz.phase) % hz.period;
    const index = Math.floor((state.time + hz.phase) / hz.period);
    let next = "idle";
    if (hz.kind === "spark") {
      if (!state.flags.current) {
        hz.state = "idle";
        continue;
      }
      if (cycle >= hz.period - S.arc) next = "arc";
      else if (cycle >= hz.period - S.arc - S.warn) next = "warn";
      if (next === "arc" && hz.state !== "arc") emit(state, { type: "hazard", kind: "spark", id: hz.id, x: hz.x + hz.w / 2, y: hz.y + 0.5 });
      hz.state = next;
      if (next === "arc" && hz.hit !== index) {
        const cx = clamp(p.x, hz.x, hz.x + hz.w);
        const cy = clamp(p.y, hz.y, hz.y + hz.h);
        if (Math.hypot(p.x - cx, p.y - cy) < p.r) {
          hz.hit = index;
          const dir = p.y < hz.y + 0.5 ? -1 : 1;
          if (hurt(state, S.damage, "spark", { knockX: 0, knockY: dir * CONFIG.contact.knock })) say(state, TEXT.messages.spark, "bad");
        }
      }
    } else {
      if (cycle >= hz.period - V.blast) next = "blast";
      else if (cycle >= hz.period - V.blast - V.charge) next = "charge";
      if (next === "blast" && hz.state !== "blast") emit(state, { type: "hazard", kind: "vent", id: hz.id, x: hz.x, y: hz.y });
      hz.state = next;
      if (next === "blast" && hz.hit !== index && Math.hypot(p.x - hz.x, p.y - hz.y) < hz.r + p.r) {
        hz.hit = index;
        p.warmth = Math.max(0, p.warmth - V.warmth);
        p.slowUntil = state.time + V.slow;
        if (hurt(state, V.damage, "vent")) say(state, TEXT.messages.vent, "bad");
      }
    }
  }
}

function updateCore(state, dt) {
  const f = state.flags;
  if (f.coreStage !== 3) return;
  const C = CONFIG.core;
  const p = state.player;
  const d = Math.hypot(p.x - CORE_CENTER.x, p.y - CORE_CENTER.y);
  if (d <= C.ring) state.core.progress = Math.min(1, state.core.progress + dt / C.hold);
  state.core.surgeT += dt;
  if (state.core.surgeT >= C.surgeEvery) {
    state.core.surgeT = 0;
    state.core.surges.push({ r: C.surgeStart, hit: false });
    emit(state, { type: "sound", cue: "cc_surge" });
  }
  for (const s of state.core.surges) {
    const before = s.r;
    s.r += C.surgeSpeed * dt;
    if (!s.hit && before < d && s.r >= d) {
      s.hit = true;
      const shielded = inHeat(state, p.x, p.y);
      p.warmth = Math.max(0, p.warmth - (shielded ? C.surgeWarmth / 3 : C.surgeWarmth));
      if (!shielded) hurt(state, C.surgeDamage, "surge", { interrupt: false });
      emit(state, { type: "effect", kind: "surgeHit", x: p.x, y: p.y });
    }
  }
  state.core.surges = state.core.surges.filter((s) => s.r < C.surgeMax);
  if (state.core.progress >= 1) {
    f.coreStage = 4;
    f.coreStabilized = true;
    f.done.core = true;
    state.core.surges = [];
    say(state, TEXT.messages.coreDone, "good");
    say(state, TEXT.messages.stabilized, "good", { big: true });
    emit(state, { type: "sound", cue: "cc_stabilized" });
    emit(state, { type: "stabilized" });
  }
}

// ------------------------------------------------------------------ damage, down and respawn

/** Damages the agent. Returns false if nothing happened (invulnerable, not playing, no damage). */
function hurt(state, amount, source, { knockX = 0, knockY = 0, interrupt = true, ignoreIframes = false } = {}) {
  const p = state.player;
  if (state.phase !== "PLAYING" || state.transition || amount <= 0) return false;
  if (p.iframes > 0 && !ignoreIframes) return false;
  p.hp = Math.max(0, p.hp - amount);
  if (!ignoreIframes) p.iframes = CONFIG.contact.iframes;
  p.lastHurt = state.time;
  p.vx += knockX;
  p.vy += knockY;
  state.stats.damage += amount;
  if (interrupt) {
    if (state.panel && !state.panel.result) closePanel(state, "interrupted");
    if (state.hold) state.hold.t *= 0.5;
  }
  emit(state, { type: "hurt", amount, source, x: p.x, y: p.y });
  if (p.hp <= 0) down(state);
  return true;
}

function down(state) {
  const p = state.player;
  state.phase = "DOWNED";
  state.downT = CONFIG.respawn.downTime;
  state.stats.downs += 1;
  closePanel(state, "down");
  state.hold = null;
  p.vx = 0;
  p.vy = 0;
  say(state, TEXT.messages.down, "bad");
  emit(state, { type: "phase", phase: "DOWNED" });
  emit(state, { type: "sound", cue: "cc_down" });
}

function updateDowned(state, dt) {
  state.downT -= dt;
  if (state.downT > 0) return;
  const R = CONFIG.respawn;
  const p = state.player;
  const cp = state.map.checkpoints.find((c) => c.id === state.checkpoint);
  p.x = cp.x;
  p.y = cp.y;
  p.vx = 0;
  p.vy = 0;
  p.hp = R.hp;
  p.warmth = Math.max(p.warmth, R.warmth);
  p.felt = localTemp(state, p.x, p.y);
  p.iframes = R.iframes;
  p.slowUntil = -99;
  p.zone = state.map.zoneAt(Math.floor(p.x), Math.floor(p.y));
  for (const t of state.threats) resetThreat(state, t);
  state.core.surges = [];
  state.phase = "PLAYING";
  say(state, TEXT.messages.respawn, "info", { big: true });
  emit(state, { type: "phase", phase: "PLAYING" });
  emit(state, { type: "teleport", x: p.x, y: p.y });
}

function resetThreat(state, t) {
  t.x = t.homeX;
  t.y = t.homeY;
  t.vx = 0;
  t.vy = 0;
  t.mode = "idle";
  t.modeT = 0;
  t.cooldown = 1;
  t.contactCooldown = 1;
}

function updateVitals(state, dt) {
  const p = state.player;
  const C = CONFIG.cold;
  const M = TEXT.messages;
  p.iframes = Math.max(0, p.iframes - dt);
  const target = localTemp(state, p.x, p.y);
  p.felt += (target - p.felt) * (1 - Math.exp(-dt * CONFIG.temp.feltRate));
  let rate = 0;
  if (p.felt < C.neutralLow) rate = (p.felt - C.neutralLow) * C.drain;
  else if (p.felt > C.neutralHigh) rate = Math.min(C.maxGain, (p.felt - C.neutralHigh) * C.gain);
  p.warmth = clamp(p.warmth + rate * dt, 0, CONFIG.player.maxWarmth);

  if (p.warmth < C.slowBelow && !p.warnedLow) {
    p.warnedLow = true;
    say(state, M.lowWarmth, "warn");
  } else if (p.warmth > 50) p.warnedLow = false;

  if (p.warmth <= 0) {
    if (!p.warnedHypo) {
      p.warnedHypo = true;
      say(state, M.hypothermia, "bad");
    }
    if (!state.transition) {
      p.hp = Math.max(0, p.hp - C.hypothermia * dt);
      state.stats.damage += C.hypothermia * dt;
      p.lastHurt = state.time;
      if (p.hp <= 0) down(state);
    }
  } else if (p.warmth > 20) p.warnedHypo = false;

  const zone = state.zones[p.zone];
  const safe = zone.safe || (zone.id === "OUTPOST" && state.flags.outpostFound);
  if (safe && state.time - p.lastHurt > 2 && p.hp < CONFIG.player.maxHp) p.hp = Math.min(CONFIG.player.maxHp, p.hp + CONFIG.safeRegen * dt);
}

// ------------------------------------------------------------------ food threats

function threatSolid(state, t, avoidWarm) {
  return (tx, ty) => {
    if (tileSolid(state, tx, ty)) return true;
    if (state.map.zoneAt(tx, ty) !== t.leash) return true;
    return avoidWarm && localTemp(state, tx + 0.5, ty + 0.5) > CONFIG.icecream.hardBelow;
  };
}

/** Chase field toward the agent for one leash zone, refreshed a few times a second. */
function chaseField(state, leash, avoidWarm) {
  const p = state.player;
  const gx = Math.floor(p.x);
  const gy = Math.floor(p.y);
  const key = `${leash}:${avoidWarm ? 1 : 0}`;
  const cached = state.fields.get(key);
  if (cached && cached.gx === gx && cached.gy === gy && state.time - cached.t < 0.35) return cached.dist;
  const passable = (tx, ty) => {
    if (tx === gx && ty === gy) return true;
    if (tileSolid(state, tx, ty) || state.map.zoneAt(tx, ty) !== leash) return false;
    return !avoidWarm || localTemp(state, tx + 0.5, ty + 0.5) <= CONFIG.icecream.hardBelow;
  };
  const dist = distanceField(state, gx, gy, passable);
  state.fields.set(key, { gx, gy, t: state.time, dist });
  return dist;
}

function homeField(state, t) {
  if (!t.homeField) {
    const passable = (tx, ty) => !tileSolid(state, tx, ty) && state.map.zoneAt(tx, ty) === t.leash;
    t.homeField = distanceField(state, Math.floor(t.homeX), Math.floor(t.homeY), passable);
  }
  return t.homeField;
}

/** Direction (unit vector) one step down a distance field from the threat's tile. */
function fieldStep(state, t, dist, goalX, goalY) {
  const { w } = state.map;
  const tx = Math.floor(t.x);
  const ty = Math.floor(t.y);
  const here = dist[ty * w + tx];
  if (here <= 1) {
    const dx = goalX - t.x;
    const dy = goalY - t.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }
  let best = here < 0 ? 32767 : here;
  let bx = 0;
  let by = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const d = dist[(ty + dy) * w + tx + dx];
      if (d < 0 || d >= best) continue;
      if (dx && dy && (dist[ty * w + tx + dx] < 0 || dist[(ty + dy) * w + tx] < 0)) continue;
      best = d;
      bx = dx;
      by = dy;
    }
  }
  if (!bx && !by) return null;
  const cx = tx + bx + 0.5 - t.x;
  const cy = ty + by + 0.5 - t.y;
  const d = Math.hypot(cx, cy) || 1;
  return { x: cx / d, y: cy / d };
}

function steer(t, dir, speed, dt, accel = 12) {
  const tvx = dir ? dir.x * speed : 0;
  const tvy = dir ? dir.y * speed : 0;
  const k = Math.min(1, accel * dt);
  t.vx += (tvx - t.vx) * k;
  t.vy += (tvy - t.vy) * k;
  if (dir && speed > 0.1) t.facing = Math.atan2(t.vy, t.vx);
}

function updateThreats(state, dt) {
  const p = state.player;
  const playing = state.phase === "PLAYING" && !state.transition;
  for (const t of state.threats) {
    t.modeT += dt;
    t.cooldown = Math.max(0, t.cooldown - dt);
    t.contactCooldown = Math.max(0, t.contactCooldown - dt);
    t.curiousRest = Math.max(0, t.curiousRest - dt);
    t.temp = localTemp(state, t.x, t.y);
    const engaged = playing && p.zone === t.leash;
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const dist = Math.hypot(dx, dy);
    if (t.kind === "milk") updateMilk(state, t, engaged, dist, dt);
    else updateIceCream(state, t, engaged, dist, dt);

    const avoidWarm = t.kind === "icecream" && t.temper === "HARD";
    const moved = moveCircle(state, t, t.vx * dt, t.vy * dt, threatSolid(state, t, avoidWarm));
    if (t.mode === "lunge" && moved < 0.35 && t.modeT > 0.06) {
      t.mode = "stun";
      t.modeT = 0;
      t.vx = 0;
      t.vy = 0;
      emit(state, { type: "effect", kind: "shards", x: t.x, y: t.y });
      emit(state, { type: "sound", cue: "cc_crack" });
    }

    if (!playing || t.contactCooldown > 0) continue;
    const reach = t.r + p.r - 0.04;
    if (dist < reach) {
      const damage = contactDamage(t);
      if (damage <= 0) continue;
      const nx = dist > 1e-6 ? dx / dist : 0;
      const ny = dist > 1e-6 ? dy / dist : 1;
      const soft = t.kind === "icecream" && t.temper === "SOFT";
      const knock = t.mode === "lunge" ? CONFIG.contact.lungeKnock : soft ? CONFIG.contact.knock * 0.5 : CONFIG.contact.knock;
      if (hurt(state, damage, t.kind, { knockX: nx * knock, knockY: ny * knock })) {
        // Melting ice cream is sticky rather than dangerous: it slows you down.
        if (soft) p.slowUntil = Math.max(p.slowUntil, state.time + CONFIG.icecream.stickySlow);
        t.contactCooldown = CONFIG.contact.cooldown * (t.temper === "SOFT" ? 1.6 : 1);
        say(state, `${TEXT.messages.contact} // -${damage}`, "bad");
        emit(state, { type: "effect", kind: t.kind === "milk" ? "splat" : "shards", x: p.x, y: p.y });
        // A hit is followed by a beat where the threat backs off, so contact never chains.
        if (t.mode === "lunge") {
          t.lungeHit = true;
        } else {
          setMode(t, "backoff");
          t.vx = -nx * 1.5;
          t.vy = -ny * 1.5;
          t.cooldown = Math.max(t.cooldown, 0.9);
        }
      }
    }
  }
  // Keep them from stacking on one spot.
  const list = state.threats;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.leash !== b.leash) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d >= min || d < 1e-6) continue;
      const push = (min - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      moveCircle(state, a, -nx * push, -ny * push, threatSolid(state, a, false));
      moveCircle(state, b, nx * push, ny * push, threatSolid(state, b, false));
    }
  }
}

function contactDamage(t) {
  const M = CONFIG.milk;
  const I = CONFIG.icecream;
  if (t.mode === "backoff") return 0;
  if (t.kind === "milk") return t.temper === "FROZEN" ? 0 : t.temper === "SPOILED" ? M.huntDamage : t.mode === "curious" ? M.lurkDamage : 0;
  if (t.temper === "SOFT") return t.mode === "idle" ? 0 : I.softDamage;
  if (t.mode === "lunge") return t.lungeHit ? 0 : I.lungeDamage;
  if (t.mode === "stun" || t.mode === "recover" || t.mode === "idle" || t.mode === "return" || t.mode === "backoff") return 0;
  return I.bumpDamage;
}

function setMode(t, mode) {
  if (t.mode === mode) return;
  t.mode = mode;
  t.modeT = 0;
}

function wander(state, t, speed, dt) {
  t.wanderT -= dt;
  if (t.wanderT <= 0 || Math.hypot(t.wanderX - t.x, t.wanderY - t.y) < 0.3) {
    t.wanderT = 2 + state.random() * 2.5;
    for (let tries = 0; tries < 8; tries++) {
      const wx = t.homeX + (state.random() - 0.5) * 5;
      const wy = t.homeY + (state.random() - 0.5) * 5;
      if (!threatSolid(state, t, false)(Math.floor(wx), Math.floor(wy)) && lineOfSight(state, t.x, t.y, wx, wy)) {
        t.wanderX = wx;
        t.wanderY = wy;
        break;
      }
    }
  }
  const dx = t.wanderX - t.x;
  const dy = t.wanderY - t.y;
  const d = Math.hypot(dx, dy);
  steer(t, d > 0.2 ? { x: dx / d, y: dy / d } : null, speed, dt, 6);
}

function goHome(state, t, speed, dt) {
  const d = Math.hypot(t.homeX - t.x, t.homeY - t.y);
  if (d < 0.4) {
    steer(t, null, 0, dt);
    return true;
  }
  steer(t, fieldStep(state, t, homeField(state, t), t.homeX, t.homeY), speed, dt);
  return false;
}

function chase(state, t, speed, dt, avoidWarm) {
  const p = state.player;
  let dir;
  if (Math.hypot(p.x - t.x, p.y - t.y) < 4.5 && lineOfSight(state, t.x, t.y, p.x, p.y)) {
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const d = Math.hypot(dx, dy) || 1;
    dir = { x: dx / d, y: dy / d };
  } else dir = fieldStep(state, t, chaseField(state, t.leash, avoidWarm), p.x, p.y);
  steer(t, dir, speed, dt);
}

function updateMilk(state, t, engaged, dist, dt) {
  const M = CONFIG.milk;
  const temper = t.temp < M.frozenBelow ? "FROZEN" : t.temp > M.spoilAbove ? "SPOILED" : "AWAKE";
  if (temper !== t.temper) {
    const before = t.temper;
    t.temper = temper;
    if (temper === "AWAKE" && before === "FROZEN") say(state, TEXT.messages.milkWakes, "warn", { once: "milkWakes" });
    if (temper === "SPOILED") {
      state.stats.spoiled = true;
      say(state, TEXT.messages.milkSpoils, "bad", { once: "milkSpoils" });
      emit(state, { type: "sound", cue: "cc_spoil" });
    }
    emit(state, { type: "threatTemper", id: t.id, temper });
  }
  if (temper === "FROZEN") {
    setMode(t, "idle");
    steer(t, null, 0, dt, 20);
    return;
  }
  if (t.mode === "backoff") {
    steer(t, null, 0, dt, 3);
    if (t.modeT >= M.backoff) setMode(t, "idle");
    return;
  }
  const p = state.player;
  if (temper === "SPOILED") {
    if (engaged && dist < M.huntRange) {
      setMode(t, "chase");
      noteThreat(state, t);
      chase(state, t, M.hunt, dt, false);
    } else {
      setMode(t, "return");
      if (goHome(state, t, M.wander * 1.5, dt)) setMode(t, "idle");
    }
    return;
  }
  // Awake: harmless unless you get close, then curious for a moment.
  if (t.mode === "curious") {
    if (!engaged || t.modeT > M.curiousTime) {
      setMode(t, "idle");
      t.curiousRest = M.curiousRest;
    } else {
      chase(state, t, M.curious, dt, false);
      return;
    }
  }
  if (engaged && t.curiousRest <= 0 && dist < M.curiousRange && lineOfSight(state, t.x, t.y, p.x, p.y)) {
    setMode(t, "curious");
    noteThreat(state, t);
    return;
  }
  setMode(t, "idle");
  wander(state, t, M.wander, dt);
}

function updateIceCream(state, t, engaged, dist, dt) {
  const I = CONFIG.icecream;
  const temper = t.temp <= I.hardBelow ? "HARD" : "SOFT";
  if (temper !== t.temper) {
    t.temper = temper;
    emit(state, { type: "threatTemper", id: t.id, temper });
    if (temper === "SOFT" && (t.mode === "windup" || t.mode === "lunge")) setMode(t, "idle");
  }
  const p = state.player;
  if (t.mode === "backoff") {
    steer(t, null, 0, dt, 3);
    if (t.modeT >= I.backoff) setMode(t, "idle");
    return;
  }
  if (temper === "SOFT") {
    // Melting: back away from any heat source, otherwise crawl toward the agent.
    const heat = state.heat.find((h) => h.on && Math.hypot(t.x - h.x, t.y - h.y) < h.r + 0.8);
    if (heat) {
      const dx = t.x - heat.x;
      const dy = t.y - heat.y;
      const d = Math.hypot(dx, dy) || 1;
      setMode(t, "flee");
      steer(t, { x: dx / d, y: dy / d }, I.crawl * 1.4, dt);
    } else if (engaged && dist < I.crawlRange) {
      setMode(t, "crawl");
      noteThreat(state, t);
      chase(state, t, I.crawl, dt, false);
    } else {
      setMode(t, "idle");
      if (!goHome(state, t, I.crawl, dt)) setMode(t, "return");
    }
    return;
  }
  switch (t.mode) {
    case "windup":
      steer(t, null, 0, dt, 30);
      if (t.modeT >= I.windup) {
        setMode(t, "lunge");
        t.lungeHit = false;
        t.vx = t.aimX * I.lunge;
        t.vy = t.aimY * I.lunge;
        emit(state, { type: "sound", cue: "cc_lunge" });
      }
      return;
    case "lunge":
      t.vx = t.aimX * I.lunge;
      t.vy = t.aimY * I.lunge;
      if (t.modeT >= I.lungeTime) {
        setMode(t, "recover");
        t.cooldown = I.cooldown;
      }
      return;
    case "stun":
      steer(t, null, 0, dt, 20);
      if (t.modeT >= I.stun) {
        setMode(t, "idle");
        t.cooldown = I.cooldown;
      }
      return;
    case "recover":
      steer(t, null, 0, dt, 10);
      if (t.modeT >= I.recover) setMode(t, "idle");
      return;
    default:
      break;
  }
  if (engaged && dist < I.huntRange) {
    setMode(t, "chase");
    noteThreat(state, t);
    if (dist < I.lungeRange && t.cooldown <= 0 && lineOfSight(state, t.x, t.y, p.x, p.y)) {
      const d = dist || 1;
      t.aimX = (p.x - t.x) / d;
      t.aimY = (p.y - t.y) / d;
      t.facing = Math.atan2(t.aimY, t.aimX);
      setMode(t, "windup");
      emit(state, { type: "sound", cue: "cc_windup" });
      return;
    }
    chase(state, t, I.hunt, dt, true);
  } else {
    setMode(t, "return");
    if (goHome(state, t, I.hunt * 0.6, dt)) setMode(t, "idle");
  }
}

function noteThreat(state, t) {
  if (state.stats.threats[t.kind]) return;
  state.stats.threats[t.kind] = true;
  emit(state, { type: "threatSeen", kind: t.kind, id: t.id });
}

// ------------------------------------------------------------------ objective

function updateObjective(state) {
  let moved = false;
  while (state.objective < OBJECTIVES.length && OBJECTIVES[state.objective].done(state)) {
    state.objective += 1;
    moved = true;
  }
  if (moved) emit(state, { type: "objective", id: OBJECTIVES[state.objective]?.id ?? "COMPLETE" });
}

/** A summary for the debrief screen. */
export function debrief(state) {
  const s = state.stats;
  return {
    time: state.missionTime,
    downs: s.downs,
    damage: Math.round(s.damage),
    heatPacksUsed: s.heatPacksUsed,
    spoiled: s.spoiled,
    threats: Object.keys(s.threats),
    technician: state.flags.outpostFound,
    setpoint: state.setpoint,
    // [system, done, what "done" is called for it]
    systems: [
      ["STORAGE TEMPERATURE", state.flags.setpointOk, "ADJUSTED"],
      ["MAIN POWER", state.flags.powerRestored, "RESTORED"],
      ["COOLING ARRAY", state.flags.coolingRepaired, "RESTORED"],
      ["MISSING TECHNICIAN", state.flags.outpostFound, "LOCATED"],
      ["REFRIGERATOR CORE", state.flags.coreStabilized, "STABILIZED"],
    ],
  };
}
