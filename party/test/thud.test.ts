import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { io as connect, type Socket } from "socket.io-client";
import { BIRDS, lookFor, SKINS } from "../public/js/games/thud-birds.js";
import { arc, aimFromPull, placement } from "../public/js/games/thud-rules.js";
import { createPartyServer } from "../server/app.ts";
import { createAuthVerifier } from "../server/auth.ts";
import { PartyDb } from "../server/db.ts";
import { PartyError } from "../server/errors.ts";
import { createWallet } from "../server/games/kit/economy.ts";
import { createWorld } from "../server/games/kit/rigid.ts";
import { drawSchedule, forecast } from "../server/games/kit/weather.ts";
import { BUILDINGS, CORRUPTION, ECONOMY, MATERIALS, PIGS, SLINGSHOT, TIMING, WEATHER, WEATHER_TIERS, WORLD } from "../server/games/thud/config.ts";
import { thudGame, trajectoryScore } from "../server/games/thud/game.ts";
import { LEVELS } from "../server/games/thud/levels.ts";
import { entityOf, ThudWorld } from "../server/games/thud/world.ts";
import type { Room } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers, seededRandom, stubCanon } from "./helpers.ts";

type View = any;

const view = (room: Room, playerId?: string): View => room.viewFor(playerId ? { kind: "player", playerId } : { kind: "host" }).game;
const game = (room: Room): any => (room as any).game;
const tick = (n = 1) => mock.timers.tick(TIMING.tickMs * n);
const expectError = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof PartyError && e.code === code, code);

function start(names = ["Ann", "Bo", "Cy"], level = "site") {
  const rooms = makeRooms();
  const { room, players } = roomWithPlayers(rooms.manager, names);
  room.configure({ gameId: "thud", settings: { level } });
  room.startGame();
  return { ...rooms, room, ids: players.map((p) => p.id) };
}

/** Everyone picks and readies; skips the launch; lands in the first build phase. */
function toBuild(room: Room, ids: string[], birds: string[] = []) {
  ids.forEach((id, i) => {
    if (birds[i]) room.gameInput(id, "choose", { bird: birds[i] });
    room.gameInput(id, "ready", { ready: true });
  });
  assert.equal(view(room).phase, "LAUNCH");
  room.hostGameAction("skip", {});
  assert.equal(view(room).phase, "BUILD");
}

/** Waits (in game time) until the shot in flight is over. */
function land(room: Room) {
  for (let i = 0; i < 400 && view(room).action?.stage === "FLIGHT"; i++) tick();
  assert.notEqual(view(room).action?.stage, "FLIGHT", "the shot ended");
}

function shoot(room: Room, id: string, angle = 38, power = 0.9) {
  assert.equal(view(room).action.shooterId, id);
  room.gameInput(id, "launch", { angle, power });
  assert.equal(view(room).action.stage, "FLIGHT");
  land(room);
}

/** Through the between-shots pause to the next shooter (or the processing). */
const next = (room: Room) => room.hostGameAction("skip", {});

/** Runs the piggies' processing to the end (skipping each step). */
function process(room: Room) {
  for (let i = 0; i < 12 && view(room).phase === "PROCESS"; i++) room.hostGameAction("skip", {});
}

describe("CPI rigid bodies", () => {
  it("stacks stand, fall asleep, and the same inputs give the same result", () => {
    const run = () => {
      const w = createWorld({ gravity: 800 });
      w.add({ x: 1200, y: 880, shape: { kind: "box", hw: 1200, hh: 20 }, fixed: true, friction: 0.8 });
      const boxes = Array.from({ length: 10 }, (_, i) => w.add({ x: 500, y: 840 - i * 40, shape: { kind: "box", hw: 20, hh: 20 }, density: 1, friction: 0.7, restitution: 0.1 }));
      for (let i = 0; i < 480; i++) w.step(1 / 120);
      assert.ok(w.settled(), "asleep");
      const top = boxes.at(-1)!;
      assert.ok(Math.abs(top.x - 500) < 2 && Math.abs(top.angle) < 0.02, `the column stands (${top.x}, ${top.angle})`);
      const ball = w.add({ x: 200, y: 700, shape: { kind: "circle", r: 16 }, density: 3, vx: 1000, vy: -100 });
      let hits = 0;
      w.onImpact = (_a, _b, speed) => void (speed > 100 && (hits += 1));
      for (let i = 0; i < 900 && !w.settled(); i++) w.step(1 / 120);
      assert.ok(hits > 0, "the ball hit the column");
      return boxes.map((b) => `${b.x.toFixed(6)},${b.y.toFixed(6)}`).join(";") + ball.x;
    };
    assert.equal(run(), run(), "deterministic");
  });

  it("floats light things and sinks heavy ones in water, and blows windy ones sideways", () => {
    const w = createWorld({ gravity: 800 });
    w.add({ x: 500, y: 980, shape: { kind: "box", hw: 600, hh: 20 }, fixed: true });
    w.waterLevel = 700;
    const cork = w.add({ x: 300, y: 900, shape: { kind: "box", hw: 20, hh: 20 }, density: 0.4 });
    const rock = w.add({ x: 600, y: 900, shape: { kind: "box", hw: 20, hh: 20 }, density: 2.5 });
    const kite = w.add({ x: 450, y: 200, shape: { kind: "circle", r: 10 }, density: 1, windScale: 1, gravityScale: 0 });
    w.wind = 300;
    for (let i = 0; i < 480; i++) w.step(1 / 120);
    assert.ok(cork.y < 720, `the cork floats (${cork.y})`);
    assert.ok(rock.y > 900, "the rock sinks");
    assert.ok(kite.x > 800, "the wind carries it");
  });
});

describe("Angry Thud's Revenge: levels and the world", () => {
  for (const level of LEVELS) {
    it(`${level.name} stands up on its own, and a bird knocks it about`, () => {
      const log = { broke: 0, killed: 0 };
      const w = new ThudWorld(level, { broke: () => log.broke++, killed: () => log.killed++, pigHit: () => {}, buildingLost: () => {}, structural: () => {} }, seededRandom(3), WEATHER_TIERS);
      assert.equal(w.pigs().length, level.pigs.length, "every piggy alive after settling");
      for (const b of w.world.bodies) w.world.wake(b);
      const before = new Map(w.world.bodies.map((b) => [b.id, [b.x, b.y]]));
      w.advance(2);
      for (const b of w.world.bodies) assert.ok(Math.hypot(b.x - before.get(b.id)![0]!, b.y - before.get(b.id)![1]!) < 3, `${b.id} stays put`);
      assert.deepEqual([log.broke, log.killed], [0, 0], "nothing breaks by itself");
      w.launch("p", "anvil", "classic", 30, 0.95);
      for (let t = 0; t < 12 && (t < 0.3 || w.busy()); t += 0.05) w.advance(0.05);
      const shot = w.endShot()!;
      assert.ok(shot.maxX > 1100, "the bird reaches the fortress");
      assert.ok(log.broke + log.killed > 0 || shot.damage > 0, "and does something there");
    });
  }

  it("rebuilds what the piggies lost (bottom up, where there's room) and patches damage", () => {
    const level = LEVELS[0]!;
    const w = new ThudWorld(level, { broke: () => {}, killed: () => {}, pigHit: () => {}, buildingLost: () => {}, structural: () => {} }, seededRandom(1), WEATHER_TIERS);
    const blocks = w.fortressBlocks();
    const top = blocks.filter((b) => entityOf(b).material === "wood").sort((a, b) => a.y - b.y)[0]!;
    const hp = entityOf(top).maxHp;
    w.world.remove(top);
    const damaged = w.fortressBlocks()[0]!;
    entityOf(damaged).hp -= 10;
    const r = w.repair(hp + 10);
    assert.equal(r.rebuilt, 1);
    assert.equal(w.fortressBlocks().length, level.blocks.length, "the lost block is back");
    assert.ok(entityOf(damaged).hp > entityOf(damaged).maxHp - 10, "the damage is patched");
  });

  it("parachutes reinforcements in gently: they land alive (a free kill would be free corruption)", () => {
    const log = { killed: 0 };
    const w = new ThudWorld(LEVELS[2]!, { broke: () => {}, killed: () => log.killed++, pigHit: () => {}, buildingLost: () => {}, structural: () => {} }, seededRandom(4), WEATHER_TIERS);
    const pig = w.addPig("basic", 1650, 380, false, true);
    assert.equal(entityOf(pig).dropping, true);
    for (let t = 0; t < 8 && w.busy(); t += 0.05) w.advance(0.05);
    assert.equal(log.killed, 0, "survived the landing");
    assert.equal(entityOf(pig).dropping, false, "the chute is packed away");
    assert.equal(entityOf(pig).hp, entityOf(pig).maxHp, "not a scratch");
  });

  it("never rebuilds specials, or a block with nothing left under it", () => {
    const level = LEVELS[0]!;
    const w = new ThudWorld(level, { broke: () => {}, killed: () => {}, pigHit: () => {}, buildingLost: () => {}, structural: () => {} }, seededRandom(1), WEATHER_TIERS);
    const vault = w.fortressBlocks().find((b) => entityOf(b).material === "vault")!;
    w.world.remove(vault);
    assert.equal(w.repair(10_000).rebuilt, 0, "a cracked vault stays cracked");
    // Knock out a slab and both its posts, then block where the posts stood: the slab has nothing to sit on.
    const office = w.fortressBlocks().filter((b) => Math.abs(b.x - 1260) < 80 && b.y > 700);
    for (const b of office) w.world.remove(b);
    for (const b of office.filter((q) => (q.shape as { hh: number }).hh > 30)) w.world.add({ x: b.x, y: b.y + 30, shape: { kind: "box", hw: 5, hh: 5 }, fixed: true, data: { kind: "terrain", team: "none" } });
    const before = w.fortressBlocks().length;
    const r = w.repair(10_000);
    const slabs = w.fortressBlocks().filter((b) => Math.abs(b.x - 1260) < 20 && b.y > 700 && b.y < 800);
    assert.equal(slabs.length, 0, "no floating slab");
    assert.ok(w.fortressBlocks().length >= before, `rebuilt what it could (${r.rebuilt})`);
  });
});

describe("Angry Thud's Revenge: birds and abilities", () => {
  const fresh = (bird: string, angle = 30, power = 0.95) => {
    const log = { broke: 0, killed: 0 };
    const w = new ThudWorld(LEVELS[0]!, { broke: () => log.broke++, killed: () => log.killed++, pigHit: () => {}, buildingLost: () => {}, structural: () => {} }, seededRandom(2), WEATHER_TIERS);
    w.launch("p", bird, "classic", angle, power);
    return { w, log };
  };
  const primary = (w: ThudWorld) => w.birds().find((b) => entityOf(b).bird!.primary)!;

  it("defines every bird with a distinct, data-driven ability and a look in any skin", () => {
    assert.equal(new Set(BIRDS.map((b) => b.ability.kind)).size, BIRDS.length, "one ability each");
    for (const b of BIRDS) {
      assert.ok(b.body.r > 0 && b.body.density > 0, b.id);
      for (const s of SKINS) assert.ok(lookFor(b.id, s.id), `${b.id} in ${s.id}`);
    }
    assert.ok(SKINS.some((s) => s.source === "cast"), "Steam My Deck's cast keep their identity as birds");
  });

  it("pop blasts, boost speeds up (twice), split makes three, slam dives heavy", () => {
    let { w } = fresh("popcorn");
    w.advance(0.5);
    const before = w.fortressBlocks().length + w.pigs().length;
    const at = primary(w);
    at.x = 1300;
    at.y = 700;
    assert.equal(w.ability(), true);
    assert.equal(w.birds().length, 0, "she's gone: she popped");
    w.advance(0.5);
    assert.ok(w.fortressBlocks().length + w.pigs().length <= before);
    assert.equal(w.ability(), false, "nothing left to do");

    ({ w } = fresh("zoomer"));
    w.advance(0.2);
    const b = primary(w);
    const v0 = Math.hypot(b.vx, b.vy);
    assert.equal(w.ability(), true);
    assert.ok(Math.hypot(b.vx, b.vy) > v0 * 1.3, "faster");
    assert.equal(w.ability(), true, "a second charge");
    assert.equal(w.ability(), false, "and no third");

    ({ w } = fresh("trio"));
    w.advance(0.2);
    w.ability();
    assert.equal(w.birds().length, 3, "Trey is three now");

    ({ w } = fresh("anvil"));
    w.advance(0.2);
    const c = primary(w);
    const m0 = c.mass;
    w.ability();
    assert.ok(c.vy > 1000 && c.mass > m0 * 2, "straight down, and heavy");
  });

  it("the drill goes through blocks, the magnet pulls them, the crow becomes a bunker, ricochet homes on a piggy", () => {
    let { w, log } = fresh("auger", 12, 1);
    for (let t = 0; t < 4 && w.birds().length; t += 0.05) w.advance(0.05);
    assert.ok(log.broke > 0, "drilled something");

    ({ w } = fresh("magpie"));
    const target = w.fortressBlocks().sort((a, b) => a.y - b.y)[0]!;
    const bird = primary(w);
    bird.x = target.x - 150;
    bird.y = target.y - 60;
    bird.vx = bird.vy = 0;
    const d0 = Math.hypot(bird.x - target.x, bird.y - target.y);
    w.ability();
    w.advance(0.4);
    assert.ok(Math.hypot(bird.x - target.x, bird.y - target.y) < d0 - 5, "the block came toward her");

    ({ w } = fresh("crow"));
    w.advance(0.2);
    const blocks = w.world.bodies.filter((b) => entityOf(b).kind === "block").length;
    w.ability();
    assert.equal(w.birds().length, 0);
    const bunker = w.world.bodies.filter((b) => entityOf(b).kind === "block");
    assert.equal(bunker.length, blocks + 1, "a bunker block appeared");
    assert.ok(bunker.some((b) => entityOf(b).team === "player"), "on the team's side of the ledger");

    ({ w } = fresh("boing"));
    w.advance(0.1);
    const r = primary(w);
    w.ability();
    const pig = w.pigs().sort((p, q) => Math.hypot(p.x - r.x, p.y - r.y) - Math.hypot(q.x - r.x, q.y - r.y))[0]!;
    const toPig = Math.atan2(pig.y - r.y, pig.x - r.x);
    assert.ok(Math.abs(Math.atan2(r.vy, r.vx) - toPig) < 0.01, "heading for the nearest piggy");
  });

  it("the gull steers while fuel lasts", () => {
    const { w } = fresh("gull", 30, 0.7);
    w.advance(0.2);
    const b = primary(w);
    const vx = b.vx;
    w.steer(-1);
    w.advance(0.5);
    assert.ok(b.vx < vx - 100, "steered back");
    const fuel = entityOf(b).bird!.fuel;
    assert.ok(fuel < 1.6 && fuel > 0);
    w.advance(2);
    assert.equal(entityOf(b).bird?.fuel ?? 0, 0, "out of fuel");
  });
});

describe("Angry Thud's Revenge: selection, turns and the action phase", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("everyone picks a bird and a skin, the game launches when all are ready, three birds each", () => {
    const { room, ids } = start();
    assert.equal(view(room).phase, "SELECT");
    room.gameInput(ids[0]!, "choose", { bird: "anvil", skin: "cast:madden" });
    expectError(() => room.gameInput(ids[0]!, "choose", { bird: "eagle" }), "INVALID_INPUT");
    expectError(() => room.gameInput(ids[0]!, "choose", { skin: "nope" }), "INVALID_INPUT");
    room.gameInput(ids[0]!, "ready", {});
    room.gameInput(ids[1]!, "ready", {});
    assert.equal(view(room).phase, "SELECT", "Cy isn't ready");
    room.gameInput(ids[2]!, "ready", {});
    assert.equal(view(room).phase, "LAUNCH");
    const me = view(room, ids[0]).you;
    assert.deepEqual([me.bird, me.skin, me.birds], ["anvil", "cast:madden", ["anvil", "anvil", "anvil"]]);
    room.hostGameAction("skip", {});
    assert.equal(view(room).phase, "BUILD");
    assert.equal(view(room).turn, 1);
  });

  it("a turn is one bird each, in order; a hesitant agent is skipped; then the piggies act and a new turn starts", () => {
    const { room, ids } = start();
    toBuild(room, ids);
    room.hostGameAction("skip", {});
    const g = view(room);
    assert.equal(g.phase, "ACTION");
    assert.deepEqual(g.action.queue, ids);
    expectError(() => room.gameInput(ids[1]!, "launch", { angle: 30, power: 1 }), "NOT_ALLOWED");
    shoot(room, ids[0]!);
    assert.equal(view(room, ids[0]).you.birds.length, 2, "the bird is used up");
    next(room);
    assert.equal(view(room).action.shooterId, ids[1]);
    mock.timers.tick(TIMING.aimMs + 10);
    assert.equal(view(room).action.shooterId, ids[2], "Bo hesitated and was skipped");
    assert.equal(view(room, ids[1]).you.birds.length, 3, "without losing a bird");
    shoot(room, ids[2]!, 45, 0.6);
    next(room);
    assert.equal(view(room).phase, "PROCESS");
    process(room);
    assert.equal(view(room).phase, "BUILD");
    assert.equal(view(room).turn, 2);
  });

  it("the team can vote to skip the build phase", () => {
    const { room, ids } = start(["Ann", "Bo", "Cy", "Dee"]);
    toBuild(room, ids);
    room.gameInput(ids[0]!, "vote_skip", { vote: true });
    room.gameInput(ids[1]!, "vote_skip", { vote: true });
    assert.equal(view(room).phase, "BUILD", "2 of 4 isn't a majority");
    assert.deepEqual([view(room).build.votes, view(room).build.needed], [2, 3]);
    room.gameInput(ids[2]!, "vote_skip", { vote: true });
    assert.equal(view(room).phase, "ACTION");
  });

  it("streams the shooter's aim, and only the shooter's; launches with the aim", () => {
    const { room, ids } = start();
    toBuild(room, ids);
    room.hostGameAction("skip", {});
    room.gameInput(ids[1]!, "stream", { a: 70, p: 0.2 });
    assert.equal(view(room).action.aim.a, 38, "not Bo's to aim");
    room.gameInput(ids[0]!, "stream", { a: 999, p: 0.5 });
    assert.deepEqual(view(room).action.aim, { a: SLINGSHOT.maxAngle, p: 0.5 }, "clamped");
    room.gameInput(ids[0]!, "stream", { a: "x" });
    room.gameInput(ids[0]!, "launch", {});
    assert.equal(view(room).action.stage, "FLIGHT");
    assert.ok(view(room).world.rows.some((r: View) => r[1] === "B"), "the bird is in the world");
    room.gameInput(ids[0]!, "ability", {});
    expectError(() => room.gameInput(ids[1]!, "ability", {}), "PHASE_CLOSED");
  });
});

describe("Angry Thud's Revenge: kernels and buildings", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("builds from one shared pool, only in the build phase, only in the zones, never on top of something", () => {
    const { room, ids } = start();
    toBuild(room, ids);
    const start0 = view(room).kernels.balance;
    assert.equal(start0, ECONOMY.startKernels);
    const [zoneStart] = LEVELS[0]!.zones[0]!;
    room.gameInput(ids[0]!, "build", { type: "wall", x: zoneStart + 30 });
    assert.equal(view(room).kernels.balance, start0 - BUILDINGS.wall.cost, "Bo sees the same pool drop");
    expectError(() => room.gameInput(ids[1]!, "build", { type: "wall", x: zoneStart + 30 }), "INVALID_ACTION");
    expectError(() => room.gameInput(ids[1]!, "build", { type: "wall", x: 1500 }), "INVALID_ACTION");
    expectError(() => room.gameInput(ids[1]!, "build", { type: "moat", x: 100 }), "INVALID_INPUT");
    room.gameInput(ids[1]!, "build", { type: "nest", x: 200 });
    expectError(() => room.gameInput(ids[2]!, "build", { type: "nest", x: 330 }), "INSUFFICIENT_KERNELS");
    assert.equal(view(room).build.structures.length, 2);
    room.hostGameAction("skip", {});
    expectError(() => room.gameInput(ids[2]!, "build", { type: "wall", x: 600 }), "PHASE_CLOSED");
    assert.equal(placement({ x: 1500, w: 20, h: 20 }, { zones: LEVELS[0]!.zones, groundY: WORLD.groundY, clear: () => true }).ok, false, "the shared rule agrees");
  });

  it("the wallet keeps the books and never goes negative", () => {
    const w = createWallet(10);
    assert.equal(w.spend(20, "x", "a"), false);
    w.earn(15, "y", "a");
    assert.equal(w.spend(20, "x", "b"), true);
    assert.deepEqual([w.balance, w.earned, w.spent, w.byPlayer("a").earned, w.byPlayer("b").spent], [5, 15, 20, 15, 20]);
  });

  it("nests hatch a bird every 1.5 turns for whoever has fewest; two agents at a nest breed an extra one", () => {
    const { room, ids } = start();
    toBuild(room, ids);
    room.gameInput(ids[0]!, "build", { type: "nest", x: 200 });
    const nest = view(room).build.structures[0].id;
    room.gameInput(ids[0]!, "breed", { nest });
    assert.deepEqual(view(room).build.structures[0].breeders, [ids[0]]);
    const before = view(room).kernels.balance;
    room.gameInput(ids[1]!, "breed", { nest });
    assert.equal(view(room).kernels.balance, before - ECONOMY.breed);
    const birds = () => ids.map((id) => view(room, id).you.birds.length);
    assert.equal(birds().reduce((a, b) => a + b, 0), 10, "one extra bird between them");
    expectError(() => room.gameInput(ids[2]!, "breed", { nest }), "INVALID_ACTION");
    const g = game(room);
    const total = () => birds().reduce((a, b) => a + b, 0);
    // Two turns of nest progress: 1/1.5 + 1/1.5 ≥ 1 → one bird.
    for (let t = 0; t < 2; t++) {
      g.phase = "PROCESS";
      g.steps = [{ id: "upkeep", label: "", detail: "", run: () => g.upkeepStep() }];
      g.stepIndex = 0;
      const n = total();
      g.upkeepStep();
      if (t === 0) assert.equal(total(), n, "not yet");
      else assert.equal(total(), n + 1, "hatched");
    }
  });

  it("a clone tank copies your selected bird once, then it's gone; a crate buys one", () => {
    const { room, ids } = start();
    toBuild(room, ids, ["anvil", "trio"]);
    room.gameInput(ids[0]!, "build", { type: "clone", x: 200 });
    const tank = view(room).build.structures[0].id;
    room.gameInput(ids[1]!, "clone", { tank });
    assert.deepEqual(view(room, ids[1]).you.birds, ["trio", "trio", "trio", "trio"]);
    assert.equal(view(room).build.structures.length, 0, "single use");
    expectError(() => room.gameInput(ids[0]!, "clone", { tank }), "INVALID_INPUT");
    room.gameInput(ids[0]!, "buy_bird", {});
    assert.equal(view(room, ids[0]).you.birds.length, 4);
  });

  it("donations keep an agent with no birds in the game, and the turn waits for one", () => {
    const { room, ids } = start(["Ann", "Bo"]);
    toBuild(room, ids, ["popcorn", "anvil"]);
    const g = game(room);
    g.players.get(ids[1]).birds = [];
    expectError(() => room.gameInput(ids[1]!, "donate", { to: ids[0] }), "INVALID_ACTION");
    room.hostGameAction("skip", {});
    shoot(room, ids[0]!, 40, 0.5);
    next(room);
    assert.deepEqual([view(room).action.shooterId, view(room).action.stage], [ids[1], "NEED_BIRD"], "Bo needs a bird: the turn waits");
    assert.ok(view(room).log.at(-1).text.includes("NEEDS A BIRD"));
    room.gameInput(ids[0]!, "donate", { to: ids[1], index: 0 });
    assert.deepEqual(view(room, ids[1]).you.birds, ["popcorn"], "the donated bird is Ann's type");
    assert.equal(view(room, ids[0]).you.birds.length, 1, "Ann has one left");
    assert.equal(view(room).action.stage, "AIM", "Bo gets to shoot");
    assert.ok(view(room).log.at(-1).text.includes("DONATION"));
  });
});

describe("Angry Thud's Revenge: corruption, the Red Cow, weather", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("corruption starts at 100 and drops with each piggy by its value (scaled for team size); 0 wins", () => {
    const { room, ids } = start(["Ann", "Bo"]);
    toBuild(room, ids);
    assert.equal(view(room).corruption, CORRUPTION.start);
    const g = game(room);
    const scale = Math.min(CORRUPTION.playerScale.max, CORRUPTION.playerScale.reference / 2);
    g.onKilled("basic", { kind: "shot", playerId: ids[0], shotId: 1 }, false, { x: 0, y: 0 });
    g.changed();
    assert.equal(view(room).corruption, Math.round((100 - PIGS.basic.corruption * scale) * 10) / 10);
    assert.ok(view(room).kernels.balance > ECONOMY.startKernels, "kernels for the kill");
    g.onKilled("boss", { kind: "weather", type: "tornado" }, false, { x: 0, y: 0 });
    g.changed();
    assert.equal(view(room).kernels.balance, ECONOMY.startKernels + PIGS.basic.kernels, "no kernels for the weather's kills");
    room.hostGameAction("skip", {});
    g.corruption = 1;
    g.onKilled("basic", { kind: "shot", playerId: ids[0], shotId: 2 }, false, { x: 0, y: 0 });
    assert.equal(g.result, "victory");
    shoot(room, ids[0]!, 40, 0.3);
    assert.equal(view(room).phase, "OVER");
    assert.equal(view(room).over.result, "victory");
    mock.timers.tick(TIMING.overMs + 10);
    assert.equal(room.status, "FINAL_RESULTS");
  });

  it("piggy repairs put corruption back for what they rebuild", () => {
    const { room, ids } = start(["Ann", "Bo"]);
    toBuild(room, ids);
    const g = game(room);
    const block = g.world.fortressBlocks()[0];
    const m = entityOf(block).material as keyof typeof MATERIALS;
    g.onBroke(entityOf(block), { kind: "shot", playerId: ids[0], shotId: 1 }, false, { x: 0, y: 0 });
    g.world.world.remove(block);
    g.structural = entityOf(block).maxHp;
    const low = g.corruption;
    g.steps = [{ id: "repair", label: "", detail: "", run: () => {} }];
    g.stepIndex = 0;
    g.repairStep();
    assert.ok(g.corruption > low, `rebuilt: corruption back up (${m})`);
  });

  it("the Red Cow advances every two turns with a short cutscene, and 100% loses", () => {
    const { room, ids } = start(["Ann", "Bo"]);
    toBuild(room, ids);
    const cycle = () => {
      room.hostGameAction("skip", {}); // build → action
      for (let i = 0; i < 6 && view(room).phase === "ACTION"; i++) {
        if (view(room).action.stage === "AIM") mock.timers.tick(TIMING.aimMs + 10);
        else room.hostGameAction("skip", {});
      }
      process(room);
    };
    cycle();
    assert.deepEqual([view(room).phase, view(room).cow.progress], ["BUILD", 0], "turn 1: nothing yet");
    cycle();
    assert.equal(view(room).phase, "COW");
    assert.deepEqual(view(room).cow.scene, { from: 0, to: 0.2 });
    assert.equal(room.viewFor({ kind: "host" }).timer!.totalMs, TIMING.cowMs, "a few seconds, no more");
    room.hostGameAction("skip", {});
    assert.equal(view(room).phase, "BUILD");
    const g = game(room);
    g.cow = 0.8;
    g.turnsDone = 3;
    cycle();
    assert.equal(view(room).phase, "COW");
    room.hostGameAction("skip", {});
    assert.equal(view(room).phase, "OVER");
    assert.equal(view(room).over.result, "defeat");
  });

  it("draws the same weather for the same seed; forecasts get better with each tier", () => {
    let s = 0;
    const draw = (seed: number) => drawSchedule({ random: seededRandom(seed), types: WEATHER, pool: { wind: 2, tornado: 1, fog: 1, acid_rain: 1 }, chance: 0.6, firstTurn: 2, horizon: 20, severityWeights: [0.5, 0.35, 0.15], severityRamp: 0.03, secondaryChance: 0.3 });
    assert.deepEqual(draw(9), draw(9));
    const schedule = draw(9);
    assert.ok(schedule.length > 3 && schedule.every((e) => e.turn >= 2 && e.severity >= 1 && e.severity <= 3));
    const ctx = { seed: 5, types: WEATHER, pool: { wind: 2, tornado: 1, fog: 1, acid_rain: 1 } };
    const [t1, t2, t3, t4] = WEATHER_TIERS.map((tier) => forecast(schedule, 1, tier, ctx));
    assert.ok(t1![0]!.category && !t1![0]!.type && t1![0]!.turnRange && t1![0]!.severity === null, "radio: a category and rough timing");
    assert.ok(t2![0]!.type && t2![0]!.estTurn && t2![0]!.severity, "scanner: type, estimated turn, severity");
    assert.ok(t3![0]!.turn === schedule[0]!.turn && "secondary" in t3![0]!, "array: exact turn, secondary");
    assert.equal(t4!.length, WEATHER_TIERS[3]!.window, "the management system lists turns");
    // Over many events, better tiers are right more often.
    const right = (tierIndex: number) => {
      let ok = 0;
      for (let seed = 0; seed < 200; seed++) {
        const e = { turn: 3, type: "tornado", severity: 2, secondary: null };
        const line = forecast([e], 1, WEATHER_TIERS[tierIndex]!, { ...ctx, seed })[0]!;
        ok += (line.type ?? line.category) === (tierIndex === 0 ? "WIND" : "tornado") ? 1 : 0;
      }
      return ok / 200;
    };
    const r1 = right(0);
    const r3 = right(2);
    assert.ok(r1 > 0.4 && r1 < 0.7 && r3 > 0.85, `accuracy tracks the tier (${r1}, ${r3})`);
    void s;
  });

  it("a weather machine shows a forecast, upgrades, breaks under lightning and can be repaired", () => {
    const { room, ids } = start(["Ann", "Bo"], "station");
    toBuild(room, ids);
    assert.equal(view(room).forecast, null, "no machine, no forecast");
    room.gameInput(ids[0]!, "build", { type: "weather", x: 300 });
    let f = view(room).forecast;
    assert.equal(f.tier, 1);
    assert.equal(f.status, "OK");
    assert.ok(f.lines.length >= 1 && f.lines[0].category);
    game(room).wallet.earn(500, "test", null);
    room.gameInput(ids[1]!, "upgrade_weather", {});
    room.gameInput(ids[1]!, "upgrade_weather", {});
    room.gameInput(ids[1]!, "upgrade_weather", {});
    f = view(room).forecast;
    assert.equal(f.tier, 4);
    assert.equal(f.lines.length, 3, "a window of turns");
    expectError(() => room.gameInput(ids[1]!, "upgrade_weather", {}), "INVALID_ACTION");
    const g = game(room);
    const body = g.machineBody();
    g.world.cause = { kind: "weather", type: "lightning_storm" };
    g.world.bolt(body, 9999);
    g.changed();
    f = view(room).forecast;
    assert.equal(f.status, "BROKEN", "broken, still standing");
    assert.deepEqual(f.lines, []);
    assert.ok(f.repair > 0);
    room.gameInput(ids[0]!, "repair_weather", {});
    assert.equal(view(room).forecast.status, "OK");
  });

  it("weather strikes: acid rain eats exposed buildings, lightning knocks one offline, floods raise water, wind blows in the action phase", () => {
    const { room, ids } = start(["Ann", "Bo"]);
    toBuild(room, ids);
    room.gameInput(ids[0]!, "build", { type: "nest", x: 200 });
    const g = game(room);
    const nest = g.world.buildings()[0];
    const hp = entityOf(nest).hp;
    g.steps = [{ id: "weather", label: "", detail: "" }];
    g.stepIndex = 0;
    g.weatherStep({ turn: 1, type: "acid_rain", severity: 3, secondary: null });
    assert.equal(entityOf(nest).hp, hp - WEATHER.acid_rain.strike.damage[2]!);
    const bolts = g.world.recentFx().filter((f: View) => f.t === "bolt").length;
    g.weatherStep({ turn: 1, type: "lightning_storm", severity: 1, secondary: null });
    assert.equal(g.world.recentFx().filter((f: View) => f.t === "bolt").length, bolts + WEATHER.lightning_storm.strike.bolts[0]!, "every bolt struck something");
    assert.ok(g.steps[0].detail.length > 0, "and the step says what");
    g.weatherStep({ turn: 1, type: "flood", severity: 2, secondary: null });
    assert.equal(g.world.world.waterLevel, WORLD.groundY - WEATHER.flood.strike.level[1]!);
    g.weatherStep({ turn: 1, type: "earthquake", severity: 1, secondary: null });
    assert.ok(g.world.busy(), "the ground is moving");
    g.schedule.unshift({ turn: 1, type: "strong_wind", severity: 2, secondary: null });
    room.hostGameAction("skip", {});
    assert.equal(Math.abs(view(room).world.wind), WEATHER.strong_wind.action.wind[1]);
    assert.equal(view(room).weather.label, "Strong Wind");
  });
});

describe("Angry Thud's Revenge: scoring, awards, the end", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] }));
  afterEach(() => mock.timers.reset());

  it("scores destruction to the shooter (not to the meter), and ends with factual awards and a record", () => {
    const { room, ids, records } = start(["Ann", "Bo"]);
    toBuild(room, ids, ["anvil", "popcorn"]);
    room.hostGameAction("skip", {});
    shoot(room, ids[0]!, 30, 0.95);
    const g = game(room);
    const ann = g.players.get(ids[0]);
    assert.ok(ann.stats.shots === 1);
    assert.ok(room.viewFor({ kind: "host" }).players.find((p) => p.id === ids[0])!.score > 0 || ann.stats.blocks + ann.stats.pigs === 0);
    g.result = "defeat";
    g.gameOver();
    const over = view(room).over;
    assert.equal(over.result, "defeat");
    assert.ok(over.players.every((p: View) => "destruction" in p && "birdsUsed" in p && "kernelsSpent" in p));
    assert.ok(over.awards.some((a: View) => a.title === "MOST QUESTIONABLE TRAJECTORY"), "every game has a trajectory to judge");
    room.hostGameAction("skip", {});
    assert.equal(room.status, "FINAL_RESULTS");
    assert.equal(records.at(-1)!.gameId, "thud");
  });

  it("rates a loopy, bouncy shot as more questionable than a straight one", () => {
    const straight = { id: 1, playerId: "a", bird: "x", power: 0.9, angle: 38, path: 1300, maxX: 1700, apex: 400, bounces: 0, reversals: 0, abilityUsed: false, abilityHit: false, kills: 1, broke: 0, damage: 0, flightMs: 3000, firstKillDistance: 0 };
    assert.ok(trajectoryScore({ ...straight, path: 3000, bounces: 4, reversals: 2 }) > trajectoryScore(straight));
  });

  it("publishes its levels for the lobby and parses settings safely", () => {
    assert.deepEqual((thudGame.catalog as { levels: { id: string }[] }).levels.map((l) => l.id), LEVELS.map((l) => l.id));
    assert.equal(thudGame.parseSettings({ level: "thudplex" }).level, "thudplex");
    assert.equal(thudGame.parseSettings({ level: "../etc" }).level, LEVELS[0]!.id);
    assert.equal(thudGame.parseSettings(null).level, LEVELS[0]!.id);
  });

  it("aims from a pull-back and previews the start of the arc", () => {
    const { angle, power } = aimFromPull(-100, 100);
    assert.deepEqual([angle, power], [45, 0.88]);
    const pts = arc({ x: 0, y: 0, maxSpeed: 1000, gravity: 800 }, 45, 1, { seconds: 0.5, dt: 0.25 });
    assert.equal(pts.length, 2);
    assert.ok(pts[0]![0] > 0 && pts[0]![1] < 0, "up and forward");
  });
});

describe("Angry Thud's Revenge over Socket.IO", () => {
  it("streams the aim live, flies the bird on the server, and a reconnect finds the same game", async () => {
    const db = new PartyDb(":memory:");
    const server = createPartyServer({ db, auth: createAuthVerifier({ mode: "dev" }), authConfig: { mode: "dev" }, canon: stubCanon() });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
    const sockets: Socket[] = [];
    const latest = new Map<Socket, View>();
    const open = async () => {
      const s = connect(url, { transports: ["websocket"], forceNew: true, reconnection: false });
      sockets.push(s);
      s.on("state", (st) => latest.set(s, st));
      await new Promise<void>((resolve) => s.once("connect", () => resolve()));
      return s;
    };
    const ask = (s: Socket, event: string, payload: object = {}) => s.timeout(5000).emitWithAck(event, payload);
    const wait = async (test: () => boolean, label: string, tries = 250) => {
      for (let i = 0; i < tries && !test(); i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(test(), label);
    };
    try {
      const host = await open();
      const { code } = await ask(host, "host:create");
      const players: { s: Socket; id: string; token: string }[] = [];
      for (const name of ["Ann", "Bo"]) {
        const s = await open();
        const joined = await ask(s, "player:join", { code, name });
        players.push({ s, id: joined.playerId, token: joined.token });
      }
      const [ann, bo] = players as [(typeof players)[0], (typeof players)[0]];
      assert.equal((await ask(host, "room:configure", { gameId: "thud", settings: { level: "site" } })).ok, true);
      assert.equal((await ask(host, "room:start")).ok, true);
      for (const p of players) assert.equal((await ask(p.s, "game:input", { action: "ready", payload: {} })).ok, true);
      assert.equal((await ask(host, "game:host", { action: "skip" })).ok, true); // launch → build
      await wait(() => latest.get(host)?.game?.phase === "BUILD", "build phase");
      assert.equal((await ask(ann.s, "game:input", { action: "build", payload: { type: "wall", x: 620 } })).ok, true);
      assert.equal((await ask(host, "game:host", { action: "skip" })).ok, true); // build → action
      await wait(() => latest.get(host)?.game?.action?.stage === "AIM", "aiming");
      for (let i = 0; i < 10; i++) {
        ann.s.emit("game:stream", { a: 30 + i, p: 0.9 });
        await new Promise((r) => setTimeout(r, 30));
      }
      await wait(() => latest.get(bo.s)?.game?.action?.aim?.a === 39, "Bo's phone sees Ann's aim");
      assert.equal((await ask(ann.s, "game:input", { action: "launch", payload: { angle: 39, power: 0.9 } })).ok, true);
      await wait(() => latest.get(host)?.game?.action?.stage === "FLIGHT", "in flight");
      const birdX = () => latest.get(host)?.game?.world.rows.find((r: View) => r[1] === "B")?.[3];
      const x0 = birdX();
      await wait(() => (birdX() ?? 0) > x0 + 200 || latest.get(host)?.game?.action?.stage !== "FLIGHT", "the bird flies across the host screen");

      // Bo drops out mid-flight and comes back on a new socket: same seat, same birds, same world.
      bo.s.close();
      const fresh = await open();
      assert.equal((await ask(fresh, "player:resume", { code, token: bo.token })).ok, true);
      await wait(() => latest.get(fresh)?.game?.you?.birds?.length === 3, "Bo's birds are still his");
      await wait(() => latest.get(host)?.game?.action?.shooterId === bo.id || latest.get(host)?.game?.phase !== "ACTION", "the turn moves on", 900);
      assert.equal(latest.get(fresh).game.level.id, "site");
      assert.equal(latest.get(fresh).game.build.structures.length, latest.get(host).game.build.structures.length, "the wall is in his world too");
    } finally {
      for (const s of sockets) s.close();
      server.close();
    }
  });
});
