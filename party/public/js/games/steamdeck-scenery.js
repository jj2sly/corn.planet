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
  home: {
    name: "The Home Screen",
    wall: ["#12233a", "#070b12"],
    far: "rgba(77, 212, 255, 0.07)",
    block: ["#26344a", "#121a26"],
    top: "#3a4d69",
    seam: "rgba(0, 0, 0, 0.35)",
    rim: "rgba(120, 220, 255, 0.35)",
    slab: ["#33445e", "#1a2433"],
    pit: ["#ff3b3b", "#2a0508"],
    light: "rgba(120, 200, 255, 0.10)",
    props: [
      ["tabs", 90, 34, ["LIBRARY", "STORE", "FRIENDS (0)", "CORN", "SETTINGS"]],
      ["heading", 110, 92, "RECENTLY PLAYED"],
      ["tiles", 110, 108, 180, 150, 22, ["KERNEL PANIC", "SILO RUSH", "COB ROYALE", "HUSK & SEEK", "CORNFIELD 2"]],
      ["widget", 1300, 40, 250, 110, "BATTERY", "3%", "danger"],
      ["widget", 1300, 172, 250, 110, "FRIENDS ONLINE", "0", ""],
      ["circuit", 0, 300, 1600, 600],
      ["lamp", 470, 0, 380],
      ["lamp", 1100, 0, 420],
    ],
    decals: [
      ["sign", 610, 780, 280, 44, "DO NOT LICK THE UI", "warn"],
      ["sign", 1290, 560, 250, 44, "PROPERTY OF THAD", "plain"],
      ["sign", 40, 790, 250, 44, "CPI KERNEL · HOME", "plain"],
    ],
    live: [
      ["cursor", 110, 108, 180, 150, 22, 5],
      ["blink", 1508, 88, "#ff4d4d"],
      ["ticker", 110, 290, 1030, "NEW: THAD HAS ACHIEVED 'TILTED' · 1 NOTIFICATION FROM A CORN · UPDATE AVAILABLE: 94.2 GB · "],
    ],
  },
  library: {
    name: "Library (Unsorted)",
    wall: ["#211827", "#0b080d"],
    far: "rgba(255, 190, 120, 0.06)",
    block: ["#3b2c26", "#1a1210"],
    top: "#5a4336",
    seam: "rgba(0, 0, 0, 0.4)",
    rim: "rgba(255, 196, 120, 0.3)",
    slab: ["#5b4131", "#2c1e16"],
    pit: ["#ff5a2a", "#200805"],
    light: "rgba(255, 190, 110, 0.12)",
    props: [
      ["shelves", 20, 60, 320, 840],
      ["shelves", 400, 150, 300, 750],
      ["shelves", 1060, 40, 300, 860],
      ["lamp", 250, 0, 300],
      ["lamp", 880, 0, 340],
      ["lamp", 1470, 0, 260],
      ["hanging", 500, 0, 110, "UNSORTED"],
      ["hanging", 1120, 0, 150, "SORT BY: VIBES"],
      ["gauge", 840, 170, 150, "BACKLOG"],
      ["ladder", 1380, 110, 350],
    ],
    decals: [
      ["sign", 780, 790, 220, 44, "4,000 GAMES", "plain"],
      ["sign", 1420, 520, 170, 40, "3 PLAYED", "warn"],
      ["sign", 30, 800, 290, 44, "RETURN CARTRIDGES TO THAD", "plain"],
    ],
    live: [
      ["needle", 840 + 75, 170 + 100, 60],
      ["flicker", 880, 0, 340],
    ],
  },
  proton: {
    name: "Proton Compatibility Layer",
    wall: ["#0d1a17", "#040807"],
    far: "rgba(255, 138, 61, 0.06)",
    block: ["#2d3431", "#141816"],
    top: "#48524d",
    seam: "rgba(0, 0, 0, 0.4)",
    rim: "rgba(255, 150, 80, 0.3)",
    slab: ["#3b4541", "#1c2220"],
    pit: ["#ff8a1f", "#2a1003"],
    light: "rgba(255, 150, 70, 0.10)",
    props: [
      ["gear", 330, 170, 150, 14],
      ["gear", 1000, 610, 210, 18],
      ["gear", 1420, 780, 120, 12],
      ["pipes", 0, 44, 1600, 44],
      ["pipe", 1140, 60, 20, 800],
      ["reactor", 1180, 300, 300, 290],
      ["sign", 1195, 610, 270, 40, "RUNS GREAT*", "warn"],
      ["sign", 1240, 660, 200, 30, "*DOES NOT RUN", "plain"],
    ],
    decals: [
      ["sign", 300, 848, 170, 34, "HOT SHADERS", "warn"],
      ["sign", 20, 848, 240, 34, "CPI COMPAT DIVISION", "plain"],
    ],
    live: [
      ["progress", 1210, 425, 240, 22],
      ["spinner", 1445, 388, 11],
      ["blink", 1462, 318, "#7dff6a"],
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
