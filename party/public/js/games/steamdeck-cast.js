// Escape Thad's Steam Deck: the cast. Every round each runner is dealt one of these at random (no
// repeats until the cast runs out) and escapes with what they got. Shared by the server (which deals
// them and applies their movement) and the screens (which draw them), like steamdeck-rules.js.
//
// Movement: `run` scales top speed and acceleration, `jump` the jump's launch speed, `knock` how far
// Thad's shake throws them. 1 is normal. The collision box is the same for everyone, so every level
// stays the same shape; size (`w`, `h`) is how they're drawn.
//
// `look` is for cpi/character.js's person style: skin, hair, glasses, top, extras, a held prop.
// Thad is not in the cast: Thad's Steam Deck is the item everyone is inside.

export const CAST = Object.freeze([
  {
    id: "madden",
    name: "Jacob Madden",
    stats: { run: 1, jump: 1, knock: 1 },
    size: { w: 1, h: 1.12 },
    look: { skin: "#f2c6a8", hair: { style: "shaggy", color: "#b0673a" }, top: { style: "sweater", color: "#15161a", logo: "ck" }, prop: "chips" },
  },
  {
    id: "anacker",
    name: "Mrs. Anacker",
    stats: { run: 1, jump: 1, knock: 1 },
    size: { w: 1, h: 1 },
    look: { skin: "#f0c2a2", hair: { style: "tied", color: "#6e3a22" }, top: { style: "quarterzip", color: "#4a4d52", under: "#e8b21c", patch: "tiger" }, extras: ["lanyard", "ribbon"], smile: true },
  },
  {
    id: "parish",
    name: "Brady Parish",
    stats: { run: 0.84, jump: 0.86, knock: 1 },
    size: { w: 1, h: 1.1 },
    look: { skin: "#f1c4a6", hair: { style: "curly", color: "#8a6a4a" }, top: { style: "hoodie", color: "#16171b", print: "flower" }, extras: ["necklace", "ballchain"] },
  },
  {
    id: "weller",
    name: "Weller",
    stats: { run: 0.84, jump: 0.88, knock: 0.6 },
    size: { w: 1.28, h: 0.9 },
    look: { skin: "#f0c0a0", hair: { style: "buzz", color: "#6a4a30" }, glasses: "rect", top: { style: "singlet", color: "#d8322c", trim: "#ffffff", letter: "A" }, prop: "headgear" },
  },
  {
    id: "thomas",
    name: "Blake Thomas",
    stats: { run: 1.12, jump: 1.08, knock: 1.1 },
    size: { w: 0.84, h: 1.04 },
    look: { skin: "#eebf9f", hair: { style: "bigcurly", color: "#5a3a22" }, top: { style: "tee", color: "#3a3b3f", print: "sublime" } },
  },
  {
    id: "kane",
    name: "Aiden Kane",
    stats: { run: 1.1, jump: 1.06, knock: 1 },
    // Always on a cut or a bulk: each round is one or the other.
    size: { w: 1, h: 1.08 },
    builds: [
      { name: "cut", w: 0.8 },
      { name: "bulk", w: 1.3 },
    ],
    look: { skin: "#f2c4a4", hair: { style: "messy", color: "#d9a64e" }, glasses: "rect", top: { style: "hoodie", color: "#1d1f22" }, prop: "icecream" },
  },
  {
    id: "stenson",
    name: "Eli Stenson",
    stats: { run: 1.1, jump: 1.06, knock: 1 },
    size: { w: 1, h: 1 },
    look: { skin: "#f0c09c", hair: { style: "short", color: "#b0602e" }, beard: "#a0522d", glasses: "round", hat: "cap", top: { style: "tee", color: "#1b1c20", print: "maroon" }, smile: true },
  },
  {
    id: "napoleon",
    name: "Jacob Madden as Napoleon",
    stats: { run: 1, jump: 1, knock: 1 },
    size: { w: 1, h: 0.86 },
    look: { skin: "#f4ccb0", hair: { style: "short", color: "#c8a060" }, hat: "bicorne", top: { style: "coat", color: "#1e2a55", front: "#f2f0e8", buttons: "#d4a93a", cuff: "#a0222c" }, legs: "#d9ccaa" },
  },
]);

export const NORMAL_STATS = Object.freeze({ run: 1, jump: 1, knock: 1 });

export const castMember = (id) => CAST.find((c) => c.id === id) ?? null;

/**
 * Deals a character to each runner: shuffled with `random`, no repeats until the cast runs out.
 * Returns [{ id, build }], `build` the index of a character's build (0 when it has only one).
 */
export function dealCast(count, random) {
  const deck = [];
  while (deck.length < count) {
    const round = CAST.map((c) => c.id);
    for (let i = round.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [round[i], round[j]] = [round[j], round[i]];
    }
    deck.push(...round);
  }
  return deck.slice(0, count).map((id) => {
    const builds = castMember(id).builds;
    return { id, build: builds ? Math.floor(random() * builds.length) : 0 };
  });
}
