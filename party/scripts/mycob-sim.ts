// Balance simulator for My Cob Escaped. Plays many games with scripted agents and prints how
// incidents end, how often lives are lost, how chaos moves, and whether careful, normal and
// reckless play all stay viable. Run it after changing server/games/mycob/config.ts:
//
//   node scripts/mycob-sim.ts [games=200]
//
// Offline and in memory: fixture canon, no network, nothing saved.

import type { CanonRecord } from "../server/canon.ts";
import { createMyCobGame } from "../server/games/mycob/game.ts";
import type { GameDefinition } from "../server/games/types.ts";
import { makeRooms, roomWithPlayers, seededRandom, stubCanon } from "../test/helpers.ts";

const GAMES = Number(process.argv[2] ?? 200);
const TAGS = ["CONTAIN", "EVACUATE", "INVESTIGATE", "COMMUNICATE", "DEPLOY", "EQUIPMENT", "STRATEGIZE", "OTHER"];
const TEXTS = [
  "Seal the doors and lure it with creamed corn",
  "Evacuate everyone from the tunnels, then call for backup",
  "Check the file for weaknesses",
  "Restart the power generator",
  "I throw a chair at it",
  "Get on the radio and coordinate the teams",
  "Deploy security to the cafeteria",
  "Shoot it with everything we have and kill it",
];
const STYLES = ["careful", "standard", "reckless"] as const;

const entity = (ref: string, classification: string, containment: string, procedures: string): CanonRecord => ({
  ref,
  kind: "entity",
  title: `Entity ${ref}`,
  fields: { classification, containment, containmentProcedures: procedures, description: "Something." },
  links: {},
  url: "https://example.test",
});
const CANON = [
  entity("CPE-001", "COSMIC", "MAXIMUM", "Do not make eye contact."),
  entity("CPE-002", "EARTHLY", "STANDARD", "Give him steam deck."),
  entity("CPE-003", "LOCAL", "MINIMAL", "Leave the gate open."),
  entity("CPE-004", "LOCAL", "ENHANCED", "Do not water."),
  entity("CPE-005", "NEUTRALIZED", "TERMINATION", "Burn it. Then burn the ashes."),
  entity("CPE-006", "CONSTRICTED", "ENHANCED", "Keep it in a box."),
];

type Data = {
  ending: { id: string };
  stagesPlayed: number;
  incident: { entity: { classification: string }; initiallyUnknown: boolean; identifiedAtStage: number | null };
  players: { downs: number }[];
  stages: { lifeLosses: unknown[]; statsAfter: { chaos: number }; responses: { roll: { outcome: string } }[] }[];
  scores: { totals: Record<string, Record<string, number>> };
};

const endings: Record<string, number> = {};
const outcomes: Record<string, number> = {};
const placements: Record<string, number[]> = { careful: [], standard: [], reckless: [] };
const chaos: number[][] = [];
const byClass: Record<string, { n: number; good: number }> = {};
const components: Record<string, number> = {};
let playerStages = 0;
let lifeLosses = 0;
let downs = 0;
let unknown = 0;
let identified = 0;
let agents = 0;

for (let game = 1; game <= GAMES; game++) {
  const random = seededRandom(game * 7919);
  const rooms = makeRooms({ games: new Map([["mycob", createMyCobGame() as GameDefinition]]), canon: stubCanon(CANON), random });
  const names = ["Ann", "Bo", "Cy", "Di", "Ed", "Flo"].slice(0, 3 + (game % 4));
  const { room, players } = roomWithPlayers(rooms.manager, names);
  room.configure({ gameId: "mycob" });
  room.startGame();
  const view = (id?: string) => room.viewFor(id ? { kind: "player", playerId: id } : { kind: "host" }).game as any;

  for (let guard = 0; guard < 400 && room.status === "IN_GAME"; guard++) {
    const g = view();
    if (g.phase === "RESPONSE") {
      for (const [i, p] of players.entries()) {
        if (view()?.phase !== "RESPONSE" || random() < 0.08) continue;
        const style = STYLES[i % 3]!;
        const role = view(p.id).you.role;
        const r = random();
        const tag = r < 0.45 ? role.strongTags[Math.floor(random() * role.strongTags.length)] : r < 0.65 ? "CONTAIN" : TAGS[Math.floor(random() * TAGS.length)];
        room.gameInput(p.id, "respond", { tag, text: TEXTS[Math.floor(random() * TEXTS.length)], approach: style, sacrifice: random() < 0.05 });
      }
    } else if (g.phase === "STAGE_VOTE") {
      for (const p of players) {
        const v = view(p.id);
        if (v?.phase === "STAGE_VOTE" && v.you.canVote && !v.you.yourVote) room.gameInput(p.id, "vote", { playerId: v.vote.candidates[Math.floor(random() * v.vote.candidates.length)].playerId });
      }
    }
    if (room.status === "IN_GAME" && view().phase === g.phase && view().stage === g.stage) room.hostGameAction("skip", {});
  }

  const data = rooms.db.listGameDetails("mycob.v1")[0]!.data as Data;
  endings[data.ending.id] = (endings[data.ending.id] ?? 0) + 1;
  const cls = data.incident.entity.classification;
  byClass[cls] ??= { n: 0, good: 0 };
  byClass[cls].n++;
  if (data.ending.id === "contained" || data.ending.id === "terminated") byClass[cls].good++;
  if (data.incident.initiallyUnknown) {
    unknown++;
    if (data.incident.identifiedAtStage) identified++;
  }
  for (const s of data.stages) {
    playerStages += data.players.length;
    lifeLosses += s.lifeLosses.length;
    (chaos[data.stages.indexOf(s)] ??= []).push(s.statsAfter.chaos);
    for (const r of s.responses) outcomes[r.roll.outcome] = (outcomes[r.roll.outcome] ?? 0) + 1;
  }
  for (const p of data.players) downs += p.downs;
  for (const t of Object.values(data.scores.totals)) for (const [k, n] of Object.entries(t)) components[k] = (components[k] ?? 0) + n;
  agents += players.length;
  players.forEach((p, i) => placements[STYLES[i % 3]!]!.push(room.results!.standings.find((s) => s.playerId === p.id)!.placement));
}

const pct = (n: number, of: number) => `${Math.round((100 * n) / of)}%`;
const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
const totalOutcomes = Object.values(outcomes).reduce((a, b) => a + b, 0);

console.log(`My Cob Escaped — ${GAMES} simulated games\n`);
console.log("Endings           ", Object.entries(endings).map(([k, n]) => `${k} ${pct(n, GAMES)}`).join(" · "));
console.log("Outcomes          ", Object.entries(outcomes).map(([k, n]) => `${k} ${pct(n, totalOutcomes)}`).join(" · "));
console.log("Lives lost        ", `${(lifeLosses / playerStages).toFixed(3)} per agent per stage · ${(downs / GAMES).toFixed(2)} agents down per game`);
console.log("Unknown entities  ", `${unknown} (${pct(unknown, GAMES)}), identified in ${pct(identified, unknown || 1)}`);
console.log("Chaos by stage    ", chaos.map((c) => Math.round(Number(mean(c)))).join(" → "));
console.log("Good ending by class", Object.entries(byClass).map(([k, v]) => `${k} ${pct(v.good, v.n)} (n=${v.n})`).join(" · "));
console.log("Avg placement     ", Object.entries(placements).map(([k, v]) => `${k} ${mean(v)}`).join(" · "), "(lower is better; should be close)");
console.log("Avg points/agent  ", Object.entries(components).map(([k, n]) => `${k} ${Math.round(n / agents)}`).join(" · "));
