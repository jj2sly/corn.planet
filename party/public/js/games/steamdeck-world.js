// Steam My Deck: draws the world on a canvas, for the host screen, runners' phones and
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
import { characterOf } from "./steamdeck-ui.js";
import { createParticles } from "../cpi/particles.js";
import { fitCanvas } from "../drawing-canvas.js";
import { MARGIN, paintBackdrop, paintCheckpoint, paintExit, paintHazard, paintItem, paintLive, paintPlank, paintSolids, paintStalker, paintVoid, paintWater, paintZone, themeFor } from "./steamdeck-scenery.js";

const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** On a small screen the camera follows you, zoomed so you're at least this many px wide. */
const MIN_RUNNER_PX = 15;
const MAX_ZOOM = 2.5;
/** The sharpest cache we'll keep, in px per world unit (platforms; the backdrop stops at 1: softer
 * reads as further away, and it's the bigger layer). About 17 MB at most, on a hi-DPI screen. */
const MAX_CACHE_SCALE = 1.3;
const MAX_BACKDROP_SCALE = 1;
/** A big level's caches stay under these many pixels (phones run out of canvas memory). */
const MAX_SOLIDS_PX = 6e6;
const MAX_BACKDROP_PX = 2.5e6;
/** What one screen shows of a level bigger than a screen: a standard level's worth. */
const VIEW_W = 1600;
const VIEW_H = 900;
const SPLATS = ["SPLAT", "BONK", "OOF", "YIKES", "NOPE"];

/** Achievements the Deck pops for silly things (the screens show them, per runner, once a round). */
export const ACHIEVEMENTS = {
  lava: "Hot Tub",
  drowned: "Forgot How Breathing Works",
  swim: "Fish Mode",
  portal: "Going Deeper",
  taken: "He Was Right Behind You",
  part: "Deck Tech Support",
  fragment: "Holding Something Cursed",
};

const inRect = (x, y, [rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;
const hits = (x, y, w, h, [rx, ry, rw, rh]) => x < rx + rw && x + w > rx && y < ry + rh && y + h > ry;

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
  let mode = "follow"; // "map": the whole level; "draw": where you draw a plank (the whole level, or a big one's window around you)
  let drawOrigin = [0, 0]; // the drawing window's top-left, in a big level
  let lastExit = null; // "locked" | "active" | "collapse", last snapshot
  let collapseAt = 0;
  const checkpointOf = new Map(); // runner id -> their checkpoint, last snapshot
  const told = new Set(); // messages already shown (once per level)
  const secretsFound = new Set(); // "runnerId:key"
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
  let rumbling = false; // Thad called a shake and it hasn't landed yet
  let prevStalker = null; // where the stalker stood last snapshot (he vanishes when he takes someone)
  let taken = null; // the items found, last snapshot
  let wasOpen = true;
  let swam = false;
  let staticAt = 0;
  let dark = null; // the darkness layer (SLIM), a canvas the size of this one
  let noise = null; // a tile of TV static
  let under = 0; // seconds your head has been under water (shown as air bubbles)
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
      const key = `${r.color}:${r.name}:${r.character ?? ""}:${r.build ?? 0}`;
      if (!had || had.key !== key) cast.set(r.id, Object.assign(Object.create(characterOf(r)), { key }));
    }
  };

  const resetLevel = () => {
    anims.clear();
    told.clear();
    secretsFound.clear();
    checkpointOf.clear();
    lastExit = null;
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
          // Why? The Deck has an achievement for that.
          const cx = x + rw / 2;
          const cy = y + rh / 2;
          const lava = next.level.hazards.some((h) => h[4] && h[5] === "lava" && hits(x - 4, y - 4, rw + 8, rh + 8, h));
          const drowned = (next.level.water ?? []).some((w) => inRect(cx, cy, w));
          const grabbed = next.level.stalker && prevStalker && Math.hypot(cx - prevStalker[0] - 15, cy - prevStalker[1] - 55) < 220;
          const cause = lava ? "lava" : drowned ? "drowned" : grabbed ? "taken" : null;
          if (cause) emit("achievement", { id, mine, key: cause, title: ACHIEVEMENTS[cause] });
        } else if (event === "respawn") {
          fx.emit("ring", x + rw / 2, y + rh / 2, { color: "rgba(255, 255, 255, 0.8)" });
        } else if (event === "escape") {
          fx.burst("confetti", x + rw / 2, y + rh / 2, count(26));
          fx.emit("ring", x + rw / 2, y + rh / 2, { color: "rgba(120, 255, 160, 0.9)", grow: 160 });
          fx.emit("text", x + rw / 2, y - 10, { text: "ESCAPED!", size: 28, color: "#9dffb8" });
          if (mine) flash = { until: now() + 0.6, color: "80, 255, 140" };
          const style = themeFor(next.level.id).exit;
          if (style === "portal" || style === "rift") emit("achievement", { id, mine, key: "portal", title: ACHIEVEMENTS.portal });
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
    // Water: your first swim of the round is an achievement.
    if (you && !swam && primed) {
      const me = next.world.runners.find((r) => r[0] === you);
      if (me && me[4] === 0 && (next.level.water ?? []).some((w) => inRect(me[1] + rw / 2, me[2] + rh / 2, w))) {
        swam = true;
        emit("achievement", { id: you, mine: true, key: "swim", title: ACHIEVEMENTS.swim });
      }
    }

    // Items found (the team shares them), and the exit opening when the last one is.
    const nowTaken = next.world.taken ?? [];
    if (taken && primed) {
      nowTaken.forEach((t, i) => {
        if (!t || taken[i]) return;
        const [name, ix, iy] = next.level.items[i];
        fx.burst("confetti", ix, iy, count(14));
        fx.emit("ring", ix, iy, { color: "rgba(255, 230, 140, 0.9)", grow: 120 });
        // Whoever was touching it found it.
        const finder = next.world.runners.find((r) => hits(r[1], r[2], rw, rh, [ix - 24, iy - 24, 48, 48]));
        emit("part", { name, found: nowTaken.filter(Boolean).length, need: nowTaken.length, id: finder?.[0], mine: !!finder && finder[0] === you });
        const key = name.includes("FRAGMENT") ? "fragment" : "part";
        if (finder) emit("achievement", { id: finder[0], mine: finder[0] === you, key, title: ACHIEVEMENTS[key] });
      });
    }
    taken = nowTaken.slice();
    const open = next.world.exitOpen !== false;
    if (primed && open && !wasOpen) {
      fx.burst("confetti", next.level.exit[0] + 35, next.level.exit[1] + 30, count(30));
      emit("unlocked", { use: !!next.level.exitUse });
    }
    wasOpen = open;
    // An exit you have to use: someone used it, and the world starts coming apart.
    const exitState = next.world.exit ?? null;
    if (primed && exitState === "collapse" && lastExit !== "collapse") {
      collapseAt = t;
      shakeIt(rotate ? 16 : 12, 1.2);
      flash = { until: now() + 0.9, color: "255, 60, 220" };
      const [ex, ey, ew, eh] = next.level.exit;
      fx.burst("confetti", ex + ew / 2, ey + eh / 2, count(40));
      fx.emit("ring", ex + ew / 2, ey + eh / 2, { color: "rgba(255, 120, 240, 0.9)", grow: 400 });
      emit("collapse", { id: next.world.completedBy, mine: next.world.completedBy === you });
    }
    if (exitState === "collapse" && !collapseAt) collapseAt = t;
    lastExit = exitState;
    // Checkpoints: touching one is where you'll wake up.
    for (const r of next.roster) {
      const had = checkpointOf.get(r.id);
      const at = r.checkpoint ?? -1;
      if (primed && had !== undefined && at !== had && at >= 0) {
        const [name, cx, cy] = next.level.checkpoints[at];
        fx.emit("ring", cx, cy - 20, { color: "rgba(255, 230, 140, 0.9)", grow: 120 });
        emit("checkpoint", { id: r.id, mine: r.id === you, name });
      }
      checkpointOf.set(r.id, at);
    }
    // The level's own messages and secrets, by where runners are (you, on your phone; anyone on
    // a shared screen): each message once, each secret once per runner.
    const theme = themeFor(next.level.id);
    if ((theme.messages || theme.secrets) && ["ESCAPE", "ESCALATION", "FINAL"].includes(next.phase)) {
      for (const [id, x, y, , state] of next.world.runners) {
        if (state !== 0 || (you && id !== you)) continue;
        const cx = x + rw / 2;
        const cy = y + rh / 2;
        (theme.messages ?? []).forEach(([rect, text, kind], i) => {
          if (told.has(i) || !inRect(cx, cy, rect)) return;
          told.add(i);
          emit("zone", { text, kind });
        });
        for (const [rect, key, title] of theme.secrets ?? []) {
          if (secretsFound.has(`${id}:${key}`) || !inRect(cx, cy, rect)) continue;
          secretsFound.add(`${id}:${key}`);
          if (primed) emit("achievement", { id, mine: id === you, key: `secret-${key}`, title });
        }
      }
    }
    prevStalker = next.world.stalker ?? prevStalker;

    // Thad's shake: a rumble, then the jolt.
    const hitIn = next.world.shake?.[1] ?? -1;
    if (hitIn >= 0 && !rumbling) {
      rumbling = true;
      if (primed) emit("rumble");
    } else if (hitIn < 0 && rumbling) {
      rumbling = false;
      if (primed) {
        shakeIt(rotate ? 12 : 9, 0.45);
        for (const [, x, y, , state] of next.world.runners) if (state === 0) fx.burst("dust", x + rw / 2, y + rh, count(6), { spread: Math.PI, speed: 140 });
        emit("shake");
      }
    }
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
    const area = (L.width + MARGIN * 2) * (L.height + MARGIN * 2);
    const want = Math.min(MAX_CACHE_SCALE, Math.sqrt(MAX_SOLIDS_PX / area), Math.max(0.25, Math.ceil(pxPerUnit * 10) / 10));
    // Rebuild only for a real change in size, not every step of a zoom.
    if (cache && cache.level === L.id && want <= cache.scale * 1.15 && want >= cache.scale * 0.6) return cache;
    const theme = themeFor(L.id);
    const s = want;
    const b = Math.min(MAX_BACKDROP_SCALE, s, Math.sqrt(MAX_BACKDROP_PX / area));
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

  const bigLevel = (L) => L.width > VIEW_W * 1.05 || L.height > VIEW_H * 1.05;

  const view = (width, height, dt) => {
    const L = game.level;
    const big = bigLevel(L);
    const winW = Math.min(L.width, VIEW_W);
    const winH = Math.min(L.height, VIEW_H);
    // A big level's screen shows a standard level's worth around the action, not the whole world.
    const base = Math.min(width / winW, height / winH);
    const tilt = tiltNow();
    const angle = rotate ? (tilt * game.world.maxTilt * Math.PI) / 180 : 0;
    let scale = base;
    let cx = L.width / 2;
    let cy = L.height / 2;
    const clampTo = (s) => {
      const halfW = width / (2 * s);
      const halfH = height / (2 * s);
      cx = L.width > halfW * 2 ? Math.max(halfW, Math.min(L.width - halfW, cx)) : L.width / 2;
      cy = L.height > halfH * 2 ? Math.max(halfH, Math.min(L.height - halfH, cy)) : L.height / 2;
    };
    const me = big && you ? position(you) : null;
    if (big && mode === "map") {
      scale = Math.min(width / L.width, height / L.height);
    } else if (big && mode === "draw") {
      cx = drawOrigin[0] + winW / 2;
      cy = drawOrigin[1] + winH / 2;
    } else if (big && follow && me && me.state !== 2) {
      const [rw, rh] = game.world.size;
      scale = base * Math.max(1, Math.min(MAX_ZOOM, MIN_RUNNER_PX / (base * BOX.w)));
      cx = me.x + rw / 2 + me.facing * 70;
      cy = me.y + rh / 2 - 40;
      clampTo(scale);
    } else if (big) {
      // Everyone still inside, in frame: zoomed out as far as half again, then centred on the middle one.
      const [rw, rh] = game.world.size;
      let spots = game.world.runners.filter((r) => r[4] === 0).map((r) => position(r[0])).filter(Boolean);
      if (!spots.length) spots = game.world.runners.filter((r) => r[4] !== 2).map((r) => position(r[0])).filter(Boolean);
      if (spots.length) {
        const xs = spots.map((p) => p.x + rw / 2).sort((a, b) => a - b);
        const ys = spots.map((p) => p.y + rh / 2).sort((a, b) => a - b);
        const spanW = xs.at(-1) - xs[0] + 500;
        const spanH = ys.at(-1) - ys[0] + 380;
        scale = Math.max(base * 0.5, Math.min(base, width / spanW, height / spanH)) * (rotate ? 0.92 : 1);
        const fits = spanW * scale <= width * 1.02 && spanH * scale <= height * 1.02;
        cx = fits ? (xs[0] + xs.at(-1)) / 2 : xs[Math.floor(xs.length / 2)];
        cy = (fits ? (ys[0] + ys.at(-1)) / 2 : ys[Math.floor(ys.length / 2)]) - 30;
      } else {
        cx = L.exit[0] + L.exit[2] / 2;
        cy = L.exit[1] + L.exit[3] / 2;
      }
      clampTo(scale);
    } else if (rotate) {
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
    } else if (rumbling && !reduced) {
      // The warning: a low buzz you can see before the jolt.
      sx = Math.sin(t * 90) * 1.6;
      sy = Math.cos(t * 70) * 1.2;
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
    const halfW = width / (2 * v.scale);
    const halfH = height / (2 * v.scale);
    const seen = [v.cx - halfW * 1.3, v.cy - halfH * 1.3, halfW * 2.6, halfH * 2.6];
    ctx.save();
    ctx.translate(ox, oy);
    paintLive(ctx, L, t, theme, seen);
    ctx.restore();
    // Pixel-art worlds stay crisp when the cache is scaled up.
    ctx.imageSmoothingEnabled = !theme.pixel;
    ctx.drawImage(layers.solids, -layers.pad, -layers.pad, L.width + layers.pad * 2, L.height + layers.pad * 2);
    ctx.imageSmoothingEnabled = true;
    for (const z of L.zones ?? []) paintZone(ctx, z, t);
    const myCheckpoint = you ? game.roster.find((r) => r.id === you)?.checkpoint : null;
    (L.checkpoints ?? []).forEach((c, i) => paintCheckpoint(ctx, c, { active: you ? myCheckpoint === i : game.roster.some((r) => r.checkpoint === i), time: t, style: theme.checkpoint }));

    const roster = game.roster;
    const out = roster.filter((r) => r.escapedMs !== null).length;
    const need = (game.world.taken ?? []).length;
    const found = (game.world.taken ?? []).filter(Boolean).length;
    paintExit(ctx, L.exit, { time: t, urgent: game.phase === "FINAL", out, total: roster.length, style: theme.exit, open: game.world.exitOpen !== false, found, need, state: game.world.exit });

    L.hazards.forEach(([x, y, w, h, live, kind], i) => {
      const armedAt = hazardState[i]?.armedAt ?? -10;
      paintHazard(ctx, [x, y, w, h], { live, armed: Math.min(1, (t - armedAt) / 0.3), time: t, theme, kind });
    });
    (L.items ?? []).forEach(([name, ix, iy], i) => {
      if (!game.world.taken?.[i]) paintItem(ctx, name, ix, iy, t);
    });
    if (game.world.stalker) paintStalker(ctx, game.world.stalker, t);

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
    // Water over whoever's in it, so swimmers are tinted and under.
    for (const w of L.water ?? []) paintWater(ctx, w, t);
    fx.draw(ctx, "front");
    ctx.restore();

    // SLIM: the dark, lit only around the runners (brightest around you) and the dock.
    if (theme.dark) {
      dark ??= document.createElement("canvas");
      if (dark.width !== canvas.width || dark.height !== canvas.height) {
        dark.width = canvas.width;
        dark.height = canvas.height;
      }
      const d = dark.getContext("2d");
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalCompositeOperation = "source-over";
      d.fillStyle = you ? "rgba(2, 4, 3, 0.94)" : "rgba(2, 4, 3, 0.78)";
      d.fillRect(0, 0, dark.width, dark.height);
      d.globalCompositeOperation = "destination-out";
      const light = (wx, wy, r) => {
        const p = world.transformPoint(new DOMPoint(wx, wy));
        const pr = r * v.scale * dpr;
        const g = d.createRadialGradient(p.x, p.y, pr * 0.25, p.x, p.y, pr);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        d.fillStyle = g;
        d.fillRect(p.x - pr, p.y - pr, pr * 2, pr * 2);
      };
      for (const h of heads) light(h.x, h.y + 20, h.id === you ? 200 : you ? 70 : 170);
      light(L.exit[0] + L.exit[2] / 2, L.exit[1] + L.exit[3] / 2, 90);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(dark, 0, 0);
      ctx.restore();
      // Parts glint faintly through the dark now and then, so you know where to look.
      (L.items ?? []).forEach(([, ix, iy], i) => {
        if (game.world.taken?.[i]) return;
        const k = Math.max(0, Math.sin(t * 1.3 + i * 2.1));
        if (k < 0.8) return;
        const p = world.transformPoint(new DOMPoint(ix, iy));
        ctx.fillStyle = `rgba(255, 235, 150, ${(k - 0.8) * 4})`;
        ctx.fillRect(p.x / dpr - 2, p.y / dpr - 2, 4, 4);
      });
    }

    // Underground (The Block World's cave): dark only where the level says, lit by its torches, the
    // runners, what's worth finding and the exit.
    if (theme.darkZones) {
      dark ??= document.createElement("canvas");
      if (dark.width !== canvas.width || dark.height !== canvas.height) {
        dark.width = canvas.width;
        dark.height = canvas.height;
      }
      const d = dark.getContext("2d");
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalCompositeOperation = "source-over";
      d.clearRect(0, 0, dark.width, dark.height);
      d.setTransform(world);
      const depth = you ? 0.93 : 0.82;
      for (const [zx, zy, zw, zh] of theme.darkZones) {
        const g = d.createLinearGradient(0, zy, 0, zy + 90);
        g.addColorStop(0, "rgba(3, 3, 6, 0)");
        g.addColorStop(1, `rgba(3, 3, 6, ${depth})`);
        d.fillStyle = g;
        d.fillRect(zx, zy, zw, 90);
        d.fillStyle = `rgba(3, 3, 6, ${depth})`;
        d.fillRect(zx, zy + 90, zw, zh - 90);
      }
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalCompositeOperation = "destination-out";
      const light = (wx, wy, r) => {
        const p = world.transformPoint(new DOMPoint(wx, wy));
        const pr = r * v.scale * dpr;
        const g = d.createRadialGradient(p.x, p.y, pr * 0.2, p.x, p.y, pr);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        d.fillStyle = g;
        d.fillRect(p.x - pr, p.y - pr, pr * 2, pr * 2);
      };
      for (const [lx, ly, lr] of theme.lights ?? []) if (Math.abs(lx - v.cx) < halfW * 1.5 + lr && Math.abs(ly - v.cy) < halfH * 1.5 + lr) light(lx, ly, lr);
      for (const h of heads) light(h.x, h.y + 20, h.id === you ? 230 : 150);
      (L.items ?? []).forEach(([, ix, iy], i) => !game.world.taken?.[i] && light(ix, iy, 110));
      d.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(dark, 0, 0);
      ctx.restore();
    }

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

    // Your air, as bubbles over your head, while you're under water (7 s of it, like the server's).
    const mine = you && game.world.runners.find((r) => r[0] === you);
    const pool = mine && mine[4] === 0 && (L.water ?? []).find((w) => inRect(mine[1] + rw / 2, mine[2] + rh / 2, w));
    under = pool && mine[2] > pool[1] + 2 ? under + dt : 0;
    if (under > 0.3) {
      const left = Math.max(0, Math.ceil(7 - under));
      const head = heads.find((h) => h.id === you);
      if (head) {
        const p = toScreen(head.x, head.y);
        for (let i = 0; i < 7; i++) {
          ctx.beginPath();
          ctx.arc(p.x - 30 + i * 10, p.y - labelSize * 2.6, 4, 0, Math.PI * 2);
          ctx.fillStyle = i < left ? "rgba(200, 240, 255, 0.9)" : "rgba(200, 240, 255, 0.12)";
          ctx.fill();
          ctx.strokeStyle = left <= 2 ? "#ff6b5e" : "rgba(20, 60, 120, 0.9)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    if (!rotate && mode === "follow" && follow) {
      // Point at what's next: the nearest thing still to find, then the exit.
      const me = you && game.world.runners.find((r) => r[0] === you);
      const left = (L.items ?? []).map(([, ix, iy], i) => [ix, iy, i]).filter(([, , i]) => !game.world.taken?.[i]);
      let target = null;
      if (left.length && me) {
        const [ix, iy] = left.sort((a, b) => Math.hypot(a[0] - me[1], a[1] - me[2]) - Math.hypot(b[0] - me[1], b[1] - me[2]))[0];
        target = { rect: [ix - 10, iy - 10, 20, 20], label: L.itemLabel === "CORRUPTED FRAGMENTS" ? "FRAGMENT" : "PART" };
      } else target = { rect: L.exit, label: L.exitUse ? "RIFT" : "EXIT" };
      exitPointer(ctx, toScreen, target.rect, width, height, labelSize, target.label);
    }
    // Standing in an exit you have to use: say how.
    if (you && game.world.exit === "active" && L.exitUse) {
      const me = game.world.runners.find((r) => r[0] === you);
      const head = heads.find((h) => h.id === you);
      if (me && head && hits(me[1], me[2], rw, rh, L.exit)) {
        const p = toScreen(head.x, head.y);
        const bob = Math.sin(t * 6) * 3;
        ctx.save();
        pill(ctx, "▼ PRESS DOWN: ENTER THE RIFT", p.x, p.y - labelSize * 2.2 + bob, labelSize * 1.1, "#1a0a24", "#ff9af0");
        ctx.restore();
      }
    }
    if (!rotate && Math.abs(v.tilt) > 0.04) level(ctx, v.tilt, game.world.maxTilt, width, labelSize);

    // Static when the stalker is close: your own closeness on a phone, the nearest runner's elsewhere.
    let near = game.you?.near ?? 0;
    if (!you && game.world.stalker) {
      const [sx, sy] = game.world.stalker;
      for (const h of heads) near = Math.max(near, 0.3 * (1 - Math.hypot(h.x - sx - 15, h.y + 20 - sy - 55) / 250));
    }
    if (near > 0.02) {
      if (!noise) {
        noise = document.createElement("canvas");
        noise.width = noise.height = 96;
        const n = noise.getContext("2d");
        const img = n.createImageData(96, 96);
        for (let i = 0; i < img.data.length; i += 4) {
          const c = Math.random() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
          img.data[i + 3] = 255;
        }
        n.putImageData(img, 0, 0);
      }
      ctx.save();
      // Heavy on your own phone (that's the scare), light on shared screens (they need to see).
      ctx.globalAlpha = you ? Math.min(0.45, near * 0.5) : Math.min(0.18, near * 0.5);
      ctx.fillStyle = ctx.createPattern(noise, "repeat");
      ctx.translate(-Math.random() * 96, -Math.random() * 96);
      ctx.fillRect(0, 0, width + 96, height + 96);
      ctx.restore();
      if (near > 0.25 && t - staticAt > 0.5) {
        staticAt = t;
        emit("static", { near });
      }
    }

    // How many parts are still out there (or, for an exit to use: what to do now).
    if (L.items?.length) {
      const got = (game.world.taken ?? []).filter(Boolean).length;
      const all = got === L.items.length;
      const state = game.world.exit;
      ctx.save();
      ctx.font = `700 ${labelSize}px "Roboto Mono", monospace`;
      const label = L.exitUse
        ? state === "collapse"
          ? "THE WORLD IS COLLAPSING · INTO THE RIFT!"
          : all
            ? "EXIT ACTIVATED · GO TO THE RIFT · ▼ TO ENTER"
            : `${L.itemLabel ?? "DECK PARTS"} ${got} / ${L.items.length}`
        : all
          ? "DECK REASSEMBLED · GO TO THE DOCK"
          : `${L.itemLabel ?? "DECK PARTS"} ${got}/${L.items.length}`;
      const w = ctx.measureText(label).width + 16;
      ctx.fillStyle = state === "collapse" ? "rgba(90, 0, 70, 0.8)" : "rgba(0, 0, 0, 0.65)";
      roundedRect(ctx, 8, height - labelSize * 2.2 - 6, w, labelSize * 2, labelSize);
      ctx.fill();
      ctx.fillStyle = state === "collapse" ? "#ffb0f4" : all ? "#9dffb8" : "#ffe08a";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 16, height - labelSize * 1.2 - 6);
      ctx.restore();
    }

    // The collapse: the world tearing, a magenta edge, blocks falling out of the sky.
    if (game.world.exit === "collapse") {
      const k = Math.min(1, (t - collapseAt) / 1.5);
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.75);
      g.addColorStop(0, "rgba(255, 40, 200, 0)");
      g.addColorStop(1, `rgba(255, 40, 200, ${(0.25 + 0.2 * pulse) * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      if (!reduced) {
        const beat = Math.floor(t * 12);
        for (let i = 0; i < 5; i++) {
          const gy = ((Math.sin(beat * 12.9 + i * 78.2) * 43758.5) % 1 + 1) % 1;
          ctx.fillStyle = i % 2 ? "rgba(0, 240, 255, 0.18)" : "rgba(255, 0, 200, 0.2)";
          ctx.fillRect(0, gy * height, width, 3 + (i % 3) * 4);
        }
        if (fx.count < fx.max * 0.7 && Math.random() < 0.5) fx.burst("debris", v.cx + (Math.random() - 0.5) * halfW * 2, v.cy - halfH, 1, { angle: Math.PI / 2, spread: 0.4, speed: 200, color: Math.random() < 0.5 ? "#5fb03e" : "#f000c8" });
      }
    }

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
    /**
     * "follow" (the camera follows you on small screens), "map" (the whole level) or "draw" (where a
     * plank drawing goes: the whole level, or in a big level the standard-size window around you).
     */
    setMode(next) {
      mode = next === "map" || next === "draw" ? next : "follow";
      const L = game?.level;
      const me = you && position(you);
      if (mode === "draw" && L && me && bigLevel(L)) {
        const winW = Math.min(L.width, VIEW_W);
        const winH = Math.min(L.height, VIEW_H);
        drawOrigin = [Math.round(Math.max(0, Math.min(L.width - winW, me.x + 14 - winW / 2))), Math.round(Math.max(0, Math.min(L.height - winH, me.y + 18 - winH * 0.6)))];
      } else drawOrigin = [0, 0];
    },
    get mode() {
      return mode;
    },
    /** Where the drawing window starts ([0, 0] for a level that fits the screen), and its size. */
    get drawWindow() {
      const L = game?.level;
      return { origin: [...drawOrigin], width: L ? Math.min(L.width, VIEW_W) : VIEW_W, height: L ? Math.min(L.height, VIEW_H) : VIEW_H };
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

/** An arrow at the edge of the screen pointing at the exit (or `label`) when it's out of view. */
function exitPointer(ctx, toScreen, [x, y, w, h], width, height, size, label = "EXIT") {
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
  ctx.fillText(label, cx, cy + (cy > height / 2 ? -22 : 30));
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
