// CPI Character System: what a player looks like in any CPI game, drawn procedurally on a canvas.
//
// A character is data (createCharacter): an id, a name, a colour and an appearance made of slots
// (hat, face, suit, accessory). The appearance is picked deterministically from the id, so a player
// looks the same on the host screen and every phone without the server sending anything; a future
// cosmetics/unlocks system just passes `appearance` overrides. drawCharacter() paints one in any
// pose the animator (cpi/animation.js) describes. Nothing here knows about any one game.
//
//   const agent = createCharacter({ id, name, color: "#4dd4ff" });
//   drawCharacter(ctx, agent, { x, y, w: 28, h: 36, facing: 1, state: "run", t, cycle });
//   characterCanvas(agent, { size: 64, state: "escape" })  // a <canvas> badge for the DOM
//
// Units: a character is drawn in a 28 × 36 box (the reference collision box) and scaled to the box
// you give it. The drawing may poke out of the box a little (hats, arms): that's cosmetic only.

import { fitCanvas } from "../drawing-canvas.js";

export const BOX = Object.freeze({ w: 28, h: 36 });

/**
 * Every slot and its options. `unlock: true` options are never picked at random: they're for
 * cosmetics a player earns or chooses later.
 */
export const SLOTS = Object.freeze({
  hat: [
    { id: "none", label: "Bare helmet" },
    { id: "hardhat", label: "Hard hat" },
    { id: "beanie", label: "Beanie" },
    { id: "cap", label: "Field cap" },
    { id: "antenna", label: "Antenna" },
    { id: "cone", label: "Traffic cone" },
    { id: "propeller", label: "Propeller cap" },
    { id: "cob", label: "Cob hat" },
    { id: "headset", label: "Headset" },
    { id: "chef", label: "Toque" },
    { id: "tophat", label: "Top hat" },
    { id: "crown", label: "Crown", unlock: true },
  ],
  face: [
    { id: "visor", label: "Visor" },
    { id: "goggles", label: "Goggles" },
    { id: "shades", label: "Shades" },
    { id: "monocle", label: "Monocle" },
    { id: "mustache", label: "Mustache" },
  ],
  suit: [
    { id: "jumpsuit", label: "Jumpsuit" },
    { id: "hazmat", label: "Hazmat" },
    { id: "vest", label: "Hi-vis vest" },
    { id: "tie", label: "Office tie" },
  ],
  accessory: [
    { id: "none", label: "Nothing" },
    { id: "tank", label: "Air tank" },
    { id: "backpack", label: "Backpack" },
    { id: "scarf", label: "Scarf" },
    { id: "badge", label: "Lanyard" },
    { id: "clipboard", label: "Clipboard" },
    { id: "cape", label: "Cape", unlock: true },
  ],
});

const LEDS = ["#9ff6ff", "#b6ff9a", "#ffe07a", "#ffb0d9", "#ffffff"];
const KNITS = ["#e63946", "#2a9d8f", "#f4a261", "#8d5cf6", "#3a86ff", "#ff7b00"];
const INK = "#0c0d12";
const GLASS = "#121821";
const GEAR = "#2a2c33";

// ------------------------------------------------------------------ identity

/** FNV-1a: a stable 32-bit number for a string. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded random number generator (0..1). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (random, list) => list[Math.floor(random() * list.length)];

/** The appearance an id gets when nobody has chosen one: same id, same look, on every screen. */
export function appearanceFor(id) {
  const random = seeded(hashString(String(id)));
  const choose = (slot) => pick(random, SLOTS[slot].filter((o) => !o.unlock)).id;
  return { hat: choose("hat"), face: choose("face"), suit: choose("suit"), accessory: choose("accessory"), led: pick(random, LEDS), knit: pick(random, KNITS) };
}

const known = (slot, id) => SLOTS[slot].some((o) => o.id === id);

/**
 * A character: identity plus appearance. `appearance` overrides any slot (unknown values are
 * ignored, so a stale cosmetic can never break drawing).
 */
export function createCharacter({ id, name = "", color = "#ffd400", appearance = {} } = {}) {
  const base = appearanceFor(id);
  const look = { ...base };
  for (const slot of Object.keys(SLOTS)) if (known(slot, appearance[slot])) look[slot] = appearance[slot];
  if (typeof appearance.led === "string" && /^#[0-9a-f]{6}$/i.test(appearance.led)) look.led = appearance.led;
  if (typeof appearance.knit === "string" && /^#[0-9a-f]{6}$/i.test(appearance.knit)) look.knit = appearance.knit;
  const suit = /^#[0-9a-f]{6}$/i.test(color) ? color : "#ffd400";
  return Object.freeze({
    id: String(id),
    name,
    seed: hashString(String(id)),
    appearance: Object.freeze(look),
    // The helmet is a pale tint of the suit, so the whole silhouette reads as the player's colour.
    colors: Object.freeze({ suit, dark: shade(suit, -0.38), light: shade(suit, 0.3), helmet: shade(suit, 0.62), helmetShade: shade(suit, 0.22), led: look.led, knit: look.knit }),
  });
}

// ------------------------------------------------------------------ colour

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes a colour toward black (amount < 0) or white (amount > 0). */
export function shade(hex, amount) {
  const target = amount < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(amount));
  const [r, g, b] = rgb(hex).map((c) => Math.round(c + (target - c) * k));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ------------------------------------------------------------------ drawing helpers

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function paint(ctx, fill, line = INK, width = 1.4) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** A limb from a pivot, `angle` radians forward (0 = straight down), `length` long. */
function limb(ctx, px, py, angle, length, width, fill, end, line) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-angle);
  rr(ctx, -width / 2, -width / 2, width, length + width / 2, width / 2);
  paint(ctx, fill, line);
  if (end) {
    rr(ctx, -width / 2, length - 2.4, width, 2.4 + width / 2, width / 2);
    paint(ctx, end, null);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ poses

const TAU = Math.PI * 2;

/** Joint angles for a state. Pure numbers, so every game's animations look alike. */
export function jointsFor(state, t = 0, cycle = 0) {
  const p = cycle * TAU;
  const j = { frontLeg: 0, backLeg: 0, legLength: 7, frontArm: 0.15, backArm: -0.15, bob: 0, lean: 0, eyes: "dot", item: null, itemAngle: 0, ghost: false };
  switch (state) {
    case "run":
      j.frontLeg = Math.sin(p) * 0.85;
      j.backLeg = -Math.sin(p) * 0.85;
      j.frontArm = -Math.sin(p) * 0.95;
      j.backArm = Math.sin(p) * 0.95;
      j.bob = -Math.abs(Math.sin(p)) * 1.3;
      j.lean = 0.12;
      break;
    case "jump":
      j.frontLeg = 0.7;
      j.backLeg = -0.25;
      j.legLength = 5.2;
      j.frontArm = 2.0;
      j.backArm = 2.5;
      j.eyes = "wide";
      break;
    case "fall":
      j.frontLeg = 0.4 + Math.sin(t * 16) * 0.1;
      j.backLeg = -0.4 - Math.sin(t * 16) * 0.1;
      j.frontArm = 1.85 + Math.sin(t * 19) * 0.3;
      j.backArm = 2.3 - Math.sin(t * 19) * 0.3;
      j.eyes = "wide";
      break;
    case "land":
      j.frontLeg = 0.35;
      j.backLeg = -0.35;
      j.legLength = 5;
      j.frontArm = 0.7;
      j.backArm = -0.6;
      j.eyes = "closed";
      break;
    case "slide":
      j.frontLeg = 0.75;
      j.backLeg = 0.45;
      j.frontArm = -0.9;
      j.backArm = -0.6;
      j.lean = -0.2;
      j.eyes = "wide";
      break;
    case "slip":
      j.frontLeg = Math.sin(p * 1.7) * 1.0;
      j.backLeg = -Math.sin(p * 1.7) * 1.0;
      j.frontArm = 1.6 + Math.sin(t * 22) * 0.6;
      j.backArm = 2.2 - Math.sin(t * 22) * 0.6;
      j.lean = -0.16;
      j.eyes = "wide";
      break;
    case "draw":
      j.frontArm = 1.35 + Math.sin(t * 18) * 0.12;
      j.backArm = 0.35;
      j.item = "pencil";
      j.eyes = "focus";
      break;
    case "place": {
      // A hammer: raised, then a strike, then it rests.
      const k = Math.min(1, t / 0.22);
      j.frontArm = 2.7 - 2.1 * k * k;
      j.backArm = 0.3;
      j.item = "hammer";
      j.eyes = "focus";
      j.lean = 0.08 * k;
      break;
    }
    case "hit":
      j.frontArm = 1.9;
      j.backArm = 2.6;
      j.frontLeg = 0.5;
      j.backLeg = -0.5;
      j.lean = -0.3;
      j.eyes = "hurt";
      break;
    case "dead":
      j.frontArm = 0.6 + Math.sin(t * 3) * 0.2;
      j.backArm = 0.4 - Math.sin(t * 3) * 0.2;
      j.bob = Math.sin(t * 3) * 1.2;
      j.eyes = "x";
      j.ghost = true;
      break;
    case "escape":
      j.frontArm = 2.1;
      j.backArm = 2.7;
      j.frontLeg = 0.6;
      j.backLeg = -0.3;
      j.legLength = 5.5;
      j.eyes = "happy";
      break;
    case "cheer":
      j.frontArm = 2.05 + Math.sin(t * 10) * 0.25;
      j.backArm = 2.6 - Math.sin(t * 10) * 0.25;
      j.bob = -Math.abs(Math.sin(t * 7)) * 3;
      j.eyes = "happy";
      break;
    case "sad":
      j.frontArm = -0.05;
      j.backArm = 0.05;
      j.bob = 1;
      j.lean = 0.14;
      j.eyes = "sad";
      break;
    default:
      // idle: breathing, and a look around now and then.
      j.bob = Math.sin(t * 2.4) * 0.45;
      j.frontArm = 0.12 + Math.sin(t * 2.4) * 0.05;
      j.backArm = -0.12 - Math.sin(t * 2.4) * 0.05;
  }
  return j;
}

// ------------------------------------------------------------------ parts

function drawEyes(ctx, kind, led, face, blink) {
  const eyes = [
    [3.2, -26],
    [7.8, -26],
  ];
  ctx.save();
  ctx.fillStyle = led;
  ctx.strokeStyle = led;
  ctx.lineCap = "round";
  ctx.lineWidth = 1.3;
  const shape = blink && (kind === "dot" || kind === "focus") ? "closed" : kind;
  // Shades hide ordinary eyes; big feelings still shine through.
  if (face === "shades" && (shape === "dot" || shape === "closed" || shape === "focus")) {
    ctx.restore();
    return;
  }
  for (const [x, y] of eyes) {
    ctx.beginPath();
    switch (shape) {
      case "wide":
        ctx.arc(x, y, 1.9, 0, TAU);
        ctx.fill();
        break;
      case "closed":
        ctx.moveTo(x - 1.5, y);
        ctx.lineTo(x + 1.5, y);
        ctx.stroke();
        break;
      case "focus":
        ctx.moveTo(x - 1.5, y + 0.6);
        ctx.lineTo(x + 1.5, y - 0.2);
        ctx.stroke();
        break;
      case "x":
        ctx.moveTo(x - 1.4, y - 1.4);
        ctx.lineTo(x + 1.4, y + 1.4);
        ctx.moveTo(x + 1.4, y - 1.4);
        ctx.lineTo(x - 1.4, y + 1.4);
        ctx.stroke();
        break;
      case "happy":
        ctx.arc(x, y + 1, 1.6, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        break;
      case "sad":
        ctx.arc(x, y - 1.2, 1.6, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        break;
      case "hurt": {
        const d = x < 5 ? 1 : -1;
        ctx.moveTo(x - 1.4 * d, y - 1.3);
        ctx.lineTo(x + 1.2 * d, y);
        ctx.lineTo(x - 1.4 * d, y + 1.3);
        ctx.stroke();
        break;
      }
      default:
        ctx.arc(x, y, 1.45, 0, TAU);
        ctx.fill();
    }
  }
  ctx.restore();
}

function drawHead(ctx, ch, j, blink, line) {
  const { face } = ch.appearance;
  // Helmet with a stripe in the suit colour.
  ctx.beginPath();
  ctx.ellipse(0, -26, 11.5, 10.5, 0, 0, TAU);
  paint(ctx, ch.colors.helmet, line);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, -26, 11.5, 10.5, 0, 0, TAU);
  ctx.clip();
  ctx.fillStyle = ch.colors.helmetShade;
  ctx.fillRect(-12, -20, 24, 6);
  ctx.fillStyle = ch.colors.dark;
  ctx.fillRect(-12, -33.5, 24, 2.6);
  // A highlight: it's glossy.
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath();
  ctx.ellipse(-5, -31, 3.5, 2, -0.5, 0, TAU);
  ctx.fill();
  ctx.restore();

  // Visor glass (or goggles), then the eyes behind it.
  if (face === "goggles") {
    for (const x of [3.2, 7.9]) {
      ctx.beginPath();
      ctx.arc(x, -26, 3.3, 0, TAU);
      paint(ctx, GLASS, "#b08a3e", 1.5);
    }
    ctx.fillStyle = "#b08a3e";
    ctx.fillRect(-11, -26.8, 11, 1.6);
  } else {
    rr(ctx, -2.5, -31, 13.6, 10, 4.2);
    paint(ctx, face === "shades" ? "#050608" : GLASS, line);
  }
  drawEyes(ctx, j.eyes, ch.colors.led, face, blink);
  // Glass glint.
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -29.5);
  ctx.lineTo(3.5, -29.5);
  ctx.stroke();

  if (face === "monocle") {
    ctx.beginPath();
    ctx.arc(7.9, -26, 3.2, 0, TAU);
    ctx.strokeStyle = "#e0b64a";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10.6, -24);
    ctx.quadraticCurveTo(12, -19, 9, -16);
    ctx.stroke();
  }
  if (face === "mustache") {
    ctx.fillStyle = "#3b2618";
    ctx.beginPath();
    ctx.ellipse(3.2, -19.6, 3.2, 1.3, -0.2, 0, TAU);
    ctx.ellipse(8.6, -19.6, 3.2, 1.3, 0.2, 0, TAU);
    ctx.fill();
  }
}

function drawHat(ctx, ch, t, state, line) {
  const { hat } = ch.appearance;
  const knit = ch.colors.knit;
  ctx.save();
  switch (hat) {
    case "hardhat":
      ctx.beginPath();
      ctx.arc(0, -33, 10, Math.PI, 0);
      ctx.closePath();
      paint(ctx, "#ffd400", line);
      rr(ctx, -12.5, -34, 25, 2.8, 1.2);
      paint(ctx, "#e6b800", line, 1);
      ctx.fillStyle = "#111";
      ctx.fillRect(-1, -42, 2, 7);
      break;
    case "beanie":
      ctx.beginPath();
      ctx.arc(0, -32, 10.5, Math.PI, 0);
      ctx.closePath();
      paint(ctx, knit, line);
      rr(ctx, -11, -34, 22, 3.6, 1.5);
      paint(ctx, shade(knit, -0.25), line, 1);
      ctx.beginPath();
      ctx.arc(0, -43.5, 2.8, 0, TAU);
      paint(ctx, "#f2efe8", line, 1);
      break;
    case "cap":
      ctx.beginPath();
      ctx.arc(0, -32.5, 10, Math.PI, 0);
      ctx.closePath();
      paint(ctx, knit, line);
      rr(ctx, 4, -34, 12, 3, 1.4);
      paint(ctx, shade(knit, -0.3), line, 1);
      ctx.fillStyle = "#ffd400";
      ctx.fillRect(-3, -39, 4, 3);
      break;
    case "antenna": {
      const glow = Math.sin(t * 5) > 0;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-2, -36);
      ctx.quadraticCurveTo(-4, -42, -1, -46);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-1, -47, 2.2, 0, TAU);
      paint(ctx, glow ? "#ff4d4d" : "#8a2020", line, 1);
      break;
    }
    case "cone":
      ctx.beginPath();
      ctx.moveTo(-8.5, -33.5);
      ctx.lineTo(0, -51);
      ctx.lineTo(8.5, -33.5);
      ctx.closePath();
      paint(ctx, "#ff7a1a", line);
      ctx.fillStyle = "#f7f3ea";
      ctx.beginPath();
      ctx.moveTo(-5.4, -40);
      ctx.lineTo(5.4, -40);
      ctx.lineTo(4.2, -42.6);
      ctx.lineTo(-4.2, -42.6);
      ctx.closePath();
      ctx.fill();
      rr(ctx, -11, -35, 22, 2.6, 1);
      paint(ctx, "#e05f00", line, 1);
      break;
    case "propeller": {
      ctx.beginPath();
      ctx.arc(0, -33, 9.5, Math.PI, 0);
      ctx.closePath();
      paint(ctx, knit, line);
      ctx.fillStyle = INK;
      ctx.fillRect(-0.7, -46, 1.4, 4);
      // Spins in the air, idles on the ground.
      const airborne = state === "jump" || state === "fall" || state === "escape" || state === "slip";
      const spin = Math.cos(t * (airborne ? 40 : 3));
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.ellipse(-5 * spin, -46, 5 * Math.abs(spin) + 0.6, 1.3, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#3a86ff";
      ctx.beginPath();
      ctx.ellipse(5 * spin, -46, 5 * Math.abs(spin) + 0.6, 1.3, 0, 0, TAU);
      ctx.fill();
      break;
    }
    case "cob":
      // A corn cob, husk and all. CPI standard issue (it is not).
      ctx.beginPath();
      ctx.ellipse(0, -41, 5.5, 9, 0, 0, TAU);
      paint(ctx, "#ffd23f", line);
      ctx.fillStyle = "#e0a800";
      for (let row = 0; row < 5; row++) for (let col = -1; col <= 1; col++) ctx.fillRect(col * 3 - 0.8, -48 + row * 3.2, 1.6, 1.4);
      ctx.fillStyle = "#4caf50";
      ctx.beginPath();
      ctx.moveTo(-9, -33);
      ctx.quadraticCurveTo(-7, -42, -2, -44);
      ctx.quadraticCurveTo(-4, -38, -1, -33);
      ctx.closePath();
      ctx.moveTo(9, -33);
      ctx.quadraticCurveTo(7, -42, 2, -44);
      ctx.quadraticCurveTo(4, -38, 1, -33);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case "headset":
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, -27, 12, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      rr(ctx, -4, -30, 5, 8, 2);
      paint(ctx, "#2f3440", line, 1);
      ctx.strokeStyle = "#2f3440";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-1, -23);
      ctx.quadraticCurveTo(4, -17, 9, -18.5);
      ctx.stroke();
      ctx.fillStyle = "#ff4d4d";
      ctx.fillRect(8.5, -19.5, 2, 2);
      break;
    case "chef":
      rr(ctx, -8, -40, 16, 7, 1.5);
      paint(ctx, "#fbfaf6", line);
      ctx.beginPath();
      ctx.arc(-5, -42, 4.6, 0, TAU);
      ctx.arc(0, -45, 5.2, 0, TAU);
      ctx.arc(5, -42, 4.6, 0, TAU);
      paint(ctx, "#fbfaf6", line, 1.2);
      rr(ctx, -8, -40, 16, 7, 1.5);
      paint(ctx, "#fbfaf6", null);
      break;
    case "tophat":
      rr(ctx, -6.5, -49, 13, 14, 1.2);
      paint(ctx, "#1c1c22", line);
      ctx.fillStyle = ch.colors.suit;
      ctx.fillRect(-6.5, -38.5, 13, 2.4);
      rr(ctx, -10.5, -36, 21, 2.6, 1.2);
      paint(ctx, "#1c1c22", line, 1);
      break;
    case "crown":
      ctx.beginPath();
      ctx.moveTo(-8, -34);
      ctx.lineTo(-8, -43);
      ctx.lineTo(-4, -38.5);
      ctx.lineTo(0, -45);
      ctx.lineTo(4, -38.5);
      ctx.lineTo(8, -43);
      ctx.lineTo(8, -34);
      ctx.closePath();
      paint(ctx, "#ffcc33", line);
      ctx.fillStyle = "#e63946";
      ctx.beginPath();
      ctx.arc(0, -37, 1.5, 0, TAU);
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawBackAccessory(ctx, ch, j, t, speed, line) {
  const { accessory } = ch.appearance;
  const flutter = Math.sin(t * 14) * Math.min(1, speed / 300);
  if (accessory === "tank") {
    rr(ctx, -12, -19, 5.5, 12, 2.5);
    paint(ctx, "#c9ced6", line);
    ctx.fillStyle = "#e63946";
    ctx.fillRect(-12, -17, 5.5, 1.6);
  } else if (accessory === "backpack") {
    rr(ctx, -13, -18, 7, 11, 2.2);
    paint(ctx, "#6b5a3e", line);
    ctx.fillStyle = "#ffd400";
    ctx.fillRect(-12, -14, 5, 1.4);
  } else if (accessory === "cape") {
    const trail = 4 + Math.min(10, speed / 40);
    ctx.beginPath();
    ctx.moveTo(-6, -17);
    ctx.quadraticCurveTo(-8 - trail, -10 + flutter * 3, -9 - trail, -3 + flutter * 2);
    ctx.lineTo(-3, -5);
    ctx.closePath();
    paint(ctx, "#b3122e", line, 1.1);
  } else if (accessory === "scarf") {
    const trail = 3 + Math.min(9, speed / 45);
    ctx.beginPath();
    ctx.moveTo(-5, -17);
    ctx.quadraticCurveTo(-7 - trail, -18 + flutter * 3, -9 - trail, -14 + flutter * 4);
    ctx.lineTo(-7 - trail, -12.5 + flutter * 3);
    ctx.quadraticCurveTo(-6, -15, -4, -15);
    ctx.closePath();
    paint(ctx, ch.colors.knit, line, 1.1);
  }
}

function drawSuit(ctx, ch, line) {
  const { suit } = ch.appearance;
  rr(ctx, -8, -18.5, 16, 13.5, 4);
  paint(ctx, ch.colors.suit, line);
  // Shading: darker below the belt, a light edge on top.
  ctx.save();
  rr(ctx, -8, -18.5, 16, 13.5, 4);
  ctx.clip();
  ctx.fillStyle = ch.colors.dark;
  ctx.fillRect(-8, -9, 16, 4);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(-8, -18.5, 16, 2);
  if (suit === "hazmat") {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(-1, -17, 8, 7);
    ctx.fillStyle = INK;
    ctx.fillRect(1, -15, 4, 1);
    ctx.fillRect(1, -13, 4, 1);
  } else if (suit === "vest") {
    // Straps and a reflective band: hi-vis without hiding whose colour it is.
    ctx.fillStyle = "#c6ff00";
    ctx.fillRect(-6, -18.5, 3, 9);
    ctx.fillRect(3, -18.5, 3, 9);
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(-8, -12.5, 16, 1.8);
  } else if (suit === "tie") {
    ctx.fillStyle = "#f2efe8";
    ctx.beginPath();
    ctx.moveTo(1, -18.5);
    ctx.lineTo(8, -18.5);
    ctx.lineTo(5, -13);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#b3122e";
    ctx.beginPath();
    ctx.moveTo(4, -18);
    ctx.lineTo(6, -18);
    ctx.lineTo(6.6, -11);
    ctx.lineTo(5, -9.5);
    ctx.lineTo(3.4, -11);
    ctx.closePath();
    ctx.fill();
  } else {
    // Jumpsuit: a belt and the CPI patch.
    ctx.fillStyle = GEAR;
    ctx.fillRect(-8, -10, 16, 1.6);
    ctx.fillStyle = "#ffd400";
    ctx.fillRect(2.5, -16.5, 3.5, 3.5);
    ctx.fillStyle = INK;
    ctx.fillRect(3.5, -15.5, 1.5, 1.5);
  }
  ctx.restore();
  if (ch.appearance.accessory === "badge") {
    ctx.strokeStyle = "#e63946";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-3, -18.5);
    ctx.lineTo(3, -12);
    ctx.lineTo(7, -18.5);
    ctx.stroke();
    rr(ctx, 1.2, -12.5, 4.4, 5, 0.8);
    paint(ctx, "#f2efe8", line, 0.8);
  }
}

function drawItem(ctx, item, angle) {
  if (!item) return;
  ctx.save();
  // At the front hand: the end of an 8-unit arm from the shoulder.
  ctx.translate(4, -16);
  ctx.rotate(-angle);
  ctx.translate(0, 8);
  if (item === "pencil") {
    ctx.rotate(-0.9);
    rr(ctx, -1.3, -2, 2.6, 11, 0.8);
    paint(ctx, "#ffd400", INK, 0.9);
    ctx.fillStyle = "#f1c9a0";
    ctx.beginPath();
    ctx.moveTo(-1.3, 9);
    ctx.lineTo(1.3, 9);
    ctx.lineTo(0, 12);
    ctx.closePath();
    ctx.fill();
  } else if (item === "clipboard") {
    ctx.rotate(0.5);
    rr(ctx, -3, -1, 6, 8, 0.8);
    paint(ctx, "#a0784a", INK, 0.9);
    ctx.fillStyle = "#f2efe8";
    ctx.fillRect(-2, 0.5, 4, 5.5);
    ctx.fillStyle = "#9aa3ad";
    ctx.fillRect(-1.2, -1.6, 2.4, 1.4);
  } else if (item === "hammer") {
    ctx.rotate(-1.4);
    rr(ctx, -1, -1, 2, 10, 0.8);
    paint(ctx, "#8b5a2b", INK, 0.9);
    rr(ctx, -3.5, 8, 7, 3.4, 0.8);
    paint(ctx, "#9aa3ad", INK, 0.9);
  }
  ctx.restore();
}

function drawEffects(ctx, effects, t) {
  if (!effects?.length) return;
  for (const effect of effects) {
    if (effect === "stunned") {
      ctx.fillStyle = "#ffe066";
      for (let i = 0; i < 3; i++) {
        const a = t * 6 + (i * TAU) / 3;
        const x = Math.cos(a) * 10;
        const y = -40 + Math.sin(a) * 3;
        star(ctx, x, y, 2.4);
      }
    } else if (effect === "sparkle") {
      ctx.fillStyle = "#fffbe0";
      for (let i = 0; i < 4; i++) {
        const k = (t * 1.6 + i / 4) % 1;
        const a = i * 1.9 + 0.6;
        const s = Math.sin(k * Math.PI) * 2.6;
        star(ctx, Math.cos(a) * 15, -20 + Math.sin(a) * 18, s);
      }
    } else if (effect === "speed") {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const y = -26 + i * 8;
        const off = ((t * 90 + i * 11) % 14) - 4;
        ctx.moveTo(-14 - off, y);
        ctx.lineTo(-24 - off, y);
      }
      ctx.stroke();
    } else if (effect === "sweat") {
      ctx.fillStyle = "#9ff6ff";
      const k = (t * 2) % 1;
      ctx.beginPath();
      ctx.ellipse(-9, -32 + k * 6, 1.4, 2, 0, 0, TAU);
      ctx.fill();
    }
  }
}

function star(ctx, x, y, r) {
  if (r <= 0.1) return;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const k = i % 2 ? r * 0.35 : r;
    ctx.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
  }
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------ the character

/**
 * Draws a character into its box. pose: { x, y, w, h } (the box, in the context's units),
 * facing (1 right, -1 left), state, t (seconds in that state), cycle (run cycle, any real number),
 * squash (1 = normal; < 1 squashed), scale (extra, about the feet), alpha, lean (extra radians),
 * speed (units/s, for scarves and capes), clock (seconds, for blinking), effects (["sparkle", …]),
 * outline (colour, e.g. white for "this is you"), flash (true: a white outline, for a hit).
 */
export function drawCharacter(ctx, ch, pose) {
  const { x = 0, y = 0, w = BOX.w, h = BOX.h, facing = 1, state = "idle", t = 0, cycle = 0, squash = 1, scale = 1, alpha = 1, lean = 0, speed = 0, clock = t, effects = [], flash = false } = pose;
  const outline = flash ? "#ffffff" : (pose.outline ?? INK);
  if (alpha <= 0.01 || scale <= 0.01) return;
  const j = jointsFor(state, t, cycle);
  const k = (h / BOX.h) * scale;
  const blink = (clock + (ch.seed % 1000) / 250) % 3.7 < 0.13;
  ctx.save();
  ctx.globalAlpha *= j.ghost ? alpha * 0.55 : alpha;
  ctx.translate(x + w / 2, y + h);
  ctx.scale(k * (1 + (1 - squash) * 0.8), k * squash);
  ctx.rotate((lean + j.lean) * (facing < 0 ? -1 : 1));
  if (facing < 0) ctx.scale(-1, 1);
  ctx.translate(0, j.bob);
  ctx.lineJoin = "round";

  // A soft ground shadow keeps feet readable on busy floors.
  if (!j.ghost && state !== "jump" && state !== "fall" && state !== "escape") {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(0, -j.bob + 0.5, 10, 2, 0, 0, TAU);
    ctx.fill();
  }

  drawBackAccessory(ctx, ch, j, clock, speed, outline);
  limb(ctx, -3.5, -16, j.backArm, 8, 4.2, ch.colors.dark, GEAR, outline);
  if (j.ghost) {
    // No legs on a ghost: a wavy tail instead.
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    for (let i = 0; i <= 4; i++) ctx.lineTo(-8 + i * 4, -2 + (i % 2 ? -2 : 1) + Math.sin(clock * 6 + i) * 0.8);
    ctx.lineTo(8, -8);
    ctx.closePath();
    paint(ctx, ch.colors.dark, outline, 1.1);
  } else {
    limb(ctx, -3, -7, j.backLeg, j.legLength, 5, ch.colors.dark, GEAR, outline);
    limb(ctx, 3, -7, j.frontLeg, j.legLength, 5, ch.colors.suit, GEAR, outline);
  }
  drawSuit(ctx, ch, outline);
  drawHead(ctx, ch, j, blink, outline);
  drawHat(ctx, ch, clock, state, outline);
  if (ch.appearance.accessory === "clipboard" && !j.item) drawItem(ctx, "clipboard", j.frontArm);
  limb(ctx, 4, -16, j.frontArm, 8, 4.2, ch.colors.suit, GEAR, outline);
  drawItem(ctx, j.item, j.frontArm);
  drawEffects(ctx, effects, clock);
  ctx.restore();
}

/**
 * A character on its own little canvas, for rosters, intros and results. `size` is the CSS height
 * in px; call the returned canvas's `paint(pose)` to redraw it (e.g. every frame in an intro).
 */
export function characterCanvas(ch, { size = 48, state = "idle", facing = 1, t = 0, label = null } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "cpi-char";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label ?? `${ch.name || "Agent"}'s character`);
  canvas.style.setProperty("height", `${size}px`);
  canvas.style.setProperty("width", `${Math.round(size * 0.9)}px`);
  const paintAt = (pose = {}) => {
    const { width, height, dpr } = fitCanvas(canvas);
    if (!width || !height) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // The box sits low with room above for hats and raised arms.
    const h = height * 0.62;
    const w = h * (BOX.w / BOX.h);
    drawCharacter(ctx, ch, { x: (width - w) / 2, y: height * 0.96 - h, w, h, facing, state, t, clock: t, ...pose });
  };
  canvas.paint = paintAt;
  // Painted once it's laid out (a canvas has no size before it's in the document).
  requestAnimationFrame(() => paintAt());
  return canvas;
}
