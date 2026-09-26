// Angry Thud's Revenge: draws the world on a canvas, on the host screen and on phones. The server
// sends body snapshots (20 a second while something moves); this smooths between the last two,
// frames a camera for the moment (the whole field on the big screen; the sling, the bird or your
// build zone on a phone), turns the server's effects into particles and sounds, and paints the
// weather. It decides nothing.

import { createParticles } from "../cpi/particles.js";
import { drawBird } from "../cpi/bird.js";
import { fitCanvas } from "../drawing-canvas.js";
import { playSfx } from "./mycob-sound.js";
import { drawBlock, drawBuilding, drawPig, drawRedCow, drawSling, MATERIAL_COLORS, paintBackdrop } from "./thud-art.js";
import { lookFor } from "./thud-birds.js";
import { arc } from "./thud-rules.js";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
const INTERP_MS = 70;
const TOP = -420;

const FX_SOUND = {
  break: "thud_break",
  pop: "thud_pig_pop",
  hit: "thud_pig_hit",
  boom: "thud_boom",
  launch: "thud_launch",
  ability: "thud_ability",
  bolt: "thud_lightning",
  tornado: "thud_tornado",
  rebuild: "thud_repair",
  build: "thud_build",
  hatch: "thud_nest_hatch",
  lob: "thud_lob",
  drill: "thud_break",
  splash: "thud_splash",
  quake: "deck_shake",
  shield: "thud_shield",
  clone: "thud_clone",
};

/** Where the pouch sits for an aim: pulled back opposite the launch direction. */
export function pouchAt(sling, angle, power, pull = 70) {
  const rad = (angle * Math.PI) / 180;
  return [sling.x - Math.cos(rad) * power * pull, sling.y + Math.sin(rad) * power * pull];
}

/**
 * The world view. Options: `mode` "host" | "phone", `you` (a player id: highlights your bird and
 * cursor), `onFx(fx)` for each new effect (notifications, rumble), `sound` (host: all effects;
 * phone: only a few), `maxDpr`.
 */
export function createThudView(canvas, { mode = "host", you = null, onFx = null, sound = true, maxDpr = 2 } = {}) {
  const ctx = canvas.getContext("2d");
  const fx = createParticles({ max: mode === "host" ? 260 : 150 });
  let g = null;
  let prev = new Map();
  let cur = new Map();
  let prevAt = 0;
  let curAt = 0;
  let lastTick = -1;
  let seenFx = null;
  let session = null;
  let backdrop = null;
  let raf = 0;
  let destroyed = false;
  let lastFrame = performance.now();
  const t0 = performance.now();
  const cam = { x: 1200, y: 500, s: 0.3, ready: false };
  let camMode = "auto";
  let shake = 0;
  let flash = 0;
  let ghost = null;
  let aimOverride = null;
  const hurt = new Map();
  const tornadoes = [];
  const bolts = [];
  let cowPhaseAt = 0;
  let lastPhase = null;

  // ---------------------------------------------------------------- state in

  function update(next) {
    if (next.session !== session) {
      session = next.session;
      seenFx = null;
      prev = new Map();
      cur = new Map();
      backdrop = null;
    }
    const level = g?.level;
    g = next;
    if (!level || level.id !== next.level.id) backdrop = null;
    if (next.phase !== lastPhase) {
      if (next.phase === "COW") cowPhaseAt = performance.now();
      lastPhase = next.phase;
    }
    const now = performance.now();
    if (next.tick !== lastTick || cur.size === 0 || next.world.rows.length !== cur.size) {
      prev = cur;
      prevAt = curAt;
      cur = new Map(next.world.rows.map((r) => [r[0], r]));
      curAt = now;
      lastTick = next.tick;
    }
    // Effects: only ones we haven't seen, and none from before this screen joined.
    const list = next.world.fx ?? [];
    if (seenFx === null) seenFx = list.length ? list[list.length - 1].id : 0;
    for (const e of list) {
      if (e.id <= seenFx) continue;
      seenFx = e.id;
      spawn(e);
    }
  }

  function spawn(e) {
    const color = MATERIAL_COLORS[e.a] ?? "#b9803f";
    switch (e.t) {
      case "break":
        fx.burst("debris", e.x, e.y, 12, { color: [color, "#3a2410", "#ffffff"] });
        fx.burst("dust", e.x, e.y, 5);
        break;
      case "pop":
        fx.burst("confetti", e.x, e.y, 14, { color: ["#8ccf4d", "#f5c518", "#6f9a2e", "#ffffff"] });
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(140, 207, 77, 0.9)", grow: 160 });
        fx.emit("text", e.x, e.y - 30, { font: "900 1px system-ui, sans-serif", size: 60, text: e.a === "boss" ? "THUD DOWN!" : ["OINK!", "SQUEE", "NOT THE HAT", "HUSKED"][e.id % 4], color: "#d7ff9a" });
        shake = Math.max(shake, e.a === "boss" ? 14 : 5);
        break;
      case "hit":
        hurt.set(nearestPig(e.x, e.y), performance.now());
        fx.burst("spark", e.x, e.y, 6, { color: "#fff3a0" });
        break;
      case "boom": {
        const radius = Number(String(e.a ?? "").split(":")[1]) || 120;
        fx.burst("ring", e.x, e.y, 2, { color: "rgba(255, 200, 80, 0.9)", grow: radius * 2.4 });
        fx.burst("spark", e.x, e.y, 22, { color: ["#ffd166", "#ff7b00", "#ffffff"], speed: 520 });
        fx.burst("debris", e.x, e.y, 10, { color: ["#3a2410", "#ff7b00"] });
        fx.burst("dust", e.x, e.y, 8, { color: "rgba(80, 60, 50, 0.6)" });
        shake = Math.max(shake, 10);
        flash = Math.max(flash, 0.35);
        break;
      }
      case "dust":
        fx.burst("dust", e.x, e.y, 3);
        break;
      case "bounce":
        fx.burst("dust", e.x, e.y, 3, { color: "rgba(255,255,255,0.5)" });
        break;
      case "drill":
        fx.burst("spark", e.x, e.y, 10, { color: "#c8d6ff" });
        fx.burst("debris", e.x, e.y, 8, { color: [color] });
        break;
      case "launch":
        fx.burst("dust", e.x, e.y + 20, 6);
        break;
      case "ability":
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(255, 255, 255, 0.95)", grow: 140 });
        fx.emit("text", e.x, e.y - 26, { font: "900 1px system-ui, sans-serif", size: 54, text: { pop: "POP!", boost: "ZOOM", split: "×3", ricochet: "BOING", slam: "CHONK", magnet: "MAGNET", bunker: "BUNKER!" }[e.a] ?? "!", color: "#ffd400" });
        break;
      case "rebuild":
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(140, 255, 120, 0.8)", grow: 70 });
        fx.burst("confetti", e.x, e.y, 5, { color: ["#8ccf4d", "#f5c518"], speed: 120 });
        break;
      case "heal":
        fx.emit("text", e.x, e.y, { font: "900 1px system-ui, sans-serif", text: "+", color: "#9dff7a", size: 40 });
        break;
      case "reinforce":
        fx.burst("spark", e.x, e.y, 5, { color: "#c6ccd4" });
        break;
      case "bolt":
        bolts.push({ x: e.x, y: e.y, at: performance.now() });
        flash = Math.max(flash, 0.8);
        fx.burst("spark", e.x, e.y, 16, { color: ["#fffbe0", "#9fe8ff"], speed: 420 });
        break;
      case "tornado":
        tornadoes.push({ x: e.x, r: Number(e.a) || 180, at: performance.now() });
        break;
      case "quake":
        shake = Math.max(shake, 18);
        break;
      case "hail":
        fx.burst("spark", e.x, e.y - 10, 4, { color: "#ffffff", speed: 160 });
        break;
      case "splash":
        fx.burst("dust", e.x, e.y, 8, { color: "rgba(120, 190, 255, 0.7)" });
        break;
      case "hatch":
        fx.burst("confetti", e.x, e.y, 16);
        fx.emit("text", e.x, e.y - 20, { font: "900 1px system-ui, sans-serif", size: 50, text: "+1 BIRD", color: "#ffd400" });
        break;
      case "build":
        fx.burst("dust", e.x, e.y, 8);
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(255, 212, 0, 0.8)", grow: 90 });
        break;
      case "poof":
        fx.burst("dust", e.x, e.y, 6, { color: "rgba(255,255,255,0.6)" });
        break;
      case "clone":
        fx.burst("ring", e.x, e.y, 2, { color: "rgba(120, 255, 160, 0.9)", grow: 120 });
        fx.burst("confetti", e.x, e.y, 10, { color: ["#8cffb0", "#ffffff"] });
        break;
      case "shield":
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(90, 200, 255, 0.8)", grow: 120 });
        break;
      case "broke":
        fx.burst("spark", e.x, e.y, 14, { color: ["#ffd166", "#ffffff"] });
        break;
      case "land":
        fx.burst("dust", e.x, e.y + 10, 5);
        break;
      case "lob":
        fx.burst("dust", e.x, e.y, 3);
        break;
      default:
        break;
    }
    if (sound && FX_SOUND[e.t]) playSfx(FX_SOUND[e.t], { volume: mode === "host" ? 0.9 : 0.6 });
    onFx?.(e);
  }

  function nearestPig(x, y) {
    let best = null;
    let d = Infinity;
    for (const r of cur.values()) {
      if (r[1] !== "p") continue;
      const dd = Math.hypot(r[3] - x, r[4] - y);
      if (dd < d) {
        d = dd;
        best = r[0];
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- camera

  function frameFor(width, height) {
    const L = g.level;
    const whole = () => {
      const s = Math.min(width / (L.width + 40), height / (L.groundY + 140 - 60));
      return { x: L.width / 2, y: L.groundY + 120 - height / s / 2, s };
    };
    const phone = (cx, cy, span) => {
      const s = Math.min(width / span, height / (span * 0.62));
      return { x: cx, y: Math.min(cy, L.groundY + 110 - height / s / 2), s };
    };
    // The Red Cow's moment: every screen pans in to watch it grow.
    if (g.phase === "COW") return phone(L.cowX - 160, L.groundY - 200, 900);
    if (camMode === "map" || mode === "host") return whole();
    if (g.phase === "BUILD" || g.phase === "SELECT" || g.phase === "LAUNCH") return phone(430, L.groundY - 220, 980);
    if (g.phase === "ACTION") {
      const bird = [...cur.values()].find((r) => r[1] === "B");
      if (bird) return phone(Math.max(700, bird[3] + 200), Math.min(bird[4], L.groundY - 260), 1500);
      return phone(900, L.groundY - 300, 1650);
    }
    return phone(1500, L.groundY - 300, 1800);
  }

  function moveCamera(width, height, dt) {
    const target = frameFor(width, height);
    if (!cam.ready || reducedMotion()) {
      Object.assign(cam, target, { ready: true });
      return;
    }
    const k = 1 - Math.exp(-dt * (g.phase === "ACTION" ? 5 : 3));
    cam.x += (target.x - cam.x) * k;
    cam.y += (target.y - cam.y) * k;
    cam.s += (target.s - cam.s) * k;
  }

  // ---------------------------------------------------------------- backdrop cache

  function ensureBackdrop(scale) {
    const L = g.level;
    const s = Math.min(1, Math.max(0.2, scale));
    if (backdrop && backdrop.theme === L.theme && Math.abs(backdrop.s - s) / s < 0.2) return backdrop;
    const W = L.width + 800;
    const H = L.groundY + 400 - TOP;
    const off = document.createElement("canvas");
    off.width = Math.ceil(W * s);
    off.height = Math.ceil(H * s);
    const c = off.getContext("2d");
    c.scale(s, s);
    c.translate(400, -TOP);
    paintBackdrop(c, L, { top: TOP });
    backdrop = { canvas: off, s, theme: L.theme };
    return backdrop;
  }

  // ---------------------------------------------------------------- drawing

  const lerpRow = (r, k) => {
    const p = prev.get(r[0]);
    if (!p || k >= 1) return [r[3], r[4], r[5] / 1000];
    let da = r[5] / 1000 - p[5] / 1000;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    return [p[3] + (r[3] - p[3]) * k, p[4] + (r[4] - p[4]) * k, p[5] / 1000 + da * k];
  };

  function birdLookOf(sub) {
    const [type, skin] = String(sub).split(":");
    return lookFor(type, skin ?? "classic");
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !canvas.isConnected) return;
    schedule();
    if (!g) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = (now - t0) / 1000;
    const { width, height, dpr } = fitCanvas(canvas, maxDpr);
    if (!width || !height) return;
    moveCamera(width, height, dt);
    const L = g.level;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, width, height);
    const sx = shake > 0.3 && !reducedMotion() ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0.3 && !reducedMotion() ? (Math.random() - 0.5) * shake : 0;
    shake *= Math.exp(-dt * 7);
    ctx.save();
    ctx.translate(width / 2 + sx, height / 2 + sy);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x, -cam.y);
    // Backdrop.
    const bd = ensureBackdrop(cam.s * dpr);
    ctx.drawImage(bd.canvas, -400, TOP, bd.canvas.width / bd.s, bd.canvas.height / bd.s);
    // The Red Cow (animated in its cutscene).
    let cow = g.cow.progress;
    let workers = 2;
    if (g.phase === "COW" && g.cow.scene) {
      const k = Math.min(1, Math.max(0, (now - cowPhaseAt - 900) / 2200));
      cow = g.cow.scene.from + (g.cow.scene.to - g.cow.scene.from) * (1 - (1 - k) ** 3);
      workers = 6;
      if (k > 0 && k < 1 && Math.random() < 0.3) fx.burst("spark", L.cowX - 100 + Math.random() * 200, L.groundY - 330 * cow, 2, { color: "#ffd166" });
    }
    drawRedCow(ctx, L.cowX, L.groundY, cow, { t, workers });
    const k = curAt > prevAt ? Math.min(1, (now - INTERP_MS - prevAt) / Math.max(1, curAt - prevAt)) : 1;
    // Kernel shields' domes, behind everything they cover.
    for (const s of g.build.structures) {
      if (s.type !== "shield" || s.disabled) continue;
      const a = 0.08 + 0.18 * Math.min(1, s.charge / (g.build.shield.chargePerTurn || 90));
      ctx.beginPath();
      ctx.arc(s.x, L.groundY, g.build.shield.radius, Math.PI, 0);
      ctx.fillStyle = `rgba(90, 200, 255, ${a})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(160, 230, 255, ${a * 2.5})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Shield piggies' bubbles.
    for (const r of cur.values()) {
      if (r[1] !== "p" || !(r[9] & 128)) continue;
      const [x, y] = lerpRow(r, k);
      ctx.beginPath();
      ctx.arc(x, y, 170, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(94, 200, 255, ${0.06 + Math.sin(t * 2) * 0.02})`;
      ctx.fill();
      ctx.strokeStyle = "rgba(94, 200, 255, 0.35)";
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    fx.update(dt);
    fx.draw(ctx, "back");
    // Bodies.
    const sling = L.sling;
    for (const r of cur.values()) {
      const [x, y, a] = lerpRow(r, k);
      const [, code, sub, , , , hw, hh, crack, flags] = r;
      if (code === "b") {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        drawBlock(ctx, sub, hw, hh, { crack, reinforced: !!(flags & 1), t, seed: r[0] });
        ctx.restore();
      } else if (code === "h") {
        const [type, tier] = String(sub).split(":");
        const s = g.build.structures.find((q) => q.id === r[0]);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        drawBuilding(ctx, type, Number(tier) || 1, hw, hh, { t, disabled: !!(flags & 4), broken: !!(flags & 8), waterlogged: !!(flags & 16), crack, progress: s?.progress ?? 0 });
        ctx.restore();
        if (s?.breeders?.length && g.phase === "BUILD") {
          const names = s.breeders.map((id) => g.roster.find((p) => p.id === id)?.name ?? "?").join(" + ");
          label(ctx, `♥ ${names} · 1 more`, x, y - hh - 16, 14 / Math.max(0.3, cam.s) / 2.2, "#ff9ad8");
        }
      } else if (code === "p") {
        const hitAt = hurt.get(r[0]) ?? -1e9;
        if (flags & 256) drawChute(ctx, x, y - hw * 2.4, hw);
        drawPig(ctx, sub, { x, y, r: hw, angle: a, t, crack, hurt: Math.max(0, 1 - (now - hitAt) / 400), state: g.phase === "PROCESS" ? "smug" : "idle" });
      } else if (code === "B") {
        const look = birdLookOf(sub);
        const p = prev.get(r[0]);
        const vx = p ? r[3] - p[3] : 1;
        const vy = p ? r[4] - p[4] : 0;
        const burning = flags & 32;
        if (burning) fx.burst("spark", x - vx * 0.5, y - vy * 0.5, 1, { color: "#ff9a3d", speed: 60 });
        if (flags & 64) {
          ctx.beginPath();
          ctx.arc(x, y, 60 + Math.sin(t * 20) * 8, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(160, 120, 255, 0.6)";
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        const mine = you !== null && r[10] === g.roster.findIndex((q) => q.id === you);
        drawBird(ctx, look, { x, y, r: hw, angle: Math.hypot(vx, vy) > 0.5 ? Math.atan2(vy, vx) * 0.6 : 0, state: "fly", t, outline: mine ? "#ffffff" : null });
      } else if (code === "x") {
        ctx.beginPath();
        ctx.ellipse(x, y, hw * 0.8, hw * 1.2, a, 0, Math.PI * 2);
        ctx.fillStyle = "#f5c518";
        ctx.fill();
        ctx.strokeStyle = "#5a3a00";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 90, 40, ${0.5 + Math.sin(t * 30) * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y - hw * 1.3, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The slingshot, with the next bird in its pouch while someone aims.
    const shooter = g.action?.shooterId ? g.roster.find((p) => p.id === g.action.shooterId) : null;
    const aiming = g.phase === "ACTION" && g.action?.stage === "AIM" && shooter;
    const aim = aiming ? (aimOverride && shooter.id === you ? aimOverride() : g.action.aim) : null;
    const pouch = aim ? pouchAt(sling, aim.a, aim.p) : null;
    drawSling(ctx, sling.x, sling.y + 40, { pouch, back: true });
    if (aim && shooter) {
      const type = shooter.birds[shooter.selected] ?? shooter.bird;
      const r = 16;
      // The arc: the first stretch of the flight, shorter in fog.
      const pts = arc(sling, aim.a, aim.p, { seconds: g.world.fogFrom ? 0.35 : 0.75, dt: 0.05 });
      ctx.fillStyle = shooter.id === you ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.5)";
      pts.forEach(([px, py], i) => {
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.5, 4.5 - i * 0.2), 0, Math.PI * 2);
        ctx.fill();
      });
      drawBird(ctx, lookFor(type, shooter.skin), { x: pouch[0], y: pouch[1], r, state: "sling", t, outline: shooter.id === you ? "#ffffff" : null });
    }
    drawSling(ctx, sling.x, sling.y + 40, { pouch, back: false });
    // Build-phase cursors: everyone's agent marker where they're looking to build.
    if (g.phase === "BUILD") {
      for (const p of g.roster) {
        if (p.cursor === null || p.cursor === undefined) continue;
        const cx = p.cursor;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(cx, L.groundY - 4);
        ctx.lineTo(cx - 9, L.groundY - 22);
        ctx.lineTo(cx + 9, L.groundY - 22);
        ctx.closePath();
        ctx.fill();
        label(ctx, p.name, cx, L.groundY - 30, 11 / Math.max(0.3, cam.s) / 2.4, p.color);
      }
      if (ghost) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.translate(ghost.x, L.groundY - ghost.h / 2);
        drawBuilding(ctx, ghost.type, 1, ghost.w / 2, ghost.h / 2, { t });
        ctx.restore();
        ctx.strokeStyle = ghost.ok ? "#7dff6a" : "#ff4d4d";
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(ghost.x - ghost.w / 2, L.groundY - ghost.h, ghost.w, ghost.h);
        ctx.setLineDash([]);
        if (ghost.type === "shield") {
          ctx.beginPath();
          ctx.arc(ghost.x, L.groundY, g.build.shield.radius, Math.PI, 0);
          ctx.strokeStyle = "rgba(90, 200, 255, 0.6)";
          ctx.stroke();
        }
      }
      // Zones, brighter while building.
      ctx.fillStyle = "rgba(255, 212, 0, 0.08)";
      for (const [za, zb] of L.zones) ctx.fillRect(za, L.groundY - 200, zb - za, 200);
    }
    fx.draw(ctx, "front");
    // Water (floods).
    if (g.world.water !== null && g.world.water !== undefined) {
      const wy = g.world.water;
      ctx.fillStyle = "rgba(40, 110, 190, 0.45)";
      ctx.fillRect(-400, wy, L.width + 800, L.groundY + 400 - wy);
      ctx.strokeStyle = "rgba(200, 235, 255, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = -400; x < L.width + 400; x += 20) ctx.lineTo(x, wy + Math.sin(x / 40 + t * 2) * 3);
      ctx.stroke();
    }
    // Tornadoes and lightning bolts (in world space).
    for (let i = tornadoes.length - 1; i >= 0; i--) {
      const tw = tornadoes[i];
      const age = (now - tw.at) / 1000;
      if (age > 2.2) {
        tornadoes.splice(i, 1);
        continue;
      }
      const a = Math.min(1, age * 3, (2.2 - age) * 2);
      for (let j = 0; j < 14; j++) {
        const yy = L.groundY - j * 34;
        const ww = 20 + j * j * 1.6;
        ctx.strokeStyle = `rgba(190, 190, 200, ${0.35 * a})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.ellipse(tw.x + Math.sin(t * 8 + j) * 12, yy, ww, 7, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const age = (now - b.at) / 1000;
      if (age > 0.45) {
        bolts.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(255, 255, 220, ${1 - age * 2})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      let bx = b.x + 60;
      ctx.moveTo(bx, TOP);
      for (let yy = TOP; yy < b.y; yy += 60) {
        bx = b.x + (Math.sin(yy * 0.13 + b.at) * 40 * (b.y - yy)) / (b.y - TOP);
        ctx.lineTo(bx, yy);
      }
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    weatherInWorld(ctx, t, L);
    ctx.restore();
    // Screen-space weather: fog, darkness, flashes.
    weatherOnScreen(ctx, width, height, t);
    if (flash > 0.02) {
      ctx.fillStyle = `rgba(255, 255, 240, ${flash})`;
      ctx.fillRect(0, 0, width, height);
      flash *= Math.exp(-dt * 8);
    }
    windBadge(ctx, width);
  }

  function weatherInWorld(ctx, t, L) {
    const w = g.weather;
    const type = w?.type;
    const rain = type === "heavy_rain" || type === "acid_rain" || type === "thunderstorm" || type === "flood" || w?.secondary === "Heavy Rain";
    if (rain && !reducedMotion()) {
      ctx.strokeStyle = type === "acid_rain" ? "rgba(160, 255, 90, 0.55)" : "rgba(190, 215, 255, 0.45)";
      ctx.lineWidth = 2;
      const wind = (g.world.wind ?? 0) / 600;
      ctx.beginPath();
      for (let i = 0; i < 220; i++) {
        const x = ((i * 97.3 + t * 900 * wind) % (L.width + 400)) - 200;
        const y = ((i * 57.7 + t * 1400) % (L.groundY - TOP)) + TOP;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 8 * wind * 3, y + 22);
      }
      ctx.stroke();
    }
    if ((g.world.wind ?? 0) !== 0 && !reducedMotion()) {
      const dir = Math.sign(g.world.wind);
      const strength = Math.min(1, Math.abs(g.world.wind) / 600);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + strength * 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 40; i++) {
        const x = ((i * 211 + dir * t * (300 + strength * 900)) % (L.width + 600) + L.width + 600) % (L.width + 600) - 300;
        const y = TOP + 100 + ((i * 131) % (L.groundY - TOP - 150));
        ctx.moveTo(x, y);
        ctx.lineTo(x + dir * (40 + strength * 80), y);
      }
      ctx.stroke();
    }
    if (type === "heat_wave") {
      ctx.fillStyle = `rgba(255, 140, 40, ${0.08 + Math.sin(t * 3) * 0.03})`;
      ctx.fillRect(-400, TOP, L.width + 800, L.groundY - TOP);
    }
    if (g.world.obscure) {
      ctx.fillStyle = "rgba(150, 110, 60, 0.55)";
      for (let i = 0; i < g.world.obscure; i++) {
        const cx = 1150 + ((i * 373 + t * 40) % 1000);
        ctx.fillRect(cx - 120, TOP, 240, L.groundY - TOP);
      }
    }
    if (g.world.fogFrom) {
      const f = ctx.createLinearGradient(g.world.fogFrom - 200, 0, g.world.fogFrom + 250, 0);
      f.addColorStop(0, "rgba(200, 205, 215, 0)");
      f.addColorStop(1, "rgba(200, 205, 215, 0.93)");
      ctx.fillStyle = f;
      ctx.fillRect(g.world.fogFrom - 200, TOP, L.width + 600 - g.world.fogFrom, L.groundY - TOP + 200);
    }
  }

  function weatherOnScreen(ctx, width, height, t) {
    if (g.world.dark) {
      ctx.fillStyle = `rgba(4, 6, 14, ${g.world.dark})`;
      ctx.fillRect(0, 0, width, height);
      if (!reducedMotion() && Math.sin(t * 1.7) > 0.995) flash = 0.5;
    }
  }

  function windBadge(ctx, width) {
    const wind = g.world.wind ?? 0;
    if (!wind || g.phase !== "ACTION") return;
    const text = `WIND ${wind > 0 ? "→" : "←"} ${Math.abs(Math.round(wind / 10))}`;
    ctx.font = "700 13px 'Roboto Mono', monospace";
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(width - w - 8, 8, w, 22);
    ctx.fillStyle = "#9fe8ff";
    ctx.fillText(text, width - w, 24);
  }

  function label(ctx, text, x, y, size, color) {
    ctx.save();
    ctx.font = `800 ${Math.max(8, size * 2.2)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = Math.max(2, size * 0.5);
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawChute(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, Math.PI, 0);
    ctx.fillStyle = "#e7c24a";
    ctx.fill();
    ctx.strokeStyle = "#6f9a2e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - r * 1.8, y);
    ctx.lineTo(x, y + r * 2.4);
    ctx.lineTo(x + r * 1.8, y);
    ctx.stroke();
  }

  function schedule() {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  }
  schedule();

  /** Screen point → world point (for placing buildings and pulling the sling). */
  function toWorld(px, py) {
    const rect = canvas.getBoundingClientRect();
    return [(px - rect.left - rect.width / 2) / cam.s + cam.x, (py - rect.top - rect.height / 2) / cam.s + cam.y];
  }

  return {
    update,
    toWorld,
    /** { type, x, w, h, ok } or null. */
    setGhost(next) {
      ghost = next;
    },
    /** A function giving this phone's live aim ({ a, p }) so the pouch follows the finger instantly. */
    setAim(fn) {
      aimOverride = fn;
    },
    setCamera(next) {
      camMode = next;
    },
    get camera() {
      return camMode;
    },
    get scale() {
      return cam.s;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
    },
  };
}
