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
  const body = ctx.createRadialGradient(-0.35, -0.45, 0.1, 0, 0, 1.1);
  body.addColorStop(0, shade(look.body, 0.3));
  body.addColorStop(1, shade(look.body, -0.12));
  fs(ctx, body, INK, 0.07);
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
    fs(ctx, glow ? "#ffd6ff" : "#ffffff", INK, 0.05);
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
      ctx.arc(ex + 0.07, eyeY + 0.03, 0.08, 0, TAU);
      ctx.fillStyle = glow ? "#e01cff" : INK;
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
  ctx.strokeStyle = INK;
  ctx.lineWidth = kind === "boss" ? 0.14 : 0.09;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.62, -0.58);
  ctx.lineTo(-0.2, -0.5);
  ctx.moveTo(-0.08, -0.52);
  ctx.lineTo(0.3, -0.6);
  ctx.stroke();
  // The long goofy nose.
  ctx.save();
  ctx.translate(-0.62, 0.12);
  ctx.rotate(-0.12 + Math.sin(t * 1.7) * 0.04);
  ctx.beginPath();
  ctx.ellipse(-0.15, 0, 0.5, 0.24, 0, 0, TAU);
  fs(ctx, look.nose, INK, 0.05);
  ctx.fillStyle = shade(look.nose, -0.45);
  for (const n of [-0.42, -0.22]) (ctx.beginPath(), ctx.ellipse(n, 0.02, 0.05, 0.09, 0, 0, TAU), ctx.fill());
  ctx.restore();
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

/** A block of a material, in its own frame (centre 0,0; half sizes hw, hh). */
export function drawBlock(ctx, m, hw, hh, { crack = 0, reinforced = false, t = 0, seed = 0 } = {}) {
  const w = hw * 2;
  const h = hh * 2;
  const x = -hw;
  const y = -hh;
  switch (m) {
    case "wood": {
      rr(ctx, x, y, w, h, 2);
      const g = ctx.createLinearGradient(x, y, x + (w > h ? 0 : w), y + (w > h ? h : 0));
      g.addColorStop(0, "#c98f4d");
      g.addColorStop(1, "#9c6630");
      fs(ctx, g, "#5a3616", 1.2);
      ctx.strokeStyle = "rgba(90, 54, 22, 0.55)";
      ctx.lineWidth = 1;
      const long = w > h;
      const n = Math.max(1, Math.floor((long ? h : w) / 9));
      for (let i = 1; i < n; i++) {
        ctx.beginPath();
        if (long) {
          ctx.moveTo(x + 2, y + (h / n) * i);
          ctx.lineTo(x + w - 2, y + (h / n) * i);
        } else {
          ctx.moveTo(x + (w / n) * i, y + 2);
          ctx.lineTo(x + (w / n) * i, y + h - 2);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255, 220, 170, 0.18)";
      for (let i = 0; i < 3; i++) {
        const k = hash(seed, i);
        ctx.beginPath();
        if (long) ctx.ellipse(x + w * (0.2 + k * 0.6), y + h / 2, w * 0.08, h * 0.25, 0, 0, TAU);
        else ctx.ellipse(x + w / 2, y + h * (0.2 + k * 0.6), w * 0.25, h * 0.08, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = "#3a2410";
      for (const [nx, ny] of [[x + 3, y + 3], [x + w - 3, y + 3], [x + 3, y + h - 3], [x + w - 3, y + h - 3]]) ctx.fillRect(nx - 0.8, ny - 0.8, 1.6, 1.6);
      break;
    }
    case "glass": {
      rr(ctx, x, y, w, h, 1.5);
      fs(ctx, "rgba(168, 220, 255, 0.38)", "rgba(220, 245, 255, 0.95)", 1.4);
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.2, y + h * 0.15);
      ctx.lineTo(x + w * 0.45, y + h * 0.15 + Math.min(w, h) * 0.25);
      ctx.moveTo(x + w * 0.55, y + h * 0.2);
      ctx.lineTo(x + w * 0.65, y + h * 0.2 + Math.min(w, h) * 0.12);
      ctx.stroke();
      break;
    }
    case "stone": {
      rr(ctx, x, y, w, h, 2);
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, "#a2a7af");
      g.addColorStop(1, "#6f747c");
      fs(ctx, g, "#3e4148", 1.3);
      ctx.strokeStyle = "rgba(40, 42, 48, 0.45)";
      ctx.lineWidth = 1;
      const rows = Math.max(1, Math.round(h / 16));
      for (let i = 1; i < rows; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 1, y + (h / rows) * i);
        ctx.lineTo(x + w - 1, y + (h / rows) * i);
        ctx.stroke();
      }
      for (let i = 0; i < rows; i++) {
        const cols = Math.max(1, Math.round(w / 22));
        for (let j = 1; j < cols; j++) {
          const bx = x + (w / cols) * j + (i % 2 ? w / cols / 2 : 0);
          if (bx >= x + w - 2) continue;
          ctx.beginPath();
          ctx.moveTo(bx, y + (h / rows) * i);
          ctx.lineTo(bx, y + (h / rows) * (i + 1));
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      for (let i = 0; i < 5; i++) ctx.fillRect(x + hash(seed, i) * w, y + hash(seed, i, 2) * h, 1.5, 1.5);
      break;
    }
    case "metal": {
      rr(ctx, x, y, w, h, 2);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, "#c4cbd4");
      g.addColorStop(0.5, "#98a2ae");
      g.addColorStop(1, "#77808c");
      fs(ctx, g, "#3c424b", 1.4);
      ctx.fillStyle = "#4d545e";
      for (const [nx, ny] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) (ctx.beginPath(), ctx.arc(nx, ny, 1.6, 0, TAU), ctx.fill());
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(x + 3, y + h * 0.3);
      ctx.lineTo(x + w - 3, y + h * 0.3);
      ctx.stroke();
      break;
    }
    case "ice": {
      rr(ctx, x, y, w, h, 3);
      fs(ctx, "rgba(191, 240, 255, 0.6)", "rgba(240, 255, 255, 0.95)", 1.3);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.15, y + h * 0.8);
      ctx.lineTo(x + w * 0.4, y + h * 0.3);
      ctx.lineTo(x + w * 0.7, y + h * 0.6);
      ctx.stroke();
      break;
    }
    case "corn": {
      rr(ctx, x, y, w, h, 4);
      fs(ctx, "#e5c35a", "#8a6a1e", 1.2);
      ctx.strokeStyle = "rgba(138, 106, 30, 0.5)";
      for (let i = 0; i < w; i += 5) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + 2);
        ctx.lineTo(x + i + 3, y + h - 2);
        ctx.stroke();
      }
      ctx.fillStyle = "#7a4a1a";
      ctx.fillRect(x, y + h * 0.3, w, 2);
      ctx.fillRect(x, y + h * 0.7, w, 2);
      break;
    }
    case "barrel": {
      rr(ctx, x, y, w, h, 5);
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, "#8e2418");
      g.addColorStop(0.45, "#e0513a");
      g.addColorStop(1, "#8e2418");
      fs(ctx, g, "#3a0f08", 1.4);
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(x, y + h * 0.18, w, 2.5);
      ctx.fillRect(x, y + h * 0.78, w, 2.5);
      ctx.fillStyle = "#ffd400";
      ctx.beginPath();
      ctx.moveTo(0, y + h * 0.33);
      ctx.lineTo(w * 0.22, y + h * 0.65);
      ctx.lineTo(-w * 0.22, y + h * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = `bold ${Math.max(6, h * 0.2)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("!", 0, y + h * 0.62);
      break;
    }
    case "vault": {
      rr(ctx, x, y, w, h, 3);
      fs(ctx, "#6d7784", "#2c3139", 1.5);
      rr(ctx, x + 4, y + 4, w - 8, h - 8, 2);
      fs(ctx, "#8994a2", null);
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(w, h) * 0.24, 0, TAU);
      fs(ctx, "#ffd23f", "#8a6a00", 1.2);
      ctx.fillStyle = "#8a6a00";
      ctx.font = `900 ${Math.min(w, h) * 0.3}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("K", 0, 1);
      ctx.textBaseline = "alphabetic";
      break;
    }
    case "totem": {
      rr(ctx, x, y, w, h, 4);
      fs(ctx, "#6b3fb8", "#2a1450", 1.5);
      ctx.fillStyle = `rgba(255, 60, 220, ${0.6 + Math.sin(t * 4) * 0.3})`;
      ctx.beginPath();
      ctx.arc(-w * 0.18, y + h * 0.35, 2.5, 0, TAU);
      ctx.arc(w * 0.18, y + h * 0.35, 2.5, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, y + h * 0.6, w * 0.25, h * 0.1, 0, 0, TAU);
      fs(ctx, "#8c63d6", "#2a1450", 1);
      break;
    }
    default: {
      rr(ctx, x, y, w, h, 2);
      fs(ctx, MATERIAL_COLORS[m] ?? "#888", INK, 1.2);
    }
  }
  if (reinforced) {
    ctx.fillStyle = "#5b6470";
    const long = w > h;
    for (const k of [0.25, 0.75]) {
      if (long) ctx.fillRect(x + w * k - 2, y, 4, h);
      else ctx.fillRect(x, y + h * k - 2, w, 4);
    }
  }
  if (crack > 0) {
    ctx.strokeStyle = m === "glass" || m === "ice" ? "rgba(255,255,255,0.9)" : "rgba(20, 14, 10, 0.75)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < crack * 2; i++) {
      const sx = x + hash(seed, i, 7) * w;
      const sy = y + hash(seed, i, 9) * h;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (hash(seed, i, 11) - 0.5) * w * 0.5, sy + (hash(seed, i, 13) - 0.5) * h * 0.5);
      ctx.lineTo(sx + (hash(seed, i, 17) - 0.5) * w * 0.4, sy + (hash(seed, i, 19) - 0.2) * h * 0.4);
    }
    ctx.stroke();
  }
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
        fs(ctx, "#fff6dc", "#6b5a3a", 1);
        ctx.fillStyle = "#e8b04a";
        ctx.fillRect(-2, -3, 2, 2);
        ctx.restore();
      }
      break;
    }
    case "wall": {
      rr(ctx, x, y, w, h, 3);
      fs(ctx, "#8aa33a", "#3c4a14", 1.4);
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
      fs(ctx, "#8a8f98", "#3e4148", 1.4);
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

export function drawSling(ctx, x, y, { pouch = null, back = true } = {}) {
  const forkTop = y - 18;
  const left = [x - 20, forkTop - 16];
  const right = [x + 20, forkTop - 16];
  if (back && pouch) {
    ctx.strokeStyle = "#5a2d12";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(...right);
    ctx.lineTo(pouch[0], pouch[1]);
    ctx.stroke();
  }
  if (!back) {
    ctx.strokeStyle = "#6b3d1c";
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y + 44);
    ctx.lineTo(x, forkTop);
    ctx.moveTo(x, forkTop + 4);
    ctx.lineTo(...left);
    ctx.moveTo(x, forkTop + 4);
    ctx.lineTo(...right);
    ctx.stroke();
    ctx.strokeStyle = "#9a6232";
    ctx.lineWidth = 3;
    ctx.stroke();
    if (pouch) {
      ctx.strokeStyle = "#5a2d12";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(...left);
      ctx.lineTo(pouch[0], pouch[1]);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#5a2d12";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(...left);
      ctx.quadraticCurveTo(x, forkTop - 6, ...right);
      ctx.stroke();
    }
  }
}

// ------------------------------------------------------------------ scenery

const THEMES = {
  site: { sky: ["#7ec8f2", "#cfe9f7", "#fde7b6"], far: "#9fb7c9", mid: "#6f8aa0", ground: "#6d8f3a", dirt: "#8a5a2b", sun: "#fff3b0" },
  facility: { sky: ["#0b1630", "#1d3456", "#35557c"], far: "#1a2a44", mid: "#26374f", ground: "#565b62", dirt: "#3d4147", moon: true },
  refinery: { sky: ["#3c1b3a", "#b24a3c", "#f5a45b"], far: "#5a2c3a", mid: "#40202c", ground: "#4a3a2e", dirt: "#2e241c", sun: "#ffd28a" },
  station: { sky: ["#3e5270", "#6f86a6", "#b8c7d9"], far: "#56657c", mid: "#46536a", ground: "#6b7066", dirt: "#4b4f47", clouds: true },
  thudplex: { sky: ["#2a0a0e", "#7a1d18", "#d4583a"], far: "#4a1616", mid: "#3a1010", ground: "#4f3b2a", dirt: "#33251a", sun: "#ffb070" },
};

export function themeOf(id) {
  return THEMES[id] ?? THEMES.site;
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
    const sg = ctx.createRadialGradient(1500, 120, 10, 1500, 120, 220);
    sg.addColorStop(0, th.sun);
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(1200, -150, 600, 560);
  }
  if (th.moon) {
    ctx.fillStyle = "#e8eef8";
    ctx.beginPath();
    ctx.arc(1700, 90, 46, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 70; i++) ctx.fillRect(hash(i, 1) * W, top + hash(i, 2) * (G * 0.55 - top), 2, 2);
  }
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
  for (const [x, y, w, h] of level.terrain) {
    const g = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 160));
    g.addColorStop(0, th.ground);
    g.addColorStop(0.12, th.dirt);
    g.addColorStop(1, shade(th.dirt, -0.35));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h + 400);
    ctx.fillStyle = shade(th.ground, 0.15);
    ctx.fillRect(x, y, w, 5);
    if (level.theme === "site" || level.theme === "station") {
      ctx.strokeStyle = shade(th.ground, 0.25);
      ctx.lineWidth = 2;
      for (let gx = x; gx < x + w; gx += 11) {
        ctx.beginPath();
        ctx.moveTo(gx, y + 2);
        ctx.lineTo(gx + 3, y - 5 - hash(gx, 7) * 5);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < w / 18; i++) ctx.fillRect(x + hash(x, i) * w, y + 14 + hash(i, x) * Math.min(h, 90), 4, 3);
  }
  // Moat water in the Thudplex's gap.
  if (level.theme === "thudplex") {
    const gapL = level.terrain[0][0] + level.terrain[0][2];
    const gapR = level.terrain[1][0];
    const wg = ctx.createLinearGradient(0, G + 20, 0, G + 200);
    wg.addColorStop(0, "#2e5e7a");
    wg.addColorStop(1, "#0c1c26");
    ctx.fillStyle = wg;
    ctx.fillRect(gapL, G + 30, gapR - gapL, 400);
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
