// CPI bird characters: round, angry, original CPI birds drawn procedurally on a canvas. A bird is
// a look (colours and features, see thud-birds.js) plus a pose; any CPI game can use them. A person
// from the CPI character system becomes a bird with the same hair colour, glasses and clothes (see
// birdLookFromPerson in thud-birds.js), so identities carry across games.
//
//   drawBird(ctx, look, { x, y, r, angle, state: "fly", t, blink, squash, facing })
//   birdCanvas(look, { size: 64, state: "idle" })   // a <canvas> badge for the DOM
//
// Units: the bird is a circle of radius r centred on (x, y); crests, beaks and tails poke out.

import { fitCanvas } from "../drawing-canvas.js";
import { shade } from "./character.js";

const INK = "#15121a";
const TAU = Math.PI * 2;

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function fillStroke(ctx, fill, line = INK, width = 0.06) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

/** Crests sit on top of the head (unit circle space: y −1 is the top). */
function drawCrest(ctx, look, t) {
  const c = look.crestColor ?? shade(look.body ?? "#888888", -0.3);
  switch (look.crest) {
    case "popcorn":
      for (const [x, y, r] of [[-0.3, -0.95, 0.24], [0.02, -1.08, 0.28], [0.34, -0.93, 0.22], [0.16, -1.25, 0.18]]) {
        circle(ctx, x, y, r);
        fillStroke(ctx, c, INK, 0.05);
        circle(ctx, x - r * 0.3, y - r * 0.3, r * 0.3);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fill();
      }
      break;
    case "spikes":
      ctx.beginPath();
      ctx.moveTo(-0.55, -0.72);
      for (let i = 0; i < 4; i++) {
        const x = -0.55 + i * 0.32;
        ctx.lineTo(x + 0.06 - 0.25, -1.35 + (i % 2) * 0.12);
        ctx.lineTo(x + 0.3, -0.8);
      }
      ctx.closePath();
      fillStroke(ctx, c, INK, 0.05);
      break;
    case "mohawk":
      ctx.beginPath();
      ctx.moveTo(-0.35, -0.9);
      for (let i = 0; i <= 5; i++) ctx.lineTo(-0.35 + i * 0.14, -1.28 - Math.sin(i * 1.3 + t * 6) * 0.05 - (i % 2) * 0.1);
      ctx.lineTo(0.35, -0.9);
      ctx.closePath();
      fillStroke(ctx, c, INK, 0.05);
      break;
    case "tuft":
      for (const [dx, a] of [[-0.12, -0.5], [0.05, 0], [0.2, 0.45]]) {
        ctx.save();
        ctx.translate(dx, -0.95);
        ctx.rotate(a + Math.sin(t * 4 + dx * 10) * 0.08);
        ctx.beginPath();
        ctx.ellipse(0, -0.2, 0.08, 0.26, 0, 0, TAU);
        fillStroke(ctx, c, INK, 0.04);
        ctx.restore();
      }
      break;
    case "curl":
      ctx.beginPath();
      ctx.arc(0.05, -1.05, 0.22, Math.PI * 0.2, Math.PI * 1.9);
      ctx.strokeStyle = c;
      ctx.lineWidth = 0.14;
      ctx.lineCap = "round";
      ctx.stroke();
      break;
    case "feather":
      ctx.save();
      ctx.translate(0.1, -0.95);
      ctx.rotate(0.5 + Math.sin(t * 3) * 0.1);
      ctx.beginPath();
      ctx.ellipse(0, -0.35, 0.12, 0.42, 0, 0, TAU);
      fillStroke(ctx, c, INK, 0.04);
      ctx.restore();
      break;
    case "helmet":
      ctx.beginPath();
      ctx.arc(0, -0.2, 0.92, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineTo(0.9, -0.28);
      ctx.lineTo(-0.9, -0.28);
      ctx.closePath();
      fillStroke(ctx, c, INK, 0.06);
      ctx.fillStyle = shade(c, 0.35);
      ctx.fillRect(-0.55, -0.95, 0.35, 0.08);
      break;
    default:
      break;
  }
}

function drawAccessory(ctx, look) {
  const c = look.accessoryColor ?? "#ffd400";
  switch (look.accessory) {
    case "scarf":
      ctx.beginPath();
      ctx.ellipse(-0.05, 0.55, 0.78, 0.18, 0.05, 0, TAU);
      fillStroke(ctx, c, INK, 0.05);
      ctx.beginPath();
      ctx.moveTo(-0.6, 0.55);
      ctx.lineTo(-1.15, 0.72);
      ctx.lineTo(-1.1, 0.5);
      ctx.closePath();
      fillStroke(ctx, c, INK, 0.05);
      break;
    case "headband":
      ctx.beginPath();
      ctx.ellipse(0, -0.62, 0.86, 0.14, 0, Math.PI, TAU);
      ctx.lineWidth = 0.16;
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.85, -0.62);
      ctx.lineTo(-1.2, -0.45);
      ctx.moveTo(-0.85, -0.62);
      ctx.lineTo(-1.15, -0.78);
      ctx.stroke();
      break;
    case "medal":
      ctx.beginPath();
      ctx.moveTo(-0.2, 0.3);
      ctx.lineTo(0, 0.6);
      ctx.lineTo(0.2, 0.3);
      ctx.strokeStyle = "#d33";
      ctx.lineWidth = 0.08;
      ctx.stroke();
      circle(ctx, 0, 0.66, 0.14);
      fillStroke(ctx, c, INK, 0.04);
      break;
    case "tie":
      ctx.beginPath();
      ctx.moveTo(0, 0.38);
      ctx.lineTo(0.12, 0.5);
      ctx.lineTo(0.06, 0.92);
      ctx.lineTo(0, 0.98);
      ctx.lineTo(-0.06, 0.92);
      ctx.lineTo(-0.12, 0.5);
      ctx.closePath();
      fillStroke(ctx, c, INK, 0.04);
      break;
    case "bandana":
      ctx.beginPath();
      ctx.moveTo(-0.7, 0.42);
      ctx.quadraticCurveTo(0, 0.95, 0.7, 0.42);
      ctx.closePath();
      fillStroke(ctx, c, INK, 0.05);
      break;
    case "cap":
      ctx.beginPath();
      ctx.arc(0, -0.45, 0.7, Math.PI, TAU);
      ctx.closePath();
      fillStroke(ctx, c, INK, 0.05);
      ctx.beginPath();
      ctx.ellipse(0.55, -0.47, 0.45, 0.1, 0, 0, TAU);
      fillStroke(ctx, shade(c, -0.2), INK, 0.04);
      break;
    case "bicorne":
      ctx.beginPath();
      ctx.moveTo(-1.05, -0.62);
      ctx.quadraticCurveTo(0, -1.55, 1.05, -0.62);
      ctx.quadraticCurveTo(0, -0.85, -1.05, -0.62);
      fillStroke(ctx, "#1e2a55", INK, 0.05);
      circle(ctx, 0, -0.92, 0.1);
      fillStroke(ctx, c, null);
      break;
    case "beard":
      ctx.beginPath();
      ctx.moveTo(0.05, 0.25);
      ctx.quadraticCurveTo(0.55, 0.9, 0.95, 0.25);
      ctx.closePath();
      fillStroke(ctx, c, INK, 0.04);
      break;
    default:
      break;
  }
}

function drawEyes(ctx, look, { blink, state }) {
  const hurt = state === "hit" || state === "sad";
  const eyes = look.eyes ?? "round";
  const pos = [[0.12, -0.2], [0.52, -0.22]];
  if (eyes === "visor") {
    ctx.beginPath();
    ctx.ellipse(0.35, -0.2, 0.48, 0.17, -0.05, 0, TAU);
    fillStroke(ctx, "#9ff6ff", INK, 0.05);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(0.05, -0.3, 0.2, 0.05);
  } else {
    for (const [x, y] of pos) {
      circle(ctx, x, y, 0.2);
      fillStroke(ctx, "#ffffff", INK, 0.05);
      if (blink || hurt) {
        ctx.beginPath();
        ctx.moveTo(x - 0.12, y + (hurt ? -0.05 : 0));
        ctx.lineTo(x + 0.12, y + (hurt ? 0.05 : 0));
        if (hurt) {
          ctx.moveTo(x - 0.12, y + 0.05);
          ctx.lineTo(x + 0.12, y - 0.05);
        }
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.06;
        ctx.stroke();
      } else {
        circle(ctx, x + 0.06, y + 0.02, 0.09);
        ctx.fillStyle = INK;
        ctx.fill();
        circle(ctx, x + 0.09, y - 0.02, 0.03);
        ctx.fillStyle = "#fff";
        ctx.fill();
      }
    }
    if (eyes === "goggles" || eyes === "glasses" || eyes === "shades") {
      for (const [x, y] of pos) {
        circle(ctx, x, y, eyes === "goggles" ? 0.26 : 0.22);
        if (eyes === "shades") fillStroke(ctx, "rgba(10,10,20,0.92)", INK, 0.06);
        else {
          ctx.strokeStyle = eyes === "goggles" ? "#ffb000" : INK;
          ctx.lineWidth = eyes === "goggles" ? 0.09 : 0.06;
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.moveTo(0.3, -0.22);
      ctx.lineTo(0.34, -0.22);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.06;
      ctx.stroke();
      if (eyes === "goggles") {
        ctx.beginPath();
        ctx.moveTo(-0.1, -0.2);
        ctx.lineTo(-0.9, -0.1);
        ctx.strokeStyle = "#5a3a1a";
        ctx.lineWidth = 0.09;
        ctx.stroke();
      }
    }
  }
  // Brows: the attitude.
  const brow = look.brow ?? "angry";
  if (brow === "none") return;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.1;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (brow === "angry" || state === "fly") {
    ctx.moveTo(-0.08, -0.52);
    ctx.lineTo(0.3, -0.38);
    ctx.moveTo(0.36, -0.4);
    ctx.lineTo(0.72, -0.5);
  } else if (brow === "worried" || hurt) {
    ctx.moveTo(-0.05, -0.4);
    ctx.lineTo(0.28, -0.5);
    ctx.moveTo(0.4, -0.52);
    ctx.lineTo(0.7, -0.42);
  } else {
    ctx.moveTo(-0.05, -0.47);
    ctx.lineTo(0.28, -0.47);
    ctx.moveTo(0.38, -0.48);
    ctx.lineTo(0.7, -0.48);
  }
  ctx.stroke();
}

/**
 * Draws a bird. pose: x, y, r (radius), angle (radians, the way it's flying), facing (1 right,
 * −1 left), state ("idle" | "fly" | "hit" | "cheer" | "sad" | "sling"), t (seconds), blink,
 * squash (1 normal), alpha, outline (colour for a highlight ring).
 */
export function drawBird(ctx, look, pose = {}) {
  const { x = 0, y = 0, r = 16, angle = 0, facing = 1, state = "idle", t = 0, squash = 1, alpha = 1, outline = null } = pose;
  const blink = pose.blink ?? (t + (look.body?.length ?? 0)) % 3.3 < 0.12;
  const body = look.body ?? "#e84b3c";
  const belly = look.belly ?? shade(body, 0.6);
  const wing = look.wing ?? shade(body, -0.25);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (facing < 0) ctx.scale(-1, 1);
  const bob = state === "idle" || state === "cheer" ? Math.sin(t * (state === "cheer" ? 9 : 3)) * 0.05 : 0;
  ctx.scale(r * (2 - squash), r * squash);
  ctx.translate(0, bob);
  if (outline) {
    circle(ctx, 0, 0, 1.16);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.14;
    ctx.stroke();
  }
  // Tail.
  const tail = look.tail ?? "fan";
  if (tail !== "none") {
    ctx.beginPath();
    if (tail === "spike") {
      ctx.moveTo(-0.8, -0.1);
      ctx.lineTo(-1.45, -0.35);
      ctx.lineTo(-1.2, 0.02);
      ctx.lineTo(-1.45, 0.3);
      ctx.lineTo(-0.8, 0.2);
    } else {
      ctx.moveTo(-0.8, -0.15);
      ctx.lineTo(-1.35, -0.45);
      ctx.lineTo(-1.25, 0);
      ctx.lineTo(-1.4, 0.35);
      ctx.lineTo(-0.8, 0.18);
    }
    ctx.closePath();
    fillStroke(ctx, wing, INK, 0.06);
  }
  // Body.
  circle(ctx, 0, 0, 1);
  const grad = ctx.createRadialGradient(-0.35, -0.4, 0.1, 0, 0, 1.05);
  grad.addColorStop(0, shade(body, 0.28));
  grad.addColorStop(1, body);
  fillStroke(ctx, grad, INK, 0.08);
  // Pattern on the back.
  if (look.pattern === "spots" || look.pattern === "stripes") {
    ctx.save();
    circle(ctx, 0, 0, 0.96);
    ctx.clip();
    ctx.fillStyle = look.patternColor ?? shade(body, -0.15);
    if (look.pattern === "spots") for (const [sx, sy, sr] of [[-0.55, -0.35, 0.14], [-0.2, -0.7, 0.1], [-0.7, 0.1, 0.11]]) (circle(ctx, sx, sy, sr), ctx.fill());
    else for (let i = 0; i < 3; i++) ctx.fillRect(-1, -0.7 + i * 0.32, 0.9, 0.1);
    ctx.restore();
  }
  // Belly.
  ctx.beginPath();
  ctx.ellipse(0.12, 0.42, 0.66, 0.5, 0, 0, TAU);
  fillStroke(ctx, belly, null);
  drawCrest(ctx, look, t);
  // Wing: flapping in flight, up when cheering.
  const flap = state === "fly" ? Math.sin(t * 22) * 0.5 : state === "cheer" ? -0.8 + Math.sin(t * 10) * 0.3 : state === "sling" ? 0.3 : 0.1;
  ctx.save();
  ctx.translate(-0.25, 0.15);
  ctx.rotate(flap);
  ctx.beginPath();
  ctx.ellipse(-0.1, 0.1, 0.42, 0.26, -0.3, 0, TAU);
  fillStroke(ctx, wing, INK, 0.05);
  ctx.restore();
  drawAccessory(ctx, look);
  // Beak.
  const beak = look.beak ?? "#ffb000";
  const open = state === "fly" || state === "cheer" ? 0.14 : state === "hit" ? 0.2 : 0.03;
  ctx.beginPath();
  ctx.moveTo(0.72, -0.08);
  ctx.lineTo(1.28, 0.04);
  ctx.lineTo(0.72, 0.12);
  ctx.closePath();
  fillStroke(ctx, beak, INK, 0.05);
  ctx.beginPath();
  ctx.moveTo(0.72, 0.12 + open * 0.3);
  ctx.lineTo(1.12, 0.16 + open);
  ctx.lineTo(0.72, 0.3 + open * 0.5);
  ctx.closePath();
  fillStroke(ctx, shade(beak, -0.2), INK, 0.05);
  drawEyes(ctx, look, { blink, state });
  ctx.restore();
}

/** A bird on its own little canvas (select screens, rosters, results). Call `paint(pose)` to redraw. */
export function birdCanvas(look, { size = 64, state = "idle", label = "Bird" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "cpi-bird";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  canvas.style.setProperty("width", `${size}px`);
  canvas.style.setProperty("height", `${size}px`);
  const paint = (pose = {}) => {
    const { width, height, dpr } = fitCanvas(canvas);
    if (!width || !height) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawBird(ctx, look, { x: width * 0.47, y: height * 0.56, r: Math.min(width, height) * 0.3, state, ...pose });
  };
  canvas.paint = paint;
  requestAnimationFrame(() => paint());
  return canvas;
}

/** Keeps bird canvases animating while they're on screen. */
export function animateBirds(canvases, state = "idle") {
  const t0 = performance.now();
  const loop = () => {
    const live = canvases.filter((c) => c.isConnected);
    if (!live.length) return;
    const t = (performance.now() - t0) / 1000;
    live.forEach((c, i) => c.paint({ t: t + i * 0.4, state: c.dataset.state || state }));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
