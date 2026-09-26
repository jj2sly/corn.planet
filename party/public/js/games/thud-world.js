// Angry Thud's Revenge: draws the world on a canvas, on the host screen and on phones. The server
// runs the physics at a fixed tick and sends body snapshots (20 a second while something moves);
// this draws a moment a tenth of a second behind them, smoothly between snapshots (thud-interp.js),
// so birds glide at the screen's own frame rate however the packets arrive. It frames a camera for
// the moment (the whole field on the big screen; the sling, the bird or your build zone on a
// phone), turns the server's effects into particles, light and sound as the drawing reaches them,
// and paints the weather. It decides nothing.

import { drawBird } from "../cpi/bird.js";
import { createParticles } from "../cpi/particles.js";
import { fitCanvas } from "../drawing-canvas.js";
import { playSfx } from "./mycob-sound.js";
import { drawBlock, drawBuilding, drawPig, drawRedCow, drawSling, MATERIAL_COLORS, paintBackdrop } from "./thud-art.js";
import { lookFor } from "./thud-birds.js";
import { createSnapshotBuffer } from "./thud-interp.js";
import { arc } from "./thud-rules.js";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
/** How far behind the physics the drawing runs: two ticks, so one late packet never starves it. */
const DELAY_MS = 100;
const TOP = -420;
/** An effect that waited longer than this (a hidden tab catching up) is shown without sound. */
const STALE_MS = 1000;

/** How many things breaking at once count as a chain reaction (presentation only). */
const CHAIN_AT = 6;

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

/** What a broken block throws out, by material: chunks, dust, and their colours. */
const BREAK_LOOK = {
  wood: { debris: ["#c98f4d", "#8a5626", "#e0b074"], size: 6, dust: "rgba(214, 180, 130, 0.55)" },
  stone: { debris: ["#9ba0a8", "#6f747c", "#b9bec5"], size: 6, dust: "rgba(170, 170, 175, 0.6)" },
  vault: { debris: ["#8994a2", "#ffd23f"], size: 5, dust: "rgba(170, 170, 175, 0.5)" },
  metal: { debris: ["#c4cbd4", "#77808c"], size: 4, dust: null, sparks: true },
  glass: { shards: ["rgba(220, 245, 255, 0.95)", "rgba(160, 215, 245, 0.85)", "#ffffff"] },
  ice: { shards: ["rgba(240, 253, 255, 0.95)", "rgba(180, 230, 250, 0.9)"] },
  corn: { debris: ["#f5c518", "#ffe27a", "#c79a2e"], size: 3.5, dust: "rgba(245, 220, 140, 0.45)" },
  totem: { debris: ["#8a5ad6", "#472283"], size: 5, dust: "rgba(190, 90, 255, 0.4)", glow: "#ff5ae0" },
};

/** A small number from an id (block textures vary by it, and stay put). */
function seedOf(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 4;
}

/** Where the pouch sits for an aim: pulled back opposite the launch direction. */
export function pouchAt(sling, angle, power, pull = 70) {
  const rad = (angle * Math.PI) / 180;
  return [sling.x - Math.cos(rad) * power * pull, sling.y + Math.sin(rad) * power * pull];
}

/** A jagged bolt from the sky to (x, y), with a couple of forks. */
function boltPath(x, y) {
  const main = [];
  let bx = x + (Math.random() - 0.5) * 160;
  for (let yy = TOP; yy < y; yy += 38) {
    main.push([bx, yy]);
    bx += (Math.random() - 0.5) * 56 + (x - bx) * 0.16;
  }
  main.push([x, y]);
  const forks = [];
  for (let f = 0; f < 3; f++) {
    const from = main[2 + Math.floor(Math.random() * Math.max(1, main.length - 5))];
    if (!from) continue;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const fork = [from];
    let [fx, fy] = from;
    for (let s = 0; s < 4; s++) {
      fx += dir * (14 + Math.random() * 24);
      fy += 22 + Math.random() * 20;
      fork.push([fx, fy]);
    }
    forks.push(fork);
  }
  return { main, forks };
}

/**
 * The world view. Options: `mode` "host" | "phone", `you` (a player id: highlights your bird and
 * cursor), `onFx(fx)` for each effect as it's shown (notifications, rumble), `sound` (host: all
 * effects; phone: only a few), `maxDpr`.
 */
export function createThudView(canvas, { mode = "host", you = null, onFx = null, sound = true, maxDpr = 2 } = {}) {
  const ctx = canvas.getContext("2d");
  const fx = createParticles({ max: mode === "host" ? 380 : 220 });
  const buf = createSnapshotBuffer({ delayMs: DELAY_MS });
  let g = null;
  /** This frame's bodies, smoothed ({ row, x, y, a, vx, vy, leaving }). */
  let bodies = [];
  let seenFx = null;
  let session = null;
  let backdrop = null;
  let raf = 0;
  let destroyed = false;
  let lastFrame = performance.now();
  let frameStart = 0;
  const t0 = performance.now();
  const cam = { x: 1200, y: 500, s: 0.3, ready: false };
  let camMode = "auto";
  let shake = 0;
  let flash = 0;
  /** A brief zoom punch on big hits (camera feedback), decaying. */
  let kick = 0;
  let ghost = null;
  let aimOverride = null;
  /** Someone else's aim, eased between the updates it arrives in. */
  const shownAim = { a: 0, p: 0, who: null };
  /** The last bird drawn in the pouch: stays there until its launch is shown. */
  let loaded = null;
  let twangAt = -1e9;
  const hurt = new Map();
  const tornadoes = [];
  const bolts = [];
  const fireballs = [];
  const trails = new Map();
  const facing = new Map();
  let cowPhaseAt = 0;
  let lastPhase = null;
  let groundTops = null;
  /** Block sprites by scale bucket: a block's detailed texture is drawn once, then just blitted. */
  const spriteSets = new Map();
  let shadowSprite = null;
  let vignette = null;

  // ---------------------------------------------------------------- state in

  function update(next) {
    if (next.session !== session) {
      session = next.session;
      seenFx = null;
      buf.reset();
      backdrop = null;
      trails.clear();
      facing.clear();
      spriteSets.clear();
    }
    const level = g?.level;
    g = next;
    if (!level || level.id !== next.level.id) {
      backdrop = null;
      groundTops = null;
    }
    if (next.phase !== lastPhase) {
      if (next.phase === "COW") cowPhaseAt = performance.now();
      lastPhase = next.phase;
    }
    const now = performance.now();
    buf.push(next.tick ?? 0, next.tickMs ?? 50, next.world.rows, now);
    // Effects: only ones we haven't seen, and none from before this screen joined. They're shown
    // when the drawing reaches the snapshot they came with.
    const list = next.world.fx ?? [];
    if (seenFx === null) seenFx = list.length ? list[list.length - 1].id : 0;
    const fresh = list.filter((e) => e.id > seenFx);
    if (fresh.length) {
      seenFx = fresh[fresh.length - 1].id;
      buf.hold(fresh, now);
    }
  }

  function releaseFx(now) {
    let wrecked = 0;
    for (const { item: e, waitedMs } of buf.due(now)) {
      if (e.t === "break" || e.t === "pop" || e.t === "boom") wrecked += 1;
      spawn(e, now, waitedMs > STALE_MS);
    }
    // A big collapse at once reads as a chain reaction: one sting, a bigger shake.
    if (wrecked >= CHAIN_AT) {
      shake = Math.max(shake, Math.min(16, 6 + wrecked));
      kick = Math.max(kick, 1);
      fx.emit("text", cam.x, cam.y - 120 / Math.max(0.2, cam.s), { font: "900 1px system-ui, sans-serif", size: Math.min(90, 34 / Math.max(0.2, cam.s)), text: `CHAIN ×${wrecked}`, color: "#ffd400" });
      if (sound) playSfx("thud_chain", { volume: mode === "host" ? 0.9 : 0.6 });
      onFx?.({ t: "chain", n: wrecked });
    }
  }

  function spawn(e, now, stale) {
    const color = MATERIAL_COLORS[e.a] ?? "#b9803f";
    switch (e.t) {
      case "break":
        breakFx(e, color);
        break;
      case "pop":
        fx.burst("dust", e.x, e.y, 10, { color: ["rgba(140, 207, 77, 0.6)", "rgba(200, 240, 150, 0.5)"], size: 12, grow: 34, speed: 150 });
        fx.burst("confetti", e.x, e.y, 16, { color: ["#8ccf4d", "#f5c518", "#6f9a2e", "#ffffff"] });
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(140, 207, 77, 0.9)", grow: 160 });
        fx.emit("glow", e.x, e.y, { color: "#b6ff7a", size: 24, grow: 150, life: 0.3 });
        fx.emit("text", e.x, e.y - 30, { font: "900 1px system-ui, sans-serif", size: 60, text: e.a === "boss" ? "THUD DOWN!" : ["OINK!", "SQUEE", "NOT THE HAT", "HUSKED"][e.id % 4], color: "#d7ff9a" });
        shake = Math.max(shake, e.a === "boss" ? 14 : 5);
        kick = Math.max(kick, e.a === "boss" ? 1 : 0.4);
        break;
      case "hit":
        hurt.set(nearestPig(e.x, e.y), now);
        fx.burst("spark", e.x, e.y, 8, { color: ["#fff3a0", "#ffffff"] });
        fx.emit("ring", e.x, e.y, { size: 4, grow: 90, life: 0.25, color: "rgba(255, 255, 255, 0.75)" });
        break;
      case "boom":
        explosion(e, now);
        break;
      case "dust":
        fx.burst("dust", e.x, e.y, 3);
        break;
      case "bounce":
        fx.burst("dust", e.x, e.y, 3, { color: "rgba(255,255,255,0.5)" });
        fx.emit("ring", e.x, e.y, { size: 3, grow: 60, life: 0.2, color: "rgba(255, 255, 255, 0.6)" });
        break;
      case "drill":
        fx.burst("spark", e.x, e.y, 10, { color: "#c8d6ff" });
        fx.burst("debris", e.x, e.y, 8, { color: [color] });
        break;
      case "launch":
        fx.burst("dust", e.x, e.y + 20, 6);
        fx.emit("ring", e.x, e.y, { size: 6, grow: 110, life: 0.3, color: "rgba(255, 255, 255, 0.7)" });
        twangAt = now;
        loaded = null;
        // The last shot's trail makes way for this one.
        for (const [id, tr] of trails) if (now - tr.last > 150) trails.delete(id);
        break;
      case "ability":
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(255, 255, 255, 0.95)", grow: 140 });
        fx.emit("glow", e.x, e.y, { color: "#ffe066", size: 20, grow: 120, life: 0.28 });
        fx.emit("text", e.x, e.y - 26, { font: "900 1px system-ui, sans-serif", size: 54, text: { pop: "POP!", boost: "ZOOM", split: "×3", ricochet: "BOING", slam: "CHONK", magnet: "MAGNET", bunker: "BUNKER!" }[e.a] ?? "!", color: "#ffd400" });
        if (e.a === "boost") fx.burst("ember", e.x, e.y, 10, { vx: -200 });
        if (e.a === "slam") shake = Math.max(shake, 6);
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
        bolts.push({ x: e.x, y: e.y, at: now, path: boltPath(e.x, e.y) });
        flash = Math.max(flash, 0.8);
        fx.burst("spark", e.x, e.y, 16, { color: ["#fffbe0", "#9fe8ff"], speed: 420 });
        fx.emit("glow", e.x, e.y, { color: "#9fd8ff", size: 40, grow: 220, life: 0.4 });
        fx.burst("smoke", e.x, e.y, 4, { size: 10 });
        break;
      case "tornado":
        tornadoes.push({ x: e.x, r: Number(e.a) || 180, at: now });
        break;
      case "quake":
        shake = Math.max(shake, 18);
        for (let i = 0; i < 8; i++) fx.burst("dust", 200 + i * 280 + Math.random() * 100, g.level.groundY - 4, 3, { size: 10, grow: 24, color: "rgba(160, 130, 90, 0.55)" });
        break;
      case "hail":
        fx.burst("spark", e.x, e.y - 10, 4, { color: "#ffffff", speed: 160 });
        fx.burst("shard", e.x, e.y, 3, { color: ["#ffffff", "rgba(220, 240, 255, 0.9)"], size: 4, speed: 160 });
        break;
      case "splash":
        fx.burst("dust", e.x, e.y, 8, { color: "rgba(120, 190, 255, 0.7)" });
        fx.burst("shard", e.x, e.y, 6, { color: ["rgba(150, 210, 255, 0.85)", "rgba(220, 240, 255, 0.9)"], size: 4, speed: 200 });
        break;
      case "hatch":
        fx.burst("confetti", e.x, e.y, 16);
        fx.emit("glow", e.x, e.y, { color: "#ffe066", size: 16, grow: 90, life: 0.35 });
        fx.emit("text", e.x, e.y - 20, { font: "900 1px system-ui, sans-serif", size: 50, text: "+1 BIRD", color: "#ffd400" });
        break;
      case "build":
        fx.burst("dust", e.x, e.y, 10, { size: 9, grow: 20 });
        fx.burst("debris", e.x, e.y, 6, { color: ["#8a5626", "#c98f4d"], speed: 180 });
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(255, 212, 0, 0.8)", grow: 90 });
        break;
      case "poof":
        fx.burst("dust", e.x, e.y, 6, { color: "rgba(255,255,255,0.6)" });
        break;
      case "clone":
        fx.burst("ring", e.x, e.y, 2, { color: "rgba(120, 255, 160, 0.9)", grow: 120 });
        fx.emit("glow", e.x, e.y, { color: "#8cffb0", size: 18, grow: 100, life: 0.35 });
        fx.burst("confetti", e.x, e.y, 10, { color: ["#8cffb0", "#ffffff"] });
        break;
      case "shield":
        fx.burst("ring", e.x, e.y, 1, { color: "rgba(90, 200, 255, 0.8)", grow: 120 });
        fx.emit("glow", e.x, e.y, { color: "#5ec8ff", size: 18, grow: 90, life: 0.3 });
        break;
      case "broke":
        fx.burst("spark", e.x, e.y, 14, { color: ["#ffd166", "#ffffff"] });
        fx.burst("smoke", e.x, e.y, 5);
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
    if (stale) return;
    if (sound && FX_SOUND[e.t]) playSfx(FX_SOUND[e.t], { volume: mode === "host" ? 0.9 : 0.6 });
    onFx?.(e);
  }

  function breakFx(e, color) {
    const look = BREAK_LOOK[e.a];
    if (look?.shards) {
      fx.burst("shard", e.x, e.y, 14, { color: look.shards });
      fx.burst("spark", e.x, e.y, 4, { color: "#ffffff", speed: 200 });
      return;
    }
    fx.burst("debris", e.x, e.y, 12, { color: look?.debris ?? [color, "#3a2410"], size: look?.size ?? 4 });
    if (look?.dust !== null) fx.burst("dust", e.x, e.y, 6, { color: look?.dust ?? "rgba(214, 206, 190, 0.55)", size: 8, grow: 18 });
    if (look?.sparks) fx.burst("spark", e.x, e.y, 10, { color: ["#ffd166", "#ffffff"] });
    if (look?.glow) fx.emit("glow", e.x, e.y, { color: look.glow, size: 14, grow: 90, life: 0.3 });
  }

  function explosion(e, now) {
    const radius = Number(String(e.a ?? "").split(":")[1]) || 120;
    fireballs.push({ x: e.x, y: e.y, r: radius, at: now });
    fx.burst("ring", e.x, e.y, 2, { color: "rgba(255, 200, 80, 0.9)", grow: radius * 2.4 });
    fx.emit("glow", e.x, e.y, { color: "#ffb347", size: radius * 0.4, grow: radius * 2.2, life: 0.4 });
    fx.burst("spark", e.x, e.y, 18, { color: ["#ffd166", "#ff7b00", "#ffffff"], speed: 520 });
    fx.burst("ember", e.x, e.y, 16);
    fx.burst("debris", e.x, e.y, 10, { color: ["#3a2410", "#ff7b00", "#1c1410"] });
    fx.burst("smoke", e.x, e.y, 9, { size: radius * 0.14, grow: radius * 0.25 });
    shake = Math.max(shake, 10);
    kick = Math.max(kick, 1);
    flash = Math.max(flash, 0.3);
  }

  function nearestPig(x, y) {
    let best = null;
    let d = Infinity;
    for (const b of bodies) {
      if (b.row[1] !== "p") continue;
      const dd = Math.hypot(b.x - x, b.y - y);
      if (dd < d) {
        d = dd;
        best = b.row[0];
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
      const bird = bodies.find((b) => b.row[1] === "B" && !b.leaving);
      // Lead the bird a little in the way it's going, so you see what it's about to hit.
      if (bird) return phone(Math.max(700, bird.x + 200 + Math.max(-150, Math.min(260, bird.vx * 0.2))), Math.min(bird.y + Math.max(-80, Math.min(120, bird.vy * 0.12)), L.groundY - 260), 1500);
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
    // Position eases quicker than zoom: the frame follows, then settles.
    const kp = 1 - Math.exp(-dt * (g.phase === "ACTION" ? 6 : 3.5));
    const ks = 1 - Math.exp(-dt * 2.8);
    cam.x += (target.x - cam.x) * kp;
    cam.y += (target.y - cam.y) * kp;
    cam.s += (target.s - cam.s) * ks;
  }

  // ---------------------------------------------------------------- caches

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

  const bucketOf = (scale) => (scale <= 0.6 ? 0.5 : scale <= 1.3 ? 1 : 2);

  /**
   * A block's sprite at about this screen scale. New sprites are made within a few milliseconds a
   * frame; past that, a sprite made at another scale stands in (slightly soft) until a later frame
   * has time, so a camera zoom never stalls a frame repainting every block.
   */
  function blockSprite(m, hw, hh, crack, reinforced, seed, scale) {
    const q = bucketOf(scale);
    const key = `${m}|${hw}|${hh}|${crack}|${reinforced ? 1 : 0}|${seed}`;
    let set = spriteSets.get(q);
    if (!set) spriteSets.set(q, (set = new Map()));
    const hit = set.get(key);
    if (hit) return hit;
    if (performance.now() - frameStart > 6) {
      for (const other of spriteSets.values()) if (other.has(key)) return other.get(key);
    }
    if (set.size > 600) set.clear();
    const pad = 3;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil((hw + pad) * 2 * q));
    c.height = Math.max(1, Math.ceil((hh + pad) * 2 * q));
    const cx = c.getContext("2d");
    cx.scale(c.width / ((hw + pad) * 2), c.height / ((hh + pad) * 2));
    cx.translate(hw + pad, hh + pad);
    drawBlock(cx, m, hw, hh, { crack, reinforced, seed });
    const sprite = { canvas: c, pad };
    set.set(key, sprite);
    return sprite;
  }

  /** A soft dark oval, drawn stretched under anything near the ground. */
  function shadow() {
    if (shadowSprite) return shadowSprite;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 16;
    const x = c.getContext("2d");
    x.translate(32, 8);
    x.scale(1, 0.25);
    const gr = x.createRadialGradient(0, 0, 0, 0, 0, 32);
    gr.addColorStop(0, "rgba(0, 0, 0, 0.9)");
    gr.addColorStop(0.6, "rgba(0, 0, 0, 0.45)");
    gr.addColorStop(1, "rgba(0, 0, 0, 0)");
    x.fillStyle = gr;
    x.fillRect(-32, -32, 64, 64);
    shadowSprite = c;
    return c;
  }

  /** The top of the ground under x (null over a gap). */
  function groundAt(x) {
    if (!groundTops) groundTops = g.level.terrain.map(([tx, ty, tw]) => [tx, tx + tw, ty]);
    let top = null;
    for (const [a, b, y] of groundTops) if (x >= a && x <= b && (top === null || y < top)) top = y;
    return top;
  }

  // ---------------------------------------------------------------- drawing

  function birdLookOf(sub) {
    const [type, skin] = String(sub).split(":");
    return lookFor(type, skin ?? "classic");
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !canvas.isConnected) return;
    schedule();
    if (!g) return;
    frameStart = performance.now();
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = (now - t0) / 1000;
    const { width, height, dpr } = fitCanvas(canvas, maxDpr);
    if (!width || !height) return;
    bodies = buf.sample(now);
    releaseFx(now);
    moveCamera(width, height, dt);
    const L = g.level;
    const calm = reducedMotion();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0d12";
    ctx.fillRect(0, 0, width, height);
    const sx = shake > 0.3 && !calm ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0.3 && !calm ? (Math.random() - 0.5) * shake : 0;
    shake *= Math.exp(-dt * 7);
    const zoom = cam.s * (1 + (calm ? 0 : kick * 0.035));
    kick *= Math.exp(-dt * 6);
    ctx.save();
    ctx.translate(width / 2 + sx, height / 2 + sy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);
    // Backdrop.
    const bd = ensureBackdrop(zoom * dpr);
    ctx.drawImage(bd.canvas, -400, TOP, bd.canvas.width / bd.s, bd.canvas.height / bd.s);
    // The Red Cow (animated in its cutscene).
    let cow = g.cow.progress;
    let workers = 2;
    if (g.phase === "COW" && g.cow.scene) {
      const k = Math.min(1, Math.max(0, (now - cowPhaseAt - 900) / 2200));
      cow = g.cow.scene.from + (g.cow.scene.to - g.cow.scene.from) * (1 - (1 - k) ** 3);
      workers = 6;
      if (k > 0 && k < 1 && Math.random() < 0.3) fx.burst("spark", L.cowX - 100 + Math.random() * 200, L.groundY - 330 * cow, 2, { color: "#ffd166" });
      if (k > 0 && k < 1 && Math.random() < 0.15) fx.burst("dust", L.cowX - 100 + Math.random() * 200, L.groundY - 6, 1, { size: 10 });
    }
    drawRedCow(ctx, L.cowX, L.groundY, cow, { t, workers });
    // Kernel shields' domes, behind everything they cover.
    for (const s of g.build.structures) {
      if (s.type !== "shield" || s.disabled) continue;
      const a = 0.08 + 0.18 * Math.min(1, s.charge / (g.build.shield.chargePerTurn || 90));
      const dome = ctx.createRadialGradient(s.x, L.groundY, g.build.shield.radius * 0.6, s.x, L.groundY, g.build.shield.radius);
      dome.addColorStop(0, `rgba(90, 200, 255, ${a * 0.4})`);
      dome.addColorStop(1, `rgba(120, 215, 255, ${a * 1.4})`);
      ctx.beginPath();
      ctx.arc(s.x, L.groundY, g.build.shield.radius, Math.PI, 0);
      ctx.fillStyle = dome;
      ctx.fill();
      ctx.strokeStyle = `rgba(180, 235, 255, ${a * 2.5})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Shield piggies' bubbles.
    for (const b of bodies) {
      if (b.row[1] !== "p" || !(b.row[9] & 128)) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 170, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(94, 200, 255, ${0.06 + Math.sin(t * 2) * 0.02})`;
      ctx.fill();
      ctx.strokeStyle = "rgba(94, 200, 255, 0.35)";
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    contactShadows();
    fx.update(dt);
    fx.draw(ctx, "back");
    drawTrails(now);
    // Bodies.
    for (const b of bodies) {
      const { x, y, a, row: r } = b;
      const [, code, sub, , , , hw, hh, crack, flags] = r;
      if (code === "b") {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        // Totems glow (animated): drawn live. Everything else is a cached sprite.
        if (sub === "totem") drawBlock(ctx, sub, hw, hh, { crack, reinforced: !!(flags & 1), t, seed: seedOf(r[0]) });
        else {
          const sprite = blockSprite(sub, hw, hh, crack, !!(flags & 1), seedOf(r[0]), zoom * dpr);
          ctx.drawImage(sprite.canvas, -hw - sprite.pad, -hh - sprite.pad, (hw + sprite.pad) * 2, (hh + sprite.pad) * 2);
        }
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
        drawFlyingBird(b, now, t);
      } else if (code === "x") {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, 0, hw * 0.8, hw * 1.2, 0, 0, Math.PI * 2);
        const bg = ctx.createRadialGradient(-hw * 0.3, -hw * 0.4, 0, 0, 0, hw * 1.2);
        bg.addColorStop(0, "#fff0a0");
        bg.addColorStop(1, "#d9a200");
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = "#5a3a00";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        // The fuse fizzes.
        ctx.fillStyle = `rgba(255, 90, 40, ${0.5 + Math.sin(t * 30) * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y - hw * 1.3, 3, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.3) fx.emit("ember", x, y - hw * 1.3, { speed: 60, life: 0.4 });
      }
    }
    drawFireballs(now);
    drawSlingshot(now, t);
    // Build-phase cursors: everyone's agent marker where they're looking to build.
    if (g.phase === "BUILD") drawBuildLayer(t);
    fx.draw(ctx, "front");
    drawWater(t, L);
    drawTornadoes(now, t, L);
    drawBolts(now);
    weatherInWorld(ctx, t, L);
    ctx.restore();
    // Screen-space: darkness, flashes, the vignette, the wind.
    weatherOnScreen(ctx, width, height, t);
    if (flash > 0.02) {
      ctx.fillStyle = `rgba(255, 255, 240, ${flash})`;
      ctx.fillRect(0, 0, width, height);
      flash *= Math.exp(-dt * 8);
    }
    drawVignette(width, height);
    windBadge(ctx, width);
  }

  function contactShadows() {
    const img = shadow();
    ctx.save();
    for (const b of bodies) {
      const code = b.row[1];
      const ext = Math.max(b.row[6], b.row[7]);
      const gy = groundAt(b.x);
      if (gy === null) continue;
      const gap = gy - (b.y + (code === "b" || code === "h" ? Math.abs(Math.sin(b.a)) * b.row[6] + Math.abs(Math.cos(b.a)) * b.row[7] : ext));
      if (gap > 240 || gap < -20) continue;
      const k = 1 - Math.max(0, gap) / 240;
      const w = Math.max(b.row[6], code === "p" || code === "B" ? ext : Math.abs(Math.cos(b.a)) * b.row[6] + Math.abs(Math.sin(b.a)) * b.row[7]) * (1.3 + Math.max(0, gap) / 260);
      ctx.globalAlpha = 0.34 * k;
      ctx.drawImage(img, b.x - w, gy - w * 0.14, w * 2, w * 0.28);
    }
    ctx.restore();
  }

  function drawFlyingBird(b, now, t) {
    const { x, y, row: r } = b;
    const [, , sub, , , , hw, , , flags] = r;
    const look = birdLookOf(sub);
    const speed = Math.hypot(b.vx, b.vy);
    // Face the way it's flying, leaning into the arc; eased so a bounce doesn't flicker.
    let f = facing.get(r[0]) ?? { dir: 1, angle: 0 };
    if (speed > 40) {
      const dir = b.vx < -20 ? -1 : b.vx > 20 ? 1 : f.dir;
      const target = (dir < 0 ? Math.atan2(-b.vy, -b.vx) : Math.atan2(b.vy, b.vx)) * 0.75;
      const angle = dir !== f.dir ? target : f.angle + (target - f.angle) * 0.25;
      f = { dir, angle };
    } else f = { dir: f.dir, angle: f.angle * 0.9 };
    facing.set(r[0], f);
    // Its trail: puffs where it's been.
    if (!b.leaving && speed > 60) {
      let tr = trails.get(r[0]);
      if (!tr) trails.set(r[0], (tr = { pts: [], last: now }));
      const last = tr.pts[tr.pts.length - 1];
      if (!last || Math.hypot(x - last[0], y - last[1]) > 22) {
        tr.pts.push([x, y, tr.pts.length]);
        if (tr.pts.length > 60) tr.pts.shift();
      }
      tr.last = now;
    }
    if (flags & 32) {
      fx.emit("ember", x - b.vx * 0.02, y - b.vy * 0.02, { speed: 60, life: 0.35 });
      fx.emit("glow", x, y, { color: "#ff9a3d", size: hw * 1.6, grow: 0, life: 0.08 });
    }
    if (flags & 64) {
      ctx.beginPath();
      ctx.arc(x, y, 60 + Math.sin(t * 20) * 8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(160, 120, 255, 0.6)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // Squash and stretch with speed (a touch, not a cartoon).
    const squash = 1 - Math.min(0.12, speed / 9000);
    const mine = you !== null && r[10] === g.roster.findIndex((q) => q.id === you);
    drawBird(ctx, look, { x, y, r: hw, angle: f.angle, facing: f.dir, squash, state: "fly", t, outline: mine ? "#ffffff" : null });
  }

  function drawTrails(now) {
    ctx.save();
    for (const [id, tr] of trails) {
      const fade = Math.min(1, Math.max(0, 1 - (now - tr.last - 3000) / 2000));
      if (fade <= 0) {
        trails.delete(id);
        continue;
      }
      tr.pts.forEach(([px, py, n], i) => {
        ctx.globalAlpha = fade * (0.35 + 0.45 * (i / tr.pts.length));
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(px, py, n % 3 === 0 ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.restore();
  }

  function drawFireballs(now) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = fireballs.length - 1; i >= 0; i--) {
      const f = fireballs[i];
      const age = (now - f.at) / 450;
      if (age >= 1) {
        fireballs.splice(i, 1);
        continue;
      }
      const r = f.r * (0.35 + 0.75 * (1 - (1 - age) ** 2));
      const gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      gr.addColorStop(0, `rgba(255, 255, 220, ${0.95 * (1 - age)})`);
      gr.addColorStop(0.3, `rgba(255, 200, 80, ${0.8 * (1 - age)})`);
      gr.addColorStop(0.7, `rgba(255, 90, 20, ${0.45 * (1 - age)})`);
      gr.addColorStop(1, "rgba(120, 20, 0, 0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSlingshot(now, t) {
    const L = g.level;
    const sling = L.sling;
    const shooter = g.action?.shooterId ? g.roster.find((p) => p.id === g.action.shooterId) : null;
    const aiming = g.phase === "ACTION" && g.action?.stage === "AIM" && shooter;
    let aim = null;
    const own = aiming && aimOverride && shooter.id === you;
    if (own) aim = aimOverride();
    else if (aiming) {
      // Someone else's aim arrives a few times a second: ease the pouch toward it.
      const target = g.action.aim;
      if (shownAim.who !== shooter.id) Object.assign(shownAim, { a: target.a, p: target.p, who: shooter.id });
      else {
        shownAim.a += (target.a - shownAim.a) * 0.25;
        shownAim.p += (target.p - shownAim.p) * 0.25;
      }
      aim = shownAim;
    }
    if (!aiming) shownAim.who = null;
    let pouch = aim ? pouchAt(sling, aim.a, aim.p) : null;
    if (aim) loaded = { type: shooter.birds[shooter.selected] ?? shooter.bird, skin: shooter.skin, pouch, aim: { a: aim.a, p: aim.p }, mine: shooter.id === you, at: now };
    // Just launched: the bird stays in the pouch until the drawing reaches the launch.
    const holding = !aim && loaded && g.phase === "ACTION" && now - loaded.at < 600;
    if (!aim && !holding) loaded = null;
    if (holding) pouch = loaded.pouch;
    const twang = Math.max(0, 1 - (now - twangAt) / 450);
    const power = aim?.p ?? (holding ? loaded.aim.p : 0);
    drawSling(ctx, sling.x, sling.y + 40, { pouch, back: true, power });
    if (aim) {
      // The arc: the first stretch of the flight, shorter in fog, fading as it goes.
      const pts = arc(sling, aim.a, aim.p, { seconds: g.world.fogFrom ? 0.35 : 0.75, dt: 0.05 });
      const base = shooter.id === you ? 0.95 : 0.55;
      pts.forEach(([px, py], i) => {
        ctx.fillStyle = `rgba(255, 255, 255, ${base * (1 - i / (pts.length + 4))})`;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.5, 4.5 - i * 0.2), 0, Math.PI * 2);
        ctx.fill();
      });
      if (own) label(ctx, `${Math.round(aim.a)}° · ${Math.round(aim.p * 100)}%`, sling.x, sling.y - 70, 14 / Math.max(0.3, cam.s) / 2.2, "#ffffff");
    }
    if (pouch && loaded) drawBird(ctx, lookFor(loaded.type, loaded.skin), { x: pouch[0], y: pouch[1], r: 16, state: "sling", t, outline: loaded.mine ? "#ffffff" : null });
    drawSling(ctx, sling.x, sling.y + 40, { pouch, back: false, power, twang: pouch ? 0 : twang, t });
  }

  function drawBuildLayer(t) {
    const L = g.level;
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
      ctx.globalAlpha = 0.55 + Math.sin(t * 5) * 0.1;
      ctx.translate(ghost.x, L.groundY - ghost.h / 2);
      drawBuilding(ctx, ghost.type, 1, ghost.w / 2, ghost.h / 2, { t });
      ctx.restore();
      ctx.strokeStyle = ghost.ok ? "#7dff6a" : "#ff4d4d";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -t * 20;
      ctx.strokeRect(ghost.x - ghost.w / 2, L.groundY - ghost.h, ghost.w, ghost.h);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
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

  function drawWater(t, L) {
    if (g.world.water === null || g.world.water === undefined) return;
    const wy = g.world.water;
    const wg = ctx.createLinearGradient(0, wy, 0, L.groundY + 200);
    wg.addColorStop(0, "rgba(60, 140, 210, 0.5)");
    wg.addColorStop(1, "rgba(15, 50, 100, 0.7)");
    ctx.fillStyle = wg;
    ctx.fillRect(-400, wy, L.width + 800, L.groundY + 400 - wy);
    ctx.strokeStyle = "rgba(210, 240, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = -400; x < L.width + 400; x += 20) ctx.lineTo(x, wy + Math.sin(x / 40 + t * 2) * 3);
    ctx.stroke();
    // Glints on the surface.
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    for (let i = 0; i < 24; i++) {
      const gx = ((i * 173 + t * 30) % (L.width + 600)) - 300;
      ctx.fillRect(gx, wy + 6 + (i % 4) * 7, 14, 1.5);
    }
  }

  function drawTornadoes(now, t, L) {
    for (let i = tornadoes.length - 1; i >= 0; i--) {
      const tw = tornadoes[i];
      const age = (now - tw.at) / 1000;
      if (age > 2.2) {
        tornadoes.splice(i, 1);
        continue;
      }
      const a = Math.min(1, age * 3, (2.2 - age) * 2);
      for (let j = 0; j < 16; j++) {
        const yy = L.groundY - j * 32;
        const ww = 18 + j * j * 1.5;
        const cx = tw.x + Math.sin(t * 8 + j * 0.6) * (8 + j);
        ctx.fillStyle = `rgba(150, 150, 160, ${0.12 * a})`;
        ctx.beginPath();
        ctx.ellipse(cx, yy, ww, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(210, 210, 220, ${0.3 * a})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, yy, ww, 7, 0, Math.PI * 0.1, Math.PI * 0.9);
        ctx.stroke();
      }
      // Junk caught in it, and dust where it meets the ground.
      ctx.fillStyle = `rgba(90, 70, 50, ${0.8 * a})`;
      for (let k = 0; k < 10; k++) {
        const h = ((k * 53 + t * 140) % 440) / 440;
        const ang = t * 7 + k * 2.1;
        ctx.fillRect(tw.x + Math.cos(ang) * (20 + h * 200), L.groundY - h * 480, 5, 3);
      }
      if (Math.random() < 0.4) fx.burst("dust", tw.x + (Math.random() - 0.5) * 80, L.groundY - 4, 1, { size: 12, grow: 30, color: "rgba(150, 130, 100, 0.5)" });
    }
  }

  function drawBolts(now) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const age = (now - b.at) / 1000;
      if (age > 0.45) {
        bolts.splice(i, 1);
        continue;
      }
      // Flickers: bright, dim, bright again, gone.
      const on = age < 0.08 || (age > 0.16 && age < 0.24) ? 1 : 0.45;
      const alpha = (1 - age / 0.45) * on;
      const stroke = (pts, width, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
      };
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "lighter";
      for (const pts of [b.path.main, ...b.path.forks]) {
        const main = pts === b.path.main;
        stroke(pts, main ? 16 : 8, `rgba(140, 170, 255, ${0.22 * alpha})`);
        stroke(pts, main ? 6 : 3, `rgba(210, 225, 255, ${0.55 * alpha})`);
        stroke(pts, main ? 2.2 : 1.2, `rgba(255, 255, 255, ${alpha})`);
      }
      const gl = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 110);
      gl.addColorStop(0, `rgba(200, 220, 255, ${0.6 * alpha})`);
      gl.addColorStop(1, "rgba(200, 220, 255, 0)");
      ctx.fillStyle = gl;
      ctx.fillRect(b.x - 110, b.y - 110, 220, 220);
      ctx.restore();
    }
  }

  function weatherInWorld(ctx, t, L) {
    const w = g.weather;
    const type = w?.type;
    const calm = reducedMotion();
    const wind = (g.world.wind ?? 0) / 600;
    // At least this many screen pixels wide, however far the camera is zoomed out.
    const px = (worldUnits, screenPx) => Math.max(worldUnits, screenPx / Math.max(0.1, cam.s));
    const rain = type === "heavy_rain" || type === "acid_rain" || type === "thunderstorm" || type === "flood" || w?.secondary === "Heavy Rain";
    if (rain && !calm) {
      const acid = type === "acid_rain";
      // Two layers: fine far rain, heavier near drops.
      for (const [n, len, speed, width, alpha] of [[160, 16, 1100, 1.2, 0.3], [110, 26, 1500, 2, 0.5]]) {
        ctx.strokeStyle = acid ? `rgba(160, 255, 90, ${alpha})` : `rgba(195, 220, 255, ${alpha})`;
        ctx.lineWidth = px(width, width * 0.8);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = ((((i * 97.3 + len * 13 + t * speed * wind * 0.8) % (L.width + 400)) + L.width + 400) % (L.width + 400)) - 200;
          const y = ((i * 57.7 + len * 7 + t * speed) % (L.groundY - TOP)) + TOP;
          ctx.moveTo(x, y);
          ctx.lineTo(x + len * wind * 0.8, y + len);
        }
        ctx.stroke();
      }
      // Splashes where it lands.
      ctx.strokeStyle = acid ? "rgba(180, 255, 120, 0.55)" : "rgba(220, 235, 255, 0.55)";
      ctx.lineWidth = px(1.2, 1);
      ctx.beginPath();
      for (let i = 0; i < 40; i++) {
        const cycle = Math.floor(t * 6 + i * 0.37);
        const sx = ((i * 211 + cycle * 97) % (L.width + 200)) - 100;
        const gy = groundAt(sx);
        if (gy === null) continue;
        const k = (t * 6 + i * 0.37) % 1;
        const r = 3 + k * 7;
        ctx.moveTo(sx - r, gy - 1 - k * 4);
        ctx.quadraticCurveTo(sx, gy - 6 - k * 6, sx + r, gy - 1 - k * 4);
      }
      ctx.stroke();
    }
    if (type === "hailstorm" && !calm) {
      ctx.fillStyle = "rgba(240, 248, 255, 0.85)";
      for (let i = 0; i < 90; i++) {
        const x = ((((i * 131.7 + t * 500 * wind) % (L.width + 400)) + L.width + 400) % (L.width + 400)) - 200;
        const y = ((i * 71.3 + t * 1250) % (L.groundY - TOP)) + TOP;
        ctx.beginPath();
        ctx.arc(x, y, px(2.4 + (i % 3), 1.2 + (i % 3) * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if ((g.world.wind ?? 0) !== 0 && !calm) {
      const dir = Math.sign(g.world.wind);
      const strength = Math.min(1, Math.abs(g.world.wind) / 600);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + strength * 0.2})`;
      ctx.lineWidth = px(2, 1.3);
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < 40; i++) {
        const x = ((((i * 211 + dir * t * (300 + strength * 900)) % (L.width + 600)) + L.width + 600) % (L.width + 600)) - 300;
        const y = TOP + 100 + ((i * 131) % (L.groundY - TOP - 150));
        // Gusts curl a little at the end.
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + dir * (30 + strength * 60), y - 2, x + dir * (40 + strength * 80), y + Math.sin(t * 3 + i) * 6);
      }
      ctx.stroke();
      // Leaves riding it.
      ctx.fillStyle = "rgba(120, 160, 60, 0.8)";
      for (let i = 0; i < 12; i++) {
        const x = ((((i * 397 + dir * t * (260 + strength * 700)) % (L.width + 600)) + L.width + 600) % (L.width + 600)) - 300;
        const y = TOP + 200 + ((i * 173) % (L.groundY - TOP - 260)) + Math.sin(t * 2 + i) * 30;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 5 + i);
        ctx.beginPath();
        ctx.ellipse(0, 0, px(6, 3), px(3, 1.5), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    if (type === "heat_wave") {
      ctx.fillStyle = `rgba(255, 140, 40, ${0.08 + Math.sin(t * 3) * 0.03})`;
      ctx.fillRect(-400, TOP, L.width + 800, L.groundY - TOP);
      if (!calm) {
        // Shimmer rising off the ground.
        ctx.strokeStyle = "rgba(255, 230, 190, 0.18)";
        ctx.lineWidth = px(2, 1.2);
        ctx.beginPath();
        for (let i = 0; i < 18; i++) {
          const x = (i * 150 + 40) % L.width;
          const rise = (t * 60 + i * 40) % 220;
          for (let s = 0; s <= 6; s++) {
            const yy = L.groundY - rise - s * 10;
            const xx = x + Math.sin(t * 6 + s + i) * 5;
            if (s) ctx.lineTo(xx, yy);
            else ctx.moveTo(xx, yy);
          }
        }
        ctx.stroke();
      }
    }
    if (g.world.obscure) {
      // Dust storm columns: the same cover as ever, with soft edges and blowing grit.
      for (let i = 0; i < g.world.obscure; i++) {
        const cx = 1150 + ((i * 373 + t * 40) % 1000);
        const col = ctx.createLinearGradient(cx - 170, 0, cx + 170, 0);
        col.addColorStop(0, "rgba(150, 110, 60, 0)");
        col.addColorStop(50 / 340, "rgba(150, 110, 60, 0.55)");
        col.addColorStop(290 / 340, "rgba(150, 110, 60, 0.55)");
        col.addColorStop(1, "rgba(150, 110, 60, 0)");
        ctx.fillStyle = col;
        ctx.fillRect(cx - 170, TOP, 340, L.groundY - TOP);
      }
      if (!calm) {
        ctx.fillStyle = "rgba(190, 150, 90, 0.5)";
        for (let i = 0; i < 70; i++) {
          const x = ((i * 157 + t * 380) % (L.width + 400)) - 200;
          const y = TOP + 150 + ((i * 89) % (L.groundY - TOP - 160));
          ctx.fillRect(x, y, px(6, 3), px(1.5, 1));
        }
      }
    }
    if (g.world.fogFrom) {
      const f = ctx.createLinearGradient(g.world.fogFrom - 200, 0, g.world.fogFrom + 250, 0);
      f.addColorStop(0, "rgba(200, 205, 215, 0)");
      f.addColorStop(1, "rgba(200, 205, 215, 0.93)");
      ctx.fillStyle = f;
      ctx.fillRect(g.world.fogFrom - 200, TOP, L.width + 600 - g.world.fogFrom, L.groundY - TOP + 200);
      if (!calm) {
        // Wisps drifting at the fog's edge.
        for (let i = 0; i < 6; i++) {
          const x = g.world.fogFrom - 160 + ((i * 97 + t * 25) % 320);
          const y = L.groundY - 60 - i * 90;
          const wg = ctx.createRadialGradient(x, y, 0, x, y, 120);
          wg.addColorStop(0, "rgba(220, 225, 232, 0.3)");
          wg.addColorStop(1, "rgba(220, 225, 232, 0)");
          ctx.fillStyle = wg;
          ctx.fillRect(x - 120, y - 120, 240, 240);
        }
      }
    }
  }

  function weatherOnScreen(ctx, width, height, t) {
    const type = g.weather?.type;
    // An overcast wash under rain and storms (light: it mustn't hide anything).
    if (type === "heavy_rain" || type === "acid_rain" || type === "thunderstorm" || type === "flood" || type === "lightning_storm" || type === "hailstorm") {
      ctx.fillStyle = "rgba(30, 40, 60, 0.14)";
      ctx.fillRect(0, 0, width, height);
    }
    if (g.world.dark) {
      ctx.fillStyle = `rgba(4, 6, 14, ${g.world.dark})`;
      ctx.fillRect(0, 0, width, height);
      if (!reducedMotion() && Math.sin(t * 1.7) > 0.995) flash = 0.5;
    }
  }

  function drawVignette(width, height) {
    if (!vignette || vignette.w !== width || vignette.h !== height) {
      const gr = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.45, width / 2, height / 2, Math.hypot(width, height) * 0.62);
      gr.addColorStop(0, "rgba(0, 0, 0, 0)");
      gr.addColorStop(1, `rgba(0, 0, 0, ${mode === "host" ? 0.28 : 0.22})`);
      vignette = { w: width, h: height, gr };
    }
    ctx.fillStyle = vignette.gr;
    ctx.fillRect(0, 0, width, height);
  }

  function windBadge(ctx, width) {
    const wind = g.world.wind ?? 0;
    if (!wind || g.phase !== "ACTION") return;
    const text = `WIND ${wind > 0 ? "→" : "←"} ${Math.abs(Math.round(wind / 10))}`;
    ctx.font = "700 13px 'Roboto Mono', monospace";
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.roundRect?.(width - w - 8, 8, w, 22, 11);
    if (!ctx.roundRect) ctx.rect(width - w - 8, 8, w, 22);
    ctx.fill();
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
