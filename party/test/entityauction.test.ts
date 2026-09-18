import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { io as connect, type Socket } from "socket.io-client";
import { createPartyServer, type PartyServer } from "../server/app.ts";
import { createAuthVerifier } from "../server/auth.ts";
import type { CanonRecord } from "../server/canon.ts";
import { PartyDb } from "../server/db.ts";
import { PartyError } from "../server/errors.ts";
import {
  revealModifiers,
  runEvent,
  SEED_EFFECTS,
  validateEffect,
  type EffectDef,
  type Economy,
  type Holding,
} from "../server/games/auctioneffects.ts";
import { DEFAULT_ENTITY_AUCTION_RULES as RULES, entityAuctionGame } from "../server/games/entityauction.ts";
import type { Room } from "../server/rooms.ts";
import { makeRooms, roomWithPlayers, stubCanon, TEST_CANON } from "./helpers.ts";

// ------------------------------------------------------------------ fixtures

const CLASSES = ["COSMIC", "EARTHLY", "LOCAL", "ANOMALOUS"];

/** `n` entities with distinctive titles, so a leak is easy to spot in a serialized view. */
function auctionCanon(n: number): CanonRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const ref = `CPE-${String(100 + i)}`;
    return {
      ref,
      kind: "entity" as const,
      title: `Specimen ${ref}`,
      fields: { classification: CLASSES[i % CLASSES.length]!, description: `Sealed-dossier-${ref}` },
      links: {},
      url: `https://example.test/${ref}`,
    };
  });
}

interface Bid {
  name: string;
  amount: number;
}
interface HoldingView {
  ref: string;
  title: string;
  classification: string;
  bayNumber: number | null;
  winningBid: number;
  baseValue: number;
  value: number;
  active: boolean;
  modifier: { name: string; polarity: string; description: string } | null;
}
interface AgentView {
  playerId: string;
  name: string;
  left: boolean;
  kernels: number;
  slotsLeft: number;
  collection: HoldingView[];
  entityValue: number;
  netWorth: number;
}
interface BayView {
  bayId: string;
  number: number;
  status: string;
  entity: { ref: string; title: string; classification: string; baseValue: number; summary: string; url: string } | null;
  ownerId: string | null;
  ownerName: string | null;
  winningBid: number | null;
  byLottery: boolean;
}
interface AuctionView {
  phase: string;
  rules: { startingKernels: number; entitiesPerPlayer: number; minimumRaise: number; eventCount: number };
  lot: { number: number; total: number };
  bays: BayView[];
  active: (BayView & { currentBid: number | null; highestBidder: string | null; highestBidderId: string | null; recentBids: Bid[]; minimumBid: number }) | null;
  agents: AgentView[];
  event: { number: number; total: number; id: string; name: string; description: string; outcomes: { text: string; playerName: string | null }[] } | null;
  audit: { text: string }[] | null;
  standings: AgentView[] | null;
  you?: (AgentView & { canBid: boolean; isHighest: boolean }) | null;
}

function view(room: Room, playerId?: string): AuctionView {
  return room.viewFor(playerId ? { kind: "player", playerId } : { kind: "host" }).game as AuctionView;
}

function expectError(fn: () => unknown, code: string) {
  assert.throws(fn, (err: unknown) => err instanceof PartyError && err.code === code, `expected ${code}`);
}

const T = RULES.timing;
const NAMES = ["Ann", "Bo", "Cy"];

function setup(names = NAMES, canon = auctionCanon(30)) {
  const rooms = makeRooms({ canon: stubCanon(canon) });
  const { room, players } = roomWithPlayers(rooms.manager, names);
  room.configure({ gameId: "entityauction" });
  return { ...rooms, room, ids: players.map((p) => p.id) };
}

function startGame(names = NAMES, settings: object = {}, canon = auctionCanon(30)) {
  const s = setup(names, canon);
  s.room.configure({ settings });
  s.room.startGame();
  return s;
}

/** BRIEFING -> first BIDDING. */
const openBidding = () => mock.timers.tick(T.briefingMs);
const bid = (room: Room, playerId: string, amount: unknown) => room.gameInput(playerId, "bid", { amount });
/** BIDDING -> OPENING -> REVEALED -> next lot (or the Action Round). */
function finishLot(room: Room) {
  mock.timers.tick(RULES.auction.auctionDurationMs);
  mock.timers.tick(T.openingMs);
  mock.timers.tick(T.revealedMs);
}
/** Runs every remaining lot with nobody bidding, so bays are handed out free. */
function finishAuction(room: Room) {
  while (view(room).phase === "BIDDING") finishLot(room);
}
/** Skips the host through every remaining phase to the final debrief. */
function skipToEnd(room: Room) {
  for (let i = 0; i < 200 && room.status === "IN_GAME"; i++) room.hostGameAction("skip", undefined);
}

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
afterEach(() => mock.timers.reset());

// ------------------------------------------------------------------ setup

describe("Entity Auction: setup", () => {
  it("is registered for 3–8 agents with the centralized default rules", () => {
    assert.equal(entityAuctionGame.minPlayers, 3);
    assert.equal(entityAuctionGame.maxPlayers, 8);
    assert.deepEqual(entityAuctionGame.defaultSettings, { startingKernels: 10_000, entitiesPerPlayer: 3, auctionSeconds: 30, eventCount: 5 });
    assert.equal(RULES.auction.mode, "ascending");
    assert.equal(RULES.auction.minimumRaise, 100);
  });

  it("gives every agent the starting Kernels and seals players × 3 bays of unique entities", () => {
    const { room, ids } = startGame();
    const v = view(room);
    assert.equal(v.phase, "BRIEFING");
    assert.equal(v.bays.length, 9);
    assert.ok(v.bays.every((b) => b.status === "sealed" && b.entity === null));
    assert.deepEqual(v.bays.map((b) => b.bayId).slice(0, 2), ["BAY-01", "BAY-02"]);
    for (const a of v.agents) assert.equal(a.kernels, 10_000);
    assert.equal(view(room, ids[0]!).you!.kernels, 10_000);

    openBidding();
    finishAuction(room);
    const refs = view(room).bays.map((b) => b.entity!.ref);
    assert.equal(new Set(refs).size, 9, `duplicate entities: ${refs.join(", ")}`);
  });

  it("supports 8 agents when the database holds enough entities", () => {
    const names = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];
    const { room } = startGame(names, {}, auctionCanon(24));
    assert.equal(view(room).bays.length, 24);
  });

  it("refuses to start without enough entities, and leaves the room in the lobby", () => {
    const names = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];
    const { room } = setup(names, auctionCanon(21));
    assert.throws(
      () => room.startGame(),
      (err: unknown) =>
        err instanceof PartyError &&
        err.code === "INSUFFICIENT_CANON" &&
        /INSUFFICIENT CONTAINMENT MATERIAL/.test(err.detail ?? "") &&
        /24 sealed entities/.test(err.detail ?? "") &&
        /only holds 21/.test(err.detail ?? ""),
    );
    assert.equal(room.status, "LOBBY");

    // Two entities each fits in 21, so the same room can play once the host changes that.
    room.configure({ settings: { entitiesPerPlayer: 2 } });
    room.startGame();
    assert.equal(view(room).bays.length, 16);
  });

  it("refuses to start with no canon at all, or with too few agents", () => {
    expectError(() => setup(NAMES, []).room.startGame(), "NO_CANON");
    expectError(() => setup(["Ann", "Bo"]).room.startGame(), "NOT_ENOUGH_PLAYERS");
    // TEST_CANON has 4 entities: fewer than 3 agents × 3.
    expectError(() => setup(NAMES, TEST_CANON).room.startGame(), "INSUFFICIENT_CANON");
  });

  it("clamps host settings", () => {
    assert.deepEqual(entityAuctionGame.parseSettings({ startingKernels: -5, entitiesPerPlayer: 99, auctionSeconds: "20", eventCount: "x" }), {
      startingKernels: 1000,
      entitiesPerPlayer: 5,
      auctionSeconds: 20,
      eventCount: 5,
    });
  });
});

// ------------------------------------------------------------------ secrecy

describe("Entity Auction: secrecy", () => {
  const modifierSecrets = SEED_EFFECTS.filter((e) => e.kind === "modifier").flatMap((e) => [e.id, e.name, e.description]);

  it("never sends a sealed bay's entity to anyone before its door opens", () => {
    const { room, ids } = startGame();
    const viewers = [undefined, ...ids];
    const check = (label: string) => {
      const opened = new Set(view(room).bays.filter((b) => b.entity).map((b) => b.entity!.ref));
      for (const viewer of viewers) {
        const json = JSON.stringify(room.viewFor(viewer ? { kind: "player", playerId: viewer } : { kind: "host" }));
        for (const ref of json.match(/CPE-\d+/g) ?? []) {
          assert.ok(opened.has(ref), `${label}: ${ref} leaked to ${viewer ?? "the host"} before its door opened`);
        }
      }
    };

    check("briefing");
    openBidding();
    bid(room, ids[0]!, 500);
    check("bidding");
    mock.timers.tick(RULES.auction.auctionDurationMs);
    assert.equal(view(room).phase, "OPENING");
    assert.equal(view(room).active!.entity, null, "the door is opening, the contents are not out yet");
    assert.equal(view(room).agents[0]!.entityValue, 0, "nor is the winner's new entity counted where anyone can see it");
    check("opening");
    mock.timers.tick(T.openingMs);
    assert.equal(view(room).phase, "REVEALED");
    check("revealed");
    // Only the one opened bay is known; everything else is still sealed.
    assert.equal(view(room).bays.filter((b) => b.entity).length, 1);
  });

  it("keeps every modifier hidden through the auction and its reveals", () => {
    const { room, ids } = startGame();
    openBidding();
    while (view(room).phase === "BIDDING") {
      mock.timers.tick(RULES.auction.auctionDurationMs);
      mock.timers.tick(T.openingMs);
      for (const viewer of [undefined, ...ids]) {
        const json = JSON.stringify(room.viewFor(viewer ? { kind: "player", playerId: viewer } : { kind: "host" }));
        for (const secret of modifierSecrets) assert.ok(!json.includes(secret), `${secret} leaked during the auction`);
        assert.ok(!json.includes('"polarity"'), "a modifier's kind leaked during the auction");
      }
      mock.timers.tick(T.revealedMs);
    }
    assert.equal(view(room).phase, "ACTION_INTRO");
  });

  it("reveals the entity to every screen at once, with its classification value, winner and price", () => {
    const { room, ids } = startGame();
    openBidding();
    bid(room, ids[1]!, 1200);
    mock.timers.tick(RULES.auction.auctionDurationMs);
    mock.timers.tick(T.openingMs);

    const host = view(room);
    const entity = host.active!.entity!;
    assert.ok(entity, "revealed");
    assert.match(entity.title, /^Specimen CPE-/);
    assert.equal(entity.baseValue, RULES.valuation.classificationValues[entity.classification] ?? RULES.valuation.defaultValue);
    assert.equal(host.active!.ownerName, "Bo");
    assert.equal(host.active!.winningBid, 1200);
    for (const pid of ids) assert.deepEqual(view(room, pid).active!.entity, entity, "every agent sees the same reveal");
  });
});

// ------------------------------------------------------------------ bidding

describe("Entity Auction: bidding", () => {
  it("accepts rising bids and shows the current bid and highest bidder to everyone", () => {
    const { room, ids } = startGame();
    openBidding();
    bid(room, ids[0]!, 0); // the minimum opening bid is 0
    bid(room, ids[1]!, 100);
    bid(room, ids[0]!, 450);

    for (const viewer of [undefined, ...ids]) {
      const a = view(room, viewer).active!;
      assert.equal(a.currentBid, 450);
      assert.equal(a.highestBidder, "Ann");
      assert.equal(a.minimumBid, 550);
    }
    assert.deepEqual(view(room).active!.recentBids, [
      { name: "Ann", amount: 450 },
      { name: "Bo", amount: 100 },
      { name: "Ann", amount: 0 },
    ]);
    assert.equal(view(room, ids[0]!).you!.isHighest, true);
    assert.equal(view(room, ids[0]!).you!.canBid, false, "no raising your own bid");
    assert.equal(view(room, ids[1]!).you!.canBid, true);
  });

  it("rejects invalid bids", () => {
    const { room, ids } = startGame();
    expectError(() => bid(room, ids[0]!, 100), "PHASE_CLOSED"); // still in the briefing
    openBidding();

    expectError(() => room.gameInput(ids[0]!, "steal", { amount: 1 }), "INVALID_ACTION");
    expectError(() => room.gameInput(ids[0]!, "bid", null), "INVALID_INPUT");
    for (const amount of [-1, 10.5, "500", Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expectError(() => bid(room, ids[0]!, amount), "INVALID_INPUT");
    }
    expectError(() => bid(room, ids[0]!, 10_001), "INSUFFICIENT_KERNELS");

    bid(room, ids[0]!, 1000);
    expectError(() => bid(room, ids[0]!, 2000), "ALREADY_HIGHEST");
    expectError(() => bid(room, ids[1]!, 1000), "BID_TOO_LOW");
    expectError(() => bid(room, ids[1]!, 1099), "BID_TOO_LOW");
    bid(room, ids[1]!, 1100);
    assert.equal(view(room).active!.currentBid, 1100);
  });

  it("closes the auction on the server's timer and refuses late bids", () => {
    const { room, ids } = startGame();
    openBidding();
    bid(room, ids[0]!, 300);
    mock.timers.tick(RULES.auction.auctionDurationMs - 1);
    bid(room, ids[1]!, 400); // still open with 1 ms to go
    mock.timers.tick(1);
    assert.equal(view(room).phase, "OPENING");
    expectError(() => bid(room, ids[2]!, 5000), "PHASE_CLOSED");
    assert.equal(view(room).active!.ownerName, "Bo");
  });

  it("gives the winner the entity and deducts exactly the winning bid", () => {
    const { room, ids } = startGame();
    openBidding();
    bid(room, ids[2]!, 2500);
    bid(room, ids[0]!, 3400);
    finishLot(room);

    const ann = view(room).agents.find((a) => a.playerId === ids[0])!;
    assert.equal(ann.kernels, 10_000 - 3400);
    assert.equal(ann.collection.length, 1);
    assert.equal(ann.collection[0]!.winningBid, 3400);
    assert.equal(ann.collection[0]!.bayNumber, 1);
    assert.equal(view(room).agents.find((a) => a.playerId === ids[2])!.kernels, 10_000, "losing bids cost nothing");
    assert.equal(view(room).bays[0]!.status, "collected");
  });

  it("hands an unbid bay out free to an agent with room, so everyone ends with three", () => {
    const { room, ids } = startGame();
    openBidding();
    // Ann takes the first three bays; the rest go unbid.
    for (let lot = 0; lot < 3; lot++) {
      bid(room, ids[0]!, 100);
      finishLot(room);
    }
    expectError(() => bid(room, ids[0]!, 100), "COLLECTION_FULL");
    assert.equal(view(room, ids[0]!).you!.canBid, false);
    finishAuction(room);

    const v = view(room);
    for (const a of v.agents) assert.equal(a.collection.length, 3, `${a.name} holds ${a.collection.length}`);
    const free = v.bays.filter((b) => b.byLottery);
    assert.equal(free.length, 6);
    assert.ok(free.every((b) => b.winningBid === 0 && b.ownerId !== ids[0]));
    assert.equal(v.agents.find((a) => a.playerId === ids[1])!.kernels, 10_000);
  });

  it("drops a departed agent's bids and lets the next-highest bid stand", () => {
    const { room, ids } = startGame(["Ann", "Bo", "Cy", "Di"]);
    openBidding();
    bid(room, ids[0]!, 100);
    bid(room, ids[1]!, 900);
    room.removePlayer(ids[1]!);
    assert.equal(view(room).active!.currentBid, 100);
    assert.equal(view(room).active!.highestBidder, "Ann");
    finishLot(room);
    assert.equal(view(room).bays[0]!.ownerName, "Ann");
  });

  it("survives a reconnect mid-auction without losing bids or Kernels", () => {
    const { room, ids } = startGame();
    openBidding();
    bid(room, ids[0]!, 700);
    room.detachPlayerSocket("socket-0");
    const player = room.activePlayers().find((p) => p.id === ids[0])!;
    room.attachPlayer(player, "socket-0b");
    const v = view(room, ids[0]!);
    assert.equal(v.phase, "BIDDING");
    assert.equal(v.active!.currentBid, 700);
    assert.equal(v.you!.isHighest, true);
    finishLot(room);
    assert.equal(view(room, ids[0]!).you!.kernels, 9300);
  });
});

// ------------------------------------------------------------------ action round and victory

describe("Entity Auction: modifiers, the Action Round and the tally", () => {
  /** Leaves only these library entries enabled. */
  function only(db: PartyDb, keep: string[]) {
    for (const e of db.listAuctionEffects()) db.updateAuctionEffect(e.id, { enabled: keep.includes(e.id) });
  }

  it("assigns only enabled modifiers, keeps them hidden, and resolves them in the audit", () => {
    const s = setup();
    only(s.db, ["DEBUFF-002"]); // Structural Rot: value halves; no events
    s.room.startGame();
    openBidding();
    finishAuction(s.room);

    assert.equal(view(s.room).phase, "ACTION_INTRO");
    assert.equal(view(s.room).rules.eventCount, 0, "no enabled events, so none will run");
    assert.ok(view(s.room).agents.every((a) => a.collection.every((h) => h.modifier === null)));

    mock.timers.tick(T.actionIntroMs);
    const v = view(s.room);
    assert.equal(v.phase, "AUDIT");
    for (const a of v.agents) {
      for (const h of a.collection) {
        assert.equal(h.modifier!.name, "Structural Rot");
        assert.equal(h.value, Math.round(h.baseValue / 2));
      }
    }
  });

  it("runs the configured number of distinct events, each applied to everyone at once", () => {
    const s = setup();
    only(s.db, ["NEUTRAL-001", "EVENT-002", "EVENT-009", "EVENT-010"]);
    s.room.configure({ settings: { eventCount: 3 } });
    s.room.startGame();
    openBidding();
    finishAuction(s.room);
    mock.timers.tick(T.actionIntroMs);

    const seen: string[] = [];
    let before = view(s.room).agents;
    while (view(s.room).phase === "EVENT") {
      const v = view(s.room);
      seen.push(v.event!.id);
      assert.equal(v.event!.total, 3);
      for (const pid of s.ids) assert.equal(view(s.room, pid).event!.id, v.event!.id, "every agent sees the same event");

      if (v.event!.id === "EVENT-002") {
        for (const a of v.agents) assert.equal(a.kernels, before.find((b) => b.playerId === a.playerId)!.kernels + 1000);
      }
      if (v.event!.id === "EVENT-009") {
        for (const a of v.agents) {
          assert.equal(a.entityValue, before.find((b) => b.playerId === a.playerId)!.entityValue + 3 * 500);
        }
      }
      before = v.agents;
      mock.timers.tick(T.eventMs);
    }
    assert.deepEqual([...seen].sort(), ["EVENT-002", "EVENT-009", "EVENT-010"]);
  });

  it("gains and loses entities through modifiers triggered by an event", () => {
    const s = setup();
    only(s.db, ["DEBUFF-001", "EVENT-003"]); // every entity carries Containment Failure
    s.room.configure({ settings: { eventCount: 1 } });
    s.room.startGame();
    openBidding();
    finishAuction(s.room);
    mock.timers.tick(T.actionIntroMs);

    const v = view(s.room);
    assert.equal(v.event!.name, "Containment Incident");
    for (const a of v.agents) {
      assert.equal(a.entityValue, 0);
      assert.ok(a.collection.every((h) => !h.active && h.modifier?.name === "Containment Failure"));
      assert.equal(a.netWorth, a.kernels);
    }
  });

  it("scores final net worth as Kernels left plus the value of entities still held", () => {
    const s = setup();
    only(s.db, ["BUFF-003", "EVENT-002"]); // Mitosis copies; Kernel Surplus +1000
    s.room.configure({ settings: { eventCount: 1 } });
    s.room.startGame();
    openBidding();
    bid(s.room, s.ids[0]!, 3200);
    finishAuction(s.room);
    mock.timers.tick(T.actionIntroMs); // EVENT
    mock.timers.tick(T.eventMs); // AUDIT: every Mitosis fires

    const audit = view(s.room);
    assert.equal(audit.phase, "AUDIT");
    for (const a of audit.agents) {
      assert.equal(a.collection.length, 6, "three entities plus a copy of each");
      const copies = a.collection.filter((h) => h.bayNumber === null);
      assert.ok(copies.every((c) => c.winningBid === 0 && c.modifier === null));
    }

    mock.timers.tick(T.auditMs);
    const tally = view(s.room);
    assert.equal(tally.phase, "TALLY");
    const ann = tally.standings!.find((a) => a.playerId === s.ids[0])!;
    assert.equal(ann.kernels, 10_000 - 3200 + 1000);
    assert.equal(ann.entityValue, ann.collection.reduce((sum, h) => sum + (h.active ? h.value : 0), 0));
    assert.equal(ann.netWorth, ann.kernels + ann.entityValue);
    const worths = tally.standings!.map((a) => a.netWorth);
    assert.deepEqual(worths, [...worths].sort((a, b) => b - a), "standings are ordered by net worth");

    mock.timers.tick(T.tallyMs);
    assert.equal(s.room.status, "FINAL_RESULTS");
    const standings = s.room.results!.standings;
    for (const st of standings) {
      assert.equal(st.score, tally.standings!.find((a) => a.playerId === st.playerId)!.netWorth);
    }
    assert.equal(standings[0]!.placement, 1);
    assert.equal(s.room.results!.rounds, 9);
  });

  it("records the canon each bay held, and never changes canon", () => {
    const canon = auctionCanon(30);
    const snapshot = JSON.stringify(canon);
    const s = startGame(NAMES, {}, canon);
    openBidding();
    finishAuction(s.room);
    const bays = view(s.room).bays;
    skipToEnd(s.room);

    assert.equal(s.room.status, "FINAL_RESULTS");
    const refs = s.records[0]!.canonRefs!;
    assert.equal(refs.length, 9);
    for (const { round, ref } of refs) assert.equal(bays[round - 1]!.entity!.ref, ref, "the recorded ref is the bay's contents");
    assert.equal(JSON.stringify(canon), snapshot, "values, owners and modifiers never touch canon");
  });

  it("lets the host skip every phase to the results", () => {
    const { room } = startGame();
    skipToEnd(room);
    assert.equal(room.status, "FINAL_RESULTS");
    assert.equal(room.results!.gameId, "entityauction");
    assert.equal(room.results!.standings.length, 3);
  });
});

// ------------------------------------------------------------------ the effect engine

describe("Entity Auction: effect engine", () => {
  function economy(): Economy & { holdings: Holding[] } {
    const holding = (ref: string, ownerId: string, classification: string, value: number, modifier: EffectDef | null = null): Holding => ({
      instanceId: ref,
      ref,
      title: ref,
      classification,
      ownerId,
      bayNumber: 1,
      winningBid: 0,
      baseValue: value,
      value,
      modifier,
      modifierRevealed: false,
      active: true,
    });
    const seed = (id: string) => SEED_EFFECTS.find((e) => e.id === id)!;
    let n = 0;
    return {
      kernels: new Map([
        ["a", 1000],
        ["b", 200],
      ]),
      holdings: [
        holding("E1", "a", "COSMIC", 8000, seed("BUFF-001")),
        holding("E2", "a", "LOCAL", 2000, seed("DEBUFF-001")),
        holding("E3", "b", "LOCAL", 2000, seed("DEBUFF-004")),
      ],
      playerName: (id) => id.toUpperCase(),
      newId: () => `copy-${++n}`,
    };
  }
  const ev = (effect: EffectDef["effect"]): EffectDef => ({ id: "EVENT-T", kind: "event", name: "Test", polarity: null, description: "", effect, enabled: true });

  it("multiplies and adds value, optionally for one classification, never below zero", () => {
    const e = economy();
    runEvent(e, ev({ type: "value_multiply", factor: 0.5, classification: "LOCAL" }));
    assert.deepEqual(e.holdings.map((h) => h.value), [8000, 1000, 1000]);
    runEvent(e, ev({ type: "value_add", amount: -5000 }));
    assert.deepEqual(e.holdings.map((h) => h.value), [3000, 0, 0]);
  });

  it("pays or bills every agent, never below zero", () => {
    const e = economy();
    const outcomes = runEvent(e, ev({ type: "kernels_all", amount: -500 }));
    assert.deepEqual([...e.kernels.values()], [500, 0]);
    assert.equal(outcomes.length, 2, "one line per agent");
    // Nothing left to take: no line for a change that changed nothing.
    assert.deepEqual(runEvent(e, ev({ type: "kernels_all", amount: -1000 })).map((o) => o.playerName), ["A"]);
  });

  it("triggers only the matching hidden modifiers, once", () => {
    const e = economy();
    runEvent(e, ev({ type: "trigger_modifiers", polarity: "debuff" }));
    assert.equal(e.holdings[1]!.active, false, "Containment Failure removed E2");
    assert.equal(e.kernels.get("b"), 0, "Hazard Surcharge billed B, floored at 0");
    assert.equal(e.holdings[0]!.modifierRevealed, false, "the buff is still hidden");

    const again = runEvent(e, ev({ type: "trigger_modifiers", modifierId: "DEBUFF-001" }));
    assert.match(again[0]!.text, /No entity/);

    revealModifiers(e);
    assert.equal(e.holdings[0]!.value, 10_000, "Kernel Magnet +2000 in the audit");
  });

  it("duplicates entities and removes them", () => {
    const e = economy();
    runEvent(e, ev({ type: "duplicate_entity", factor: 0.5, classification: "COSMIC" }));
    assert.equal(e.holdings.length, 4);
    assert.deepEqual(
      { ...e.holdings[3]!, instanceId: "" },
      { ...e.holdings[0]!, instanceId: "", bayNumber: null, baseValue: 4000, value: 4000, modifier: null },
    );
    runEvent(e, ev({ type: "remove_entity", classification: "LOCAL" }));
    assert.deepEqual(e.holdings.map((h) => h.active), [true, false, false, true]);
  });

  it("only accepts known effect types with valid parameters, never code", () => {
    assert.equal(validateEffect("modifier", { type: "value_add", amount: 500 }).ok, true);
    assert.deepEqual(validateEffect("event", { type: "value_multiply", factor: "0.8", classification: " local " }), {
      ok: true,
      effect: { type: "value_multiply", factor: 0.8, classification: "LOCAL" },
    });
    for (const [kind, raw] of [
      ["modifier", { type: "kernels_all", amount: 1 }], // event-only
      ["modifier", { type: "value_add", amount: 1.5 }],
      ["modifier", { type: "value_add", amount: 10_000_000 }],
      ["modifier", { type: "value_add" }],
      ["event", { type: "__proto__" }],
      ["event", { type: "constructor" }],
      ["event", { type: "value_add", amount: 1, classification: "x'); DROP TABLE" }],
      ["event", { type: "trigger_modifiers", polarity: "evil" }],
      ["event", "return process.exit()"],
    ] as const) {
      assert.equal(validateEffect(kind, raw).ok, false, JSON.stringify(raw));
    }
  });
});

// ------------------------------------------------------------------ moderator API and live play

describe("Entity Auction: moderators and realtime play", () => {
  let server: PartyServer;
  let db: PartyDb;
  let base: string;
  const sockets: Socket[] = [];
  const MOD = "dev:boss:EXEC";

  before(async () => {
    mock.timers.reset(); // real sockets need real timers
    db = new PartyDb(":memory:");
    server = createPartyServer({ db, auth: createAuthVerifier({ mode: "dev" }), authConfig: { mode: "dev" }, canon: stubCanon(auctionCanon(30)) });
    await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });
  beforeEach(() => mock.timers.reset());
  afterEach(() => {
    for (const s of sockets.splice(0)) s.close();
  });
  after(() => server.close());

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  };

  it("lets only moderators manage modifiers and events, with validated effects", async () => {
    assert.equal((await call("GET", "/api/mod/auction", "dev:ann:CORRESPONDENT")).status, 403);

    const list = await call("GET", "/api/mod/auction", MOD);
    assert.equal(list.status, 200);
    assert.ok(list.json.effects.some((e: EffectDef) => e.id === "DEBUFF-001" && e.name === "Containment Failure"));
    assert.ok(list.json.catalog.event.some((t: { type: string }) => t.type === "trigger_modifiers"));
    assert.ok(!list.json.catalog.modifier.some((t: { type: string }) => t.type === "kernels_all"));

    const created = await call("POST", "/api/mod/auction", MOD, {
      kind: "modifier",
      name: "Lucky Husk",
      polarity: "buff",
      description: "Worth 25% more.",
      effect: { type: "value_multiply", factor: 1.25 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.id, "BUFF-005");
    assert.equal(created.json.enabled, true);

    const bad = await call("POST", "/api/mod/auction", MOD, { kind: "event", name: "Hack", description: "x", effect: { type: "eval", code: "1" } });
    assert.equal(bad.status, 400);
    assert.equal((await call("POST", "/api/mod/auction", MOD, { kind: "modifier", name: "No polarity", description: "x", effect: { type: "remove_entity" } })).status, 400);

    const edited = await call("PATCH", "/api/mod/auction/BUFF-005", MOD, { enabled: false, description: "Retired." });
    assert.equal(edited.json.enabled, false);
    assert.equal(edited.json.description, "Retired.");
    assert.equal(edited.json.name, "Lucky Husk");
    assert.ok(!db.effectLibrary().modifiers.some((m) => m.id === "BUFF-005"), "disabled entries never reach a game");
    assert.equal((await call("PATCH", "/api/mod/auction/NOPE-001", MOD, { enabled: true })).status, 404);
  });

  it("synchronises bids, the door reveal and the Action Round, and survives a refresh", async () => {
    type State = { status: string; game: AuctionView | null; results: { standings: unknown[] } | null };
    const client = async () => {
      const socket = connect(base, { transports: ["websocket"], forceNew: true, reconnection: false });
      sockets.push(socket);
      const states: State[] = [];
      socket.on("state", (s: State) => states.push(s));
      await new Promise<void>((resolve, reject) => (socket.once("connect", () => resolve()), socket.once("connect_error", reject)));
      const emit = (event: string, payload: object = {}) => socket.timeout(5000).emitWithAck(event, payload);
      const waitFor = async (test: (s: State) => boolean, label: string) => {
        for (let i = 0; i < 250; i++) {
          const found = states.at(-1);
          if (found && test(found)) return found;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error(`timed out waiting for ${label}`);
      };
      return { socket, states, emit, waitFor };
    };

    const host = await client();
    const { code } = await host.emit("host:create");
    const players = [];
    for (const name of NAMES) {
      const c = await client();
      const joined = await c.emit("player:join", { code, name });
      players.push({ ...c, token: joined.token as string });
    }
    // A smaller game keeps the host's skips under the per-socket rate limit.
    assert.equal((await host.emit("room:configure", { gameId: "entityauction", settings: { entitiesPerPlayer: 2, eventCount: 3 } })).ok, true);
    assert.equal((await host.emit("room:start")).ok, true);
    await host.waitFor((s) => s.game?.phase === "BRIEFING", "briefing");
    await host.emit("game:host", { action: "skip" });

    // A bid shows up on every screen.
    assert.equal((await players[0]!.emit("game:input", { action: "bid", payload: { amount: 500 } })).ok, true);
    for (const c of [host, ...players]) await c.waitFor((s) => s.game?.active?.currentBid === 500 && s.game.active.highestBidder === "Ann", "bid sync");
    assert.equal((await players[1]!.emit("game:input", { action: "bid", payload: { amount: 550 } })).error, "BID_TOO_LOW");

    // Cy refreshes mid-auction and carries on.
    players[2]!.socket.close();
    const cy = await client();
    assert.equal((await cy.emit("player:resume", { code, token: players[2]!.token })).ok, true);
    await cy.waitFor((s) => s.game?.phase === "BIDDING" && s.game.active?.currentBid === 500, "state after refresh");
    assert.equal((await cy.emit("game:input", { action: "bid", payload: { amount: 700 } })).ok, true);
    const screens = [host, players[0]!, players[1]!, cy];

    // The server closes the auction; every screen opens the same door and sees the same entity.
    await host.emit("game:host", { action: "skip" });
    for (const c of screens) await c.waitFor((s) => s.game?.phase === "OPENING", "opening");
    await host.emit("game:host", { action: "skip" });
    const revealed = [];
    for (const c of screens) revealed.push((await c.waitFor((s) => s.game?.phase === "REVEALED", "revealed")).game!.active!);
    for (const r of revealed) {
      assert.equal(r.entity!.ref, revealed[0]!.entity!.ref);
      assert.equal(r.ownerName, "Cy");
      assert.equal(r.winningBid, 700);
    }

    // Skip through everything else; every agent sees every event.
    while (host.states.at(-1)!.status === "IN_GAME") {
      const before = JSON.stringify(host.states.at(-1)!.game);
      await host.emit("game:host", { action: "skip" });
      await host.waitFor((s) => JSON.stringify(s.game) !== before, "phase advanced");
    }
    const final = await host.waitFor((s) => s.status === "FINAL_RESULTS", "results");
    assert.equal(final.results!.standings.length, 3);

    const eventsSeen = (states: State[]) => [...new Set(states.map((s) => s.game?.event?.id).filter(Boolean))].sort();
    assert.equal(eventsSeen(host.states).length, 3);
    for (const c of [players[0]!, players[1]!, cy]) {
      await c.waitFor((s) => s.status === "FINAL_RESULTS", "player results");
      assert.deepEqual(eventsSeen(c.states), eventsSeen(host.states));
    }

    // No screen ever received an entity before its bay was open.
    for (const c of screens) {
      for (const s of c.states) {
        for (const bay of s.game?.bays ?? []) {
          if (bay.entity) assert.ok(["revealed", "collected"].includes(bay.status), `${bay.bayId} leaked while ${bay.status}`);
        }
        if (s.game?.active && s.game.phase !== "REVEALED") assert.equal(s.game.active.entity, null);
      }
    }
  });
});
