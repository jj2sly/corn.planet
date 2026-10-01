// Angry Thud's Revenge: the presentation both screens share. The launch from Steam My Deck's
// library, the Corruption Meter and Red Cow gauges, the forecast panel, phase banners and the
// final report, all inside the CPI handheld (cpi/handheld.js). Words and pictures only.

import { el } from "../common.js";
import { animateBirds, birdCanvas, drawBird } from "../cpi/bird.js";
import { systemCard } from "../cpi/handheld.js";
import { titleOf } from "../deck/library.js";
import { fitCanvas } from "../drawing-canvas.js";
import { drawBlock, drawPig, drawRedCow } from "./thud-art.js";
import { birdType, BIRDS, lookFor, skinById } from "./thud-birds.js";

/** The game's title, as Steam My Deck's library (the server's registry) has it. */
export const gameTitle = () => titleOf("thud", "Angry Thud's Revenge").toUpperCase();

export const PHASE_TITLE = {
  SELECT: "CHOOSE YOUR BIRD",
  LAUNCH: "LAUNCHING",
  BUILD: "BUILD PHASE",
  ACTION: "LAUNCH PHASE",
  PROCESS: "PIGGIES' TURN",
  COW: "THE RED COW GROWS",
  OVER: "OPERATION OVER",
};

/** A countdown that's aimed once per state (common.js ticks [data-deadline]). */
export function liveTimer({ label = "Time remaining" } = {}) {
  const value = el("span", { class: "value" });
  const unit = el("span", { class: "unit", text: "SEC" });
  const node = el("span", { class: "timer compact", role: "timer", "aria-label": label }, value, unit);
  let deadline = 0;
  return {
    node,
    set(timer) {
      node.hidden = !timer;
      if (!timer) return delete node.dataset.deadline;
      const next = Date.now() + timer.remainingMs;
      if (Math.abs(next - deadline) > 400 || node.dataset.paused !== String(timer.paused)) {
        deadline = next;
        node.dataset.deadline = String(next);
        node.dataset.paused = String(timer.paused);
        if (!value.textContent) value.textContent = String(Math.ceil(timer.remainingMs / 1000));
      }
    },
  };
}

/** A small canvas of a Corn Piggy (title cards, the cutscene band). */
export function pigCanvas(kind = "basic", size = 64) {
  const canvas = el("canvas", { class: "td-pig", role: "img", "aria-label": "A Corn Piggy" });
  canvas.style.setProperty("width", `${size}px`);
  canvas.style.setProperty("height", `${size}px`);
  const t0 = performance.now();
  const paint = () => {
    if (!canvas.isConnected) return;
    const { width, height, dpr } = fitCanvas(canvas);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawPig(ctx, kind, { x: width / 2, y: height * 0.6, r: Math.min(width, height) * 0.3, t: (performance.now() - t0) / 1000, state: "smug" });
    requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
  return canvas;
}

export function birdBadge(type, skin, { size = 48, state = "idle" } = {}) {
  const bird = birdType(type);
  const c = birdCanvas(lookFor(type, skin), { size, state, label: `${bird?.name ?? "Bird"} (${skinById(skin).name})` });
  c.dataset.state = state;
  return c;
}

// ------------------------------------------------------------------ the cover

/**
 * Steam My Deck's cover art for the game (deck/ui.js paints it once per size): a bird mid-flight
 * at the Boss Piggy's tower. Static: covers don't animate.
 */
export function paintCover(ctx, { width: w, height: h }) {
  const s = Math.min(w, h * 1.4);
  const ground = h * 0.86;
  // A dusky hill, the flight's dotted arc, then the tower and its piggy.
  ctx.fillStyle = "rgba(24, 9, 4, 0.78)";
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, ground);
  ctx.quadraticCurveTo(w * 0.45, ground - h * 0.08, w, ground - h * 0.02);
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 244, 220, 0.6)";
  for (let i = 0; i < 8; i++) {
    const u = i / 8;
    ctx.beginPath();
    ctx.arc(w * (0.06 + u * 0.3), ground - h * 0.05 - Math.sin(u * 2.4) * h * 0.46, Math.max(1, s * 0.011), 0, Math.PI * 2);
    ctx.fill();
  }
  const bw = s * 0.11;
  const tower = [["stone", 0.7, 1], ["wood", 0.82, 1], ["stone", 0.76, 2], ["glass", 0.76, 3]];
  for (const [m, fx, row] of tower) {
    ctx.save();
    ctx.translate(w * fx, ground - bw * 0.5 - (row - 1) * bw);
    drawBlock(ctx, m, bw * 0.5, bw * 0.5, { seed: row });
    ctx.restore();
  }
  drawPig(ctx, "boss", { x: w * 0.76, y: ground - bw * 3 - s * 0.07, r: s * 0.085, state: "smug", t: 0.6 });
  drawBird(ctx, lookFor("popcorn", "classic"), { x: w * 0.42, y: h * 0.34, r: s * 0.085, angle: 0.18, state: "fly", t: 0.3 });
}

// ------------------------------------------------------------------ the launch

/**
 * The launch from the Deck's library already happened (deck/ui.js plays it when the room starts the
 * game): here the title and the level load.
 */
export function launchSteps(g) {
  const steps = [];
  steps.push({
    ms: 3000,
    cls: "title",
    render: () =>
      el(
        "div",
        { class: "td-title-card" },
        el("div", { class: "td-title-art" }, birdBadge("popcorn", "classic", { size: 76, state: "fly" }), pigCanvas("boss", 96), birdBadge("anvil", "classic", { size: 76, state: "fly" })),
        el("p", { class: "td-logo" }, el("span", { class: "a", text: "ANGRY" }), el("span", { class: "b", text: "THUD'S" }), el("span", { class: "c", text: "REVENGE" })),
        el("p", { class: "td-logo-sub", text: "A CPI KERNEL EXCLUSIVE · NOT AFFILIATED WITH ANY BIRDS" }),
      ),
  });
  steps.push({ ms: 4200, cls: "level", render: () => levelCard(g) });
  return steps;
}

export function levelCard(g) {
  const L = g.level;
  return systemCard({
    eyebrow: `LEVEL ${L.difficulty} OF 5 · NOW LOADING`,
    title: L.name,
    text: L.tagline,
    kind: "level",
    children: [
      el("p", { class: "td-stars", text: "★".repeat(L.difficulty) + "☆".repeat(5 - L.difficulty) }),
      el("ul", { class: "sd-intro" }, (L.intro ?? []).map((line) => el("li", { text: line }))),
      el("p", { class: "td-goal", text: "GOAL: Corruption 0% before the Red Cow is finished." }),
    ],
  });
}

// ------------------------------------------------------------------ the meters

/** The Corruption Meter, the Red Cow gauge and the shared kernels, in one strip. */
export function meters({ compact = false } = {}) {
  const corrFill = el("span", { class: "td-meter-fill" });
  const corrValue = el("span", { class: "td-meter-value" });
  const corrNote = el("span", { class: "td-meter-note", text: compact ? "" : "0% = TEAM WINS · pop piggies, wreck forts" });
  const corr = el("div", { class: "td-meter corruption", role: "meter", "aria-label": "Corruption", "aria-valuemin": "0", "aria-valuemax": "100" }, el("span", { class: "td-meter-label", text: "CORRUPTION" }), el("span", { class: "td-meter-bar" }, corrFill), corrValue, corrNote);
  const cowFill = el("span", { class: "td-meter-fill" });
  const cowValue = el("span", { class: "td-meter-value" });
  const cowNote = el("span", { class: "td-meter-note" });
  const cow = el("div", { class: "td-meter cow", role: "meter", "aria-label": "Red Cow construction", "aria-valuemin": "0", "aria-valuemax": "100" }, el("span", { class: "td-meter-label", text: "RED COW" }), el("span", { class: "td-meter-bar" }, cowFill), cowValue, cowNote);
  const kernels = el("span", { class: "td-kernels" });
  const node = el("div", { class: `td-meters ${compact ? "compact" : ""}`.trim() }, corr, cow, kernels);
  let lastCorr = null;
  let lastKernels = null;
  return {
    node,
    update(g) {
      const c = g.corruption;
      corrFill.style.setProperty("--pct", `${c}%`);
      corrValue.textContent = `${c.toFixed(c % 1 ? 1 : 0)}%`;
      corr.setAttribute("aria-valuenow", String(Math.round(c)));
      if (lastCorr !== null && c < lastCorr - 0.05) {
        corr.classList.remove("drop");
        void corr.offsetWidth;
        corr.classList.add("drop");
      }
      if (lastCorr !== null && c > lastCorr + 0.05) {
        corr.classList.remove("rise");
        void corr.offsetWidth;
        corr.classList.add("rise");
      }
      lastCorr = c;
      const p = Math.round(g.cow.progress * 100);
      cowFill.style.setProperty("--pct", `${p}%`);
      cowValue.textContent = `${p}%`;
      cow.setAttribute("aria-valuenow", String(p));
      cow.classList.toggle("danger", p >= 60);
      cowNote.textContent = compact ? "" : `100% = TEAM LOSES · +${Math.round(g.cow.step * 100)}% in ${g.cow.nextIn} turn${g.cow.nextIn === 1 ? "" : "s"}`;
      const k = g.kernels.balance;
      kernels.textContent = compact ? `🌽 ${k}` : `🌽 ${k} TEAM`;
      kernels.title = `Shared kernels: ${k} (earned ${g.kernels.earned}, spent ${g.kernels.spent})`;
      if (lastKernels !== null && k !== lastKernels) {
        kernels.classList.remove("bump");
        void kernels.offsetWidth;
        kernels.classList.add("bump");
      }
      lastKernels = k;
    },
    get lastCorruption() {
      return lastCorr;
    },
  };
}

// ------------------------------------------------------------------ the weather machine

const CATEGORY_ICON = { WIND: "🌬️", RAIN: "🌧️", STORM: "⛈️", HAZE: "🌫️", HEAT: "🔥", GROUND: "🌋" };

/** What the team's Weather Machine says (or that there's no machine, or that it's broken). */
export function forecastPanel() {
  const node = el("section", { class: "td-forecast", "aria-label": "Weather forecast" });
  let sig = "";
  return {
    node,
    update(g) {
      const f = g.forecast;
      const now = g.weather;
      const next = JSON.stringify([f, now, g.turn]);
      if (next === sig) return;
      sig = next;
      const rows = [];
      if (now) rows.push(el("p", { class: "td-fc-now" }, el("strong", { text: `NOW: ${now.label.toUpperCase()}` }), ` · ${now.severity}${now.secondary ? ` + ${now.secondary}` : ""}`));
      if (!f) rows.push(el("p", { class: "td-fc-none", text: "NO WEATHER MACHINE · the sky is a mystery" }));
      else if (f.status !== "OK") rows.push(el("p", { class: "td-fc-bad", text: f.status === "BROKEN" ? `📡 ${f.name} BROKEN · repair ${f.repair} 🌽` : `📡 ${f.name} OFFLINE (lightning) · back next turn` }));
      else {
        rows.push(el("p", { class: "td-fc-head", text: `📡 ${f.name.toUpperCase()} · T${f.tier}` }));
        if (!f.lines.length) rows.push(el("p", { class: "td-fc-line", text: "CLEAR SKIES AHEAD (as far as it can tell)" }));
        for (const l of f.lines) {
          if (l.clear) {
            rows.push(el("p", { class: "td-fc-line clear", text: `TURN ${l.turn}: CLEAR` }));
            continue;
          }
          const when = l.turn ? `TURN ${l.turn}` : l.estTurn ? `EST. TURN ${l.estTurn}` : l.turnRange ? `TURNS ${l.turnRange[0]}–${l.turnRange[1]}` : "SOON";
          const what = l.label ? l.label.toUpperCase() : `${CATEGORY_ICON[l.category] ?? ""} ${l.category}`;
          const bits = [`${when}: ${what}`, l.severity ? `SEVERITY ${l.severity}` : null, l.secondaryLabel ? `+ ${l.secondaryLabel.toUpperCase()}` : null, `${Math.round(l.confidence * 100)}%`];
          rows.push(el("p", { class: "td-fc-line", text: bits.filter(Boolean).join(" · ") }));
        }
      }
      node.replaceChildren(...rows);
      // Nothing to forecast and no weather: the panel stays out of the way until it matters.
      node.hidden = !f && !now;
    },
  };
}

// ------------------------------------------------------------------ banners

export function processBanner(g) {
  const p = g.process;
  if (!p) return null;
  return el("div", { class: "td-band" }, el("span", { class: "td-band-tag", text: `${p.index + 1}/${p.total} · ${p.label}` }), el("span", { text: p.detail || "…" }));
}

export function cowBand(g) {
  const s = g.cow.scene;
  const from = Math.round((s?.from ?? g.cow.progress) * 100);
  const to = Math.round((s?.to ?? g.cow.progress) * 100);
  const lines = ["The piggies unionized. Their demand: more cow.", "Moo-nument under construction.", "Structural integrity: bovine.", "The Red Cow grows. The Red Cow judges.", "No bird was consulted."];
  return el(
    "div",
    { class: "td-cow-band" },
    pigCanvas("builder", 58),
    el("div", {}, el("p", { class: "td-cow-title", text: `RED COW CONSTRUCTION: ${from}% → ${to}%` }), el("p", { class: "td-cow-line", text: to >= 100 ? "IT IS COMPLETE. The piggies have won." : lines[(to / 5) % lines.length | 0] })),
  );
}

// ------------------------------------------------------------------ the end

export function overReport(g, { me = null } = {}) {
  const o = g.over;
  if (!o) return el("div");
  const win = o.result === "victory";
  const badges = [];
  const players = [...o.players].sort((a, b) => (g.scores?.[b.id] ?? 0) - (g.scores?.[a.id] ?? 0));
  const row = (p) => {
    const c = birdBadge(p.bird, p.skin, { size: 34, state: win ? "cheer" : "sad" });
    badges.push(c);
    return el(
      "tr",
      { class: p.id === me ? "me" : "" },
      el("td", {}, c),
      el("th", { scope: "row", text: p.name }),
      el("td", { class: "mono", text: String(g.scores?.[p.id] ?? 0) }),
      el("td", { class: "mono", text: `${Math.round(p.destruction)}` }),
      el("td", { class: "mono", text: `${p.pigs} / ${p.blocks}` }),
      el("td", { class: "mono", text: String(p.birdsUsed) }),
      el("td", { class: "mono", text: `${p.kernels} / ${p.kernelsSpent}` }),
    );
  };
  animateBirds(badges);
  const best = o.bestShot;
  return el(
    "div",
    { class: `td-over ${win ? "win" : "lose"}` },
    el("div", { class: "td-over-head" }, el("span", { class: `sd-stamp ${win ? "ok" : "danger"}`, text: win ? "TEAM VICTORY" : "TEAM DEFEAT" }), el("span", { class: "cpi-card-eyebrow", text: `${g.level.name} · ${o.turns} turn${o.turns === 1 ? "" : "s"}` })),
    el("p", { class: "td-over-line", text: win ? "Corruption purged. The Red Cow will never moo. THUD has been sent to his room." : "The Red Cow is complete. It stares. The piggies celebrate with a corn-based beverage." }),
    el(
      "div",
      { class: "td-over-meters" },
      el("span", { text: `CORRUPTION ${o.corruption}%` }),
      el("span", { text: `RED COW ${Math.round(o.cow * 100)}%` }),
      el("span", { text: `KERNELS +${o.kernels.earned} / −${o.kernels.spent}` }),
    ),
    el(
      "table",
      { class: "td-over-table" },
      el("thead", {}, el("tr", {}, el("th", {}), el("th", { text: "Agent" }), el("th", { text: "Pts" }), el("th", { text: "Destr." }), el("th", { text: "Pig/Blk" }), el("th", { text: "Birds" }), el("th", { text: "🌽 +/−" }))),
      el("tbody", {}, players.map(row)),
    ),
    o.awards.length ? el("ul", { class: "td-awards" }, o.awards.map((a) => el("li", {}, el("strong", { text: a.title }), el("span", { class: "td-award-who", text: a.name }), el("span", { class: "td-award-detail", text: a.detail })))) : null,
    best ? el("p", { class: "td-best", text: `Shot of the game: ${o.players.find((p) => p.id === best.playerId)?.name ?? "?"}'s ${birdType(best.bird)?.name ?? "bird"} · ${best.kills} ${best.kills === 1 ? "piggy" : "piggies"}, ${best.broke} block${best.broke === 1 ? "" : "s"}, ${Math.round(best.path)} units of flight` }) : null,
  );
}

/** Every bird, as a pick-me card (the select screen). */
export function birdCards(selected, skin, onPick) {
  const canvases = [];
  const list = el(
    "div",
    { class: "td-birds", role: "radiogroup", "aria-label": "Choose your bird" },
    BIRDS.map((b) => {
      const c = birdBadge(b.id, skin, { size: 56 });
      canvases.push(c);
      const button = el(
        "button",
        { class: `td-bird ${b.id === selected ? "on" : ""}`, type: "button", role: "radio", "aria-checked": String(b.id === selected), dataset: { bird: b.id } },
        c,
        el("span", { class: "td-bird-name", text: `${b.icon} ${b.name}` }),
        el("span", { class: "td-bird-role", text: b.role }),
        el("span", { class: "td-bird-blurb", text: b.blurb }),
        el("span", { class: "td-bird-usage", text: b.usage }),
      );
      button.addEventListener("click", () => onPick(b.id));
      return button;
    }),
  );
  animateBirds(canvases);
  return list;
}

/** A shrunken Red Cow for the host HUD. */
export function cowIcon(progress, size = 34) {
  const canvas = el("canvas", { class: "td-cow-icon", "aria-hidden": "true" });
  canvas.style.setProperty("width", `${size}px`);
  canvas.style.setProperty("height", `${size}px`);
  requestAnimationFrame(() => {
    const { width, height, dpr } = fitCanvas(canvas);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRedCow(ctx, width / 2, height * 0.95, progress, { scale: Math.min(width, height) / 360 });
  });
  return canvas;
}
