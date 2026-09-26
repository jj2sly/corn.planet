// Balance simulator for Angry Thud's Revenge. Plays whole games on every level with scripted agents
// who fire roughly sensible, un-aimed shots (20–50°, 75–100% power) and buy a crate when they run
// dry, then prints how each game ended: result, turns, final corruption, Red Cow. Bots can't aim, so
// read it as *relative* difficulty between levels, and as a check that a change didn't make idle
// or random play win. Run it after changing server/games/thud/config.ts or levels.ts:
//
//   node scripts/thud-sim.ts [games per level = 4] [agents = 3]
//
// Offline and in memory: fake timers, no network, nothing saved.

import { mock } from "node:test";
import { TIMING } from "../server/games/thud/config.ts";
import { LEVELS } from "../server/games/thud/levels.ts";
import { makeRooms, roomWithPlayers, seededRandom } from "../test/helpers.ts";

const GAMES = Number(process.argv[2] ?? 4);
const AGENTS = Math.max(2, Math.min(8, Number(process.argv[3] ?? 3)));
const BIRDS = ["anvil", "popcorn", "trio", "zoomer", "auger", "boing", "magpie", "crow"];

mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
for (const level of LEVELS) {
  const results: string[] = [];
  let wins = 0;
  for (let n = 0; n < GAMES; n++) {
    const seed = 11 + n;
    const rooms = makeRooms({ random: seededRandom(seed) });
    const { room, players } = roomWithPlayers(rooms.manager, Array.from({ length: AGENTS }, (_, i) => `Bot${i + 1}`));
    room.configure({ gameId: "thud", settings: { level: level.id } });
    room.startGame();
    players.forEach((p, i) => {
      room.gameInput(p.id, "choose", { bird: BIRDS[i % BIRDS.length] });
      room.gameInput(p.id, "ready", {});
    });
    const g = (room as any).game;
    const aim = seededRandom(seed * 7);
    for (let i = 0; i < 50_000 && g.phase !== "OVER"; i++) {
      if (g.phase === "BUILD") {
        for (const p of players) if (g.players.get(p.id).birds.length === 0 && g.wallet.balance >= 30) room.gameInput(p.id, "buy_bird", {});
        room.hostGameAction("skip", {});
      } else if (g.phase === "ACTION" && g.stage === "AIM") room.gameInput(g.queue[g.qIndex], "launch", { angle: 20 + aim() * 30, power: 0.75 + aim() * 0.25 });
      else if ((g.phase === "ACTION" && g.stage === "FLIGHT") || g.phase === "PROCESS") mock.timers.tick(TIMING.tickMs);
      else room.hostGameAction("skip", {});
    }
    if (g.result === "victory") wins += 1;
    results.push(`${g.result === "victory" ? "WIN " : "loss"} t${g.turnsDone} c${Math.round(g.corruption)}% cow${Math.round(g.cow * 100)}%`);
    room.close("SIM_DONE");
  }
  console.log(`${level.name.padEnd(22)} ${wins}/${GAMES} won · ${results.join(" | ")}`);
}
mock.timers.reset();
