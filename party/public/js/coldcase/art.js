// CPI: Cold Case — the art. Every drawing function works in world units (1 = one tile = one
// metre) on a context the renderer has already transformed, so the same code paints the cached
// floor chunks and the live frame. Top-down with a 2.5D lip: walls and furniture show a darker
// front face along their south edge, and everything casts a soft shadow.
//
// Palette: CPI terminal black and warning yellow, refrigerator whites and frost blues, emergency
// red. The kitchen is the only warm, ordinary room.

export const COLORS = Object.freeze({
  void: "#030405",
  yellow: "#ffd400",
  yellowDim: "#8a7400",
  frost: "#bfeaff",
  cyan: "#7fe0ff",
  red: "#ff4b3a",
  green: "#8fe060",
  amber: "#ffab5e",
  milk: "#f6f4ec",
  suit: "#ffd400",
  suitDark: "#8f7600",
});

const WALLS = {
  kitchen: { top: "#d9c9ad", front: "#a58c6b", edge: "#f3e6cf", trim: "#7d6548" },
  liner: { top: "#f2f8fa", front: "#b9cdd4", edge: "#ffffff", trim: "#8fa8b1" },
  steel: { top: "#4b545c", front: "#2a3035", edge: "#6b767f", trim: "#1b1f23" },
  frost: { top: "#a9d2df", front: "#5d8797", edge: "#e6f7ff", trim: "#3d6272" },
  ice: { top: "#6d9fb5", front: "#34596b", edge: "#bfe6f5", trim: "#223f4d" },
};

/** Deterministic noise in [0, 1) for a tile (and a salt), so cached art never shimmers. */
export function hash(x, y, k = 0) {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function circle(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

function line(ctx, x0, y0, x1, y1, stroke, width) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

/**
 * Text in world units. Canvas fonts misbehave below 1px, so this draws at a real pixel size under
 * a counter-scaled transform: `size` is the cap height in tiles.
 */
export function worldText(ctx, text, x, y, size, { font = "Oswald, Arial, sans-serif", weight = 700, color = "#fff", align = "center", baseline = "middle", alpha = 1, spacing = 0, rotate = 0 } = {}) {
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b) || 1;
  const px = Math.max(1, size * scale);
  ctx.save();
  ctx.translate(x, y);
  if (rotate) ctx.rotate(rotate);
  ctx.scale(1 / scale, 1 / scale);
  ctx.globalAlpha *= alpha;
  ctx.font = `${weight} ${px}px ${font}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing * px}px`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ------------------------------------------------------------------ floors

export function drawFloorTile(ctx, mat, x, y) {
  const n = hash(x, y);
  switch (mat) {
    case "kitchen": {
      rect(ctx, x, y, 1, 1, "#c8ae8a");
      ctx.fillStyle = "#a88c69";
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if ((x * 2 + i + y * 2 + j) % 2 === 0) ctx.fillRect(x + i * 0.5, y + j * 0.5, 0.5, 0.5);
      ctx.strokeStyle = "rgba(70, 50, 30, 0.28)";
      ctx.lineWidth = 0.02;
      ctx.strokeRect(x + 0.01, y + 0.01, 0.48, 0.48);
      ctx.strokeRect(x + 0.51, y + 0.51, 0.48, 0.48);
      if (n < 0.08) circle(ctx, x + 0.3 + n * 3, y + 0.6, 0.05, "rgba(90, 60, 30, 0.18)");
      break;
    }
    case "liner": {
      rect(ctx, x, y, 1, 1, (x + y) % 2 ? "#b9ccd4" : "#bdd0d8");
      ctx.fillStyle = "rgba(90, 120, 135, 0.14)";
      for (let i = 0; i < 4; i++) ctx.fillRect(x, y + i * 0.25 + 0.2, 1, 0.03);
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.fillRect(x, y, 1, 0.02);
      if (n < 0.16) circle(ctx, x + hash(x, y, 1), y + hash(x, y, 2), 0.08 + n * 0.6, "rgba(255, 255, 255, 0.22)");
      break;
    }
    case "grate": {
      rect(ctx, x, y, 1, 1, "#141a1e");
      ctx.strokeStyle = "#39444c";
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      for (let i = 0.1; i < 1; i += 0.2) {
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i, y + 1);
        ctx.moveTo(x, y + i);
        ctx.lineTo(x + 1, y + i);
      }
      ctx.stroke();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      ctx.lineWidth = 0.05;
      ctx.strokeRect(x, y, 1, 1);
      if (n < 0.18) circle(ctx, x + hash(x, y, 3), y + hash(x, y, 4), 0.12, "rgba(210, 240, 255, 0.16)");
      break;
    }
    case "plate": {
      rect(ctx, x, y, 1, 1, "#343b41");
      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const px = x + 0.17 + i * 0.33;
          const py = y + 0.17 + j * 0.33;
          const flip = (i + j) % 2 ? 1 : -1;
          ctx.moveTo(px - 0.07, py - 0.07 * flip);
          ctx.lineTo(px + 0.07, py + 0.07 * flip);
        }
      }
      ctx.stroke();
      if (x % 2 === 0) rect(ctx, x, y, 0.025, 1, "rgba(0, 0, 0, 0.45)");
      if (y % 2 === 0) rect(ctx, x, y, 1, 0.025, "rgba(0, 0, 0, 0.45)");
      if (x % 2 === 0 && y % 2 === 0) {
        for (const [ox, oy] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) circle(ctx, x + ox, y + oy, 0.035, "#59636b");
      }
      break;
    }
    case "ice": {
      rect(ctx, x, y, 1, 1, n < 0.5 ? "#9cc8d8" : "#a4cfde");
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
      ctx.lineWidth = 0.02;
      if (n < 0.45) {
        ctx.beginPath();
        let cx = x + hash(x, y, 5);
        let cy = y;
        ctx.moveTo(cx, cy);
        for (let i = 0; i < 3; i++) {
          cx += (hash(x, y, 6 + i) - 0.5) * 0.6;
          cy += 0.33;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 3; i++) circle(ctx, x + hash(x, y, 10 + i), y + hash(x, y, 20 + i), 0.02, "rgba(255, 255, 255, 0.7)");
      break;
    }
    case "wood": {
      const shades = ["#6f5236", "#7a5c3c", "#664a30", "#80603f"];
      for (let i = 0; i < 4; i++) {
        rect(ctx, x, y + i * 0.25, 1, 0.25, shades[(i + y * 4 + (x % 3)) % 4]);
        const cut = hash(x, y, 30 + i);
        rect(ctx, x + cut, y + i * 0.25, 0.02, 0.25, "rgba(0, 0, 0, 0.35)");
        rect(ctx, x, y + i * 0.25 + 0.235, 1, 0.015, "rgba(0, 0, 0, 0.3)");
      }
      break;
    }
    case "cavern": {
      rect(ctx, x, y, 1, 1, "#15212b");
      for (let i = 0; i < 3; i++) {
        const ax = x + hash(x, y, 40 + i);
        const ay = y + hash(x, y, 50 + i);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + 0.3, ay + 0.1);
        ctx.lineTo(ax + 0.12, ay + 0.34);
        ctx.closePath();
        ctx.fillStyle = i === 0 ? "rgba(120, 180, 220, 0.12)" : "rgba(0, 0, 0, 0.18)";
        ctx.fill();
      }
      if (n < 0.14) line(ctx, x, y + n * 6, x + 1, y + 0.4 + n * 3, "rgba(80, 170, 230, 0.28)", 0.025);
      if (n > 0.8) circle(ctx, x + 0.5, y + 0.5, 0.18, "rgba(210, 240, 255, 0.12)");
      break;
    }
    case "core": {
      rect(ctx, x, y, 1, 1, "#111920");
      ctx.strokeStyle = "rgba(90, 200, 255, 0.1)";
      ctx.lineWidth = 0.03;
      ctx.strokeRect(x + 0.05, y + 0.05, 0.9, 0.9);
      if (n < 0.3) line(ctx, x + 0.5, y, x + 0.5, y + 1, "rgba(90, 200, 255, 0.12)", 0.04);
      break;
    }
    default:
      rect(ctx, x, y, 1, 1, "#20262b");
  }
}

/** Ice patches: a glossy sheen over whatever floor is there. */
export function drawIceSheen(ctx, x, y) {
  rect(ctx, x, y, 1, 1, "rgba(200, 240, 255, 0.35)");
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 0.035;
  const k = hash(x, y, 77);
  line(ctx, x + 0.1 + k * 0.3, y + 0.8, x + 0.5 + k * 0.3, y + 0.2, "rgba(255, 255, 255, 0.55)", 0.035);
  line(ctx, x + 0.45 + k * 0.3, y + 0.9, x + 0.75, y + 0.5, "rgba(255, 255, 255, 0.35)", 0.025);
}

// ------------------------------------------------------------------ walls

/**
 * One wall tile. `open` says which neighbours are floor ({n, s, e, w}); a floor to the south
 * means we see the wall's front face.
 */
export function drawWallTile(ctx, style, x, y, open) {
  const c = WALLS[style] ?? WALLS.steel;
  const face = open.s ? 0.46 : 0;
  rect(ctx, x, y, 1, 1 - face, c.top);
  // A lip along edges that meet the floor.
  if (open.n) rect(ctx, x, y, 1, 0.06, c.edge);
  if (open.w) rect(ctx, x, y, 0.05, 1 - face, c.edge);
  if (open.e) rect(ctx, x + 0.95, y, 0.05, 1 - face, c.edge);
  const n = hash(x, y, 91);
  if (style === "steel" && n < 0.3) circle(ctx, x + 0.5, y + 0.3, 0.04, c.trim);
  if (style === "liner" && n < 0.4) rect(ctx, x + 0.1, y + 0.2, 0.8, 0.03, "rgba(150, 180, 190, 0.35)");
  if (face) {
    const top = y + 1 - face;
    const grad = ctx.createLinearGradient(0, top, 0, y + 1);
    grad.addColorStop(0, c.front);
    grad.addColorStop(1, shade(c.front, -0.35));
    ctx.fillStyle = grad;
    ctx.fillRect(x, top, 1, face);
    rect(ctx, x, top, 1, 0.035, c.edge);
    if (style === "kitchen") rect(ctx, x, y + 0.9, 1, 0.1, c.trim);
    if (style === "steel") {
      rect(ctx, x, y + 0.83, 1, 0.05, "#ffd40055");
      if (n < 0.5) circle(ctx, x + 0.2 + n, top + 0.2, 0.035, c.trim);
    }
    if (style === "liner") rect(ctx, x, y + 0.88, 1, 0.04, "rgba(120, 150, 160, 0.5)");
    if (style === "frost" || style === "ice") {
      // Icicles.
      ctx.fillStyle = "rgba(230, 248, 255, 0.85)";
      for (let i = 0; i < 3; i++) {
        const ix = x + 0.12 + i * 0.3 + hash(x, y, i) * 0.12;
        const len = 0.12 + hash(x, y, 10 + i) * 0.22;
        ctx.beginPath();
        ctx.moveTo(ix - 0.05, top + 0.03);
        ctx.lineTo(ix + 0.05, top + 0.03);
        ctx.lineTo(ix, top + 0.03 + len);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

/** Soft shadow a wall throws onto the floor tile south of it. */
export function drawWallShadow(ctx, x, y, dir) {
  if (dir === "n") {
    const g = ctx.createLinearGradient(0, y, 0, y + 0.45);
    g.addColorStop(0, "rgba(0, 0, 0, 0.42)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 1, 0.45);
  } else if (dir === "w") {
    const g = ctx.createLinearGradient(x, 0, x + 0.25, 0);
    g.addColorStop(0, "rgba(0, 0, 0, 0.28)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 0.25, 1);
  } else if (dir === "e") {
    const g = ctx.createLinearGradient(x + 1, 0, x + 0.75, 0);
    g.addColorStop(0, "rgba(0, 0, 0, 0.28)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x + 0.75, y, 0.25, 1);
  }
}

function shade(hex, amount) {
  const v = parseInt(hex.slice(1, 7), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c * amount : (255 - c) * amount))));
  const r = f((v >> 16) & 255);
  const g = f((v >> 8) & 255);
  const b = f(v & 255);
  return `rgb(${r}, ${g}, ${b})`;
}

// ------------------------------------------------------------------ furniture and machinery

/** A box with a lit top and a darker front face along its south edge. Returns the top rect. */
function block(ctx, x, y, w, h, top, front, faceH = Math.min(0.4, h * 0.34)) {
  // Drop shadow.
  rect(ctx, x + 0.06, y + h - 0.02, w - 0.04, 0.12, "rgba(0, 0, 0, 0.28)");
  rect(ctx, x, y, w, h - faceH, top);
  const g = ctx.createLinearGradient(0, y + h - faceH, 0, y + h);
  g.addColorStop(0, front);
  g.addColorStop(1, shade(front, -0.4));
  ctx.fillStyle = g;
  ctx.fillRect(x, y + h - faceH, w, faceH);
  rect(ctx, x, y + h - faceH, w, 0.03, "rgba(255, 255, 255, 0.18)");
  return { x, y, w, h: h - faceH };
}

function hazardStripes(ctx, x, y, w, h, alpha = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  rect(ctx, x, y, w, h, `rgba(20, 20, 20, ${alpha})`);
  ctx.fillStyle = `rgba(255, 212, 0, ${alpha})`;
  for (let i = -h; i < w + h; i += 0.3) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + 0.15, y + h);
    ctx.lineTo(x + i + 0.15 + h, y);
    ctx.lineTo(x + i + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawObstacle(ctx, o) {
  const { x, y, w, h } = o;
  switch (o.kind) {
    case "counter": {
      const t = block(ctx, x, y, w, h, "#e6ded0", "#8b6c4f", 0.38);
      rect(ctx, t.x, t.y + t.h - 0.05, t.w, 0.05, "rgba(0, 0, 0, 0.12)");
      for (let i = 1; i < w; i++) rect(ctx, x + i, y + h - 0.38, 0.02, 0.38, "rgba(0, 0, 0, 0.3)");
      if (hash(x, y) < 0.5 && w > 1) {
        circle(ctx, x + 0.4, y + 0.3, 0.12, "#c65b3a");
        circle(ctx, x + 0.4, y + 0.3, 0.07, "#e98b62");
      }
      break;
    }
    case "stove": {
      block(ctx, x, y, w, h, "#2c2d2f", "#5b5d60", 0.38);
      for (const [ox, oy] of [[0.45, 0.2], [1.1, 0.2], [0.45, 0.45], [1.1, 0.45]]) {
        circle(ctx, x + ox + 0.2, y + oy, 0.11, "#111");
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 0.02;
        ctx.stroke();
      }
      break;
    }
    case "sink": {
      const t = block(ctx, x, y, w, h, "#dfe6ea", "#8b6c4f", 0.38);
      roundRect(ctx, t.x + 0.25, t.y + 0.08, w - 0.5, t.h - 0.16, 0.08);
      ctx.fillStyle = "#9eb0b8";
      ctx.fill();
      rect(ctx, x + w / 2 - 0.04, y + 0.02, 0.08, 0.14, "#c7d0d4");
      break;
    }
    case "table": {
      rect(ctx, x + 0.1, y + h - 0.02, w - 0.1, 0.16, "rgba(0, 0, 0, 0.25)");
      const t = block(ctx, x, y, w, h, "#a67c52", "#6e4f31", 0.22);
      ctx.strokeStyle = "rgba(60, 35, 15, 0.35)";
      ctx.lineWidth = 0.02;
      for (let i = 0.4; i < t.h; i += 0.4) line(ctx, x + 0.05, y + i, x + w - 0.05, y + i, "rgba(60, 35, 15, 0.3)", 0.02);
      // The CPST field case and the work order on the table.
      block(ctx, x + 0.4, y + 0.3, 1.1, 0.7, "#2c3136", "#15181b", 0.16);
      rect(ctx, x + 0.45, y + 0.36, 1.0, 0.08, COLORS.yellow);
      worldText(ctx, "CPST", x + 0.95, y + 0.62, 0.22, { color: COLORS.yellow });
      ctx.save();
      ctx.translate(x + 2.6, y + 0.65);
      ctx.rotate(0.12);
      rect(ctx, -0.32, -0.4, 0.64, 0.8, "#f1ede2");
      rect(ctx, -0.12, -0.46, 0.24, 0.1, "#8a8a8a");
      for (let i = 0; i < 5; i++) rect(ctx, -0.22, -0.2 + i * 0.12, 0.44 - (i % 2) * 0.12, 0.035, "rgba(30, 30, 30, 0.55)");
      ctx.restore();
      // Chairs.
      for (const [cx, cy] of [[x + 0.7, y - 0.35], [x + 2.6, y - 0.35], [x + 0.7, y + h + 0.3], [x + 2.6, y + h + 0.3]]) {
        roundRect(ctx, cx - 0.28, cy - 0.22, 0.56, 0.44, 0.08);
        ctx.fillStyle = "#7c5a3a";
        ctx.fill();
      }
      break;
    }
    case "cabinet": {
      const t = block(ctx, x, y, w, h, "#93704f", "#6b4e33", 0.3);
      line(ctx, t.x + w / 2, t.y + 0.1, t.x + w / 2, t.y + t.h - 0.1, "rgba(0, 0, 0, 0.35)", 0.03);
      break;
    }
    case "rack": {
      rect(ctx, x + 0.05, y + h, w - 0.1, 0.14, "rgba(0, 0, 0, 0.3)");
      rect(ctx, x, y, w, h, "rgba(30, 40, 46, 0.35)");
      ctx.strokeStyle = "#dfe9ee";
      ctx.lineWidth = 0.06;
      ctx.strokeRect(x + 0.05, y + 0.05, w - 0.1, h - 0.1);
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      for (let i = x + 0.25; i < x + w; i += 0.25) {
        ctx.moveTo(i, y + 0.05);
        ctx.lineTo(i, y + h - 0.05);
      }
      ctx.stroke();
      // Oversized jars sitting on the rack.
      circle(ctx, x + 0.9, y + 0.5, 0.34, "rgba(200, 120, 40, 0.85)");
      circle(ctx, x + 0.9, y + 0.5, 0.24, "#b8612a");
      rect(ctx, x + 2.1, y + 0.18, 0.9, 0.64, "#d7c9a6");
      rect(ctx, x + 2.1, y + 0.4, 0.9, 0.2, "#c0392b");
      break;
    }
    case "eggtray": {
      block(ctx, x, y, w, h, "#e9e2d2", "#b8ab91", 0.3);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          const cx = x + 0.5 + i;
          const cy = y + 0.45 + j * 0.8;
          circle(ctx, cx, cy, 0.36, "#d3c9b3");
          if ((i + j) % 3 !== 2) {
            ctx.beginPath();
            ctx.ellipse(cx, cy - 0.04, 0.3, 0.26, 0, 0, TAU);
            ctx.fillStyle = "#fbf6ea";
            ctx.fill();
            circle(ctx, cx - 0.1, cy - 0.12, 0.06, "rgba(255, 255, 255, 0.9)");
          }
        }
      }
      break;
    }
    case "crisper": {
      block(ctx, x, y, w, h, "rgba(185, 225, 205, 0.9)", "#7aa592", 0.36);
      for (let i = 0; i < 5; i++) {
        const cx = x + 0.5 + i * 0.75;
        circle(ctx, cx, y + 0.55 + (i % 2) * 0.4, 0.28, i % 2 ? "#e07b39" : "#5fa44a");
        circle(ctx, cx - 0.08, y + 0.47 + (i % 2) * 0.4, 0.08, "rgba(255, 255, 255, 0.3)");
      }
      rect(ctx, x + 0.1, y + 0.1, w - 0.2, 0.08, "rgba(255, 255, 255, 0.55)");
      break;
    }
    case "pillar": {
      circle(ctx, x + 0.55, y + 0.62, 0.48, "rgba(0, 0, 0, 0.35)");
      hazardStripes(ctx, x + 0.02, y + 0.02, 0.96, 0.96);
      rect(ctx, x + 0.14, y + 0.14, 0.72, 0.72, "#59636b");
      rect(ctx, x + 0.14, y + 0.14, 0.72, 0.1, "#77828b");
      for (const [ox, oy] of [[0.25, 0.3], [0.75, 0.3], [0.25, 0.75], [0.75, 0.75]]) circle(ctx, x + ox, y + oy, 0.04, "#2a3035");
      break;
    }
    case "shelf": {
      block(ctx, x, y, w, h, "#5e6870", "#353c42", 0.32);
      // Stock: boxes, cans and jars, not all of it ordinary.
      for (let i = 0; i < w * 3; i++) {
        const n = hash(x + i, y, 9);
        const bx = x + 0.05 + i * 0.33;
        const kind = Math.floor(n * 4);
        if (kind === 0) rect(ctx, bx, y + 0.12, 0.26, 0.42, ["#c44536", "#e0a526", "#3d7fb8", "#6aa84f"][Math.floor(n * 40) % 4]);
        else if (kind === 1) circle(ctx, bx + 0.13, y + 0.33, 0.12, "#b7c0c6");
        else if (kind === 2) {
          circle(ctx, bx + 0.13, y + 0.33, 0.13, "rgba(220, 150, 60, 0.9)");
          circle(ctx, bx + 0.13, y + 0.33, 0.08, "#8d4a1f");
        }
      }
      break;
    }
    case "chest": {
      const t = block(ctx, x, y, w, h, "#e8eef0", "#a5b3b8", 0.36);
      line(ctx, t.x + 0.1, t.y + t.h / 2, t.x + t.w - 0.1, t.y + t.h / 2, "#b9c6cb", 0.04);
      rect(ctx, x + w / 2 - 0.25, y + t.h - 0.12, 0.5, 0.08, "#6f7d82");
      break;
    }
    case "generator": {
      const t = block(ctx, x, y, w, h, "#3b4449", "#1d2226", 0.5);
      hazardStripes(ctx, t.x, t.y, t.w, 0.16);
      circle(ctx, x + w / 2, t.y + t.h / 2 + 0.08, 0.72, "#15191c");
      ctx.strokeStyle = "#4f5a61";
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(x + w / 2, t.y + t.h / 2 + 0.08, 0.72, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        line(ctx, x + w / 2, t.y + t.h / 2 + 0.08, x + w / 2 + Math.cos(a) * 0.62, t.y + t.h / 2 + 0.08 + Math.sin(a) * 0.62, "#3a444a", 0.1);
      }
      for (let i = 0; i < 5; i++) rect(ctx, x + 0.2 + i * 0.12, y + h - 0.35, 0.06, 0.18, "#101315");
      break;
    }
    case "transformer": {
      const t = block(ctx, x, y, w, h, "#4a4f45", "#262922", 0.42);
      for (let i = 0; i < 3; i++) {
        circle(ctx, t.x + 0.5 + i, t.y + t.h / 2, 0.32, "#6c6453");
        circle(ctx, t.x + 0.5 + i, t.y + t.h / 2, 0.16, "#b87333");
      }
      worldText(ctx, "HIGH VOLTAGE", x + w / 2, y + h - 0.2, 0.16, { color: COLORS.yellow, font: "Roboto Mono, monospace" });
      break;
    }
    case "frostrack": {
      block(ctx, x, y, w, h, "#9fb7c1", "#5b7580", 0.3);
      for (let i = 0; i < Math.max(w, h) * 2; i++) {
        const along = w >= h;
        const bx = along ? x + 0.1 + i * 0.5 : x + 0.12;
        const by = along ? y + 0.12 : y + 0.1 + i * 0.5;
        rect(ctx, bx, by, along ? 0.38 : w - 0.24, along ? h - 0.48 : 0.38, hash(x, y, i) < 0.5 ? "#d8e6ec" : "#c3d6de");
      }
      rect(ctx, x, y, w, h * 0.2, "rgba(255, 255, 255, 0.35)");
      break;
    }
    case "icepillar": {
      ctx.beginPath();
      ctx.ellipse(x + 0.55, y + 0.8, 0.5, 0.22, 0, 0, TAU);
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fill();
      ctx.beginPath();
      const pts = [[0.5, 0.02], [0.92, 0.28], [0.85, 0.82], [0.5, 0.98], [0.12, 0.8], [0.08, 0.3]];
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
      ctx.closePath();
      ctx.fillStyle = "#9fd4ea";
      ctx.fill();
      ctx.strokeStyle = "#e8f8ff";
      ctx.lineWidth = 0.04;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 0.5, y + 0.02);
      ctx.lineTo(x + 0.5, y + 0.98);
      ctx.moveTo(x + 0.08, y + 0.3);
      ctx.lineTo(x + 0.92, y + 0.28);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 0.025;
      ctx.stroke();
      break;
    }
    case "compressor": {
      const t = block(ctx, x, y, w, h, "#56666e", "#2c373d", 0.5);
      hazardStripes(ctx, t.x, t.y, 0.16, t.h);
      const cx = x + w / 2 + 0.1;
      for (const cy of [y + 1.1, y + 2.9]) {
        circle(ctx, cx, cy, 0.85, "#1a2226");
        ctx.strokeStyle = "#7b8c95";
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.arc(cx, cy, 0.85, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, 0.7, a, a + 0.6);
          ctx.closePath();
          ctx.fillStyle = "#3a474e";
          ctx.fill();
        }
        circle(ctx, cx, cy, 0.14, "#7b8c95");
      }
      rect(ctx, x, y, w, 0.3, "rgba(230, 248, 255, 0.55)");
      break;
    }
    case "workbench": {
      const t = block(ctx, x, y, w, h, "#8a6a45", "#523b24", 0.34);
      // Abandoned tools, a radio, a thermos.
      rect(ctx, t.x + 0.3, t.y + 0.15, 0.6, 0.3, "#3b3f36");
      circle(ctx, t.x + 0.45, t.y + 0.3, 0.08, "#8a8f7c");
      rect(ctx, t.x + 0.75, t.y + 0.1, 0.03, 0.2, "#aaa");
      line(ctx, t.x + 1.4, t.y + 0.2, t.x + 1.9, t.y + 0.45, "#b0b6ba", 0.06);
      circle(ctx, t.x + 1.4, t.y + 0.2, 0.07, "#b0b6ba");
      circle(ctx, t.x + 2.7, t.y + 0.3, 0.14, "#2e6b4f");
      circle(ctx, t.x + 2.7, t.y + 0.3, 0.07, "#1c3f2f");
      rect(ctx, t.x + 3.1, t.y + 0.1, 0.55, 0.38, "#e8e1cf");
      break;
    }
    case "toolchest": {
      const t = block(ctx, x, y, w, h, "#a83a2c", "#6d2219", 0.42);
      for (let i = 0; i < 3; i++) rect(ctx, x + 0.1, y + h - 0.38 + i * 0.12, w - 0.2, 0.03, "#d8d8d8");
      rect(ctx, t.x + 0.2, t.y + 0.15, 0.5, 0.12, "#d8d8d8");
      break;
    }
    case "heater": {
      block(ctx, x + 0.08, y + 0.08, w - 0.16, h - 0.16, "#5a5550", "#34302c", 0.3);
      for (let i = 0; i < 4; i++) rect(ctx, x + 0.2, y + 0.18 + i * 0.1, 0.6, 0.04, "#1c1a18");
      break;
    }
    case "cot": {
      rect(ctx, x + 0.1, y + h - 0.05, w - 0.2, 0.14, "rgba(0, 0, 0, 0.3)");
      roundRect(ctx, x + 0.05, y + 0.15, w - 0.1, h - 0.3, 0.1);
      ctx.fillStyle = "#4d5a3c";
      ctx.fill();
      roundRect(ctx, x + 0.15, y + 0.28, 0.6, h - 0.56, 0.12);
      ctx.fillStyle = "#c9c2ad";
      ctx.fill();
      rect(ctx, x + 1, y + 0.2, w - 1.1, h - 0.4, "#6b7a4f");
      for (let i = 0; i < 4; i++) rect(ctx, x + 1.2 + i * 0.45, y + 0.2, 0.05, h - 0.4, "rgba(0, 0, 0, 0.2)");
      break;
    }
    case "locker": {
      const t = block(ctx, x, y, w, h, "#5d6b74", "#36424a", 0.3);
      line(ctx, t.x + 0.1, t.y + t.h / 2, t.x + t.w - 0.1, t.y + t.h / 2, "#28323a", 0.04);
      for (let i = 0; i < 3; i++) rect(ctx, t.x + 0.2, t.y + 0.15 + i * 0.1, 0.6, 0.03, "#28323a");
      break;
    }
    case "pipe": {
      const along = w >= h;
      const g = along ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, "#9ab8c4");
      g.addColorStop(0.45, "#dff3fb");
      g.addColorStop(1, "#4f6c78");
      ctx.fillStyle = g;
      roundRect(ctx, x, y + (along ? 0.1 : 0), w, h - (along ? 0.2 : 0), 0.35);
      ctx.fill();
      for (let i = 0.5; i < (along ? w : h); i += 1) {
        if (along) rect(ctx, x + i, y + 0.06, 0.12, h - 0.12, "#6d8a96");
        else rect(ctx, x + 0.06, y + i, w - 0.12, 0.12, "#6d8a96");
      }
      break;
    }
    case "coil": {
      circle(ctx, x + 0.55, y + 0.62, 0.5, "rgba(0, 0, 0, 0.35)");
      circle(ctx, x + 0.5, y + 0.5, 0.46, "#2b3a44");
      circle(ctx, x + 0.5, y + 0.5, 0.34, "#3f5563");
      circle(ctx, x + 0.5, y + 0.5, 0.16, "#1a242b");
      break;
    }
    case "console": {
      const t = block(ctx, x, y, w, h, "#2f3a42", "#172026", 0.36);
      rect(ctx, t.x + 0.12, t.y + 0.1, t.w - 0.24, t.h - 0.2, "#0a1216");
      break;
    }
    case "core": {
      // Base plate only; the core itself is live art (drawCore).
      circle(ctx, x + 1.5, y + 1.5, 1.95, "#0c1318");
      ctx.strokeStyle = "#2c4250";
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(x + 1.5, y + 1.5, 1.95, 0, TAU);
      ctx.stroke();
      break;
    }
    default:
      block(ctx, x, y, w, h, "#555", "#333");
  }
}

// ------------------------------------------------------------------ static decals

/** Floor stencils, markings and fixtures that never change. Drawn once into the floor cache. */
export function drawDecals(ctx, map) {
  // Room stencils.
  const stencil = (text, x, y, size, color = "rgba(255, 212, 0, 0.16)", rotate = 0) => worldText(ctx, text, x, y, size, { color, spacing: 0.12, rotate });
  stencil("FOOD STORAGE", 33, 22.5, 0.9, "rgba(40, 60, 70, 0.18)");
  stencil("POWER", 34.5, 61.8, 1.2);
  stencil("FREEZER", 60, 50.3, 1, "rgba(255, 255, 255, 0.28)");
  stencil("CORE", 19.5, 87.3, 0.9, "rgba(127, 224, 255, 0.2)");
  stencil("TECHNICIAN OUTPOST", 70.5, 71.6, 0.45, "rgba(255, 212, 0, 0.25)");
  stencil("CPI // CPST", 34.5, 39.8, 0.4, "rgba(255, 212, 0, 0.2)");

  // Central passage: a yellow guide line on the grate and direction stencils.
  ctx.strokeStyle = "rgba(255, 212, 0, 0.28)";
  ctx.lineWidth = 0.08;
  ctx.setLineDash([0.5, 0.3]);
  ctx.beginPath();
  ctx.moveTo(22, 43.5);
  ctx.lineTo(49.5, 43.5);
  ctx.moveTo(34.5, 47.8);
  ctx.lineTo(34.5, 43.5);
  ctx.moveTo(33.5, 38.5);
  ctx.lineTo(33.5, 34);
  ctx.lineTo(37.5, 34);
  ctx.lineTo(37.5, 29);
  ctx.stroke();
  ctx.setLineDash([]);
  stencil("STORAGE ↑", 35.9, 38.2, 0.32, "rgba(255, 212, 0, 0.35)");
  stencil("FREEZER →", 45.5, 42.3, 0.32, "rgba(255, 212, 0, 0.35)");
  stencil("POWER ↓", 36.8, 47.3, 0.32, "rgba(255, 212, 0, 0.35)");

  // Technician markings: chevrons from the freezer hatch down to the outpost.
  const chevrons = [[62.95, 54.5, 90], [62.95, 56.2, 90], [64.5, 57.95, 0], [66.5, 57.95, 0], [68.2, 57.95, 0], [69.95, 59.6, 90], [69.95, 61.4, 90]];
  for (const [cx, cy, deg] of chevrons) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(-0.25, -0.35);
    ctx.lineTo(0.15, 0);
    ctx.lineTo(-0.25, 0.35);
    ctx.strokeStyle = "rgba(255, 212, 0, 0.75)";
    ctx.lineWidth = 0.12;
    ctx.stroke();
    ctx.restore();
  }
  stencil("CPI TECH →", 66, 57.3, 0.26, "rgba(255, 212, 0, 0.6)");

  // Power room: the cable trench, and stripes in front of the machines.
  ctx.fillStyle = "#0b0d0f";
  ctx.fillRect(26, 60.12, 17, 0.76);
  for (let x = 26; x < 43; x += 0.5) {
    ctx.fillStyle = hash(x * 2, 60) < 0.5 ? "#2e2016" : "#1c2a30";
    ctx.fillRect(x + 0.05, 60.3, 0.4, 0.12);
    ctx.fillRect(x + 0.1, 60.55, 0.4, 0.1);
  }
  hazardStripes(ctx, 26, 59.95, 17, 0.14, 0.9);
  hazardStripes(ctx, 26, 60.9, 17, 0.12, 0.9);
  hazardStripes(ctx, 33, 63.72, 3, 0.2, 0.8);

  // Food storage: spilled milk by the shelves.
  for (const [sx, sy, r] of [[28.2, 19.3, 0.5], [37.4, 25.6, 0.42], [25.2, 22.6, 0.35]]) {
    circle(ctx, sx, sy, r, "rgba(246, 244, 236, 0.75)");
    circle(ctx, sx + r * 0.9, sy + r * 0.3, r * 0.35, "rgba(246, 244, 236, 0.75)");
    circle(ctx, sx - r * 0.3, sy - r * 0.35, r * 0.18, "rgba(255, 255, 255, 0.8)");
  }

  // Frost vent grilles in the deep interior.
  for (const hz of map.hazards) {
    if (hz.kind !== "vent") continue;
    circle(ctx, hz.x, hz.y, 0.62, "#0d151b");
    ctx.strokeStyle = "#51748a";
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(hz.x, hz.y, 0.62, 0, TAU);
    ctx.stroke();
    for (let i = -2; i <= 2; i++) rect(ctx, hz.x - 0.45, hz.y + i * 0.2 - 0.03, 0.9, 0.06, "#2e4758");
  }

  // Checkpoint pads.
  for (const cp of map.checkpoints) {
    circle(ctx, cp.x, cp.y, 0.62, "#15191c");
    ctx.strokeStyle = "rgba(255, 212, 0, 0.35)";
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      const px = cp.x + Math.cos(a) * 0.5;
      const py = cp.y + Math.sin(a) * 0.5;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // The core room: engraved rings and cables to the coils.
  ctx.strokeStyle = "rgba(90, 200, 255, 0.12)";
  ctx.lineWidth = 0.05;
  for (const r of [2.6, 4.4, 5.6]) {
    ctx.beginPath();
    ctx.arc(map.core.x, map.core.y, r, 0, TAU);
    ctx.stroke();
  }
  for (const o of map.obstacles) {
    if (o.kind !== "coil" && o.kind !== "console") continue;
    line(ctx, map.core.x, map.core.y, o.x + o.w / 2, o.y + o.h / 2, "rgba(40, 70, 90, 0.9)", 0.12);
  }

  // Dropped technician gear along the way.
  const litter = [[66.2, 55.5, "wrench"], [57.5, 71.5, "clipboard"], [45.5, 78.5, "light"], [35.2, 90.5, "wrench"], [74.2, 67.8, "clipboard"]];
  for (const [lx, ly, kind] of litter) {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(hash(Math.floor(lx * 10), Math.floor(ly * 10)) * TAU);
    if (kind === "wrench") {
      rect(ctx, -0.3, -0.04, 0.5, 0.08, "#9aa3a8");
      circle(ctx, 0.25, 0, 0.09, "#9aa3a8");
      circle(ctx, 0.27, 0, 0.04, "#1a1a1a");
    } else if (kind === "clipboard") {
      rect(ctx, -0.2, -0.26, 0.4, 0.52, "#a07850");
      rect(ctx, -0.16, -0.2, 0.32, 0.42, "#eee8d8");
    } else {
      rect(ctx, -0.25, -0.06, 0.4, 0.12, "#2a2a2a");
      rect(ctx, 0.15, -0.09, 0.1, 0.18, "#ffd400");
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------ doors

export function drawDoor(ctx, def, door, time, extra = {}) {
  const { x, y, w, h } = def;
  const horizontal = w >= h;
  const open = door ? door.open : 0;
  const ease = open * open * (3 - 2 * open);
  const statusColor = door?.unlocked ? COLORS.green : COLORS.red;
  if (def.kind === "fridge") return drawFridge(ctx, def, ease, time);
  if (def.kind === "fridgeInner") return drawFridgeInner(ctx, def, ease, time, door?.unlocked);
  if (def.kind === "sealed") {
    rect(ctx, x, y, w, h, "#7a5c3c");
    rect(ctx, x + 0.08, y, w - 0.16, h * 0.55, "#94704a");
    circle(ctx, x + w - 0.3, y + 0.35, 0.06, "#d8c8a0");
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 0.2, y - 0.1, w + 0.4, h + 0.2);
    ctx.clip();
    for (const dir of [1, -1]) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(dir * 0.35);
      hazardStripes(ctx, -w / 2 - 0.2, -0.09, w + 0.4, 0.18);
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  // Door frame.
  rect(ctx, x, y, w, h, "#0c0f11");
  const lift = def.kind === "lift";
  const frozen = def.kind === "frozen";
  const hatch = def.kind === "hatch";
  const panelColor = lift ? "#5a6670" : hatch ? "#47535b" : frozen ? "#4b5a62" : "#56626b";
  // Two halves slide apart along the door's length.
  const len = horizontal ? w : h;
  const halfLen = (len / 2) * (1 - ease * 0.92);
  const thick = horizontal ? h : w;
  const drawHalf = (from, dir) => {
    const start = dir > 0 ? from : from - halfLen;
    if (horizontal) {
      rect(ctx, x + start, y + 0.12 * thick, halfLen, thick * 0.76, panelColor);
      rect(ctx, x + start, y + 0.12 * thick, halfLen, 0.05, "rgba(255, 255, 255, 0.2)");
      if (!lift) hazardStripes(ctx, dir > 0 ? x + start + halfLen - 0.12 : x + start, y + 0.12 * thick, Math.min(0.12, halfLen), thick * 0.76);
    } else {
      rect(ctx, x + 0.12 * thick, y + start, thick * 0.76, halfLen, panelColor);
      rect(ctx, x + 0.12 * thick, y + start, 0.05, halfLen, "rgba(255, 255, 255, 0.2)");
      if (!lift) hazardStripes(ctx, x + 0.12 * thick, dir > 0 ? y + start + halfLen - 0.12 : y + start, thick * 0.76, Math.min(0.12, halfLen));
    }
  };
  drawHalf(0, 1);
  drawHalf(len, -1);
  if (hatch && ease < 0.5) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.strokeStyle = "#9aa7ae";
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.arc(cx, cy, 0.3, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + time * 0;
      line(ctx, cx, cy, cx + Math.cos(a) * 0.3, cy + Math.sin(a) * 0.3, "#9aa7ae", 0.05);
    }
  }
  if (frozen) {
    const thaw = extra.thaw ?? 0;
    if (!door?.unlocked) {
      // Encased in ice that shrinks as the loop warms.
      const a = 0.85 * (1 - thaw);
      rect(ctx, x - 0.15, y - 0.25, w + 0.3, h + 0.5, `rgba(190, 235, 255, ${a})`);
      ctx.strokeStyle = `rgba(255, 255, 255, ${a})`;
      ctx.lineWidth = 0.04;
      for (let i = 0; i < 5; i++) line(ctx, x + hash(i, 1) * w, y - 0.2, x + hash(i, 2) * w, y + h + 0.2, `rgba(255, 255, 255, ${a * 0.7})`, 0.03);
      if (thaw > 0) {
        for (let i = 0; i < 6; i++) {
          const dx = x + 0.2 + i * 0.5;
          const drip = ((time * 0.8 + hash(i, 3)) % 1) * 0.6;
          circle(ctx, dx, y + h + 0.1 + drip, 0.04, "rgba(200, 240, 255, 0.8)");
        }
      }
    }
  }
  // Status light.
  const lx = horizontal ? x + w + 0.18 : x + 0.5;
  const ly = horizontal ? y + 0.5 : y - 0.18;
  circle(ctx, lx, ly, 0.09, "#111");
  circle(ctx, lx, ly, 0.06, statusColor);
  if (lift) {
    worldText(ctx, "LIFT", horizontal ? x + w / 2 : x + 0.5, horizontal ? y + 0.5 : y + h / 2, 0.22, { color: door?.unlocked ? COLORS.green : "#9aa7ae", rotate: horizontal ? 0 : -Math.PI / 2 });
  }
}

function drawFridge(ctx, def, ease, time) {
  const { x, y, w, h } = def;
  const face = 0.34;
  // Housing: the top of an ordinary white refrigerator, magnets and all.
  rect(ctx, x + 0.06, y + h - 0.02, w - 0.04, 0.12, "rgba(0, 0, 0, 0.28)");
  rect(ctx, x, y, w, h - face, "#f4f6f6");
  rect(ctx, x, y, w, 0.05, "#ffffff");
  circle(ctx, x + 0.4, y + 0.25, 0.06, "#e74c3c");
  circle(ctx, x + 1.5, y + 0.3, 0.06, "#3498db");
  if (ease < 0.02) {
    const g = ctx.createLinearGradient(0, y + h - face, 0, y + h);
    g.addColorStop(0, "#d5dcdf");
    g.addColorStop(1, "#aeb8bc");
    ctx.fillStyle = g;
    ctx.fillRect(x, y + h - face, w, face);
    rect(ctx, x + w - 0.3, y + h - face + 0.06, 0.06, face - 0.12, "#8a959a");
    // Containment tape across the door.
    ctx.save();
    ctx.translate(x + w / 2, y + h - face / 2);
    ctx.rotate(-0.06);
    hazardStripes(ctx, -w / 2 - 0.12, -0.06, w + 0.24, 0.12);
    ctx.restore();
    return;
  }
  // Open: the front is a glowing aperture that is far deeper than the unit.
  const g = ctx.createRadialGradient(x + w / 2, y + h * 0.35, 0.05, x + w / 2, y + h * 0.35, w * 0.7);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.45, "#dff6ff");
  g.addColorStop(1, "#8fd3ef");
  ctx.fillStyle = g;
  ctx.fillRect(x + 0.1, y + 0.1, w - 0.2, h - 0.1);
  ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time * 3);
  rect(ctx, x + 0.1, y + 0.1, w - 0.2, h - 0.1, "#bfeaff");
  ctx.globalAlpha = 1;
  for (let i = 0; i < 3; i++) rect(ctx, x + 0.25 + i * 0.08, y + 0.22 + i * 0.2, w - 0.5 - i * 0.16, 0.03, "rgba(120, 170, 190, 0.55)");
  // The door swings out into the kitchen from its left hinge.
  ctx.save();
  ctx.translate(x, y + h);
  ctx.rotate(ease * 1.75);
  rect(ctx, 0.02, 0.02, w, 0.18, "rgba(0, 0, 0, 0.25)");
  rect(ctx, 0, -0.02, w, 0.18, "#eef2f3");
  rect(ctx, 0, -0.02, w, 0.04, "#ffffff");
  rect(ctx, 0.15, 0.14, w - 0.3, 0.1, "#cbd5d9");
  rect(ctx, w - 0.4, -0.12, 0.28, 0.08, "#9aa5aa");
  ctx.restore();
}

function drawFridgeInner(ctx, def, ease, time, unlocked) {
  const { x, y, w, h } = def;
  if (ease > 0.02) {
    // The kitchen's warm light through the doorway.
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#fff2d6");
    g.addColorStop(1, "#ffd9a0");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  // The inside of the refrigerator door, far too big: door shelves with a giant bottle and jar.
  const shift = ease * (w + 0.4);
  ctx.save();
  ctx.translate(-shift, 0);
  rect(ctx, x - 0.4, y - 0.05, w + 0.8, h + 0.05, "#e3ecef");
  rect(ctx, x - 0.4, y + 0.05, w + 0.8, 0.14, "#c2d2d8");
  circle(ctx, x + 0.3, y + 0.55, 0.22, "#6aa84f");
  rect(ctx, x + 0.9, y + 0.35, 0.7, 0.4, "#f1e3b0");
  rect(ctx, x + 0.9, y + 0.35, 0.7, 0.1, "#c0392b");
  ctx.restore();
  circle(ctx, x + w + 0.2, y + 0.5, 0.08, unlocked ? COLORS.green : COLORS.red);
}

// ------------------------------------------------------------------ stations (wall fixtures)

export function drawStation(ctx, st, s, time) {
  const f = s.flags;
  const done = Boolean(f.done[st.id]);
  const blink = Math.sin(time * 6) > 0;
  switch (st.id) {
    case "thermostat": {
      const x = st.x - 0.55;
      const y = st.y - 0.95;
      block(ctx, x, y, 1.1, 0.62, "#27323a", "#161d22", 0.2);
      rect(ctx, x + 0.12, y + 0.08, 0.86, 0.28, "#041016");
      const sp = s.setpoint;
      const color = sp >= 7 ? COLORS.red : sp >= 2 ? COLORS.green : COLORS.cyan;
      worldText(ctx, `${sp > 0 ? "+" : ""}${sp}°`, x + 0.55, y + 0.22, 0.2, { color, font: "Roboto Mono, monospace" });
      break;
    }
    case "breakerA":
    case "breakerB":
    case "breakerC": {
      const { x, y } = mountPoint(st, 0.7);
      block(ctx, x - 0.4, y - 0.35, 0.8, 0.7, "#3a434a", "#20262b", 0.2);
      rect(ctx, x - 0.3, y - 0.27, 0.6, 0.36, "#11161a");
      const on = done;
      rect(ctx, x - 0.06, on ? y - 0.25 : y - 0.05, 0.12, 0.18, on ? COLORS.green : COLORS.red);
      worldText(ctx, st.id.slice(-1), x + 0.22, y - 0.18, 0.16, { color: COLORS.yellow, font: "Roboto Mono, monospace" });
      break;
    }
    case "mainbus": {
      const x = st.x;
      const y = st.y + 0.55;
      block(ctx, x - 0.9, y - 0.45, 1.8, 0.62, "#353c42", "#1c2024", 0.2);
      for (let i = 0; i < 3; i++) {
        const lit = f.powerRestored || (s.panel?.id === "mainbus" && (s.panel.hits ?? 0) > i);
        circle(ctx, x - 0.5 + i * 0.5, y - 0.25, 0.1, lit ? COLORS.green : f.current ? (blink ? "#7a5c00" : "#3a2c00") : "#2a1210");
      }
      rect(ctx, x - 0.08, y - 0.4, 0.16, 0.3, f.powerRestored ? COLORS.green : COLORS.yellow);
      break;
    }
    case "valve1":
    case "valve2":
    case "valve3": {
      const { x, y } = mountPoint(st, 0.62);
      line(ctx, x, y - 0.4, x, y + 0.4, "#6c7a82", 0.16);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(done ? 1.2 : 0);
      ctx.strokeStyle = done ? "#c23b2a" : "#9b2e21";
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(0, 0, 0.3, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 3; i++) line(ctx, 0, 0, Math.cos((i * TAU) / 3) * 0.3, Math.sin((i * TAU) / 3) * 0.3, "#9b2e21", 0.05);
      ctx.restore();
      if (!done) {
        circle(ctx, x, y, 0.42, "rgba(210, 240, 255, 0.55)");
        circle(ctx, x - 0.12, y - 0.1, 0.1, "rgba(255, 255, 255, 0.7)");
      } else circle(ctx, x + 0.35, y - 0.3, 0.07, COLORS.green);
      break;
    }
    case "compressor": {
      const on = f.coolingRepaired;
      rect(ctx, st.x + 0.35, st.y - 0.5, 0.3, 1, "#0a1216");
      rect(ctx, st.x + 0.4, st.y - 0.4, 0.2, 0.8 * (on ? 1 : 0.2 + 0.1 * Math.sin(time * 3)), on ? COLORS.cyan : COLORS.red);
      break;
    }
    case "locker": {
      if (f.lockerOpened) rect(ctx, st.x + 0.25, st.y - 0.75, 0.12, 0.7, "#8a99a2");
      circle(ctx, st.x + 0.45, st.y - 0.95, 0.07, f.outpostFound ? COLORS.green : COLORS.red);
      break;
    }
    case "console": {
      const x = st.x - 1;
      const y = st.y + 0.62;
      const stage = f.coreStage;
      for (let i = 0; i < 3; i++) {
        const lit = stage > i + 1 || f.coreStabilized;
        rect(ctx, x + 0.25 + i * 0.52, y + 0.1, 0.4, 0.2, lit ? "#1d6b52" : stage === i + 1 ? (blink ? "#6b5b10" : "#2b2508") : "#131b20");
      }
      break;
    }
    case "lamp1":
    case "lamp2":
    case "lamp3":
    case "lamp4": {
      const on = done;
      circle(ctx, st.x + 0.05, st.y + 0.1, 0.32, "rgba(0, 0, 0, 0.35)");
      circle(ctx, st.x, st.y, 0.3, "#3b3530");
      circle(ctx, st.x, st.y, 0.2, on ? "#ffbf66" : "#57504a");
      if (on) circle(ctx, st.x, st.y, 0.1, "#fff4d6");
      break;
    }
    case "coil1":
    case "coil2":
    case "coil3": {
      const o = s.map.obstacles.find((b) => b.kind === "coil" && Math.hypot(b.x + 0.5 - st.x, b.y + 0.5 - st.y) < 1.3);
      if (!o) break;
      const cx = o.x + 0.5;
      const cy = o.y + 0.5;
      const lit = done;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * (lit ? 2.5 : 0.3));
      ctx.strokeStyle = lit ? COLORS.cyan : "#44606e";
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(0, 0, 0.3, 0, Math.PI * 1.3);
      ctx.stroke();
      ctx.restore();
      circle(ctx, cx, cy, 0.12, lit ? "#dffbff" : "#20303a");
      break;
    }
    default:
      break;
  }
}

/** A point on the wall the station is mounted on (the fixture sits against it). */
function mountPoint(st, depth) {
  switch (st.face) {
    case "n":
      return { x: st.x, y: st.y - depth };
    case "s":
      return { x: st.x, y: st.y + depth };
    case "w":
      return { x: st.x - depth, y: st.y };
    case "e":
      return { x: st.x + depth, y: st.y };
    default:
      return { x: st.x, y: st.y };
  }
}

// ------------------------------------------------------------------ the agent

/**
 * A CPST agent seen from above: cold-weather suit in CPI yellow, pack behind, visor toward
 * `facing`. `walk` is a phase for the arm swing; `cold` 0..1 frosts the suit.
 */
export function drawAgent(ctx, x, y, facing, { walk = 0, moving = false, cold = 0, hurt = 0, scale = 1, suit = COLORS.suit } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.ellipse(0.04, 0.1, 0.36, 0.26, 0, 0, TAU);
  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.fill();
  ctx.rotate(facing);
  const swing = moving ? Math.sin(walk) * 0.12 : 0;
  // Pack.
  roundRect(ctx, -0.38, -0.2, 0.2, 0.4, 0.06);
  ctx.fillStyle = "#3f454b";
  ctx.fill();
  rect(ctx, -0.36, -0.06, 0.16, 0.12, "#6b737a");
  // Arms.
  circle(ctx, 0.02 + swing, -0.27, 0.1, shadeHex(suit, -0.25));
  circle(ctx, 0.02 - swing, 0.27, 0.1, shadeHex(suit, -0.25));
  circle(ctx, 0.1 + swing * 1.5, -0.3, 0.06, "#2b2f33");
  circle(ctx, 0.1 - swing * 1.5, 0.3, 0.06, "#2b2f33");
  // Body.
  circle(ctx, 0, 0, 0.29, suit);
  ctx.strokeStyle = shadeHex(suit, -0.45);
  ctx.lineWidth = 0.035;
  ctx.stroke();
  // CPI stripe across the shoulders.
  rect(ctx, -0.05, -0.29, 0.07, 0.58, "rgba(20, 20, 20, 0.55)");
  // Hood and visor.
  circle(ctx, 0.05, 0, 0.17, shadeHex(suit, -0.12));
  ctx.beginPath();
  ctx.ellipse(0.13, 0, 0.1, 0.15, 0, -Math.PI / 2, Math.PI / 2);
  ctx.fillStyle = "#6fd6f5";
  ctx.fill();
  circle(ctx, 0.15, -0.06, 0.035, "rgba(255, 255, 255, 0.85)");
  if (cold > 0.05) {
    ctx.globalAlpha = Math.min(1, cold);
    for (let i = 0; i < 7; i++) circle(ctx, Math.cos(i * 2.4) * 0.2, Math.sin(i * 2.4) * 0.2, 0.035 + (i % 3) * 0.01, "rgba(235, 250, 255, 0.95)");
    ctx.globalAlpha = 1;
  }
  if (hurt > 0) {
    ctx.globalAlpha = hurt;
    circle(ctx, 0, 0, 0.31, "#ffffff");
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function shadeHex(hex, amount) {
  return shade(hex, amount);
}

// ------------------------------------------------------------------ food threats

/** A milk carton seen from above: gable top, blue band, and eyes once it is awake. */
export function drawMilk(ctx, t, time) {
  const frozen = t.temper === "FROZEN";
  const spoiled = t.temper === "SPOILED";
  const active = t.mode === "chase" || t.mode === "curious";
  const hop = frozen ? 0 : Math.abs(Math.sin(time * (active ? 9 : 3) + t.x)) * (active ? 0.08 : 0.03);
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.beginPath();
  ctx.ellipse(0.03, 0.14, 0.3, 0.16, 0, 0, TAU);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fill();
  if (spoiled) {
    // A sour puddle and stink.
    ctx.beginPath();
    ctx.ellipse(0, 0.18, 0.42, 0.22, 0, 0, TAU);
    ctx.fillStyle = "rgba(210, 220, 120, 0.35)";
    ctx.fill();
  }
  ctx.translate(0, -hop);
  const sway = frozen ? 0 : Math.sin(time * 4 + t.y) * (active ? 0.18 : 0.06);
  ctx.rotate(sway);
  ctx.scale(1.18, 1.18);
  const body = spoiled ? "#e6e2b0" : frozen ? "#d9ecf3" : COLORS.milk;
  const w = spoiled ? 0.56 : 0.5;
  const h = 0.62;
  roundRect(ctx, -w / 2 - 0.035, -h / 2 - 0.035, w + 0.07, h + 0.07, 0.07);
  ctx.fillStyle = spoiled ? "#4a4a1a" : frozen ? "#2a5a70" : "#1c2830";
  ctx.fill();
  roundRect(ctx, -w / 2, -h / 2, w, h, 0.05);
  ctx.fillStyle = body;
  ctx.fill();
  // Gable roof: two faces and a ridge.
  ctx.fillStyle = spoiled ? "#cfca8f" : "#e3e1d7";
  ctx.fillRect(-w / 2, -h / 2, w / 2, h * 0.45);
  line(ctx, 0, -h / 2, 0, -h / 2 + h * 0.45, "#b9b6a8", 0.03);
  rect(ctx, -0.05, -h / 2 - 0.05, 0.1, 0.06, "#cfccc0");
  // Band.
  rect(ctx, -w / 2, h * 0.02, w, 0.14, spoiled ? "#7d8a3a" : "#2f6fb5");
  worldText(ctx, "MILK", 0, h * 0.09, 0.08, { color: "#ffffff", font: "Roboto Mono, monospace" });
  // Eyes.
  if (!frozen) {
    const eye = spoiled ? "#c0392b" : "#1b1b1b";
    const look = active ? 0.02 : 0;
    circle(ctx, -0.11, h * 0.3, 0.05, "#ffffff");
    circle(ctx, 0.11, h * 0.3, 0.05, "#ffffff");
    circle(ctx, -0.11 + look, h * 0.31, 0.028, eye);
    circle(ctx, 0.11 + look, h * 0.31, 0.028, eye);
    if (spoiled || active) {
      line(ctx, -0.17, h * 0.22, -0.05, h * 0.26, "#1b1b1b", 0.025);
      line(ctx, 0.17, h * 0.22, 0.05, h * 0.26, "#1b1b1b", 0.025);
    }
  } else {
    rect(ctx, -w / 2, -h / 2, w, h, "rgba(170, 225, 250, 0.35)");
    for (let i = 0; i < 4; i++) circle(ctx, Math.cos(i * 1.9) * 0.18, Math.sin(i * 1.9) * 0.24, 0.03, "#ffffff");
  }
  ctx.restore();
}

/** A neapolitan ice cream brick: soft and dripping when warm, sharp and frosted when hard. */
export function drawIceCream(ctx, t, time) {
  const soft = t.temper === "SOFT";
  const windup = t.mode === "windup";
  const lunge = t.mode === "lunge";
  const stun = t.mode === "stun";
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.beginPath();
  ctx.ellipse(0.04, 0.16, 0.44, 0.22, 0, 0, TAU);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fill();
  if (soft) {
    ctx.beginPath();
    ctx.ellipse(0, 0.2, 0.55, 0.26, 0, 0, TAU);
    ctx.fillStyle = "rgba(240, 190, 200, 0.4)";
    ctx.fill();
  }
  if (windup) {
    // Telegraph: a red line along the aim.
    const k = Math.min(1, t.modeT / 0.55);
    ctx.strokeStyle = `rgba(255, 75, 58, ${0.35 + 0.5 * k})`;
    ctx.lineWidth = 0.08;
    ctx.setLineDash([0.18, 0.12]);
    line(ctx, 0, 0, t.aimX * 3.4, t.aimY * 3.4, `rgba(255, 75, 58, ${0.35 + 0.5 * k})`, 0.08);
    ctx.setLineDash([]);
    ctx.translate((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06);
  }
  if (lunge) {
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.25 / i;
      roundRect(ctx, -0.38 - t.aimX * i * 0.3, -0.3 - t.aimY * i * 0.3, 0.76, 0.6, 0.08);
      ctx.fillStyle = "#f3e5c0";
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const squash = soft ? 1 + Math.sin(time * 2 + t.x) * 0.04 : 1;
  ctx.scale(squash * 1.12, 1.12 / squash);
  roundRect(ctx, -0.42, -0.34, 0.84, 0.68, soft ? 0.16 : 0.07);
  ctx.fillStyle = soft ? "rgba(60, 30, 20, 0.55)" : "#16303c";
  ctx.fill();
  const w = 0.76;
  const h = 0.6;
  const stripes = ["#6b4226", "#f3e5c0", "#f2a0b5"];
  ctx.save();
  roundRect(ctx, -w / 2, -h / 2, w, h, soft ? 0.14 : 0.05);
  ctx.clip();
  for (let i = 0; i < 3; i++) rect(ctx, -w / 2 + (i * w) / 3, -h / 2, w / 3 + 0.01, h, stripes[i]);
  if (!soft) {
    rect(ctx, -w / 2, -h / 2, w, 0.1, "rgba(255, 255, 255, 0.55)");
    for (let i = 0; i < 5; i++) circle(ctx, -0.3 + i * 0.15, -0.2 + (i % 2) * 0.35, 0.03, "rgba(255, 255, 255, 0.9)");
  }
  ctx.restore();
  ctx.strokeStyle = soft ? "rgba(90, 50, 30, 0.5)" : "#e8f8ff";
  ctx.lineWidth = 0.035;
  roundRect(ctx, -w / 2, -h / 2, w, h, soft ? 0.14 : 0.05);
  ctx.stroke();
  if (soft) {
    for (let i = 0; i < 3; i++) {
      const dx = -0.25 + i * 0.25;
      const len = 0.08 + ((time * 0.5 + i * 0.37) % 1) * 0.16;
      rect(ctx, dx - 0.03, h / 2 - 0.02, 0.06, len, stripes[i]);
    }
  }
  // Eyes: cold and narrow.
  const eyeY = -0.02;
  const angry = !soft;
  circle(ctx, -0.14, eyeY, 0.05, angry ? "#1a1a1a" : "#3a2418");
  circle(ctx, 0.14, eyeY, 0.05, angry ? "#1a1a1a" : "#3a2418");
  if (angry) {
    circle(ctx, -0.14, eyeY, 0.022, windup || lunge ? COLORS.red : COLORS.cyan);
    circle(ctx, 0.14, eyeY, 0.022, windup || lunge ? COLORS.red : COLORS.cyan);
    line(ctx, -0.22, eyeY - 0.1, -0.07, eyeY - 0.05, "#1a1a1a", 0.03);
    line(ctx, 0.22, eyeY - 0.1, 0.07, eyeY - 0.05, "#1a1a1a", 0.03);
  }
  if (stun) {
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + (i * TAU) / 3;
      worldText(ctx, "✦", Math.cos(a) * 0.35, -0.42 + Math.sin(a) * 0.1, 0.16, { color: COLORS.frost });
    }
  }
  ctx.restore();
}

/** The missing technician at the outpost, by the heater. Frosted until the outpost is found. */
export function drawTechnician(ctx, x, y, found, time) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.ellipse(0.05, 0.14, 0.52, 0.34, 0, 0, TAU);
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.fill();
  // A folding stool, a thermos, and the technician on it, turned toward the heater (west).
  rect(ctx, 0.05, -0.34, 0.5, 0.68, "#3a3f44");
  circle(ctx, 0.5, 0.42, 0.1, "#2e6b4f");
  circle(ctx, 0.5, 0.42, 0.05, "#bfc6c9");
  ctx.rotate(Math.PI);
  ctx.scale(1.25, 1.25);
  roundRect(ctx, -0.12, -0.34, 0.52, 0.68, 0.16);
  ctx.fillStyle = "#56643e";
  ctx.fill();
  circle(ctx, 0, 0, 0.28, "#2f4a6b");
  ctx.strokeStyle = "#0f1a26";
  ctx.lineWidth = 0.04;
  ctx.stroke();
  // Arms around the knees.
  circle(ctx, 0.12, -0.24, 0.08, "#2a4262");
  circle(ctx, 0.12, 0.24, 0.08, "#2a4262");
  rect(ctx, -0.05, -0.27, 0.07, 0.54, COLORS.yellow);
  // Cap with a yellow badge.
  circle(ctx, 0.05, 0, 0.16, "#1c2d42");
  ctx.beginPath();
  ctx.ellipse(0.17, 0, 0.09, 0.15, 0, -Math.PI / 2, Math.PI / 2);
  ctx.fillStyle = "#15202e";
  ctx.fill();
  circle(ctx, 0.02, 0, 0.05, COLORS.yellow);
  ctx.restore();
  if (!found) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.65 + 0.1 * Math.sin(time * 2);
    circle(ctx, 0, 0, 0.42, "rgba(210, 240, 255, 0.25)");
    for (let i = 0; i < 11; i++) circle(ctx, Math.cos(i * 2.3) * 0.3, Math.sin(i * 2.3) * 0.3, 0.045, "#e8f8ff");
    ctx.restore();
  }
}

// ------------------------------------------------------------------ pickups, pads, hazards, core

export function drawPickup(ctx, item, time) {
  const bob = Math.sin(time * 3 + item.x) * 0.06;
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.beginPath();
  ctx.ellipse(0, 0.2, 0.25, 0.1, 0, 0, TAU);
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fill();
  ctx.translate(0, bob - 0.05);
  const ring = 0.36 + ((time * 0.8) % 1) * 0.2;
  ctx.strokeStyle = `rgba(255, 212, 0, ${0.6 * (1 - ((time * 0.8) % 1))})`;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.arc(0, 0, ring, 0, TAU);
  ctx.stroke();
  if (item.kind === "heatpack") {
    roundRect(ctx, -0.2, -0.16, 0.4, 0.32, 0.08);
    ctx.fillStyle = "#e0662c";
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.1 + i * 0.1, 0.08);
      ctx.quadraticCurveTo(-0.14 + i * 0.1, -0.02, -0.1 + i * 0.1, -0.1);
      ctx.strokeStyle = "#ffd6a0";
      ctx.lineWidth = 0.03;
      ctx.stroke();
    }
  } else {
    roundRect(ctx, -0.22, -0.17, 0.44, 0.34, 0.05);
    ctx.fillStyle = "#e8ebe5";
    ctx.fill();
    rect(ctx, -0.04, -0.12, 0.08, 0.24, COLORS.green);
    rect(ctx, -0.12, -0.04, 0.24, 0.08, COLORS.green);
    rect(ctx, -0.22, -0.17, 0.44, 0.05, COLORS.yellow);
  }
  ctx.restore();
}

export function drawCheckpointGlow(ctx, cp, status, time) {
  if (status === "locked") return;
  const active = status === "active";
  const pulse = 0.5 + 0.5 * Math.sin(time * (active ? 2 : 4));
  ctx.strokeStyle = active ? `rgba(143, 224, 96, ${0.5 + 0.4 * pulse})` : `rgba(255, 212, 0, ${0.3 + 0.4 * pulse})`;
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.arc(cp.x, cp.y, 0.5 + (active ? 0 : pulse * 0.08), 0, TAU);
  ctx.stroke();
  if (active) circle(ctx, cp.x, cp.y, 0.16, `rgba(143, 224, 96, ${0.4 + 0.3 * pulse})`);
}

export function drawHazard(ctx, hz, time) {
  if (hz.kind === "spark") {
    if (hz.state === "idle") return;
    const x0 = hz.x;
    const x1 = hz.x + hz.w;
    const y = hz.y + 0.5;
    if (hz.state === "warn") {
      ctx.fillStyle = `rgba(255, 212, 0, ${0.15 + 0.2 * (Math.sin(time * 40) > 0 ? 1 : 0)})`;
      ctx.fillRect(x0, hz.y + 0.1, hz.w, 0.8);
      for (let i = 0; i < hz.w * 2; i++) {
        if (Math.random() < 0.3) circle(ctx, x0 + Math.random() * hz.w, y + (Math.random() - 0.5) * 0.4, 0.03, "#fff3a0");
      }
    } else {
      ctx.fillStyle = "rgba(160, 220, 255, 0.28)";
      ctx.fillRect(x0, hz.y - 0.1, hz.w, 1.2);
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(x0, y);
        for (let px = x0; px <= x1; px += 0.25) ctx.lineTo(px, y + (Math.random() - 0.5) * 0.7);
        ctx.strokeStyle = k === 0 ? "#ffffff" : "rgba(140, 210, 255, 0.8)";
        ctx.lineWidth = k === 0 ? 0.05 : 0.09;
        ctx.stroke();
      }
    }
  } else {
    if (hz.state === "charge") {
      const k = ((time * 1.4) % 1) * 0.8;
      ctx.strokeStyle = `rgba(210, 240, 255, ${0.5 + 0.3 * k})`;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.r * (1 - k * 0.7), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([0.2, 0.15]);
      ctx.strokeStyle = "rgba(210, 240, 255, 0.35)";
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (hz.state === "blast") {
      const g = ctx.createRadialGradient(hz.x, hz.y, 0, hz.x, hz.y, hz.r);
      g.addColorStop(0, "rgba(255, 255, 255, 0.85)");
      g.addColorStop(0.7, "rgba(200, 240, 255, 0.5)");
      g.addColorStop(1, "rgba(200, 240, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, hz.r, 0, TAU);
      ctx.fill();
    }
  }
}

export function drawCore(ctx, s, time) {
  const { x, y } = s.map.core;
  const stable = s.flags.coreStabilized;
  const stage = s.flags.coreStage;
  const flicker = stable ? 1 : 0.75 + 0.25 * Math.sin(time * 13) * Math.sin(time * 5.3);
  // Housing.
  circle(ctx, x, y, 1.62, "#1d2b34");
  ctx.strokeStyle = "#5a7686";
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.arc(x, y, 1.62, 0, TAU);
  ctx.stroke();
  // Rotating coil arms.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(time * (stable ? 0.6 : 1.8));
  for (let i = 0; i < 6; i++) {
    ctx.rotate(TAU / 6);
    rect(ctx, 0.55, -0.08, 0.9, 0.16, i % 2 ? "#3a5563" : "#2c414d");
  }
  ctx.restore();
  // Heart.
  const g = ctx.createRadialGradient(x, y, 0, x, y, 1.1);
  g.addColorStop(0, stable ? "#e9fff4" : "#e9fbff");
  g.addColorStop(0.35, stable ? `rgba(143, 255, 196, ${flicker})` : `rgba(127, 224, 255, ${flicker})`);
  g.addColorStop(1, "rgba(20, 60, 80, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 1.1, 0, TAU);
  ctx.fill();
  if (!stable) {
    // Unstable arcs.
    ctx.strokeStyle = stage >= 3 ? "rgba(255, 110, 90, 0.9)" : "rgba(200, 245, 255, 0.8)";
    ctx.lineWidth = 0.04;
    for (let k = 0; k < 2; k++) {
      const a = time * 3 + k * 2.2;
      ctx.beginPath();
      ctx.arc(x, y, 1.25 + 0.1 * Math.sin(time * 9 + k), a, a + 1.2 + Math.sin(time * 4) * 0.5);
      ctx.stroke();
    }
  }
  // The hold ring and its progress.
  if (stage === 3) {
    const r = 3.4;
    ctx.setLineDash([0.3, 0.2]);
    ctx.strokeStyle = `rgba(255, 212, 0, ${0.55 + 0.25 * Math.sin(time * 5)})`;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = COLORS.green;
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + s.core.progress * TAU);
    ctx.stroke();
    for (const surge of s.core.surges) {
      ctx.strokeStyle = `rgba(200, 245, 255, ${Math.max(0, 0.85 - surge.r / 10)})`;
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.arc(x, y, surge.r, 0, TAU);
      ctx.stroke();
    }
  }
}
