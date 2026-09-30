// CPI: Cold Case, the top-down browser mission: the map holds together, movement and temperature
// behave, every gate opens for the right reason, and the whole loop — briefing to debrief — can be
// finished through the real rules by a scripted agent. Browser code, run here without a browser:
// the simulation has no DOM.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMap, ZONE_INDEX } from "../public/js/coldcase/map.js";
import {
  beginMission,
  CONFIG,
  createGame,
  debrief,
  doorState,
  drainEvents,
  localTemp,
  NO_INPUT,
  OBJECTIVES,
  objectiveInfo,
  routeTo,
  stepGame,
  tileSolid,
  zoneId,
  type GameState,
  type Input,
} from "../public/js/coldcase/sim.js";
import { createBot } from "../public/js/coldcase/bot.js";
import { TEXT } from "../public/js/coldcase/content.js";

const DT = 1 / 60;

function game(seed = 1): GameState {
  return createGame({ seed, skipBriefing: true });
}

function run(state: GameState, seconds: number, input: Partial<Input> = {}) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) stepGame(state, { ...NO_INPUT, ...input }, DT);
}

function tap(state: GameState, input: Partial<Input>) {
  stepGame(state, { ...NO_INPUT, ...input }, DT);
  stepGame(state, NO_INPUT, DT);
}

function place(state: GameState, x: number, y: number) {
  const p = state.player;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.zone = state.map.zoneAt(Math.floor(x), Math.floor(y));
}

function playThrough(seed: number, limit = 900) {
  const state = createGame({ seed });
  assert.equal(state.phase, "BRIEFING");
  beginMission(state);
  const bot = createBot();
  const objectives: string[] = [];
  while ((state.phase as string) !== "COMPLETE" && state.missionTime < limit) {
    stepGame(state, bot.next(state), DT);
    for (const e of drainEvents(state)) if (e.type === "objective") objectives.push(String(e.id));
  }
  return { state, objectives };
}

describe("Cold Case map", () => {
  const map = buildMap();
  const walkable = (x: number, y: number) => {
    const i = y * map.w + x;
    return map.floor[i] === 1 && map.block[i] === 0;
  };

  it("puts every station, checkpoint, pickup and threat on open floor in its zone", () => {
    const things = [
      ...map.stations.map((s) => ({ what: `station ${s.id}`, x: s.x, y: s.y, zone: s.zone })),
      ...map.checkpoints.map((c) => ({ what: `checkpoint ${c.id}`, x: c.x, y: c.y, zone: c.zone })),
      ...map.threats.map((t) => ({ what: `threat ${t.id}`, x: t.x, y: t.y, zone: t.leash })),
      ...map.pickups.map((p) => ({ what: `pickup ${p.id}`, x: p.x, y: p.y, zone: null })),
    ];
    for (const t of things) {
      const tx = Math.floor(t.x);
      const ty = Math.floor(t.y);
      assert.ok(walkable(tx, ty), `${t.what} at ${t.x},${t.y} is on open floor`);
      if (t.zone) assert.equal(map.zones[map.zoneAt(tx, ty)]?.id, t.zone, `${t.what} is in ${t.zone}`);
    }
  });

  it("connects every interior zone once the doors are open, and keeps the kitchen apart", () => {
    const state = game();
    for (const d of state.doors) {
      if (d.id === "kitchenDoor" || d.id === "fridge") continue;
      d.unlocked = true;
      d.passable = true;
      d.open = 1;
    }
    // Start just inside the refrigerator entry.
    const seen = new Set<number>();
    const queue: [number, number][] = [[14, 47]];
    const reached = new Set<string>();
    while (queue.length) {
      const [x, y] = queue.pop()!;
      const i = y * map.w + x;
      if (seen.has(i) || tileSolid(state, x, y)) continue;
      seen.add(i);
      reached.add(map.zones[map.zoneAt(x, y)]!.id);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (const z of map.zones) {
      if (z.id === "KITCHEN") assert.ok(!reached.has(z.id), "the kitchen is only reachable through the fridge");
      else assert.ok(reached.has(z.id), `${z.id} is reachable`);
    }
  });

  it("puts every door in a wall gap between two walkable tiles", () => {
    for (const d of map.doors) {
      // The fridge doors are portals and the kitchen's own door is scenery: nothing behind them.
      if (d.kind === "fridge" || d.kind === "fridgeInner" || d.kind === "sealed") continue;
      const horizontal = d.w > d.h;
      const a = horizontal ? [d.x, d.y - 1] : [d.x - 1, d.y];
      const b = horizontal ? [d.x, d.y + d.h] : [d.x + d.w, d.y];
      assert.ok(walkable(a[0]!, a[1]!) && walkable(b[0]!, b[1]!), `${d.id} joins two floors`);
    }
  });

  it("keeps the kitchen far from the interior so the camera never shows both", () => {
    const kitchen = map.rooms[ZONE_INDEX["KITCHEN"]!]!.rects[0]!;
    for (const room of map.rooms) {
      if (room.id === "KITCHEN") continue;
      for (const [x, y, w, h] of room.rects) {
        const gapX = Math.max(0, kitchen[0] - (x + w), x - (kitchen[0] + kitchen[2]));
        const gapY = Math.max(0, kitchen[1] - (y + h), y - (kitchen[1] + kitchen[3]));
        assert.ok(Math.max(gapX, gapY) >= 20, `${room.id} is at least 20 m from the kitchen`);
      }
    }
  });
});

describe("Cold Case movement", () => {
  it("never makes diagonal movement faster than straight movement", () => {
    const straight = game();
    const diagonal = game();
    straight.threats = [];
    diagonal.threats = [];
    place(straight, 87.5, 5.5);
    place(diagonal, 87.5, 5.5);
    run(straight, 0.4, { moveX: 1 });
    run(diagonal, 0.4, { moveX: 1, moveY: 1 });
    const vs = Math.hypot(straight.player.vx, straight.player.vy);
    const vd = Math.hypot(diagonal.player.vx, diagonal.player.vy);
    assert.ok(Math.abs(vs - CONFIG.player.speed) < 1e-6, `straight speed ${vs}`);
    assert.ok(Math.abs(vd - vs) < 1e-6, `diagonal speed ${vd} equals straight ${vs}`);
    const ds = Math.hypot(straight.player.x - 87.5, straight.player.y - 5.5);
    const dd = Math.hypot(diagonal.player.x - 87.5, diagonal.player.y - 5.5);
    assert.ok(Math.abs(ds - dd) < 1e-6, `same distance covered (${ds} vs ${dd})`);
  });

  it("accelerates and stops smoothly rather than instantly", () => {
    const state = game();
    place(state, 87.5, 6.5);
    run(state, DT, { moveX: 1 });
    const first = state.player.vx;
    assert.ok(first > 0 && first < CONFIG.player.speed, "does not jump to full speed");
    run(state, 0.5, { moveX: 1 });
    run(state, DT);
    assert.ok(state.player.vx > 0 && state.player.vx < CONFIG.player.speed, "does not stop dead");
    run(state, 0.5);
    assert.equal(state.player.vx, 0);
  });

  it("stops at walls", () => {
    const state = game();
    place(state, 80.5, 12);
    run(state, 3, { moveY: 1 });
    assert.ok(state.player.y < 14 - state.player.r + 1e-6, "the kitchen's south wall holds");
    assert.equal(zoneId(state), "KITCHEN");
  });

  it("slides on ice", () => {
    const dry = game();
    const icy = game();
    dry.threats = [];
    icy.threats = [];
    place(dry, 53.5, 38.5); // freezer floor
    place(icy, 57.5, 44.5); // freezer ice patch
    run(dry, 0.5, { moveX: 1 });
    run(icy, 0.5, { moveX: 1 });
    const x0 = dry.player.x;
    const x1 = icy.player.x;
    run(dry, 0.4);
    run(icy, 0.4);
    assert.ok(icy.player.x - x1 > (dry.player.x - x0) * 2, "coasts much further after letting go on ice");
  });
});

describe("Cold Case temperature", () => {
  it("changes the felt temperature gradually between zones", () => {
    const state = game();
    assert.equal(Math.round(state.player.felt), 21);
    place(state, 12.5, 47.5); // refrigerator entry, 5 °C
    run(state, 0.5);
    assert.ok(state.player.felt < 21 && state.player.felt > 12, `felt ${state.player.felt} is part way`);
    run(state, 6);
    assert.ok(Math.abs(state.player.felt - 5) < 0.5, `settles near 5 °C (${state.player.felt})`);
  });

  it("drains warmth in the deep interior, then health — but slowly enough to explore", () => {
    const state = game();
    state.threats = [];
    place(state, 36.5, 79.5);
    let t = 0;
    while (state.player.warmth > 0 && t < 120) {
      run(state, 0.5);
      t += 0.5;
    }
    assert.ok(t >= 20 && t <= 40, `warmth lasts ${t} s at -24 °C`);
    const hp = state.player.hp;
    run(state, 10);
    assert.ok(state.player.hp < hp && state.player.hp > 60, `hypothermia takes health slowly (${state.player.hp})`);
  });

  it("keeps warmth in mild rooms and restores it in warm ones", () => {
    const state = game();
    place(state, 12.5, 47.5);
    state.player.warmth = 60;
    run(state, 10);
    assert.ok(state.player.warmth >= 60, "no drain at +5 °C");
    place(state, 80.5, 11.5);
    run(state, 5);
    assert.ok(state.player.warmth > 95, "the kitchen warms you back up");
  });

  it("warms the area around a heat lamp once it is switched on", () => {
    const state = game();
    state.threats = [];
    const lamp = state.map.stations.find((s) => s.id === "lamp1")!;
    place(state, lamp.x, lamp.y + 0.3);
    const cold = localTemp(state, lamp.x, lamp.y);
    run(state, 1, { interact: true });
    assert.ok(state.flags.done.lamp1, "hold E switches it on");
    assert.ok(localTemp(state, lamp.x, lamp.y) > cold + 20, "the lamp's core is warm");
    state.player.warmth = 20;
    run(state, 6);
    assert.ok(state.player.warmth > 50, `warmth recovers at the lamp (${state.player.warmth})`);
  });
});

describe("Cold Case food storage thermostat", () => {
  function setThermostat(state: GameState, value: number) {
    state.flags.fridgeOpened = true;
    state.flags.entered = true;
    const st = state.map.stations.find((s) => s.id === "thermostat")!;
    place(state, st.x, st.y + 0.4);
    tap(state, { interact: true, interactPressed: true });
    assert.equal(state.panel?.kind, "dial");
    while (state.panel!.value !== value) tap(state, { adjust: state.panel!.value < value ? 1 : -1 });
    tap(state, { interactPressed: true, interact: true });
    assert.equal(state.setpoint, value);
  }

  it("thaws the power room hatch when set above the thaw point", () => {
    const state = game();
    setThermostat(state, 4);
    assert.ok(state.flags.setpointOk);
    let t = 0;
    while (!doorState(state, "hatch")!.unlocked && t < 30) {
      run(state, 0.25);
      t += 0.25;
    }
    assert.ok(t > 3 && t < 15, `hatch thaws in ${t} s`);
    for (const m of state.threats.filter((x) => x.kind === "milk")) assert.equal(m.temper, "AWAKE");
  });

  it("leaves the hatch frozen when set too cold", () => {
    const state = game();
    setThermostat(state, -8);
    assert.ok(!state.flags.setpointOk);
    run(state, 30);
    assert.ok(!doorState(state, "hatch")!.unlocked);
    assert.equal(objectiveInfo(state).text, TEXT.objectives.ADJUST_TEMP_LOW);
    for (const m of state.threats.filter((x) => x.kind === "milk")) assert.equal(m.temper, "FROZEN");
  });

  it("spoils the milk when food storage is warmed too far", () => {
    const state = game();
    setThermostat(state, 12);
    run(state, 15);
    const milk = state.threats.filter((x) => x.kind === "milk");
    assert.ok(milk.every((m) => m.temper === "SPOILED"));
    assert.ok(state.stats.spoiled);
  });

  it("does not hurt anyone while the milk is frozen", () => {
    const state = game();
    const milk = state.threats.find((x) => x.kind === "milk")!;
    state.flags.entered = true;
    place(state, milk.x + 0.1, milk.y);
    run(state, 3);
    assert.equal(state.player.hp, 100);
  });
});

describe("Cold Case gates", () => {
  it("keeps the freezer door shut until power is restored", () => {
    const state = game();
    state.threats = [];
    place(state, 47.5, 43.5);
    run(state, 3, { moveX: 1 });
    assert.equal(zoneId(state), "CENTRAL");
    assert.ok(!doorState(state, "freezerDoor")!.passable);
    state.flags.powerRestored = true;
    run(state, 3, { moveX: 1 });
    assert.equal(zoneId(state), "FREEZER");
  });

  it("keeps the deep interior sealed until the technician is found", () => {
    const state = game();
    state.threats = [];
    place(state, 64.8, 69.9);
    run(state, 2, { moveX: -1 });
    assert.equal(zoneId(state), "OUTPOST");
    const chuck = state.map.stations.find((s) => s.id === "chuck")!;
    place(state, chuck.x - 1, chuck.y);
    run(state, 1.2, { interact: true });
    assert.ok(state.flags.outpostFound);
    assert.equal(state.checkpoint, "outpost");
    place(state, 64.8, 69.9);
    run(state, 2, { moveX: -1 });
    assert.equal(zoneId(state), "DEEP");
  });

  it("routes around closed doors and through unlocked ones", () => {
    const state = game();
    state.flags.entered = true;
    assert.deepEqual(routeTo(state, 14.5, 47.5, 34.5, 55.5), [], "the frozen hatch blocks the way to the power room");
    state.flags.thaw = 1;
    run(state, DT);
    const route = routeTo(state, 14.5, 47.5, 34.5, 55.5);
    assert.ok(route.length > 20, "an open hatch gives a route");
  });

  it("hardens the freezer's ice cream once cooling is repaired", () => {
    const state = game();
    const cream = state.threats.filter((t) => t.leash === ZONE_INDEX.FREEZER);
    run(state, 1);
    assert.ok(cream.every((t) => t.temper === "SOFT"), "melting while the freezer is broken");
    state.flags.coolingRepaired = true;
    run(state, 6);
    assert.ok(cream.every((t) => t.temper === "HARD"), "hard once it is cold again");
  });
});

describe("Cold Case repair panels", () => {
  it("counts relays only inside the timing window, and a fault costs health", () => {
    const state = game();
    for (const id of ["breakerA", "breakerB", "breakerC"]) state.flags.done[id] = true;
    const st = state.map.stations.find((s) => s.id === "mainbus")!;
    place(state, st.x, st.y - 0.4);
    tap(state, { interact: true, interactPressed: true });
    assert.equal(state.panel?.kind, "timing");
    const panel = state.panel!;
    let guard = 0;
    while ((panel.needle! >= panel.window![0] - 0.05 && panel.needle! <= panel.window![1] + 0.05) || panel.t < 0.1) {
      stepGame(state, NO_INPUT, DT);
      if (++guard > 600) throw new Error("needle never left the window");
    }
    tap(state, { interactPressed: true, interact: true });
    assert.equal(panel.hits, 0);
    assert.equal(state.player.hp, 100 - (CONFIG.timing.faultDamage ?? 0));
    run(state, 0.5);
    guard = 0;
    while (!(panel.needle! > panel.window![0] + 0.01 && panel.needle! < panel.window![1] - 0.01)) {
      stepGame(state, NO_INPUT, DT);
      if (++guard > 600) throw new Error("needle never reached the window");
    }
    tap(state, { interactPressed: true, interact: true });
    assert.equal(panel.hits, 1);
  });

  it("vents on overpressure and locks when released in the band", () => {
    const state = game();
    for (const id of ["valve1", "valve2", "valve3"]) state.flags.done[id] = true;
    const st = state.map.stations.find((s) => s.id === "compressor")!;
    place(state, st.x - 0.4, st.y);
    tap(state, { interact: true, interactPressed: true });
    assert.equal(state.panel?.kind, "pressure");
    run(state, 4, { interact: true });
    assert.equal(state.panel!.locks, 0);
    assert.ok(state.player.hp < 100, "overpressure hurts");
    run(state, 0.2);
    const panel = state.panel!;
    const mid = (panel.band![0] + panel.band![1]) / 2;
    let guard = 0;
    while (panel.value < mid && guard++ < 600) stepGame(state, { ...NO_INPUT, interact: true }, DT);
    stepGame(state, NO_INPUT, DT);
    assert.equal(panel.locks, 1);
  });

  it("keeps progress when a panel is closed part way", () => {
    const state = game();
    for (const id of ["valve1", "valve2", "valve3"]) state.flags.done[id] = true;
    const st = state.map.stations.find((s) => s.id === "compressor")!;
    place(state, st.x - 0.4, st.y);
    tap(state, { interact: true, interactPressed: true });
    run(state, 0.1);
    const panel = state.panel!;
    while (panel.value < (panel.band![0] + panel.band![1]) / 2) stepGame(state, { ...NO_INPUT, interact: true }, DT);
    stepGame(state, NO_INPUT, DT);
    assert.equal(panel.locks, 1);
    tap(state, { cancelPressed: true });
    assert.equal(state.panel, null);
    tap(state, { interact: true, interactPressed: true });
    const reopened = state.panel as { locks?: number } | null;
    assert.equal(reopened?.locks, 1);
  });
});

describe("Cold Case downs and checkpoints", () => {
  it("sends a downed agent back to the last stabilized checkpoint with progress kept", () => {
    const state = game();
    state.flags.entered = true;
    state.flags.powerRestored = true;
    state.checkpoint = "power";
    state.objective = OBJECTIVES.findIndex((o) => o.id === "REACH_FREEZER");
    state.threats = [];
    place(state, 36.5, 79.5);
    state.player.warmth = 0;
    state.player.felt = -24;
    state.player.hp = 0.5;
    run(state, 0.5);
    assert.equal(state.phase, "DOWNED");
    run(state, CONFIG.respawn.downTime);
    assert.equal(state.phase, "PLAYING");
    const cp = state.map.checkpoints.find((c) => c.id === "power")!;
    assert.ok(Math.hypot(state.player.x - cp.x, state.player.y - cp.y) < 0.5, "back at the power room");
    assert.equal(state.player.hp, 75);
    assert.ok(state.flags.powerRestored, "power stays restored");
    assert.equal(state.stats.downs, 1);
  });
});

describe("Cold Case full mission", () => {
  for (const seed of [1, 2, 3]) {
    it(`can be finished from the briefing to the debrief (seed ${seed})`, () => {
      const { state, objectives } = playThrough(seed);
      assert.equal(state.phase, "COMPLETE", `finished (stuck at ${objectiveInfo(state).text})`);
      assert.deepEqual(objectives, [...OBJECTIVES.map((o) => o.id).slice(1), "COMPLETE"], "objectives in order");
      const report = debrief(state);
      assert.ok(report.systems.every(([, ok]) => ok), "every system restored");
      assert.ok(report.technician);
      assert.ok(report.time > 120 && report.time < 600, `a few minutes long (${report.time.toFixed(0)} s)`);
      assert.ok(report.downs <= 3, `the bot rarely goes down (${report.downs})`);
    });
  }

  it("has objective text for every step of the loop", () => {
    const state = game();
    for (let i = 0; i < OBJECTIVES.length; i++) {
      state.objective = i;
      const info = objectiveInfo(state);
      assert.ok(info.text.length > 0 && info.target, `${OBJECTIVES[i]!.id} has text and a target`);
    }
  });
});
