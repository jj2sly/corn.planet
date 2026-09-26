// Angry Thud's Revenge on the big screen: Steam My Deck's CPI handheld launches the game from its
// library, then the whole battlefield runs live on its screen. The Corruption Meter, the Red Cow and
// the shared kernels sit above it; the team, the weather forecast and the news feed below.
// Sounds go through the party's sound manager (mycob-sound.js).

import { el } from "../common.js";
import { animateBirds } from "../cpi/bird.js";
import { createHandheld, systemCard } from "../cpi/handheld.js";
import { playNewCues, playSfx, preloadSounds, soundControl } from "./mycob-sound.js";
import { birdType } from "./thud-birds.js";
import { birdBadge, cowBand, forecastPanel, launchSteps, liveTimer, meters, overReport, PHASE_TITLE, processBanner, TITLE } from "./thud-ui.js";
import { createThudView } from "./thud-world.js";

function roster(g) {
  const list = el("ul", { class: "td-roster", "aria-label": "Agents" });
  const rows = new Map();
  const canvases = [];
  for (const p of g.roster) {
    const badge = birdBadge(p.bird, p.skin, { size: 34 });
    canvases.push(badge);
    const birds = el("span", { class: "td-roster-birds mono" });
    const tag = el("span", { class: "td-roster-tag" });
    const pts = el("span", { class: "td-roster-pts mono" });
    const li = el("li", {}, badge, el("span", { class: "td-roster-name", text: p.name }), birds, pts, tag);
    li.style.setProperty("--agent", p.color);
    rows.set(p.id, { li, birds, tag, pts, badge, sig: `${p.bird}:${p.skin}` });
    list.append(li);
  }
  animateBirds(canvases);
  return {
    node: list,
    ids: g.roster.map((p) => `${p.id}:${p.bird}:${p.skin}`).join(","),
    update(g, scores) {
      for (const p of g.roster) {
        const row = rows.get(p.id);
        if (!row) continue;
        row.birds.textContent = `🐦×${p.birds.length}`;
        row.pts.textContent = `${scores[p.id] ?? 0}`;
        const shooting = g.phase === "ACTION" && g.action?.shooterId === p.id;
        const tag = !p.here ? "AWAY" : shooting && g.action.stage === "NEED_BIRD" ? "NEEDS A BIRD" : shooting ? "SHOOTING" : g.phase === "SELECT" ? (p.ready ? "READY" : "CHOOSING") : g.phase === "BUILD" && p.vote ? "SKIP ✓" : !p.birds.length && g.phase !== "SELECT" && g.phase !== "LAUNCH" ? "NO BIRDS" : "";
        if (row.tag.textContent !== tag) row.tag.textContent = tag;
        row.li.classList.toggle("up", shooting);
        row.li.classList.toggle("empty", !p.birds.length && g.phase !== "SELECT" && g.phase !== "LAUNCH");
        row.li.classList.toggle("away", !p.here);
      }
    },
  };
}

const stamp = (text, kind = "") => el("div", { class: `sd-stamp-big ${kind}`.trim(), text });

function selectCard(g) {
  const canvases = [];
  const node = systemCard({
    eyebrow: "ON YOUR PHONES",
    title: "CHOOSE YOUR BIRD",
    text: "Each bird plays differently. Skins are just for looks. Ready up when you're happy.",
    kind: "level",
    children: [
      el(
        "ul",
        { class: "td-select-roster" },
        g.roster.map((p) => {
          const c = birdBadge(p.bird, p.skin, { size: 54, state: p.ready ? "cheer" : "idle" });
          canvases.push(c);
          const b = birdType(p.bird);
          return el("li", { class: p.ready ? "ready" : "" }, c, el("strong", { text: p.name }), el("span", { text: `${b?.icon ?? ""} ${b?.name ?? ""} · ${b?.role ?? ""}` }), el("span", { class: "td-ready", text: p.ready ? "READY" : "…" }));
        }),
      ),
    ],
  });
  animateBirds(canvases);
  return node;
}

function actionBand(g) {
  const a = g.action;
  const p = g.roster.find((q) => q.id === a?.shooterId);
  if (!a || !p) return null;
  if (a.stage === "NEED_BIRD") return el("div", { class: "td-band danger" }, el("span", { class: "td-band-tag", text: "NEEDS A BIRD" }), el("span", { text: `${p.name} is out of birds. Anyone: DONATE one from your phone.` }));
  const type = a.flying?.bird ?? p.birds[p.selected] ?? p.bird;
  const b = birdType(type);
  const turn = `${a.index + 1}/${a.queue.length}`;
  if (a.stage === "FLIGHT") return el("div", { class: "td-band" }, el("span", { class: "td-band-tag", text: `${turn} · IN FLIGHT` }), el("span", { text: `${p.name}'s ${b?.name ?? "bird"} · ${b?.usage ?? ""}` }));
  if (a.stage === "AIM") return el("div", { class: "td-band" }, el("span", { class: "td-band-tag", text: `${turn} · ${p.name.toUpperCase()} IS UP` }), el("span", { text: `${b?.icon ?? ""} ${b?.name ?? "Bird"}: ${b?.blurb ?? ""}` }));
  return null;
}

function buildBand(g) {
  return el(
    "div",
    { class: "td-band" },
    el("span", { class: "td-band-tag", text: `TURN ${g.turn} · BUILD` }),
    el("span", { text: `Spend the team's ${g.kernels.balance} kernels on your phones. Skip: ${g.build.votes}/${g.build.needed} votes.` }),
  );
}

function buildScreen(s) {
  const g0 = s.game;
  let latest = s;
  let g = g0;
  let phase = null;
  let bandSig = "";
  let paused = false;
  const title = el("h1", { class: "sd-title td-title" });
  const eyebrow = el("p", { class: "eyebrow" });
  const timer = liveTimer();
  const m = meters();
  const head = el("div", { class: "phase-head sd-hud td-hud" }, el("div", { class: "sd-hud-title" }, title, eyebrow), m.node, el("div", { class: "row" }, timer.node, soundControl()));
  let team = roster(g0);
  const teamSlot = el("div", { class: "td-team-slot" }, team.node);
  const forecast = forecastPanel();
  const feed = el("ol", { class: "td-feed", "aria-live": "polite", "aria-label": "What just happened" });
  const below = el("div", { class: "td-below" }, teamSlot, forecast.node, feed);
  const hh = createHandheld({ title: "STEAM MY DECK", owner: "THE TEAM", layout: "landscape", below, label: `${g0.level.name}: the battlefield, live`, className: "sd-device sd-device-host td-device" });
  hh.setStatus({ extra: el("span", { class: "cpi-hh-chip", text: TITLE }) });
  const canvas = el("canvas", { class: "sd-canvas", "aria-hidden": "true" });
  hh.screen.append(canvas);
  const view = createThudView(canvas, {
    mode: "host",
    onFx: (e) => {
      if (e.t === "boom" || e.t === "quake") hh.shake(e.t === "quake" ? 900 : 350);
      if (e.t === "chain") hh.notify(`CHAIN REACTION ×${e.n}`, { kind: "ok", icon: "💥", ms: 1800 });
      if (e.t === "bolt") hh.flash("warn", 500);
    },
  });
  view.update(g0);
  const node = el("div", { class: "sd-host td-host" }, head, hh.node);
  preloadSounds();
  playNewCues(`thud:${g0.session}`, g0.cues, { fresh: g0.phase === "SELECT" });
  let lastLog = g0.log.at(-1)?.id ?? 0;
  let lastCorruption = g0.corruption;
  let lastKernels = g0.kernels.balance;

  const band = (next) => {
    const sig = JSON.stringify([next.phase, next.action?.stage, next.action?.shooterId, next.process?.index, next.process?.detail, next.build.votes, next.kernels.balance, next.roster.map((p) => [p.bird, p.skin, p.ready])]);
    if (sig === bandSig) return;
    bandSig = sig;
    if (next.phase === "SELECT") hh.overlay(selectCard(next), "card");
    else if (next.phase === "BUILD") hh.overlay(buildBand(next), "band bottom");
    else if (next.phase === "ACTION") {
      const b = actionBand(next);
      if (b) hh.overlay(b, "band bottom");
    } else if (next.phase === "PROCESS") hh.overlay(processBanner(next), "band");
  };

  const enter = (next, remainingMs) => {
    const p = next.phase;
    const live = phase !== null;
    title.textContent = PHASE_TITLE[p];
    title.className = `sd-title td-title p-${p}`;
    bandSig = "";
    if (p === "LAUNCH") {
      if ((remainingMs ?? 0) > 3000) hh.sequence(launchSteps(next, { onBoot: () => playSfx("device_boot") }));
    } else if (p === "BUILD") {
      if (live) {
        hh.overlay(stamp(`TURN ${next.turn} · BUILD`, "ok"), "stamp", { ms: 1000 });
        hh.notify(`Turn ${next.turn}: build phase · ${next.kernels.balance} kernels`, { kind: "info", icon: "🔨", replace: true });
        setTimeout(() => phase === "BUILD" && band(g), 1100);
      } else band(next);
    } else if (p === "ACTION") {
      if (live) {
        hh.overlay(stamp("LAUNCH!", "warn"), "stamp", { ms: 900 });
        setTimeout(() => phase === "ACTION" && ((bandSig = ""), band(g)), 950);
        if (next.weather) {
          hh.notify(`WEATHER: ${next.weather.label.toUpperCase()} · ${next.weather.severity}`, { kind: "warn", icon: "⛈", ms: 3200 });
          hh.flash("warn");
        }
      } else band(next);
    } else if (p === "PROCESS" || p === "SELECT") band(next);
    else if (p === "COW") {
      hh.overlay(cowBand(next), "band");
      hh.flash("danger", 1400);
      hh.shake(600);
    } else if (p === "OVER") {
      hh.overlay(overReport({ ...next, scores: Object.fromEntries(latest.players.map((q) => [q.id, q.score])) }), "report");
      hh.flash(next.over?.result === "victory" ? "ok" : "danger");
      // The awards land after the victory/defeat sting.
      setTimeout(() => playSfx("achievement", { volume: 0.7 }), 2400);
    }
    phase = p;
  };

  return {
    node,
    update(next) {
      latest = next;
      g = next.game;
      playNewCues(`thud:${g.session}`, g.cues);
      timer.set(next.timer);
      m.update(g);
      if (g.corruption < lastCorruption - 0.05) playSfx("thud_purge", { volume: 0.7 });
      lastCorruption = g.corruption;
      if (g.kernels.balance > lastKernels) playSfx("thud_kernels", { volume: 0.5 });
      lastKernels = g.kernels.balance;
      if (next.paused !== paused) {
        paused = next.paused;
        if (paused) hh.overlay(systemCard({ eyebrow: "SYSTEM", title: "PAUSED", text: "Waiting for the host display." }), "card");
        else {
          phase = null;
          enter(g, 0);
        }
      }
      if (g.phase !== phase && !paused) enter(g, next.timer?.remainingMs);
      else if (!paused) band(g);
      eyebrow.textContent = `${g.level.name} · ${g.turn ? `Turn ${g.turn}` : "Getting ready"}${g.phase === "ACTION" && g.weather ? ` · ${g.weather.label}` : ""}`;
      view.update(g);
      const ids = g.roster.map((p) => `${p.id}:${p.bird}:${p.skin}`).join(",");
      if (team.ids !== ids) {
        team = roster(g);
        teamSlot.replaceChildren(team.node);
      }
      team.update(g, Object.fromEntries(next.players.map((p) => [p.id, p.score])));
      forecast.update(g);
      // The news: into the feed, and the important bits into the device's notifications.
      for (const line of g.log) {
        if (line.id <= lastLog) continue;
        lastLog = line.id;
        feed.prepend(el("li", { class: line.kind, text: line.text }));
        while (feed.children.length > 6) feed.lastChild.remove();
        if (line.kind !== "info") hh.notify(line.text, { kind: line.kind === "danger" ? "danger" : line.kind === "warn" ? "warn" : "ok", icon: line.kind === "ok" ? "✓" : "⚠", ms: 2600 });
      }
      const connected = next.players.filter((p) => p.connected).length;
      hh.setStatus({ battery: Math.max(0.03, g.corruption / 100), signal: next.players.length ? connected / next.players.length : 1 });
    },
  };
}

export function render(mount, state) {
  const g = state.game;
  if (g) mount(`thud:${g.session}`, buildScreen, state);
}
