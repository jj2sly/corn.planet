// My Cob Escaped sound manager. Every sound in the game goes through here: lookup, playback, volume,
// mute, the browser's autoplay rules and keeping sounds from piling up. Other games use it too
// (the handheld games, Steam My Deck's hub): it's the party's one sound system.
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
import { baseTag, soundPolicy, SOUND_BASE, SOUND_SCOPES, SOUND_TAGS } from "../sound-catalog.js";

const BASE = "/sounds/mycob/";
const MANIFEST = `${BASE}sounds.json`;
const MUTE_KEY = "cpst-party:mycob-muted";
const VOLUME_KEY = "cpst-party:mycob-volume";
const SFX_KEY = "cpst-party:sfx-volume";

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
  // Short game effects (playSfx): Escape Thad's Steam Deck, and Steam My Deck's menus.
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
  // Angry Thud's Revenge: cues the server sends (host) and effects the screens play.
  "thud_cow",
  "thud_weather",
  "thud_nest",
  "thud_donate",
  "thud_victory",
  "thud_defeat",
  "thud_stretch",
  "thud_launch",
  "thud_break",
  "thud_pig_hit",
  "thud_pig_pop",
  "thud_boom",
  "thud_ability",
  "thud_lightning",
  "thud_tornado",
  "thud_repair",
  "thud_build",
  "thud_nest_hatch",
  "thud_lob",
  "thud_splash",
  "thud_shield",
  "thud_clone",
  "thud_purge",
  "thud_kernels",
  "thud_breed",
  "thud_chain",
  // CPI: Cold Case (playSfx).
  "cc_fridge",
  "cc_portal",
  "cc_slam",
  "cc_door",
  "cc_panel",
  "cc_dial",
  "cc_relay",
  "cc_fault",
  "cc_power",
  "cc_breaker",
  "cc_valve",
  "cc_overpressure",
  "cc_cooling",
  "cc_discovery",
  "cc_pickup",
  "cc_checkpoint",
  "cc_heatpack",
  "cc_lamp",
  "cc_coil",
  "cc_surge",
  "cc_stabilized",
  "cc_lift",
  "cc_down",
  "cc_hurt",
  "cc_spoil",
  "cc_windup",
  "cc_lunge",
  "cc_crack",
  "cc_thaw",
  "cc_arc",
  "cc_vent",
  // The host screen's case-file launch (Steam My Deck menus) and Cornlashing's cob scoreboard.
  "launch_shuffle",
  "launch_stamp",
  "launch_pop",
  "cob_pop",
  "cob_sting",
  // Game-specific tags from the sound catalog (Budget Cuts, Channel Cob, …).
  ...Object.keys(SOUND_TAGS).filter((t) => SOUND_TAGS[t].base),
];

/** Never dropped to make room for something else. */
/** The same cue again within this many seconds is dropped: four agents filing at once is one bloop. */
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
  // The case-file launch: papers land, a stamp, the title pops. Cornlashing's cob: kernels, a sting.
  launch_shuffle: [hiss(0, 0.07, 0.05), hiss(0.09, 0.06, 0.04), hiss(0.18, 0.09, 0.05), hiss(0.31, 0.12, 0.035)], // shff shff shffff
  launch_stamp: [tone(0, 0.14, 150, 55, "sine", 0.32), hiss(0, 0.05, 0.12), tone(0, 0.05, 460, 210, "square", 0.04)], // THUNK
  launch_pop: [tone(0, 0.05, 950, 320, "sine", 0.2), hiss(0, 0.02, 0.1), tone(0.07, 0.05, 1150, 380, "sine", 0.16), tone(0.11, 0.05, 820, 300, "sine", 0.14), tone(0.17, 0.3, 1568, 1568, "triangle", 0.07), tone(0.21, 0.4, 2093, 2093, "triangle", 0.06)], // pop-pop-pop, ting
  cob_pop: [tone(0, 0.045, 1050, 360, "sine", 0.13), hiss(0, 0.018, 0.05)], // pok
  cob_sting: [tone(0, 0.32, 131, 98, "sine", 0.2), tone(0, 0.1, 659, 659, "square", 0.06), tone(0.1, 0.1, 784, 784, "square", 0.06), tone(0.2, 0.45, 1047, 1060, "square", 0.06), tone(0.2, 0.45, 1319, 1330, "triangle", 0.05)], // bum, ta-ta-TAAA
  deck_shake: [tone(0, 0.5, 70, 50, "sawtooth", 0.12, { rate: 18, depth: 12 }), hiss(0.42, 0.18, 0.12), tone(0.45, 0.2, 140, 60, "square", 0.14)], // rrrrumble, WHUMP
  // Angry Thud's Revenge.
  thud_cow: [tone(0, 0.9, 190, 120, "sawtooth", 0.14, { rate: 5, depth: 8 }), tone(0.95, 0.06, 300, 150, "square", 0.1), hiss(0.95, 0.04, 0.08), tone(1.15, 0.06, 300, 150, "square", 0.1), hiss(1.15, 0.04, 0.08)], // MOOOO, clonk clonk
  thud_weather: [tone(0, 0.25, 520, 780, "triangle", 0.12), tone(0.28, 0.25, 520, 780, "triangle", 0.12)], // wooo-wooo
  thud_nest: [tone(0, 0.07, 2200, 2600, "sine", 0.09), tone(0.1, 0.07, 2300, 2800, "sine", 0.09)], // cheep cheep
  thud_donate: [tone(0, 0.1, 660, 660, "triangle", 0.16), tone(0.12, 0.3, 990, 1000, "triangle", 0.16)], // ta-daa
  thud_victory: [523, 659, 784, 1047, 784, 1047].map((f, i) => tone(i * 0.13, 0.12, f, f, "square", 0.12)).concat(tone(0.8, 0.8, 1319, 1319, "triangle", 0.14)), // fanfare
  thud_defeat: [tone(0, 1, 170, 110, "sawtooth", 0.15, { rate: 5, depth: 10 })].concat(trombone([330, 311, 294, 262], 0.35, 1.1).map((p) => ({ ...p, at: p.at + 1 }))), // moo, wah wah wah wahhh
  thud_stretch: [tone(0, 0.12, 180, 320, "sawtooth", 0.04)], // eeek
  thud_launch: [hiss(0, 0.08, 0.1), tone(0, 0.35, 400, 1400, "sine", 0.12, { rate: 9, depth: 30 })], // thwip, wheee
  thud_break: [hiss(0, 0.09, 0.14), tone(0, 0.12, 180, 80, "square", 0.08)], // krack
  thud_pig_hit: [tone(0, 0.16, 420, 300, "square", 0.08, { rate: 30, depth: 40 })], // oink
  thud_pig_pop: [tone(0, 0.2, 600, 1500, "sawtooth", 0.08), hiss(0.18, 0.08, 0.12)], // squeeee-pop
  thud_boom: [tone(0, 0.5, 110, 38, "sine", 0.3), hiss(0, 0.35, 0.18)], // BOOM
  thud_ability: [hiss(0, 0.15, 0.06), tone(0, 0.18, 500, 1300, "triangle", 0.1)], // fwoosh
  thud_lightning: [hiss(0, 0.2, 0.2), tone(0.05, 0.7, 70, 40, "sawtooth", 0.1, { rate: 12, depth: 8 })], // KRAKA-rumble
  thud_tornado: [hiss(0, 1.2, 0.08), tone(0, 1.2, 180, 260, "sine", 0.05, { rate: 3, depth: 60 })], // whoooosh
  thud_repair: [0, 0.14, 0.28].map((at) => tone(at, 0.05, 900, 500, "square", 0.07)), // tink tink tink
  thud_build: [tone(0, 0.08, 160, 90, "sine", 0.2), tone(0.1, 0.18, 1175, 1175, "sine", 0.08)], // thunk, ding
  thud_nest_hatch: [tone(0, 0.05, 900, 900, "square", 0.06), tone(0.08, 0.06, 2400, 2900, "sine", 0.1), tone(0.18, 0.06, 2500, 3000, "sine", 0.1)], // crack, cheep cheep
  thud_lob: [tone(0, 0.25, 240, 520, "sine", 0.1)], // boing
  thud_splash: [hiss(0, 0.3, 0.1)], // splish
  thud_shield: [tone(0, 0.15, 900, 1800, "sine", 0.08)], // bzzing
  thud_clone: [tone(0, 0.08, 400, 800, "sine", 0.12), tone(0.1, 0.08, 400, 800, "sine", 0.12)], // bloop bloop
  thud_purge: [tone(0, 0.25, 1600, 700, "triangle", 0.06)], // shimmer down
  thud_breed: [tone(0, 0.1, 700, 1100, "sine", 0.1), tone(0.12, 0.1, 900, 1400, "sine", 0.1), tone(0.26, 0.05, 900, 900, "square", 0.06), tone(0.32, 0.08, 2400, 3000, "sine", 0.1)], // coo-coo, crack, cheep
  thud_chain: [hiss(0, 0.12, 0.14), tone(0, 0.1, 160, 70, "square", 0.1), hiss(0.14, 0.12, 0.12), tone(0.14, 0.1, 140, 60, "square", 0.1), tone(0.3, 0.5, 90, 36, "sine", 0.26), hiss(0.3, 0.4, 0.14)], // krak-krak-KABOOM
  thud_kernels: [tone(0, 0.05, 1320, 1320, "square", 0.05), tone(0.06, 0.1, 1760, 1760, "square", 0.05)], // ka-ching
  // CPI: Cold Case. Industrial and cold: hisses, clunks, relays, ice.
  cc_fridge: [hiss(0, 0.55, 0.1), tone(0, 0.12, 180, 90, "square", 0.08), tone(0.1, 0.6, 240, 200, "sine", 0.05)], // thunk, hsssss
  cc_portal: [hiss(0, 0.8, 0.09), tone(0, 0.8, 260, 1300, "sine", 0.06, { rate: 5, depth: 30 })], // whooOOSH
  cc_slam: [tone(0, 0.3, 90, 38, "sine", 0.32), hiss(0, 0.08, 0.14), tone(0.05, 0.12, 420, 200, "square", 0.05)], // SLAM
  cc_door: [hiss(0, 0.35, 0.06), tone(0, 0.35, 150, 110, "sawtooth", 0.03)], // shhhk
  cc_panel: [tone(0, 0.06, 880, 880, "square", 0.05), tone(0.07, 0.06, 1320, 1320, "square", 0.05)], // bip-bip
  cc_dial: [tone(0, 0.04, 1500, 1000, "square", 0.05), tone(0.06, 0.22, 660, 660, "triangle", 0.12)], // tick, dong
  cc_relay: [tone(0, 0.06, 220, 110, "square", 0.08), tone(0.07, 0.25, 1047, 1047, "triangle", 0.12)], // clunk-ding
  cc_fault: [tone(0, 0.3, 120, 90, "sawtooth", 0.12, { rate: 40, depth: 30 }), hiss(0, 0.15, 0.1)], // bzzzt
  cc_power: [tone(0, 0.9, 60, 240, "sawtooth", 0.1), tone(0.6, 0.4, 523, 523, "triangle", 0.12), tone(0.75, 0.55, 784, 784, "triangle", 0.12)], // vvvVVMMM, ding-dong
  cc_breaker: [tone(0, 0.08, 160, 80, "square", 0.12), hiss(0, 0.05, 0.1)], // KLUNK
  cc_valve: [tone(0, 0.35, 180, 120, "sawtooth", 0.06, { rate: 20, depth: 10 }), hiss(0.3, 0.5, 0.08)], // creeak, hsss
  cc_overpressure: [hiss(0, 0.6, 0.16), tone(0, 0.2, 900, 400, "square", 0.05)], // PSSSHHH
  cc_cooling: [tone(0, 1.4, 50, 110, "sawtooth", 0.1, { rate: 8, depth: 4 }), tone(1, 0.5, 784, 784, "triangle", 0.1), tone(1.15, 0.6, 1047, 1047, "triangle", 0.1)], // compressor spins up
  cc_discovery: [tone(0, 0.12, 1319, 1319, "sine", 0.16), tone(0.12, 0.5, 1760, 1760, "sine", 0.16)], // ding-ding
  cc_pickup: [tone(0, 0.08, 988, 988, "square", 0.06), tone(0.09, 0.14, 1319, 1319, "square", 0.06)], // bleep-bloop
  cc_checkpoint: [tone(0, 0.18, 659, 659, "triangle", 0.12), tone(0.15, 0.18, 880, 880, "triangle", 0.12), tone(0.3, 0.5, 1319, 1319, "triangle", 0.1)], // chime
  cc_heatpack: [hiss(0, 0.4, 0.07), tone(0, 0.5, 200, 500, "sine", 0.1)], // fwoomp
  cc_lamp: [tone(0, 0.03, 2000, 1500, "square", 0.05), tone(0.03, 0.5, 120, 120, "sawtooth", 0.04)], // click, hmmm
  cc_coil: [tone(0, 0.35, 300, 1600, "sawtooth", 0.06), hiss(0, 0.1, 0.06)], // zwiiip
  cc_surge: [tone(0, 0.7, 70, 40, "sine", 0.3), hiss(0, 0.4, 0.08)], // WHOOM
  cc_stabilized: [tone(0, 1.4, 392, 392, "triangle", 0.1), tone(0.1, 1.3, 494, 494, "triangle", 0.1), tone(0.2, 1.2, 587, 587, "triangle", 0.1), tone(0.3, 1.2, 784, 784, "triangle", 0.1)], // a settled chord
  cc_lift: [tone(0, 1.2, 90, 140, "sawtooth", 0.06), tone(1.1, 0.4, 988, 988, "sine", 0.1)], // mmmmm, ding
  cc_down: [tone(0, 0.8, 200, 50, "sawtooth", 0.14), hiss(0, 0.2, 0.08)], // wuuuuh
  cc_hurt: [tone(0, 0.12, 300, 120, "square", 0.1), hiss(0, 0.04, 0.08)], // bonk
  cc_spoil: [tone(0, 0.3, 300, 80, "sawtooth", 0.08, { rate: 30, depth: 40 })], // blorrp
  cc_windup: [tone(0, 0.5, 300, 900, "sawtooth", 0.04)], // eeeEEE
  cc_lunge: [hiss(0, 0.25, 0.1), tone(0, 0.25, 500, 150, "sine", 0.08)], // fwip
  cc_crack: [hiss(0, 0.08, 0.16), tone(0, 0.06, 2400, 900, "square", 0.05)], // krk
  cc_thaw: [hiss(0, 0.15, 0.12), tone(0.2, 0.08, 1400, 1800, "sine", 0.1), tone(0.45, 0.08, 1200, 1600, "sine", 0.08)], // crack, plip, plip
  cc_arc: [hiss(0, 0.2, 0.08), tone(0, 0.2, 90, 60, "sawtooth", 0.08, { rate: 50, depth: 30 })], // BZZT
  cc_vent: [hiss(0, 0.5, 0.12), tone(0, 0.4, 600, 200, "sine", 0.04)], // FSSSHH
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
/** Game effects (playSfx: jumps, clicks, crashes) relative to the master volume. Cues aren't affected. */
export const getSfxVolume = () => {
  const v = store.get("localStorage", SFX_KEY);
  return typeof v === "number" && v >= 0 && v <= 1 ? v : 1;
};
export function setSfxVolume(volume) {
  store.set("localStorage", SFX_KEY, Math.min(1, Math.max(0, volume)));
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
let playing = []; // { end, priority } entries for sounds scheduled so far
const lastStart = new Map(); // cue -> start time

/** When this cue may start, or null to drop it. Higher-priority events cut through noisy moments. */
function slot(ac, cue, length) {
  const now = ac.currentTime;
  const policy = soundPolicy(cue);
  const start = Math.max(now + 0.02, nextFree);
  if (start - (lastStart.get(cue) ?? -Infinity) < policy.cooldown) return null;
  playing = playing.filter((entry) => entry.end > start);
  const backlog = start - now;
  const crowded = playing.length >= MAX_VOICES;
  if (policy.priority < 3 && (backlog > MAX_BACKLOG || crowded)) return null;
  if (policy.priority >= 3 && backlog > 0.35) nextFree = now + 0.02;
  playing.push({ end: start + length, priority: policy.priority });
  lastStart.set(cue, start);
  nextFree = start + Math.min(length, MAX_SLOT) + (policy.priority >= 3 ? 0.04 : 0.1);
  return start;
}

function playBuffer(ac, buffer, volume, start, cue = "action") {
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const gain = ac.createGain();
  gain.gain.value = volume * soundPolicy(cue).gain;
  source.connect(gain).connect(master);
  source.start(start);
}

function synth(ac, parts, start, volume = 1, cue = "action") {
  for (const p of parts) {
    const t0 = start + p.at;
    const t1 = t0 + p.dur;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, p.gain * volume * soundPolicy(cue).gain), t0 + 0.01);
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
  const choice = await chooseSound(cue);
  if (choice === null) return;
  if (choice) {
    // A moderator's choice for this game. If it can't load, it's silence, not something else.
    if (choice.url) {
      const buffer = await decode(ac, choice.url);
      if (!buffer) return;
      const start = slot(ac, cue, buffer.duration);
      if (start !== null) playBuffer(ac, buffer, choice.volume, start, cue);
      return;
    }
    const parts = SYNTH[choice.synth];
    if (!parts) return;
    const start = slot(ac, cue, Math.max(...parts.map((p) => p.at + p.dur)));
    if (start !== null) synth(ac, parts, start, choice.volume, cue);
    return;
  }
  const map = await loadManifest();
  const entry = map.get(cue) ?? map.get(baseTag(cue));
  if (entry) {
    const url = entry.files[Math.floor(Math.random() * entry.files.length)];
    const buffer = await decode(ac, url);
    if (buffer) {
      const start = slot(ac, cue, buffer.duration);
      if (start !== null) playBuffer(ac, buffer, entry.volume, start, cue);
      return;
    }
  }
  const parts = SYNTH[cue] ?? SYNTH[baseTag(cue)];
  if (!parts) return;
  const start = slot(ac, cue, Math.max(...parts.map((p) => p.at + p.dur)));
  if (start !== null) synth(ac, parts, start, 1, cue);
}

// ------------------------------------------------------------------ per-game sound lists

// Moderators choose, per game, which sounds play for which trigger tag (Moderation → Sound
// effects; see sound-catalog.js). The screens say which game is on with setSoundScope().
let scopeId = null;
let scopeRows = null; // Promise<Map<tag, enabled rows>> | null
// Lists for scopes other than the current one, for a sound that names its own (the host's launch
// plays the GLOBAL menus' list while the game's list is already on). A scope left behind keeps its
// list here; making it current again fetches it fresh.
const otherRows = new Map(); // scope id -> Promise<Map<tag, enabled rows> | null>

function fetchRows(id) {
  return fetch(`/api/sounds/${encodeURIComponent(id)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => {
      if (!json || !Array.isArray(json.rows)) return null;
      const map = new Map(SOUND_SCOPES[id].tags.map((t) => [t, []]));
      for (const row of json.rows) if (row.enabled) map.get(row.tag)?.push(row);
      for (const rows of map.values()) for (const r of rows) if (r.source.startsWith("file:")) fetchBytes(SOUND_BASE + r.source.slice(5));
      return map;
    })
    .catch(() => null);
}

/** Which game's sound list to use ("lobby" for the Steam My Deck menus, null for none). */
export function setSoundScope(id) {
  if (id === scopeId) return;
  if (scopeId && scopeRows) otherRows.set(scopeId, scopeRows);
  scopeId = id;
  scopeRows = null;
  lastChoice.clear();
  lastStart.clear();
  nextFree = 0;
  if (!id || !SOUND_SCOPES[id]) return;
  otherRows.delete(id);
  scopeRows = fetchRows(id);
}

/** The list for a named scope: the current one, one seen earlier, or fetched now. */
function rowsFor(id) {
  if (id === scopeId) return scopeRows;
  if (!id || !SOUND_SCOPES[id]) return null;
  if (!otherRows.has(id)) otherRows.set(id, fetchRows(id));
  return otherRows.get(id);
}

/**
 * What to play for a tag under the current game's list (or `scope`'s): { url | synth, volume }, null
 * for silence (the tag's sounds are all disabled), or undefined when the list doesn't cover it (the
 * defaults).
 */
const lastChoice = new Map();

/** Picks a mapped sound without immediately repeating the same clip when alternatives exist. */
export async function chooseSound(cue, scope) {
  const source = scope === undefined ? scopeRows : rowsFor(scope);
  const map = source ? await source.catch(() => null) : null;
  if (!map || !map.has(cue)) return undefined;
  const rows = map.get(cue);
  if (!rows.length) return null;
  const previous = lastChoice.get(cue);
  const candidates = rows.length > 1 ? rows.filter((row) => row.id !== previous) : rows;
  const pool = candidates.length ? candidates : rows;
  const row = pool[Math.floor(Math.random() * pool.length)];
  lastChoice.set(cue, row.id);
  return row.source.startsWith("file:")
    ? { url: SOUND_BASE + row.source.slice(5), volume: row.volume }
    : { synth: row.source.slice(6), volume: row.volume };
}

/** Is there a built-in tone for this tag? */
export const hasTone = (tag) => Boolean(SYNTH[tag] ?? SYNTH[baseTag(tag)]);

/**
 * Plays one sound right now for Moderation's Preview button: "file:<path>" or "synth:<tag>".
 * Ignores mute and the queue, touches no game. Resolves false if it couldn't play.
 */
export async function previewSound(source, volume = 1) {
  const ac = context();
  if (!ac) return false;
  if (ac.state !== "running") await ac.resume().catch(() => {});
  const out = ac.createGain();
  out.gain.value = Math.min(2, Math.max(0, volume));
  out.connect(ac.destination);
  if (source.startsWith("file:")) {
    const buffer = await decode(ac, SOUND_BASE + source.slice(5));
    if (!buffer) return false;
    const node = ac.createBufferSource();
    node.buffer = buffer;
    node.connect(out);
    node.start();
    return true;
  }
  const parts = SYNTH[source.slice(6)] ?? SYNTH[baseTag(source.slice(6))];
  if (!parts) return false;
  const saved = master;
  master = out; // synth() connects to master; borrow it for this one preview
  try {
    synth(ac, parts, ac.currentTime + 0.02);
  } finally {
    master = saved;
  }
  return true;
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
 * volume and sounds.json mapping as every cue. `scope` plays it from that game's moderated list
 * instead of the current one's (the launch is the menus' sound). Never throws.
 */
export function playSfx(cue, { volume = 1, scope } = {}) {
  volume *= getSfxVolume();
  (async () => {
    if (isMuted() || volume <= 0) return;
    const ac = context();
    if (!ac) return;
    if (ac.state !== "running") return unlock();
    const now = ac.currentTime;
    if (now - (sfxLast.get(cue) ?? -Infinity) < SFX_GAP) return;
    sfxPlaying = sfxPlaying.filter((end) => end > now);
    if (sfxPlaying.length >= MAX_SFX) return;
    sfxLast.set(cue, now);
    const choice = await chooseSound(cue, scope);
    if (choice === null) return;
    if (choice) {
      const buffer = choice.url ? await decode(ac, choice.url) : null;
      const parts = choice.synth ? SYNTH[choice.synth] : null;
      if (buffer) {
        sfxPlaying.push(now + buffer.duration);
        return playBuffer(ac, buffer, choice.volume * volume, ac.currentTime + 0.01, cue);
      }
      if (parts) {
        sfxPlaying.push(now + Math.max(...parts.map((p) => p.at + p.dur)));
        synth(ac, parts, ac.currentTime + 0.01, choice.volume * volume, cue);
      }
      return;
    }
    const entry = (await loadManifest()).get(cue);
    if (entry) {
      const buffer = await decode(ac, entry.files[Math.floor(Math.random() * entry.files.length)]);
      if (buffer) {
        sfxPlaying.push(now + buffer.duration);
        return playBuffer(ac, buffer, entry.volume * volume, ac.currentTime + 0.01, cue);
      }
    }
    const parts = SYNTH[cue];
    if (!parts) return;
    sfxPlaying.push(now + Math.max(...parts.map((p) => p.at + p.dur)));
    synth(ac, parts, ac.currentTime + 0.01, volume, cue);
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

// ------------------------------------------------------------------ ambience

const beds = new Map();

/**
 * Looping background beds for a game that needs room tone. `level` (0..1) fades the bed in or out;
 * kinds: "hum" (a low mains drone, `freq` sets its pitch), "wind" (moving filtered noise), "alarm"
 * (a pulsing two-tone) and "drone" (a deep, uneasy tone). Same mute and volumes as everything
 * else; before the page has been tapped or typed on it simply stays silent. Never throws.
 */
export function setAmbience(id, level, { kind = id, freq } = {}) {
  try {
    const ac = context();
    if (!ac || ac.state !== "running") return;
    let bed = beds.get(id);
    if (!bed) {
      if (level <= 0.001) return;
      bed = makeBed(ac, kind, freq);
      beds.set(id, bed);
    }
    const target = Math.max(0, Math.min(1, level)) * bed.base * getSfxVolume();
    bed.gain.gain.setTargetAtTime(target, ac.currentTime, 0.35);
    if (freq && bed.setFreq) bed.setFreq(freq);
  } catch {
    /* no audio */
  }
}

/** Fades every ambience bed out (pause, leaving the page). */
export function stopAmbience() {
  if (!ctx) return;
  for (const bed of beds.values()) bed.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
}

function noiseBuffer(ac, seconds = 2) {
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * seconds), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function makeBed(ac, kind, freq) {
  const gain = ac.createGain();
  gain.gain.value = 0;
  gain.connect(master);
  const osc = (type, f) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start();
    return o;
  };
  if (kind === "wind") {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac);
    src.loop = true;
    const band = ac.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 520;
    band.Q.value = 0.7;
    const lfo = osc("sine", 0.13);
    const depth = ac.createGain();
    depth.gain.value = 260;
    lfo.connect(depth).connect(band.frequency);
    src.connect(band).connect(gain);
    src.start();
    return { gain, base: 0.14 };
  }
  if (kind === "alarm") {
    const o = osc("square", 770);
    const lfo = osc("square", 1.3);
    const depth = ac.createGain();
    depth.gain.value = 110;
    lfo.connect(depth).connect(o.frequency);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    o.connect(lp).connect(gain);
    return { gain, base: 0.025 };
  }
  if (kind === "drone") {
    const a = osc("sine", 41);
    const b = osc("sine", 61.7);
    const trem = ac.createGain();
    trem.gain.value = 0.7;
    const lfo = osc("sine", 0.31);
    const depth = ac.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth).connect(trem.gain);
    a.connect(trem);
    b.connect(trem);
    trem.connect(gain);
    return { gain, base: 0.16 };
  }
  // "hum"
  const f0 = freq ?? 55;
  const a = osc("sawtooth", f0);
  const b = osc("sine", f0 * 2.01);
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 230;
  a.connect(lp);
  b.connect(lp);
  lp.connect(gain);
  return {
    gain,
    base: 0.07,
    setFreq(f) {
      a.frequency.setTargetAtTime(f, ac.currentTime, 0.6);
      b.frequency.setTargetAtTime(f * 2.01, ac.currentTime, 0.6);
    },
  };
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
