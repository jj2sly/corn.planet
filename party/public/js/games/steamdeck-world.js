// Escape Thad's Steam Deck: draws the world on a canvas, for the host screen, runners' phones and
// Thad's Deck. The server sends a snapshot every tick (20 Hz); this draws one tick behind and
// interpolates between the last two, so movement stays smooth at 60 fps.
//
// Rendering only: the snapshot is the truth. Characters (cpi/character.js) are animated from the
// positions they're given (cpi/animation.js), the scenery is cosmetic (steamdeck-scenery.js), and
// effects (cpi/particles.js) come and go without ever touching the game. Nothing here is sent back.
//
// Layers: void → backdrop (cached, parallax) → live scenery → platforms (cached) → exit, hazards,
// planks → dust → characters → sparks/confetti → labels and indicators (screen space, always crisp).

import { createAnimator } from "../cpi/animation.js";
import { BOX, createCharacter, drawCharacter } from "../cpi/character.js";
import { createParticles } from "../cpi/particles.js";
import { fitCanvas } from "../drawing-canvas.js";
import { MARGIN, paintBackdrop, paintExit, paintHazard, paintLive, paintPlank, paintSolids, paintVoid, themeFor } from "./steamdeck-scenery.js";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** On a small screen the camera follows you, zoomed so you're at least this many px wide. */
const MIN_RUNNER_PX = 15;
const MAX_ZOOM = 2.5;
/** The sharpest cache we'll keep, in px per world unit (platforms; the backdrop stops at 1: softer
 * reads as further away, and it's the bigger layer). About 17 MB at most, on a hi-DPI screen. */
const MAX_CACHE_SCALE = 1.3;
const MAX_BACKDROP_SCALE = 1;
const SPLATS = ["SPLAT", "BONK", "OOF", "YIKES", "NOPE"];

/**
 * `rotate` leans the whole world with Thad's tilt (host and Deck); otherwise a level indicator shows
 * it. `you` highlights one runner (and, with `follow`, the camera follows them on small screens).
 * `labels`: true names everyone, "others" names everyone but you. `onEvent(type, detail)` hears
 * jumps, landings, deaths, escapes, planks and hazards arming, for sounds and buzzes.
 * Call update(game) with every state; destroy() when done.
 */
export function createWorldView(canvas, { rotate = false, you = null, labels = false, follow = false, onEvent = null, maxDpr = 2 } = {}) {
  let game = null;
  let prev = null;
  let curr = null;
  let raf = 0;
  let levelId = null;
  let mode = "follow"; // or "map": the whole level (drawing a plank)
  const reduced = reducedMotion();
  const fx = createParticles({ max: rotate ? 180 : 130 });
  const anims = new Map(); // runner id -> animator
  const cast = new Map(); // runner id -> character
  let planks = new Map(); // plank key -> { owner, x1, x2, y, born, ttl }
  let hazardState = []; // [{ live, armedAt }]
  let primed = false;
  const cam = { x: 800, y: 450, zoom: 1, ready: false };
  let shake = { until: 0, power: 0 };
  let flash = { until: 0, color: "" };
  let cache = null;
  let last = performance.now();
  let moteAt = 0;
  let wordAt = 0; // the last floating word: at most two a second, so a pile-up stays readable
  const dustAt = new Map();

  const now = () => performance.now() / 1000;
  const emit = (type, detail = {}) => onEvent?.(type, detail);
  const count = (n) => (reduced ? Math.ceil(n * 0.4) : n);

  // Fonts arrive after the first paint: redo the cached text once they're in.
  globalThis.document?.fonts?.ready?.then(() => (cache = null));

  const characterFor = (id) => cast.get(id) ?? createCharacter({ id, name: "", color: "#ffffff" });

  const syncCast = (roster) => {
    for (const r of roster) {
      const had = cast.get(r.id);
      if (!had || had.colors.suit !== r.color || had.name !== r.name) cast.set(r.id, createCharacter({ id: r.id, name: r.name, color: r.color }));
    }
  };

  const resetLevel = () => {
    anims.clear();
    planks = new Map();
    hazardState = [];
    primed = false;
    fx.clear();
    cache = null;
    cam.ready = false;
    prev = curr = null;
  };

  const shakeIt = (power, seconds = 0.3) => {
    if (reduced) return;
    shake = { until: now() + seconds, power: Math.max(power, shake.until > now() ? shake.power : 0) };
  };

  // ---------------------------------------------------------------- snapshots and events

  const observe = (next, t) => {
    const [rw, rh] = next.world.size;
    for (const [id, x, y, facing, state] of next.world.runners) {
      let anim = anims.get(id);
      if (!anim) anims.set(id, (anim = createAnimator()));
      const status = state === 2 ? "escaped" : state === 1 ? "dead" : "alive";
      const events = anim.observe({ time: t, x, y, status, facing });
      if (!primed) continue;
      const feetX = x + rw / 2;
      const feetY = y + rh;
      const mine = id === you;
      for (const event of events) {
        if (event === "jump") fx.burst("dust", feetX, feetY, count(4), { speed: 50, size: 5 });
        else if (event === "land") {
          fx.burst("dust", feetX, feetY, count(2 + Math.round(anim.landing * 5)), { angle: -Math.PI / 2, spread: Math.PI * 0.9, speed: 60 + anim.landing * 60 });
        } else if (event === "die") {
          fx.burst("spark", x + rw / 2, y + rh / 2, count(14), { color: "#ff6b5e" });
          fx.burst("spark", x + rw / 2, y + rh / 2, count(6), { color: "#ffffff", speed: 250 });
          if (mine || t - wordAt > 0.5) {
            wordAt = t;
            fx.emit("text", x + rw / 2, y - 6, { text: SPLATS[Math.floor(Math.random() * SPLATS.length)], size: 22, color: "#ff6b5e" });
          }
          if (mine) {
            flash = { until: now() + 0.45, color: "255, 60, 60" };
            shakeIt(8, 0.35);
          }
        } else if (event === "respawn") {
          fx.emit("ring", x + rw / 2, y + rh / 2, { color: "rgba(255, 255, 255, 0.8)" });
        } else if (event === "escape") {
          fx.burst("confetti", x + rw / 2, y + rh / 2, count(26));
          fx.emit("ring", x + rw / 2, y + rh / 2, { color: "rgba(120, 255, 160, 0.9)", grow: 160 });
          fx.emit("text", x + rw / 2, y - 10, { text: "ESCAPED!", size: 28, color: "#9dffb8" });
          if (mine) flash = { until: now() + 0.6, color: "80, 255, 140" };
        }
        emit(event, { id, mine, strength: event === "land" ? anim.landing : 0 });
      }
    }

    // Planks: new ones build in (and whoever drew one swings a hammer); expired ones crumble.
    const seen = new Map();
    for (const [x1, x2, y, owner, ttl] of next.world.planks) {
      const key = `${owner}:${x1}:${x2}:${y}`;
      const had = planks.get(key);
      seen.set(key, { owner, x1, x2, y, ttl, born: had?.born ?? (primed ? t : t - 10) });
      if (!had && primed) {
        fx.burst("dust", (x1 + x2) / 2, y + 5, count(8), { spread: Math.PI * 2, speed: 120, size: 5 });
        fx.emit("ring", (x1 + x2) / 2, y + 5, { color: "rgba(255, 214, 140, 0.8)", grow: 90 });
        anims.get(owner)?.trigger("place", t);
        emit("plank", { owner, mine: owner === you });
      }
    }
    if (primed) {
      for (const [key, p] of planks) {
        if (seen.has(key)) continue;
        // Ran out (rather than replaced): it breaks apart.
        if (p.ttl < 600) fx.burst("debris", (p.x1 + p.x2) / 2, p.y + 5, count(10), { spread: Math.PI * 1.2, color: "#b0733a" });
        else fx.burst("dust", (p.x1 + p.x2) / 2, p.y + 5, count(4));
      }
    }
    planks = seen;

    // Hazards arriving: spikes shoot up, sparks, a jolt.
    next.level.hazards.forEach(([x, y, w, h, live], i) => {
      const had = hazardState[i];
      if (!had) hazardState[i] = { live, armedAt: primed && live ? t : -10 };
      else if (!had.live && live) {
        hazardState[i] = { live, armedAt: t };
        fx.burst("spark", x + w / 2, y + h, count(12), { spread: Math.PI, angle: -Math.PI / 2 });
        shakeIt(rotate ? 5 : 3, 0.3);
        emit("hazard", { index: i });
      } else had.live = live;
    });
    primed = true;
  };

  const update = (next) => {
    if (next.level.id !== levelId || (game && next.round !== game.round)) {
      levelId = next.level.id;
      resetLevel();
    }
    game = next;
    syncCast(next.roster);
    if (!curr || next.tick !== curr.tick) {
      prev = curr;
      curr = { tick: next.tick, at: performance.now(), tilt: next.world.tilt, runners: new Map(next.world.runners.map((r) => [r[0], r])) };
      observe(next, now());
    }
  };

  const lerpT = () => Math.min(1, (performance.now() - (curr?.at ?? 0)) / (game?.tickMs || 50));

  const position = (id) => {
    const c = curr?.runners.get(id);
    if (!c) return null;
    const p = prev?.runners.get(id);
    const t = lerpT();
    // Teleports (respawn) and state changes snap instead of sliding across the screen.
    if (!p || p[4] !== c[4] || Math.hypot(c[1] - p[1], c[2] - p[2]) > 150) return { x: c[1], y: c[2], facing: c[3], state: c[4] };
    return { x: p[1] + (c[1] - p[1]) * t, y: p[2] + (c[2] - p[2]) * t, facing: c[3], state: c[4] };
  };

  const tiltNow = () => (prev && curr ? prev.tilt + (curr.tilt - prev.tilt) * lerpT() : (game?.world.tilt ?? 0));

  // ---------------------------------------------------------------- the cached static layers

  const layer = (w, h) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };

  const ensureCache = (pxPerUnit) => {
    const L = game.level;
    const want = Math.min(MAX_CACHE_SCALE, Math.max(0.25, Math.ceil(pxPerUnit * 10) / 10));
    // Rebuild only for a real change in size, not every step of a zoom.
    if (cache && cache.level === L.id && want <= cache.scale * 1.15 && want >= cache.scale * 0.6) return cache;
    const theme = themeFor(L.id);
    const s = want;
    const b = Math.min(MAX_BACKDROP_SCALE, s);
    const backdrop = layer((L.width + MARGIN * 2) * b, (L.height + MARGIN * 2) * b);
    const bctx = backdrop.getContext("2d");
    bctx.setTransform(b, 0, 0, b, MARGIN * b, MARGIN * b);
    paintBackdrop(bctx, L, theme);
    const pad = 12;
    const solids = layer((L.width + pad * 2) * s, (L.height + pad * 2) * s);
    const sctx = solids.getContext("2d");
    sctx.setTransform(s, 0, 0, s, pad * s, pad * s);
    paintSolids(sctx, L, theme);
    cache = { level: L.id, scale: s, backdrop, solids, pad, theme };
    return cache;
  };

  // ---------------------------------------------------------------- camera

  const view = (width, height, dt) => {
    const L = game.level;
    const base = Math.min(width / L.width, height / L.height);
    const tilt = tiltNow();
    const angle = rotate ? (tilt * game.world.maxTilt * Math.PI) / 180 : 0;
    let scale = base;
    let cx = L.width / 2;
    let cy = L.height / 2;
    if (rotate) {
      // Leaning: zoom out just enough that the level mostly stays on screen.
      const c = Math.abs(Math.cos(angle));
      const s = Math.abs(Math.sin(angle));
      const exact = Math.min(width / (L.width * c + L.height * s), height / (L.width * s + L.height * c));
      scale = Math.min(base * 0.94, exact * 1.18);
    } else if (follow && you && mode === "follow") {
      const me = position(you);
      const zoom = Math.max(1, Math.min(MAX_ZOOM, MIN_RUNNER_PX / (base * BOX.w)));
      // Only worth it when it really helps: a big screen keeps the whole level in view.
      if (me && me.state !== 2 && zoom >= 1.3) {
        scale = base * zoom;
        const [rw, rh] = game.world.size;
        cx = me.x + rw / 2 + me.facing * 70;
        cy = me.y + rh / 2 - 30;
        const halfW = width / (2 * scale);
        const halfH = height / (2 * scale);
        cx = Math.max(halfW, Math.min(L.width - halfW, cx));
        cy = Math.max(halfH, Math.min(L.height - halfH, cy));
      }
    }
    // Smooth, frame-rate independent; snaps on the first frame.
    const k = cam.ready ? 1 - Math.exp(-dt * 7) : 1;
    cam.zoom += (scale - cam.zoom) * k;
    cam.x += (cx - cam.x) * k;
    cam.y += (cy - cam.y) * k;
    cam.ready = true;
    return { base, angle, tilt, scale: cam.zoom, cx: cam.x, cy: cam.y };
  };

  // ---------------------------------------------------------------- drawing

  const draw = () => {
    if (!game) return;
    const t = now();
    const frameMs = performance.now();
    const dt = Math.min(0.1, (frameMs - last) / 1000);
    last = frameMs;
    const { width, height, dpr } = fitCanvas(canvas, maxDpr);
    if (width < 2 || height < 2) return;
    const ctx = canvas.getContext("2d");
    const L = game.level;
    const v = view(width, height, dt);
    const layers = ensureCache(v.scale * dpr);
    const theme = layers.theme;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintVoid(ctx, width, height);

    ctx.save();
    let sx = 0;
    let sy = 0;
    if (shake.until > t) {
      const left = (shake.until - t) / 0.3;
      sx = (Math.random() - 0.5) * shake.power * left;
      sy = (Math.random() - 0.5) * shake.power * left;
    }
    ctx.translate(width / 2 + sx, height / 2 + sy);
    ctx.rotate(v.angle);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.cx, -v.cy);
    const world = ctx.getTransform();

    // Backdrop and its moving bits, a little behind the platforms (parallax with camera and tilt).
    const ox = Math.max(-MARGIN * 0.8, Math.min(MARGIN * 0.8, (v.cx - L.width / 2) * 0.12 + v.tilt * 22));
    const oy = Math.max(-MARGIN * 0.8, Math.min(MARGIN * 0.8, (v.cy - L.height / 2) * 0.12));
    ctx.drawImage(layers.backdrop, -MARGIN + ox, -MARGIN + oy, L.width + MARGIN * 2, L.height + MARGIN * 2);
    ctx.save();
    ctx.translate(ox, oy);
    paintLive(ctx, L, t, theme);
    ctx.restore();
    ctx.drawImage(layers.solids, -layers.pad, -layers.pad, L.width + layers.pad * 2, L.height + layers.pad * 2);

    const roster = game.roster;
    const out = roster.filter((r) => r.escapedMs !== null).length;
    paintExit(ctx, L.exit, { time: t, urgent: game.phase === "FINAL", out, total: roster.length });

    L.hazards.forEach(([x, y, w, h, live], i) => {
      const armedAt = hazardState[i]?.armedAt ?? -10;
      paintHazard(ctx, [x, y, w, h], { live, armed: Math.min(1, (t - armedAt) / 0.3), time: t, theme });
    });

    const colorOf = new Map(roster.map((r) => [r.id, r.color]));
    for (const p of planks.values()) paintPlank(ctx, p, { color: colorOf.get(p.owner) ?? "#ffd400", age: t - p.born, ttl: p.ttl - (performance.now() - curr.at), time: t });

    // Ambient specks drifting the way the Deck leans (the host only: phones keep it clean).
    if (rotate && !reduced && t - moteAt > 0.35 && fx.count < fx.max * 0.5) {
      moteAt = t;
      fx.emit("mote", Math.random() * L.width, Math.random() * L.height, { vx: v.tilt * 60 });
    }
    fx.update(dt);
    fx.draw(ctx, "back");

    // Runners: everyone else, then you on top.
    const [rw, rh] = game.world.size;
    const order = game.world.runners.map((r) => r[0]).sort((a, b) => (a === you) - (b === you));
    const heads = [];
    for (const id of order) {
      const r = position(id);
      const anim = anims.get(id);
      if (!r || !anim) continue;
      const pose = anim.pose(t, r.x);
      if (pose.gone) continue;
      // Kicked-up dust while running hard or sliding.
      if (!reduced && (pose.state === "slide" || pose.state === "slip" || (pose.state === "run" && pose.speed > 300))) {
        const gap = pose.state === "run" ? 0.16 : 0.07;
        if (t - (dustAt.get(id) ?? 0) > gap) {
          dustAt.set(id, t);
          fx.emit("dust", r.x + rw / 2, r.y + rh, { vx: -Math.sign(anim.velocity.x) * 40, size: 4, speed: 30 });
        }
      }
      drawCharacter(ctx, characterFor(id), {
        x: r.x,
        y: r.y + pose.lift,
        w: rw,
        h: rh,
        facing: r.facing,
        state: pose.state,
        t: pose.t,
        cycle: pose.cycle,
        squash: pose.squash,
        scale: pose.scale,
        alpha: pose.alpha,
        speed: pose.speed,
        clock: t,
        effects: pose.effects,
        flash: pose.flash,
        outline: id === you ? "#ffffff" : undefined,
      });
      if (r.state !== 2) heads.push({ id, x: r.x + rw / 2, y: r.y + pose.lift - 14, dead: r.state === 1 });
    }
    fx.draw(ctx, "front");
    ctx.restore();

    // ---- screen space: crisp at any zoom or lean
    const toScreen = (x, y) => {
      const p = world.transformPoint(new DOMPoint(x, y));
      return { x: p.x / dpr, y: p.y / dpr };
    };
    const names = new Map(roster.map((r) => [r.id, r.name]));
    const labelSize = Math.max(10, Math.min(15, width / 70));
    for (const h of heads) {
      const mine = h.id === you;
      if (!labels && !mine) continue;
      const p = toScreen(h.x, h.y);
      if (mine) marker(ctx, p.x, p.y, labelSize);
      else nameTag(ctx, names.get(h.id) ?? "", p.x, p.y, labelSize, colorOf.get(h.id) ?? "#fff", h.dead);
    }

    if (!rotate && mode === "follow" && follow) exitPointer(ctx, toScreen, L.exit, width, height, labelSize);
    if (!rotate && Math.abs(v.tilt) > 0.04) level(ctx, v.tilt, game.world.maxTilt, width, labelSize);

    if (flash.until > t) {
      const k = (flash.until - t) / 0.5;
      const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.7);
      g.addColorStop(0, `rgba(${flash.color}, 0)`);
      g.addColorStop(1, `rgba(${flash.color}, ${0.45 * Math.min(1, k)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
  };

  const frame = () => {
    if (!canvas.isConnected) return (raf = 0);
    draw();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    update,
    /** "follow" (the camera follows you on small screens) or "map" (the whole level). */
    setMode(next) {
      mode = next === "map" ? "map" : "follow";
    },
    get mode() {
      return mode;
    },
    /** Tells the animator you're drawing (a pencil pose) or not. */
    setDrawing(on) {
      if (you) anims.get(you)?.setFlag("drawing", on);
    },
    /** The character drawn for a runner (for badges elsewhere on the page). */
    character: (id) => characterFor(id),
    destroy() {
      cancelAnimationFrame(raf);
      fx.clear();
      cache = null;
    },
  };
}

// ------------------------------------------------------------------ screen-space bits

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function pill(ctx, text, x, y, size, fg, bg) {
  ctx.font = `600 ${size}px "Oswald", Arial, sans-serif`;
  const w = ctx.measureText(text).width + size * 0.9;
  const h = size * 1.45;
  ctx.fillStyle = bg;
  roundedRect(ctx, x - w / 2, y - h, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y - h / 2 + 0.5);
}

function nameTag(ctx, name, x, y, size, color, dead) {
  if (!name) return;
  ctx.save();
  ctx.globalAlpha = dead ? 0.45 : 0.85;
  pill(ctx, name.length > 12 ? `${name.slice(0, 11)}…` : name, x, y - 2, size * 0.9, color, "rgba(0, 0, 0, 0.62)");
  ctx.restore();
}

/** "This is you": a bobbing chevron and a YOU tag. */
function marker(ctx, x, y, size) {
  const bob = Math.sin(performance.now() / 180) * 2;
  ctx.save();
  pill(ctx, "YOU", x, y - size * 0.9 + bob, size * 0.85, "#000", "#ffffff");
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(x - 5, y - size * 0.9 + bob);
  ctx.lineTo(x + 5, y - size * 0.9 + bob);
  ctx.lineTo(x, y - size * 0.9 + bob + 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** An arrow at the edge of the screen pointing at the exit when it's out of view. */
function exitPointer(ctx, toScreen, [x, y, w, h], width, height, size) {
  const p = toScreen(x + w / 2, y + h / 2);
  const inset = 22;
  if (p.x > -10 && p.x < width + 10 && p.y > -10 && p.y < height + 10) return;
  const cx = Math.max(inset, Math.min(width - inset, p.x));
  const cy = Math.max(inset, Math.min(height - inset, p.y));
  const a = Math.atan2(p.y - cy, p.x - cx);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "rgba(10, 60, 30, 0.8)";
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7dff9a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.rotate(a);
  ctx.fillStyle = "#7dff9a";
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(1, -7);
  ctx.lineTo(1, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.font = `700 ${size * 0.75}px "Oswald", Arial, sans-serif`;
  ctx.fillStyle = "#7dff9a";
  ctx.textAlign = "center";
  ctx.fillText("EXIT", cx, cy + (cy > height / 2 ? -22 : 30));
  ctx.restore();
}

/** Runners' views don't lean, so a level gauge shows which way the Deck is tipping you. */
function level(ctx, tilt, maxTilt, width, size) {
  const deg = tilt * maxTilt;
  const w = Math.max(96, size * 8);
  const h = size * 1.7;
  const x = width / 2 - w / 2;
  const y = 6;
  const hot = Math.abs(tilt) > 0.6;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  roundedRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = hot ? "#ff6b5e" : "#ffd400";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // The floor, drawn at the angle it's at.
  ctx.save();
  ctx.translate(x + h * 0.9, y + h / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.fillRect(-h * 0.55, -1.5, h * 1.1, 3);
  ctx.restore();
  ctx.fillStyle = hot ? "#ff6b5e" : "#ffd400";
  ctx.font = `700 ${size * 0.85}px "Roboto Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${deg < 0 ? "◀" : ""} ${Math.abs(deg).toFixed(0)}° ${deg > 0 ? "▶" : ""}`.trim(), x + w / 2 + h * 0.4, y + h / 2 + 0.5);
  ctx.restore();
}
