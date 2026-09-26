// Angry Thud's Revenge: the birds. Shared by the server (which launches them and runs their
// abilities) and the screens (which draw them and explain them), like steamdeck-cast.js.
//
// Two separate things live here:
//   BIRDS: the gameplay birds a player picks before the game. The bird decides how it flies and
//          what its ability does. Numbers are data: tune them here, not in the game code.
//   SKINS: what a bird looks like. Purely cosmetic and independent of the gameplay bird: any skin
//          on any bird. A skin has an `identity` so the same person looks like themselves in every
//          CPI game (a Steam My Deck cast member becomes a bird here with the same hair, glasses and
//          colours; see cpi/bird.js birdFromPerson).
//
// Custom skins from photos (docs/THUD.md, "Custom skins"): a photo is only a reference. Someone (or
// Claude) turns it into an original CPI bird look (the `look` fields below) and adds it to
// CUSTOM_SKINS with a stable `identity`. An optional `art` path can point at hand-made sprite art
// under /skins/<identity>/ later; screens fall back to the procedural look when there is none.

import { CAST } from "./steamdeck-cast.js";

/**
 * ability.trigger: "tap" (press once in flight), "hold" (steer while held, uses fuel), "launch"
 * (always on from the launch). ability.uses: how many taps (charges); fuel is seconds.
 */
export const BIRDS = Object.freeze([
  {
    id: "popcorn",
    name: "Poppy",
    title: "The Popcorn Hen",
    role: "Explosive",
    blurb: "Tap in flight and she POPS: a blast that shoves and cracks everything nearby.",
    usage: "Tap once",
    body: { r: 17, density: 2.4, restitution: 0.2 },
    ability: { kind: "pop", trigger: "tap", uses: 1, radius: 150, push: 820, damage: 70 },
    icon: "💥",
  },
  {
    id: "zoomer",
    name: "Blitz",
    title: "Afterburner Finch",
    role: "Acceleration",
    blurb: "Two afterburner charges. Each tap: faster, straighter, and it hits harder while it burns.",
    usage: "Tap, 2 charges",
    body: { r: 15, density: 2.2, restitution: 0.2 },
    ability: { kind: "boost", trigger: "tap", uses: 2, factor: 1.65, maxSpeed: 1650, burnS: 0.45, damage: 1.7 },
    icon: "⚡",
  },
  {
    id: "auger",
    name: "Auger",
    title: "Drill Sergeant Woodpecker",
    role: "Piercing",
    blurb: "Always drilling: bores straight through blocks until the drill budget runs out.",
    usage: "Always on",
    body: { r: 15, density: 2.8, restitution: 0.1 },
    ability: { kind: "pierce", trigger: "launch", budget: 150, slow: 0.84 },
    icon: "🔩",
  },
  {
    id: "trio",
    name: "Trey",
    title: "The Tripartite Quail",
    role: "Splitting",
    blurb: "Tap to split into three. All three are Trey. Trey does not want to talk about it.",
    usage: "Tap once",
    body: { r: 16, density: 2.4, restitution: 0.2 },
    ability: { kind: "split", trigger: "tap", uses: 1, count: 3, spread: 0.22, scale: 0.72 },
    icon: "🔱",
  },
  {
    id: "boing",
    name: "Boing",
    title: "The Rubber Grouse",
    role: "Ricochet",
    blurb: "Bounces off everything, harder each time. Tap once to ricochet toward the nearest piggy.",
    usage: "Always bouncy · tap once",
    body: { r: 16, density: 2.2, restitution: 0.78 },
    ability: { kind: "ricochet", trigger: "tap", uses: 1, bounceBonus: 0.35, maxBounces: 5 },
    icon: "🏀",
  },
  {
    id: "anvil",
    name: "Chonk",
    title: "The Anvil Pigeon",
    role: "Heavy impact",
    blurb: "Heavy already. Tap and Chonk stops pretending: straight down, triple weight.",
    usage: "Tap once",
    body: { r: 20, density: 4.2, restitution: 0.05 },
    ability: { kind: "slam", trigger: "tap", uses: 1, speed: 1250, massFactor: 3, damage: 1.8 },
    icon: "🪨",
  },
  {
    id: "gull",
    name: "Memo",
    title: "The Memo Gull",
    role: "Midair control",
    blurb: "Hold ◀ ▶ in flight to glide and steer. Fuel for about a second and a half.",
    usage: "Hold, 1.6 s fuel",
    body: { r: 16, density: 2.0, restitution: 0.2 },
    ability: { kind: "glide", trigger: "hold", fuel: 1.6, steer: 950, lift: 0.55 },
    icon: "🪁",
  },
  {
    id: "magpie",
    name: "Magnus",
    title: "The Magnet Magpie",
    role: "Structure manipulation",
    blurb: "Tap to hover and yank nearby blocks toward her. Towers lean. Towers fall.",
    usage: "Tap once",
    body: { r: 16, density: 2.4, restitution: 0.2 },
    ability: { kind: "magnet", trigger: "tap", uses: 1, radius: 250, pull: 2400, seconds: 1.1 },
    icon: "🧲",
  },
  {
    id: "crow",
    name: "Bunker",
    title: "The Husk Bunker Crow",
    role: "Defensive",
    blurb: "Tap to turn into a husk-steel bunker block. Short on your side: a free wall. Long: a very rude brick.",
    usage: "Tap once",
    body: { r: 16, density: 2.6, restitution: 0.15 },
    ability: { kind: "bunker", trigger: "tap", uses: 1, size: 56, hp: 170 },
    icon: "🛡️",
  },
]);

export const BIRD_IDS = Object.freeze(BIRDS.map((b) => b.id));

export function birdType(id) {
  return BIRDS.find((b) => b.id === id) ?? null;
}

// ------------------------------------------------------------------ skins (cosmetic only)

/** Each bird's own look: how the preset bird appears when nobody picks another skin. */
const CLASSIC_LOOKS = {
  popcorn: { body: "#f7e7a6", belly: "#fffaf0", wing: "#e8c65a", beak: "#ff9f1c", crest: "popcorn", crestColor: "#fffdf2", brow: "angry", eyes: "round", accessory: "none", pattern: "spots", patternColor: "#f2cf5b", tail: "fan" },
  zoomer: { body: "#ff5a3c", belly: "#ffd3c4", wing: "#c7331d", beak: "#ffc233", crest: "spikes", crestColor: "#ffb000", brow: "angry", eyes: "goggles", accessory: "scarf", accessoryColor: "#ffd400", pattern: "stripes", patternColor: "#ffd166", tail: "spike" },
  auger: { body: "#4f7cff", belly: "#dfe8ff", wing: "#2c4fc4", beak: "#9aa3ad", crest: "mohawk", crestColor: "#ff3d3d", brow: "angry", eyes: "round", accessory: "headband", accessoryColor: "#ffffff", pattern: "plain", tail: "spike" },
  trio: { body: "#7ed957", belly: "#e9ffd9", wing: "#4ea62e", beak: "#ffb347", crest: "tuft", crestColor: "#3e8a24", brow: "worried", eyes: "round", accessory: "none", pattern: "plain", tail: "fan" },
  boing: { body: "#ff66c4", belly: "#ffe0f3", wing: "#d63fa0", beak: "#ffcf40", crest: "curl", crestColor: "#ff9ad8", brow: "flat", eyes: "round", accessory: "headband", accessoryColor: "#38e0ff", pattern: "spots", patternColor: "#ffb3e1", tail: "fan" },
  anvil: { body: "#6f7582", belly: "#c9ccd3", wing: "#4a4f59", beak: "#e0a458", crest: "helmet", crestColor: "#3a3f48", brow: "angry", eyes: "round", accessory: "medal", accessoryColor: "#ffd400", pattern: "plain", tail: "none" },
  gull: { body: "#f4f6fb", belly: "#ffffff", wing: "#a7b4c8", beak: "#ffc233", crest: "feather", crestColor: "#8fb3ff", brow: "flat", eyes: "glasses", accessory: "tie", accessoryColor: "#2b59c3", pattern: "plain", tail: "fan" },
  magpie: { body: "#1f2230", belly: "#f3f3f3", wing: "#3b4b9b", beak: "#343842", crest: "tuft", crestColor: "#3b4b9b", brow: "angry", eyes: "shades", accessory: "none", pattern: "stripes", patternColor: "#5d6fd6", tail: "spike" },
  crow: { body: "#2e3440", belly: "#5b6272", wing: "#1b1f27", beak: "#d9a441", crest: "helmet", crestColor: "#7a8452", brow: "angry", eyes: "visor", accessory: "bandana", accessoryColor: "#7a8452", pattern: "plain", tail: "spike" },
};

/**
 * Skins made from photos, added by hand (see the header). Shape:
 *   { id, name, identity, look: { body, belly, wing, beak, crest, crestColor, brow, eyes, accessory, … }, art? }
 */
export const CUSTOM_SKINS = Object.freeze([]);

/** A person look (cpi/person.js) → the colours and features a bird keeps from it. */
export function birdLookFromPerson(look = {}) {
  const hair = look.hair ?? {};
  const top = look.top ?? {};
  const glasses = look.glasses;
  const style = hair.style ?? "short";
  const crest = style === "bald" ? "none" : ["curly", "bigcurly", "afro"].includes(style) ? "curl" : ["tied", "long", "bun"].includes(style) ? "feather" : style === "buzz" ? "tuft" : style === "short" ? "tuft" : "mohawk";
  const hat = look.hat === "cap" ? "cap" : look.hat === "bicorne" ? "bicorne" : null;
  return {
    body: top.color ?? "#8aa0b8",
    belly: look.skin ?? "#f2d3b3",
    wing: top.under ?? top.trim ?? top.front ?? top.color ?? "#6a7f96",
    beak: "#ffb347",
    crest,
    crestColor: hair.color ?? "#4b3423",
    brow: look.smile ? "flat" : "angry",
    eyes: glasses ? "glasses" : "round",
    accessory: hat ?? (look.beard ? "beard" : look.extras?.includes("lanyard") ? "medal" : "none"),
    accessoryColor: look.beard ?? top.buttons ?? "#ffd400",
    pattern: top.print || top.logo || top.letter ? "spots" : "plain",
    patternColor: top.trim ?? top.under ?? "#ffffff",
    tail: "fan",
  };
}

const castSkins = CAST.map((member) => ({ id: `cast:${member.id}`, name: member.name, identity: member.id, source: "cast", look: birdLookFromPerson(member.look) }));

/** Every skin a player can pick: the bird's own ("classic"), the cast's, and any custom ones. */
export const SKINS = Object.freeze([
  { id: "classic", name: "Classic", identity: null, source: "classic", look: null },
  ...castSkins,
  ...CUSTOM_SKINS.map((s) => ({ ...s, source: "custom" })),
]);

export function skinById(id) {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/** What a bird of this type in this skin looks like. */
export function lookFor(birdId, skinId = "classic") {
  const skin = skinById(skinId);
  return skin.look ?? CLASSIC_LOOKS[birdId] ?? CLASSIC_LOOKS.popcorn;
}
