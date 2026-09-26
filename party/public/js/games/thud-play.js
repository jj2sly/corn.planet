// Angry Thud's Revenge on a phone (or a laptop), inside the CPI handheld. The screen shows the
// battlefield, following what matters to you: your build zone, the sling when it's your shot, your
// bird in flight. The device's own buttons do the work: the d-pad aims (◀ ▶ angle, ▲ ▼ power) or
// moves what you're placing, A launches / uses your bird's ability / confirms, B cancels, X picks
// your next bird, Y shows the whole map. You can also drag back on the screen like a slingshot.
// Keyboard: arrows, Space / Enter, Esc, X, M.
//
// Aim, steering and your build cursor go over tools.stream (fire-and-forget); everything that
// changes the game (launch, ability, build, donate…) over tools.request, and the server decides.

import { el } from "../common.js";
import { animateBirds } from "../cpi/bird.js";
import { createHandheld, dpad, faceButton, systemCard } from "../cpi/handheld.js";
import { isMuted, playSfx, setMuted } from "./mycob-sound.js";
import { birdType, SKINS } from "./thud-birds.js";
import { aimFromPull, clearOf, placement } from "./thud-rules.js";
import { birdBadge, birdCards, cowBand, forecastPanel, launchSteps, levelCard, liveTimer, meters, overReport, PHASE_TITLE, processBanner, TITLE } from "./thud-ui.js";
import { closeTutorial, showTutorial, tutorialSeen } from "./thud-tutorial.js";
import { createThudView } from "./thud-world.js";

const buzz = (pattern) => {
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(pattern);
};

/** A button that fires on press (quicker for a game), and on Enter / Space for keyboards. */
function tappable(button, fn) {
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.classList.add("pressed");
    fn();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(type, () => button.classList.remove("pressed"));
  button.addEventListener("click", (e) => {
    if (e.detail === 0 && !button.disabled) fn();
  });
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  return button;
}

/** Held down: repeats `fn` while pressed (d-pad nudges), or calls down / up once (steering). */
function holdable(button, { down, up, repeat = null }) {
  let timer = 0;
  let held = false;
  button.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (button.disabled) return;
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // Not capturable: it still works, it just lets go on leave.
    }
    held = true;
    button.classList.add("pressed");
    down?.();
    if (repeat) {
      repeat();
      timer = setInterval(repeat, 70);
    }
  });
  const release = () => {
    if (!held) return;
    held = false;
    button.classList.remove("pressed");
    clearInterval(timer);
    up?.();
  };
  for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) button.addEventListener(type, release);
  button.addEventListener("contextmenu", (e) => e.preventDefault());
  return button;
}

function muteButton() {
  const b = el("button", { class: "cpi-hh-sysbtn", type: "button" });
  const paint = () => {
    b.textContent = isMuted() ? "🔇" : "🔊";
    b.setAttribute("aria-label", isMuted() ? "Sound off (tap for on)" : "Sound on (tap for off)");
  };
  b.addEventListener("click", () => {
    setMuted(!isMuted());
    paint();
    playSfx("ui_click");
  });
  paint();
  return b;
}

/** The "?" on the device's status bar: the tutorial again. */
function helpButton(open) {
  const b = el("button", { class: "cpi-hh-sysbtn", type: "button", "aria-label": "How to play", text: "?" });
  b.addEventListener("click", open);
  return b;
}

const ACTION_LABEL = { AIM: "LAUNCH", FLIGHT: "ABILITY", BUILD: "PLACE" };

function buildScreen(s, tools) {
  const g0 = s.game;
  const me = g0.you.playerId;
  let g = g0;
  let room = s;
  let phase = null;
  let panelKey = "";
  let paused = false;
  const aim = { a: 38, p: 0.75 };
  let aimDirty = false;
  let lastAimSent = 0;
  let placing = null;
  let steer = 0;

  const request = async (action, payload = {}) => {
    const result = await tools.request("game:input", { action, payload });
    if (!result.ok) {
      hh.notify(result.message ?? "That didn't work.", { kind: "danger", icon: "✗", ms: 2600 });
      buzz([30, 40, 30]);
    }
    return result;
  };

  // ---------------------------------------------------------------- the device

  const timer = liveTimer();
  const left = el("button", { class: "cpi-hh-dir", type: "button", "aria-label": "Left (angle up / move left)" }, "◀");
  const right = el("button", { class: "cpi-hh-dir", type: "button", "aria-label": "Right (angle down / move right)" }, "▶");
  const up = el("button", { class: "cpi-hh-dir", type: "button", "aria-label": "More power" }, "▲");
  const down = el("button", { class: "cpi-hh-dir", type: "button", "aria-label": "Less power" }, "▼");
  const aBtn = faceButton("A", { label: "LAUNCH", cls: "l-A", keyHint: "Space" });
  const bBtn = faceButton("B", { label: "BACK", cls: "l-B", keyHint: "Esc" });
  const xBtn = faceButton("X", { label: "NEXT BIRD", cls: "l-X", keyHint: "X" });
  const yBtn = faceButton("Y", { label: "MAP", cls: "l-Y", keyHint: "M" });
  const leftGrip = el("div", { class: "cpi-hh-cluster" }, dpad({ left, right, up, down }));
  const rightGrip = el("div", { class: "cpi-hh-cluster td-face" }, el("div", { class: "cpi-hh-abxy real" }, yBtn, xBtn, bBtn, aBtn));
  const panel = el("div", { class: "td-panel" });
  const hh = createHandheld({ title: TITLE, owner: g0.roster.find((p) => p.id === me)?.name?.toUpperCase() ?? null, layout: "auto", left: leftGrip, right: rightGrip, label: "Angry Thud's Revenge", className: "sd-device td-device td-phone" });
  const howTo = () => showTutorial(g, { me });
  hh.setStatus({ extra: [timer.node, helpButton(howTo), muteButton()] });
  const canvas = el("canvas", { class: "sd-canvas td-canvas", "aria-label": "The battlefield. Drag back from the slingshot to aim." });
  hh.screen.append(canvas);
  const view = createThudView(canvas, {
    mode: "phone",
    you: me,
    sound: true,
    onFx: (e) => {
      if (e.t === "boom" || e.t === "quake") buzz(e.t === "quake" ? [80, 60, 80] : 40);
    },
  });
  view.setAim(() => aim);
  view.update(g0);
  const m = meters({ compact: true });
  const forecast = forecastPanel();
  const inventory = el("div", { class: "td-inventory", role: "radiogroup", "aria-label": "Your birds" });
  const status = el("p", { class: "td-status", role: "status" });
  const howToBtn = el("button", { class: "btn subtle small td-howto", type: "button", text: "? How to play" });
  howToBtn.addEventListener("click", () => howTo());
  const node = el("div", { class: "td-phone-wrap" }, hh.node, el("div", { class: "td-under" }, m.node, status, inventory, panel, forecast.node, howToBtn));

  const mine = () => g.roster.find((p) => p.id === me);
  const shooting = () => g.phase === "ACTION" && g.action?.shooterId === me;
  const stage = () => (shooting() ? g.action.stage : null);

  // ---------------------------------------------------------------- aiming

  const sendAim = (force = false) => {
    if (!shooting() || stage() !== "AIM") return;
    const now = performance.now();
    if (!force && now - lastAimSent < 66) {
      aimDirty = true;
      return;
    }
    aimDirty = false;
    lastAimSent = now;
    tools.stream({ a: aim.a, p: aim.p });
  };
  const aimTimer = setInterval(() => {
    if (!node.isConnected) return clearInterval(aimTimer);
    if (aimDirty) sendAim(true);
  }, 80);
  const nudgeAim = (da, dp) => {
    aim.a = Math.max(g.level.sling.minAngle, Math.min(g.level.sling.maxAngle, Math.round((aim.a + da) * 10) / 10));
    aim.p = Math.max(g.level.sling.minPower, Math.min(1, Math.round((aim.p + dp) * 100) / 100));
    sendAim();
    if (Math.random() < 0.3) playSfx("thud_stretch", { volume: 0.4 });
  };
  const launch = async () => {
    buzz(30);
    await request("launch", { angle: aim.a, power: aim.p });
  };

  // Drag back on the screen, like a slingshot (anywhere: it's the direction and length that count).
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (placing) {
      const [wx] = view.toWorld(e.clientX, e.clientY);
      movePlacement(wx, true);
      drag = { place: true };
      canvas.setPointerCapture?.(e.pointerId);
      return;
    }
    if (stage() === "FLIGHT") return useAbility();
    if (stage() !== "AIM") return;
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.place) {
      const [wx] = view.toWorld(e.clientX, e.clientY);
      return movePlacement(wx, true);
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) < 8) return;
    const next = aimFromPull(dx, dy, { maxPull: Math.min(220, canvas.clientWidth * 0.35), minAngle: g.level.sling.minAngle, maxAngle: g.level.sling.maxAngle, minPower: g.level.sling.minPower });
    aim.a = next.angle;
    aim.p = next.power;
    sendAim();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const wasPlace = drag.place;
    const dx = e.clientX - (drag.x ?? 0);
    const dy = e.clientY - (drag.y ?? 0);
    drag = null;
    if (!wasPlace && Math.hypot(dx, dy) > 30 && stage() === "AIM") launch();
  });
  canvas.addEventListener("pointercancel", () => (drag = null));

  const useAbility = async () => {
    const type = g.action?.flying?.bird;
    const ab = birdType(type)?.ability;
    if (!ab || ab.trigger !== "tap") return;
    buzz(25);
    await request("ability");
  };
  const setSteer = (dir) => {
    if (steer === dir) return;
    steer = dir;
    tools.stream({ s: dir });
  };

  // ---------------------------------------------------------------- building

  const def = (type) => g.build.catalog.find((c) => c.type === type);
  const startPlacing = (type) => {
    const d = def(type);
    const cursor = mine()?.cursor;
    placing = { type, w: d.w, h: d.h, x: cursor ?? (g.level.zones[0][0] + g.level.zones[0][1]) / 2, ok: false, reason: "" };
    movePlacement(placing.x, true);
    renderPanel(true);
  };
  const movePlacement = (x, stream) => {
    if (!placing) return;
    const spot = placement({ x, w: placing.w, h: placing.h }, { zones: g.level.zones, groundY: g.level.groundY, clear: clearOf(g.world.rows) });
    Object.assign(placing, { x: spot.x, ok: spot.ok, reason: spot.reason });
    view.setGhost({ type: placing.type, x: placing.x, w: placing.w, h: placing.h, ok: placing.ok });
    if (stream) tools.stream({ bx: placing.x });
    renderPanel(false);
  };
  const cancelPlacing = () => {
    placing = null;
    view.setGhost(null);
    renderPanel(true);
  };
  const confirmPlacing = async () => {
    if (!placing) return;
    const { type, x } = placing;
    const result = await request("build", { type, x });
    if (result.ok) {
      buzz(40);
      cancelPlacing();
    }
  };

  // ---------------------------------------------------------------- buttons

  holdable(left, { repeat: () => (placing ? movePlacement(placing.x - 10, true) : stage() === "AIM" ? nudgeAim(1, 0) : null), down: () => stage() === "FLIGHT" && setSteer(-1), up: () => setSteer(0) });
  holdable(right, { repeat: () => (placing ? movePlacement(placing.x + 10, true) : stage() === "AIM" ? nudgeAim(-1, 0) : null), down: () => stage() === "FLIGHT" && setSteer(1), up: () => setSteer(0) });
  holdable(up, { repeat: () => stage() === "AIM" && nudgeAim(0, 0.02) });
  holdable(down, { repeat: () => stage() === "AIM" && nudgeAim(0, -0.02) });
  const primary = () => {
    if (placing) return confirmPlacing();
    if (stage() === "AIM") return launch();
    if (stage() === "FLIGHT") return useAbility();
  };
  tappable(aBtn, primary);
  tappable(bBtn, () => (placing ? cancelPlacing() : null));
  tappable(xBtn, () => {
    const p = mine();
    if (p?.birds.length > 1) request("select", { index: (p.selected + 1) % p.birds.length });
  });
  tappable(yBtn, () => view.setCamera(view.camera === "map" ? "auto" : "map"));
  const onKey = (e) => {
    if (!node.isConnected) return removeEventListener("keydown", onKey);
    if (e.target?.closest?.("input, textarea, select")) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const dir = k === "ArrowLeft" ? -1 : 1;
      if (placing) movePlacement(placing.x + dir * 10, true);
      else if (stage() === "AIM") nudgeAim(-dir, 0);
      else if (stage() === "FLIGHT" && !e.repeat) setSteer(dir);
    } else if (k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      if (stage() === "AIM") nudgeAim(0, k === "ArrowUp" ? 0.02 : -0.02);
    } else if ((k === " " || k === "Enter") && !e.repeat) {
      e.preventDefault();
      primary();
    } else if (k === "Escape") cancelPlacing();
    else if (k === "x" || k === "X") xBtn.dispatchEvent(new MouseEvent("click", { detail: 0 }));
    else if (k === "m" || k === "M") view.setCamera(view.camera === "map" ? "auto" : "map");
  };
  const onKeyUp = (e) => {
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && stage() === "FLIGHT") setSteer(0);
  };
  addEventListener("keydown", onKey);
  addEventListener("keyup", onKeyUp);

  // ---------------------------------------------------------------- the panel under the device

  const btn = (text, fn, cls = "") => {
    const b = el("button", { class: `btn ${cls}`.trim(), type: "button", text });
    b.addEventListener("click", fn);
    return b;
  };

  function selectPanel() {
    const p = mine();
    const skins = el(
      "div",
      { class: "td-skins", role: "radiogroup", "aria-label": "Skin (looks only)" },
      SKINS.map((skin) => {
        const b = el("button", { class: `td-skin ${p.skin === skin.id ? "on" : ""}`, type: "button", role: "radio", "aria-checked": String(p.skin === skin.id) }, birdBadge(p.bird, skin.id, { size: 40 }), el("span", { text: skin.name }));
        b.addEventListener("click", () => request("choose", { skin: skin.id }));
        return b;
      }),
    );
    animateBirds([...skins.querySelectorAll("canvas")]);
    return [
      el("h2", { class: "td-h", text: "1 · Pick your bird (how it plays)" }),
      birdCards(p.bird, p.skin, (bird) => request("choose", { bird })),
      el("h2", { class: "td-h", text: "2 · Pick a skin (just looks)" }),
      skins,
      btn(p.ready ? "READY ✓ (tap to change)" : "READY", () => request("ready", { ready: !p.ready }), p.ready ? "ghost" : ""),
    ];
  }

  function buildPanel() {
    const out = [];
    if (placing) {
      const d = def(placing.type);
      out.push(
        el("div", { class: `td-place ${placing.ok ? "ok" : "bad"}` }, el("strong", { text: `Placing: ${d.name} · ${d.cost} 🌽` }), el("span", { text: placing.ok ? "◀ ▶ or drag to move · A / Enter to place · permanent once placed" : placing.reason })),
        el("div", { class: "row" }, btn(`PLACE HERE (${d.cost})`, confirmPlacing, placing.ok ? "" : "ghost"), btn("Cancel", cancelPlacing, "ghost")),
      );
      return out;
    }
    const k = g.kernels.balance;
    out.push(
      el(
        "div",
        { class: "td-catalog" },
        g.build.catalog.map((c) => {
          const full = c.count >= c.max;
          const b = el("button", { class: "td-build", type: "button", disabled: full || k < c.cost }, el("strong", { text: c.name }), el("span", { class: "mono", text: `${c.cost} 🌽${full ? " · MAX" : ""}` }), el("span", { class: "td-build-blurb", text: c.blurb }));
          b.addEventListener("click", () => startPlacing(c.type));
          return b;
        }),
      ),
    );
    const actions = [];
    const p = mine();
    actions.push(btn(`Buy a ${birdType(p.bird)?.name ?? "bird"} crate · ${g.build.birdCrate} 🌽`, () => request("buy_bird"), "ghost"));
    const f = g.forecast;
    if (f?.status === "BROKEN") actions.push(btn(`Repair Weather Machine · ${f.repair} 🌽`, () => request("repair_weather")));
    else if (f?.next) actions.push(btn(`Upgrade to ${f.next.name} · ${f.next.price} 🌽`, () => request("upgrade_weather"), "ghost"));
    for (const n of g.build.structures.filter((q) => q.type === "nest")) {
      const joined = n.breeders.includes(me);
      const others = n.breeders.filter((id) => id !== me).map((id) => g.roster.find((q) => q.id === id)?.name);
      const label = n.breeds ? "Nest bred this turn" : joined ? "Waiting for a second agent… (tap to leave)" : others.length ? `Breed with ${others.join(", ")} · ${g.build.breedCost} 🌽` : "Go to this nest to breed (needs 2 agents)";
      const b = btn(`🥚 Nest @${n.x} · ${label}`, () => request("breed", { nest: n.id }), others.length && !joined ? "" : "ghost");
      b.disabled = n.breeds > 0 || n.disabled > 0 || n.waterlogged;
      actions.push(b);
    }
    for (const c of g.build.structures.filter((q) => q.type === "clone")) {
      const type = p.birds[p.selected];
      const b = btn(type ? `🧪 Clone my ${birdType(type)?.name} (one use)` : "🧪 Clone tank (you need a bird to copy)", () => request("clone", { tank: c.id }), "ghost");
      b.disabled = !type || c.disabled > 0;
      actions.push(b);
    }
    for (const q of g.roster.filter((q) => q.id !== me && q.here && q.birds.length === 0)) {
      const type = p.birds[p.selected];
      const b = btn(type ? `🎁 Give ${q.name} your ${birdType(type)?.name} (you'd have ${p.birds.length - 1})` : `${q.name} needs a bird (you have none)`, () => request("donate", { to: q.id, index: p.selected }), "");
      b.disabled = !type;
      actions.push(b);
    }
    actions.push(btn(p.vote ? `Voted to skip ✓ (${g.build.votes}/${g.build.needed})` : `Vote to skip build (${g.build.votes}/${g.build.needed})`, () => request("vote_skip", { vote: !p.vote }), p.vote ? "ghost" : "subtle"));
    out.push(el("div", { class: "td-actions" }, actions));
    return out;
  }

  function actionPanel() {
    const a = g.action;
    const p = mine();
    const shooter = g.roster.find((q) => q.id === a.shooterId);
    if (a.stage === "NEED_BIRD" && a.shooterId !== me) {
      const type = p.birds[p.selected];
      return [
        el("p", { class: "td-alert", text: `${shooter?.name} NEEDS A BIRD` }),
        type ? btn(`🎁 Give ${shooter?.name} your ${birdType(type)?.name} · you'd have ${p.birds.length - 1} left`, () => request("donate", { to: a.shooterId, index: p.selected })) : el("p", { class: "muted", text: "You have none to give." }),
      ];
    }
    if (a.stage === "NEED_BIRD") return [el("p", { class: "td-alert", text: "You're out of birds. Waiting for a teammate to donate one…" })];
    if (a.shooterId !== me) {
      const pos = a.queue.indexOf(me) - a.index;
      return [el("p", { class: "muted", text: pos > 0 ? `You're up in ${pos} shot${pos === 1 ? "" : "s"}. Pick your bird below.` : "You've shot this turn. Watch the chaos." })];
    }
    if (a.stage === "AIM") {
      const type = p.birds[p.selected];
      const b = birdType(type);
      return [
        el("p", { class: "td-alert ok", text: `YOUR SHOT · ${b?.icon ?? ""} ${b?.name ?? ""}` }),
        el("p", { class: "muted", text: `Drag back on the screen to aim, or ◀ ▶ angle, ▲ ▼ power. A / Space launches. In flight: ${b?.usage ?? ""}.` }),
      ];
    }
    if (a.stage === "FLIGHT") {
      const b = birdType(a.flying?.bird);
      const ab = b?.ability;
      const verb = { pop: "POP", boost: "AFTERBURNER", split: "SPLIT INTO THREE", ricochet: "RICOCHET AT A PIGGY", slam: "SLAM DOWN", magnet: "MAGNET PULL", bunker: "BECOME A BUNKER" }[ab?.kind];
      if (ab?.trigger === "tap") return [el("p", { class: `td-alert ${a.uses ? "" : "ok"}`.trim(), text: a.uses ? `TAP THE SCREEN (or A): ${verb} · ${a.uses} left` : `${verb}: done. Watch it land.` })];
      if (ab?.trigger === "hold") return [el("p", { class: "td-alert", text: `HOLD ◀ ▶ TO GLIDE AND STEER · fuel ${a.fuel.toFixed(1)} s` })];
      return [el("p", { class: "td-alert ok", text: `${b?.name}: ${b?.usage.toLowerCase()} · drilling through what it hits` })];
    }
    return [];
  }

  function renderPanel(force) {
    const p = mine();
    const a = g.action;
    const key = JSON.stringify([
      g.phase,
      a?.stage,
      a?.shooterId,
      a?.uses,
      a?.stage === "FLIGHT" ? Math.round((a?.fuel ?? 0) * 10) : null,
      g.phase === "BUILD" ? [placing?.type, placing?.ok, placing?.reason, g.kernels.balance, g.build.votes, g.build.structures.map((q) => [q.id, q.breeders, q.breeds, q.disabled, q.waterlogged]), g.forecast?.status, g.forecast?.tier, g.roster.map((q) => q.birds.length)] : null,
      g.phase === "SELECT" ? [p?.bird, p?.skin, p?.ready] : null,
      g.phase === "ACTION" && a?.stage === "NEED_BIRD" ? p?.birds.length : null,
      p?.selected,
    ]);
    if (!force && key === panelKey) return;
    panelKey = key;
    let content = [];
    if (g.phase === "SELECT") content = selectPanel();
    else if (g.phase === "BUILD") content = buildPanel();
    else if (g.phase === "ACTION") content = actionPanel();
    else if (g.phase === "PROCESS") content = [el("p", { class: "muted", text: g.process?.detail || "The piggies are up to something." })];
    else if (g.phase === "COW") content = [el("p", { class: "td-alert", text: "The Red Cow grows." })];
    else if (g.phase === "OVER") content = [overReport({ ...g, scores: Object.fromEntries(room.players.map((q) => [q.id, q.score])) }, { me })];
    else if (g.phase === "LAUNCH") content = [el("p", { class: "muted", text: "Launching from Steam My Deck…" })];
    panel.replaceChildren(...content.filter(Boolean));
    aBtn.querySelector(".cpi-hh-label").textContent = placing ? "PLACE" : ACTION_LABEL[stage()] ?? "A";
  }

  function renderInventory() {
    const p = mine();
    if (!p || g.phase === "SELECT") {
      inventory.replaceChildren();
      return;
    }
    const sig = `${p.birds.join(",")}:${p.selected}:${p.skin}`;
    if (inventory.dataset.sig === sig) return;
    inventory.dataset.sig = sig;
    const canvases = [];
    inventory.replaceChildren(
      el("span", { class: "td-inv-label", text: p.birds.length ? `YOUR BIRDS · ${p.birds.length}` : "NO BIRDS · ask for a donation" }),
      ...p.birds.map((type, i) => {
        const c = birdBadge(type, p.skin, { size: 36 });
        canvases.push(c);
        const b = el("button", { class: `td-inv ${i === p.selected ? "on" : ""}`, type: "button", role: "radio", "aria-checked": String(i === p.selected), "aria-label": `${birdType(type)?.name}${i === p.selected ? " (selected)" : ""}` }, c);
        b.addEventListener("click", () => request("select", { index: i }));
        return b;
      }),
    );
    animateBirds(canvases);
  }

  // ---------------------------------------------------------------- phases

  const enter = (next, remainingMs) => {
    const p = next.phase;
    const live = phase !== null;
    if (p !== "BUILD" && placing) cancelPlacing();
    if (p === "LAUNCH" && (remainingMs ?? 0) > 3000) hh.sequence(launchSteps(next, { short: true }));
    else if (p === "BUILD") {
      hh.clearOverlay();
      if (live) hh.notify(`BUILD PHASE · ${next.kernels.balance} kernels`, { kind: "info", icon: "🔨", replace: true });
    } else if (p === "ACTION") {
      hh.clearOverlay();
      if (live && next.weather) hh.notify(`WEATHER: ${next.weather.label.toUpperCase()} · ${next.weather.severity}`, { kind: "warn", icon: "⛈", ms: 3000 });
    } else if (p === "PROCESS") hh.overlay(processBanner(next), "band");
    else if (p === "COW") {
      hh.overlay(cowBand(next), "band");
      hh.flash("danger");
      buzz([60, 40, 120]);
    } else if (p === "OVER") hh.overlay(systemCard({ eyebrow: "OPERATION OVER", title: next.over?.result === "victory" ? "TEAM VICTORY" : "TEAM DEFEAT", text: "Scroll down for the report." }), "card");
    else if (p === "SELECT") hh.overlay(levelCard(next), "card");
    phase = p;
  };

  let lastStage = null;
  let lastProcess = null;
  let lastLog = g0.log.at(-1)?.id ?? 0;

  return {
    node,
    update(next) {
      room = next;
      g = next.game;
      timer.set(next.timer);
      m.update(g);
      if (next.paused !== paused) {
        paused = next.paused;
        if (paused) hh.overlay(systemCard({ eyebrow: "SYSTEM", title: "PAUSED", text: "The host display dropped out. Hang on." }), "card");
        else {
          phase = null;
          enter(g, 0);
        }
      }
      if (g.phase !== phase && !paused) enter(g, next.timer?.remainingMs);
      if (g.phase === "PROCESS" && g.process?.index !== lastProcess) {
        lastProcess = g.process?.index;
        hh.overlay(processBanner(g), "band");
      }
      // Your turn: say so, loudly.
      const st = stage();
      if (st !== lastStage) {
        if (st === "AIM") {
          // Your shot beats the tutorial: it gets out of the way (the "?" brings it back).
          closeTutorial();
          aim.a = g.action.aim.a;
          aim.p = g.action.aim.p;
          hh.notify("YOUR SHOT", { kind: "ok", icon: "🎯", replace: true });
          hh.flash("ok");
          buzz([60, 40, 60]);
          playSfx("achievement");
        }
        if (st !== "FLIGHT") setSteer(0);
        lastStage = st;
      }
      if (g.phase === "ACTION" && g.action?.stage === "NEED_BIRD" && g.action.shooterId !== me && mine()?.birds.length) buzz(20);
      // News that's about you (or bad for everyone) reaches your device too.
      const myName = mine()?.name ?? "\u0000";
      for (const line of g.log) {
        if (line.id <= lastLog) continue;
        lastLog = line.id;
        if (line.kind === "danger" || line.text.includes(myName)) hh.notify(line.text, { kind: line.kind === "danger" ? "danger" : line.kind === "ok" ? "ok" : "info", icon: line.kind === "danger" ? "⚠" : "•", ms: 2400 });
      }
      const p = mine();
      const b = birdType(p?.birds[p?.selected] ?? p?.bird);
      status.textContent =
        g.phase === "SELECT" ? `You: ${b?.name ?? ""} · ${p?.ready ? "ready" : "not ready"}` : `${PHASE_TITLE[g.phase]}${g.turn ? ` · turn ${g.turn}` : ""}${g.phase === "ACTION" && g.action?.shooterId ? ` · ${g.roster.find((q) => q.id === g.action.shooterId)?.name} shooting` : ""}`;
      hh.setStatus({ title: `${PHASE_TITLE[g.phase]}`, battery: Math.max(0.03, g.corruption / 100) });
      view.update(g);
      forecast.update(g);
      renderInventory();
      if (placing) movePlacement(placing.x, false);
      renderPanel(false);
      const aiming = st === "AIM";
      for (const bt of [left, right, up, down]) bt.disabled = !(aiming || placing || st === "FLIGHT");
      aBtn.disabled = !(aiming || placing || st === "FLIGHT");
      xBtn.disabled = !(p?.birds.length > 1) || st === "FLIGHT";
      bBtn.disabled = !placing;
    },
  };
}

/** A player's first game: the tutorial opens once the screen has settled (never again after). */
function firstTimeTutorial(state) {
  if (tutorialSeen()) return;
  const g = state.game;
  setTimeout(() => {
    const shooting = g.phase === "ACTION" && g.action?.shooterId === g.you?.playerId;
    if (document.querySelector(".td-phone") && !shooting) showTutorial(g, { me: g.you?.playerId });
  }, 700);
}

export function render(mount, state, tools) {
  const g = state.game;
  if (!g) return;
  if (!g.you || g.you.spectator) return mount(`thud:${g.session}:watch`, (s) => ({ node: systemCard({ eyebrow: TITLE, title: "Watching", text: "This game started without you. Watch the big screen!" }) }), state);
  mount(
    `thud:${g.session}`,
    (s) => {
      firstTimeTutorial(s);
      return buildScreen(s, tools);
    },
    state,
  );
}
