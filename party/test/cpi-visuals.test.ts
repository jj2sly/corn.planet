// The CPI visual systems (characters, animation, particles) and Steam My Deck's scenery.
// They're browser code, but everything here runs without a browser: drawing goes to a stand-in
// canvas context that records calls, and the animator is fed the server's own physics.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANIM, createAnimator, type AnimEvent } from "../public/js/cpi/animation.js";
import { appearanceFor, createCharacter, drawCharacter, jointsFor, seeded, SLOTS } from "../public/js/cpi/character.js";
import { createParticles, PARTICLE_KINDS } from "../public/js/cpi/particles.js";
import { paintBackdrop, paintExit, paintHazard, paintItem, paintLive, paintPlank, paintSolids, paintStalker, paintVoid, paintWater, THEMES, themeFor } from "../public/js/games/steamdeck-scenery.js";
import { battery, phaseNotice, quip, verdict } from "../public/js/games/steamdeck-ui.js";
import { LEVELS } from "../server/games/steamdeck/levels.ts";
import { newBody, PHYS, stepBody, type Arena, type Body, type RunnerInput } from "../server/games/steamdeck/physics.ts";

/** A stand-in 2D context: every drawing call is recorded, nothing is drawn. */
function fakeContext() {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
      if (key === "measureText") return (text: string) => ({ width: text.length * 10 });
      return () => void calls.push(key);
    },
    set(target, key, value) {
      if (typeof key === "string") target[key] = value;
      return true;
    },
  });
  const count = (name: string) => calls.filter((c) => c === name).length;
  return { ctx, calls, count };
}

const STATES = ["idle", "run", "jump", "fall", "land", "slide", "slip", "draw", "place", "hit", "dead", "escape", "cheer", "sad"];

describe("CPI character system", () => {
  it("gives every id the same look on every screen, from the slots, never an unlockable", () => {
    assert.deepEqual(appearanceFor("player-7"), appearanceFor("player-7"));
    const hats = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const look = appearanceFor(`p${i}`);
      for (const slot of ["hat", "face", "suit", "accessory"] as const) {
        const option = SLOTS[slot].find((o) => o.id === look[slot]);
        assert.ok(option, `${slot} ${look[slot]} is a real option`);
        assert.ok(!option.unlock, `${option.id} is only for unlocks`);
      }
      hats.add(look.hat);
    }
    assert.ok(hats.size >= 8, "a room of agents doesn't all wear the same hat");
  });

  it("takes cosmetic overrides, ignores ones it doesn't know, and keeps the player's colour", () => {
    const base = createCharacter({ id: "ann", name: "Ann", color: "#4dd4ff" });
    const crowned = createCharacter({ id: "ann", name: "Ann", color: "#4dd4ff", appearance: { hat: "crown", face: "laser-eyes" } });
    assert.equal(crowned.appearance.hat, "crown", "an unlockable, chosen");
    assert.equal(crowned.appearance.face, base.appearance.face, "an unknown cosmetic changes nothing");
    assert.equal(base.colors.suit, "#4dd4ff");
    assert.equal(createCharacter({ id: "x", color: "not a colour" }).colors.suit, "#ffd400");
    assert.ok(Object.isFrozen(base) && Object.isFrozen(base.appearance));
  });

  it("draws every state, both ways, with every effect, and leaves the canvas as it found it", () => {
    for (const hat of SLOTS.hat.map((o) => o.id)) {
      for (const accessory of SLOTS.accessory.map((o) => o.id)) {
        const ch = createCharacter({ id: `${hat}-${accessory}`, color: "#ff5fa2", appearance: { hat, accessory } });
        for (const state of STATES) {
          const { ctx, count } = fakeContext();
          for (const facing of [1, -1]) {
            drawCharacter(ctx, ch, { x: 10, y: 20, w: 28, h: 36, facing, state, t: 0.3, cycle: 1.7, effects: ["sparkle", "stunned", "speed", "sweat"], flash: state === "hit" });
          }
          assert.equal(count("save"), count("restore"), `${hat}/${accessory} ${state}: save/restore balanced`);
          assert.ok(count("fill") > 5, "it drew something");
        }
      }
    }
    for (const state of STATES) for (const t of [0, 0.5, 3]) for (const v of Object.values(jointsFor(state, t, t))) if (typeof v === "number") assert.ok(Number.isFinite(v));
  });

  it("draws nothing when invisible", () => {
    const { ctx, calls } = fakeContext();
    drawCharacter(ctx, createCharacter({ id: "gone" }), { alpha: 0 });
    drawCharacter(ctx, createCharacter({ id: "gone" }), { scale: 0 });
    assert.deepEqual(calls, []);
  });
});

describe("CPI animation, read from the server's own physics", () => {
  const TICK = 0.05;
  const idle: RunnerInput = { left: false, right: false, jumpSeq: 0 };

  /** Runs the real simulation at the server's tick rate and feeds the animator what screens see. */
  function runner(arena: Arena, spawn: [number, number]) {
    const body: Body = newBody(spawn);
    const anim = createAnimator();
    const events: AnimEvent[] = [];
    let time = 0;
    const step = (input: RunnerInput, ticks = 1) => {
      for (let i = 0; i < ticks; i++) {
        for (let s = 0; s < 4; s++) stepBody(body, input, arena, 0, TICK / 4);
        time += TICK;
        const status = body.escaped ? "escaped" : body.deadFor > 0 ? "dead" : "alive";
        events.push(...anim.observe({ time, x: Math.round(body.x), y: Math.round(body.y), status, facing: body.facing }));
      }
    };
    /** Steps until `event` has happened (screens see it a tick after the move that caused it). */
    const until = (event: AnimEvent, input: RunnerInput = idle) => {
      for (let i = 0; i < 80 && !events.includes(event); i++) step(input);
      assert.ok(events.includes(event), `saw ${event}`);
    };
    return { body, anim, events, step, until, pose: () => anim.pose(time, Math.round(body.x)), now: () => time };
  }

  const floor = (extra: Partial<Arena> = {}): Arena => ({ spawn: [100, 300], exit: [1500, 0, 50, 50], platforms: [[0, 500, 1600, 100]], hazards: [], planks: [], ...extra });

  it("sees landing, standing, running, one jump and one landing, and nothing at the jump's apex", () => {
    const r = runner(floor(), [100, 300]);
    r.step(idle, 20);
    assert.deepEqual(r.events, ["land"], "fell onto the floor");
    assert.equal(r.anim.grounded, true);
    assert.equal(r.pose().state, "idle");
    r.step({ ...idle, right: true }, 10);
    assert.equal(r.pose().state, "run");
    assert.ok(r.pose().cycle > 1, "the legs kept pace");
    r.events.length = 0;
    r.step({ ...idle, jumpSeq: 1 });
    assert.equal(r.pose().state, "jump");
    assert.ok(r.pose().squash > 1, "stretched on take-off");
    r.step({ ...idle, jumpSeq: 1 }, 40);
    assert.deepEqual(r.events, ["jump", "land"], "one of each, however the apex rounds");
    assert.ok(r.anim.landing > 0.5, "a full jump lands hard");
  });

  it("squashes on landing, then settles", () => {
    const r = runner(floor(), [100, 100]);
    r.until("land");
    const landedAt = r.now();
    const squash = r.anim.pose(landedAt + ANIM.landS / 2).squash;
    assert.ok(squash < 0.95, `squashed (${squash})`);
    assert.equal(r.anim.pose(landedAt + ANIM.landS * 2).squash, 1);
  });

  it("sees a death, the ghost, the respawn and an escape", () => {
    const r = runner(floor({ hazards: [[300, 480, 60, 20]] }), [100, 300]);
    r.until("land");
    r.until("die", { ...idle, right: true });
    const diedAt = r.now();
    assert.equal(r.anim.pose(diedAt + 0.05).state, "hit");
    assert.equal(r.anim.pose(diedAt + 0.6).state, "dead");
    r.step(idle, Math.ceil(PHYS.respawnS / TICK) + 2);
    assert.ok(r.events.includes("respawn"));

    const out = runner(floor({ exit: [180, 430, 70, 70] }), [100, 300]);
    out.until("land");
    out.until("escape", { ...idle, right: true });
    assert.equal(out.anim.pose(out.now() + ANIM.escapeS + 0.1).gone, true, "beamed out, then gone");
  });

  it("slips when pushed against the way you face, and slides when dragged fast", () => {
    const anim = createAnimator();
    for (let i = 0; i < 6; i++) anim.observe({ time: i * TICK, x: 800 - i * 6, y: 400, facing: 1 });
    assert.equal(anim.pose(6 * TICK).state, "slip");
    const dragged = createAnimator();
    for (let i = 0; i < 6; i++) dragged.observe({ time: i * TICK, x: 800 - i * 25, y: 400, facing: 1 });
    assert.equal(dragged.pose(6 * TICK).state, "slide");
  });

  it("plays actions the game knows about (a plank placed) and holds the drawing pose", () => {
    const anim = createAnimator();
    for (let i = 0; i < 3; i++) anim.observe({ time: i * TICK, x: 100, y: 400 });
    anim.trigger("place", 0.2);
    assert.equal(anim.pose(0.3).state, "place");
    assert.equal(anim.pose(0.2 + ANIM.placeS + 0.01).state, "idle");
    anim.setFlag("drawing", true);
    assert.equal(anim.pose(1).state, "draw");
  });
});

describe("CPI particles", () => {
  it("never holds more than its pool, and empties once everything has faded", () => {
    const fx = createParticles({ max: 16, random: seeded(7) });
    for (const kind of PARTICLE_KINDS) fx.burst(kind, 10, 10, 30, { text: "+100" });
    assert.equal(fx.count, 16);
    assert.equal(fx.emit("not-a-kind", 0, 0), null);
    const { ctx } = fakeContext();
    fx.draw(ctx, "back");
    fx.draw(ctx, "front");
    for (let i = 0; i < 60; i++) fx.update(0.1);
    assert.equal(fx.count, 0);
    fx.burst("dust", 0, 0, 5);
    fx.clear();
    assert.equal(fx.count, 0);
  });
});

describe("Steam My Deck scenery", () => {
  it("dresses every level without touching its collision data", () => {
    const before = JSON.stringify(LEVELS);
    for (const level of LEVELS) {
      assert.ok(THEMES[level.id], `${level.id} has its own theme`);
      assert.equal(themeFor(level.id), THEMES[level.id]);
      const { ctx, count } = fakeContext();
      paintVoid(ctx, 800, 450);
      paintBackdrop(ctx, level);
      paintSolids(ctx, level);
      for (const t of [0, 1.3, 9.9]) paintLive(ctx, level, t);
      for (const h of level.hazards) {
        paintHazard(ctx, h.rect, { live: 0, time: 1, theme: themeFor(level.id), kind: h.kind });
        paintHazard(ctx, h.rect, { live: 1, armed: 0.5, time: 1, theme: themeFor(level.id), kind: h.kind });
      }
      for (const w of level.water ?? []) paintWater(ctx, w, 1.5);
      for (const item of level.items ?? []) paintItem(ctx, item.name, item.at[0], item.at[1], 2.2);
      if (level.stalker) paintStalker(ctx, [400, 300, 30, 110], 3);
      for (const open of [false, true]) paintExit(ctx, level.exit, { time: 2, urgent: true, out: 1, total: 3, style: themeFor(level.id).exit as string | undefined, open, found: 2, need: 6 });
      paintPlank(ctx, { x1: 400, x2: 600, y: 700 }, { age: 0.1, ttl: 1500, time: 1 });
      paintPlank(ctx, { x1: 400, x2: 600, y: 700 }, { ghost: true, invalid: true });
      assert.equal(count("save"), count("restore"), `${level.id}: save/restore balanced`);
    }
    assert.equal(JSON.stringify(LEVELS), before, "cosmetics never change what you can stand on");
    assert.equal(themeFor("no-such-level"), THEMES.blockcraft, "an unknown level still gets dressed");
  });
});

describe("Steam My Deck presentation helpers", () => {
  it("drains the Deck's battery over the play phases", () => {
    assert.equal(battery("ASSIGNMENT", null), 1);
    assert.equal(battery("ESCAPE", { remainingMs: 35_000, totalMs: 35_000 }), 1);
    const mid = battery("ESCALATION", { remainingMs: 12_500, totalMs: 25_000 });
    assert.ok(mid > 0.25 && mid < 0.45, String(mid));
    assert.equal(battery("FINAL", { remainingMs: 0, totalMs: 15_000 }), 0.03);
  });

  it("calls the round the same way on every screen", () => {
    const r = (id: string, escapedMs: number | null) => ({ id, name: id, color: "#fff", deaths: 0, escapedMs });
    assert.equal(verdict({ roster: [r("a", 1000), r("b", 2000)] }).stamp, "ALL AGENTS EXTRACTED");
    assert.equal(verdict({ roster: [r("a", null), r("b", null)] }).stamp, "CONTAINMENT HELD");
    assert.equal(verdict({ roster: [r("a", 1000), r("b", null)] }).stamp, "PARTIAL EXTRACTION");
    assert.equal(quip("ann", true, 2), quip("ann", true, 2));
    assert.match(phaseNotice({ phase: "ESCALATION", world: { maxTilt: 22 } })!.text, /22°/);
    assert.equal(phaseNotice({ phase: "INTRO", world: { maxTilt: 14 } }), null);
  });
});
