// CPI: Cold Case — the map. Pure data plus a tile-grid builder, no DOM: the browser draws it, the
// simulation (sim.js) collides against it, and the tests walk it.
//
// One tile is one metre. Everything is laid out as rectangles [x, y, w, h] in tile units, y down.
// The kitchen is deliberately far from the refrigerator interior: the fridge door is a portal, so
// the inside can be bigger than the appliance and the camera never shows both at once.
//
//                          FOOD STORAGE
//                               |  (S-bend)
//   ENTRY ── CENTRAL PASSAGE ───┴──── FREEZER
//                 | frozen hatch         | maintenance hatch
//            POWER ROOM (lift)      SERVICE CORRIDOR
//                                        |
//                                 TECHNICIAN OUTPOST
//                                        | technician hatch
//                                   DEEP INTERIOR (winding)
//                                        |
//                                   CORE (lift back up to the power room)

export const MAP_W = 96;
export const MAP_H = 104;

/**
 * Zones: every floor tile belongs to one. `temp` is the starting temperature (°C) — the simulation
 * changes some as systems are repaired — and `dark` how dark the room is before its lights change.
 */
export const ZONES = Object.freeze([
  { id: "KITCHEN", name: "KITCHEN", temp: 21, dark: 0.04, floor: "kitchen", wall: "kitchen", safe: true },
  { id: "ENTRY", name: "REFRIGERATOR ENTRY", temp: 5, dark: 0.26, floor: "liner", wall: "liner" },
  { id: "CENTRAL", name: "CENTRAL PASSAGE", temp: -6, dark: 0.55, floor: "grate", wall: "steel" },
  { id: "PANTRY", name: "FOOD STORAGE", temp: -6, dark: 0.46, floor: "liner", wall: "steel" },
  { id: "POWER", name: "POWER ROOM", temp: 3, dark: 0.84, floor: "plate", wall: "steel" },
  { id: "FREEZER", name: "FREEZER", temp: -3, dark: 0.6, floor: "ice", wall: "frost" },
  { id: "SERVICE", name: "SERVICE CORRIDOR", temp: -8, dark: 0.7, floor: "plate", wall: "frost" },
  { id: "OUTPOST", name: "TECHNICIAN OUTPOST", temp: 1, dark: 0.66, floor: "wood", wall: "steel" },
  { id: "DEEP", name: "DEEP INTERIOR", temp: -24, dark: 0.82, floor: "cavern", wall: "ice" },
  { id: "CORE", name: "CORE AREA", temp: -20, dark: 0.7, floor: "core", wall: "ice" },
]);

export const ZONE_INDEX = Object.freeze(Object.fromEntries(ZONES.map((z, i) => [z.id, i])));

/** Floor rectangles: [zone, x, y, w, h]. The first rectangle of a zone is its main room. */
const AREAS = [
  ["KITCHEN", 78, 3, 14, 11],
  ["ENTRY", 8, 38, 14, 11],
  ["ENTRY", 22, 42, 6, 3],
  ["CENTRAL", 28, 39, 13, 9],
  ["CENTRAL", 32, 35, 3, 4],
  ["CENTRAL", 32, 33, 7, 2],
  ["CENTRAL", 36, 29, 3, 4],
  ["CENTRAL", 41, 42, 9, 3],
  ["PANTRY", 22, 13, 22, 16],
  ["POWER", 26, 52, 17, 12],
  ["POWER", 33, 49, 3, 3],
  ["POWER", 23, 56, 2, 3], // emergency lift car, power level
  ["FREEZER", 51, 36, 18, 16],
  ["SERVICE", 62, 53, 2, 5],
  ["SERVICE", 62, 57, 9, 2],
  ["SERVICE", 69, 57, 2, 6],
  ["OUTPOST", 64, 63, 13, 10],
  ["DEEP", 52, 68, 11, 3],
  ["DEEP", 59, 65, 3, 3],
  ["DEEP", 48, 70, 5, 10],
  ["DEEP", 34, 78, 20, 9],
  ["DEEP", 54, 81, 5, 5],
  ["DEEP", 34, 87, 4, 8],
  ["DEEP", 28, 91, 6, 3],
  ["CORE", 12, 86, 16, 14],
  ["CORE", 18, 83, 3, 2], // emergency lift car, core level
];

/**
 * Doors sit in wall gaps and are solid until the simulation opens them. `kind` picks how they
 * look and behave: the fridge pair are portals, lifts are portals once running.
 */
export const DOORS = Object.freeze([
  { id: "fridge", zone: "KITCHEN", x: 84, y: 3, w: 2, h: 1, kind: "fridge" },
  { id: "exit", zone: "ENTRY", x: 14, y: 49, w: 2, h: 1, kind: "fridgeInner" },
  { id: "hatch", zone: "CENTRAL", x: 33, y: 48, w: 3, h: 1, kind: "frozen" },
  { id: "freezerDoor", zone: "CENTRAL", x: 50, y: 42, w: 1, h: 3, kind: "slide" },
  { id: "maintHatch", zone: "FREEZER", x: 62, y: 52, w: 2, h: 1, kind: "hatch" },
  { id: "deepHatch", zone: "OUTPOST", x: 63, y: 69, w: 1, h: 2, kind: "hatch" },
  { id: "liftPower", zone: "POWER", x: 25, y: 56, w: 1, h: 3, kind: "lift" },
  { id: "liftCore", zone: "CORE", x: 18, y: 85, w: 3, h: 1, kind: "lift" },
  { id: "kitchenDoor", zone: "KITCHEN", x: 84, y: 14, w: 2, h: 1, kind: "sealed" },
]);

/** Solid furniture and machinery, tile-aligned. `kind` is only for drawing. */
export const OBSTACLES = Object.freeze([
  // Kitchen: an ordinary kitchen, on purpose.
  { kind: "counter", x: 78, y: 3, w: 1, h: 1 },
  { kind: "stove", x: 79, y: 3, w: 2, h: 1 },
  { kind: "counter", x: 81, y: 3, w: 3, h: 1 },
  { kind: "counter", x: 86, y: 3, w: 2, h: 1 },
  { kind: "sink", x: 88, y: 3, w: 2, h: 1 },
  { kind: "counter", x: 90, y: 3, w: 2, h: 1 },
  { kind: "counter", x: 78, y: 7, w: 1, h: 4 },
  { kind: "table", x: 80, y: 7, w: 4, h: 2 },
  { kind: "cabinet", x: 91, y: 8, w: 1, h: 3 },
  // Refrigerator entry: fridge furniture at an impossible scale.
  { kind: "rack", x: 9, y: 41, w: 4, h: 1 },
  { kind: "rack", x: 17, y: 41, w: 4, h: 1 },
  { kind: "eggtray", x: 9, y: 44, w: 3, h: 2 },
  { kind: "crisper", x: 17, y: 45, w: 4, h: 2 },
  // Central passage.
  { kind: "pillar", x: 30, y: 41, w: 1, h: 1 },
  { kind: "pillar", x: 38, y: 41, w: 1, h: 1 },
  { kind: "pillar", x: 30, y: 45, w: 1, h: 1 },
  { kind: "pillar", x: 38, y: 45, w: 1, h: 1 },
  // Food storage: aisles.
  { kind: "shelf", x: 24, y: 16, w: 7, h: 1 },
  { kind: "shelf", x: 33, y: 16, w: 8, h: 1 },
  { kind: "shelf", x: 24, y: 20, w: 5, h: 1 },
  { kind: "shelf", x: 31, y: 20, w: 5, h: 1 },
  { kind: "shelf", x: 38, y: 20, w: 4, h: 1 },
  { kind: "shelf", x: 24, y: 24, w: 8, h: 1 },
  { kind: "shelf", x: 35, y: 24, w: 7, h: 1 },
  { kind: "chest", x: 22, y: 26, w: 2, h: 2 },
  // Power room.
  { kind: "generator", x: 29, y: 55, w: 3, h: 3 },
  { kind: "generator", x: 37, y: 55, w: 3, h: 3 },
  { kind: "transformer", x: 33, y: 57, w: 3, h: 2 },
  // Freezer.
  { kind: "frostrack", x: 54, y: 39, w: 1, h: 5 },
  { kind: "frostrack", x: 58, y: 40, w: 4, h: 1 },
  { kind: "frostrack", x: 58, y: 47, w: 5, h: 1 },
  { kind: "icepillar", x: 55, y: 47, w: 1, h: 1 },
  { kind: "icepillar", x: 62, y: 43, w: 1, h: 1 },
  { kind: "compressor", x: 66, y: 42, w: 3, h: 5 },
  // Technician outpost: abandoned equipment.
  { kind: "workbench", x: 71, y: 63, w: 4, h: 1 },
  { kind: "toolchest", x: 64, y: 63, w: 2, h: 1 },
  { kind: "heater", x: 68, y: 66, w: 1, h: 1 },
  { kind: "cot", x: 73, y: 69, w: 3, h: 2 },
  { kind: "locker", x: 76, y: 65, w: 1, h: 2 },
  // Deep interior.
  { kind: "icepillar", x: 50, y: 73, w: 1, h: 1 },
  { kind: "icepillar", x: 49, y: 77, w: 1, h: 1 },
  { kind: "icepillar", x: 38, y: 80, w: 1, h: 1 },
  { kind: "icepillar", x: 45, y: 80, w: 1, h: 1 },
  { kind: "icepillar", x: 42, y: 84, w: 1, h: 1 },
  { kind: "icepillar", x: 47, y: 83, w: 1, h: 1 },
  { kind: "icepillar", x: 51, y: 84, w: 1, h: 1 },
  { kind: "pipe", x: 40, y: 86, w: 6, h: 1 },
  { kind: "pipe", x: 57, y: 68, w: 3, h: 1 },
  // Core.
  { kind: "core", x: 18, y: 91, w: 3, h: 3 },
  { kind: "coil", x: 14, y: 88, w: 1, h: 1 },
  { kind: "coil", x: 24, y: 88, w: 1, h: 1 },
  { kind: "coil", x: 19, y: 98, w: 1, h: 1 },
  { kind: "console", x: 23, y: 95, w: 2, h: 1 },
]);

/** Slippery floor: [x, y, w, h]. */
export const ICE = Object.freeze([
  [56, 43, 6, 3],
  [59, 49, 6, 2],
  [39, 81, 3, 3],
  [52, 69, 3, 2],
]);

/**
 * Interaction points. `kind`: tap (press E), hold (hold E for `dur` s) or panel (press E to open a
 * repair panel). `r` is how close (tiles) the agent must stand. `face` is the wall the fixture is
 * mounted on, for drawing.
 */
export const STATIONS = Object.freeze([
  { id: "fridge", zone: "KITCHEN", x: 84.95, y: 4.35, r: 1.5, kind: "tap" },
  { id: "thermostat", zone: "PANTRY", x: 41.5, y: 13.55, r: 1.45, kind: "panel", face: "n" },
  { id: "breakerA", zone: "POWER", x: 26.55, y: 61.5, r: 1.4, kind: "hold", dur: 1.1, face: "w" },
  { id: "breakerB", zone: "POWER", x: 40.5, y: 52.55, r: 1.4, kind: "hold", dur: 1.1, face: "n" },
  { id: "breakerC", zone: "POWER", x: 42.45, y: 55.5, r: 1.4, kind: "hold", dur: 1.1, face: "e" },
  { id: "mainbus", zone: "POWER", x: 34.5, y: 63.45, r: 1.5, kind: "panel", face: "s" },
  { id: "valve1", zone: "FREEZER", x: 52.5, y: 36.55, r: 1.4, kind: "hold", dur: 1.4, face: "n" },
  { id: "valve2", zone: "FREEZER", x: 64.5, y: 36.55, r: 1.4, kind: "hold", dur: 1.4, face: "n" },
  { id: "valve3", zone: "FREEZER", x: 55.5, y: 51.45, r: 1.4, kind: "hold", dur: 1.4, face: "s" },
  { id: "compressor", zone: "FREEZER", x: 65.35, y: 44.5, r: 1.45, kind: "panel", face: "e" },
  { id: "chuck", zone: "OUTPOST", x: 69.9, y: 67.35, r: 1.5, kind: "hold", dur: 1 },
  { id: "locker", zone: "OUTPOST", x: 75.4, y: 66, r: 1.4, kind: "tap", face: "e" },
  { id: "lamp1", zone: "DEEP", x: 60.5, y: 66.3, r: 1.3, kind: "hold", dur: 0.6 },
  { id: "lamp2", zone: "DEEP", x: 56.5, y: 83.3, r: 1.3, kind: "hold", dur: 0.6 },
  { id: "lamp3", zone: "DEEP", x: 32.6, y: 92, r: 1.3, kind: "hold", dur: 0.6 },
  { id: "lamp4", zone: "CORE", x: 25.4, y: 95.9, r: 1.3, kind: "hold", dur: 0.6 },
  { id: "coil1", zone: "CORE", x: 14.5, y: 89.45, r: 1.4, kind: "hold", dur: 1.2 },
  { id: "coil2", zone: "CORE", x: 24.5, y: 89.45, r: 1.4, kind: "hold", dur: 1.2 },
  { id: "coil3", zone: "CORE", x: 19.5, y: 97.55, r: 1.4, kind: "hold", dur: 1.2 },
  { id: "console", zone: "CORE", x: 24, y: 94.4, r: 1.45, kind: "panel", face: "s" },
]);

/** Heat lamps (switched on at their station) and the outpost heater: warm refuges. */
export const HEATERS = Object.freeze([
  { id: "lamp1", x: 60.5, y: 66.3, r: 2.8, temp: 14 },
  { id: "lamp2", x: 56.5, y: 83.3, r: 2.8, temp: 14 },
  { id: "lamp3", x: 32.6, y: 92, r: 2.8, temp: 14 },
  { id: "lamp4", x: 25.4, y: 95.9, r: 2.8, temp: 14 },
]);

/** Stabilized checkpoints: where a downed agent is sent back to. */
export const CHECKPOINTS = Object.freeze([
  { id: "kitchen", zone: "KITCHEN", x: 84.95, y: 10.5 },
  { id: "entry", zone: "ENTRY", x: 14.95, y: 46.4 },
  { id: "power", zone: "POWER", x: 34.5, y: 53.7 },
  { id: "outpost", zone: "OUTPOST", x: 70.5, y: 64.6 },
  { id: "core", zone: "DEEP", x: 30.6, y: 92 },
]);

/** Where the food is kept. `leash` is the zone a threat never leaves. */
export const THREATS = Object.freeze([
  { id: "milk1", kind: "milk", leash: "PANTRY", x: 27.5, y: 18.5 },
  { id: "milk2", kind: "milk", leash: "PANTRY", x: 36.5, y: 18.5 },
  { id: "milk3", kind: "milk", leash: "PANTRY", x: 29.5, y: 22.5 },
  { id: "milk4", kind: "milk", leash: "PANTRY", x: 39.5, y: 26.5 },
  { id: "cream1", kind: "icecream", leash: "FREEZER", x: 60.5, y: 42.5 },
  { id: "cream2", kind: "icecream", leash: "FREEZER", x: 56.5, y: 49.5 },
  { id: "cream3", kind: "icecream", leash: "FREEZER", x: 64.5, y: 39.5 },
  { id: "cream4", kind: "icecream", leash: "DEEP", x: 50.5, y: 71.5 },
  { id: "cream5", kind: "icecream", leash: "DEEP", x: 44.5, y: 82.5 },
  { id: "cream6", kind: "icecream", leash: "DEEP", x: 37.5, y: 84.5 },
  { id: "cream7", kind: "icecream", leash: "CORE", x: 14.5, y: 96.5 },
  { id: "cream8", kind: "icecream", leash: "CORE", x: 26, y: 98.5 },
]);

/** Pickups: heat packs (Space to use) and CPST field kits (+health, taken on contact). */
export const PICKUPS = Object.freeze([
  { id: "pack1", kind: "heatpack", x: 22.6, y: 13.6 },
  { id: "kit1", kind: "fieldkit", x: 41.5, y: 62.5 },
  { id: "kit2", kind: "fieldkit", x: 67.6, y: 50.5 },
  { id: "pack2", kind: "heatpack", x: 57.6, y: 84.6 },
  { id: "kit3", kind: "fieldkit", x: 55, y: 82 },
]);

/**
 * Hazards. Spark trenches arc once the power room has current; frost vents blast cold on a cycle.
 * `phase` staggers them so there is always a way through.
 */
export const HAZARDS = Object.freeze([
  { id: "trench1", kind: "spark", x: 26, y: 60, w: 5, h: 1, period: 3.2, phase: 0 },
  { id: "trench2", kind: "spark", x: 31, y: 60, w: 5, h: 1, period: 3.2, phase: 1.1 },
  { id: "trench3", kind: "spark", x: 36, y: 60, w: 7, h: 1, period: 3.2, phase: 2.2 },
  { id: "vent1", kind: "vent", x: 56.5, y: 69.5, r: 1.7, period: 5, phase: 0 },
  { id: "vent2", kind: "vent", x: 50.5, y: 75.5, r: 1.7, period: 5, phase: 1.7 },
  { id: "vent3", kind: "vent", x: 44, y: 82.5, r: 1.7, period: 5, phase: 3.3 },
]);

/** Portals: walking into `rect` (once its door is open) carries the agent to `to`. */
export const PORTALS = Object.freeze([
  { id: "intoFridge", door: "fridge", rect: [84, 3, 2, 1], to: { x: 14.95, y: 48.2, facing: -Math.PI / 2 }, offsetX: -70, kind: "fridge" },
  { id: "outOfFridge", door: "exit", rect: [14, 49, 2, 1], to: { x: 84.95, y: 4.6, facing: Math.PI / 2 }, offsetX: 70, kind: "fridge" },
  { id: "liftUp", door: "liftCore", rect: [18, 83, 3, 2], to: { x: 23.9, y: 57.5, facing: 0 }, kind: "lift" },
]);

/** The agent's starting spot and the core's centre (the "hold the core" ring is measured from it). */
export const START = Object.freeze({ x: 84.95, y: 11, facing: -Math.PI / 2 });
export const CORE_CENTER = Object.freeze({ x: 19.5, y: 92.5 });

/**
 * Lights, for drawing only. `when` ties a light to the mission state: always, power (after main
 * power), nopower (emergency beacons until then), cooling, outpost, core (after stabilizing).
 */
export const LIGHTS = Object.freeze([
  { x: 81, y: 6.5, r: 8, color: "#ffd9a0", power: 1, when: "always" },
  { x: 88.5, y: 6.5, r: 8, color: "#ffd9a0", power: 1, when: "always" },
  { x: 85, y: 11.5, r: 6, color: "#ffe2b8", power: 0.9, when: "always" },
  { x: 11.5, y: 40.5, r: 8, color: "#eaf8ff", power: 1, when: "always" },
  { x: 18.5, y: 44.5, r: 8, color: "#eaf8ff", power: 1, when: "always" },
  { x: 25, y: 43.5, r: 4.5, color: "#dff4ff", power: 0.7, when: "always" },
  { x: 34.5, y: 43, r: 5.5, color: "#ff4b3a", power: 0.55, when: "nopower", beacon: true },
  { x: 34.5, y: 43, r: 7.5, color: "#d8f1ff", power: 0.9, when: "power" },
  { x: 37.5, y: 31, r: 4.5, color: "#ff4b3a", power: 0.45, when: "nopower", beacon: true },
  { x: 45.5, y: 43.5, r: 5, color: "#d8f1ff", power: 0.8, when: "power" },
  { x: 27.5, y: 15, r: 6.5, color: "#e8f6ff", power: 0.75, when: "always" },
  { x: 38, y: 18, r: 6.5, color: "#e8f6ff", power: 0.75, when: "always" },
  { x: 28, y: 26, r: 6, color: "#e8f6ff", power: 0.65, when: "always" },
  { x: 41, y: 13.8, r: 3, color: "#7fe0ff", power: 0.6, when: "always" },
  { x: 34.5, y: 50.5, r: 4, color: "#ff4b3a", power: 0.5, when: "nopower", beacon: true },
  { x: 30, y: 60, r: 5, color: "#ff4b3a", power: 0.5, when: "nopower", beacon: true },
  { x: 39.5, y: 53, r: 4.5, color: "#ff4b3a", power: 0.45, when: "nopower", beacon: true },
  { x: 30.5, y: 54, r: 8, color: "#fff1c9", power: 1, when: "power" },
  { x: 38.5, y: 60.5, r: 8, color: "#fff1c9", power: 1, when: "power" },
  { x: 55, y: 40, r: 7, color: "#bfe8ff", power: 0.85, when: "power" },
  { x: 63, y: 47, r: 7, color: "#bfe8ff", power: 0.85, when: "power" },
  { x: 60, y: 44, r: 5, color: "#ff4b3a", power: 0.5, when: "nopower", beacon: true },
  { x: 66, y: 44.5, r: 3.5, color: "#7fe0ff", power: 0.7, when: "cooling" },
  { x: 62.5, y: 55, r: 4, color: "#ffb347", power: 0.55, when: "cooling", beacon: true },
  { x: 70, y: 60, r: 4, color: "#ffb347", power: 0.45, when: "always" },
  { x: 68.5, y: 66.5, r: 6.5, color: "#ffa04d", power: 1, when: "outpost" },
  { x: 72.5, y: 63.8, r: 3.5, color: "#ffd48a", power: 0.55, when: "always" },
  { x: 60.5, y: 66.3, r: 4.5, color: "#ffab5e", power: 1, when: "lamp1" },
  { x: 56.5, y: 83.3, r: 4.5, color: "#ffab5e", power: 1, when: "lamp2" },
  { x: 32.6, y: 92, r: 4.5, color: "#ffab5e", power: 1, when: "lamp3" },
  { x: 25.4, y: 95.9, r: 4.5, color: "#ffab5e", power: 1, when: "lamp4" },
  { x: 43, y: 80, r: 5, color: "#5fb8ff", power: 0.35, when: "always" },
  { x: 19.5, y: 92.5, r: 8.5, color: "#7ee8ff", power: 0.85, when: "always" },
  { x: 19.5, y: 84, r: 3.5, color: "#ff4b3a", power: 0.5, when: "nocore", beacon: true },
  { x: 19.5, y: 84, r: 4, color: "#9dff9d", power: 0.7, when: "core" },
  { x: 24, y: 57.5, r: 3.5, color: "#9dff9d", power: 0.6, when: "core" },
  { x: 15, y: 47.5, r: 4, color: "#9dff9d", power: 0.6, when: "core" },
]);

const inRect = (x, y, [rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

/**
 * Builds the tile grid. Arrays are W*H, indexed y * W + x:
 *   floor   1 where an agent could stand (including door gaps)
 *   zone    zone index + 1 (0 = none; walls take the zone of a floor neighbour, for drawing)
 *   wall    1 for the ring of solid tiles around floors
 *   block   obstacle index + 1 where furniture stands
 *   door    door index + 1 in door gaps
 *   ice     1 on slippery floor
 */
export function buildMap() {
  const W = MAP_W;
  const H = MAP_H;
  const n = W * H;
  const floor = new Uint8Array(n);
  const zone = new Uint8Array(n);
  const wall = new Uint8Array(n);
  const block = new Int16Array(n);
  const door = new Int16Array(n);
  const ice = new Uint8Array(n);
  const at = (x, y) => y * W + x;

  const rooms = ZONES.map((z) => ({ id: z.id, rects: [] }));
  for (const [id, x, y, w, h] of AREAS) {
    const zi = ZONE_INDEX[id];
    if (zi === undefined) throw new Error(`Unknown zone ${id}`);
    rooms[zi].rects.push([x, y, w, h]);
    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        floor[at(tx, ty)] = 1;
        zone[at(tx, ty)] = zi + 1;
      }
    }
  }
  DOORS.forEach((d, i) => {
    for (let ty = d.y; ty < d.y + d.h; ty++) {
      for (let tx = d.x; tx < d.x + d.w; tx++) {
        floor[at(tx, ty)] = 1;
        zone[at(tx, ty)] = ZONE_INDEX[d.zone] + 1;
        door[at(tx, ty)] = i + 1;
      }
    }
  });
  OBSTACLES.forEach((o, i) => {
    for (let ty = o.y; ty < o.y + o.h; ty++) {
      for (let tx = o.x; tx < o.x + o.w; tx++) {
        if (!floor[at(tx, ty)]) throw new Error(`Obstacle ${o.kind} at ${tx},${ty} is off the floor`);
        block[at(tx, ty)] = i + 1;
      }
    }
  });
  for (const [x, y, w, h] of ICE) {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (floor[at(tx, ty)]) ice[at(tx, ty)] = 1;
  }
  // Walls: every non-floor tile touching a floor tile. It takes a neighbour's zone (edge neighbours
  // first) so it can be drawn in that room's style and hidden with it.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (floor[at(x, y)]) continue;
      let z = 0;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !floor[at(nx, ny)]) continue;
        z = zone[at(nx, ny)];
        break;
      }
      if (z) {
        wall[at(x, y)] = 1;
        zone[at(x, y)] = z;
      }
    }
  }

  return {
    w: W,
    h: H,
    floor,
    zone,
    wall,
    block,
    door,
    ice,
    rooms,
    zones: ZONES,
    doors: DOORS,
    obstacles: OBSTACLES,
    stations: STATIONS,
    heaters: HEATERS,
    checkpoints: CHECKPOINTS,
    threats: THREATS,
    pickups: PICKUPS,
    hazards: HAZARDS,
    portals: PORTALS,
    lights: LIGHTS,
    start: START,
    core: CORE_CENTER,
    /** Zone index at a tile, or -1 off the floor. */
    zoneAt(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return -1;
      const i = at(x, y);
      return floor[i] ? zone[i] - 1 : -1;
    },
    inRect,
  };
}
