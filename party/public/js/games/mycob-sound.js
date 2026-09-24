// My Cob Escaped sound effects. The server sends cues (`game.cues`: [{ id, cue }]) only for things
// every screen is already being shown; the host screen plays each new one once, and phones play
// their own few (your response filed, your life lost).
//
// Every cue has an original placeholder synthesized right here with Web Audio: deliberately goofy
// (klaxons, slide whistles, a sad trombone, kazoo buzzes, boings). To swap one for a real sound, put
// the file under public/sounds/mycob/ and name it in SOUND_FILES, e.g.
//
//   life_lost: "/sounds/mycob/life_lost.mp3",
//
// Nothing waits for audio: a missing file or a browser that hasn't allowed sound yet is just silence.

import { el, store } from "../common.js";

/** cue -> URL of a real sound file. Empty: every cue uses its placeholder. */
export const SOUND_FILES = {};

const MUTE_KEY = "cpst-party:mycob-muted";

// A tone glides from `from` to `to` Hz; `vib` wobbles it (rate Hz, depth Hz). Noise is a hiss burst.
const tone = (at, dur, from, to = from, wave = "square", gain = 0.14, vib = null) => ({ at, dur, from, to, wave, gain, vib });
const hiss = (at, dur, gain = 0.12) => ({ at, dur, noise: true, gain });
const trombone = (notes, step, last) =>
  notes.map((f, i) => tone(i * step, i === notes.length - 1 ? last : step * 0.9, f, i === notes.length - 1 ? f * 0.97 : f, "sawtooth", 0.13, { rate: 6, depth: i === notes.length - 1 ? 9 : 4 }));

/** The placeholders. */
export const SYNTH = {
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
};

export const isMuted = () => store.get("localStorage", MUTE_KEY) === true;

let ctx = null;
let nextFree = 0;

function audio() {
  const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Browsers only allow sound after a tap or click on the page; wake the audio on each one.
globalThis.addEventListener?.("pointerdown", () => ctx?.state === "suspended" && ctx.resume().catch(() => {}), { passive: true });

function synth(parts) {
  const ac = audio();
  if (!ac) return;
  // Cues that arrive together play one after another, not on top of each other.
  const start = Math.max(ac.currentTime + 0.02, nextFree);
  const length = Math.max(...parts.map((p) => p.at + p.dur));
  nextFree = start + length + 0.12;
  for (const p of parts) {
    const t0 = start + p.at;
    const t1 = t0 + p.dur;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(p.gain, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1);
    gain.connect(ac.destination);
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

/** Plays one cue now (or right after the one before it). */
export function playCue(cue) {
  if (isMuted()) return;
  try {
    const file = SOUND_FILES[cue];
    if (file) new Audio(file).play().catch(() => {});
    else if (SYNTH[cue]) synth(SYNTH[cue]);
  } catch {
    // Sound is decoration: never let it break a screen.
  }
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

/** A small sound on/off switch, remembered on this device. */
export function soundToggle() {
  const button = el("button", { class: "btn subtle small mc-sound", type: "button" });
  const paint = () => {
    button.textContent = isMuted() ? "🔇 Sound off" : "🔊 Sound on";
    button.setAttribute("aria-pressed", String(!isMuted()));
  };
  button.addEventListener("click", () => {
    store.set("localStorage", MUTE_KEY, !isMuted());
    paint();
    if (!isMuted()) playCue("response_in");
  });
  paint();
  return button;
}
