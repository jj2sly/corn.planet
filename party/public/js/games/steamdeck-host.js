// Escape Thad's Steam Deck on the big screen: the whole round plays inside a CPI handheld. It boots,
// launches the game and introduces everyone, then the level runs live on its screen (leaning with
// Thad's tilt, the device rocking and its stick and shoulder buttons following Thad's hands), phase
// changes arrive as system notifications, and the round report opens on the same screen.
// Sounds go through the party's sound manager (mycob-sound.js).

import { el } from "../common.js";
import { createHandheld, systemCard } from "../cpi/handheld.js";
import { playNewCues, playSfx, preloadSounds, soundControl } from "./mycob-sound.js";
import { assignmentBand, badge, battery, castOf, launchSteps, levelCard, liveTimer, PHASE_TITLE, phaseNotice, roundReport, TITLE } from "./steamdeck-ui.js";
import { createWorldView } from "./steamdeck-world.js";

/** The roster under the device: each runner's character, name and how they're doing. */
function rosterStrip(g) {
  const cast = castOf(g);
  const rows = new Map();
  const list = el("ul", { class: "sd-roster", "aria-label": "Runners" });
  for (const r of g.roster) {
    const b = badge(cast.get(r.id), { size: 34 });
    const note = el("span", { class: "sd-roster-note mono" });
    const li = el("li", {}, b.canvas, el("span", { class: "sd-roster-name", text: r.name }), note);
    li.style.setProperty("--agent", r.color);
    rows.set(r.id, { li, note, canvas: b.canvas, out: false });
    list.append(li);
  }
  return {
    node: list,
    ids: g.roster.map((r) => r.id).join(","),
    update(next) {
      for (const r of next.roster) {
        const row = rows.get(r.id);
        if (!row) continue;
        const out = r.escapedMs !== null;
        const text = out ? `✓ ${(r.escapedMs / 1000).toFixed(1)}s` : r.deaths ? `💀 ${r.deaths}` : "";
        if (row.note.textContent !== text) row.note.textContent = text;
        if (out !== row.out) {
          row.out = out;
          row.li.classList.toggle("out", out);
          row.canvas.paint({ state: out ? "cheer" : "idle", t: 0.2 });
        }
      }
    },
  };
}

const stamp = (text, kind = "") => el("div", { class: `sd-stamp-big ${kind}`.trim(), text });

const HOWTO = [
  "Runners: ◀ ▶ / ← → move · A / Space jump · B / E draw a plank across a gap",
  "Thad: lean the level with ← →, hold L / R, or the slider. Worse every phase",
  "Spikes kill. A dashed box with ⚠ is spikes on their way",
];

function buildRound(s) {
  const g0 = s.game;
  let g = g0;
  let phase = null;
  let paused = false;

  const eyebrow = el("p", { class: "eyebrow" });
  const title = el("h1", { class: "sd-title" });
  const timer = liveTimer();
  const head = el("div", { class: "phase-head sd-hud" }, el("div", { class: "sd-hud-title" }, title, eyebrow), el("div", { class: "row" }, timer.node, soundControl()));

  let roster = rosterStrip(g0);
  const rosterSlot = el("div", { class: "sd-roster-slot" }, roster.node);
  const hh = createHandheld({ title: TITLE, owner: g0.thad.name.toUpperCase(), layout: "landscape", rock: true, below: rosterSlot, label: `${g0.level.name}: the level, live`, className: "sd-device sd-device-host" });
  const canvas = el("canvas", { class: "sd-canvas", "aria-hidden": "true" });
  hh.screen.append(canvas);
  hh.setStatus({ extra: el("span", { class: "cpi-hh-chip", text: `HELD BY ${g0.thad.name}` }) });
  const achieved = new Set();
  const view = createWorldView(canvas, {
    rotate: true,
    labels: true,
    onEvent: (type, detail = {}) => {
      if (type === "part") hh.notify(`FOUND ${detail.name} · ${detail.found}/${detail.need}`, { kind: "ok", icon: "🔧" });
      else if (type === "unlocked") {
        hh.notify("DECK REASSEMBLED · THE DOCK IS OPEN", { kind: "ok", icon: "✓", replace: true });
        hh.flash("ok");
      } else if (type === "achievement" && !achieved.has(`${detail.id}:${detail.key}`)) {
        // Once per agent per achievement a round: news, not spam.
        achieved.add(`${detail.id}:${detail.key}`);
        const who = g.roster.find((r) => r.id === detail.id)?.name ?? "Someone";
        hh.notify(`${who}: ${detail.title}`, { kind: "info", icon: "🏆", ms: 2000 });
      }
      if (type === "plank") playSfx("plank_place", { volume: 0.7 });
      else if (type === "hazard") playSfx("hazard_arm");
      else if (type === "rumble") {
        playSfx("deck_shake");
        hh.notify("THAD IS SHAKING THE DECK", { kind: "danger", icon: "⚠", ms: 1200 });
      } else if (type === "shake") hh.shake(500);
    },
  });
  view.update(g0);

  const node = el("div", { class: "sd-host" }, head, hh.node);

  preloadSounds();
  playNewCues(`steamdeck:${g0.session}`, g0.cues, { fresh: g0.phase === "ASSIGNMENT" && g0.round === 1 });

  const enter = (next, remainingMs) => {
    const p = next.phase;
    eyebrow.textContent = `Round ${next.round} of ${next.totalRounds} · ${next.level.name}`;
    title.textContent = PHASE_TITLE[p];
    title.className = `sd-title p-${p}`;
    // A transition only for a change seen live: a reconnect mid-phase just shows where things are.
    const live = phase !== null;
    const news = phaseNotice(next);
    if (news && live) hh.notify(news.text, { ...news, replace: true });
    if (p === "ASSIGNMENT") {
      // A fresh start gets the whole launch; a reload part-way through just gets the roles.
      if ((remainingMs ?? 0) > 5_000) {
        hh.sequence(launchSteps(next, { short: next.round > 1, size: 64, onBoot: () => playSfx("device_boot") })).done.then(() => {
          if (phase === "ASSIGNMENT" && !paused) hh.overlay(assignmentBand(next), "band bottom");
        });
      } else hh.overlay(assignmentBand(next), "band bottom");
    } else if (p === "INTRO") hh.overlay(levelCard(next, { howto: HOWTO }), "card");
    else if (p === "ESCAPE") {
      if (live) hh.overlay(stamp("GO!", "ok"), "stamp", { ms: 900 });
      else hh.clearOverlay();
    } else if (p === "ESCALATION" || p === "FINAL") {
      const danger = p === "FINAL";
      if (live) {
        hh.overlay(stamp(danger ? "FINAL ESCAPE WINDOW" : "THAD IS ANGRY", danger ? "danger" : "warn"), "band", { ms: 1800 });
        hh.flash(danger ? "danger" : "warn");
        hh.shake();
      } else hh.clearOverlay();
    } else if (p === "RESULTS") {
      hh.overlay(roundReport(next), "report");
      const out = next.results?.escaped ?? 0;
      if (live) hh.flash(out === next.results?.total ? "ok" : out === 0 ? "danger" : "warn");
    }
    phase = p;
  };

  let lastRoster = new Map(g0.roster.map((r) => [r.id, r.escapedMs]));
  let creakAt = 0;
  let wasLeaning = false;

  return {
    node,
    update(next) {
      g = next.game;
      playNewCues(`steamdeck:${g.session}`, g.cues);
      timer.set(next.timer);
      if (next.paused !== paused) {
        paused = next.paused;
        if (paused) hh.overlay(systemCard({ eyebrow: "SYSTEM", title: "PAUSED", text: "Waiting for the host display." }), "card");
        else {
          // Back where we were, without replaying the phase's entrance.
          phase = null;
          enter(g, 0);
        }
      }
      if (g.phase !== phase && !paused) enter(g, next.timer?.remainingMs);
      view.update(g);
      if (roster.ids !== g.roster.map((r) => r.id).join(",")) {
        roster = rosterStrip(g);
        rosterSlot.replaceChildren(roster.node);
      }
      roster.update(g);
      // Escapes are news; deaths are just the roster (too many to announce).
      for (const r of g.roster) {
        if (r.escapedMs !== null && lastRoster.get(r.id) === null) hh.notify(`${r.name} escaped · ${(r.escapedMs / 1000).toFixed(1)}s`, { kind: "ok", icon: "✓" });
      }
      lastRoster = new Map(g.roster.map((r) => [r.id, r.escapedMs]));
      const connected = next.players.filter((p) => p.connected).length;
      hh.setStatus({ battery: battery(g.phase, next.timer), signal: next.players.length ? connected / next.players.length : 1 });
      hh.setTilt(g.world.tilt);
      // The Deck creaks when Thad really leans on it.
      const leaning = Math.abs(g.world.tilt) > 0.75;
      if (leaning && !wasLeaning && performance.now() - creakAt > 2_000) {
        creakAt = performance.now();
        playSfx("tilt_creak", { volume: 0.8 });
      }
      wasLeaning = leaning;
    },
  };
}

export function render(mount, state) {
  const g = state.game;
  if (g) mount(`steamdeck:${g.session}:${g.round}`, buildRound, state);
}
