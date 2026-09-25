// My Cob Escaped sound manager. Every sound in the game goes through here: lookup, playback, volume,
// mute, the browser's autoplay rules and keeping sounds from piling up. Other games use it too
// (Steam My Deck): it's the party's one sound system.
//
// The server sends cues (`game.cues`: [{ id, cue }]) only for things every screen is already shown;
// the host plays each new one once, phones play their own few (your response filed, your life lost,
// your timer running out). Real sounds are mapped to cues in /sounds/mycob/sounds.json (see the
// README next to it): changing a sound never touches game code. A cue with no file mapped uses its
// synthesized placeholder below, if it has one, and is silent otherwise.
//
// Nothing waits for audio: a missing file, a browser that hasn't allowed sound yet or no Web Audio is
// just silence.

import { el, store } from "../common.js";

const BASE = "/sounds/mycob/";
const MANIFEST = `${BASE}sounds.json`;
const MUTE_KEY = "cpst-party:mycob-muted";
const VOLUME_KEY = "cpst-party:mycob-volume";

/** Every cue a screen can play: the engine's, plus `timer_warning` from the screens themselves. */
export const CUES = [
  "game_start",
  "alert",
  "timer_warning",
  "response_in",
  "success",
  "major_failure",
  "discovery",
  "chaos_up",
  "life_lost",
  "vote_start",
  "vote_result",
  "contained",
  "terminated",
  "escaped",
  "everyone_dies",
  "game_end",
  // Short game effects (playSfx): Steam My Deck.
  "device_boot",
  "jump",
  "land",
  "plank_place",
  "hazard_arm",
  "tilt_creak",
  "ui_click",
  "deck_shake",
  "achievement",
  "static",
];

/** Never dropped to make room for something else. */
const IMPORTANT = new Set(["game_start", "life_lost", "contained", "terminated", "escaped", "everyone_dies", "game_end"]);
/** The same cue again within this many seconds is dropped: four agents filing at once is one bloop. */
const SAME_CUE_GAP = 0.35;
/** Cues play one after another; the next may start this many seconds into a long one. */
const MAX_SLOT = 1.5;
/** A cue that would have to wait longer than this is dropped, unless important. */
const MAX_BACKLOG = 3;
/** At most this many sounds at once. */
const MAX_VOICES = 3;
/** When the timer warning sounds. */
const WARN_AT_MS = 10_000;

// A tone glides from `from` to `to` Hz; `vib` wobbles it (rate Hz, depth Hz). Noise is a hiss burst.
const tone = (at, dur, from, to = from, wave = "square", gain = 0.14, vib = null) => ({ at, dur, from, to, wave, gain, vib });
const hiss = (at, dur, gain = 0.12) => ({ at, dur, noise: true, gain });
const trombone = (notes, step, last) =>
  notes.map((f, i) => tone(i * step, i === notes.length - 1 ? last : step * 0.9, f, i === notes.length - 1 ? f * 0.97 : f, "sawtooth", 0.13, { rate: 6, depth: i === notes.length - 1 ? 9 : 4 }));

/** The placeholders, used until a file is mapped. */
const SYNTH = {
  game_start: [tone(0, 0.22, 700), tone(0.25, 0.22, 470), tone(0.5, 0.22, 700), tone(0.75, 0.3, 470)], // wee-woo wee-woo
  response_in: [tone(0, 0.12, 320, 900, "sine", 0.22)], // bloop
  major_failure: trombone([392, 370, 349, 330], 0.32, 1.1), // wah wah wah wahhh
  success: [tone(0, 0.11, 523, 523, "triangle", 0.2), tone(0.13, 0.4, 784, 800, "triangle", 0.2), tone(0.13, 0.4, 1047, 1060, "sine", 0.08)], // ta-da
  chaos_up: [tone(0, 0.6, 380, 1500, "sine", 0.18, { rate: 7, depth: 20 })], // slide whistle up
  discovery: [tone(0, 0.12, 1319, 1319, "sine", 0.16), tone(0.12, 0.45, 1760, 1760, "sine", 0.16)], // ding-ding
  life_lost: [tone(0, 0.2, 240, 80, "square", 0.18), hiss(0, 0.05, 0.08)], // bonk
  vote_start: [tone(0, 0.2, 330, 330, "sawtooth", 0.1, { rate: 28, depth: 14 }), tone(0.24, 0.3, 392, 392, "sawtooth", 0.1, { rate: 28, depth: 14 })], // kazoo
  vote_result: [tone(0, 0.1, 120, 70, "sine", 0.35), tone(0.18, 0.1, 140, 80, "sine", 0.35), hiss(0.36, 0.3, 0.1)], // ba-dum-tss
  escaped: [tone(0, 0.7, 1500, 300, "sine", 0.18, { rate: 7, depth: 20 }), tone(0.8, 0.35, 160, 520, "sine", 0.22)], // slide whistle down, boing
  contained: [tone(0, 0.12, 523), tone(0.13, 0.12, 659), tone(0.26, 0.12, 784), tone(0.39, 0.55, 1047, 1047, "square", 0.12)], // fanfare
  terminated: [tone(0, 0.35, 220, 60, "sawtooth", 0.16), tone(0.42, 0.12, 784, 784, "triangle", 0.2), tone(0.56, 0.5, 1047, 1047, "triangle", 0.2)], // womp, ta-da
  everyone_dies: trombone([294, 277, 262, 247], 0.5, 1.6), // the slowest, saddest trombone
  game_end: [392, 523, 659, 784, 659].map((f, i) => tone(i * 0.11, 0.1, f, f, "triangle", 0.18)).concat(tone(0.58, 0.6, 1047, 1047, "triangle", 0.18)), // silly flourish
  // Game effects: short and quiet, so a room full of them is texture, not noise.
  device_boot: [tone(0, 0.5, 110, 110, "sine", 0.08), tone(0.12, 0.14, 523, 523, "sine", 0.14), tone(0.24, 0.14, 784, 784, "sine", 0.14), tone(0.36, 0.5, 1047, 1060, "sine", 0.14)], // handheld power-on chime
  jump: [tone(0, 0.09, 300, 620, "square", 0.05)], // boop
  land: [tone(0, 0.08, 150, 70, "sine", 0.16), hiss(0, 0.04, 0.04)], // thud
  plank_place: [tone(0, 0.05, 240, 120, "square", 0.08), hiss(0, 0.03, 0.07), tone(0.1, 0.05, 260, 130, "square", 0.08), hiss(0.1, 0.03, 0.07)], // knock knock
  hazard_arm: [tone(0, 0.22, 1700, 2600, "sawtooth", 0.035), hiss(0, 0.16, 0.05)], // shhhing
  tilt_creak: [tone(0, 0.4, 95, 72, "sawtooth", 0.06, { rate: 26, depth: 9 })], // creeeak
  ui_click: [tone(0, 0.035, 1300, 900, "square", 0.04)], // tick
  achievement: [tone(0, 0.09, 880, 880, "square", 0.06), tone(0.1, 0.09, 1175, 1175, "square", 0.06), tone(0.2, 0.25, 1760, 1760, "square", 0.06)], // bleep-bloop-BLEEP
  static: [hiss(0, 0.35, 0.07)], // kkssshhh
  deck_shake: [tone(0, 0.5, 70, 50, "sawtooth", 0.12, { rate: 18, depth: 12 }), hiss(0.42, 0.18, 0.12), tone(0.45, 0.2, 140, 60, "square", 0.14)], // rrrrumble, WHUMP
};

// ------------------------------------------------------------------ settings (this device only)

export const isMuted = () => store.get("localStorage", MUTE_KEY) === true;
export const getVolume = () => {
  const v = store.get("localStorage", VOLUME_KEY);
  return typeof v === "number" && v >= 0 && v <= 1 ? v : 0.8;
};
export function setMuted(muted) {
  store.set("localStorage", MUTE_KEY, muted);
  applyVolume();
}
export function setVolume(volume) {
  store.set("localStorage", VOLUME_KEY, Math.min(1, Math.max(0, volume)));
  applyVolume();
}

// ------------------------------------------------------------------ the sound map

let manifest = null;

/** sounds.json: cue -> "file" | ["file", ...] | { files, volume }. Paths are relative to /sounds/mycob/. */
function loadManifest() {
  manifest ??= fetch(MANIFEST)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((raw) => {
      const map = new Map();
      for (const [cue, value] of Object.entries(raw ?? {})) {
        if (cue.startsWith("_")) continue;
        if (!CUES.includes(cue)) console.warn(`[mycob-sound] sounds.json: unknown cue "${cue}"`);
        const entry = typeof value === "string" || Array.isArray(value) ? { files: value } : (value ?? {});
        const files = [entry.files ?? []].flat().filter((f) => typeof f === "string" && f);
        const volume = typeof entry.volume === "number" ? Math.min(2, Math.max(0, entry.volume)) : 1;
        if (files.length) map.set(cue, { files: files.map((f) => (f.startsWith("/") ? f : BASE + f)), volume });
      }
      return map;
    });
  return manifest;
}

const bytes = new Map(); // url -> Promise<ArrayBuffer | null>
const decoded = new Map(); // url -> Promise<AudioBuffer | null>

function fetchBytes(url) {
  if (!bytes.has(url)) {
    bytes.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch((err) => (console.warn(`[mycob-sound] couldn't load ${url}: ${err.message}`), null)),
    );
  }
  return bytes.get(url);
}

function decode(ac, url) {
  if (!decoded.has(url)) {
    decoded.set(
      url,
      fetchBytes(url).then((data) => (data ? ac.decodeAudioData(data).catch(() => (console.warn(`[mycob-sound] couldn't decode ${url}`), null)) : null)),
    );
  }
  return decoded.get(url);
}

/** Downloads the mapped files for these cues ahead of time (no decoding, no audio needed yet). */
export function preloadSounds(cues = CUES) {
  loadManifest().then((map) => {
    for (const cue of cues) for (const url of map.get(cue)?.files ?? []) fetchBytes(url);
  });
}

// ------------------------------------------------------------------ playback

let ctx = null;
let master = null;

function context() {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyVolume();
  }
  return ctx;
}

function applyVolume() {
  if (master) master.gain.value = isMuted() ? 0 : getVolume();
}

// Browsers only allow sound once the page has been tapped, clicked or typed on: start or wake the
// audio then. Cues that arrive before that are skipped, not saved up to all play at once.
const unlock = () => {
  const ac = context();
  if (ac?.state === "suspended") ac.resume().catch(() => {});
};
for (const type of ["pointerdown", "keydown", "touchend"]) globalThis.addEventListener?.(type, unlock, { passive: true, capture: true });

let nextFree = 0;
let playing = []; // end times of the sounds scheduled so far
const lastStart = new Map(); // cue -> start time

/** When this cue may start, or null to drop it. */
function slot(ac, cue, length) {
  const now = ac.currentTime;
  const important = IMPORTANT.has(cue);
  const start = Math.max(now + 0.02, nextFree);
  if (start - (lastStart.get(cue) ?? -Infinity) < SAME_CUE_GAP) return null;
  playing = playing.filter((end) => end > start);
  if (!important && (start - now > MAX_BACKLOG || playing.length >= MAX_VOICES)) return null;
  playing.push(start + length);
  lastStart.set(cue, start);
  nextFree = start + Math.min(length, MAX_SLOT) + 0.1;
  return start;
}

function playBuffer(ac, buffer, volume, start) {
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const gain = ac.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(master);
  source.start(start);
}

function synth(ac, parts, start, volume = 1) {
  for (const p of parts) {
    const t0 = start + p.at;
    const t1 = t0 + p.dur;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, p.gain * volume), t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    gain.connect(master);
    let source;
    if (p.noise) {
      const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * p.dur), ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      source = ac.createBufferSource();
      source.buffer = buffer;
    } else {
      source = ac.createOscillator();
      source.type = p.wave;
      source.frequency.setValueAtTime(p.from, t0);
      source.frequency.exponentialRampToValueAtTime(p.to, t1);
      if (p.vib) {
        const lfo = ac.createOscillator();
        const depth = ac.createGain();
        lfo.frequency.value = p.vib.rate;
        depth.gain.value = p.vib.depth;
        lfo.connect(depth).connect(source.frequency);
        lfo.start(t0);
        lfo.stop(t1);
      }
    }
    source.connect(gain);
    source.start(t0);
    source.stop(t1 + 0.02);
  }
}

async function play(cue) {
  if (isMuted()) return;
  const ac = context();
  if (!ac) return;
  if (ac.state !== "running") return unlock();
  const entry = (await loadManifest()).get(cue);
  if (entry) {
    const url = entry.files[Math.floor(Math.random() * entry.files.length)];
    const buffer = await decode(ac, url);
    if (buffer) {
      const start = slot(ac, cue, buffer.duration);
      if (start !== null) playBuffer(ac, buffer, entry.volume, start);
      return;
    }
  }
  const parts = SYNTH[cue];
  if (!parts) return;
  const start = slot(ac, cue, Math.max(...parts.map((p) => p.at + p.dur)));
  if (start !== null) synth(ac, parts, start);
}

let queue = Promise.resolve();

/** Plays one cue now, or right after the ones before it. Never throws. */
export function playCue(cue) {
  // Chained so cues keep their order even while a file is still loading.
  queue = queue.then(() => play(cue)).catch(() => {});
}

// ------------------------------------------------------------------ game effects

/** At most this many effects at once, and the same one no closer than this (seconds). */
const MAX_SFX = 4;
const SFX_GAP = 0.06;
let sfxPlaying = [];
const sfxLast = new Map();

/**
 * A short game effect (a jump, a landing): plays right away, beside the cues rather than queued
 * behind them, and is dropped rather than delayed when too many are already playing. Same mute,
 * volume and sounds.json mapping as every cue. Never throws.
 */
export function playSfx(cue, { volume = 1 } = {}) {
  (async () => {
    if (isMuted()) return;
    const ac = context();
    if (!ac) return;
    if (ac.state !== "running") return unlock();
    const now = ac.currentTime;
    if (now - (sfxLast.get(cue) ?? -Infinity) < SFX_GAP) return;
    sfxPlaying = sfxPlaying.filter((end) => end > now);
    if (sfxPlaying.length >= MAX_SFX) return;
    sfxLast.set(cue, now);
    const entry = (await loadManifest()).get(cue);
    if (entry) {
      const buffer = await decode(ac, entry.files[Math.floor(Math.random() * entry.files.length)]);
      if (buffer) {
        sfxPlaying.push(now + buffer.duration);
        return playBuffer(ac, buffer, entry.volume * volume, ac.currentTime + 0.01);
      }
    }
    const parts = SYNTH[cue];
    if (!parts) return;
    sfxPlaying.push(now + Math.max(...parts.map((p) => p.at + p.dur)));
    synth(ac, parts, ac.currentTime + 0.01, volume);
  })().catch(() => {});
}

const seen = new Map();

/**
 * Plays the cues this screen hasn't played yet. `scope` keeps ids apart between games (the incident
 * code). A screen that first sees a game mid-way (a reload, a reconnect) plays nothing old.
 */
export function playNewCues(scope, cues, { fresh = false } = {}) {
  let ids = seen.get(scope);
  if (!ids) {
    ids = new Set(fresh ? [] : cues.map((c) => c.id));
    seen.set(scope, ids);
  }
  for (const { id, cue } of cues) {
    if (ids.has(id)) continue;
    ids.add(id);
    playCue(cue);
  }
}

const warned = new Set();
let warning = 0;

/**
 * Sounds `timer_warning` once when `timer` gets to its last few seconds. Call it with every update:
 * `key` names the countdown (null when this screen shouldn't warn), and a new key or null cancels.
 */
export function timerWarning(key, timer) {
  clearTimeout(warning);
  if (!key || !timer || timer.paused || warned.has(key)) return;
  const wait = timer.remainingMs - WARN_AT_MS;
  // Already inside the warning window (a reload, a late join): stay quiet.
  if (wait < 0) return;
  warning = setTimeout(() => {
    warned.add(key);
    playCue("timer_warning");
  }, wait);
}

/** Mute button and volume slider, remembered on this device. */
export function soundControl() {
  const button = el("button", { class: "btn subtle small", type: "button", "aria-label": "Mute sound" });
  const slider = el("input", { type: "range", min: "0", max: "100", step: "5", "aria-label": "Sound volume" });
  const paint = () => {
    button.textContent = isMuted() ? "🔇" : "🔊";
    button.setAttribute("aria-pressed", String(isMuted()));
    slider.value = String(Math.round(getVolume() * 100));
  };
  button.addEventListener("click", () => {
    setMuted(!isMuted());
    paint();
    if (!isMuted()) playCue("response_in");
  });
  slider.addEventListener("input", () => {
    setVolume(Number(slider.value) / 100);
    if (isMuted()) setMuted(false);
    paint();
  });
  slider.addEventListener("change", () => playCue("response_in"));
  paint();
  return el("div", { class: "mc-sound", role: "group", "aria-label": "Sound" }, button, slider);
}
