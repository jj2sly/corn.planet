// CPI: Cold Case — the HUD and screens (DOM over the canvas). Reads the simulation's state and
// events; the only thing it changes is what is shown. Text is always set with textContent.

import { el } from "../common.js";
import { TEXT } from "./content.js";
import { CONFIG, debrief, inHeat } from "./sim.js";
import { drawMinimap } from "./render.js";

const $ = (id) => document.getElementById(id);
const ACTIVE = new Set(["chase", "curious", "crawl", "windup", "lunge"]);

const PANELS = {
  thermostat: { title: "STORAGE THERMOSTAT", kicker: "FOOD STORAGE // TEMPERATURE LOOP" },
  mainbus: { title: "MAIN BUS", kicker: "POWER ROOM // RELAYS" },
  compressor: { title: "COMPRESSOR", kicker: "FREEZER // COOLANT PRESSURE" },
  consolePressure: { title: "CORE PRESSURE", kicker: "REFRIGERATOR CORE // STAGE 2" },
  consoleTemp: { title: "CORE TEMPERATURE", kicker: "REFRIGERATOR CORE // STAGE 3" },
};

export function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const signed = (v, digits = 1) => `${v > 0.05 ? "+" : v < -0.05 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;

export function createHud() {
  const els = {
    hud: $("hud"),
    objText: $("objText"),
    objDetail: $("objDetail"),
    objBar: $("objBar"),
    zoneName: $("zoneName"),
    temp: $("temp"),
    trend: $("trend"),
    minimap: $("minimap"),
    hpVal: $("hpVal"),
    hpBar: $("hpBar"),
    warmVal: $("warmVal"),
    warmBar: $("warmBar"),
    packs: $("packs"),
    threat: $("threat"),
    status: $("status"),
    prompt: $("prompt"),
    promptKey: $("promptKey"),
    promptText: $("promptText"),
    promptBar: $("promptBar"),
    banner: $("banner"),
    feed: $("feed"),
    panel: $("panel"),
    panelKicker: $("panelKicker"),
    panelTitle: $("panelTitle"),
    panelHint: $("panelHint"),
    panelBody: $("panelBody"),
    panelPrimary: $("panelPrimary"),
    dialogue: $("dialogue"),
    dialogueSpeaker: $("dialogueSpeaker"),
    dialogueText: $("dialogueText"),
    touchUse: $("touchUse"),
    touchHeat: $("touchHeat"),
    touchPacks: $("touchPacks"),
    down: $("down"),
    downText: $("downText"),
    downBar: $("downBar"),
    bigmap: $("bigmap"),
    mapView: $("mapView"),
  };
  const shown = new Map();
  const seenZones = new Set();
  let panelKey = "";
  let panelParts = null;
  let minimapT = 0;
  let tempHistory = [];
  let dialogueTimer = 0;
  let bannerTimer = 0;

  const set = (node, text) => {
    if (shown.get(node) !== text) {
      shown.set(node, text);
      node.textContent = text;
    }
  };
  const width = (node, fraction) => {
    const v = `${Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 10}%`;
    if (shown.get(node) !== v) {
      shown.set(node, v);
      node.style.width = v;
    }
  };
  const toggle = (node, cls, on) => {
    if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
  };

  function banner(text, sub = "", message = false) {
    clearTimeout(bannerTimer);
    const b = els.banner;
    b.hidden = false;
    b.className = message ? "banner message" : "banner";
    b.replaceChildren(document.createTextNode(text), ...(sub ? [el("small", { text: sub })] : []));
    // Restart the CSS animation.
    void b.offsetWidth;
    b.style.animation = "none";
    void b.offsetWidth;
    b.style.animation = "";
    bannerTimer = setTimeout(() => (b.hidden = true), 2700);
  }

  function feed(text, tone) {
    const li = el("li", { class: tone, text });
    els.feed.append(li);
    while (els.feed.children.length > 4) els.feed.firstElementChild.remove();
    setTimeout(() => li.remove(), 4300);
  }

  function onEvent(state, e) {
    switch (e.type) {
      case "message":
        if (e.big) banner(e.text, "", true);
        else feed(e.text, e.tone);
        break;
      case "zone":
        if (!seenZones.has(e.zone) && state.phase === "PLAYING") {
          seenZones.add(e.zone);
          banner(e.name, "ZONE ENTERED");
        }
        break;
      case "dialogue": {
        clearTimeout(dialogueTimer);
        els.dialogue.hidden = false;
        els.dialogueSpeaker.textContent = String(e.speaker);
        els.dialogueText.textContent = e.lines.join(" ");
        els.dialogue.style.animation = "none";
        void els.dialogue.offsetWidth;
        els.dialogue.style.animation = "";
        dialogueTimer = setTimeout(() => (els.dialogue.hidden = true), 7000);
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- panels

  function buildPanel(panel, touch) {
    const key = panel.kind === "dial" ? "thermostat" : panel.id === "console" ? (panel.kind === "pressure" ? "consolePressure" : "consoleTemp") : panel.id;
    const info = PANELS[key] ?? { title: panel.id.toUpperCase(), kicker: "REPAIR" };
    els.panelKicker.textContent = info.kicker;
    els.panelTitle.textContent = info.title;
    const gauge = el("div", { class: "gauge" });
    const readout = el("div", { class: "panel-readout" });
    els.panelBody.replaceChildren(gauge, readout);
    const parts = { gauge, readout };
    const primary = els.panelPrimary;
    primary.disabled = false;
    toggle(els.panel, "adjustable", panel.kind === "dial" || panel.kind === "balance");
    if (panel.kind === "dial") {
      els.panelHint.textContent = touch ? "− / + sets the loop temperature. CONFIRM applies it." : "◀ ▶ or A / D sets the loop temperature · E or SPACE applies it · ESC closes";
      primary.textContent = "CONFIRM";
      const pos = (v) => `${((v - panel.min) / (panel.max - panel.min)) * 100}%`;
      const thaw = el("i", { class: "mark thaw" }, el("span", { text: `THAW +${CONFIG.thaw.point}°` }));
      thaw.style.left = pos(CONFIG.thaw.point);
      const dairy = el("i", { class: "mark dairy" }, el("span", { text: `DAIRY +${CONFIG.milk.spoilAbove}°` }));
      dairy.style.left = pos(CONFIG.milk.spoilAbove);
      parts.fill = el("i", { class: "fill" });
      parts.needle = el("i", { class: "needle" });
      gauge.append(parts.fill, thaw, dairy, parts.needle);
      parts.value = el("b");
      parts.current = el("span");
      readout.append(el("span", {}, "SETPOINT ", parts.value), parts.current);
      parts.pos = pos;
    } else if (panel.kind === "timing") {
      els.panelHint.textContent = touch ? "Tap ENGAGE when the needle is in the green." : "Press E or SPACE when the needle is in the green · ESC closes";
      primary.textContent = "ENGAGE";
      parts.band = el("i", { class: "zone-band" });
      parts.needle = el("i", { class: "needle" });
      gauge.append(parts.band, parts.needle);
      parts.lights = el("span", { class: "lights" });
      readout.append(el("span", { text: "RELAYS" }), parts.lights);
    } else if (panel.kind === "pressure") {
      els.panelHint.textContent = touch ? "Hold BUILD to raise pressure. Let go inside the green to lock it." : "Hold E or SPACE to build pressure · let go inside the green to lock it · ESC closes";
      primary.textContent = "HOLD TO BUILD";
      parts.band = el("i", { class: "zone-band" });
      parts.fill = el("i", { class: "fill" });
      gauge.append(parts.fill, parts.band);
      parts.lights = el("span", { class: "lights" });
      parts.value = el("b");
      readout.append(el("span", {}, "PRESSURE ", parts.value), parts.lights);
    } else if (panel.kind === "balance") {
      els.panelHint.textContent = touch ? "Hold − (colder) or + (warmer) to keep the core in the green." : "Hold ◀ / A (colder) or ▶ / D (warmer) to keep the core in the green · ESC closes";
      primary.textContent = "KEEP IT IN THE GREEN";
      primary.disabled = true;
      const B = CONFIG.balance;
      const pos = (v) => `${((v - B.min) / (B.max - B.min)) * 100}%`;
      parts.band = el("i", { class: "zone-band" });
      parts.band.style.left = pos(panel.band[0]);
      parts.band.style.width = `${((panel.band[1] - panel.band[0]) / (B.max - B.min)) * 100}%`;
      parts.needle = el("i", { class: "needle" });
      gauge.append(parts.band, parts.needle);
      parts.value = el("b");
      parts.progress = el("div", { class: "bar thin" }, el("i"));
      readout.append(el("span", {}, "CORE ", parts.value), el("span", { text: "STABLE TIME" }));
      els.panelBody.append(parts.progress);
      parts.pos = pos;
    }
    return parts;
  }

  function lights(node, n, of) {
    const key = `${n}/${of}`;
    if (shown.get(node) === key) return;
    shown.set(node, key);
    node.replaceChildren(...Array.from({ length: of }, (_, i) => el("i", { class: i < n ? "on" : "" })));
  }

  function updatePanel(state, touch) {
    const panel = state.panel;
    if (!panel) {
      if (!els.panel.hidden) els.panel.hidden = true;
      panelKey = "";
      return;
    }
    const key = `${panel.id}:${panel.kind}:${touch}`;
    if (key !== panelKey) {
      panelKey = key;
      panelParts = buildPanel(panel, touch);
      els.panel.hidden = false;
    }
    const parts = panelParts;
    toggle(els.panel, "good", panel.result === "success" || (panel.flash === "good" && panel.flashT > 0));
    toggle(els.panel, "bad", panel.flash === "bad" && panel.flashT > 0);
    if (panel.kind === "dial") {
      parts.needle.style.left = parts.pos(panel.value);
      parts.fill.style.width = parts.pos(panel.value);
      toggle(parts.fill, "hot", panel.value > CONFIG.milk.spoilAbove);
      set(parts.value, `${signed(panel.value, 0)}°C`);
      set(parts.current, `STORAGE NOW ${signed(panel.current ?? 0)}°C`);
    } else if (panel.kind === "timing") {
      parts.needle.style.left = `${panel.needle * 100}%`;
      parts.band.style.left = `${panel.window[0] * 100}%`;
      parts.band.style.width = `${(panel.window[1] - panel.window[0]) * 100}%`;
      lights(parts.lights, panel.hits, panel.need);
    } else if (panel.kind === "pressure") {
      parts.fill.style.width = `${Math.min(1, panel.value) * 100}%`;
      toggle(parts.fill, "hot", panel.value > panel.band[1]);
      parts.band.style.left = `${panel.band[0] * 100}%`;
      parts.band.style.width = `${(panel.band[1] - panel.band[0]) * 100}%`;
      set(parts.value, `${Math.round(panel.value * 100)}%`);
      lights(parts.lights, panel.locks, panel.need);
    } else if (panel.kind === "balance") {
      parts.needle.style.left = parts.pos(panel.value);
      set(parts.value, `${signed(panel.value)}°C`);
      width(parts.progress.firstElementChild, panel.inBand / panel.need);
    }
  }

  // ---------------------------------------------------------------- per frame

  function update(state, { objective, dt, touch, paused }) {
    const p = state.player;
    const playing = state.phase === "PLAYING" || state.phase === "DOWNED";
    if (els.hud.hidden === playing) els.hud.hidden = !playing;
    if (!playing) {
      updatePanel({ panel: null }, touch);
      return;
    }

    set(els.objText, objective.text);
    set(els.objDetail, objective.detail);
    width(els.objBar, objective.progress ?? 0);
    els.objBar.parentElement.hidden = objective.progress === null;

    const zone = state.zones[p.zone];
    set(els.zoneName, zone.name);
    const t = p.felt;
    set(els.temp, `${signed(t)}°C`);
    const cls = t >= 12 ? "warm" : t >= 2 ? "mild" : t >= -6 ? "cool" : t >= -15 ? "cold" : "extreme";
    for (const c of ["warm", "mild", "cool", "cold", "extreme"]) toggle(els.temp, c, c === cls);
    tempHistory.push(t);
    if (tempHistory.length > 60) tempHistory.shift();
    const delta = t - tempHistory[0];
    set(els.trend, delta > 0.6 ? "▲" : delta < -0.6 ? "▼" : "");

    set(els.hpVal, String(Math.ceil(p.hp)));
    width(els.hpBar, p.hp / CONFIG.player.maxHp);
    toggle(els.hpVal.parentElement, "low", p.hp < 35);
    set(els.warmVal, String(Math.ceil(p.warmth)));
    width(els.warmBar, p.warmth / CONFIG.player.maxWarmth);
    toggle(els.warmVal.parentElement, "low", p.warmth < CONFIG.cold.slowBelow);

    set(els.packs, `HEAT PACKS ${p.heatPacks}`);
    toggle(els.packs, "hot", p.heatPacks > 0);
    set(els.touchPacks, String(p.heatPacks));
    els.touchHeat.disabled = p.heatPacks <= 0;

    let near = Infinity;
    for (const th of state.threats) {
      if (th.leash !== p.zone || !ACTIVE.has(th.mode)) continue;
      near = Math.min(near, Math.hypot(th.x - p.x, th.y - p.y));
    }
    const level = near < 4 ? "HIGH" : near < 9 ? "LOW" : "NONE";
    set(els.threat, `THREAT ${level}`);
    toggle(els.threat, "danger", level === "HIGH");

    let status = "";
    let statusCls = "";
    if (p.warmth <= 0) [status, statusCls] = ["HYPOTHERMIA", "danger"];
    else if (state.time < p.slowUntil) [status, statusCls] = ["SLOWED", "cold"];
    else if (state.heat.some((h) => h.id === "pack")) [status, statusCls] = ["HEAT PACK ACTIVE", "hot"];
    else if (inHeat(state, p.x, p.y) || (zone.safe && t > 12) || (zone.id === "OUTPOST" && state.flags.outpostFound)) [status, statusCls] = ["WARM ZONE", "hot"];
    else if (p.warmth < CONFIG.cold.slowBelow) [status, statusCls] = ["FREEZING", "cold"];
    els.status.hidden = !status;
    set(els.status, status);
    for (const c of ["danger", "cold", "hot"]) toggle(els.status, c, c === statusCls);

    // Interaction prompt.
    const target = state.target;
    const showPrompt = target && !state.panel && state.phase === "PLAYING" && !state.transition;
    els.prompt.hidden = !showPrompt;
    if (showPrompt) {
      const st = target.type === "station" ? state.map.stations.find((s) => s.id === target.id) : null;
      const hold = st?.kind === "hold" && target.available;
      const keyLabel = touch ? "USE" : "E";
      set(els.promptKey, target.available ? (hold ? `HOLD ${keyLabel}` : keyLabel) : "LOCKED");
      set(els.promptText, target.label);
      toggle(els.prompt, "locked", !target.available);
      const holding = state.hold && state.hold.id === target.id;
      toggle(els.promptBar.parentElement, "show", Boolean(holding));
      if (holding) width(els.promptBar, state.hold.t / state.hold.dur);
    }
    toggle(els.touchUse, "ready", Boolean(target?.available));

    // Down screen.
    const downed = state.phase === "DOWNED";
    els.down.hidden = !downed;
    if (downed) {
      set(els.downText, TEXT.messages.downing);
      width(els.downBar, 1 - state.downT / CONFIG.respawn.downTime);
    }

    updatePanel(state, touch);

    minimapT -= dt;
    if (minimapT <= 0) {
      minimapT = 0.2;
      const canvas = els.minimap;
      const size = Math.round(canvas.clientWidth * Math.min(2, globalThis.devicePixelRatio || 1));
      if (size > 0 && canvas.width !== size) {
        canvas.width = size;
        canvas.height = size;
      }
      drawMinimap(canvas, state, objective);
      if (!els.mapView.hidden) drawMinimap(els.bigmap, state, objective);
    }
  }

  // ---------------------------------------------------------------- screens

  function fillBriefing(touch, best) {
    const B = TEXT.briefing;
    $("briefKicker").textContent = TEXT.kicker;
    $("briefTitle").textContent = TEXT.title;
    $("briefFile").textContent = B.file;
    $("briefSite").textContent = B.site;
    $("briefSituation").textContent = B.situation;
    $("briefObjectives").replaceChildren(...B.objectives.map((o) => el("li", { text: o })));
    $("briefNotes").replaceChildren(...B.notes.map((n) => el("li", { text: n })));
    fillControls($("briefControls"), touch);
    $("briefBest").textContent = best ? `BEST EXTRACTION ${formatTime(best)}` : "";
  }

  function fillControls(node, touch) {
    const rows = touch ? TEXT.controls.touch : TEXT.controls.keyboard;
    node.replaceChildren(...rows.map(([k, v]) => el("span", {}, el("b", { text: k }), v)));
  }

  function fillDebrief(state, best, isBest) {
    const d = debrief(state);
    $("debriefHeading").textContent = TEXT.debrief.heading;
    $("debriefStatus").textContent = TEXT.debrief.status;
    const facts = [
      ["TIME", `${formatTime(d.time)}${isBest ? "  · NEW BEST" : best ? `  · BEST ${formatTime(best)}` : ""}`],
      ["DOWNS", String(d.downs)],
      ["DAMAGE TAKEN", String(d.damage)],
      ["HEAT PACKS USED", String(d.heatPacksUsed)],
      ["STORAGE SETPOINT", `${signed(d.setpoint, 0)}°C${d.spoiled ? " · DAIRY SPOILED" : ""}`],
      ["FOOD THREATS", d.threats.length ? d.threats.map((k) => (k === "milk" ? "MILK" : "ICE CREAM")).join(" · ") : "NONE ENGAGED"],
    ];
    $("debriefFacts").replaceChildren(...facts.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]));
    $("debriefSystems").replaceChildren(...d.systems.map(([name, ok, word]) => el("li", { class: ok ? "" : "no", text: `${name} — ${ok ? word : "NOT DONE"}` })));
  }

  function toggleMap(state, objective) {
    els.mapView.hidden = !els.mapView.hidden;
    if (!els.mapView.hidden) drawMinimap(els.bigmap, state, objective);
  }

  return { update, onEvent, fillBriefing, fillControls, fillDebrief, toggleMap, resetZones: () => seenZones.clear(), banner };
}
