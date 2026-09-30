// CPI: Cold Case — the renderer. Draws the simulation's state; never changes it.
//
//   1. Floors, walls, furniture and decals are painted once into 8×8-tile chunk canvases.
//   2. Live things (doors, fixtures, pickups, hazards, the core, threats, the agent) are drawn
//      each frame, sorted by y.
//   3. Lighting: a half-resolution darkness layer (each room has its own darkness, which changes
//      as power and heat come back) with lights cut out of it, then coloured glows added.
//   4. Fog: rooms not yet discovered stay black, so the fridge reveals itself as you explore.
//   5. Screen effects: frost at the edges when cold, a red flash when hurt, the portal flashes.
//
// Particles come from the shared CPI particle system, run in a 32-units-per-tile space so its
// pixel-sized presets read correctly at this scale.

import { createParticles } from "../cpi/particles.js";
import {
  COLORS,
  drawAgent,
  drawCheckpointGlow,
  drawCore,
  drawDecals,
  drawDoor,
  drawFloorTile,
  drawHazard,
  drawIceCream,
  drawIceSheen,
  drawMilk,
  drawObstacle,
  drawPickup,
  drawStation,
  drawTechnician,
  drawWallShadow,
  drawWallTile,
} from "./art.js";

const CHUNK = 8;
const MAX_TILE_PX = 64;
const PS = 32; // particle units per tile
const LIGHT_SCALE = 0.5;

/** How dark each room is, given what has been repaired. */
function zoneDarkness(state, zone) {
  const f = state.flags;
  switch (zone.id) {
    case "CENTRAL":
      return f.powerRestored ? 0.36 : zone.dark;
    case "POWER":
      return f.powerRestored ? 0.3 : zone.dark;
    case "FREEZER":
      return f.powerRestored ? 0.42 : zone.dark;
    case "OUTPOST":
      return f.outpostFound ? 0.38 : zone.dark;
    case "CORE":
      return f.coreStabilized ? 0.5 : zone.dark;
    default:
      return zone.dark;
  }
}

function lightOn(state, when) {
  const f = state.flags;
  switch (when) {
    case "always":
      return true;
    case "power":
      return f.powerRestored;
    case "nopower":
      return !f.powerRestored;
    case "cooling":
      return f.coolingRepaired;
    case "outpost":
      return f.outpostFound;
    case "core":
      return f.coreStabilized;
    case "nocore":
      return !f.coreStabilized;
    default:
      return Boolean(f.done[when]);
  }
}

export function createRenderer(canvas, map) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const view = { W: 1, H: 1, dpr: 1, scale: 60, tilePx: 60 };
  const cam = { x: map.start.x, y: map.start.y, shake: 0, ox: 0, oy: 0 };
  const chunks = new Map();
  const fx = createParticles({ max: 360 });

  const light = document.createElement("canvas");
  const lctx = light.getContext("2d");
  const dark = document.createElement("canvas");
  dark.width = map.w;
  dark.height = map.h;
  const dctx = dark.getContext("2d");
  const fog = document.createElement("canvas");
  fog.width = map.w;
  fog.height = map.h;
  const fctx = fog.getContext("2d");
  let darkKey = "";
  let fogKey = "";
  let hurtFlash = 0;
  let flash = { t: 0, color: "255, 255, 255" };
  let moteT = 0;
  let breathT = 0;
  let walk = 0;

  function resize() {
    const W = Math.max(1, canvas.clientWidth);
    const H = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const scale = Math.max(30, Math.min(88, Math.sqrt((W * H) / 250)));
    const tilePx = Math.min(MAX_TILE_PX, Math.round(scale * dpr));
    if (tilePx !== view.tilePx) chunks.clear();
    Object.assign(view, { W, H, dpr, scale, tilePx });
    light.width = Math.max(1, Math.round(W * dpr * LIGHT_SCALE));
    light.height = Math.max(1, Math.round(H * dpr * LIGHT_SCALE));
  }

  // ---------------------------------------------------------------- the static layer

  function chunkCanvas(cx, cy) {
    const key = `${cx},${cy}`;
    let c = chunks.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = CHUNK * view.tilePx;
    c.height = CHUNK * view.tilePx;
    const g = c.getContext("2d");
    g.setTransform(view.tilePx, 0, 0, view.tilePx, -cx * CHUNK * view.tilePx, -cy * CHUNK * view.tilePx);
    paintChunk(g, cx * CHUNK, cy * CHUNK);
    chunks.set(key, c);
    return c;
  }

  function paintChunk(g, x0, y0) {
    const { w, h, floor, wall, zone, ice } = map;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x);
    const isFloor = (x, y) => {
      const i = at(x, y);
      return i >= 0 && floor[i] === 1;
    };
    let empty = true;
    for (let y = y0 - 1; y < y0 + CHUNK + 1; y++) {
      for (let x = x0 - 1; x < x0 + CHUNK + 1; x++) {
        const i = at(x, y);
        if (i < 0 || !floor[i]) continue;
        empty = false;
        const z = map.zones[zone[i] - 1];
        drawFloorTile(g, z.floor, x, y);
        if (ice[i]) drawIceSheen(g, x, y);
      }
    }
    if (empty) {
      let anyWall = false;
      for (let y = y0; y < y0 + CHUNK && !anyWall; y++) for (let x = x0; x < x0 + CHUNK; x++) if (wall[at(x, y)] === 1) anyWall = true;
      if (!anyWall) return;
    }
    for (let y = y0 - 1; y < y0 + CHUNK + 1; y++) {
      for (let x = x0 - 1; x < x0 + CHUNK + 1; x++) {
        const i = at(x, y);
        if (i < 0 || !floor[i]) continue;
        if (wall[at(x, y - 1)] === 1) drawWallShadow(g, x, y, "n");
        if (wall[at(x - 1, y)] === 1) drawWallShadow(g, x, y, "w");
        if (wall[at(x + 1, y)] === 1) drawWallShadow(g, x, y, "e");
      }
    }
    drawDecals(g, map);
    for (const o of map.obstacles) {
      if (o.x > x0 + CHUNK + 1 || o.x + o.w < x0 - 1 || o.y > y0 + CHUNK + 1 || o.y + o.h < y0 - 1) continue;
      drawObstacle(g, o);
    }
    for (let y = y0 - 1; y < y0 + CHUNK + 1; y++) {
      for (let x = x0 - 1; x < x0 + CHUNK + 1; x++) {
        const i = at(x, y);
        if (i < 0 || !wall[i]) continue;
        const z = map.zones[zone[i] - 1];
        drawWallTile(g, z.wall, x, y, { n: isFloor(x, y - 1), s: isFloor(x, y + 1), e: isFloor(x + 1, y), w: isFloor(x - 1, y) });
      }
    }
  }

  // ---------------------------------------------------------------- darkness and fog maps

  function refreshMaps(state) {
    const dk = state.zones.map((z) => zoneDarkness(state, z).toFixed(2)).join(",");
    if (dk !== darkKey) {
      darkKey = dk;
      const img = dctx.createImageData(map.w, map.h);
      for (let i = 0; i < map.w * map.h; i++) {
        const z = map.zone[i];
        const a = z ? zoneDarkness(state, state.zones[z - 1]) : 0.92;
        img.data[i * 4 + 0] = 2;
        img.data[i * 4 + 1] = 4;
        img.data[i * 4 + 2] = 7;
        img.data[i * 4 + 3] = Math.round(a * 255);
      }
      dctx.putImageData(img, 0, 0);
    }
    const fk = Array.from(state.discovered).join("");
    if (fk !== fogKey) {
      fogKey = fk;
      const img = fctx.createImageData(map.w, map.h);
      for (let i = 0; i < map.w * map.h; i++) {
        const z = map.zone[i];
        const hidden = !z || !state.discovered[z - 1];
        img.data[i * 4 + 3] = hidden ? 255 : 0;
        img.data[i * 4 + 0] = 3;
        img.data[i * 4 + 1] = 4;
        img.data[i * 4 + 2] = 5;
      }
      fctx.putImageData(img, 0, 0);
    }
  }

  // ---------------------------------------------------------------- camera and effects

  function snap(x, y) {
    cam.x = x;
    cam.y = y;
  }

  function update(state, dt) {
    const p = state.player;
    const lookX = Math.max(-1.6, Math.min(1.6, p.vx * 0.28));
    const lookY = Math.max(-1.2, Math.min(1.2, p.vy * 0.24));
    const k = 1 - Math.exp(-dt * 5.5);
    cam.x += (p.x + lookX - cam.x) * k;
    cam.y += (p.y + lookY - cam.y) * k;
    cam.shake = Math.max(0, cam.shake - dt * 2.8);
    const s = cam.shake * cam.shake * 0.35;
    cam.ox = (Math.random() - 0.5) * s;
    cam.oy = (Math.random() - 0.5) * s;
    hurtFlash = Math.max(0, hurtFlash - dt * 2.4);
    flash.t = Math.max(0, flash.t - dt * 1.6);
    if (p.moving) walk += dt * 11;
    fx.update(dt);
    ambient(state, dt);
  }

  function ambient(state, dt) {
    if (state.phase === "BRIEFING") return;
    const p = state.player;
    const zone = state.zones[p.zone];
    // Frost motes drifting through cold rooms.
    const cold = Math.max(0, Math.min(1, -zone.temp / 20));
    moteT -= dt * (2 + cold * 14);
    while (moteT < 0) {
      moteT += 1;
      if (cold <= 0.05) break;
      const hw = view.W / view.scale / 2 + 1;
      const hh = view.H / view.scale / 2 + 1;
      fx.emit("mote", (cam.x + (Math.random() * 2 - 1) * hw) * PS, (cam.y + (Math.random() * 2 - 1) * hh) * PS, { color: "rgba(225, 242, 255, 0.55)", size: 1.6 + Math.random() * 1.6, speed: 10, gravity: 6, life: 3.5 });
    }
    // Breath in the cold.
    breathT -= dt;
    if (p.felt < 4 && breathT <= 0 && state.phase === "PLAYING") {
      breathT = 1.3 + Math.random() * 0.8;
      const fxp = p.x + Math.cos(p.facing) * 0.32;
      const fyp = p.y + Math.sin(p.facing) * 0.32;
      for (let i = 0; i < 3; i++) fx.emit("smoke", fxp * PS, fyp * PS, { color: "rgba(235, 245, 250, 0.3)", size: 3, grow: 12, speed: 8, life: 1, gravity: -6, vx: Math.cos(p.facing) * 16, vy: Math.sin(p.facing) * 16, layer: "front" });
    }
    // Stink from spoiled milk, steam from soft ice cream.
    for (const t of state.threats) {
      if (Math.abs(t.x - cam.x) > 14 || Math.abs(t.y - cam.y) > 10) continue;
      if (t.temper === "SPOILED" && Math.random() < dt * 3) fx.emit("smoke", t.x * PS, (t.y - 0.3) * PS, { color: "rgba(170, 200, 90, 0.35)", size: 3, grow: 8, speed: 6, life: 1.2, gravity: -14, layer: "front" });
      if (t.temper === "SOFT" && Math.random() < dt * 1.2) fx.emit("smoke", t.x * PS, (t.y - 0.2) * PS, { color: "rgba(255, 230, 235, 0.22)", size: 2.5, grow: 6, speed: 4, life: 1, gravity: -10, layer: "front" });
    }
    // Hazards arcing and venting close by.
    for (const hz of state.hazards) {
      if (hz.state === "idle") continue;
      if (Math.abs(hz.x - cam.x) > 14 || Math.abs(hz.y - cam.y) > 10) continue;
      if (hz.kind === "spark" && Math.random() < dt * (hz.state === "arc" ? 40 : 8)) {
        fx.emit("spark", (hz.x + Math.random() * (hz.w ?? 1)) * PS, (hz.y + 0.5) * PS, { color: hz.state === "arc" ? "#bfe8ff" : "#ffd166", size: 3, speed: 140, gravity: 300 });
      }
      if (hz.kind === "vent" && hz.state === "charge" && Math.random() < dt * 12) {
        const a = Math.random() * Math.PI * 2;
        fx.emit("mote", (hz.x + Math.cos(a) * (hz.r ?? 1)) * PS, (hz.y + Math.sin(a) * (hz.r ?? 1)) * PS, { color: "rgba(230, 248, 255, 0.8)", size: 2.2, speed: 0, vx: -Math.cos(a) * 30, vy: -Math.sin(a) * 30, life: 0.7, gravity: 0 });
      }
    }
    // The core throws off cold sparks until it is stable.
    const core = map.core;
    if (!state.flags.coreStabilized && Math.abs(core.x - cam.x) < 16 && Math.abs(core.y - cam.y) < 12 && Math.random() < dt * 6) {
      fx.emit("spark", core.x * PS, core.y * PS, { color: "#bff4ff", size: 3, speed: 120, gravity: 0, drag: 2 });
    }
  }

  /** Visual reactions to simulation events. */
  function onEvent(state, e) {
    const burst = (kind, x, y, n, opts) => fx.burst(kind, x * PS, y * PS, n, opts);
    switch (e.type) {
      case "teleport":
        snap(e.x, e.y);
        break;
      case "hurt": {
        hurtFlash = Math.min(1, 0.45 + e.amount / 20);
        cam.shake = Math.min(1.2, cam.shake + 0.35 + e.amount / 30);
        fx.emit("text", e.x * PS, (e.y - 0.5) * PS, { text: `-${Math.round(e.amount)}`, color: "#ff6b5e", size: 16, font: "700 1px Oswald, sans-serif" });
        break;
      }
      case "effect": {
        const { kind, x, y } = e;
        if (kind === "sparks") burst("spark", x, y, 14, { speed: 200, size: 3.5, gravity: 420 });
        else if (kind === "shards") burst("shard", x, y, 10, { size: 5, speed: 120, gravity: 320 });
        else if (kind === "splat") burst("dust", x, y, 12, { color: "rgba(246, 244, 236, 0.85)", size: 3, grow: 4, speed: 90, gravity: 0, drag: 5 });
        else if (kind === "fog") burst("smoke", x, y, 26, { color: "rgba(235, 248, 255, 0.45)", size: 8, grow: 22, speed: 50, life: 2.2, gravity: 14, angle: Math.PI / 2, spread: Math.PI * 0.8 });
        else if (kind === "warm" || kind === "heatpack") {
          burst("glow", x, y, 1, { color: "#ffab5e", size: 30, grow: 120 });
          burst("ember", x, y, 14, { speed: 110, gravity: -60 });
        } else if (kind === "coil") {
          burst("ring", x, y, 1, { color: "rgba(127, 224, 255, 0.9)", size: 8, grow: 80 });
          burst("spark", x, y, 10, { color: "#bff4ff", speed: 160, gravity: 0, drag: 2 });
        } else if (kind === "steam") burst("smoke", x, y, 10, { color: "rgba(235, 245, 250, 0.4)", size: 6, grow: 20, speed: 60, gravity: -40 });
        else if (kind === "surgeHit") {
          burst("ring", x, y, 1, { color: "rgba(220, 248, 255, 0.9)", size: 6, grow: 60 });
          cam.shake = Math.min(1.2, cam.shake + 0.3);
        }
        break;
      }
      case "hazard":
        if (Math.abs(e.x - cam.x) < 16 && Math.abs(e.y - cam.y) < 12) {
          if (e.kind === "spark") cam.shake = Math.min(1, cam.shake + 0.12);
          else {
            burst("smoke", e.x, e.y, 14, { color: "rgba(235, 248, 255, 0.55)", size: 6, grow: 26, speed: 70, gravity: 0, drag: 2, life: 1.2 });
            burst("ring", e.x, e.y, 1, { color: "rgba(235, 248, 255, 0.8)", size: 8, grow: 70 });
          }
        }
        break;
      case "pickup":
        burst("ring", state.player.x, state.player.y, 1, { color: "rgba(255, 212, 0, 0.9)", size: 6, grow: 50 });
        break;
      case "checkpoint": {
        const cp = map.checkpoints.find((c) => c.id === e.id);
        if (cp) burst("ring", cp.x, cp.y, 2, { color: "rgba(143, 224, 96, 0.9)", size: 8, grow: 70 });
        break;
      }
      case "stabilized":
        flash = { t: 1, color: "200, 255, 230" };
        burst("ring", map.core.x, map.core.y, 3, { color: "rgba(160, 255, 210, 0.9)", size: 20, grow: 220 });
        burst("glow", map.core.x, map.core.y, 1, { color: "#8fffc4", size: 60, grow: 260 });
        cam.shake = 1;
        break;
      case "power":
        flash = { t: 0.6, color: "255, 245, 210" };
        break;
      case "threatTemper":
        if (e.temper === "SPOILED" || e.temper === "HARD") {
          const t = state.threats.find((x) => x.id === e.id);
          if (t) burst(e.temper === "HARD" ? "shard" : "smoke", t.x, t.y, 6, e.temper === "HARD" ? { size: 4, speed: 80, gravity: 200 } : { color: "rgba(170, 200, 90, 0.5)", size: 4, grow: 10, speed: 20, gravity: -10 });
        }
        break;
      case "station":
        cam.shake = Math.min(1, cam.shake + 0.1);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- drawing

  function worldToScreen(x, y) {
    return { x: (x - cam.x) * view.scale + view.W / 2 + cam.ox * view.scale, y: (y - cam.y) * view.scale + view.H / 2 + cam.oy * view.scale };
  }

  function setWorld(g, factor = 1) {
    const s = view.scale * view.dpr * factor;
    const ox = Math.round((view.W / 2 - (cam.x - cam.ox) * view.scale) * view.dpr * factor);
    const oy = Math.round((view.H / 2 - (cam.y - cam.oy) * view.scale) * view.dpr * factor);
    g.setTransform(s, 0, 0, s, ox, oy);
    return { s, ox, oy };
  }

  function visibleRect(margin = 1) {
    const hw = view.W / view.scale / 2 + margin;
    const hh = view.H / view.scale / 2 + margin;
    return { x0: cam.x - hw, x1: cam.x + hw, y0: cam.y - hh, y1: cam.y + hh };
  }

  function draw(state, ui = {}) {
    const time = state.time;
    refreshMaps(state);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 1. Cached floors.
    const { s, ox, oy } = setWorld(ctx);
    const vr = visibleRect(1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    for (let cy = Math.floor(vr.y0 / CHUNK); cy <= Math.floor(vr.y1 / CHUNK); cy++) {
      for (let cx = Math.floor(vr.x0 / CHUNK); cx <= Math.floor(vr.x1 / CHUNK); cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= map.w || cy * CHUNK >= map.h) continue;
        const c = chunkCanvas(cx, cy);
        const sx = Math.round(ox + cx * CHUNK * s);
        const sy = Math.round(oy + cy * CHUNK * s);
        const ex = Math.round(ox + (cx + 1) * CHUNK * s);
        const ey = Math.round(oy + (cy + 1) * CHUNK * s);
        ctx.drawImage(c, sx, sy, ex - sx, ey - sy);
      }
    }

    // 2. Live world.
    setWorld(ctx);
    const inView = (x, y, m = 2) => x > vr.x0 - m && x < vr.x1 + m && y > vr.y0 - m && y < vr.y1 + m;
    for (const cp of map.checkpoints) {
      if (!inView(cp.x, cp.y)) continue;
      const status = state.checkpoint === cp.id ? "active" : checkpointOpen(state, cp.id) ? "open" : "locked";
      drawCheckpointGlow(ctx, cp, status, time);
    }
    for (const hz of state.hazards) if (inView(hz.x, hz.y, 4)) drawHazard(ctx, hz, time);
    for (const item of state.pickups) if (!item.taken && inView(item.x, item.y)) drawPickup(ctx, item, time);
    if (inView(map.core.x, map.core.y, 5)) drawCore(ctx, state, time);
    for (const st of map.stations) if (inView(st.x, st.y)) drawStation(ctx, st, state, time);
    map.doors.forEach((def, i) => {
      if (inView(def.x, def.y, 3)) drawDoor(ctx, def, state.doors[i], time, { thaw: state.flags.thaw });
    });

    fx.draw(scaledParticles(ctx), "back");
    setWorld(ctx);

    // Entities, back to front.
    const p = state.player;
    const actors = [];
    for (const t of state.threats) if (inView(t.x, t.y)) actors.push({ y: t.y, draw: () => (t.kind === "milk" ? drawMilk(ctx, t, time) : drawIceCream(ctx, t, time)) });
    if (inView(69.9, 67.35)) actors.push({ y: 67.35, draw: () => drawTechnician(ctx, 69.9, 67.35, state.flags.outpostFound, time) });
    const visible = !state.transition || !state.transition.swapped || state.transition.t > state.transition.swap + 0.15;
    if (state.phase !== "DOWNED" && visible) {
      const cold = Math.max(0, Math.min(1, (45 - p.warmth) / 45));
      const hurt = p.iframes > 0 ? (Math.sin(time * 40) > 0 ? 0.55 : 0) : 0;
      actors.push({ y: p.y, draw: () => drawAgent(ctx, p.x, p.y, p.facing, { walk, moving: p.moving, cold, hurt }) });
    } else if (state.phase === "DOWNED") {
      actors.push({ y: p.y, draw: () => drawAgent(ctx, p.x, p.y, p.facing + 1.2, { cold: 1, scale: 0.95, suit: "#9a8a3a" }) });
    }
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) a.draw();

    // Interaction highlight and hold progress.
    drawTargetRing(state, time);
    fx.draw(scaledParticles(ctx), "front");
    setWorld(ctx);

    // 3. Lighting.
    drawLighting(state, time, vr);

    // Coloured glow on top.
    setWorld(ctx);
    ctx.globalCompositeOperation = "lighter";
    for (const l of activeLights(state, time)) {
      if (!inView(l.x, l.y, l.r)) continue;
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, hexA(l.color, 0.2 * l.power));
      g.addColorStop(1, hexA(l.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    ctx.globalCompositeOperation = "source-over";

    // 4. Fog over rooms not discovered yet.
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fog, 0, 0, map.w, map.h);

    // Objective marker (above the fog so it can lead you on).
    drawObjectiveMarker(state, ui, time);

    // 5. Screen effects.
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawScreenEffects(state, time);
    drawGuideArrow(state, ui, time);
  }

  function scaledParticles(g) {
    g.scale(1 / PS, 1 / PS);
    return g;
  }

  function checkpointOpen(state, id) {
    const f = state.flags;
    if (id === "entry") return f.entered;
    if (id === "power") return f.powerRestored;
    if (id === "outpost") return f.outpostFound;
    return true;
  }

  function activeLights(state, time) {
    const out = [];
    for (const l of map.lights) {
      if (!lightOn(state, l.when)) continue;
      const power = l.beacon ? l.power * (0.45 + 0.55 * Math.max(0, Math.sin(time * 3.2 + l.x))) : l.power;
      out.push({ x: l.x, y: l.y, r: l.r, color: l.color, power });
    }
    for (const h of state.heat) if (h.on && h.id === "pack") out.push({ x: h.x, y: h.y, r: 3.2, color: "#ffab5e", power: 0.9 });
    const fridge = state.doors.find((d) => d.id === "fridge");
    if (fridge.open > 0.05) out.push({ x: 84.95, y: 3.6, r: 5.5, color: "#dff6ff", power: fridge.open });
    const exit = state.doors.find((d) => d.id === "exit");
    if (exit.open > 0.05) out.push({ x: 14.95, y: 49, r: 4.5, color: "#ffd9a0", power: exit.open });
    for (const hz of state.hazards) {
      if (hz.kind === "spark" && hz.state === "arc") out.push({ x: hz.x + (hz.w ?? 1) / 2, y: hz.y + 0.5, r: 3.5, color: "#bfe8ff", power: 0.9 });
      if (hz.kind === "vent" && hz.state === "blast") out.push({ x: hz.x, y: hz.y, r: 2.8, color: "#e6f7ff", power: 0.7 });
    }
    for (const id of ["coil1", "coil2", "coil3"]) {
      if (!state.flags.done[id]) continue;
      const o = map.stations.find((st) => st.id === id);
      out.push({ x: o.x, y: o.y - 0.8, r: 2.2, color: "#7fe0ff", power: 0.7 });
    }
    return out;
  }

  function drawLighting(state, time, vr) {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, light.width, light.height);
    setWorld(lctx, LIGHT_SCALE);
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(dark, 0, 0, map.w, map.h);
    lctx.globalCompositeOperation = "destination-out";
    const cut = (x, y, r, power) => {
      if (x < vr.x0 - r || x > vr.x1 + r || y < vr.y0 - r || y > vr.y1 + r) return;
      const g = lctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0, 0, 0, ${Math.min(1, power)})`);
      g.addColorStop(0.55, `rgba(0, 0, 0, ${Math.min(1, power) * 0.55})`);
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      lctx.fillStyle = g;
      lctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const l of activeLights(state, time)) cut(l.x, l.y, l.r, l.power);
    // The agent's own light and helmet torch.
    const p = state.player;
    if (state.phase !== "BRIEFING") {
      cut(p.x, p.y, 3.4, 0.75);
      const len = 7.5;
      const spread = 0.5;
      lctx.save();
      lctx.beginPath();
      lctx.moveTo(p.x, p.y);
      lctx.arc(p.x, p.y, len, p.facing - spread, p.facing + spread);
      lctx.closePath();
      const g = lctx.createRadialGradient(p.x, p.y, 0.3, p.x, p.y, len);
      g.addColorStop(0, "rgba(0, 0, 0, 0.85)");
      g.addColorStop(0.6, "rgba(0, 0, 0, 0.45)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      lctx.fillStyle = g;
      lctx.fill();
      lctx.restore();
    }
    lctx.globalCompositeOperation = "source-over";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(light, 0, 0, canvas.width, canvas.height);
  }

  function drawTargetRing(state, time) {
    const target = state.target;
    if (!target || target.type !== "station" || state.panel) return;
    const st = map.stations.find((x) => x.id === target.id);
    if (!st) return;
    const color = target.available ? "255, 212, 0" : "255, 107, 94";
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.strokeStyle = `rgba(${color}, ${0.55 + 0.35 * pulse})`;
    ctx.lineWidth = 0.06;
    ctx.setLineDash([0.22, 0.14]);
    ctx.beginPath();
    ctx.arc(st.x, st.y, 0.62 + pulse * 0.06, time * 0.8, time * 0.8 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (state.hold && state.hold.id === st.id) {
      const k = Math.min(1, state.hold.t / state.hold.dur);
      const p = state.player;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = COLORS.yellow;
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.55, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawObjectiveMarker(state, ui, time) {
    const target = ui.objective?.target;
    if (!target || state.phase !== "PLAYING") return;
    const bob = Math.sin(time * 4) * 0.12;
    const x = target.x;
    const y = target.y - 1.05 + bob;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(-0.22, -0.28);
    ctx.lineTo(0.22, -0.28);
    ctx.lineTo(0, 0.02);
    ctx.closePath();
    ctx.fillStyle = COLORS.yellow;
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.lineWidth = 0.04;
    ctx.stroke();
    ctx.restore();
  }

  function drawGuideArrow(state, ui, time) {
    const guide = ui.guide;
    if (!guide || state.phase !== "PLAYING" || state.panel) return;
    const target = ui.objective?.target;
    if (!target) return;
    const on = worldToScreen(target.x, target.y);
    const margin = 46;
    if (on.x > margin && on.x < view.W - margin && on.y > margin + 60 && on.y < view.H - margin - 40) return;
    // Point along the route (through doors), not straight through walls.
    const p = state.player;
    const aim = worldToScreen(guide.x, guide.y);
    const me = worldToScreen(p.x, p.y);
    const a = Math.atan2(aim.y - me.y, aim.x - me.x);
    const rx = view.W / 2 - margin;
    const ry = view.H / 2 - margin - 30;
    const t = Math.min(Math.abs(rx / (Math.cos(a) || 1e-6)), Math.abs(ry / (Math.sin(a) || 1e-6)));
    const x = view.W / 2 + Math.cos(a) * t;
    const y = view.H / 2 + Math.sin(a) * t + 10;
    const pulse = 1 + 0.08 * Math.sin(time * 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.scale(pulse, pulse);
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -12);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fillStyle = COLORS.yellow;
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.font = "700 12px 'Roboto Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.yellow;
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 4;
    ctx.fillText(`${Math.round(guide.dist)} m`, x - Math.cos(a) * 30, y - Math.sin(a) * 30 + 4);
    ctx.restore();
  }

  let vignette = null;
  let vignetteKey = "";
  function drawScreenEffects(state, time) {
    const { W, H } = view;
    const key = `${W}x${H}`;
    if (key !== vignetteKey) {
      vignetteKey = key;
      vignette = {
        dark: ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6),
        frost: ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.hypot(W, H) * 0.58),
        hurt: ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6),
      };
      vignette.dark.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.dark.addColorStop(1, "rgba(0, 0, 0, 0.55)");
      vignette.frost.addColorStop(0, "rgba(200, 235, 255, 0)");
      vignette.frost.addColorStop(0.7, "rgba(200, 235, 255, 0.25)");
      vignette.frost.addColorStop(1, "rgba(235, 250, 255, 0.85)");
      vignette.hurt.addColorStop(0, "rgba(255, 40, 30, 0)");
      vignette.hurt.addColorStop(1, "rgba(255, 40, 30, 0.7)");
    }
    ctx.fillStyle = vignette.dark;
    ctx.fillRect(0, 0, W, H);
    const p = state.player;
    const cold = Math.max(0, Math.min(1, (40 - p.warmth) / 40)) * 0.9 + Math.max(0, Math.min(0.25, (-p.felt - 10) / 40));
    if (cold > 0.01) {
      ctx.globalAlpha = Math.min(1, cold);
      ctx.fillStyle = vignette.frost;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (hurtFlash > 0) {
      ctx.globalAlpha = hurtFlash;
      ctx.fillStyle = vignette.hurt;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (flash.t > 0) {
      ctx.fillStyle = `rgba(${flash.color}, ${flash.t * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    const tr = state.transition;
    if (tr) {
      const d = Math.abs(tr.t - tr.swap);
      const k = Math.max(0, 1 - d / tr.swap);
      ctx.fillStyle = tr.kind === "lift" ? `rgba(0, 0, 0, ${Math.min(1, k * 1.4)})` : `rgba(235, 248, 255, ${Math.min(1, k * 1.3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.phase === "DOWNED") {
      ctx.fillStyle = "rgba(8, 14, 20, 0.55)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  resize();
  return { resize, update, onEvent, draw, snap, worldToScreen, camera: cam, view, particles: fx };
}

function hexA(hex, alpha) {
  const v = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`;
}

/** The minimap: rooms you have discovered, you, and where the objective is. */
export function drawMinimap(canvas, state, objective) {
  const g = canvas.getContext("2d");
  const map = state.map;
  const W = canvas.width;
  const H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const interior = { x0: 6, y0: 11, x1: 80, y1: 101 };
  const inKitchen = state.zones[state.player.zone]?.id === "KITCHEN";
  const box = inKitchen ? { x0: 76, y0: 1, x1: 94, y1: 16 } : interior;
  const s = Math.min(W / (box.x1 - box.x0), H / (box.y1 - box.y0));
  const ox = (W - (box.x1 - box.x0) * s) / 2 - box.x0 * s;
  const oy = (H - (box.y1 - box.y0) * s) / 2 - box.y0 * s;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = y * map.w + x;
      const z = map.zone[i];
      if (!z || !state.discovered[z - 1]) continue;
      if (map.floor[i]) {
        const cur = z - 1 === state.player.zone;
        const d = map.door[i] ? state.doors[map.door[i] - 1] : null;
        g.fillStyle = d && !d.passable ? (d.unlocked ? "#8fe060" : "#ff6b5e") : cur ? "rgba(255, 212, 0, 0.55)" : map.block[i] ? "rgba(160, 190, 200, 0.35)" : "rgba(160, 190, 200, 0.6)";
      } else g.fillStyle = "rgba(60, 80, 90, 0.9)";
      g.fillRect(ox + x * s, oy + y * s, Math.ceil(s), Math.ceil(s));
    }
  }
  if (objective?.target) {
    const tx = ox + objective.target.x * s;
    const ty = oy + objective.target.y * s;
    if (tx >= 0 && ty >= 0 && tx <= W && ty <= H) {
      g.strokeStyle = "#ffd400";
      g.lineWidth = Math.max(1.5, s * 0.5);
      g.beginPath();
      g.arc(tx, ty, Math.max(3, s * 1.6), 0, Math.PI * 2);
      g.stroke();
    }
  }
  const p = state.player;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(ox + p.x * s, oy + p.y * s, Math.max(2.2, s * 0.9), 0, Math.PI * 2);
  g.fill();
}
