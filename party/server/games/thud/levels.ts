// Angry Thud's Revenge: the levels. Each is a different piggy stronghold with its own materials,
// piggies, weather and Red Cow pace, getting harder in order. World units, y down; the ground's top
// is WORLD.groundY. Blocks and piggies are centre points; terrain is [x, y, w, h] from the top-left.
// Everything here is only *where things are*: how it looks is the renderer's (thud-world.js).
//
// Every level must stand up on its own (it's settled once at load; test/thud.test.ts checks nothing
// falls or dies before the first bird).

import { PIGS, SLINGSHOT, WORLD, type MaterialId, type PigKind, type WeatherType } from "./config.ts";

export type Rect = [number, number, number, number];

export interface BlockSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  m: MaterialId;
}

export interface PigSpec {
  kind: PigKind;
  x: number;
  y: number;
}

export interface Level {
  id: string;
  name: string;
  /** Scenery set for the renderer. */
  theme: "site" | "facility" | "refinery" | "station" | "thudplex";
  tagline: string;
  /** What the Deck says while it loads. */
  intro: string[];
  difficulty: number;
  terrain: Rect[];
  /** Where the team may build: x ranges on the ground. */
  zones: [number, number][];
  blocks: BlockSpec[];
  pigs: PigSpec[];
  /** The Red Cow: where it stands (drawn only; it isn't in the physics) and how far it gets per step. */
  cow: { x: number; step: number; everyTurns: number };
  weather: { chance: number; firstTurn: number; pool: Partial<Record<WeatherType, number>> };
  /** Reinforcements parachute in when the fortress runs low. */
  reinforce: { everyTurns: number; minAlive: number; maxAlive: number; kinds: PigKind[]; drops: number[] };
  /** Cob bombs lobbed at your buildings after each turn: base, +1 every `growEvery` turns, up to max. */
  attack: { base: number; growEvery: number; max: number };
}

const G = WORLD.groundY;
const pedestal: Rect = [SLINGSHOT.pedestal.x - SLINGSHOT.pedestal.w / 2, SLINGSHOT.pedestal.top, SLINGSHOT.pedestal.w, G - SLINGSHOT.pedestal.top + 200];
const ground: Rect = [-300, G, WORLD.width + 600, 200];
const ZONES: [number, number][] = [
  [40, SLINGSHOT.pedestal.x - SLINGSHOT.pedestal.w / 2 - 20],
  [SLINGSHOT.pedestal.x + SLINGSHOT.pedestal.w / 2 + 20, 800],
];

/** A little builder: every piece sits exactly on what's under it. */
function fort() {
  const blocks: BlockSpec[] = [];
  const pigs: PigSpec[] = [];
  /** A block standing on `bottom`; returns its top. */
  const block = (x: number, bottom: number, w: number, h: number, m: MaterialId) => {
    blocks.push({ x, y: bottom - h / 2, w, h, m });
    return bottom - h;
  };
  /** Two posts and a slab across them; returns the slab's top. */
  const frame = (x: number, bottom: number, span: number, h: number, m: MaterialId, slab: MaterialId = m, post = 20, thick = 20) => {
    block(x - span / 2 + post / 2, bottom, post, h, m);
    block(x + span / 2 - post / 2, bottom, post, h, m);
    return block(x, bottom - h, span + 12, thick, slab);
  };
  const pig = (kind: PigKind, x: number, bottom: number) => {
    pigs.push({ kind, x, y: bottom - PIGS[kind].r - 0.5 });
  };
  return { blocks, pigs, block, frame, pig };
}

function constructionSite(): Level {
  const f = fort();
  // A two-storey site office.
  let top = f.frame(1260, G, 120, 100, "wood");
  f.pig("basic", 1260, G);
  top = f.frame(1260, top, 120, 90, "wood", "glass");
  f.pig("basic", 1260, top + 90 + 20);
  f.block(1238, top, 30, 30, "glass");
  f.block(1282, top, 30, 30, "glass");
  // Scaffolding, three storeys, with the builder on the middle deck and a kernel vault on top.
  top = f.frame(1520, G, 180, 110, "wood");
  f.pig("basic", 1490, G);
  const deck = f.frame(1520, top, 180, 100, "wood", "glass");
  f.pig("builder", 1520, top);
  const roof = f.frame(1520, deck, 130, 80, "wood");
  f.block(1520, roof, 44, 44, "vault");
  // A corn oil barrel by a piggy who should know better.
  f.block(1680, G, 34, 46, "barrel");
  f.pig("basic", 1730, G);
  // Stone hut, timber upper floor.
  top = f.frame(1910, G, 130, 90, "stone");
  f.pig("basic", 1910, G);
  top = f.frame(1910, top, 130, 100, "wood");
  f.block(1890, top, 30, 30, "glass");
  f.block(1930, top, 30, 30, "glass");
  // A tall, questionable crane mast with a piggy on it.
  top = f.frame(2090, G, 100, 170, "wood");
  f.pig("basic", 2090, top);
  return {
    id: "site",
    name: "CPI Construction Site",
    theme: "site",
    tagline: "Hard hats required. The piggies are not wearing them.",
    intro: ["Loading scaffolding (structurally optional)…", "Issuing hard hats to birds…", "The Red Cow permit was approved. By piggies."],
    difficulty: 1,
    terrain: [ground, pedestal],
    zones: ZONES,
    blocks: f.blocks,
    pigs: f.pigs,
    cow: { x: 2255, step: 0.2, everyTurns: 2 },
    weather: { chance: 0.45, firstTurn: 2, pool: { wind: 3, strong_wind: 1, heavy_rain: 2 } },
    reinforce: { everyTurns: 2, minAlive: 3, maxAlive: 7, kinds: ["basic", "basic", "builder"], drops: [1400, 1600, 1800, 2000] },
    attack: { base: 1, growEvery: 3, max: 3 },
  };
}

function containmentFacility(): Level {
  const f = fort();
  // Checkpoint: stone, armored guard.
  let top = f.frame(1250, G, 140, 100, "stone", "glass");
  f.pig("armored", 1250, G);
  // Cell block: metal cage, a shield piggy keeping two others safe, glass on the roof.
  top = f.frame(1510, G, 220, 120, "metal");
  f.pig("shield", 1510, G);
  f.pig("basic", 1455, G);
  f.block(1470, top, 30, 60, "glass");
  f.block(1550, top, 30, 60, "glass");
  f.block(1510, top - 60, 120, 16, "glass");
  f.pig("basic", 1510, top - 76);
  // Observation tower, three storeys narrowing, a totem in the middle.
  top = f.frame(1790, G, 150, 100, "stone");
  f.pig("basic", 1790, G);
  top = f.frame(1790, top, 120, 100, "stone", "metal");
  f.block(1790, top + 100 + 20, 36, 60, "totem");
  top = f.frame(1790, top, 100, 80, "wood");
  f.pig("armored", 1790, top);
  // Evidence vault.
  top = f.frame(2020, G, 130, 90, "metal");
  f.block(2020, G, 44, 44, "vault");
  f.block(2020, top, 50, 50, "glass");
  return {
    id: "facility",
    name: "Containment Facility",
    theme: "facility",
    tagline: "They contained the piggies. Then the piggies contained the facility.",
    intro: ["Bypassing Level 3 clearance…", "Fog machines: ON (why are there fog machines)", "Shield piggies detected. Aim around the bubble."],
    difficulty: 2,
    terrain: [ground, pedestal],
    zones: ZONES,
    blocks: f.blocks,
    pigs: f.pigs,
    cow: { x: 2255, step: 0.2, everyTurns: 2 },
    weather: { chance: 0.55, firstTurn: 2, pool: { fog: 3, lightning_storm: 2, acid_rain: 2, wind: 1 } },
    reinforce: { everyTurns: 2, minAlive: 3, maxAlive: 7, kinds: ["basic", "armored", "basic"], drops: [1350, 1650, 1900] },
    attack: { base: 1, growEvery: 2, max: 3 },
  };
}

function cornRefinery(): Level {
  const f = fort();
  // Corn bale silo.
  let top = f.block(1240, G, 70, 44, "corn");
  top = f.block(1240, top, 70, 44, "corn");
  top = f.block(1240, top, 60, 44, "corn");
  f.pig("basic", 1240, top);
  // The refinery: barrels downstairs, the corruptor upstairs behind metal.
  top = f.frame(1500, G, 220, 110, "metal", "stone");
  f.block(1440, G, 34, 46, "barrel");
  f.block(1560, G, 34, 46, "barrel");
  f.pig("basic", 1500, G);
  const up = f.frame(1500, top, 160, 90, "metal");
  f.pig("corruptor", 1500, top);
  f.block(1500, up, 34, 46, "barrel");
  // Pipe rack: wood legs, a metal pipe, barrels riding it.
  top = f.frame(1790, G, 200, 120, "wood", "metal");
  f.pig("armored", 1790, G);
  f.block(1745, top, 34, 46, "barrel");
  f.block(1835, top, 34, 46, "barrel");
  // Storage tank.
  top = f.frame(2040, G, 150, 100, "stone");
  f.pig("builder", 2040, G);
  top = f.frame(2040, top, 150, 80, "corn", "wood");
  f.block(2040, top, 44, 44, "vault");
  return {
    id: "refinery",
    name: "Corn Refinery",
    theme: "refinery",
    tagline: "Everything here is flammable, including the piggies' attitude.",
    intro: ["Pressurizing corn oil…", "Warning: barrels are explosive. That's the point.", "A Corruptor Piggy is refining corruption. Stop it."],
    difficulty: 3,
    terrain: [ground, pedestal],
    zones: ZONES,
    blocks: f.blocks,
    pigs: f.pigs,
    cow: { x: 2255, step: 0.2, everyTurns: 2 },
    weather: { chance: 0.55, firstTurn: 2, pool: { heat_wave: 2, dust_storm: 2, tornado: 1, wind: 2 } },
    reinforce: { everyTurns: 2, minAlive: 3, maxAlive: 8, kinds: ["basic", "corruptor", "basic", "builder"], drops: [1300, 1650, 1900, 2050] },
    attack: { base: 1, growEvery: 2, max: 4 },
  };
}

function weatherStation(): Level {
  const f = fort();
  const plateau = 760;
  // An ice hut by the path up.
  let top = f.frame(1240, G, 120, 90, "ice");
  f.pig("basic", 1240, G);
  // The anemometer tower.
  top = f.frame(1420, G, 100, 100, "stone");
  top = f.frame(1420, top, 100, 100, "stone", "wood");
  top = f.frame(1420, top, 90, 80, "wood");
  f.pig("armored", 1420, top);
  // The station on the plateau: shield piggy and corruptor inside, a totem on the roof.
  top = f.frame(1760, plateau, 220, 100, "metal", "stone");
  f.pig("shield", 1720, plateau);
  f.pig("corruptor", 1800, plateau);
  top = f.frame(1760, top, 150, 70, "wood", "glass");
  f.block(1760, top, 36, 60, "totem");
  // The radar mast.
  top = f.frame(2030, plateau, 90, 180, "wood");
  top = f.block(2030, top, 60, 20, "ice");
  f.pig("basic", 2030, top);
  return {
    id: "station",
    name: "Weather Station",
    theme: "station",
    tagline: "The piggies stole the weather. The weather is taking it personally.",
    intro: ["Calibrating anemometers (they're screaming)…", "Forecast: yes.", "A Weather Machine would really help here. Just saying."],
    difficulty: 4,
    terrain: [ground, pedestal, [1600, plateau, 560, G - plateau + 200]],
    zones: ZONES,
    blocks: f.blocks,
    pigs: f.pigs,
    cow: { x: 2265, step: 0.2, everyTurns: 2 },
    weather: { chance: 0.75, firstTurn: 1, pool: { tornado: 2, hailstorm: 2, thunderstorm: 2, lightning_storm: 2, strong_wind: 2, fog: 1 } },
    reinforce: { everyTurns: 2, minAlive: 3, maxAlive: 7, kinds: ["basic", "shield", "armored"], drops: [1300, 1700, 1850, 2030] },
    attack: { base: 2, growEvery: 3, max: 4 },
  };
}

function thudplex(): Level {
  const f = fort();
  const moat: [number, number] = [1090, 1190];
  // Gatehouse over the moat's far bank.
  let top = f.frame(1270, G, 130, 120, "metal");
  f.pig("armored", 1270, G);
  top = f.frame(1270, top, 110, 80, "stone");
  f.pig("basic", 1270, top + 80 + 20);
  // The keep, where THUD sits on his throne of stolen corn.
  top = f.frame(1580, G, 260, 130, "stone", "metal");
  f.pig("boss", 1580, G);
  top = f.frame(1580, top, 160, 90, "wood");
  f.pig("corruptor", 1580, top + 90 + 20);
  // Barracks with barrels.
  top = f.frame(1880, G, 180, 100, "wood");
  f.pig("builder", 1850, G);
  f.block(1920, G, 34, 46, "barrel");
  top = f.frame(1880, top, 180, 90, "wood", "stone");
  f.pig("shield", 1880, top + 90 + 20);
  // The last tower, vault on top.
  top = f.frame(2090, G, 110, 100, "stone");
  top = f.frame(2090, top, 110, 100, "stone");
  top = f.frame(2090, top, 100, 80, "metal");
  f.pig("armored", 2090, top);
  return {
    id: "thudplex",
    name: "The Thudplex",
    theme: "thudplex",
    tagline: "THUD is home. THUD is angry. THUD has a moat now.",
    intro: ["Scanning moat depth (deep)…", "THUD detected. THUD is large.", "Every piggy variant on site. Bring every bird."],
    difficulty: 5,
    terrain: [[-300, G, moat[0] + 300, 200], [moat[1], G, WORLD.width + 300 - moat[1], 200], pedestal],
    zones: ZONES,
    blocks: f.blocks,
    pigs: f.pigs,
    cow: { x: 2265, step: 0.25, everyTurns: 2 },
    weather: { chance: 0.6, firstTurn: 2, pool: { flood: 2, earthquake: 2, tornado: 1, acid_rain: 2, heat_wave: 1 } },
    reinforce: { everyTurns: 2, minAlive: 4, maxAlive: 8, kinds: ["basic", "armored", "corruptor", "basic"], drops: [1300, 1580, 1880, 2090] },
    attack: { base: 2, growEvery: 2, max: 5 },
  };
}

export const LEVELS: readonly Level[] = [constructionSite(), containmentFacility(), cornRefinery(), weatherStation(), thudplex()];

export function levelById(id: string): Level | undefined {
  return LEVELS.find((l) => l.id === id);
}
