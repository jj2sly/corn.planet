// A scripted player plays Level 1, The Block World, start to finish through the real game: a room,
// the game's own 20 Hz tick and physics, buttons streamed like a phone streams them. Each leg (the
// village fragment, the cave fragment, the corrupted fragment, the rift) is planned with the
// reachability search's real physics (steamdeck-reach.ts), then played tick by tick. Then ▼ in the
// rift, the collapse, the results, and on into the next game. A second runner stays at the spawn
// the whole time, so the fragments are shared and the collapse leaves someone behind.
//
//   node --test scripts/steamdeck-playthrough.ts

import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { TIMING } from "../server/games/steamdeck/game.ts";
import { LEVELS } from "../server/games/steamdeck/levels.ts";
import { PHYS, type Body } from "../server/games/steamdeck/physics.ts";
import { makeRooms, roomWithPlayers } from "../test/helpers.ts";
import { planRoute, type TickInput } from "./steamdeck-reach.ts";

const LEVEL = LEVELS.find((l) => l.id === "blockworld")!;
const overlaps = (b: Body, [x, y, w, h]: readonly number[]) => b.x < x! + w! && b.x + PHYS.width > x! && b.y < y! + h! && b.y + PHYS.height > y!;
const touchesItem = (i: number) => (b: Body) => overlaps(b, [LEVEL.items![i]!.at[0] - 20, LEVEL.items![i]!.at[1] - 20, 40, 40]);

it("plays The Block World: 3 fragments, the rift, the collapse, and on to the next game", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  try {
    const { manager } = makeRooms();
    const { room, players } = roomWithPlayers(manager, ["Thad", "Ann", "Bo"]);
    room.configure({ gameId: "steamdeck", settings: { rounds: 2 } });
    room.startGame();
    const view = () => room.viewFor({ kind: "host" }).game as any;
    while (view().phase !== "ESCAPE") room.hostGameAction("skip", {});
    const game = (room as any).game;
    assert.equal(game.level.id, "blockworld", "Level 1 opens the match");
    const annId = players[1]!.id;
    const ann = game.runners.get(annId);
    let j = 0;
    let u = 0;
    let clock = 0;
    const press = (input: TickInput) => {
      if (input.jump) j += 1;
      room.gameInput(annId, "stream", { l: input.dir < 0 ? 1 : 0, r: input.dir > 0 ? 1 : 0, j, u });
      mock.timers.tick(TIMING.tickMs);
      clock += TIMING.tickMs;
    };
    for (let t = 0; t < 20; t++) press({ dir: 0, jump: false });
    j = ann.body.lastJumpSeq;

    const legs: [string, (b: Body) => boolean][] = [
      ["the village fragment (top of the watchtower)", touchesItem(0)],
      ["the cave fragment (bottom of the lake)", touchesItem(1)],
      ["the corrupted fragment (the highest chunk)", touchesItem(2)],
      ["the rift", (b) => overlaps(b, LEVEL.exit) && b.grounded],
    ];
    for (const [name, goal] of legs) {
      const started = clock;
      const plan = planRoute(LEVEL, "FINAL", ann.stats, { ...ann.body }, goal);
      assert.ok(plan, `a way to ${name}`);
      for (const input of plan.inputs) press(input);
      assert.ok(Math.abs(ann.body.x - plan.end.x) < 0.01 && Math.abs(ann.body.y - plan.end.y) < 0.01, `the game played it exactly (${name})`);
      assert.equal(ann.body.deadFor, 0, `alive at ${name}`);
      console.log(`  ${name}: ${((clock - started) / 1000).toFixed(1)} s (${view().phase}) · fragments ${view().world.taken.join("")} · rift ${view().world.exit}`);
    }
    assert.deepEqual(view().world.taken, [1, 1, 1], "3 / 3");
    assert.equal(view().world.exit, "active", "EXIT ACTIVATED");
    assert.equal(view().world.runners.find((r: any) => r[0] === annId)[4], 0, "standing in the rift isn't escaping");

    // ▼ in the rift.
    u += 1;
    press({ dir: 0, jump: false });
    assert.equal(view().world.exit, "collapse", "the collapse");
    assert.equal(view().world.completedBy, annId);
    assert.equal(view().world.runners.find((r: any) => r[0] === annId)[4], 2, "Ann went in");
    console.log(`  used the rift at ${(clock / 1000).toFixed(1)} s of play`);

    // Bo never left the spawn: the collapse runs out with him inside, and the round is over.
    mock.timers.tick(LEVEL.exitUse!.collapseMs);
    const results = view();
    assert.equal(results.phase, "RESULTS");
    assert.equal(results.results.completedBy, annId, "LEVEL COMPLETE");
    assert.equal(results.results.escaped, 1);
    console.log(`  results: level complete by Ann; points ${JSON.stringify(results.results.points)}`);

    // Back into the game's own flow: the next game on the Deck.
    room.hostGameAction("skip", {});
    assert.equal(view().round, 2);
    assert.equal(view().phase, "ASSIGNMENT");
    assert.notEqual(view().level.id, "blockworld");
    console.log(`  round 2: ${view().level.name}`);
  } finally {
    mock.timers.reset();
  }
});
