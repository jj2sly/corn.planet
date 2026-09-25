// Escape Thad's Steam Deck: how the levels *look*. Everything here is cosmetic and client-only:
// the server's collision rects (levels.ts) decide where you can stand; this file only dresses them
// and adds scenery behind them. Nothing in here is ever sent back or used for physics.
//
// Layers, back to front (steamdeck-world.js calls them):
//   paintBackdrop  the wall, far shapes, props and cables               (static: cached)
//   paintSolids    platforms dressed from the collision rects, decals  (static: cached)
//   paintLive      the few moving scenery bits (screens, lamps, gauges) (every frame, cheap)
//   paintHazard / paintExit / paintPlank                                (every frame)
//
// World units: 1600 × 900, y down (the same as the server).

export const MARGIN = 90;

const W = 1600;
const H = 900;
const EDGE = "#ffd400"; // every walkable top edge, in every level: "you can stand here"

// ------------------------------------------------------------------ themes

/** Per-level palette and props. Props are data: [type, ...args]; painters are below. */
export const THEMES = {
  // Each level is a game running on Thad's Deck: original pastiches, not anyone's actual art.
  home: {
    name: "Blockcraft",
    skin: "grass",
    wall: ["#5d9ce6", "#b8dcf7"],
    far: "rgba(40, 90, 50, 0.35)",
    block: ["#8a5a32", "#5a3a1f"],
    top: "#5aa83a",
    seam: "rgba(0, 0, 0, 0.18)",
    rim: "rgba(255, 255, 255, 0.15)",
    slab: ["#8d8d8d", "#5e5e5e"],
    pit: ["#ff7a1a", "#3a0c02"],
    light: "rgba(255, 250, 220, 0.10)",
    props: [
      ["pixelSun", 1320, 70, 90],
      ["blockClouds", 0, 40],
      ["voxelHills", 0, 520, "#3f7f3a", 0.55, 11],
      ["voxelHills", 0, 610, "#356e31", 0.8, 23],
      ["blockTree", 150, 470],
      ["blockTree", 1080, 400],
      ["blockTree", 520, 520],
      ["cartridge", 40, 40, "NOW PLAYING: BLOCKCRAFT"],
    ],
    decals: [["sign", 1290, 560, 250, 44, "PROPERTY OF THAD", "plain"]],
    live: [["drift", 0, 40]],
  },
  library: {
    name: "Fire Kid & Ice Girl",
    skin: "temple",
    wall: ["#2e3320", "#15170e"],
    far: "rgba(0, 0, 0, 0.25)",
    block: ["#7d7a4a", "#4a4828"],
    top: "#9c9860",
    seam: "rgba(0, 0, 0, 0.35)",
    rim: "rgba(255, 240, 180, 0.2)",
    slab: ["#8a8656", "#56532f"],
    pit: ["#ff5a1a", "#2a0a02"],
    light: "rgba(255, 190, 110, 0.12)",
    props: [
      ["templeBricks", 0, 0, 1600, 900],
      ["vines", [120, 430, 980, 1330]],
      ["templeDoor", 1140, 290, "#e0452a", "♨"],
      ["templeDoor", 1250, 290, "#2a8ae0", "≈"],
      ["cartridge", 40, 40, "NOW PLAYING: FIRE KID & ICE GIRL"],
    ],
    decals: [["sign", 780, 790, 220, 44, "FIRE KIDS ONLY", "warn"]],
    live: [
      ["torch", 300, 250],
      ["torch", 900, 200],
      ["torch", 1480, 250],
      ["gem", 520, 440, "#ff4d3a"],
      ["gem", 660, 360, "#3ab0ff"],
      ["gem", 1210, 470, "#ff4d3a"],
    ],
  },
  proton: {
    name: "Astro Blaster '84",
    skin: "neon",
    wall: ["#05061a", "#120828"],
    far: "rgba(255, 255, 255, 0.5)",
    block: ["#1a1440", "#0c0822"],
    top: "#2a1f66",
    seam: "rgba(255, 60, 220, 0.25)",
    rim: "rgba(60, 230, 255, 0.5)",
    slab: ["#231a55", "#110c2c"],
    pit: ["#ff3cdc", "#1a0220"],
    light: "rgba(120, 80, 255, 0.10)",
    props: [
      ["stars", 0, 0, 1600, 900],
      ["pixelPlanet", 1270, 250, 110],
      ["neonGrid", 0, 700, 1600, 200],
      ["cartridge", 40, 40, "NOW PLAYING: ASTRO BLASTER '84"],
      ["arcadeScore", 1180, 36],
    ],
    decals: [["sign", 20, 848, 240, 34, "INSERT COIN", "plain"]],
    live: [
      ["invaders", 380, 90, 8],
      ["twinkle", 0, 0, 1600, 650],
    ],
  },
};

export function themeFor(levelId) {
  return THEMES[levelId] ?? THEMES.home;
}

// ------------------------------------------------------------------ helpers

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

const vgrad = (ctx, y0, y1, a, b) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
};

/** Diagonal caution stripes clipped to a rect. */
function stripes(ctx, x, y, w, h, a = "#ffd400", b = "#111", step = 14) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = b;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = a;
  for (let i = -h; i < w + h; i += step * 2) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + step, y + h);
    ctx.lineTo(x + i + step + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const MONO = '"Roboto Mono", ui-monospace, monospace';
const HEAD = '"Oswald", Arial, sans-serif';

function text(ctx, value, x, y, { size = 20, font = HEAD, color = "#fff", align = "left", weight = 700, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
  ctx.restore();
}

/** A tiny deterministic noise so props look hand-made but identical on every screen. */
const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

const isBlock = (r) => r[3] >= 60;
const isPit = (r) => r[1] + r[3] >= H - 1;

// ------------------------------------------------------------------ backdrop props

const PROPS = {
  tabs(ctx, t, [x, y, labels]) {
    let cx = x;
    labels.forEach((label, i) => {
      text(ctx, label, cx, y, { size: 22, color: i === 0 ? "#dff6ff" : "#6f86a3", font: HEAD, weight: 600 });
      ctx.font = `600 22px ${HEAD}`;
      const w = ctx.measureText(label).width;
      if (i === 0) {
        ctx.fillStyle = "#4dd4ff";
        ctx.fillRect(cx, y + 16, w, 3);
      }
      cx += w + 42;
    });
  },
  heading(ctx, t, [x, y, label]) {
    text(ctx, label, x, y, { size: 20, font: MONO, color: "#8fb3d9", weight: 700 });
  },
  tiles(ctx, t, [x, y, w, h, gap, titles]) {
    titles.forEach((title, i) => {
      const tx = x + i * (w + gap);
      const hue = [200, 40, 330, 150, 270][i % 5];
      rr(ctx, tx, y, w, h, 10);
      ctx.fillStyle = vgrad(ctx, y, y + h, `hsla(${hue}, 45%, 32%, 0.9)`, `hsla(${hue + 30}, 50%, 14%, 0.9)`);
      ctx.fill();
      // "Cover art": a few bold shapes, different per game.
      ctx.save();
      rr(ctx, tx, y, w, h, 10);
      ctx.clip();
      ctx.fillStyle = `hsla(${hue + 60}, 60%, 60%, 0.35)`;
      ctx.beginPath();
      ctx.arc(tx + w * (0.3 + hash(i) * 0.4), y + h * 0.55, h * (0.28 + hash(i + 9) * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 212, 0, 0.35)";
      ctx.fillRect(tx, y + h * 0.72, w, h * 0.06);
      ctx.restore();
      text(ctx, title, tx + 12, y + h - 20, { size: 19, color: "rgba(255,255,255,0.8)" });
      rr(ctx, tx, y, w, h, 10);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  },
  widget(ctx, t, [x, y, w, h, label, value, kind]) {
    rr(ctx, x, y, w, h, 12);
    ctx.fillStyle = "rgba(10, 18, 30, 0.75)";
    ctx.fill();
    ctx.strokeStyle = kind === "danger" ? "rgba(255, 77, 77, 0.45)" : "rgba(120, 200, 255, 0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();
    text(ctx, label, x + 18, y + 26, { size: 16, font: MONO, color: "#7f97b5" });
    text(ctx, value, x + 18, y + 72, { size: 46, color: kind === "danger" ? "#ff6b5e" : "#dff6ff" });
    if (kind === "danger") {
      // A battery icon, nearly empty.
      rr(ctx, x + w - 94, y + 52, 64, 36, 5);
      ctx.strokeStyle = "#ff6b5e";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#ff6b5e";
      ctx.fillRect(x + w - 30, y + 62, 6, 16);
      ctx.fillRect(x + w - 89, y + 57, 7, 26);
    }
  },
  circuit(ctx, t, [x, y, w, h], theme) {
    // Faint traces across the lower half, like the board behind the screen.
    ctx.save();
    ctx.strokeStyle = theme.far;
    ctx.fillStyle = theme.far;
    ctx.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      const sy = y + hash(i + 1) * h;
      const sx = x + hash(i + 40) * w * 0.4;
      const len = 200 + hash(i + 80) * 500;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + len * 0.6, sy);
      ctx.lineTo(sx + len * 0.6 + 40, sy + (hash(i) > 0.5 ? 40 : -40));
      ctx.lineTo(sx + len, sy + (hash(i) > 0.5 ? 40 : -40));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx + len, sy + (hash(i) > 0.5 ? 40 : -40), 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
  lamp(ctx, t, [x, y, reach], theme) {
    // A hanging lamp and its cone of light: lighting, not collision.
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 60);
    ctx.stroke();
    const g = ctx.createRadialGradient(x, y + 70, 10, x, y + 70 + reach * 0.6, reach);
    g.addColorStop(0, theme.light.replace(/[\d.]+\)$/, "0.22)"));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 18, y + 70);
    ctx.lineTo(x + 18, y + 70);
    ctx.lineTo(x + reach * 0.55, y + 70 + reach * 1.6);
    ctx.lineTo(x - reach * 0.55, y + 70 + reach * 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(x - 22, y + 74);
    ctx.lineTo(x - 10, y + 58);
    ctx.lineTo(x + 10, y + 58);
    ctx.lineTo(x + 22, y + 74);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff1c2";
    ctx.beginPath();
    ctx.ellipse(x, y + 75, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  // ---- game pastiches
  pixelSun(ctx, t, [x, y, r]) {
    ctx.fillStyle = "#fff6b0";
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
    ctx.fillStyle = "rgba(255, 246, 176, 0.25)";
    ctx.fillRect(x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4);
  },
  blockClouds(ctx, t, [x, y]) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    for (let i = 0; i < 6; i++) {
      const cx = x + 80 + i * 260 + hash(i) * 60;
      const cy = y + hash(i + 3) * 90;
      const w = 120 + hash(i + 7) * 80;
      ctx.fillRect(cx, cy, w, 24);
      ctx.fillRect(cx + 24, cy - 16, w - 60, 16);
    }
  },
  voxelHills(ctx, t, [x, y, color, alpha, seed]) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const cell = 40;
    for (let cx = x - 40; cx < W + 80; cx += cell) {
      const h = Math.round((Math.sin((cx + seed * 97) / 210) * 0.5 + 0.5 + hash(cx / cell + seed) * 0.4) * 5) * cell;
      ctx.fillRect(cx, y - h, cell, h + 400);
    }
    ctx.restore();
  },
  blockTree(ctx, t, [x, y]) {
    ctx.fillStyle = "#6b4a2a";
    ctx.fillRect(x, y - 120, 30, 120);
    ctx.fillStyle = "#2f7a2a";
    ctx.fillRect(x - 45, y - 200, 120, 90);
    ctx.fillRect(x - 15, y - 240, 60, 40);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < 8; i++) ctx.fillRect(x - 45 + hash(i + x) * 100, y - 200 + hash(i * 3 + x) * 70, 20, 20);
  },
  templeBricks(ctx, t, [x, y, w, h]) {
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let row = 0, by = y; by < y + h; row++, by += 50) {
      ctx.moveTo(x, by);
      ctx.lineTo(x + w, by);
      for (let bx = x + (row % 2 ? 50 : 0); bx < x + w; bx += 100) {
        ctx.moveTo(bx, by);
        ctx.lineTo(bx, by + 50);
      }
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 240, 180, 0.03)";
    for (let i = 0; i < 40; i++) ctx.fillRect(hash(i) * w, hash(i + 50) * h, 100, 50);
  },
  vines(ctx, t, [xs]) {
    ctx.strokeStyle = "rgba(90, 140, 50, 0.7)";
    ctx.lineWidth = 5;
    for (const vx of xs) {
      ctx.beginPath();
      ctx.moveTo(vx, 0);
      for (let vy = 0; vy < 260 + hash(vx) * 200; vy += 30) ctx.lineTo(vx + Math.sin(vy / 40) * 10, vy);
      ctx.stroke();
    }
  },
  templeDoor(ctx, t, [x, y, color, glyph]) {
    rr(ctx, x, y, 80, 120, 40);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
    text(ctx, glyph, x + 40, y + 60, { size: 40, align: "center", color });
  },
  stars(ctx, t, [x, y, w, h]) {
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.2 + hash(i + 9) * 0.6})`;
      const size = hash(i + 4) > 0.9 ? 4 : 2;
      ctx.fillRect(x + hash(i) * w, y + hash(i + 100) * h, size, size);
    }
  },
  pixelPlanet(ctx, t, [x, y, r]) {
    const px = 12;
    for (let gy = -r; gy < r; gy += px) {
      for (let gx = -r; gx < r; gx += px) {
        if (gx * gx + gy * gy > r * r) continue;
        const band = Math.floor((gy + r) / (r / 3)) % 2;
        ctx.fillStyle = band ? "#d0508a" : "#8a3ab0";
        ctx.fillRect(x + gx, y + gy, px, px);
      }
    }
    ctx.strokeStyle = "rgba(255, 200, 120, 0.6)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.6, r * 0.35, -0.3, 0, Math.PI * 2);
    ctx.stroke();
  },
  neonGrid(ctx, t, [x, y, w, h]) {
    ctx.strokeStyle = "rgba(255, 60, 220, 0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const gy = y + (i * i * h) / 49;
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
    }
    for (let gx = -800; gx <= 800; gx += 100) {
      ctx.moveTo(W / 2 + gx * 0.3, y);
      ctx.lineTo(W / 2 + gx * 1.6, y + h);
    }
    ctx.stroke();
  },
  arcadeScore(ctx, t, [x, y]) {
    text(ctx, "HI-SCORE 999990", x, y, { size: 22, font: MONO, color: "#ff3cdc" });
  },
  cartridge(ctx, t, [x, y, label]) {
    ctx.font = `700 18px ${MONO}`;
    const w = ctx.measureText(label).width + 30;
    rr(ctx, x, y - 16, w, 32, 6);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fill();
    text(ctx, label, x + 15, y, { size: 18, font: MONO, color: "#ffd400" });
  },
  sign(ctx, t, [x, y, w, h, label, kind]) {
    rr(ctx, x, y, w, h, 4);
    if (kind === "warn") {
      ctx.save();
      ctx.clip();
      stripes(ctx, x, y, w, h, "#d8b400", "#1a1a1a", 12);
      ctx.restore();
      rr(ctx, x + 8, y + 7, w - 16, h - 14, 3);
      ctx.fillStyle = "#e9e3d0";
      ctx.fill();
      text(ctx, label, x + w / 2, y + h / 2 + 1, { size: Math.min(20, h * 0.45), align: "center", color: "#1a1a1a" });
    } else {
      ctx.fillStyle = "rgba(233, 227, 208, 0.12)";
      ctx.fill();
      ctx.strokeStyle = "rgba(233, 227, 208, 0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
      text(ctx, label, x + w / 2, y + h / 2 + 1, { size: Math.min(19, h * 0.45), align: "center", color: "rgba(233, 227, 208, 0.75)", font: MONO });
    }
    // Screws.
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (const [sx, sy] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) {
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  shelves(ctx, t, [x, y, w, h], theme) {
    // A tower of cartridges, spines out, in no order whatsoever.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#1a1116";
    ctx.fillRect(x, y, w, h);
    const rows = Math.floor(h / 90);
    for (let r = 0; r < rows; r++) {
      const ry = y + r * 90;
      let cx = x + 8;
      let n = 0;
      while (cx < x + w - 14) {
        const sw = 10 + hash(r * 31 + n) * 14;
        const sh = 50 + hash(r * 17 + n * 3) * 26;
        const hue = Math.floor(hash(n * 7 + r) * 360);
        ctx.fillStyle = `hsl(${hue}, 32%, ${22 + hash(n + r) * 14}%)`;
        ctx.fillRect(cx, ry + 84 - sh, sw - 2, sh);
        cx += sw;
        n += 1;
      }
      ctx.fillStyle = "#2a1c17";
      ctx.fillRect(x, ry + 84, w, 6);
    }
    ctx.restore();
    ctx.fillStyle = theme.far;
    ctx.fillRect(x, y, w, h);
  },
  hanging(ctx, t, [x, y, drop, label]) {
    ctx.font = `700 26px ${HEAD}`;
    const w = ctx.measureText(label).width + 40;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 14, y);
    ctx.lineTo(x + 14, y + drop);
    ctx.moveTo(x + w - 14, y);
    ctx.lineTo(x + w - 14, y + drop);
    ctx.stroke();
    rr(ctx, x, y + drop, w, 44, 4);
    ctx.fillStyle = "#e9e3d0";
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 3;
    ctx.stroke();
    text(ctx, label, x + w / 2, y + drop + 23, { size: 26, align: "center", color: "#231a14" });
  },
  gauge(ctx, t, [x, y, size, label]) {
    rr(ctx, x, y, size, size * 0.85, 12);
    ctx.fillStyle = "rgba(16, 10, 12, 0.85)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 196, 120, 0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
    const cx = x + size / 2;
    const cy = y + size * 0.62;
    const r = size * 0.36;
    ctx.lineWidth = 10;
    for (const [a0, a1, c] of [[Math.PI, Math.PI * 1.45, "#5fa35f"], [Math.PI * 1.45, Math.PI * 1.75, "#d8b400"], [Math.PI * 1.75, Math.PI * 2, "#d8453a"]]) {
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
    }
    text(ctx, label, cx, y + size * 0.75, { size: 16, font: MONO, align: "center", color: "#e9d7b8" });
  },
  ladder(ctx, t, [x, y, h]) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = "#6a4d36";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 40, y + h);
    ctx.moveTo(x + 50, y);
    ctx.lineTo(x + 90, y + h);
    ctx.stroke();
    ctx.lineWidth = 4;
    for (let i = 1; i < h / 40; i++) {
      const k = (i * 40) / h;
      ctx.beginPath();
      ctx.moveTo(x + 40 * k, y + h * k);
      ctx.lineTo(x + 50 + 40 * k, y + h * k);
      ctx.stroke();
    }
    ctx.restore();
  },
  gear(ctx, t, [x, y, r, teeth], theme) {
    ctx.save();
    ctx.fillStyle = theme.far.replace(/[\d.]+\)$/, "0.10)");
    ctx.strokeStyle = "rgba(255, 138, 61, 0.12)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i * Math.PI) / teeth;
      const a1 = ((i + 1) * Math.PI) / teeth;
      const rad = i % 2 ? r : r * 1.14;
      ctx.lineTo(x + Math.cos(a0) * rad, y + Math.sin(a0) * rad);
      ctx.lineTo(x + Math.cos(a1) * rad, y + Math.sin(a1) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(4, 8, 7, 0.9)";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  pipes(ctx, t, [x, y, w, h]) {
    for (let i = 0; i < 2; i++) {
      const py = y + i * (h / 2 + 4);
      ctx.fillStyle = vgrad(ctx, py, py + h / 2 - 4, "#3d4a45", "#161c1a");
      ctx.fillRect(x, py, w, h / 2 - 4);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      for (let bx = x + 60 + i * 40; bx < x + w; bx += 180) ctx.fillRect(bx, py - 2, 14, h / 2);
    }
  },
  pipe(ctx, t, [x, y, w, h]) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#161c1a");
    g.addColorStop(0.4, "#46544f");
    g.addColorStop(1, "#111513");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (let by = y + 80; by < y + h; by += 160) ctx.fillRect(x - 3, by, w + 6, 10);
  },
  reactor(ctx, t, [x, y, w, h]) {
    // The Compatibility Reactor: a big machine with a screen that is always nearly done.
    rr(ctx, x, y, w, h, 14);
    ctx.fillStyle = vgrad(ctx, y, y + h, "#2a302d", "#101412");
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 150, 80, 0.3)";
    ctx.lineWidth = 3;
    ctx.stroke();
    rr(ctx, x + 18, y + 18, w - 36, h * 0.52, 8);
    ctx.fillStyle = "#06120d";
    ctx.fill();
    text(ctx, "COMPATIBILITY REACTOR", x + w / 2, y + 46, { size: 18, font: MONO, align: "center", color: "#7dff9a" });
    text(ctx, "TRANSLATING…", x + 30, y + 90, { size: 22, font: MONO, color: "#7dff9a" });
    // Vents.
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (let i = 0; i < 6; i++) ctx.fillRect(x + 24 + i * ((w - 48) / 6), y + h - 64, (w - 48) / 6 - 8, 40);
  },
};

// ------------------------------------------------------------------ backdrop

/** Suspension cables from thin platforms up to the ceiling: they hang, they don't hold anyone. */
function cables(ctx, level) {
  ctx.save();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.lineWidth = 3;
  for (const r of level.platforms) {
    if (isBlock(r)) continue;
    for (const cx of [r[0] + 14, r[0] + r[2] - 14]) {
      ctx.beginPath();
      ctx.moveTo(cx, r[1]);
      ctx.lineTo(cx + (hash(cx) - 0.5) * 30, -MARGIN);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * The static back layer: wall, far shapes, props and signs, over the world plus MARGIN on every
 * side (for parallax and the rotated view).
 */
export function paintBackdrop(ctx, level, theme = themeFor(level.id)) {
  ctx.fillStyle = vgrad(ctx, -MARGIN, H + MARGIN, theme.wall[0], theme.wall[1]);
  ctx.fillRect(-MARGIN, -MARGIN, W + MARGIN * 2, H + MARGIN * 2);
  // A faint panel grid: the inside of a machine.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = -MARGIN; x <= W + MARGIN; x += 100) {
    ctx.moveTo(x, -MARGIN);
    ctx.lineTo(x, H + MARGIN);
  }
  for (let y = -MARGIN; y <= H + MARGIN; y += 100) {
    ctx.moveTo(-MARGIN, y);
    ctx.lineTo(W + MARGIN, y);
  }
  ctx.stroke();
  for (const [type, ...args] of theme.props) PROPS[type]?.(ctx, 0, args, theme);
  cables(ctx, level);
  // Depth below the gaps: the floor falls away into the dark.
  for (const h of level.hazards) {
    const [x, y, w] = h.rect ?? h;
    if (!isPit(h.rect ?? h)) continue;
    ctx.fillStyle = vgrad(ctx, y - 140, y + 40, "rgba(0,0,0,0)", "rgba(0,0,0,0.65)");
    ctx.fillRect(x, y - 140, w, 180);
  }
  // Vignette.
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = v;
  ctx.fillRect(-MARGIN, -MARGIN, W + MARGIN * 2, H + MARGIN * 2);
}

// ------------------------------------------------------------------ solids

function paintBlock(ctx, [x, y, w, h], theme, i) {
  if (theme.skin === "grass") return paintVoxelBlock(ctx, [x, y, w, h]);
  if (theme.skin === "neon") return paintNeonBlock(ctx, [x, y, w, h], theme);
  ctx.fillStyle = vgrad(ctx, y, y + h, theme.block[0], theme.block[1]);
  ctx.fillRect(x, y, w, h);
  // Panel seams and rivets.
  ctx.strokeStyle = theme.seam;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 30);
  ctx.lineTo(x + w, y + 30);
  for (let sx = x + 70 + hash(i) * 30; sx < x + w - 30; sx += 110) {
    ctx.moveTo(sx, y + 30);
    ctx.lineTo(sx, y + h);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  for (let rx = x + 14; rx < x + w - 8; rx += 36) {
    ctx.beginPath();
    ctx.arc(rx, y + 38, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // Side rim light and shade: reads as a solid block, not a flat rect.
  ctx.fillStyle = theme.rim;
  ctx.fillRect(x, y, 3, h);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x + w - 4, y, 4, h);
  // A CPI stencil on bigger housings.
  if (w >= 220 && h >= 120) text(ctx, `CPI-${100 + Math.floor(hash(i + 3) * 800)} HOUSING`, x + 18, y + h - 24, { size: 18, font: MONO, color: "rgba(255,255,255,0.14)" });
  // The walkway: grating, then the bright edge that says "stand here".
  ctx.fillStyle = theme.top;
  ctx.fillRect(x, y, w, 16);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let gx = x + 6; gx < x + w - 6; gx += 12) ctx.fillRect(gx, y + 7, 7, 5);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(x, y + 16, w, 5);
  ctx.fillStyle = EDGE;
  ctx.fillRect(x, y, w, 4);
  // Caution stripes where a floor ends in a drop.
  if (x > 0) stripes(ctx, x, y + 21, 8, Math.min(60, h - 21), EDGE, "#111", 8);
  if (x + w < W) stripes(ctx, x + w - 8, y + 21, 8, Math.min(60, h - 21), EDGE, "#111", 8);
}

/** Blockcraft: grass on top, dirt, then stone, all in 20-unit pixel blocks. */
function paintVoxelBlock(ctx, [x, y, w, h]) {
  const cell = 20;
  for (let by = y; by < y + h; by += cell) {
    for (let bx = x; bx < x + w; bx += cell) {
      const depth = (by - y) / cell;
      const n = hash(bx * 0.37 + by * 0.11);
      ctx.fillStyle = depth < 1 ? (n > 0.5 ? "#5fb03e" : "#56a236") : depth < 4 ? (n > 0.5 ? "#8a5a32" : "#7a4e2b") : n > 0.5 ? "#7d7d7d" : "#6e6e6e";
      ctx.fillRect(bx, by, Math.min(cell, x + w - bx), Math.min(cell, y + h - by));
    }
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.fillRect(x + w - 4, y, 4, h);
  ctx.fillStyle = EDGE;
  ctx.fillRect(x, y, w, 4);
}

/** Astro Blaster: dark blocks outlined in neon. */
function paintNeonBlock(ctx, [x, y, w, h], theme) {
  ctx.fillStyle = vgrad(ctx, y, y + h, theme.block[0], theme.block[1]);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(60, 230, 255, 0.7)";
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.strokeStyle = theme.seam;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let gx = x + 40; gx < x + w; gx += 40) {
    ctx.moveTo(gx, y + 8);
    ctx.lineTo(gx, y + h);
  }
  ctx.stroke();
  ctx.fillStyle = EDGE;
  ctx.fillRect(x, y, w, 4);
}

function paintSlab(ctx, [x, y, w, h], theme) {
  // A suspended girder: plate on top, truss below, bolted end caps.
  ctx.fillStyle = vgrad(ctx, y, y + h, theme.slab[0], theme.slab[1]);
  rr(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y + 8, w, h - 8);
  ctx.clip();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const step = Math.max(12, h);
  for (let tx = x; tx < x + w; tx += step) {
    ctx.moveTo(tx, y + h);
    ctx.lineTo(tx + step / 2, y + 8);
    ctx.lineTo(tx + step, y + h);
  }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.fillStyle = theme.rim;
  ctx.fillRect(x, y + 4, w, 2);
  for (const bx of [x + 6, x + w - 6]) {
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(bx, y + h / 2 + 2, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = EDGE;
  ctx.fillRect(x, y, w, 4);
  // A soft shadow cast on the wall behind.
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(x + 6, y + h, w - 4, 10);
}

/** The static platform layer, dressed from the collision rects (and only those). */
export function paintSolids(ctx, level, theme = themeFor(level.id)) {
  level.platforms.forEach((r, i) => (isBlock(r) ? paintBlock(ctx, r, theme, i) : paintSlab(ctx, r, theme)));
  // Signs bolted to the housings.
  for (const [type, ...args] of theme.decals ?? []) PROPS[type]?.(ctx, 0, args, theme);
  // A thin frame around the world: the edges of the Deck's screen, inside the Deck.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 4;
  ctx.strokeRect(-2, -2, W + 4, H + 4);
}

// ------------------------------------------------------------------ live scenery

const LIVE = {
  drift(ctx, time, [x, y]) {
    // A few blocky clouds that actually move.
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    for (let i = 0; i < 3; i++) {
      const cx = ((time * (12 + i * 6) + i * 600) % (W + 400)) - 200;
      ctx.fillRect(cx, y + 150 + i * 60, 140, 20);
      ctx.fillRect(cx + 30, y + 136 + i * 60, 70, 14);
    }
  },
  torch(ctx, time, [x, y]) {
    ctx.fillStyle = "#4a3620";
    ctx.fillRect(x - 5, y, 10, 40);
    const f = 1 + Math.sin(time * 17 + x) * 0.15 + Math.sin(time * 29) * 0.1;
    const g = ctx.createRadialGradient(x, y - 10, 2, x, y - 10, 90 * f);
    g.addColorStop(0, "rgba(255, 170, 60, 0.35)");
    g.addColorStop(1, "rgba(255, 120, 40, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 100, y - 110, 200, 200);
    ctx.fillStyle = "#ffb03a";
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 7 * f, 14 * f, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff0a0";
    ctx.beginPath();
    ctx.ellipse(x, y - 4, 3, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  },
  gem(ctx, time, [x, y, color]) {
    const bob = Math.sin(time * 2 + x) * 5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - 14 + bob);
    ctx.lineTo(x + 11, y + bob);
    ctx.lineTo(x, y + 16 + bob);
    ctx.lineTo(x - 11, y + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(x - 3, y - 6 + bob, 4, 4);
  },
  invaders(ctx, time, [x, y, count]) {
    // A row of pixel aliens marching back and forth.
    const step = Math.floor(time * 2);
    const off = ((step % 20) < 10 ? step % 10 : 10 - (step % 10)) * 14;
    const frame = step % 2;
    const shape = frame ? ["0100010", "1111111", "1011101", "1000001"] : ["0100010", "1111111", "1011101", "0100010"];
    ctx.fillStyle = "rgba(120, 255, 140, 0.55)";
    for (let i = 0; i < count; i++) {
      const ax = x + off + i * 90;
      shape.forEach((row, ry) => [...row].forEach((c, rx) => c === "1" && ctx.fillRect(ax + rx * 7, y + ry * 7, 7, 7)));
    }
  },
  twinkle(ctx, time, [x, y, w, h]) {
    for (let i = 0; i < 12; i++) {
      if (Math.sin(time * 3 + i * 7) < 0.6) continue;
      ctx.fillStyle = "#ffffff";
      const sx = x + hash(i + 300) * w;
      const sy = y + hash(i + 400) * h;
      ctx.fillRect(sx - 1, sy - 5, 3, 11);
      ctx.fillRect(sx - 5, sy - 1, 11, 3);
    }
  },
  cursor(ctx, time, [x, y, w, h, gap, count]) {
    // The home screen's selection ring hops between tiles, like someone's scrolling.
    const i = Math.floor(time / 2.2) % count;
    const k = Math.min(1, (time % 2.2) / 0.18);
    ctx.strokeStyle = `rgba(223, 246, 255, ${0.35 + 0.35 * k})`;
    ctx.lineWidth = 4;
    rr(ctx, x + i * (w + gap) - 6, y - 6, w + 12, h + 12, 14);
    ctx.stroke();
  },
  blink(ctx, time, [x, y, color]) {
    if (Math.floor(time * 2) % 2) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
  },
  ticker(ctx, time, [x, y, w, message]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y - 14, w, 28);
    ctx.clip();
    ctx.font = `700 17px ${MONO}`;
    const span = ctx.measureText(message).width;
    const off = (time * 60) % span;
    ctx.fillStyle = "rgba(143, 179, 217, 0.55)";
    ctx.textBaseline = "middle";
    ctx.fillText(message, x - off, y);
    ctx.fillText(message, x - off + span, y);
    ctx.restore();
  },
  needle(ctx, time, [cx, cy, r]) {
    // Pegged in the red, trembling.
    const a = Math.PI * 1.93 + Math.sin(time * 23) * 0.025;
    ctx.strokeStyle = "#fff1c2";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  },
  flicker(ctx, time, [x, y, reach], theme) {
    // One lamp is on its way out.
    const off = Math.sin(time * 37) > 0.93 || Math.sin(time * 3.1) > 0.985;
    if (!off) return;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.moveTo(x - 18, y + 70);
    ctx.lineTo(x + 18, y + 70);
    ctx.lineTo(x + reach * 0.55, y + 70 + reach * 1.6);
    ctx.lineTo(x - reach * 0.55, y + 70 + reach * 1.6);
    ctx.closePath();
    ctx.fill();
  },
  progress(ctx, time, [x, y, w, h]) {
    // Always nearly finished; then it starts again.
    const k = Math.min(0.98, ((time % 9) / 9) ** 0.35);
    rr(ctx, x, y, w, h, 4);
    ctx.strokeStyle = "#7dff9a";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(125, 255, 154, 0.7)";
    ctx.fillRect(x + 3, y + 3, (w - 6) * k, h - 6);
    text(ctx, `${Math.floor(k * 100) === 98 ? 2 : Math.floor(k * 100)}%`, x + w, y - 16, { size: 18, font: MONO, align: "right", color: "#7dff9a" });
  },
  spinner(ctx, time, [x, y, r]) {
    ctx.strokeStyle = "#7dff9a";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y, r, time * 5, time * 5 + Math.PI * 1.3);
    ctx.stroke();
  },
};

/** The few scenery bits that move. Cheap: a handful of shapes a frame. */
export function paintLive(ctx, level, time, theme = themeFor(level.id)) {
  for (const [type, ...args] of theme.live) LIVE[type]?.(ctx, time, args, theme);
}

// ------------------------------------------------------------------ hazards, exit, planks

/**
 * A hazard. `live` 0/1; `armed` 0..1 while it arrives (spikes extend); `time` for glow. Coming ones
 * are a dashed warning with the spike slots, so nobody is surprised twice.
 */
export function paintHazard(ctx, rect, { live, armed = 1, time = 0, theme }) {
  const [x, y, w, h] = rect;
  const pit = isPit(rect);
  if (!live) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -time * 20;
    ctx.strokeStyle = `rgba(255, 77, 77, ${0.35 + 0.35 * pulse})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255, 77, 77, 0.10)";
    ctx.fillRect(x, y, w, h);
    // The slots the spikes will come out of.
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    const teeth = Math.max(1, Math.round(w / 16));
    for (let i = 0; i < teeth; i++) ctx.fillRect(x + (i + 0.3) * (w / teeth), y + h - 5, (w / teeth) * 0.4, 3);
    warningMark(ctx, x + w / 2, y - 16, 13, pulse);
    ctx.restore();
    return;
  }
  const [hot, deep] = theme?.pit ?? ["#ff3b3b", "#2a0508"];
  if (pit) {
    // A shredder at the bottom of the gap, glowing.
    const glow = 0.75 + 0.25 * Math.sin(time * 4 + x);
    ctx.fillStyle = vgrad(ctx, y - 30, y + h, "rgba(0,0,0,0)", deep);
    ctx.fillRect(x, y - 30, w, h + 30);
    ctx.save();
    ctx.globalAlpha = glow;
    ctx.fillStyle = vgrad(ctx, y, y + h, "rgba(0,0,0,0)", hot);
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  const teeth = Math.max(1, Math.round(w / (pit ? 22 : 15)));
  const tall = h * Math.max(0, Math.min(1, armed));
  // Base plate.
  ctx.fillStyle = "#2b1416";
  ctx.fillRect(x, y + h - 6, w, 6);
  for (let i = 0; i < teeth; i++) {
    const tx = x + (i * w) / teeth;
    const tw = w / teeth;
    const g = ctx.createLinearGradient(0, y + h - tall, 0, y + h);
    g.addColorStop(0, "#f2f2f2");
    g.addColorStop(0.45, "#b9b9c4");
    g.addColorStop(1, "#6a1c20");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(tx + 1, y + h - 4);
    ctx.lineTo(tx + tw / 2, y + h - tall);
    ctx.lineTo(tx + tw - 1, y + h - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = hot;
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 6 + x * 0.01);
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.globalAlpha = 1;
}

function warningMark(ctx, x, y, r, pulse) {
  ctx.fillStyle = `rgba(255, 212, 0, ${0.6 + 0.4 * pulse})`;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y + r * 0.8);
  ctx.lineTo(x - r, y + r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#111";
  ctx.fillRect(x - 1.5, y - r * 0.4, 3, r * 0.65);
  ctx.fillRect(x - 1.5, y + r * 0.38, 3, 3);
}

/** The EXIT: a lit door out of the Deck. `urgent` pulses it (final window); `out` counts escapes. */
export function paintExit(ctx, [x, y, w, h], { time = 0, urgent = false, out = 0, total = 0 } = {}) {
  const pulse = urgent ? 0.55 + 0.45 * Math.sin(time * 9) : 0.85 + 0.15 * Math.sin(time * 2.5);
  // Light spilling onto the floor and wall.
  const spill = ctx.createRadialGradient(x + w / 2, y + h * 0.6, 10, x + w / 2, y + h * 0.6, h * 1.3);
  spill.addColorStop(0, `rgba(80, 255, 130, ${0.28 * pulse})`);
  spill.addColorStop(1, "rgba(80, 255, 130, 0)");
  ctx.fillStyle = spill;
  ctx.fillRect(x - h, y - h * 0.6, w + h * 2, h * 2.2);
  // Frame.
  rr(ctx, x - 7, y - 7, w + 14, h + 7, 6);
  ctx.fillStyle = "#1c2320";
  ctx.fill();
  ctx.strokeStyle = "#9aa39f";
  ctx.lineWidth = 2;
  ctx.stroke();
  // The doorway: bright, with chevrons pulling you in.
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, `rgba(190, 255, 205, ${pulse})`);
  g.addColorStop(1, `rgba(40, 200, 90, ${pulse})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    const cy = y + h - (((time * 50 + i * (h / 3)) % h) + 6);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.3, cy + 10);
    ctx.lineTo(x + w * 0.5, cy);
    ctx.lineTo(x + w * 0.7, cy + 10);
    ctx.stroke();
  }
  ctx.restore();
  // Sign.
  rr(ctx, x - 4, y - 40, w + 8, 28, 4);
  ctx.fillStyle = "#0f7a38";
  ctx.fill();
  ctx.strokeStyle = "#d8ffe3";
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, "EXIT", x + w / 2, y - 25, { size: 21, align: "center", color: "#ffffff" });
  if (total) text(ctx, `OUT ${out}/${total}`, x + w / 2, y - 54, { size: 15, font: MONO, align: "center", color: "rgba(200, 255, 215, 0.85)" });
}

/**
 * A runner's plank: pine among all the metal, nailed, tagged in its owner's colour. `age` (s since
 * it appeared) builds it in; `ttl` (ms left) makes it creak and blink near the end. `ghost` is the
 * drawing preview (exactly where it will go), `invalid` a preview that won't work.
 */
export function paintPlank(ctx, { x1, x2, y }, { color = "#ffd400", age = 1, ttl = 10_000, ghost = false, invalid = false, time = 0 } = {}) {
  const thick = 10;
  const grow = Math.min(1, age / 0.22);
  const cx = (x1 + x2) / 2;
  const half = ((x2 - x1) / 2) * (0.25 + 0.75 * (1 - (1 - grow) ** 3));
  const a = x1 === x2 ? cx - 1 : cx - half;
  const b = cx + half;
  ctx.save();
  if (ghost) ctx.globalAlpha *= 0.8;
  else if (ttl < 2000) ctx.globalAlpha *= 0.55 + 0.45 * (Math.floor(time * 8) % 2);
  if (ghost) {
    // The preview: a glow so it reads over anything, then the plank itself.
    ctx.shadowColor = invalid ? "#ff4d4d" : "#39d353";
    ctx.shadowBlur = 12;
  }
  rr(ctx, a, y, b - a, thick, 2.5);
  const g = ctx.createLinearGradient(0, y, 0, y + thick);
  g.addColorStop(0, invalid ? "#d98080" : "#ecb877");
  g.addColorStop(1, invalid ? "#9c3b3b" : "#b0733a");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#3b2412";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Grain and nails.
  ctx.strokeStyle = "rgba(90, 50, 20, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a + 6, y + 3.5);
  ctx.bezierCurveTo(a + (b - a) * 0.35, y + 2, a + (b - a) * 0.6, y + 5, b - 6, y + 3.5);
  ctx.moveTo(a + 10, y + 7);
  ctx.lineTo(b - 14, y + 6.5);
  ctx.stroke();
  ctx.fillStyle = "#3b3f46";
  for (const nx of [a + 6, b - 6]) {
    ctx.beginPath();
    ctx.arc(nx, y + thick / 2, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // Whose plank it is.
  ctx.fillStyle = color;
  ctx.fillRect(a + 11, y + 1.5, 6, thick - 3);
  if (!ghost && ttl < 2000) {
    ctx.strokeStyle = "rgba(40, 20, 8, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 4, y);
    ctx.lineTo(cx + 2, y + 5);
    ctx.lineTo(cx - 2, y + thick);
    ctx.stroke();
  }
  if (ghost) {
    ctx.setLineDash([6, 5]);
    ctx.lineDashOffset = -time * 30;
    ctx.strokeStyle = invalid ? "#ff4d4d" : "#7dff9a";
    ctx.lineWidth = 2;
    rr(ctx, a - 4, y - 4, b - a + 8, thick + 8, 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Outside the world (the rotated view's corners): the Deck's dark insides. */
export function paintVoid(ctx, width, height) {
  const g = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.7);
  g.addColorStop(0, "#0b0e12");
  g.addColorStop(1, "#030405");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}
