// Angry Thud's Revenge: how everything *looks*. Corn Piggies, the materials, the team's buildings,
// the Red Cow, the slingshot and each level's scenery, all drawn in code (no image files). Nothing
// here affects the game: the server's physics decides what happens; this only paints it.
//
// Corn Piggies are an original CPI species: green, round, long goofy nose, corn-cob braids, an
// oversized corn hat and husk clothes. Entirely made up, based on corn.

import { shade } from "../cpi/character.js";

const INK = "#161218";
const TAU = Math.PI * 2;

function rr(ctx, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function fs(ctx, fill, line = INK, width = 1.4) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** A tiny deterministic noise from numbers (textures that don't shimmer frame to frame). */
function hash(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ Corn Piggies

export const PIG_LOOK = {
  basic: { body: "#8ccf4d", nose: "#b9e68a", hat: "#f5c518" },
  armored: { body: "#7fbf45", nose: "#b0dd84", hat: "#9aa4b1" },
  builder: { body: "#93d152", nose: "#c1ea93", hat: "#ffb000" },
  shield: { body: "#7ccf6a", nose: "#b5eaa6", hat: "#5ec8ff" },
  corruptor: { body: "#7eb34a", nose: "#b99be8", hat: "#9b59ff" },
  boss: { body: "#6fb33a", nose: "#a8d97c", hat: "#ffd23f" },
};

function cob(ctx, x, y, w, h, angle, color = "#f5c518") {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU);
  fs(ctx, color, INK, 0.05);
  ctx.fillStyle = shade(color, -0.22);
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
    const kx = (i * w) / 6.5;
    const ky = (j * h) / 4;
    if ((kx * kx) / ((w / 2) ** 2) + (ky * ky) / ((h / 2) ** 2) > 0.75) continue;
    ctx.fillRect(kx - w * 0.05, ky - h * 0.07, w * 0.1, h * 0.14);
  }
  // A glint on the cob.
  ctx.beginPath();
  ctx.ellipse(-w * 0.16, -h * 0.18, w * 0.1, h * 0.2, 0.2, 0, TAU);
  ctx.fillStyle = "rgba(255, 255, 235, 0.4)";
  ctx.fill();
  ctx.restore();
}

/**
 * A Corn Piggy in a unit circle (drawn at radius r). pose: t, crack (0-4), hurt (0-1, flinch),
 * facing (1 faces left, toward the team, the default: they're watching you; −1 faces right),
 * state ("idle" | "smug" | "build").
 */
export function drawPig(ctx, kind, { x, y, r, angle = 0, t = 0, crack = 0, hurt = 0, facing = 1, state = "idle" }) {
  const look = PIG_LOOK[kind] ?? PIG_LOOK.basic;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(r * facing, r);
  const squish = 1 + Math.sin(t * 2.4 + x) * 0.02 - hurt * 0.12;
  ctx.scale(1 / squish, squish);
  // Corrupted glow.
  if (kind === "corruptor") {
    const g = ctx.createRadialGradient(0, 0, 0.6, 0, 0, 1.6);
    g.addColorStop(0, "rgba(160, 60, 255, 0.35)");
    g.addColorStop(1, "rgba(160, 60, 255, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(-1.8, -1.8, 3.6, 3.6);
  }
  // Corn-cob braids, behind the body.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) cob(ctx, side * (0.86 + i * 0.04), 0.05 + i * 0.36 + Math.sin(t * 3 + i + side) * 0.03, 0.26, 0.42, side * 0.25, kind === "corruptor" ? "#b58cff" : "#f2c230");
  }
  // Body.
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  const body = ctx.createRadialGradient(-0.38, -0.48, 0.05, -0.1, -0.1, 1.15);
  body.addColorStop(0, shade(look.body, 0.42));
  body.addColorStop(0.45, look.body);
  body.addColorStop(1, shade(look.body, -0.3));
  fs(ctx, body, INK, 0.07);
  // Skin: a few freckles, a shadowed underside, and the sky's light catching the back edge.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, 0.97, 0, TAU);
  ctx.clip();
  ctx.fillStyle = shade(look.body, -0.2);
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.arc(-0.1 + (hash(kind.length, i, 3) - 0.3) * 1.2, -0.3 + hash(kind.length, i, 5) * 0.6, 0.025 + hash(i, 7) * 0.035, 0, TAU);
    ctx.fill();
  }
  const under = ctx.createLinearGradient(0, 0.1, 0, 1);
  under.addColorStop(0, "rgba(10, 40, 0, 0)");
  under.addColorStop(1, "rgba(10, 40, 0, 0.3)");
  ctx.fillStyle = under;
  ctx.fillRect(-1, 0.1, 2, 0.9);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, 0.9, Math.PI * 0.05, Math.PI * 0.5);
  ctx.strokeStyle = "rgba(235, 255, 190, 0.45)";
  ctx.lineWidth = 0.07;
  ctx.lineCap = "round";
  ctx.stroke();
  // Husk clothes: a leafy collar with kernel buttons.
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, 0.99, 0, TAU);
  ctx.clip();
  const husk = kind === "armored" ? "#8d97a4" : kind === "corruptor" ? "#5d3d9a" : "#6f9a2e";
  ctx.beginPath();
  ctx.moveTo(-1, 0.55);
  for (let i = 0; i <= 8; i++) ctx.lineTo(-1 + i * 0.25, 0.42 + (i % 2) * 0.14);
  ctx.lineTo(1, 1.1);
  ctx.lineTo(-1, 1.1);
  ctx.closePath();
  fs(ctx, husk, INK, 0.05);
  ctx.fillStyle = kind === "corruptor" ? "#e0c8ff" : "#ffe27a";
  for (const bx of [-0.25, 0.05, 0.35]) (ctx.beginPath(), ctx.arc(bx, 0.72, 0.06, 0, TAU), ctx.fill());
  if (kind === "armored") {
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(-0.7, 0.5, 1.4, 0.06);
  }
  ctx.restore();
  // Ears.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * 0.45, -0.78);
    ctx.lineTo(s * 0.75, -1.08);
    ctx.lineTo(s * 0.8, -0.6);
    ctx.closePath();
    fs(ctx, shade(look.body, -0.1), INK, 0.05);
  }
  // Eyes (they look toward the team), brows, cheeks.
  const eyeY = -0.25;
  const glow = kind === "corruptor";
  for (const ex of [-0.4, 0.08]) {
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 0.2, 0.24, 0, 0, TAU);
    const white = ctx.createRadialGradient(ex - 0.05, eyeY - 0.08, 0.02, ex, eyeY, 0.26);
    white.addColorStop(0, glow ? "#fff0ff" : "#ffffff");
    white.addColorStop(1, glow ? "#d9a8e8" : "#d6dfcb");
    fs(ctx, white, INK, 0.05);
    if (crack >= 3 || hurt > 0.5) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(ex - 0.1, eyeY - 0.08);
      ctx.lineTo(ex + 0.1, eyeY + 0.08);
      ctx.moveTo(ex + 0.1, eyeY - 0.08);
      ctx.lineTo(ex - 0.1, eyeY + 0.08);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(ex + 0.07, eyeY + 0.03, 0.1, 0, TAU);
      ctx.fillStyle = glow ? "#e01cff" : "#5a3a16";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 0.08, eyeY + 0.04, 0.055, 0, TAU);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 0.04, eyeY - 0.01, 0.026, 0, TAU);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      // Smug lids.
      ctx.beginPath();
      ctx.ellipse(ex, eyeY - 0.1, 0.21, 0.13, 0, Math.PI, TAU);
      fs(ctx, shade(look.body, -0.05), INK, 0.04);
    }
  }
  if (crack >= 2) {
    ctx.beginPath();
    ctx.ellipse(-0.4, eyeY, 0.25, 0.28, 0, 0, TAU);
    ctx.strokeStyle = "rgba(90, 40, 120, 0.7)";
    ctx.lineWidth = 0.08;
    ctx.stroke();
  }
  // Brows: thick, scheming wedges (the boss's are thicker still).
  const bt = kind === "boss" ? 0.13 : 0.09;
  ctx.fillStyle = shade(look.body, -0.6);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.03;
  for (const [ax, ay, bx, by] of [[-0.66, -0.6, -0.18, -0.5], [-0.06, -0.53, 0.34, -0.64]]) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx - 0.02, by + bt);
    ctx.lineTo(ax + 0.03, ay + bt * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // The long goofy nose.
  ctx.save();
  ctx.translate(-0.62, 0.12);
  ctx.rotate(-0.12 + Math.sin(t * 1.7) * 0.04);
  ctx.beginPath();
  ctx.ellipse(-0.15, 0, 0.5, 0.24, 0, 0, TAU);
  const snout = ctx.createRadialGradient(-0.3, -0.1, 0.02, -0.15, 0, 0.55);
  snout.addColorStop(0, shade(look.nose, 0.28));
  snout.addColorStop(1, shade(look.nose, -0.18));
  fs(ctx, snout, INK, 0.05);
  ctx.fillStyle = shade(look.nose, -0.45);
  for (const n of [-0.42, -0.22]) (ctx.beginPath(), ctx.ellipse(n, 0.02, 0.05, 0.09, 0, 0, TAU), ctx.fill());
  ctx.beginPath();
  ctx.ellipse(-0.2, -0.12, 0.2, 0.05, -0.05, 0, TAU);
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.fill();
  ctx.restore();
  // Cheeks.
  ctx.beginPath();
  ctx.ellipse(0.28, 0.16, 0.14, 0.08, 0, 0, TAU);
  ctx.fillStyle = "rgba(255, 110, 120, 0.22)";
  ctx.fill();
  // Grin with one buck tooth.
  ctx.beginPath();
  ctx.moveTo(-0.3, 0.38);
  ctx.quadraticCurveTo(0, state === "smug" || state === "build" ? 0.55 : 0.48, 0.3, 0.32);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.07;
  ctx.stroke();
  ctx.fillStyle = "#fffbe8";
  ctx.fillRect(-0.05, 0.42, 0.1, 0.1);
  // Bruises and a band-aid as they get knocked about.
  if (crack >= 1) {
    ctx.save();
    ctx.translate(0.45, -0.1);
    ctx.rotate(0.6);
    rr(ctx, -0.18, -0.06, 0.36, 0.12, 0.04);
    fs(ctx, "#f2c9a0", INK, 0.03);
    ctx.restore();
  }
  // Hats.
  drawPigHat(ctx, kind, look, t, state);
  ctx.restore();
}

function drawPigHat(ctx, kind, look, t, state) {
  if (kind === "armored") {
    ctx.beginPath();
    ctx.arc(0, -0.35, 0.95, Math.PI * 1.02, Math.PI * 1.98);
    ctx.closePath();
    fs(ctx, "#9aa4b1", INK, 0.06);
    ctx.fillStyle = "#c6ccd4";
    for (let i = -3; i <= 3; i++) (ctx.beginPath(), ctx.arc(i * 0.24, -0.72 + Math.abs(i) * 0.05, 0.05, 0, TAU), ctx.fill());
    // A little cob plume on top.
    cob(ctx, 0, -1.35, 0.3, 0.55, 0, "#f5c518");
    return;
  }
  if (kind === "builder") {
    ctx.beginPath();
    ctx.arc(0, -0.62, 0.72, Math.PI, TAU);
    ctx.closePath();
    fs(ctx, look.hat, INK, 0.06);
    rr(ctx, -0.95, -0.66, 1.9, 0.14, 0.05);
    fs(ctx, shade(look.hat, -0.15), INK, 0.05);
    cob(ctx, 0, -0.95, 0.22, 0.34, 0.2, "#fff1a8");
    // The hammer.
    ctx.save();
    ctx.translate(0.95, 0.2);
    ctx.rotate(state === "build" ? Math.sin(t * 14) * 0.9 - 0.4 : -0.3);
    ctx.fillStyle = "#8b5a2b";
    ctx.fillRect(-0.05, -0.8, 0.1, 0.8);
    rr(ctx, -0.22, -0.95, 0.44, 0.2, 0.04);
    fs(ctx, "#6c737d", INK, 0.04);
    ctx.restore();
    return;
  }
  if (kind === "boss") {
    // A crown of golden cobs.
    for (let i = -2; i <= 2; i++) cob(ctx, i * 0.3, -1.05 - (2 - Math.abs(i)) * 0.12, 0.26, 0.6, i * 0.18, "#ffd23f");
    rr(ctx, -0.8, -0.95, 1.6, 0.2, 0.05);
    fs(ctx, "#e0a800", INK, 0.05);
    ctx.fillStyle = "#e03131";
    ctx.beginPath();
    ctx.arc(0, -0.85, 0.07, 0, TAU);
    ctx.fill();
    // A scar.
    ctx.strokeStyle = "#3a5a1a";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(0.25, -0.45);
    ctx.lineTo(0.45, 0.05);
    ctx.stroke();
    return;
  }
  // The oversized corn hat: a big tilted cob in a nest of husk leaves.
  const tilt = -0.25 + Math.sin(t * 1.3) * 0.03;
  ctx.save();
  ctx.translate(0.05, -0.85);
  ctx.rotate(tilt);
  for (const [a, len] of [[-1.1, 0.8], [-0.4, 0.7], [0.4, 0.7], [1.1, 0.8]]) {
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, -len / 2, 0.16, len / 2, 0, 0, TAU);
    fs(ctx, kind === "corruptor" ? "#6b4bb5" : "#5f9a2a", INK, 0.04);
    ctx.restore();
  }
  cob(ctx, 0, -0.55, 0.62, 1.15, 0, kind === "corruptor" ? "#a77bff" : kind === "shield" ? "#f5d34a" : "#f5c518");
  ctx.restore();
  if (kind === "shield") {
    // A round kernel shield on its arm.
    ctx.beginPath();
    ctx.arc(-0.95, 0.35, 0.42, 0, TAU);
    fs(ctx, "#5ec8ff", INK, 0.06);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(-0.95, 0.35, 0.25, 0, TAU);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ materials

export const MATERIAL_COLORS = {
  wood: "#b9803f",
  glass: "#a8dcff",
  stone: "#8a8f98",
  metal: "#9aa4b1",
  ice: "#bff0ff",
  corn: "#e5c35a",
  barrel: "#c0392b",
  vault: "#7c8794",
  totem: "#7a4fc4",
  nest: "#9a6b34",
  building: "#8a8f98",
};

/**
 * Light from the upper left, like the sun in every level: a bright inner edge along the top and
 * left, a shadowed one along the bottom and right. Blocks tumble, so the light turns with them;
 * at this size nobody minds.
 */
function bevel(ctx, x, y, w, h, r, { light = 0.35, dark = 0.32, width = 1.6 } = {}) {
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.lineWidth = width * 2;
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(0, 0, 0, ${dark})`;
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 255, 255, ${light})`;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  ctx.restore();
}

function rivet(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 0, x, y, r);
  g.addColorStop(0, "#f2f5f8");
  g.addColorStop(0.5, "#8d96a2");
  g.addColorStop(1, "#3b4149");
  ctx.fillStyle = g;
  ctx.fill();
}

/** Jagged cracks that branch, with a lit lip beside each so they read as dents, not scribbles. */
function drawCracks(ctx, m, x, y, w, h, crack, seed) {
  const clear = m === "glass" || m === "ice";
  const n = crack * 2 + (crack >= 3 ? 2 : 0);
  const lineOf = (pts, dx, dy) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
    ctx.stroke();
  };
  ctx.save();
  rr(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    let px = x + hash(seed, i, 7) * w;
    let py = y + hash(seed, i, 9) * h;
    const dir = hash(seed, i, 11) * TAU;
    const len = Math.min(w, h) * (0.4 + hash(seed, i, 13) * 0.5) + Math.max(w, h) * 0.14;
    const pts = [[px, py]];
    for (let s = 1; s <= 4; s++) {
      const a = dir + (hash(seed, i, 20 + s) - 0.5) * 1.4;
      px += (Math.cos(a) * len) / 4;
      py += (Math.sin(a) * len) / 4;
      pts.push([px, py]);
    }
    const [bx, by] = pts[2];
    const ba = dir + (hash(seed, i, 31) > 0.5 ? 0.9 : -0.9);
    const branch = [[bx, by], [bx + Math.cos(ba) * len * 0.22, by + Math.sin(ba) * len * 0.22], [bx + Math.cos(ba + 0.4) * len * 0.36, by + Math.sin(ba + 0.4) * len * 0.36]];
    for (const line of [pts, branch]) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = clear ? "rgba(80, 140, 190, 0.45)" : "rgba(255, 240, 220, 0.2)";
      lineOf(line, 0.8, 0.8);
      ctx.lineWidth = line === pts ? 1.3 : 0.9;
      ctx.strokeStyle = clear ? "rgba(255, 255, 255, 0.95)" : "rgba(24, 16, 10, 0.82)";
      lineOf(line, 0, 0);
    }
  }
  // Badly damaged: a corner has chipped away.
  if (crack >= 3) {
    ctx.fillStyle = clear ? "rgba(255, 255, 255, 0.35)" : "rgba(20, 14, 10, 0.45)";
    const cx = hash(seed, 41) > 0.5 ? x + w : x;
    const cy = hash(seed, 43) > 0.5 ? y + h : y;
    const k = Math.min(w, h) * 0.45;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (cx === x ? k : -k), cy);
    ctx.lineTo(cx, cy + (cy === y ? k * 0.8 : -k * 0.8));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A block of a material, in its own frame (centre 0,0; half sizes hw, hh). `seed` (a small number)
 * varies the grain, knots and speckles between otherwise identical blocks. Detailed on purpose:
 * screens cache each block as a sprite (thud-world.js), so this runs once per look, not per frame.
 */
export function drawBlock(ctx, m, hw, hh, { crack = 0, reinforced = false, t = 0, seed = 0 } = {}) {
  const w = hw * 2;
  const h = hh * 2;
  const x = -hw;
  const y = -hh;
  const long = w >= h;
  switch (m) {
    case "wood": {
      rr(ctx, x, y, w, h, 2);
      const g = ctx.createLinearGradient(x, y, long ? x : x + w, long ? y + h : y);
      g.addColorStop(0, "#dfa866");
      g.addColorStop(0.45, "#c0863f");
      g.addColorStop(1, "#8a5626");
      fs(ctx, g, "#4a2c10", 1.3);
      ctx.save();
      rr(ctx, x, y, w, h, 2);
      ctx.clip();
      // Grain: wavy lines along the plank, each its own darkness.
      const across = long ? h : w;
      const along = long ? w : h;
      const lines = Math.max(3, Math.floor(across / 3.2));
      for (let i = 0; i < lines; i++) {
        const k = hash(seed, i, 3);
        ctx.strokeStyle = `rgba(92, 52, 18, ${0.16 + k * 0.3})`;
        ctx.lineWidth = 0.5 + k * 0.9;
        const off = ((i + 0.5) / lines) * across;
        ctx.beginPath();
        for (let s = 0; s <= 12; s++) {
          const d = (s / 12) * along;
          const wob = Math.sin(d * 0.07 + i * 1.7 + seed * 2.3) * across * 0.05;
          const [px, py] = long ? [x + d, y + off + wob] : [x + off + wob, y + d];
          if (s) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }
      // A knot, with the grain's rings around it.
      if (along > 30) {
        const at = 0.2 + hash(seed, 5) * 0.6;
        const kx = long ? x + w * at : x + w / 2;
        const ky = long ? y + h / 2 : y + h * at;
        const kr = Math.min(w, h) * 0.16;
        for (const [rx, a] of [[2.6, 0.35], [1.7, 0.5], [1, 0.75]]) {
          ctx.beginPath();
          ctx.ellipse(kx, ky, long ? kr * rx * 1.5 : kr * rx, long ? kr * rx : kr * rx * 1.5, 0, 0, TAU);
          if (rx === 1) {
            ctx.fillStyle = `rgba(78, 42, 14, ${a})`;
            ctx.fill();
          } else {
            ctx.strokeStyle = `rgba(78, 42, 14, ${a})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }
      // End grain: the cut ends are darker.
      ctx.fillStyle = "rgba(60, 32, 10, 0.28)";
      if (long) {
        ctx.fillRect(x, y, 3, h);
        ctx.fillRect(x + w - 3, y, 3, h);
      } else {
        ctx.fillRect(x, y, w, 3);
        ctx.fillRect(x, y + h - 3, w, 3);
      }
      ctx.restore();
      bevel(ctx, x, y, w, h, 2, { light: 0.32, dark: 0.34, width: 1.4 });
      for (const [nx, ny] of [[x + 3.5, y + 3.5], [x + w - 3.5, y + 3.5], [x + 3.5, y + h - 3.5], [x + w - 3.5, y + h - 3.5]]) {
        ctx.beginPath();
        ctx.arc(nx, ny, 1.2, 0, TAU);
        ctx.fillStyle = "#2a1a0c";
        ctx.fill();
        ctx.fillStyle = "rgba(255, 240, 210, 0.55)";
        ctx.fillRect(nx - 0.7, ny - 0.8, 0.6, 0.6);
      }
      break;
    }
    case "glass": {
      rr(ctx, x, y, w, h, 1.5);
      const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
      g.addColorStop(0, "rgba(215, 244, 255, 0.62)");
      g.addColorStop(1, "rgba(110, 180, 230, 0.34)");
      fs(ctx, g, "rgba(230, 250, 255, 0.95)", 1.4);
      ctx.save();
      rr(ctx, x, y, w, h, 1.5);
      ctx.clip();
      // Reflections: two diagonal bands of sky.
      const s = Math.max(w, h);
      ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.12, y);
      ctx.lineTo(x + w * 0.12 + s * 0.28, y);
      ctx.lineTo(x + w * 0.12 - s * 0.2, y + h);
      ctx.lineTo(x + w * 0.12 - s * 0.48, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.62, y);
      ctx.lineTo(x + w * 0.62 + s * 0.08, y);
      ctx.lineTo(x + w * 0.62 - s * 0.4, y + h);
      ctx.lineTo(x + w * 0.62 - s * 0.48, y + h);
      ctx.closePath();
      ctx.fill();
      // The thick edge you see glass by.
      ctx.strokeStyle = "rgba(60, 130, 180, 0.35)";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      ctx.restore();
      bevel(ctx, x, y, w, h, 1.5, { light: 0.7, dark: 0.18, width: 1 });
      break;
    }
    case "stone": {
      rr(ctx, x, y, w, h, 2);
      fs(ctx, "#4f535a", "#2e3136", 1.3);
      ctx.save();
      rr(ctx, x, y, w, h, 2);
      ctx.clip();
      const rows = Math.max(1, Math.round(h / 14));
      const cols = Math.max(1, Math.round(w / 20));
      const bh = h / rows;
      const bw = w / cols;
      for (let i = 0; i < rows; i++) {
        for (let j = -1; j < cols; j++) {
          const bx = x + j * bw + (i % 2 ? bw / 2 : 0);
          if (bx + bw < x || bx > x + w) continue;
          const by = y + i * bh;
          const tone = shade("#9ba0a8", (hash(seed * 31 + i, j, 3) - 0.5) * 0.3);
          const g = ctx.createLinearGradient(bx, by, bx + bw * 0.4, by + bh);
          g.addColorStop(0, shade(tone, 0.14));
          g.addColorStop(1, shade(tone, -0.14));
          rr(ctx, bx + 0.9, by + 0.9, bw - 1.8, bh - 1.8, 1.8);
          ctx.fillStyle = g;
          ctx.fill();
          ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
          ctx.fillRect(bx + 1.5, by + 1, bw - 3, 1);
          ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
          ctx.fillRect(bx + 1.5, by + bh - 2, bw - 3, 1);
          for (let k = 0; k < 3; k++) {
            ctx.fillStyle = hash(seed, i * 7 + j, k) > 0.5 ? "rgba(255, 255, 255, 0.18)" : "rgba(30, 30, 34, 0.25)";
            ctx.fillRect(bx + 2 + hash(i, j, k + 5) * (bw - 4), by + 2 + hash(j, i, k + 9) * (bh - 4), 1.2, 1.2);
          }
        }
      }
      ctx.restore();
      bevel(ctx, x, y, w, h, 2, { light: 0.2, dark: 0.35, width: 1.2 });
      break;
    }
    case "metal": {
      rr(ctx, x, y, w, h, 2);
      const g = ctx.createLinearGradient(x, y, x + w * 0.2, y + h);
      g.addColorStop(0, "#dfe4ea");
      g.addColorStop(0.35, "#a4adb8");
      g.addColorStop(0.55, "#c8cfd7");
      g.addColorStop(1, "#6d7682");
      fs(ctx, g, "#343a42", 1.4);
      ctx.save();
      rr(ctx, x, y, w, h, 2);
      ctx.clip();
      // Brushed: faint streaks along the plate.
      for (let i = 0; i < Math.max(4, (long ? h : w) / 1.6); i++) {
        ctx.strokeStyle = hash(seed, i, 2) > 0.5 ? "rgba(255, 255, 255, 0.09)" : "rgba(0, 0, 0, 0.07)";
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        if (long) {
          const sy = y + hash(seed, i, 4) * h;
          ctx.moveTo(x, sy);
          ctx.lineTo(x + w, sy);
        } else {
          const sx = x + hash(seed, i, 4) * w;
          ctx.moveTo(sx, y);
          ctx.lineTo(sx, y + h);
        }
        ctx.stroke();
      }
      // A scratch.
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x + w * (0.3 + hash(seed, 8) * 0.3), y + h * 0.3);
      ctx.lineTo(x + w * (0.45 + hash(seed, 9) * 0.3), y + h * 0.62);
      ctx.stroke();
      ctx.restore();
      bevel(ctx, x, y, w, h, 2, { light: 0.55, dark: 0.4, width: 1.5 });
      const rr2 = Math.min(2.2, Math.min(w, h) * 0.14);
      for (const [nx, ny] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) rivet(ctx, nx, ny, rr2);
      break;
    }
    case "ice": {
      rr(ctx, x, y, w, h, 3);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, "rgba(240, 253, 255, 0.85)");
      g.addColorStop(1, "rgba(150, 215, 245, 0.6)");
      fs(ctx, g, "rgba(245, 255, 255, 0.95)", 1.3);
      ctx.save();
      rr(ctx, x, y, w, h, 3);
      ctx.clip();
      // Frost and trapped bubbles.
      for (let i = 0; i < Math.max(6, (w * h) / 90); i++) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + hash(seed, i, 3) * 0.4})`;
        ctx.beginPath();
        ctx.arc(x + hash(seed, i, 5) * w, y + hash(seed, i, 7) * h, 0.5 + hash(seed, i, 9) * 1.1, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.15, y + h * 0.8);
      ctx.lineTo(x + w * 0.4, y + h * 0.3);
      ctx.lineTo(x + w * 0.7, y + h * 0.6);
      ctx.stroke();
      ctx.fillStyle = "rgba(80, 160, 210, 0.18)";
      ctx.fillRect(x, y + h * 0.7, w, h * 0.3);
      ctx.restore();
      bevel(ctx, x, y, w, h, 3, { light: 0.75, dark: 0.15, width: 1.2 });
      break;
    }
    case "corn": {
      rr(ctx, x, y, w, h, 4);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, "#f7dc7a");
      g.addColorStop(1, "#c79a2e");
      fs(ctx, g, "#7a5a16", 1.2);
      ctx.save();
      rr(ctx, x, y, w, h, 4);
      ctx.clip();
      // Kernels in rows, each lit from above.
      const kw = 4.4;
      const kh = 5;
      for (let ky = y + 1; ky < y + h; ky += kh) {
        for (let kx = x + 1 + ((ky / kh) % 2 ? kw / 2 : 0); kx < x + w; kx += kw) {
          rr(ctx, kx, ky, kw - 0.8, kh - 0.8, 1.4);
          ctx.fillStyle = shade("#f0c84a", (hash(Math.round(kx), Math.round(ky), seed) - 0.5) * 0.2);
          ctx.fill();
          ctx.fillStyle = "rgba(255, 255, 230, 0.55)";
          ctx.fillRect(kx + 0.8, ky + 0.7, 1.2, 1);
        }
      }
      ctx.fillStyle = "#6f4a16";
      ctx.fillRect(x, y + h * 0.3, w, 2);
      ctx.fillRect(x, y + h * 0.7, w, 2);
      ctx.restore();
      bevel(ctx, x, y, w, h, 4, { light: 0.3, dark: 0.3, width: 1.4 });
      break;
    }
    case "barrel": {
      rr(ctx, x, y, w, h, 5);
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, "#6e1a10");
      g.addColorStop(0.3, "#e45a40");
      g.addColorStop(0.42, "#ff8a6a");
      g.addColorStop(0.6, "#c63a26");
      g.addColorStop(1, "#5e140c");
      fs(ctx, g, "#2e0b06", 1.4);
      ctx.save();
      rr(ctx, x, y, w, h, 5);
      ctx.clip();
      ctx.strokeStyle = "rgba(60, 10, 4, 0.35)";
      ctx.lineWidth = 0.8;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x + (w * i) / 5, y);
        ctx.lineTo(x + (w * i) / 5, y + h);
        ctx.stroke();
      }
      for (const k of [0.16, 0.8]) {
        const hg = ctx.createLinearGradient(0, y + h * k, 0, y + h * k + 3);
        hg.addColorStop(0, "#b7bcc3");
        hg.addColorStop(1, "#3a3d42");
        ctx.fillStyle = hg;
        ctx.fillRect(x, y + h * k, w, 3);
      }
      ctx.restore();
      ctx.fillStyle = "#ffd400";
      ctx.beginPath();
      ctx.moveTo(0, y + h * 0.33);
      ctx.lineTo(w * 0.22, y + h * 0.65);
      ctx.lineTo(-w * 0.22, y + h * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = `bold ${Math.max(6, h * 0.2)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("!", 0, y + h * 0.62);
      break;
    }
    case "vault": {
      rr(ctx, x, y, w, h, 3);
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, "#9aa4b1");
      g.addColorStop(1, "#4d5561");
      fs(ctx, g, "#23282e", 1.5);
      rr(ctx, x + 4, y + 4, w - 8, h - 8, 2);
      const gi = ctx.createLinearGradient(x, y, x, y + h);
      gi.addColorStop(0, "#8f99a6");
      gi.addColorStop(1, "#6b7582");
      fs(ctx, gi, "rgba(0, 0, 0, 0.35)", 1);
      bevel(ctx, x, y, w, h, 3, { light: 0.4, dark: 0.4, width: 1.6 });
      const cr = Math.min(w, h) * 0.24;
      ctx.beginPath();
      ctx.arc(0, 0, cr, 0, TAU);
      const cg = ctx.createRadialGradient(-cr * 0.35, -cr * 0.35, 0, 0, 0, cr);
      cg.addColorStop(0, "#fff3b0");
      cg.addColorStop(0.5, "#ffd23f");
      cg.addColorStop(1, "#b08300");
      fs(ctx, cg, "#6e5200", 1.2);
      ctx.fillStyle = "#7a5c00";
      ctx.font = `900 ${Math.min(w, h) * 0.3}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("K", 0, 1);
      ctx.textBaseline = "alphabetic";
      for (const [nx, ny] of [[x + 6, y + 6], [x + w - 6, y + 6], [x + 6, y + h - 6], [x + w - 6, y + h - 6]]) rivet(ctx, nx, ny, 1.8);
      break;
    }
    case "totem": {
      rr(ctx, x, y, w, h, 4);
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, "#8a5ad6");
      g.addColorStop(1, "#472283");
      fs(ctx, g, "#22103f", 1.5);
      ctx.strokeStyle = "rgba(20, 8, 40, 0.45)";
      ctx.lineWidth = 1;
      for (const k of [0.2, 0.8]) {
        ctx.beginPath();
        ctx.moveTo(x + 2, y + h * k);
        ctx.lineTo(x + w - 2, y + h * k);
        ctx.stroke();
      }
      bevel(ctx, x, y, w, h, 4, { light: 0.25, dark: 0.35, width: 1.4 });
      const glow = 0.6 + Math.sin(t * 4) * 0.3;
      for (const ex of [-w * 0.18, w * 0.18]) {
        const eg = ctx.createRadialGradient(ex, y + h * 0.35, 0, ex, y + h * 0.35, 6);
        eg.addColorStop(0, `rgba(255, 140, 240, ${glow})`);
        eg.addColorStop(1, "rgba(255, 60, 220, 0)");
        ctx.fillStyle = eg;
        ctx.fillRect(ex - 6, y + h * 0.35 - 6, 12, 12);
        ctx.fillStyle = `rgba(255, 220, 250, ${glow})`;
        ctx.beginPath();
        ctx.arc(ex, y + h * 0.35, 2.2, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(0, y + h * 0.6, w * 0.25, h * 0.1, 0, 0, TAU);
      fs(ctx, "#2a1450", "#14082a", 1);
      break;
    }
    default: {
      rr(ctx, x, y, w, h, 2);
      fs(ctx, MATERIAL_COLORS[m] ?? "#888", INK, 1.2);
      bevel(ctx, x, y, w, h, 2);
    }
  }
  if (reinforced) {
    const long2 = w > h;
    for (const k of [0.25, 0.75]) {
      const bx = long2 ? x + w * k - 2.5 : x;
      const by = long2 ? y : y + h * k - 2.5;
      const bw = long2 ? 5 : w;
      const bh = long2 ? h : 5;
      const g = ctx.createLinearGradient(bx, by, long2 ? bx + bw : bx, long2 ? by : by + bh);
      g.addColorStop(0, "#9aa4b1");
      g.addColorStop(0.5, "#5b6470");
      g.addColorStop(1, "#3b424c");
      ctx.fillStyle = g;
      ctx.fillRect(bx, by, bw, bh);
      if (long2) {
        rivet(ctx, bx + 2.5, y + 3, 1.2);
        rivet(ctx, bx + 2.5, y + h - 3, 1.2);
      } else {
        rivet(ctx, x + 3, by + 2.5, 1.2);
        rivet(ctx, x + w - 3, by + 2.5, 1.2);
      }
    }
  }
  if (crack > 0) drawCracks(ctx, m, x, y, w, h, crack, seed);
}

// ------------------------------------------------------------------ the team's buildings

/** A team building in its own frame (centre 0,0; half sizes hw, hh). */
export function drawBuilding(ctx, type, tier, hw, hh, { t = 0, disabled = false, broken = false, waterlogged = false, crack = 0, progress = 0 } = {}) {
  const w = hw * 2;
  const h = hh * 2;
  const x = -hw;
  const y = -hh;
  switch (type) {
    case "nest": {
      ctx.beginPath();
      ctx.ellipse(0, y + h * 0.62, hw, hh * 0.62, 0, 0, Math.PI);
      ctx.lineTo(-hw, y + h * 0.62);
      fs(ctx, "#9a6b34", "#4a2e10", 1.4);
      ctx.strokeStyle = "rgba(230, 190, 110, 0.7)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.moveTo(x + (w * i) / 9, y + h * 0.62 + hash(i) * 6);
        ctx.quadraticCurveTo(x + (w * (i + 0.5)) / 9, y + h * 0.95, x + (w * (i + 1.4)) / 9, y + h * 0.6);
        ctx.stroke();
      }
      const eggs = Math.max(1, Math.min(3, 1 + Math.floor(progress * 3)));
      for (let i = 0; i < eggs; i++) {
        const ex = (i - (eggs - 1) / 2) * hw * 0.42;
        ctx.save();
        ctx.translate(ex, y + h * 0.5 + Math.sin(t * 5 + i) * (progress > 0.6 ? 1.2 : 0));
        ctx.beginPath();
        ctx.ellipse(0, 0, hw * 0.18, hh * 0.38, 0, 0, TAU);
        const eg = ctx.createRadialGradient(-hw * 0.06, -hh * 0.14, 0, 0, 0, hh * 0.42);
        eg.addColorStop(0, "#ffffff");
        eg.addColorStop(1, "#e6d6ae");
        fs(ctx, eg, "#6b5a3a", 1);
        ctx.fillStyle = "#c98f3a";
        for (let k = 0; k < 4; k++) ctx.fillRect(-hw * 0.1 + hash(i, k) * hw * 0.2, -hh * 0.25 + hash(k, i, 3) * hh * 0.5, 1.4, 1.4);
        ctx.restore();
      }
      break;
    }
    case "wall": {
      rr(ctx, x, y, w, h, 3);
      const wg = ctx.createLinearGradient(x, y, x + w, y + h);
      wg.addColorStop(0, "#a3be4a");
      wg.addColorStop(1, "#6a8228");
      fs(ctx, wg, "#3c4a14", 1.4);
      bevel(ctx, x, y, w, h, 3, { light: 0.3, dark: 0.35 });
      ctx.strokeStyle = "rgba(60, 74, 20, 0.6)";
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + (w * i) / 3, y + 3);
        ctx.lineTo(x + (w * i) / 3, y + h - 3);
        ctx.stroke();
      }
      ctx.fillStyle = "#6b4a1a";
      for (const k of [0.2, 0.5, 0.8]) ctx.fillRect(x - 1, y + h * k, w + 2, 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i <= 4; i++) ctx.lineTo(x + (w * i) / 4, y - 6 + (i % 2) * 6);
      fs(ctx, "#a4c24a", "#3c4a14", 1);
      break;
    }
    case "barricade": {
      rr(ctx, x, y, w, h, 3);
      const bg = ctx.createLinearGradient(x, y, x + w, y + h);
      bg.addColorStop(0, "#a6abb3");
      bg.addColorStop(1, "#6a6f78");
      fs(ctx, bg, "#3e4148", 1.4);
      bevel(ctx, x, y, w, h, 3, { light: 0.3, dark: 0.35 });
      ctx.strokeStyle = "rgba(40, 42, 48, 0.5)";
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x, y + (h * i) / 4);
        ctx.lineTo(x + w, y + (h * i) / 4);
        ctx.stroke();
      }
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(x + w * (0.2 + i * 0.3), y + h - 6, w * 0.16, 7, 0, 0, TAU);
        fs(ctx, "#c2a46a", "#6b5530", 1);
      }
      break;
    }
    case "shield": {
      rr(ctx, x + w * 0.1, y + h * 0.45, w * 0.8, h * 0.55, 3);
      fs(ctx, "#5c6570", "#2a2f36", 1.3);
      ctx.beginPath();
      ctx.arc(0, y + h * 0.35, hw * 0.55, 0, TAU);
      const g = ctx.createRadialGradient(-3, y + h * 0.3, 1, 0, y + h * 0.35, hw * 0.6);
      g.addColorStop(0, "#e6fbff");
      g.addColorStop(1, disabled ? "#5a6a76" : "#35b6ff");
      fs(ctx, g, "#1c4c70", 1.2);
      break;
    }
    case "clone": {
      rr(ctx, x, y + h * 0.82, w, h * 0.18, 2);
      fs(ctx, "#4d545e", INK, 1.2);
      rr(ctx, x + 3, y + 4, w - 6, h * 0.8, 10);
      fs(ctx, "rgba(140, 255, 170, 0.25)", "rgba(220, 255, 230, 0.9)", 1.4);
      ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
      ctx.fillRect(x + 7, y + 10, 3, h * 0.6);
      ctx.save();
      rr(ctx, x + 3, y + 4, w - 6, h * 0.8, 10);
      ctx.clip();
      ctx.fillStyle = "rgba(90, 230, 120, 0.55)";
      ctx.fillRect(x, y + h * 0.3 + Math.sin(t * 2) * 2, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < 4; i++) (ctx.beginPath(), ctx.arc(x + w * (0.3 + 0.15 * i), y + h * 0.8 - ((t * 20 + i * 13) % (h * 0.5)), 1.6, 0, TAU), ctx.fill());
      ctx.fillStyle = "rgba(20, 60, 30, 0.45)";
      ctx.beginPath();
      ctx.arc(0, y + h * 0.5, hw * 0.35, 0, TAU);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "weather": {
      // A mast with an instrument that grows with the tier.
      rr(ctx, x + w * 0.15, y + h - 14, w * 0.7, 14, 2);
      fs(ctx, "#4d545e", INK, 1.2);
      ctx.save();
      if (broken) ctx.rotate(0.22);
      ctx.fillStyle = "#8f98a3";
      ctx.fillRect(-2.5, y + 14, 5, h - 28);
      ctx.strokeStyle = "#5a626c";
      ctx.lineWidth = 1;
      for (let i = y + 20; i < y + h - 16; i += 10) {
        ctx.beginPath();
        ctx.moveTo(-6, i);
        ctx.lineTo(6, i + 8);
        ctx.stroke();
      }
      const top = y + 14;
      if (tier === 1) {
        rr(ctx, -hw * 0.7, top - 4, hw * 1.4, 16, 3);
        fs(ctx, "#c26b2d", INK, 1.2);
        ctx.fillStyle = "#ffe8a0";
        ctx.fillRect(-hw * 0.5, top, hw * 0.5, 7);
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.moveTo(hw * 0.4, top - 4);
        ctx.lineTo(hw * 0.7, top - 22);
        ctx.stroke();
      } else if (tier === 2) {
        ctx.save();
        ctx.translate(0, top);
        ctx.rotate(-0.5 + Math.sin(t) * 0.2);
        ctx.beginPath();
        ctx.ellipse(0, 0, hw * 0.85, 7, 0, Math.PI, TAU);
        fs(ctx, "#dfe6ee", INK, 1.2);
        ctx.restore();
      } else {
        const dishes = tier === 3 ? 3 : 1;
        for (let i = 0; i < dishes; i++) {
          ctx.save();
          ctx.translate((i - (dishes - 1) / 2) * hw * 0.7, top + (i === 1 ? -6 : 4));
          ctx.rotate(-0.6 + i * 0.3 + Math.sin(t * 0.8 + i) * 0.15);
          ctx.beginPath();
          ctx.ellipse(0, 0, hw * (tier === 4 ? 0.95 : 0.5), 6, 0, Math.PI, TAU);
          fs(ctx, "#eef2f6", INK, 1.1);
          ctx.restore();
        }
        if (tier === 4) {
          // The CPI Weather Management System: a sweeping radar and warning lights.
          ctx.strokeStyle = "rgba(120, 255, 170, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, top - 2);
          ctx.lineTo(Math.cos(t * 2) * hw * 1.4, top - 2 + Math.sin(t * 2) * 6);
          ctx.stroke();
          ctx.fillStyle = Math.sin(t * 6) > 0 ? "#ff4d4d" : "#661a1a";
          ctx.beginPath();
          ctx.arc(0, top - 12, 3, 0, TAU);
          ctx.fill();
          rr(ctx, -hw * 0.6, y + h * 0.55, hw * 1.2, 12, 2);
          fs(ctx, "#ffd400", INK, 1);
          ctx.fillStyle = INK;
          ctx.font = "900 8px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("CPI", 0, y + h * 0.55 + 9);
        }
      }
      ctx.restore();
      if (broken) {
        ctx.fillStyle = "rgba(60, 60, 60, 0.55)";
        for (let i = 0; i < 3; i++) (ctx.beginPath(), ctx.arc(Math.sin(t * 2 + i) * 6, y - 6 - ((t * 18 + i * 12) % 36), 6 + i * 2, 0, TAU), ctx.fill());
      }
      break;
    }
    default:
      rr(ctx, x, y, w, h, 2);
      fs(ctx, "#888", INK, 1);
  }
  if (crack > 0) {
    ctx.strokeStyle = "rgba(20, 14, 10, 0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < crack * 2; i++) {
      const sx = x + hash(i, type.length, 3) * w;
      const sy = y + hash(i, type.length, 5) * h;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (hash(i, 7) - 0.5) * w * 0.5, sy + (hash(i, 9) - 0.5) * h * 0.4);
    }
    ctx.stroke();
  }
  if (waterlogged) {
    ctx.fillStyle = "rgba(60, 140, 220, 0.35)";
    ctx.fillRect(x, y, w, h);
  }
  if (disabled || broken) {
    ctx.fillStyle = "rgba(15, 18, 24, 0.5)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = broken ? "#ff4d4d" : "#ffd400";
    ctx.font = "900 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(broken ? "BROKEN" : "⚡ OFFLINE", 0, 0);
  }
}

// ------------------------------------------------------------------ the Red Cow

/**
 * The Red Cow statue behind the fortress, built from the ground up to `progress` (0..1). While it's
 * unfinished the rest shows as a cyan blueprint inside scaffolding.
 */
export function drawRedCow(ctx, x, groundY, progress, { t = 0, workers = 0, scale = 1 } = {}) {
  const W = 250 * scale;
  const H = 330 * scale;
  const left = x - W / 2;
  const top = groundY - H;
  const shape = () => {
    ctx.beginPath();
    // Pedestal.
    ctx.rect(left + W * 0.12, groundY - H * 0.14, W * 0.76, H * 0.14);
    // Legs.
    for (const lx of [0.22, 0.34, 0.62, 0.74]) ctx.rect(left + W * lx, groundY - H * 0.36, W * 0.07, H * 0.23);
    // Body.
    ctx.roundRect?.(left + W * 0.16, groundY - H * 0.62, W * 0.66, H * 0.3, 30 * scale);
    // Head, horns, ears.
    ctx.moveTo(left + W * 0.9, groundY - H * 0.72);
    ctx.ellipse(left + W * 0.8, groundY - H * 0.7, W * 0.13, H * 0.1, 0.2, 0, TAU);
    ctx.moveTo(left + W * 0.72, groundY - H * 0.78);
    ctx.lineTo(left + W * 0.66, groundY - H * 0.92);
    ctx.lineTo(left + W * 0.76, groundY - H * 0.8);
    ctx.moveTo(left + W * 0.86, groundY - H * 0.8);
    ctx.lineTo(left + W * 0.94, groundY - H * 0.94);
    ctx.lineTo(left + W * 0.9, groundY - H * 0.78);
    // Tail.
    ctx.rect(left + W * 0.08, groundY - H * 0.6, W * 0.1, H * 0.03);
  };
  ctx.save();
  // Its shadow on the ground.
  const sh = ctx.createRadialGradient(x, groundY, 0, x, groundY, W * 0.6);
  sh.addColorStop(0, `rgba(0, 0, 0, ${0.15 + progress * 0.25})`);
  sh.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = sh;
  ctx.fillRect(x - W * 0.6, groundY - 10, W * 1.2, 20);
  // Blueprint of the whole thing.
  shape();
  ctx.setLineDash([6 * scale, 5 * scale]);
  ctx.strokeStyle = "rgba(90, 220, 255, 0.55)";
  ctx.lineWidth = 2 * scale;
  ctx.stroke();
  ctx.setLineDash([]);
  // What's built so far.
  const builtTop = groundY - H * Math.max(0, Math.min(1, progress));
  ctx.save();
  ctx.beginPath();
  ctx.rect(left - 20, builtTop, W + 40, groundY - builtTop + 2);
  ctx.clip();
  shape();
  const g = ctx.createLinearGradient(left, top, left + W, groundY);
  g.addColorStop(0, "#ff4a3d");
  g.addColorStop(1, "#8e1410");
  ctx.fillStyle = g;
  ctx.fill("nonzero");
  ctx.strokeStyle = "#3d0705";
  ctx.lineWidth = 2.5 * scale;
  ctx.stroke();
  // Fresh red paint: a gloss along its back and the top of its head.
  ctx.save();
  shape();
  ctx.clip("nonzero");
  const gloss = ctx.createLinearGradient(0, groundY - H * 0.66, 0, groundY - H * 0.48);
  gloss.addColorStop(0, "rgba(255, 255, 255, 0.4)");
  gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(left, groundY - H * 0.8, W, H * 0.32);
  ctx.restore();
  // Spots, the snout, and its eyes (which light up as it nears completion).
  ctx.fillStyle = "rgba(255, 220, 200, 0.35)";
  for (const [sx, sy, sr] of [[0.35, 0.5, 0.06], [0.55, 0.45, 0.05], [0.45, 0.56, 0.04]]) (ctx.beginPath(), ctx.arc(left + W * sx, groundY - H * sy, W * sr, 0, TAU), ctx.fill());
  ctx.beginPath();
  ctx.ellipse(left + W * 0.9, groundY - H * 0.66, W * 0.06, H * 0.04, 0.2, 0, TAU);
  ctx.fillStyle = "#ffb3a8";
  ctx.fill();
  const glow = progress > 0.6 ? 0.5 + Math.sin(t * 5) * 0.4 : 0.15;
  ctx.fillStyle = `rgba(255, 240, 80, ${glow})`;
  ctx.beginPath();
  ctx.arc(left + W * 0.8, groundY - H * 0.72, W * 0.022, 0, TAU);
  ctx.fill();
  ctx.restore();
  // Scaffolding around the unfinished part.
  if (progress < 1) {
    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = 3 * scale;
    for (let i = 0; i <= 4; i++) {
      const sx = left + (W * i) / 4;
      ctx.beginPath();
      ctx.moveTo(sx, groundY);
      ctx.lineTo(sx, top - 6);
      ctx.stroke();
    }
    for (let j = 1; j <= 5; j++) {
      const sy = groundY - (H * j) / 5;
      ctx.beginPath();
      ctx.moveTo(left, sy);
      ctx.lineTo(left + W, sy);
      ctx.stroke();
    }
    // Little piggy workers on the scaffold, hammering.
    for (let i = 0; i < workers; i++) {
      const wx = left + W * (0.15 + ((i * 0.37) % 0.7));
      const wy = Math.max(top + 20, builtTop - 4) + (i % 2) * 18 * scale;
      drawPig(ctx, "builder", { x: wx, y: wy - 12 * scale, r: 12 * scale, t: t + i, state: "build", facing: i % 2 ? 1 : -1 });
    }
  }
  // The sign.
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  rr(ctx, x - 70 * scale, groundY + 6, 140 * scale, 22 * scale, 4);
  ctx.fill();
  ctx.fillStyle = "#ff6a5a";
  ctx.font = `900 ${12 * scale}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`RED COW ${Math.round(progress * 100)}%`, x, groundY + 21 * scale);
  ctx.restore();
}

// ------------------------------------------------------------------ the slingshot

/**
 * The slingshot: a forked branch with leather wraps and a rubber band. `pouch` is where the band
 * is pulled to (null: at rest); `power` (0-1) stretches the band thinner and hotter; `twang` (0-1)
 * wobbles the band just after a launch.
 */
export function drawSling(ctx, x, y, { pouch = null, back = true, power = 0, twang = 0, t = 0 } = {}) {
  const forkTop = y - 18;
  const left = [x - 20, forkTop - 16];
  const right = [x + 20, forkTop - 16];
  const stretch = pouch ? Math.max(0, Math.min(1, power)) : 0;
  const bandWidth = 4.6 - stretch * 1.8;
  const bandColor = `rgb(${Math.round(80 + stretch * 90)}, ${Math.round(38 - stretch * 10)}, ${Math.round(16 + stretch * 4)})`;
  const bandTo = (from) => {
    ctx.strokeStyle = bandColor;
    ctx.lineWidth = bandWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...from);
    ctx.lineTo(pouch[0], pouch[1]);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 190, 150, 0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  if (back && pouch) bandTo(right);
  if (back) return;
  // The branch: a dark edge, the wood, then light down its left side.
  const branch = () => {
    ctx.beginPath();
    ctx.moveTo(x, y + 44);
    ctx.lineTo(x, forkTop);
    ctx.moveTo(x, forkTop + 4);
    ctx.lineTo(...left);
    ctx.moveTo(x, forkTop + 4);
    ctx.lineTo(...right);
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  branch();
  ctx.strokeStyle = "#3a1f0c";
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.strokeStyle = "#7a4521";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.save();
  ctx.translate(-2, -1);
  branch();
  ctx.strokeStyle = "rgba(214, 160, 100, 0.55)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
  // Bark nicks down the trunk.
  ctx.strokeStyle = "rgba(40, 20, 6, 0.6)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const by = forkTop + 8 + i * 6.5;
    ctx.beginPath();
    ctx.moveTo(x - 3 + (i % 2) * 2, by);
    ctx.lineTo(x + 1 + (i % 2) * 2, by + 2.5);
    ctx.stroke();
  }
  // Leather wraps where the band ties on.
  for (const [wx, wy] of [left, right]) {
    ctx.fillStyle = "#4a2a14";
    rr(ctx, wx - 5.5, wy - 1, 11, 7, 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 220, 180, 0.25)";
    ctx.fillRect(wx - 4.5, wy, 9, 1.2);
  }
  if (pouch) {
    bandTo(left);
    // The leather pouch behind the bird.
    ctx.fillStyle = "#3e2412";
    ctx.beginPath();
    ctx.ellipse(pouch[0] - 6, pouch[1], 6, 10, 0, 0, TAU);
    ctx.fill();
  } else {
    // At rest (and wobbling just after a shot).
    const wob = twang > 0 ? Math.sin(t * 60) * 14 * twang : 0;
    ctx.strokeStyle = bandColor;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(...left);
    ctx.quadraticCurveTo(x + wob * 0.3, forkTop - 6 + wob, ...right);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ scenery

const THEMES = {
  site: { sky: ["#6fbdf0", "#bfe3f7", "#fde7b6"], far: "#9fb7c9", mid: "#6f8aa0", hills: "#7f9a6a", ground: "#6d8f3a", dirt: "#8a5a2b", sun: "#fff3b0", cloud: "#ffffff", grass: true },
  facility: { sky: ["#0b1630", "#1d3456", "#35557c"], far: "#1a2a44", mid: "#26374f", hills: "#1f2d40", ground: "#565b62", dirt: "#3d4147", moon: true, cloud: "#5a6f94" },
  refinery: { sky: ["#3c1b3a", "#b24a3c", "#f5a45b"], far: "#5a2c3a", mid: "#40202c", hills: "#4c2630", ground: "#4a3a2e", dirt: "#2e241c", sun: "#ffd28a", cloud: "#ffb68a" },
  station: { sky: ["#3e5270", "#6f86a6", "#b8c7d9"], far: "#56657c", mid: "#46536a", hills: "#5a6a62", ground: "#6b7066", dirt: "#4b4f47", cloud: "#e6ecf5", grass: true },
  thudplex: { sky: ["#2a0a0e", "#7a1d18", "#d4583a"], far: "#4a1616", mid: "#3a1010", hills: "#401513", ground: "#4f3b2a", dirt: "#33251a", sun: "#ffb070", cloud: "#ff8a6a" },
};

export function themeOf(id) {
  return THEMES[id] ?? THEMES.site;
}

/** A soft cloud: overlapping puffs, lit from above, shadowed underneath. */
function cloud(ctx, cx, cy, s, color, alpha) {
  const g = ctx.createLinearGradient(0, cy - 50 * s, 0, cy + 30 * s);
  g.addColorStop(0, color);
  g.addColorStop(1, shade(color, -0.28));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  for (const [dx, dy, r] of [[-60, 8, 30], [-25, -10, 42], [20, -22, 48], [62, -4, 36], [92, 10, 24], [15, 12, 34]]) {
    ctx.moveTo(cx + (dx + r) * s, cy + dy * s);
    ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
}

/** Paints the static backdrop and terrain for a level (world units; cache it). */
export function paintBackdrop(ctx, level, { top = -400 } = {}) {
  const th = themeOf(level.theme);
  const W = level.width;
  const G = level.groundY;
  const sky = ctx.createLinearGradient(0, top, 0, G);
  th.sky.forEach((c, i) => sky.addColorStop(i / (th.sky.length - 1), c));
  ctx.fillStyle = sky;
  ctx.fillRect(-400, top, W + 800, G - top + 400);
  if (th.sun) {
    const sg = ctx.createRadialGradient(1500, 120, 10, 1500, 120, 320);
    sg.addColorStop(0, th.sun);
    sg.addColorStop(0.25, shade(th.sun, -0.05));
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(1100, -250, 800, 760);
    ctx.fillStyle = "rgba(255, 255, 240, 0.9)";
    ctx.beginPath();
    ctx.arc(1500, 120, 34, 0, TAU);
    ctx.fill();
  }
  if (th.moon) {
    const mg = ctx.createRadialGradient(1700, 90, 40, 1700, 90, 160);
    mg.addColorStop(0, "rgba(200, 220, 255, 0.25)");
    mg.addColorStop(1, "rgba(200, 220, 255, 0)");
    ctx.fillStyle = mg;
    ctx.fillRect(1540, -70, 320, 320);
    ctx.fillStyle = "#e8eef8";
    ctx.beginPath();
    ctx.arc(1700, 90, 46, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(160, 175, 200, 0.5)";
    for (const [dx, dy, r] of [[-14, -10, 9], [12, 8, 7], [-4, 18, 5]]) (ctx.beginPath(), ctx.arc(1700 + dx, 90 + dy, r, 0, TAU), ctx.fill());
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 70; i++) ctx.fillRect(hash(i, 1) * W, top + hash(i, 2) * (G * 0.55 - top), 2, 2);
  }
  // High clouds, behind everything.
  for (let i = 0; i < 7; i++) cloud(ctx, -200 + hash(i, 5) * (W + 400), top + 140 + hash(i, 6) * 300, 0.7 + hash(i, 8) * 0.9, th.cloud, th.moon ? 0.35 : 0.8);
  // Far layer: a skyline that fits the place.
  ctx.fillStyle = th.far;
  ctx.beginPath();
  ctx.moveTo(-400, G);
  for (let x = -400; x <= W + 400; x += 60) {
    const k = hash(Math.floor(x / 60), 3);
    ctx.lineTo(x, G - 170 - k * (level.theme === "station" ? 320 : 170));
    if (level.theme !== "station") ctx.lineTo(x + 60, G - 170 - k * 170);
  }
  ctx.lineTo(W + 400, G);
  ctx.closePath();
  ctx.fill();
  // Lit windows in the far skyline at night.
  if (th.moon) {
    ctx.fillStyle = "rgba(255, 214, 120, 0.5)";
    for (let i = 0; i < 90; i++) ctx.fillRect(-300 + hash(i, 11) * (W + 600), G - 150 - hash(i, 12) * 150, 3, 4);
  }
  // Rolling hills in front of it, then haze: further away is paler.
  ctx.fillStyle = th.hills;
  ctx.beginPath();
  ctx.moveTo(-400, G);
  for (let x = -400; x <= W + 400; x += 30) ctx.lineTo(x, G - 70 - (Math.sin(x / 260) + 1) * 38 - (Math.sin(x / 97 + 1.3) + 1) * 12);
  ctx.lineTo(W + 400, G);
  ctx.closePath();
  ctx.fill();
  const haze = ctx.createLinearGradient(0, G - 420, 0, G);
  haze.addColorStop(0, "rgba(255, 255, 255, 0)");
  haze.addColorStop(1, th.sky[th.sky.length - 1]);
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = haze;
  ctx.fillRect(-400, G - 420, W + 800, 420);
  ctx.restore();
  if (th.clouds) {
    ctx.fillStyle = "rgba(230, 236, 245, 0.55)";
    for (let i = 0; i < 9; i++) {
      const cx = hash(i, 5) * W;
      const cy = 60 + hash(i, 6) * 220;
      for (let j = 0; j < 4; j++) (ctx.beginPath(), ctx.arc(cx + j * 40, cy + (j % 2) * 10, 40 + hash(i, j) * 20, 0, TAU), ctx.fill());
    }
  }
  paintProps(ctx, level, th);
  // Ground: every terrain rect, with a surface.
  for (const [x, y, w, h] of level.terrain) paintGround(ctx, level, th, x, y, w, h);
  // Moat water in the Thudplex's gap.
  if (level.theme === "thudplex") {
    const gapL = level.terrain[0][0] + level.terrain[0][2];
    const gapR = level.terrain[1][0];
    const wg = ctx.createLinearGradient(0, G + 20, 0, G + 200);
    wg.addColorStop(0, "#3a7394");
    wg.addColorStop(1, "#0c1c26");
    ctx.fillStyle = wg;
    ctx.fillRect(gapL, G + 30, gapR - gapL, 400);
    ctx.strokeStyle = "rgba(200, 235, 255, 0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(gapL + 10 + i * 30, G + 40 + i * 12);
      ctx.lineTo(gapL + 50 + i * 30, G + 40 + i * 12);
      ctx.stroke();
    }
  }
  // Build zones: a subtle painted line on the ground.
  ctx.strokeStyle = "rgba(255, 212, 0, 0.35)";
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  for (const [a, b] of level.zones) {
    ctx.beginPath();
    ctx.moveTo(a, G + 12);
    ctx.lineTo(b, G + 12);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** One slab of ground: soil in layers with stones in it, and grass or concrete on top. */
function paintGround(ctx, level, th, x, y, w, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 200));
  g.addColorStop(0, th.dirt);
  g.addColorStop(1, shade(th.dirt, -0.4));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h + 400);
  // Strata: wavy bands of darker soil.
  for (let band = 0; band < 3; band++) {
    const by = y + 40 + band * 46;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.08 + band * 0.03})`;
    ctx.beginPath();
    ctx.moveTo(x, by);
    for (let bx = x; bx <= x + w; bx += 24) ctx.lineTo(bx, by + Math.sin(bx / 70 + band * 2) * 5);
    ctx.lineTo(x + w, by + 16);
    for (let bx = x + w; bx >= x; bx -= 24) ctx.lineTo(bx, by + 16 + Math.sin(bx / 55 + band) * 4);
    ctx.closePath();
    ctx.fill();
  }
  // Stones in the soil, lit from above.
  for (let i = 0; i < w / 26; i++) {
    const sx = x + hash(x, i, 1) * w;
    const sy = y + 24 + hash(i, x, 2) * Math.min(h + 60, 150);
    const sr = 2 + hash(i, 3) * 5;
    ctx.beginPath();
    ctx.ellipse(sx, sy, sr * 1.4, sr, 0, 0, TAU);
    ctx.fillStyle = shade(th.dirt, -0.25 + hash(i, 4) * 0.3);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    ctx.beginPath();
    ctx.ellipse(sx - sr * 0.3, sy - sr * 0.4, sr * 0.7, sr * 0.35, 0, 0, TAU);
    ctx.fill();
  }
  // Shadow under the lip.
  const lip = ctx.createLinearGradient(0, y + 6, 0, y + 34);
  lip.addColorStop(0, "rgba(0, 0, 0, 0.35)");
  lip.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = lip;
  ctx.fillRect(x, y + 6, w, 28);
  if (th.grass) {
    const tg = ctx.createLinearGradient(0, y - 2, 0, y + 9);
    tg.addColorStop(0, shade(th.ground, 0.25));
    tg.addColorStop(1, shade(th.ground, -0.15));
    ctx.fillStyle = tg;
    ctx.fillRect(x, y - 1, w, 10);
    // Blades in three shades, some taller.
    for (const [tone, step, tall] of [[-0.1, 7, 6], [0.15, 9, 9], [0.35, 13, 5]]) {
      ctx.strokeStyle = shade(th.ground, tone);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let gx = x + (step % 5); gx < x + w; gx += step) {
        const ht = 3 + hash(gx, step) * tall;
        const lean = (hash(step, gx) - 0.4) * 4;
        ctx.moveTo(gx, y + 3);
        ctx.quadraticCurveTo(gx + lean * 0.3, y - ht * 0.5, gx + lean, y - ht);
      }
      ctx.stroke();
    }
    // The odd corn-yellow flower.
    ctx.fillStyle = "#ffd84a";
    for (let i = 0; i < w / 120; i++) (ctx.beginPath(), ctx.arc(x + hash(i, x, 9) * w, y - 5 - hash(i, 6) * 5, 1.8, 0, TAU), ctx.fill());
  } else {
    // Concrete: a slab edge with a lit top, expansion joints and stains.
    const cg = ctx.createLinearGradient(0, y, 0, y + 12);
    cg.addColorStop(0, shade(th.ground, 0.2));
    cg.addColorStop(1, shade(th.ground, -0.2));
    ctx.fillStyle = cg;
    ctx.fillRect(x, y, w, 12);
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(x, y, w, 1.5);
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    for (let jx = x + 120; jx < x + w; jx += 120) ctx.fillRect(jx, y, 2, 12);
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    for (let i = 0; i < w / 160; i++) (ctx.beginPath(), ctx.ellipse(x + hash(i, x, 5) * w, y + 5, 12 + hash(i, 2) * 20, 3, 0, 0, TAU), ctx.fill());
  }
  // Cliff edges where the ground stops (a gap, a moat).
  for (const [ex, dir] of [[x, 1], [x + w, -1]]) {
    if (ex <= -300 || ex >= level.width + 300) continue;
    const eg = ctx.createLinearGradient(ex, 0, ex + dir * 14, 0);
    eg.addColorStop(0, "rgba(0, 0, 0, 0.4)");
    eg.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = eg;
    ctx.fillRect(Math.min(ex, ex + dir * 14), y, 14, h + 400);
  }
}

function paintProps(ctx, level, th) {
  const G = level.groundY;
  ctx.save();
  ctx.fillStyle = th.mid;
  ctx.strokeStyle = th.mid;
  switch (level.theme) {
    case "site":
      // Tower cranes and a half-built frame.
      for (const cx of [300, 1350, 2150]) {
        ctx.fillRect(cx, G - 520, 14, 520);
        ctx.fillRect(cx - 160, G - 520, 380, 12);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx + 180, G - 508);
        ctx.lineTo(cx + 180, G - 380);
        ctx.stroke();
        ctx.fillStyle = "#e7b416";
        ctx.fillRect(cx - 4, G - 540, 22, 20);
        ctx.fillStyle = th.mid;
      }
      ctx.lineWidth = 6;
      for (let i = 0; i < 4; i++) ctx.strokeRect(820 + i * 70, G - 260 + i * 0, 70, 260);
      ctx.fillStyle = "#ffd400";
      ctx.fillRect(40, G - 170, 150, 70);
      ctx.fillStyle = "#15161a";
      ctx.font = "900 26px system-ui, sans-serif";
      ctx.fillText("CPI", 85, G - 125);
      break;
    case "facility":
      ctx.fillRect(900, G - 330, 900, 330);
      ctx.fillStyle = "#ffcf40";
      for (let i = 0; i < 10; i++) ctx.fillRect(930 + i * 88, G - 290, 40, 26);
      ctx.fillStyle = th.mid;
      for (let x = 0; x < level.width; x += 36) ctx.fillRect(x, G - 90, 3, 90);
      ctx.fillRect(0, G - 90, level.width, 3);
      ctx.fillStyle = "rgba(255, 250, 200, 0.07)";
      ctx.beginPath();
      ctx.moveTo(700, G - 400);
      ctx.lineTo(1300, -100);
      ctx.lineTo(1500, -100);
      ctx.closePath();
      ctx.fill();
      break;
    case "refinery":
      for (const [tx, tw, trh] of [[150, 160, 260], [880, 200, 300], [2120, 180, 280]]) {
        ctx.fillRect(tx, G - trh, tw, trh);
        ctx.beginPath();
        ctx.ellipse(tx + tw / 2, G - trh, tw / 2, 20, 0, 0, TAU);
        ctx.fill();
      }
      for (const sx of [600, 1150, 1950]) {
        ctx.fillRect(sx, G - 560, 34, 560);
        ctx.fillStyle = "rgba(70, 50, 60, 0.35)";
        for (let i = 0; i < 5; i++) (ctx.beginPath(), ctx.arc(sx + 17 + i * 26, G - 590 - i * 40, 26 + i * 8, 0, TAU), ctx.fill());
        ctx.fillStyle = th.mid;
      }
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(0, G - 200);
      ctx.lineTo(level.width, G - 240);
      ctx.stroke();
      break;
    case "station":
      ctx.beginPath();
      ctx.arc(420, G - 150, 110, Math.PI, TAU);
      ctx.fill();
      ctx.fillRect(1000, G - 420, 16, 420);
      for (const a of [0, 2.1, 4.2]) {
        ctx.beginPath();
        ctx.moveTo(1008, G - 420);
        ctx.lineTo(1008 + Math.cos(a) * 50, G - 420 + Math.sin(a) * 50);
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      break;
    case "thudplex":
      ctx.fillRect(1200, G - 420, 980, 420);
      for (let x = 1200; x < 2180; x += 60) ctx.fillRect(x, G - 460, 36, 40);
      for (const bx of [1350, 1650, 1950]) {
        ctx.fillStyle = "#e0a800";
        ctx.fillRect(bx, G - 400, 60, 110);
        ctx.fillStyle = "#6fb33a";
        ctx.beginPath();
        ctx.arc(bx + 30, G - 350, 20, 0, TAU);
        ctx.fill();
        ctx.fillStyle = th.mid;
      }
      break;
    default:
      break;
  }
  ctx.restore();
}
