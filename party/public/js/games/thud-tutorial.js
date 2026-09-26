// Angry Thud's Revenge: the first-time tutorial. Six short cards (thud-howto.js says what), each
// with a little animated scene drawn with the game's own art. It opens by itself once per browser,
// on a player's first game; after that the "?" on the device (or "How to play") brings it back.
// Skippable at any point: Skip, Esc, or just tapping outside it. Swipe, ← → or the buttons page.
// A modal <dialog>, so the game underneath doesn't take the taps or keys meanwhile.

import { el, store } from "../common.js";
import { drawBird } from "../cpi/bird.js";
import { fitCanvas } from "../drawing-canvas.js";
import { drawBuilding, drawPig, drawRedCow, drawSling } from "./thud-art.js";
import { lookFor } from "./thud-birds.js";
import { tutorialCards } from "./thud-howto.js";

const SEEN_KEY = "cpi-party:thud-tutorial-seen";

export const tutorialSeen = () => store.get("localStorage", SEEN_KEY) === true;
const markSeen = () => store.set("localStorage", SEEN_KEY, true);

let open = null;

/** Closes the tutorial if it's showing (say, because it's now your shot). */
export function closeTutorial() {
  open?.close();
}

/**
 * Shows the tutorial. `game` is the current game view (for the build timer and your bird);
 * `onClose` runs when it's dismissed however that happens.
 */
export function showTutorial(game, { me = null, onClose = null } = {}) {
  if (open) return open;
  const bird = game?.roster?.find((p) => p.id === me)?.bird ?? game?.you?.bird ?? null;
  const skin = game?.roster?.find((p) => p.id === me)?.skin ?? "classic";
  const cards = tutorialCards({ buildMs: game?.build?.buildMs, bird });
  let index = 0;

  const canvas = el("canvas", { class: "td-tut-art", "aria-hidden": "true" });
  const step = el("p", { class: "td-tut-step" });
  const title = el("h2", { class: "td-tut-title", id: "td-tut-title" });
  const list = el("ul", { class: "td-tut-lines" });
  const dots = el("div", { class: "td-tut-dots", "aria-hidden": "true" }, cards.map(() => el("span")));
  const back = el("button", { class: "btn ghost small", type: "button", text: "Back" });
  const next = el("button", { class: "btn small", type: "button" });
  const skip = el("button", { class: "td-tut-skip", type: "button", text: "Skip tutorial" });
  const card = el("div", { class: "td-tut-card" }, el("div", { class: "td-tut-head" }, step, skip), canvas, title, list, dots, el("div", { class: "td-tut-nav" }, back, next));
  const dialog = el("dialog", { class: "td-tutorial", "aria-labelledby": "td-tut-title" }, card);

  const paint = () => {
    const c = cards[index];
    step.textContent = `HOW TO PLAY · ${index + 1} / ${cards.length}`;
    title.textContent = c.title;
    list.replaceChildren(...c.lines.map((line) => el("li", { text: line })));
    dots.querySelectorAll("span").forEach((d, i) => d.classList.toggle("on", i === index));
    back.disabled = index === 0;
    next.textContent = index === cards.length - 1 ? "Let's go!" : "Next";
    startedAt = performance.now();
  };
  const go = (d) => {
    const to = index + d;
    if (to < 0) return;
    if (to >= cards.length) return dialog.close();
    index = to;
    paint();
  };
  back.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
  skip.addEventListener("click", () => dialog.close());
  // Tapping the backdrop (outside the card) skips too; a swipe that strays off the card doesn't.
  let downOutside = false;
  dialog.addEventListener("pointerdown", (e) => (downOutside = e.target === dialog));
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog && downOutside) dialog.close();
  });
  // Keys page the cards and never reach the game underneath.
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key !== "Escape" && e.key !== "Enter" && e.key !== " " && e.key !== "Tab") e.preventDefault();
    e.stopPropagation();
  });
  // Swipe between cards.
  let swipe = null;
  card.addEventListener("pointerdown", (e) => (swipe = { x: e.clientX, y: e.clientY }));
  card.addEventListener("pointerup", (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  });
  dialog.addEventListener("close", () => {
    markSeen();
    dialog.remove();
    open = null;
    onClose?.();
  });

  // The little scene for each card.
  let startedAt = performance.now();
  const look = lookFor(bird ?? "popcorn", skin);
  const friend = lookFor("anvil", "classic");
  const loop = (now) => {
    if (!dialog.isConnected) return;
    requestAnimationFrame(loop);
    const { width, height, dpr } = fitCanvas(canvas, 2);
    if (!width || !height) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const k = Math.min(width / 360, height / 150);
    ctx.translate((width - 360 * k) / 2, (height - 150 * k) / 2);
    ctx.scale(k, k);
    scene(ctx, cards[index].id, (now - startedAt) / 1000, { look, friend });
  };

  paint();
  document.body.append(dialog);
  dialog.showModal();
  next.focus();
  requestAnimationFrame(loop);
  open = { close: () => dialog.open && dialog.close() };
  return open;
}

// ------------------------------------------------------------------ scenes (360 × 150 units)

const GROUND = 128;

function sky(ctx, top = "#6fbdf0", bottom = "#fde7b6") {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 360, GROUND);
  ctx.fillStyle = "#6d8f3a";
  ctx.fillRect(0, GROUND, 360, 4);
  ctx.fillStyle = "#8a5a2b";
  ctx.fillRect(0, GROUND + 4, 360, 30);
}

function caption(ctx, text, x, y, color = "#ffffff", size = 13) {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function at(ctx, x, y, fn) {
  ctx.save();
  ctx.translate(x, y);
  fn();
  ctx.restore();
}

function scene(ctx, id, t, { look, friend }) {
  sky(ctx);
  if (id === "build") {
    // Buildings pop up one after another; the kernel pile goes down.
    const items = [["nest", 58, 30, 18, 1], ["wall", 128, 8, 44, 1], ["shield", 180, 16, 20, 1], ["clone", 236, 16, 28, 1], ["weather", 300, 18, 38, 2]];
    const shown = Math.min(items.length, Math.floor((t % 6) / 0.8) + 1);
    items.slice(0, shown).forEach(([type, x, hw, hh, tier], i) => {
      const age = Math.min(1, (t % 6) - i * 0.8);
      const s = age < 0.2 ? 0.6 + age * 2 : 1;
      at(ctx, x, GROUND - hh * s, () => {
        ctx.scale(s, s);
        drawBuilding(ctx, type, tier, hw, hh, { t, progress: 0.5 });
      });
    });
    caption(ctx, `🌽 ${Math.max(0, 180 - shown * 30)} SHARED`, 300, 22, "#ffd400");
    caption(ctx, "⏱ BUILD", 50, 22);
    return;
  }
  if (id === "aim") {
    // Pull back, let go, it flies.
    const cycle = t % 2.6;
    const sx = 70;
    const sy = GROUND - 44;
    const pull = Math.min(1, cycle / 1.1);
    const flying = cycle > 1.3;
    const pouch = flying ? null : [sx - 34 * pull, sy - 22 + 16 * pull];
    drawSling(ctx, sx, sy, { pouch, back: true, power: pull });
    if (!flying) {
      // The dotted arc it will take.
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      for (let i = 1; i < 9; i++) {
        const u = i * 0.1;
        ctx.beginPath();
        ctx.arc(sx + u * 260, sy - 34 - u * 150 + u * u * 150, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      drawBird(ctx, look, { x: pouch[0], y: pouch[1], r: 11, state: "sling", t });
      // The finger doing the pulling.
      ctx.beginPath();
      ctx.arc(pouch[0] - 16, pouch[1] + 10, 9, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      caption(ctx, cycle < 1.1 ? "DRAG BACK" : "LET GO!", 190, 24, "#ffd400");
    } else {
      const u = Math.min(1, (cycle - 1.3) / 1.1);
      drawBird(ctx, look, { x: sx + u * 260, y: sy - 34 - u * 150 + u * u * 150, r: 11, state: "fly", t, angle: -0.5 + u });
      caption(ctx, "ONE BIRD EACH, PER TURN", 190, 24);
    }
    drawSling(ctx, sx, sy, { pouch, back: false, power: pull, t });
    drawPig(ctx, "basic", { x: 320, y: GROUND - 14, r: 13, t, state: "smug" });
    return;
  }
  if (id === "ability") {
    const pulse = (t * 1.2) % 1;
    const x = 180;
    const y = 66 + Math.sin(t * 2) * 6;
    ctx.beginPath();
    ctx.arc(x, y, 18 + pulse * 40, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 212, 0, ${1 - pulse})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    drawBird(ctx, look, { x, y, r: 20, state: "fly", t, angle: Math.sin(t * 2) * 0.1 });
    caption(ctx, "SPECIAL ABILITY", x, 128, "#ffd400");
    return;
  }
  if (id === "goal") {
    // The Corruption Meter falls as piggies pop; the Red Cow creeps up behind.
    const c = Math.max(0, 70 - ((t * 18) % 90));
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(20, 12, 180, 16);
    ctx.fillStyle = c > 30 ? "#c77dff" : "#8fe060";
    ctx.fillRect(22, 14, (176 * c) / 100, 12);
    caption(ctx, `CORRUPTION ${Math.round(c)}%`, 110, 25, "#ffffff", 11);
    drawRedCow(ctx, 300, GROUND, 0.3 + ((t * 0.05) % 0.4), { t, workers: 1, scale: 0.34 });
    for (const [i, x] of [[0, 60], [1, 110], [2, 160]]) {
      const alive = (t * 18) % 90 < 24 * (i + 1);
      if (alive) drawPig(ctx, i === 2 ? "armored" : "basic", { x, y: GROUND - 14, r: 13, t: t + i, state: "smug" });
      else caption(ctx, "POP!", x, GROUND - 14, "#d7ff9a", 12);
    }
    return;
  }
  if (id === "weather") {
    sky(ctx, "#3e5270", "#b8c7d9");
    ctx.strokeStyle = "rgba(210, 225, 255, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 40; i++) {
      const x = (i * 37 + t * 60) % 380;
      const y = (i * 23 + t * 220) % 130;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 5, y + 12);
    }
    ctx.stroke();
    at(ctx, 60, GROUND - 38, () => drawBuilding(ctx, "weather", 3, 18, 38, { t }));
    // A shot pushed off course by the wind.
    const u = (t * 0.5) % 1;
    drawBird(ctx, look, { x: 110 + u * 220, y: 90 - Math.sin(u * Math.PI) * 60 + u * u * 20, r: 10, state: "fly", t, angle: 0.3 });
    caption(ctx, "WIND →", 250, 30, "#9fe8ff");
    caption(ctx, "FORECAST: RAIN, THEN WIND", 180, 146, "#ffd400", 11);
    return;
  }
  // Teamwork: a bird handed to a teammate; a nest hatching.
  const u = (t * 0.6) % 1;
  drawBird(ctx, look, { x: 60, y: GROUND - 20, r: 16, state: "cheer", t });
  drawBird(ctx, friend, { x: 300, y: GROUND - 20, r: 16, state: u > 0.9 ? "cheer" : "sad", t, facing: -1 });
  caption(ctx, "🎁", 80 + u * 200, 60 - Math.sin(u * Math.PI) * 30, "#ffffff", 22);
  at(ctx, 180, GROUND - 18, () => drawBuilding(ctx, "nest", 1, 30, 18, { t, progress: u }));
  caption(ctx, "SHARE · BREED · DONATE", 180, 24, "#ffd400");
}
