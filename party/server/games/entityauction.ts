// ENTITY AUCTION — agents bid Kernels on sealed containment bays without knowing what is inside.
//
// Every bay secretly holds one real entity from the CPI Database. Nobody learns which until the
// auction on that bay closes and its door opens. Each entity also carries a hidden modifier (buff,
// debuff or neutral) that stays secret through the reveal; it wakes up in the Action Round, where
// random global events shake the market. Highest net worth — Kernels left plus the value of the
// entities still held — wins.
//
// Secrecy is enforced here, not in the browser: a bay's entity and every modifier live only in
// this instance and appear in viewFor() once the rules say they are revealed.
//
// Canon is read-only. Values, owners, modifiers, bids and event results are temporary game state
// and are thrown away with the game; only the final scores and the canon refs used are saved.
//
// The auction, the bays, the economy, the effects (auctioneffects.ts) and the tally are separate
// on purpose. The server only ever says what state a bay is in ("opening"); how a door looks and
// moves is entirely up to the renderers in public/js/games/entityauction-*.js.

import { randomBytes } from "node:crypto";
import type { CanonRecord } from "../canon.ts";
import { PartyError } from "../errors.ts";
import { kernels, revealModifiers, runEvent, type EffectDef, type Economy, type Holding, type Outcome } from "./auctioneffects.ts";
import type { GameContext, GameDefinition, GameInstance, Highlight, Viewer } from "./types.ts";

/** Every rule in one place. The host lobby can override the ones in EntityAuctionSettings. */
export const DEFAULT_ENTITY_AUCTION_RULES = {
  minPlayers: 3,
  maxPlayers: 8,
  startingKernels: 10_000,
  entitiesPerPlayer: 3,
  auction: {
    mode: "ascending" as const,
    /** The lowest opening bid. Later bids must beat the current one by minimumRaise. */
    minimumBid: 0,
    minimumRaise: 100,
    auctionDurationMs: 30_000,
  },
  actionRound: {
    enabled: true,
    eventCount: 5,
    /** After the events, reveal and apply every modifier no event triggered. */
    revealEffects: true,
  },
  valuation: {
    /** Base value by CPI Database classification. Anything unlisted is worth defaultValue. */
    classificationValues: { COSMIC: 8000, EARTHLY: 4000, LOCAL: 2000 } as Readonly<Record<string, number>>,
    defaultValue: 2500,
  },
  victory: { method: "net_worth" as const },
  timing: {
    briefingMs: 8000,
    openingMs: 3500,
    revealedMs: 8000,
    actionIntroMs: 6000,
    eventMs: 10_000,
    auditMs: 12_000,
    tallyMs: 15_000,
  },
};

export type EntityAuctionRules = typeof DEFAULT_ENTITY_AUCTION_RULES;

/** The rules a host can change from the lobby. */
export interface EntityAuctionSettings {
  startingKernels: number;
  entitiesPerPlayer: number;
  auctionSeconds: number;
  eventCount: number;
}

export function rulesFor(settings: EntityAuctionSettings): EntityAuctionRules {
  const base = DEFAULT_ENTITY_AUCTION_RULES;
  return {
    ...base,
    startingKernels: settings.startingKernels,
    entitiesPerPlayer: settings.entitiesPerPlayer,
    auction: { ...base.auction, auctionDurationMs: settings.auctionSeconds * 1000 },
    actionRound: { ...base.actionRound, eventCount: settings.eventCount },
  };
}

/** Normalised classification, e.g. "COSMIC". Entities with none are "UNCLASSIFIED". */
export function classificationOf(record: CanonRecord): string {
  return (record.fields.classification ?? "").trim().toUpperCase() || "UNCLASSIFIED";
}

export function baseValueOf(classification: string, rules: EntityAuctionRules = DEFAULT_ENTITY_AUCTION_RULES): number {
  return rules.valuation.classificationValues[classification] ?? rules.valuation.defaultValue;
}

/**
 * Door states, in order. The server moves a bay through them; the renderers animate between
 * them. "Unlocking" is the first beat of the client's opening animation, not a server state.
 */
export type BayStatus = "sealed" | "active" | "opening" | "revealed" | "collected";

type Phase = "BRIEFING" | "BIDDING" | "OPENING" | "REVEALED" | "ACTION_INTRO" | "EVENT" | "AUDIT" | "TALLY";

interface Bay {
  id: string;
  number: number;
  /** The hidden contents. Never in a view before the door opens. */
  record: CanonRecord;
  classification: string;
  baseValue: number;
  /** The hidden modifier. Never in a view before the Action Round reveals it. */
  modifier: EffectDef | null;
  status: BayStatus;
  /** Ascending; the last one is the highest. Nothing is escrowed: only one bay is ever open. */
  bids: { playerId: string; amount: number }[];
  holding: Holding | null;
  /** Nobody bid, so the bay was handed to an agent who still had room. */
  byLottery: boolean;
}

const OPENED: readonly BayStatus[] = ["revealed", "collected"];
const CLOSED: readonly BayStatus[] = ["opening", "revealed", "collected"];
const SUMMARY_MAX = 240;

const newId = () => randomBytes(6).toString("hex");

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new PartyError("INVALID_INPUT");
  return payload as Record<string, unknown>;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

class EntityAuctionGame implements GameInstance {
  private readonly ctx: GameContext;
  private readonly rules: EntityAuctionRules;
  /** Everyone who started, including agents who leave later: their Kernels still count. */
  private readonly roster: string[];
  private readonly bays: Bay[];
  private readonly economy: Economy;
  /** Library events not yet drawn this game; drawn without repeats. */
  private readonly unusedEvents: EffectDef[];
  private readonly eventTotal: number;
  private phase: Phase = "BRIEFING";
  /** Index of the bay under the hammer. */
  private lot = -1;
  private eventNumber = 0;
  private event: { def: EffectDef; outcomes: Outcome[] } | null = null;
  private audit: Outcome[] = [];
  private nextStep: (() => void) | null = null;

  constructor(ctx: GameContext, rules: EntityAuctionRules) {
    this.ctx = ctx;
    this.rules = rules;
    this.roster = ctx.players().map((p) => p.id);

    // Drawn and shuffled server-side with the room's randomness. Bay numbers follow the shuffled
    // order, so nothing about a bay's number says anything about its contents.
    const records = ctx.canon.sample("entity", this.roster.length * rules.entitiesPerPlayer);
    const { modifiers, events } = ctx.effectLibrary();
    this.bays = records.map((record, i) => {
      const classification = classificationOf(record);
      return {
        id: `BAY-${String(i + 1).padStart(2, "0")}`,
        number: i + 1,
        record,
        classification,
        baseValue: baseValueOf(classification, rules),
        modifier: modifiers.length ? modifiers[Math.floor(ctx.random() * modifiers.length)]! : null,
        status: "sealed",
        bids: [],
        holding: null,
        byLottery: false,
      };
    });

    this.unusedEvents = events.slice();
    this.eventTotal = rules.actionRound.enabled ? Math.min(rules.actionRound.eventCount, events.length) : 0;
    this.economy = {
      kernels: new Map(this.roster.map((id) => [id, rules.startingKernels])),
      holdings: [],
      playerName: (id) => ctx.playerName(id),
      newId,
    };
  }

  private schedule(ms: number, step: () => void): void {
    this.nextStep = step;
    this.ctx.setTimer(ms, step);
  }

  private get timing() {
    return this.rules.timing;
  }

  private collectionSize(playerId: string): number {
    return this.economy.holdings.filter((h) => h.ownerId === playerId && h.bayNumber !== null).length;
  }

  private slotsLeft(playerId: string): number {
    return Math.max(0, this.rules.entitiesPerPlayer - this.collectionSize(playerId));
  }

  /** Agents still in the game with room for another entity. */
  private eligible(): string[] {
    return this.ctx
      .players()
      .map((p) => p.id)
      .filter((id) => this.slotsLeft(id) > 0);
  }

  private minimumBid(bay: Bay): number {
    const top = bay.bids.at(-1);
    return top ? top.amount + this.rules.auction.minimumRaise : this.rules.auction.minimumBid;
  }

  private netWorth(playerId: string): number {
    const held = this.economy.holdings.filter((h) => h.ownerId === playerId && h.active);
    return (this.economy.kernels.get(playerId) ?? 0) + held.reduce((sum, h) => sum + h.value, 0);
  }

  start(): void {
    this.phase = "BRIEFING";
    this.schedule(this.timing.briefingMs, () => this.openNextLot());
    this.ctx.changed();
  }

  // ------------------------------------------------------------------ the auction

  private openNextLot(): void {
    const next = this.lot + 1;
    // Out of bays, or everyone left is already full (agents left mid-game): on to the Action Round.
    if (next >= this.bays.length || this.eligible().length === 0) return this.startActionRound();

    this.lot = next;
    this.bays[next]!.status = "active";
    this.phase = "BIDDING";
    this.schedule(this.rules.auction.auctionDurationMs, () => this.closeLot());
    this.ctx.changed();
  }

  /** The timer ran out (or the host skipped): the highest bid wins, and the door starts to open. */
  private closeLot(): void {
    const bay = this.bays[this.lot]!;
    const top = bay.bids.at(-1);
    let ownerId = top?.playerId ?? null;
    const price = top?.amount ?? 0;

    if (!ownerId) {
      // Nobody bid. The bay goes free to an agent who still has room, preferring the emptiest
      // collection, so everyone still ends the auction with the same number of entities.
      const eligible = this.eligible();
      const most = Math.max(0, ...eligible.map((id) => this.slotsLeft(id)));
      const pool = eligible.filter((id) => this.slotsLeft(id) === most);
      ownerId = pool.length ? pool[Math.floor(this.ctx.random() * pool.length)]! : null;
      bay.byLottery = ownerId !== null;
    }

    if (ownerId) {
      this.economy.kernels.set(ownerId, (this.economy.kernels.get(ownerId) ?? 0) - price);
      bay.holding = {
        instanceId: newId(),
        ref: bay.record.ref,
        title: bay.record.title,
        classification: bay.classification,
        ownerId,
        bayNumber: bay.number,
        winningBid: price,
        baseValue: bay.baseValue,
        value: bay.baseValue,
        modifier: bay.modifier,
        modifierRevealed: false,
        active: true,
      };
      this.economy.holdings.push(bay.holding);
      this.ctx.countStat(ownerId, "baysWon");
    }
    for (const player of this.ctx.players()) this.ctx.countStat(player.id, "roundsPlayed");

    bay.status = "opening";
    this.phase = "OPENING";
    this.schedule(this.timing.openingMs, () => this.revealLot());
    this.ctx.changed();
  }

  private revealLot(): void {
    const bay = this.bays[this.lot]!;
    bay.status = "revealed";
    this.ctx.canon.used(bay.number, bay.record.ref);
    this.phase = "REVEALED";
    this.schedule(this.timing.revealedMs, () => {
      bay.status = "collected";
      this.openNextLot();
    });
    this.ctx.changed();
  }

  // ------------------------------------------------------------------ the action round

  private startActionRound(): void {
    if (!this.rules.actionRound.enabled) return this.tally();
    this.phase = "ACTION_INTRO";
    this.schedule(this.timing.actionIntroMs, () => this.nextEvent());
    this.ctx.changed();
  }

  /** Draws a random event nobody has seen this game and applies it to everyone at once. */
  private nextEvent(): void {
    if (this.eventNumber >= this.eventTotal || this.unusedEvents.length === 0) return this.runAudit();
    const [def] = this.unusedEvents.splice(Math.floor(this.ctx.random() * this.unusedEvents.length), 1);
    this.eventNumber += 1;
    this.event = { def: def!, outcomes: runEvent(this.economy, def!) };
    this.phase = "EVENT";
    this.schedule(this.timing.eventMs, () => this.nextEvent());
    this.ctx.changed();
  }

  private runAudit(): void {
    const waiting = this.economy.holdings.filter((h) => h.modifier && !h.modifierRevealed);
    if (!this.rules.actionRound.revealEffects || !waiting.length) return this.tally();
    this.audit = revealModifiers(this.economy, waiting);
    this.phase = "AUDIT";
    this.schedule(this.timing.auditMs, () => this.tally());
    this.ctx.changed();
  }

  // ------------------------------------------------------------------ victory

  private tally(): void {
    this.phase = "TALLY";
    this.schedule(this.timing.tallyMs, () => this.finish());
    this.ctx.changed();
  }

  private finish(): void {
    // Net worth is the score, so the room's standings and ties are the final ranking.
    for (const id of this.roster) this.ctx.addPoints(id, this.netWorth(id));

    const won = this.economy.holdings.filter((h) => h.bayNumber !== null);
    const gain = (h: Holding) => (h.active ? h.value : 0) - h.winningBid;
    const best = won.reduce<Holding | null>((a, h) => (!a || gain(h) > gain(a) ? h : a), null);
    const worst = won.reduce<Holding | null>((a, h) => (!a || gain(h) < gain(a) ? h : a), null);
    const highlights: Highlight[] = [];
    const describe = (h: Holding) =>
      `Won for ${kernels(h.winningBid)}; ${h.active ? `worth ${kernels(h.value)} at the end` : "lost before the end"}.`;
    if (best && gain(best) > 0) {
      highlights.push({ title: "Best Buy", playerName: this.ctx.playerName(best.ownerId), text: `${best.ref} · ${best.title}`, detail: describe(best) });
    }
    if (worst && gain(worst) < 0) {
      highlights.push({ title: "Worst Gamble", playerName: this.ctx.playerName(worst.ownerId), text: `${worst.ref} · ${worst.title}`, detail: describe(worst) });
    }

    // One round per bay that went under the hammer.
    this.ctx.finish({ rounds: this.lot + 1, highlights });
  }

  // ------------------------------------------------------------------ input

  handleInput(playerId: string, action: string, payload: unknown): void {
    if (action !== "bid") throw new PartyError("INVALID_ACTION");
    const bay = this.bays[this.lot];
    // The phase flips the moment the server's timer fires, so a late bid always lands here.
    if (this.phase !== "BIDDING" || !bay) throw new PartyError("PHASE_CLOSED");
    if (!this.ctx.players().some((p) => p.id === playerId)) throw new PartyError("INVALID_ACTION");
    if (this.slotsLeft(playerId) === 0) throw new PartyError("COLLECTION_FULL");

    const { amount } = asRecord(payload);
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
      throw new PartyError("INVALID_INPUT", "Bids are whole numbers of Kernels.");
    }
    if (bay.bids.at(-1)?.playerId === playerId) throw new PartyError("ALREADY_HIGHEST");
    const minimum = this.minimumBid(bay);
    if (amount < minimum) throw new PartyError("BID_TOO_LOW", `Bids must be at least ${kernels(minimum)}.`);
    if (amount > (this.economy.kernels.get(playerId) ?? 0)) throw new PartyError("INSUFFICIENT_KERNELS");

    bay.bids.push({ playerId, amount });
    this.ctx.countStat(playerId, "bidsPlaced");
    this.ctx.changed();
  }

  hostAction(action: string): void {
    if (action !== "skip" || !this.nextStep) throw new PartyError("INVALID_ACTION");
    const step = this.nextStep;
    this.ctx.clearTimer();
    step();
  }

  playerLeft(playerId: string): void {
    const bay = this.bays[this.lot];
    if (this.phase !== "BIDDING" || !bay) return;
    // A departed agent's bids no longer stand. The bid below theirs takes over; nothing was
    // escrowed and nobody has spent since, so it is still good.
    bay.bids = bay.bids.filter((b) => b.playerId !== playerId);
    this.ctx.changed();
  }

  dispose(): void {
    this.nextStep = null;
  }

  // ------------------------------------------------------------------ views

  private entityView(bay: Bay) {
    const summary = bay.record.fields.description ?? "";
    return {
      ref: bay.record.ref,
      title: bay.record.title,
      classification: bay.classification,
      baseValue: bay.baseValue,
      summary: summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary,
      url: bay.record.url,
    };
  }

  private bayView(bay: Bay) {
    const closed = CLOSED.includes(bay.status);
    return {
      bayId: bay.id,
      number: bay.number,
      status: bay.status,
      // The contents only leave the server once the door is open.
      entity: OPENED.includes(bay.status) ? this.entityView(bay) : null,
      ownerId: closed ? (bay.holding?.ownerId ?? null) : null,
      ownerName: closed && bay.holding ? this.ctx.playerName(bay.holding.ownerId) : null,
      winningBid: closed ? (bay.holding?.winningBid ?? null) : null,
      byLottery: closed && bay.byLottery,
    };
  }

  private activeView(bay: Bay) {
    const top = bay.bids.at(-1);
    return {
      ...this.bayView(bay),
      currentBid: top?.amount ?? null,
      highestBidderId: top?.playerId ?? null,
      highestBidder: top ? this.ctx.playerName(top.playerId) : null,
      bidCount: bay.bids.length,
      recentBids: bay.bids
        .slice(-5)
        .reverse()
        .map((b) => ({ name: this.ctx.playerName(b.playerId), amount: b.amount })),
      minimumBid: this.minimumBid(bay),
    };
  }

  private holdingView(h: Holding) {
    return {
      instanceId: h.instanceId,
      ref: h.ref,
      title: h.title,
      classification: h.classification,
      bayNumber: h.bayNumber,
      winningBid: h.winningBid,
      baseValue: h.baseValue,
      value: h.value,
      active: h.active,
      // Only a revealed modifier is ever sent — not even whether a hidden one exists.
      modifier: h.modifierRevealed && h.modifier ? { name: h.modifier.name, polarity: h.modifier.polarity, description: h.modifier.description } : null,
    };
  }

  /** A won entity joins its owner's collection when the lot closes, but stays unseen until its door is open. */
  private visible(h: Holding): boolean {
    return h.bayNumber === null || OPENED.includes(this.bays[h.bayNumber - 1]!.status);
  }

  private agentView(playerId: string) {
    const held = this.economy.holdings.filter((h) => h.ownerId === playerId && this.visible(h));
    const entityValue = held.filter((h) => h.active).reduce((sum, h) => sum + h.value, 0);
    const kernelsLeft = this.economy.kernels.get(playerId) ?? 0;
    return {
      playerId,
      name: this.ctx.playerName(playerId),
      left: !this.ctx.players().some((p) => p.id === playerId),
      kernels: kernelsLeft,
      slotsLeft: this.slotsLeft(playerId),
      collection: held.map((h) => this.holdingView(h)),
      entityValue,
      netWorth: kernelsLeft + entityValue,
    };
  }

  viewFor(viewer: Viewer): unknown {
    const bay = this.phase === "BIDDING" || this.phase === "OPENING" || this.phase === "REVEALED" ? this.bays[this.lot] : undefined;
    const agents = this.roster.map((id) => this.agentView(id));
    const view = {
      phase: this.phase,
      rules: {
        startingKernels: this.rules.startingKernels,
        entitiesPerPlayer: this.rules.entitiesPerPlayer,
        minimumRaise: this.rules.auction.minimumRaise,
        eventCount: this.eventTotal,
      },
      lot: { number: this.lot + 1, total: this.bays.length },
      bays: this.bays.map((b) => this.bayView(b)),
      active: bay ? this.activeView(bay) : null,
      agents,
      event:
        this.phase === "EVENT" && this.event
          ? {
              number: this.eventNumber,
              total: this.eventTotal,
              id: this.event.def.id,
              name: this.event.def.name,
              description: this.event.def.description,
              outcomes: this.event.outcomes,
            }
          : null,
      audit: this.phase === "AUDIT" ? this.audit : null,
      standings: this.phase === "TALLY" ? [...agents].sort((a, b) => b.netWorth - a.netWorth) : null,
    };
    if (viewer.kind !== "player") return view;

    const me = agents.find((a) => a.playerId === viewer.playerId);
    const top = bay?.bids.at(-1);
    const canBid =
      !!me &&
      !me.left &&
      this.phase === "BIDDING" &&
      me.slotsLeft > 0 &&
      top?.playerId !== viewer.playerId &&
      me.kernels >= (bay ? this.minimumBid(bay) : Infinity);
    return { ...view, you: me ? { ...me, canBid, isHighest: !!top && top.playerId === viewer.playerId } : null };
  }
}

const D = DEFAULT_ENTITY_AUCTION_RULES;

export const entityAuctionGame: GameDefinition<EntityAuctionSettings> = {
  id: "entityauction",
  name: "Entity Auction",
  tagline: "Sealed bays. Unknown contents. Bid anyway.",
  description:
    `Every agent starts with ${D.startingKernels.toLocaleString("en-US")} Kernels and bids on sealed containment bays. Each bay holds a real ` +
    "entity from the CPI Database, but nobody knows which until the auction closes and the door opens. Then the Action " +
    "Round: hidden buffs and debuffs wake up and random events shake the market. Highest net worth wins.",
  minPlayers: D.minPlayers,
  maxPlayers: D.maxPlayers,
  defaultSettings: {
    startingKernels: D.startingKernels,
    entitiesPerPlayer: D.entitiesPerPlayer,
    auctionSeconds: D.auction.auctionDurationMs / 1000,
    eventCount: D.actionRound.eventCount,
  },
  parseSettings(raw: unknown): EntityAuctionSettings {
    const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const d = this.defaultSettings;
    return {
      startingKernels: clampInt(input.startingKernels, 1000, 100_000, d.startingKernels),
      entitiesPerPlayer: clampInt(input.entitiesPerPlayer, 1, 5, d.entitiesPerPlayer),
      auctionSeconds: clampInt(input.auctionSeconds, 10, 90, d.auctionSeconds),
      eventCount: clampInt(input.eventCount, 0, 10, d.eventCount),
    };
  },
  create(ctx, settings) {
    const rules = rulesFor(settings);
    const available = ctx.canon.list("entity").length;
    if (available === 0) throw new PartyError("NO_CANON");
    // Every bay needs its own entity: never reuse one to make up the numbers.
    const needed = ctx.players().length * rules.entitiesPerPlayer;
    if (available < needed) {
      throw new PartyError(
        "INSUFFICIENT_CANON",
        `INSUFFICIENT CONTAINMENT MATERIAL: this room needs ${needed} sealed entities, but the CPI Database only holds ${available}.`,
      );
    }
    return new EntityAuctionGame(ctx, rules);
  },
};
