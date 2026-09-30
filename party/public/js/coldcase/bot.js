// CPI: Cold Case — a scripted agent that plays the mission through the real rules: the same
// inputs a keyboard produces, the same movement, collision, threats and repair panels. The tests
// use it to prove the loop can be finished; in the browser, `?autopilot` runs it for checks.
//
// It plays like a careful new agent: follows the objective, sets food storage to +4°C, lights heat
// lamps it passes, uses heat packs when cold, and side-steps an ice cream winding up to lunge.
// It does not fight or kite anything, so it takes more hits than a person would.

import { CONFIG, localTemp, NO_INPUT, objectiveInfo, routeTo, stationInfo, zoneId } from "./sim.js";

const REPLAN = 0.3;
const LAMPS = ["lamp1", "lamp2", "lamp3", "lamp4"];

export function createBot({ setpoint = 4 } = {}) {
  let route = [];
  let routeGoal = null;
  let replanAt = 0;
  let released = true;
  let jiggleUntil = 0;
  let jiggle = { x: 0, y: 0 };
  let lastPos = null;
  let lastMoveT = 0;
  let adjustCooldown = 0;

  const station = (state, id) => state.map.stations.find((s) => s.id === id);

  /** Where to go and what to do there. */
  function goal(state) {
    const f = state.flags;
    const p = state.player;
    const obj = objectiveInfo(state);
    const z = zoneId(state);
    // Light a heat lamp on the way if one is close.
    if (z === "DEEP" || z === "CORE") {
      for (const id of LAMPS) {
        const st = station(state, id);
        if (f.done[id]) continue;
        if (Math.hypot(st.x - p.x, st.y - p.y) < 6) return { x: st.x, y: st.y, station: id };
      }
    }
    // Take the supply locker's heat packs once the outpost is found.
    if (f.outpostFound && !f.lockerOpened) {
      const st = station(state, "locker");
      return { x: st.x, y: st.y, station: "locker" };
    }
    switch (obj.id) {
      case "OPEN_FRIDGE":
        return { x: obj.target.x, y: obj.target.y, station: "fridge" };
      case "ENTER":
        return { x: 84.95, y: 3.4 };
      case "ADJUST_TEMP":
        return { x: obj.target.x, y: obj.target.y, station: "thermostat" };
      case "REACH_POWER":
        // Wait at the hatch while it thaws.
        return state.doors.find((d) => d.id === "hatch").unlocked ? { x: 34.5, y: 50.5 } : { x: 34.5, y: 47.2, hold: true };
      case "RESTORE_POWER":
      case "REPAIR_COOLING":
      case "FIND_CHUCK":
        return { ...obj.target, station: nearestStation(state, obj.target) };
      case "REACH_FREEZER":
        return { x: 52.5, y: 43.5 };
      case "REACH_OUTPOST":
        return { x: 69.9, y: 64.2 };
      case "REACH_CORE":
        return { x: 26.5, y: 92.5 };
      case "REPAIR_CORE": {
        if (f.coreStage === 3) return { x: 22.2, y: 92.9, hold: true };
        return { ...obj.target, station: nearestStation(state, obj.target) };
      }
      case "EXTRACT":
        if (!f.liftArrived && (z === "CORE" || z === "DEEP")) return { x: 19.5, y: 83.6 };
        return { x: 14.95, y: 49.6 };
      default:
        return null;
    }
  }

  function nearestStation(state, target) {
    let best = null;
    let bestD = Infinity;
    for (const st of state.map.stations) {
      const d = Math.hypot(st.x - target.x, st.y - target.y);
      if (d < bestD) {
        bestD = d;
        best = st.id;
      }
    }
    return bestD < 0.01 ? best : null;
  }

  function panelInput(state) {
    const panel = state.panel;
    const input = { ...NO_INPUT };
    if (panel.result) return input;
    if (panel.kind === "dial") {
      adjustCooldown -= 1;
      if (panel.value !== setpoint) {
        if (adjustCooldown <= 0) {
          input.adjust = panel.value < setpoint ? 1 : -1;
          adjustCooldown = 2;
        }
      } else return press(input);
      return input;
    }
    if (panel.kind === "timing") {
      const [a, b] = panel.window;
      if (panel.cooldown <= 0 && panel.needle > a + 0.02 && panel.needle < b - 0.02) return press(input);
      return release(input);
    }
    if (panel.kind === "pressure") {
      const mid = (panel.band[0] + panel.band[1]) / 2;
      if (!panel.armed) return release(input);
      if (panel.value < mid) {
        input.interact = true;
        released = false;
      } else released = true;
      return input;
    }
    if (panel.kind === "balance") {
      const target = (panel.band[0] + panel.band[1]) / 2;
      input.adjustHeld = panel.value > target + 0.4 ? -1 : panel.value < target - 0.4 ? 1 : 0;
      return input;
    }
    return input;
  }

  function press(input) {
    if (released) {
      input.interact = true;
      input.interactPressed = true;
      released = false;
    } else released = true;
    return input;
  }

  function release(input) {
    released = true;
    return input;
  }

  /** The input for the next step. */
  function next(state) {
    if (state.phase !== "PLAYING" || state.transition) return { ...NO_INPUT };
    if (state.panel) return panelInput(state);
    const p = state.player;
    const input = { ...NO_INPUT };

    // Warm up with a heat pack when getting cold (and not already warm).
    if (p.warmth < 30 && p.heatPacks > 0 && localTemp(state, p.x, p.y) < 0 && !state.heat.some((h) => h.id === "pack")) {
      input.actionPressed = true;
      input.action = true;
    }

    const g = goal(state);
    if (!g) return input;

    // Side-step an ice cream that is winding up at us.
    for (const t of state.threats) {
      if (t.kind !== "icecream" || t.mode !== "windup") continue;
      if (Math.hypot(t.x - p.x, t.y - p.y) > CONFIG.icecream.lungeRange + 1) continue;
      input.moveX = -t.aimY;
      input.moveY = t.aimX;
      return input;
    }

    // Step away from anything harmful that is right on top of us.
    for (const t of state.threats) {
      if (t.temper === "FROZEN" || t.mode === "backoff" || t.mode === "idle" || t.mode === "return") continue;
      if (t.kind === "milk" && t.temper === "AWAKE" && t.mode !== "curious") continue;
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      const d = Math.hypot(dx, dy);
      if (d < t.r + p.r + 0.45 && d > 1e-6) {
        input.moveX = dx / d;
        input.moveY = dy / d;
        return input;
      }
    }

    // At the station: work it.
    if (g.station) {
      const st = station(state, g.station);
      const d = Math.hypot(st.x - p.x, st.y - p.y);
      const info = stationInfo(state, st);
      if (d < st.r - 0.25 && info.available) {
        if (st.kind === "hold") {
          input.interact = true;
          released = false;
          return input;
        }
        return press(input);
      }
    }
    if (g.hold && Math.hypot(g.x - p.x, g.y - p.y) < 0.4) return input;

    // Walk there.
    if (state.time >= replanAt || !routeGoal || routeGoal.x !== g.x || routeGoal.y !== g.y) {
      route = routeTo(state, p.x, p.y, g.x, g.y);
      routeGoal = { x: g.x, y: g.y };
      replanAt = state.time + REPLAN;
    }
    while (route.length && Math.hypot(route[0].x - p.x, route[0].y - p.y) < 0.35) route.shift();
    const aim = route.length > 1 ? route[0] : g;
    let dx = aim.x - p.x;
    let dy = aim.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.05) {
      dx /= d;
      dy /= d;
    }

    // Unstick: if we have barely moved for a while, wiggle.
    if (!lastPos || Math.hypot(p.x - lastPos.x, p.y - lastPos.y) > 0.5) {
      lastPos = { x: p.x, y: p.y };
      lastMoveT = state.time;
    } else if (state.time - lastMoveT > 2.5 && d > 0.6) {
      const a = state.time * 7.1;
      jiggle = { x: Math.cos(a), y: Math.sin(a) };
      jiggleUntil = state.time + 0.4;
      lastMoveT = state.time;
      route = [];
    }
    if (state.time < jiggleUntil) {
      dx = jiggle.x;
      dy = jiggle.y;
    }
    input.moveX = dx;
    input.moveY = dy;
    released = true;
    return input;
  }

  return { next, goal };
}
