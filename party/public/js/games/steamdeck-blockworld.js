// The Block World (Level 1 of Escape Thad's Steam Deck): what BLOCKCRAFT looks like, and how it comes
// apart. An original block-game pastiche: CPI's own terrain, village, villagers, mine and corruption,
// nobody's actual textures. Cosmetic and client-only, like the rest of steamdeck-scenery.js (which
// registers this theme): the collision rects in server/games/steamdeck/levels.ts decide everything.
//
// Painters get world units (the level is 6400 × 2000). Static layers are cached by the screens, so
// they can afford detail; the live layer runs every frame and skips anything off screen.

const EDGE = "#ffd400"; // every walkable top edge, in every level
const CELL = 20;
const MONO = '"Roboto Mono", ui-monospace, monospace';
const HEAD = '"Oswald", Arial, sans-serif';

const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

const vgrad = (ctx, y0, y1, a, b) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
};

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

const inView = (x, y, v, pad = 300) => !v || (x > v[0] - pad && x < v[0] + v[2] + pad && y > v[1] - pad && y < v[1] + v[3] + pad);

// ------------------------------------------------------------------ materials

const GRASS = { top: ["#5fb03e", "#56a236", "#68b947"], dirt: ["#8a5a32", "#7a4e2b", "#70472a"], stone: ["#7d7d7d", "#6e6e6e", "#858585"], deep: ["#505057", "#46464d"] };
// Corrupted chunks: the right shapes in the wrong colours.
const WRONG = { top: ["#ff6fd8", "#e85ac4", "#ff8ae0"], dirt: ["#3b76ff", "#2f63dc", "#4a82ff"], stone: ["#7affb0", "#62e89a", "#8dffc0"], deep: ["#1f1a3a", "#171230"] };
const SAND = { top: ["#e8d49a", "#dcc68a"], dirt: ["#c8b27a", "#bca46c"], stone: ["#9a9082", "#8c8274"], deep: ["#6a645c", "#5e5850"] };
const ORES = [
  ["#ffd400", "#8a6d00"], // kernelite: corn-coloured, obviously
  ["#4dd4ff", "#1c6a88"], // deckium
  ["#ff5a4a", "#7a2018"], // thaddite
];

/** Magenta and black: the texture that isn't there. */
function missing(ctx, x, y, w, h, size = CELL / 2) {
  for (let by = y; by < y + h; by += size) {
    for (let bx = x; bx < x + w; bx += size) {
      ctx.fillStyle = ((Math.floor((bx - x) / size) + Math.floor((by - y) / size)) % 2 ? "#0a0a0a" : "#f000c8");
      ctx.fillRect(bx, by, Math.min(size, x + w - bx), Math.min(size, y + h - by));
    }
  }
}

/** Grass on top, dirt, stone, then the deep stuff, in pixel blocks. `glitch` (0..1) swaps cells for missing texture. */
function voxel(ctx, [x, y, w, h], pal, seed, { dirtRows = 4, glitch = 0, grass = true } = {}) {
  for (let by = y, row = 0; by < y + h; by += CELL, row++) {
    for (let bx = x; bx < x + w; bx += CELL) {
      const n = hash(bx * 0.37 + by * 0.11 + seed);
      const cw = Math.min(CELL, x + w - bx);
      const ch = Math.min(CELL, y + h - by);
      if (glitch && hash(bx * 0.13 + by * 0.71 + seed * 3) < glitch) {
        missing(ctx, bx, by, cw, ch);
        continue;
      }
      const layer = row === 0 && grass ? pal.top : row <= dirtRows ? pal.dirt : row <= dirtRows + 18 ? pal.stone : pal.deep;
      ctx.fillStyle = layer[Math.floor(n * layer.length)];
      ctx.fillRect(bx, by, cw, ch);
      // A speck of texture in most blocks.
      if (n > 0.35) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
        ctx.fillRect(bx + 4 + Math.floor(n * 10), by + 4 + Math.floor(hash(n) * 10), 4, 4);
      }
      if (n < 0.12) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.fillRect(bx + 2 + Math.floor(hash(n + 1) * 12), by + 2, 4, 4);
      }
    }
  }
  if (grass) {
    // Grass hanging over the top row of dirt.
    ctx.fillStyle = pal.top[0];
    for (let bx = x; bx < x + w; bx += 5) if (hash(bx + seed) > 0.45) ctx.fillRect(bx, y + CELL, 5, 3 + Math.floor(hash(bx * 3) * 6));
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
  ctx.fillRect(x, y, 3, h);
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.fillRect(x + w - 4, y, 4, h);
  ctx.fillStyle = EDGE;
  ctx.fillRect(x, y, w, 3);
}

/** Cave stone, with ore in it. */
function stone(ctx, [x, y, w, h], seed, { top = true } = {}) {
  for (let by = y; by < y + h; by += CELL) {
    for (let bx = x; bx < x + w; bx += CELL) {
      const n = hash(bx * 0.29 + by * 0.17 + seed);
      ctx.fillStyle = by > 1900 ? (n > 0.5 ? "#3a3a40" : "#303036") : n > 0.66 ? "#6b6b72" : n > 0.33 ? "#62626a" : "#58585f";
      ctx.fillRect(bx, by, Math.min(CELL, x + w - bx), Math.min(CELL, y + h - by));
      if (n > 0.965) {
        const [ore, dark] = ORES[Math.floor(hash(n * 7) * ORES.length)];
        ctx.fillStyle = dark;
        ctx.fillRect(bx + 3, by + 3, 14, 14);
        ctx.fillStyle = ore;
        ctx.fillRect(bx + 4, by + 5, 5, 5);
        ctx.fillRect(bx + 10, by + 10, 5, 4);
      } else if (n < 0.1) {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(bx + 3, by + 11, 9, 3);
      }
    }
  }
  if (top) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = EDGE;
    ctx.fillRect(x, y, w, 3);
  }
}

/** Oak planks: the watchtower's floors. */
function planks(ctx, [x, y, w, h], { edge = true } = {}) {
  ctx.fillStyle = vgrad(ctx, y, y + h, "#c08a4a", "#8a5a2a");
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(60, 30, 10, 0.55)";
  for (let bx = x + 30; bx < x + w; bx += 40) ctx.fillRect(bx, y, 2, h);
  ctx.fillRect(x, y + h - 3, w, 3);
  if (edge) {
    ctx.fillStyle = EDGE;
    ctx.fillRect(x, y, w, 3);
  }
}

/** The mine's scaffolding: planks on posts. */
function scaffold(ctx, [x, y, w, h]) {
  ctx.fillStyle = "#5a3a1c";
  ctx.fillRect(x + 4, y + h, 6, 40);
  ctx.fillRect(x + w - 10, y + h, 6, 40);
  planks(ctx, [x, y, w, h]);
}

/** The edge of the world, rendered badly. */
function border(ctx, [x, y, w, h], label) {
  missing(ctx, x, y, w, h, 20);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.translate(x + w / 2, y + Math.min(h, 1200) / 2 + 200);
  ctx.rotate(-Math.PI / 2);
  text(ctx, label, 0, 0, { size: 30, font: MONO, align: "center", color: "#ffffff" });
  ctx.restore();
}

/** Obsidian-ish: the rift's platform. Nothing like any real game's. Probably. */
function obsidian(ctx, [x, y, w, h]) {
  for (let by = y; by < y + h; by += CELL) {
    for (let bx = x; bx < x + w; bx += CELL) {
      const n = hash(bx * 0.41 + by * 0.23);
      ctx.fillStyle = n > 0.6 ? "#2a1640" : n > 0.3 ? "#1e1030" : "#160a24";
      ctx.fillRect(bx, by, Math.min(CELL, x + w - bx), Math.min(CELL, y + h - by));
      if (n > 0.85) {
        ctx.fillStyle = "#6a2ab0";
        ctx.fillRect(bx + 6, by + 6, 4, 4);
      }
    }
  }
  ctx.fillStyle = EDGE;
  ctx.fillRect(x, y, w, 3);
}

/** Which material a collision rect is dressed as: by where it is in the world. */
function materialOf([x, y, w, h], i) {
  if ((x === 3520 && w === 80) || x >= 6340) return "border";
  if (h === 20) return x >= 3150 && x < 3340 ? "planks" : "scaffold";
  if (x >= 6000) return "obsidian";
  if (x >= 5200) return ["wrong", "glitchy", "wrong", "glitchy", "missingTop"][i % 5];
  if (x >= 4900 && y < 1300) return "chunk";
  // The pond's bed and the cave lake's: sand.
  if ((y >= 1400 && x === 4360) || (y === 1290 && x === 1120)) return "sand";
  if (y >= 1400) return "stone";
  return "grass";
}

// ------------------------------------------------------------------ structures (on the solids layer)

function pixelRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function tree(ctx, x, ground, { tall = 160, upside = false, wrong = false } = {}) {
  ctx.save();
  if (upside) {
    ctx.translate(x + 15, ground);
    ctx.scale(1, -1);
    ctx.translate(-(x + 15), -ground);
  }
  pixelRect(ctx, x, ground - tall, 30, tall, wrong ? "#3b76ff" : "#6b4a2a");
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let ty = ground - tall; ty < ground; ty += 20) ctx.fillRect(x + (ty % 40 ? 6 : 16), ty + 4, 8, 12);
  const leaves = wrong ? ["#ff6fd8", "#e85ac4"] : ["#2f7a2a", "#3a8a32", "#27702a"];
  for (const [lx, ly, lw, lh] of [[-50, -tall - 70, 130, 80], [-30, -tall - 110, 90, 50], [-10, -tall - 130, 50, 30]]) {
    for (let by = 0; by < lh; by += 20) {
      for (let bx = 0; bx < lw; bx += 20) {
        ctx.fillStyle = leaves[Math.floor(hash(x + bx * 3 + by) * leaves.length)];
        ctx.fillRect(x + lx + bx, ground + ly + by, 20, 20);
      }
    }
  }
  ctx.restore();
}

/** A block house: a stone base, plank walls, a stepped roof, a door and a lit window. */
function house(ctx, x, ground, w, { wall = "#c08a4a", roof = "#8a3a2a", sign = null, floors = 1 } = {}) {
  const h = 120 * floors;
  const top = ground - h;
  for (let by = top; by < ground; by += CELL) {
    for (let bx = x; bx < x + w; bx += CELL) {
      const n = hash(bx * 0.7 + by * 0.3);
      ctx.fillStyle = by >= ground - 40 ? (n > 0.5 ? "#7a7a7a" : "#6c6c6c") : n > 0.5 ? wall : shadeHex(wall, -0.12);
      ctx.fillRect(bx, by, CELL, CELL);
    }
  }
  // Timber frame.
  ctx.fillStyle = "#5a3a1c";
  ctx.fillRect(x, top, 10, h);
  ctx.fillRect(x + w - 10, top, 10, h);
  ctx.fillRect(x, top, w, 10);
  // The roof, in steps.
  for (let step = 0; step < 4; step++) {
    ctx.fillStyle = step % 2 ? roof : shadeHex(roof, -0.15);
    ctx.fillRect(x - 20 + step * 20, top - 20 - step * 20, w + 40 - step * 40, 20);
  }
  // Door and windows.
  ctx.fillStyle = "#4a2c14";
  ctx.fillRect(x + w / 2 - 20, ground - 80, 40, 80);
  ctx.fillStyle = "#e0a040";
  ctx.fillRect(x + w / 2 + 10, ground - 44, 5, 5);
  for (let f = 0; f < floors; f++) {
    for (const wx of [x + 22, x + w - 62]) {
      ctx.fillStyle = "#2a1a0a";
      ctx.fillRect(wx - 4, top + 26 + f * 120, 48, 44);
      ctx.fillStyle = "#ffe08a";
      ctx.fillRect(wx, top + 30 + f * 120, 40, 36);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(wx + 4, top + 34 + f * 120, 10, 10);
    }
  }
  if (sign) woodSign(ctx, x + w / 2, top - 120, sign);
}

function shadeHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(Math.max(0, Math.min(255, v + amount * 255))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** A plank sign on a post. */
function woodSign(ctx, cx, y, label, { post = 0, size = 18 } = {}) {
  ctx.font = `700 ${size}px ${MONO}`;
  const w = Math.max(80, ctx.measureText(label).width + 26);
  if (post) {
    ctx.fillStyle = "#5a3a1c";
    ctx.fillRect(cx - 4, y + 34, 8, post);
  }
  planks(ctx, [cx - w / 2, y, w, 36], { edge: false });
  ctx.strokeStyle = "#3a2410";
  ctx.lineWidth = 3;
  ctx.strokeRect(cx - w / 2, y, w, 36);
  text(ctx, label, cx, y + 19, { size, font: MONO, align: "center", color: "#2a1606" });
}

function shop(ctx, x, ground) {
  house(ctx, x, ground, 220, { wall: "#d8c090", roof: "#2a6a8a" });
  // Striped awning and the counter.
  for (let i = 0; i < 11; i++) {
    ctx.fillStyle = i % 2 ? "#ffffff" : "#e04a3a";
    ctx.fillRect(x - 10 + i * 22, ground - 110, 22, 24);
  }
  ctx.fillStyle = "#6a4020";
  ctx.fillRect(x + 20, ground - 50, 180, 12);
  woodSign(ctx, x + 110, ground - 250, "BLOCKMART");
  text(ctx, "WE SELL BLOCKS", x + 110, ground - 196, { size: 14, font: MONO, align: "center", color: "#2a1606" });
}

function barn(ctx, x, ground) {
  const w = 200;
  const h = 150;
  ctx.fillStyle = "#a03020";
  ctx.fillRect(x, ground - h, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let bx = x + 20; bx < x + w; bx += 20) ctx.fillRect(bx, ground - h, 2, h);
  ctx.fillStyle = "#f0e6d0";
  ctx.fillRect(x + 60, ground - 100, 80, 100);
  ctx.strokeStyle = "#a03020";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x + 60, ground - 100);
  ctx.lineTo(x + 140, ground);
  ctx.moveTo(x + 140, ground - 100);
  ctx.lineTo(x + 60, ground);
  ctx.stroke();
  for (let step = 0; step < 4; step++) {
    ctx.fillStyle = step % 2 ? "#5a2a1a" : "#6a3420";
    ctx.fillRect(x - 10 + step * 25, ground - h - 20 - step * 20, w + 20 - step * 50, 20);
  }
  woodSign(ctx, x + w / 2, ground - h - 130, "STORAGE (FULL OF DIRT)", { size: 14 });
}

function farm(ctx, x, ground, w) {
  // Tilled rows with crops, one of them already the wrong colour.
  for (let bx = x; bx < x + w; bx += 20) {
    ctx.fillStyle = "#5a3a1c";
    ctx.fillRect(bx, ground - 6, 20, 6);
    const n = hash(bx);
    const purple = bx > x + w * 0.7;
    ctx.fillStyle = purple ? (n > 0.5 ? "#c050ff" : "#9a30d8") : n > 0.5 ? "#8fe060" : "#6cbd48";
    const tall = 14 + Math.floor(n * 20);
    ctx.fillRect(bx + 6, ground - 6 - tall, 4, tall);
    ctx.fillRect(bx + 3, ground - 10 - tall, 10, 6);
    if (!purple && n > 0.6) {
      ctx.fillStyle = "#ffd400";
      ctx.fillRect(bx + 5, ground - 16 - tall, 6, 8);
    }
  }
  // A scarecrow.
  const sx = x + w * 0.45;
  ctx.fillStyle = "#6b4a2a";
  ctx.fillRect(sx - 3, ground - 110, 6, 110);
  ctx.fillRect(sx - 36, ground - 86, 72, 6);
  ctx.fillStyle = "#e0c060";
  ctx.fillRect(sx - 14, ground - 132, 28, 26);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(sx - 8, ground - 124, 5, 5);
  ctx.fillRect(sx + 3, ground - 124, 5, 5);
  ctx.fillStyle = "#3a6ab0";
  ctx.fillRect(sx - 16, ground - 106, 32, 36);
  woodSign(ctx, x + w * 0.8, ground - 90, "CROPS (MOSTLY)", { post: 54, size: 13 });
}

function well(ctx, x, ground) {
  ctx.fillStyle = "#7a7a7a";
  ctx.fillRect(x, ground - 50, 100, 50);
  ctx.fillStyle = "#1a3a8a";
  ctx.fillRect(x + 12, ground - 50, 76, 12);
  ctx.fillStyle = "#5a3a1c";
  ctx.fillRect(x + 6, ground - 150, 10, 100);
  ctx.fillRect(x + 84, ground - 150, 10, 100);
  for (let step = 0; step < 2; step++) {
    ctx.fillStyle = step ? "#8a3a2a" : "#6a2a1a";
    ctx.fillRect(x - 10 + step * 20, ground - 170 - step * 20, 120 - step * 40, 20);
  }
  ctx.fillStyle = "#9a9a9a";
  ctx.fillRect(x + 46, ground - 130, 4, 60);
  ctx.fillStyle = "#6a4020";
  ctx.fillRect(x + 38, ground - 76, 20, 16);
}

/** The watchtower's frame behind its floors: four legs and cross braces. */
function towerFrame(ctx, x, ground, top) {
  ctx.fillStyle = "#6b4a2a";
  for (const lx of [x, x + 170]) ctx.fillRect(lx, top, 16, ground - top);
  ctx.strokeStyle = "rgba(90, 60, 30, 0.9)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  for (let y = top + 20; y < ground - 60; y += 100) {
    ctx.moveTo(x + 8, y);
    ctx.lineTo(x + 178, y + 100);
    ctx.moveTo(x + 178, y);
    ctx.lineTo(x + 8, y + 100);
  }
  ctx.stroke();
  // The lookout's roof and a flag.
  for (let step = 0; step < 3; step++) {
    ctx.fillStyle = step % 2 ? "#8a3a2a" : "#6a2a1a";
    ctx.fillRect(x - 20 + step * 25, top - 100 - step * 20, 226 - step * 50, 20);
  }
  ctx.fillStyle = "#5a3a1c";
  ctx.fillRect(x + 90, top - 190, 5, 60);
  ctx.fillStyle = "#ffd400";
  ctx.fillRect(x + 95, top - 190, 36, 22);
  text(ctx, "CPI", x + 113, top - 179, { size: 13, font: MONO, align: "center", color: "#111" });
}

function mineEntrance(ctx, x, ground) {
  // Timber posts and lintel over the shaft, a lamp and the warning sign.
  ctx.fillStyle = "#5a3a1c";
  ctx.fillRect(x - 16, ground - 130, 16, 130);
  ctx.fillRect(x + 120, ground - 130, 16, 130);
  ctx.fillRect(x - 30, ground - 150, 180, 22);
  woodSign(ctx, x + 60, ground - 210, "MINE (DEFINITELY SAFE)", { size: 14 });
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(x + 56, ground - 128, 8, 16);
}

function rails(ctx, x0, x1, y) {
  ctx.fillStyle = "#5a3a1c";
  for (let x = x0; x < x1; x += 30) ctx.fillRect(x, y - 6, 16, 6);
  ctx.fillStyle = "#9a9aa2";
  ctx.fillRect(x0, y - 10, x1 - x0, 3);
}

function minecart(ctx, x, y) {
  ctx.fillStyle = "#6a6a72";
  ctx.fillRect(x, y - 44, 70, 30);
  ctx.fillStyle = "#4a4a50";
  ctx.fillRect(x + 4, y - 40, 62, 8);
  ctx.fillStyle = "#ffd400";
  ctx.fillRect(x + 10, y - 50, 14, 10);
  ctx.fillRect(x + 30, y - 54, 14, 14);
  ctx.fillStyle = "#222";
  for (const wx of [x + 14, x + 56]) {
    ctx.beginPath();
    ctx.arc(wx, y - 12, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Half a house, floating, rotated: a chunk that loaded in the wrong place. */
function floatingHouse(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.35);
  house(ctx, -90, 60, 180, { wall: "#c08a4a", roof: "#2a6a8a" });
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(10, -130, 90, 200);
  missing(ctx, 20, -60, 60, 60);
  ctx.restore();
}

/** A floating island of terrain: cosmetic, in the distance of the corrupted sky. */
function floatingChunk(ctx, x, y, w, pal, seed) {
  for (let row = 0; row < 5; row++) {
    const inset = row * 20;
    for (let bx = x + inset; bx < x + w - inset; bx += CELL) {
      const layer = row === 0 ? pal.top : row < 3 ? pal.dirt : pal.stone;
      ctx.fillStyle = layer[Math.floor(hash(bx + row * 7 + seed) * layer.length)];
      ctx.fillRect(bx, y + row * CELL, CELL, CELL);
    }
  }
}

// ------------------------------------------------------------------ the layers

const SKY = { x0: 4300, x1: 5400 }; // where the sky gives up

/** Sky, sun, clouds and hills; the cave's back wall; the corrupted sky; the void past the edge. */
function paintBackdrop(ctx, level) {
  const W = level.width ?? level.size?.[0] ?? 6400;
  const H = level.height ?? level.size?.[1] ?? 2000;
  const M = 90;
  ctx.fillStyle = vgrad(ctx, -M, 1300, "#4a8fe0", "#bfe2fa");
  ctx.fillRect(-M, -M, W + M * 2, H + M * 2);
  // The corruption creeps into the sky from the east.
  const bad = ctx.createLinearGradient(SKY.x0, 0, SKY.x1, 0);
  bad.addColorStop(0, "rgba(40, 10, 60, 0)");
  bad.addColorStop(1, "rgba(40, 10, 60, 1)");
  ctx.fillStyle = bad;
  ctx.fillRect(SKY.x0, -M, W - SKY.x0 + M, H + M * 2);
  // Chunk borders, as if someone left the debug view on.
  ctx.strokeStyle = "rgba(255, 220, 90, 0.18)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 4800; x <= W; x += 320) {
    ctx.moveTo(x, -M);
    ctx.lineTo(x, 1400);
  }
  for (let y = 0; y <= 1400; y += 320) {
    ctx.moveTo(4800, y);
    ctx.lineTo(W + M, y);
  }
  ctx.stroke();
  // Missing sky: patches that never loaded.
  for (let i = 0; i < 26; i++) {
    const px = 4700 + hash(i + 3) * 1700;
    const py = hash(i + 11) * 1200;
    const s = 40 + Math.floor(hash(i + 5) * 4) * 40;
    ctx.globalAlpha = 0.25 + hash(i) * 0.5;
    missing(ctx, px, py, s, s, 20);
  }
  ctx.globalAlpha = 1;
  // The pixel sun and the clouds over the plains.
  ctx.fillStyle = "rgba(255, 246, 176, 0.3)";
  ctx.fillRect(760, 250, 140, 140);
  ctx.fillStyle = "#fff6b0";
  ctx.fillRect(785, 275, 90, 90);
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  for (let i = 0; i < 14; i++) {
    const cx = 100 + i * 300 + hash(i) * 120;
    const cy = 150 + hash(i + 3) * 380;
    const w = 120 + hash(i + 7) * 120;
    ctx.fillRect(cx, cy, w, 24);
    ctx.fillRect(cx + 24, cy - 16, w - 60, 16);
  }
  // Far hills, in blocks, fading out where the world does.
  for (const [base, color, alpha, seed] of [[1040, "#3f7f3a", 0.5, 11], [1130, "#356e31", 0.75, 23]]) {
    ctx.fillStyle = color;
    for (let cx = -M; cx < 4600; cx += 40) {
      ctx.globalAlpha = alpha * Math.max(0, Math.min(1, (4600 - cx) / 800));
      const h = Math.round((Math.sin((cx + seed * 97) / 260) * 0.5 + 0.5 + hash(cx / 40 + seed) * 0.4) * 5) * 40;
      ctx.fillRect(cx, base - h, 40, h + 400);
    }
  }
  ctx.globalAlpha = 1;
  // Distant floating chunks over the corruption.
  floatingChunk(ctx, 4700, 420, 200, GRASS, 1);
  floatingChunk(ctx, 5120, 240, 160, WRONG, 2);
  floatingChunk(ctx, 5980, 300, 240, WRONG, 3);
  floatingChunk(ctx, 4980, 700, 120, GRASS, 4);
  // Underground: the cave's back wall, darker and bumpier than the rock in front.
  for (const [x, y, w, h] of [[3180, 1400, 1740, 600], [3340, 1240, 120, 160], [4700, 1160, 200, 560], [1120, 1240, 260, 50]]) {
    for (let by = y; by < y + h; by += 40) {
      for (let bx = x; bx < x + w; bx += 40) {
        const n = hash(bx * 0.19 + by * 0.07);
        ctx.fillStyle = y === 1240 && x === 1120 ? (n > 0.5 ? "#5a4028" : "#4e3822") : n > 0.6 ? "#34343a" : n > 0.3 ? "#2e2e34" : "#28282e";
        ctx.fillRect(bx, by, 40, 40);
      }
    }
  }
  // Past the edge of the world: nothing, with static in it.
  ctx.fillStyle = "#050208";
  ctx.fillRect(6340, -M, W - 6340 + M, H + M * 2);
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.05 + hash(i) * 0.2})`;
    ctx.fillRect(6340 + hash(i + 1) * (W - 6340 + M), hash(i + 2) * H, 3, 3);
  }
}

// Signs and structures by the level's own rects (levels.ts): where things stand.
const GROUND = 1240;

/** Buildings, trees and props first (they're behind), then the terrain, then the signs. */
function paintSolids(ctx, level) {
  // ---- the plains
  tree(ctx, 150, GROUND, { tall: 140 });
  tree(ctx, 760, 1160, { tall: 170 });
  tree(ctx, 1470, GROUND, { tall: 120 });
  woodSign(ctx, 330, 1150, "WORLD: THAD", { post: 54 });
  woodSign(ctx, 1480, 1070, "⚠ CHUNK NOT FOUND", { post: 134, size: 14 });
  // A floating block that shouldn't be floating: the first hint.
  missing(ctx, 440, 1010, 40, 40, 20);
  // ---- Blockton
  house(ctx, 1800, GROUND, 180, { wall: "#c08a4a", roof: "#8a3a2a", sign: "BLOCKTON" });
  shop(ctx, 2020, GROUND);
  well(ctx, 2290, GROUND);
  house(ctx, 2480, GROUND, 160, { wall: "#b0a080", roof: "#4a6a2a", floors: 2 });
  farm(ctx, 2700, GROUND, 240);
  barn(ctx, 2950, GROUND);
  towerFrame(ctx, 3150, GROUND, 840);
  mineEntrance(ctx, 3340, GROUND);
  tree(ctx, 1720, GROUND, { tall: 130 });
  woodSign(ctx, 1700, 1130, "NOTICE: THE SKY IS BROKEN", { post: 74, size: 13 });
  // ---- the mine and the cave
  rails(ctx, 3200, 3720, 1600);
  minecart(ctx, 3560, 1600);
  woodSign(ctx, 3920, 1450, "LOW CEILING →", { size: 13 });
  woodSign(ctx, 4410, 1500, "FRAGMENT: ↓ UNDER THE ROCK", { size: 12 });
  woodSign(ctx, 4200, 1660, "HOT", { size: 13 });
  // ---- the corruption
  tree(ctx, 5000, 1160, { tall: 150, wrong: true });
  tree(ctx, 5305, 1100, { upside: true, tall: 120 });
  floatingHouse(ctx, 5380, 640);
  tree(ctx, 5900, 330, { tall: 90, upside: true, wrong: true });
  // ---- the terrain itself
  level.platforms.forEach((r, i) => {
    const m = materialOf(r, i);
    if (m === "grass") voxel(ctx, r, GRASS, i);
    else if (m === "sand") voxel(ctx, r, SAND, i, { dirtRows: 2 });
    // Rock that starts right under the crust (y 1400) has no floor you could stand on: no edge.
    else if (m === "stone") stone(ctx, r, i, { top: r[1] !== 1400 });
    else if (m === "planks") planks(ctx, r);
    else if (m === "scaffold") scaffold(ctx, r);
    else if (m === "border") border(ctx, r, r[0] >= 6340 ? "THE EDGE OF THE WORLD" : "WORLD BORDER · COME BACK LATER");
    else if (m === "obsidian") obsidian(ctx, r);
    else if (m === "chunk") voxel(ctx, r, GRASS, i, { glitch: 0.06 });
    else if (m === "wrong") voxel(ctx, r, WRONG, i, { glitch: 0.1 });
    else if (m === "glitchy") voxel(ctx, r, GRASS, i, { glitch: 0.35 });
    else if (m === "missingTop") {
      voxel(ctx, r, GRASS, i);
      missing(ctx, r[0], r[1], r[2], 20);
      ctx.fillStyle = EDGE;
      ctx.fillRect(r[0], r[1], r[2], 3);
    }
  });
  // Signs over the terrain.
  woodSign(ctx, 4990, 1080, "LAST STABLE CHUNK", { size: 13 });
  woodSign(ctx, 6200, 420, "EXIT (PROBABLY)", { size: 14 });
}

// ------------------------------------------------------------------ the live layer

/** The villagers of Blockton: [x, ground, hat colour, lines]. They're decorative, and gossip. */
const VILLAGERS = [
  [1930, GROUND, "#ffd400", ["Welcome to Blockton!", "Population: 4. Ish."]],
  [2170, GROUND, "#e04a3a", ["BLOCKMART: we sell blocks.", "Just blocks. Only blocks."]],
  [2420, GROUND, "#4dd4ff", ["The mayor says: find the", "3 corrupted fragments."]],
  [2820, GROUND, "#7dff6a", ["My crops keep turning purple.", "Also the sky."]],
  [3080, GROUND, "#ff9a3d", ["Something shiny is up the tower.", "I'd get it, but: stairs."]],
  [3460, 1600, "#b58cff", ["Mine's closed.", "Something down there hums."]],
];

function villager(ctx, x, ground, hat, lines, time, i) {
  const bob = Math.abs(Math.sin(time * 2 + i)) * 2;
  const face = Math.sin(time * 0.4 + i * 2) > 0 ? 1 : -1;
  const y = ground - 64 - bob;
  ctx.fillStyle = "#3a5a8a";
  ctx.fillRect(x - 12, y + 34, 24, 30);
  ctx.fillStyle = "#2a2a2a";
  ctx.fillRect(x - 12, y + 58, 10, 6);
  ctx.fillRect(x + 2, y + 58, 10, 6);
  ctx.fillStyle = "#e8c09a";
  ctx.fillRect(x - 13, y + 6, 26, 28);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(x + face * 4 - 2, y + 16, 4, 4);
  ctx.fillRect(x + face * 10 - 2, y + 16, 4, 4);
  ctx.fillStyle = hat;
  ctx.fillRect(x - 15, y, 30, 8);
  ctx.fillRect(x - 9, y - 8, 18, 8);
  // What they're saying: one line at a time, taking turns.
  const k = Math.floor(time / 3.2 + i * 0.7) % (lines.length + 1);
  if (k === lines.length) return;
  const line = lines[k];
  ctx.font = `700 15px ${MONO}`;
  const w = ctx.measureText(line).width + 18;
  rr(ctx, x - w / 2, y - 46, w, 28, 6);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 18);
  ctx.lineTo(x + 6, y - 18);
  ctx.lineTo(x, y - 10);
  ctx.fill();
  text(ctx, line, x, y - 31, { size: 15, font: MONO, align: "center", color: "#1a1a1a" });
}

/** A wall torch, flickering, with its light. */
function torch(ctx, x, y, time) {
  const f = 1 + Math.sin(time * 17 + x) * 0.12 + Math.sin(time * 29 + y) * 0.08;
  const g = ctx.createRadialGradient(x, y - 6, 2, x, y - 6, 110 * f);
  g.addColorStop(0, "rgba(255, 180, 70, 0.32)");
  g.addColorStop(1, "rgba(255, 140, 40, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - 120, y - 126, 240, 240);
  ctx.fillStyle = "#5a3a1c";
  ctx.fillRect(x - 3, y, 6, 22);
  ctx.fillStyle = "#ffb03a";
  ctx.fillRect(x - 5, y - 10 * f, 10, 10 * f);
  ctx.fillStyle = "#fff0a0";
  ctx.fillRect(x - 2, y - 6, 4, 6);
}

export const TORCHES = [
  [3380, 1200],
  [3250, 1545],
  [3520, 1545],
  [3700, 1545],
  [4000, 1545],
  [4100, 1650],
  [4330, 1640],
  [4620, 1650],
  [4700, 1500],
  [4890, 1330],
  [2260, 1180],
];

/** Every frame, cheap, and only what's near `view` ([x, y, w, h] in world units, when known). */
function paintLive(ctx, level, time, theme, view) {
  // Clouds that actually drift, over the plains and the village.
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  for (let i = 0; i < 4; i++) {
    const cx = ((time * (10 + i * 5) + i * 1100) % 4600) - 200;
    const cy = 420 + i * 110;
    if (!inView(cx, cy, view)) continue;
    ctx.fillRect(cx, cy, 160, 22);
    ctx.fillRect(cx + 30, cy - 14, 80, 14);
  }
  VILLAGERS.forEach(([x, ground, hat, lines], i) => inView(x, ground, view) && villager(ctx, x, ground, hat, lines, time, i));
  for (const [x, y] of TORCHES) if (inView(x, y, view)) torch(ctx, x, y, time);
  // Glitches in the corrupted chunks: slivers of the world that jump about.
  const beat = Math.floor(time * 6);
  for (let i = 0; i < 9; i++) {
    const gx = 4800 + hash(beat * 3 + i) * 1500;
    const gy = 300 + hash(beat * 5 + i * 2) * 1000;
    if (!inView(gx, gy, view)) continue;
    ctx.fillStyle = i % 3 === 0 ? "rgba(240, 0, 200, 0.5)" : i % 3 === 1 ? "rgba(0, 240, 255, 0.4)" : "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(gx, gy, 40 + hash(i + beat) * 160, 6 + hash(i * 3 + beat) * 14);
  }
  // Blocks drifting up out of the corruption, lost.
  for (let i = 0; i < 6; i++) {
    const bx = 5000 + i * 230 + Math.sin(time * 0.6 + i) * 20;
    const by = 1300 - ((time * (20 + i * 4) + i * 170) % 900);
    if (!inView(bx, by, view)) continue;
    ctx.globalAlpha = 0.8;
    if (i % 2) missing(ctx, bx, by, 20, 20, 10);
    else {
      ctx.fillStyle = i % 4 ? "#5fb03e" : "#8a5a32";
      ctx.fillRect(bx, by, 20, 20);
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ fragments, beds, the rift

/** A corrupted fragment: a spinning cube of wrong textures, humming. */
export function paintFragment(ctx, x, y, time) {
  const bob = Math.sin(time * 2.2 + x) * 5;
  const glow = ctx.createRadialGradient(x, y + bob, 2, x, y + bob, 46);
  glow.addColorStop(0, "rgba(255, 60, 220, 0.55)");
  glow.addColorStop(1, "rgba(0, 220, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - 46, y - 46 + bob, 92, 92);
  const squash = Math.abs(Math.cos(time * 1.6 + x));
  const w = 26 * Math.max(0.2, squash);
  ctx.save();
  ctx.translate(x, y + bob);
  missing(ctx, -w / 2, -13, w, 26, 6.5);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -13, w, 26);
  ctx.restore();
  for (let i = 0; i < 4; i++) {
    const a = time * 2.5 + (i * Math.PI) / 2;
    ctx.fillStyle = i % 2 ? "#00f0ff" : "#ff3cdc";
    ctx.fillRect(x + Math.cos(a) * 26 - 2, y + bob + Math.sin(a) * 12 - 2, 4, 4);
  }
}

/** A checkpoint: a bed. Yours glows (you'll wake up here). */
export function paintBed(ctx, name, x, y, { active = false, time = 0 } = {}) {
  ctx.fillStyle = "#6b4a2a";
  ctx.fillRect(x - 30, y - 18, 60, 18);
  ctx.fillStyle = "#e04a3a";
  ctx.fillRect(x - 30, y - 26, 44, 12);
  ctx.fillStyle = "#f4f0e8";
  ctx.fillRect(x + 14, y - 26, 16, 12);
  if (active) {
    const g = ctx.createRadialGradient(x, y - 20, 4, x, y - 20, 70);
    g.addColorStop(0, `rgba(255, 230, 140, ${0.35 + 0.15 * Math.sin(time * 3)})`);
    g.addColorStop(1, "rgba(255, 230, 140, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 70, y - 90, 140, 140);
    text(ctx, "SPAWN SET", x, y - 44, { size: 13, font: MONO, align: "center", color: "#ffe08a" });
  } else text(ctx, "💤 CHECKPOINT", x, y - 44, { size: 12, font: MONO, align: "center", color: "rgba(255,255,255,0.7)" });
}

/**
 * The rift at the edge of the world. `state`: "locked" (a dead frame with three empty sockets),
 * "active" (open, swirling: press ▼ in it), "collapse" (someone went in: everything's pulling).
 */
export function paintRift(ctx, [x, y, w, h], { time = 0, state = "locked", found = 0, need = 3 } = {}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const open = state !== "locked";
  const hot = state === "collapse";
  // Light spilling out.
  if (open) {
    const spill = ctx.createRadialGradient(cx, cy, 10, cx, cy, h * (hot ? 2.4 : 1.6));
    spill.addColorStop(0, hot ? "rgba(255, 120, 240, 0.5)" : "rgba(200, 80, 255, 0.35)");
    spill.addColorStop(1, "rgba(120, 0, 255, 0)");
    ctx.fillStyle = spill;
    ctx.fillRect(cx - h * 2.4, cy - h * 2.4, h * 4.8, h * 4.8);
  }
  // The frame: jagged dark blocks.
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const side = t < 0.35 ? 0 : t < 0.65 ? 1 : 2;
    const bx = side === 0 ? x - 30 : side === 2 ? x + w + 10 : x - 30 + ((t - 0.35) / 0.3) * (w + 40);
    const by = side === 1 ? y - 30 : y - 30 + ((side === 0 ? t / 0.35 : (1 - t) / 0.35) * (h + 30));
    ctx.fillStyle = hash(i) > 0.5 ? "#2a1640" : "#1e1030";
    ctx.fillRect(bx, by, 20 + hash(i + 3) * 10, 20 + hash(i + 5) * 10);
  }
  // Inside.
  if (!open) {
    ctx.fillStyle = "rgba(10, 6, 16, 0.9)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.05 + 0.05 * Math.sin(time * 7)})`;
    for (let i = 0; i < 20; i++) ctx.fillRect(x + hash(i + Math.floor(time * 8)) * w, y + hash(i * 3 + Math.floor(time * 8)) * h, 3, 3);
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, hot ? "#ffffff" : "#7a2ae0");
    g.addColorStop(0.5, hot ? "#ff60f0" : "#e060ff");
    g.addColorStop(1, hot ? "#60f0ff" : "#3a18b0");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const beat = Math.floor(time * (hot ? 14 : 6));
    for (let i = 0; i < (hot ? 24 : 12); i++) {
      ctx.globalAlpha = 0.5;
      missing(ctx, x + hash(beat + i) * w, y + hash(beat * 2 + i) * h, 20, 20, 10);
    }
    ctx.globalAlpha = 1;
    // Pulled in: rings shrinking to the middle.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const k = 1 - ((time * (hot ? 1.6 : 0.7) + i / 3) % 1);
      ctx.strokeRect(cx - (w / 2) * k, cy - (h / 2) * k, w * k, h * k);
    }
    ctx.restore();
    // Beams up into the sky.
    const beam = ctx.createLinearGradient(0, y - 500, 0, y);
    beam.addColorStop(0, "rgba(220, 120, 255, 0)");
    beam.addColorStop(1, `rgba(220, 120, 255, ${hot ? 0.55 : 0.3})`);
    ctx.fillStyle = beam;
    ctx.fillRect(cx - 30, y - 500, 60, 500);
  }
  // Three sockets over the frame: the fragments.
  for (let i = 0; i < need; i++) {
    const sx = cx - (need - 1) * 26 + i * 52;
    const sy = y - 62;
    ctx.fillStyle = "#120a1a";
    ctx.fillRect(sx - 14, sy - 14, 28, 28);
    if (i < found) missing(ctx, sx - 10, sy - 10, 20, 20, 5);
    ctx.strokeStyle = i < found ? "#ffffff" : "#5a3a7a";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 14, sy - 14, 28, 28);
  }
  text(ctx, state === "locked" ? `THE RIFT · ${found}/${need} FRAGMENTS` : state === "active" ? "EXIT ACTIVATED · ▼ TO ENTER" : "IT'S PULLING EVERYTHING IN", cx, y - 98, {
    size: 17,
    font: MONO,
    align: "center",
    color: state === "locked" ? "#c8a0ff" : "#ffffff",
  });
}

// ------------------------------------------------------------------ the theme

/** Screens show these once, the first time a runner (you, on a phone) walks in. [rect, text, kind]. */
const MESSAGES = [
  [[0, 0, 420, 2000], "BLOCKCRAFT · world \"THAD\" loaded with 3 errors", "warn"],
  [[1400, 800, 280, 600], "⚠ CHUNK (7, −2) FAILED TO LOAD. Don't fall in.", "danger"],
  [[1760, 800, 300, 600], "📍 BLOCKTON VILLAGE · one of the fragments is here", "info"],
  [[3180, 700, 180, 160], "From up here you can see it: the world ends in the east.", "info"],
  [[3330, 1250, 140, 200], "⛏ ENTERING THE MINE · light level: rude", "warn"],
  [[4300, 1560, 400, 400], "🌊 The fragment's at the bottom. Mash JUMP to swim up.", "info"],
  [[4880, 900, 360, 320], "⚠ STEAM MY DECK: blockcraft.exe is not responding", "danger"],
  [[5560, 340, 460, 780], "PHYSICS.DLL NOT FOUND · gravity is now optional", "warn"],
  [[6000, 380, 340, 480], "THE EDGE OF THE WORLD", "danger"],
];

/** Optional places: an achievement for whoever gets there. [rect, key, title]. */
const SECRETS = [
  [[300, 1100, 200, 140], "grass", "Touched Grass"],
  [[1110, 800, 140, 80], "potato", "Sky Potato (It Was Just Dirt)"],
  [[3460, 1160, 60, 80], "border", "Licked the World Border"],
  [[3600, 1150, 500, 90], "oob", "Out of Bounds (Legally)"],
  [[3220, 780, 110, 60], "tower", "Tourist"],
];

export const BLOCKWORLD_THEME = {
  name: "Blockcraft",
  skin: "grass",
  exit: "rift",
  checkpoint: "bed",
  pixel: true,
  cables: false,
  wall: ["#4a8fe0", "#bfe2fa"],
  far: "rgba(40, 90, 50, 0.35)",
  block: ["#8a5a32", "#5a3a1f"],
  top: "#5aa83a",
  seam: "rgba(0, 0, 0, 0.18)",
  rim: "rgba(255, 255, 255, 0.15)",
  slab: ["#8d8d8d", "#5e5e5e"],
  pit: ["#f000c8", "#0a0a0a"],
  light: "rgba(255, 250, 220, 0.10)",
  props: [],
  decals: [],
  live: [],
  paintBackdrop,
  paintSolids,
  paintLive,
  // Underground is dark: lit by torches, your own glow, the fragment and the lava.
  darkZones: [[3180, 1260, 1740, 740]],
  lights: [...TORCHES.map(([x, y]) => [x, y - 6, 150]), [4230, 1860, 170], [4630, 1905, 90]],
  messages: MESSAGES,
  secrets: SECRETS,
};
