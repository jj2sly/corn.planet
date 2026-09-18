// ENTITY AUCTION — hidden modifiers, Action Round events, and the effect engine that runs both.
//
// Moderators manage modifiers and events as data (the auction_effects table, edited from the
// moderation console). This file decides what that data may say: every effect is one of the types
// in EFFECT_TYPES with plain number/text parameters. Nothing a moderator writes is ever executed,
// and adding an effect type means adding one entry to EFFECT_TYPES — the game never changes.
//
// Effects only act on one game's temporary economy: Kernel balances and entity values. Canon is
// never touched. An entity's value, owner and modifier exist for one game and are then thrown away.

export type EffectKind = "modifier" | "event";
export const EFFECT_KINDS: readonly EffectKind[] = ["modifier", "event"];
export type Polarity = "buff" | "debuff" | "neutral";
export const POLARITIES: readonly Polarity[] = ["buff", "debuff", "neutral"];

/** An effect as stored: its type plus that type's parameters. */
export type Effect = { type: string } & Record<string, string | number>;

/** A hidden modifier or an Action Round event, as moderators manage it. */
export interface EffectDef {
  id: string;
  kind: EffectKind;
  name: string;
  /** Modifiers only: whether it helps or hurts the entity's owner. Null for events. */
  polarity: Polarity | null;
  description: string;
  effect: Effect;
  enabled: boolean;
}

/** The enabled modifiers and events a game can draw from. */
export interface EffectLibrary {
  modifiers: EffectDef[];
  events: EffectDef[];
}

/** One entity instance in a player's temporary collection. */
export interface Holding {
  instanceId: string;
  ref: string;
  title: string;
  classification: string;
  ownerId: string;
  /** The bay it came out of; null for a copy made during the Action Round. */
  bayNumber: number | null;
  winningBid: number;
  baseValue: number;
  value: number;
  modifier: EffectDef | null;
  modifierRevealed: boolean;
  /** False once the entity has been lost from its owner's collection. */
  active: boolean;
}

export interface Economy {
  kernels: Map<string, number>;
  holdings: Holding[];
  playerName(playerId: string): string;
  newId(): string;
}

/** One line of what an effect did, for the screens. */
export interface Outcome {
  playerName: string | null;
  ref: string | null;
  title: string | null;
  text: string;
  tone: "up" | "down" | "flat";
  /** Set on the line that reveals a hidden modifier. */
  modifier?: { name: string; polarity: Polarity; description: string };
}

interface ParamSpec {
  key: string;
  label: string;
  kind: "integer" | "number" | "text" | "polarity";
  min?: number;
  max?: number;
  optional?: boolean;
}

interface Run {
  economy: Economy;
  outcomes: Outcome[];
}

interface EffectType {
  label: string;
  help: string;
  kinds: readonly EffectKind[];
  params: readonly ParamSpec[];
  /** As an event, applies to every entity still in play (optionally one classification only). */
  targetsEntities: boolean;
  /** `targets` is the modifier's own entity, or an event's entities. */
  apply(run: Run, targets: Holding[], effect: Effect): void;
}

export const kernels = (n: number) => `${Math.round(n).toLocaleString("en-US")} K`;

function note(run: Run, h: Holding | null, text: string, tone: Outcome["tone"], extra: Partial<Outcome> = {}): void {
  run.outcomes.push({
    playerName: h ? run.economy.playerName(h.ownerId) : null,
    ref: h?.ref ?? null,
    title: h?.title ?? null,
    text,
    tone,
    ...extra,
  });
}

const tone = (before: number, after: number): Outcome["tone"] => (after > before ? "up" : after < before ? "down" : "flat");

// Changes that change nothing (a +0 modifier, a bill to an empty wallet) aren't worth a line.
function setValue(run: Run, h: Holding, next: number): void {
  const before = h.value;
  h.value = Math.max(0, Math.round(next));
  if (h.value !== before) note(run, h, `Value ${kernels(before)} → ${kernels(h.value)}`, tone(before, h.value));
}

function adjustKernels(run: Run, playerId: string, amount: number, h: Holding | null = null): void {
  const before = run.economy.kernels.get(playerId) ?? 0;
  const after = Math.max(0, Math.round(before + amount));
  run.economy.kernels.set(playerId, after);
  if (after === before) return;
  run.outcomes.push({
    playerName: run.economy.playerName(playerId),
    ref: h?.ref ?? null,
    title: h?.title ?? null,
    text: `Kernels ${kernels(before)} → ${kernels(after)}`,
    tone: tone(before, after),
  });
}

/** Reveals a holding's hidden modifier and applies it. Revealing twice does nothing. */
function triggerModifier(run: Run, h: Holding): void {
  const m = h.modifier;
  if (!m || h.modifierRevealed) return;
  h.modifierRevealed = true;
  const polarity = m.polarity ?? "neutral";
  note(run, h, `Hidden ${polarity} revealed: ${m.name}`, polarity === "buff" ? "up" : polarity === "debuff" ? "down" : "flat", {
    modifier: { name: m.name, polarity, description: m.description },
  });
  // An entity that was already lost keeps its secret no longer, but has nothing left to act on.
  if (h.active) EFFECT_TYPES[m.effect.type]?.apply(run, [h], m.effect);
}

const AMOUNT: ParamSpec = { key: "amount", label: "Kernels (negative takes away)", kind: "integer", min: -100_000, max: 100_000 };
const FACTOR: ParamSpec = { key: "factor", label: "Multiplier (1.5 = +50%, 0.5 = halve)", kind: "number", min: 0, max: 10 };
const CLASSIFICATION: ParamSpec = {
  key: "classification",
  label: "Only entities of this classification (blank = all)",
  kind: "text",
  optional: true,
};

const num = (value: string | number | undefined) => (typeof value === "number" ? value : 0);

/** Every effect a modifier or event can have. Add a type here and it is available to moderators. */
export const EFFECT_TYPES: Readonly<Record<string, EffectType>> = {
  value_add: {
    label: "Change value",
    help: "Adds Kernels to the entity's value (or takes them away, if negative). Values never go below 0.",
    kinds: ["modifier", "event"],
    params: [AMOUNT],
    targetsEntities: true,
    apply(run, targets, e) {
      for (const h of targets) setValue(run, h, h.value + num(e.amount));
    },
  },
  value_multiply: {
    label: "Multiply value",
    help: "Multiplies the entity's value: covers percentage increases, decreases and halving.",
    kinds: ["modifier", "event"],
    params: [FACTOR],
    targetsEntities: true,
    apply(run, targets, e) {
      for (const h of targets) setValue(run, h, h.value * num(e.factor));
    },
  },
  remove_entity: {
    label: "Lose the entity",
    help: "The entity leaves its owner's collection and no longer counts towards net worth.",
    kinds: ["modifier", "event"],
    params: [],
    targetsEntities: true,
    apply(run, targets) {
      for (const h of targets) {
        h.active = false;
        note(run, h, "Lost from the collection", "down");
      }
    },
  },
  duplicate_entity: {
    label: "Duplicate the entity",
    help: "The owner gains a copy worth a share of the entity's current value. Copies carry no modifier.",
    kinds: ["modifier", "event"],
    params: [{ key: "factor", label: "Copy's share of the value (0.5 = half)", kind: "number", min: 0, max: 2 }],
    targetsEntities: true,
    apply(run, targets, e) {
      for (const h of targets) {
        const value = Math.max(0, Math.round(h.value * num(e.factor)));
        const copy: Holding = {
          ...h,
          instanceId: run.economy.newId(),
          bayNumber: null,
          winningBid: 0,
          baseValue: value,
          value,
          modifier: null,
          modifierRevealed: false,
        };
        run.economy.holdings.push(copy);
        note(run, copy, `A copy joins the collection, worth ${kernels(copy.value)}`, "up");
      }
    },
  },
  owner_kernels: {
    label: "Pay the owner",
    help: "The entity's owner gains Kernels (or pays them, if negative). Balances never go below 0.",
    kinds: ["modifier", "event"],
    params: [AMOUNT],
    targetsEntities: true,
    apply(run, targets, e) {
      for (const h of targets) adjustKernels(run, h.ownerId, num(e.amount), h);
    },
  },
  kernels_all: {
    label: "Pay every agent",
    help: "Every agent gains Kernels (or pays them, if negative). Balances never go below 0.",
    kinds: ["event"],
    params: [AMOUNT],
    targetsEntities: false,
    apply(run, _targets, e) {
      for (const playerId of run.economy.kernels.keys()) adjustKernels(run, playerId, num(e.amount));
    },
  },
  trigger_modifiers: {
    label: "Trigger hidden modifiers",
    help: "Reveals matching hidden modifiers and applies them right away.",
    kinds: ["event"],
    params: [
      { key: "polarity", label: "Only this kind (blank = any)", kind: "polarity", optional: true },
      { key: "modifierId", label: "Only this modifier id, e.g. DEBUFF-001 (blank = any)", kind: "text", optional: true },
    ],
    targetsEntities: true,
    apply(run, targets, e) {
      const matching = targets.filter(
        (h) =>
          h.modifier &&
          !h.modifierRevealed &&
          (!e.polarity || h.modifier.polarity === e.polarity) &&
          (!e.modifierId || h.modifier.id === e.modifierId),
      );
      if (!matching.length) note(run, null, "No entity was carrying a matching modifier.", "flat");
      for (const h of matching) triggerModifier(run, h);
    },
  },
};

function typeOf(effect: Effect): EffectType | undefined {
  return Object.hasOwn(EFFECT_TYPES, effect.type) ? EFFECT_TYPES[effect.type] : undefined;
}

function paramsFor(kind: EffectKind, type: EffectType): ParamSpec[] {
  return kind === "event" && type.targetsEntities ? [...type.params, CLASSIFICATION] : [...type.params];
}

/** Runs one Action Round event against the economy and says what happened. */
export function runEvent(economy: Economy, event: EffectDef): Outcome[] {
  const run: Run = { economy, outcomes: [] };
  const type = typeOf(event.effect);
  if (!type) return run.outcomes;
  const only = typeof event.effect.classification === "string" ? event.effect.classification : "";
  const targets = economy.holdings.filter((h) => h.active && (!only || h.classification === only));
  type.apply(run, targets, event.effect);
  if (!run.outcomes.length) note(run, null, "No entity was affected.", "flat");
  return run.outcomes;
}

/** Reveals and applies every hidden modifier still waiting on these holdings, in order. */
export function revealModifiers(economy: Economy, holdings: readonly Holding[] = economy.holdings): Outcome[] {
  const run: Run = { economy, outcomes: [] };
  for (const h of [...holdings]) triggerModifier(run, h);
  return run.outcomes;
}

// ------------------------------------------------------------------ moderation

export type EffectCheck = { ok: true; effect: Effect } | { ok: false; message: string };

/** Turns untrusted moderator input into a valid effect for that kind, or explains what is wrong. */
export function validateEffect(kind: EffectKind, raw: unknown): EffectCheck {
  const fail = (message: string): EffectCheck => ({ ok: false, message });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail("Choose an effect.");
  const input = raw as Record<string, unknown>;
  const typeName = typeof input.type === "string" ? input.type : "";
  const type = typeOf({ type: typeName });
  if (!type || !type.kinds.includes(kind)) return fail(`That effect can't be used on ${kind === "event" ? "an event" : "a modifier"}.`);

  const effect: Effect = { type: typeName };
  for (const p of paramsFor(kind, type)) {
    const value = input[p.key];
    if (value === undefined || value === null || value === "") {
      if (p.optional) continue;
      return fail(`${p.label}: required.`);
    }
    if (p.kind === "integer" || p.kind === "number") {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (!Number.isFinite(n) || n < p.min! || n > p.max! || (p.kind === "integer" && !Number.isInteger(n))) {
        return fail(`${p.label}: ${p.kind === "integer" ? "a whole number" : "a number"} from ${p.min} to ${p.max}.`);
      }
      effect[p.key] = n;
    } else if (p.kind === "polarity") {
      if (!POLARITIES.includes(value as Polarity)) return fail(`${p.label}: buff, debuff or neutral.`);
      effect[p.key] = value as Polarity;
    } else {
      const text = typeof value === "string" ? value.trim().toUpperCase() : "";
      if (!/^[A-Z0-9][A-Z0-9 _-]{0,39}$/.test(text)) return fail(`${p.label}: letters, numbers, spaces or dashes.`);
      effect[p.key] = text;
    }
  }
  return { ok: true, effect };
}

/** What each kind may use, for the moderation console's forms. */
export function effectCatalog() {
  const forKind = (kind: EffectKind) =>
    Object.entries(EFFECT_TYPES)
      .filter(([, t]) => t.kinds.includes(kind))
      .map(([type, t]) => ({ type, label: t.label, help: t.help, params: paramsFor(kind, t) }));
  return { modifier: forKind("modifier"), event: forKind("event") };
}

// ------------------------------------------------------------------ starting library

const modifier = (id: string, name: string, polarity: Polarity, description: string, effect: Effect): EffectDef => ({
  id,
  kind: "modifier",
  name,
  polarity,
  description,
  effect,
  enabled: true,
});

const event = (id: string, name: string, description: string, effect: Effect): EffectDef => ({
  id,
  kind: "event",
  name,
  polarity: null,
  description,
  effect,
  enabled: true,
});

/** Written into the database once (migration 5). After that, moderators own the library. */
export const SEED_EFFECTS: readonly EffectDef[] = [
  modifier("BUFF-001", "Kernel Magnet", "buff", "This entity gains 2,000 Kernels of value.", { type: "value_add", amount: 2000 }),
  modifier("BUFF-002", "Cosmic Resonance", "buff", "This entity's value rises by 50%.", { type: "value_multiply", factor: 1.5 }),
  modifier("BUFF-003", "Mitosis", "buff", "This entity splits. Its owner gains a copy worth half its value.", {
    type: "duplicate_entity",
    factor: 0.5,
  }),
  modifier("BUFF-004", "Finder's Fee", "buff", "The Institution pays whoever contained this entity 1,500 Kernels.", {
    type: "owner_kernels",
    amount: 1500,
  }),
  modifier("DEBUFF-001", "Containment Failure", "debuff", "This entity escapes and is removed from its owner's collection.", {
    type: "remove_entity",
  }),
  modifier("DEBUFF-002", "Structural Rot", "debuff", "This entity's value halves.", { type: "value_multiply", factor: 0.5 }),
  modifier("DEBUFF-003", "Corn Blight", "debuff", "This entity loses 1,500 Kernels of value.", { type: "value_add", amount: -1500 }),
  modifier("DEBUFF-004", "Hazard Surcharge", "debuff", "Its owner is billed 1,000 Kernels in containment upkeep.", {
    type: "owner_kernels",
    amount: -1000,
  }),
  modifier("NEUTRAL-001", "Dormant", "neutral", "Nothing happens. Probably.", { type: "value_add", amount: 0 }),
  event("EVENT-001", "Kernel Market Crash", "Every entity's value drops by 15%.", { type: "value_multiply", factor: 0.85 }),
  event("EVENT-002", "Kernel Surplus", "Every agent receives 1,000 Kernels.", { type: "kernels_all", amount: 1000 }),
  event("EVENT-003", "Containment Incident", 'Every entity carrying "Containment Failure" escapes.', {
    type: "trigger_modifiers",
    modifierId: "DEBUFF-001",
  }),
  event("EVENT-004", "Blessing Audit", "Every hidden buff is revealed and takes effect.", { type: "trigger_modifiers", polarity: "buff" }),
  event("EVENT-005", "Blight Season", "Every hidden debuff is revealed and takes effect.", { type: "trigger_modifiers", polarity: "debuff" }),
  event("EVENT-006", "Cosmic Alignment", "COSMIC-class entities gain 25% value.", {
    type: "value_multiply",
    factor: 1.25,
    classification: "COSMIC",
  }),
  event("EVENT-007", "Earthly Boom", "EARTHLY-class entities gain 30% value.", {
    type: "value_multiply",
    factor: 1.3,
    classification: "EARTHLY",
  }),
  event("EVENT-008", "Local Slump", "LOCAL-class entities lose 20% value.", { type: "value_multiply", factor: 0.8, classification: "LOCAL" }),
  event("EVENT-009", "Collector Frenzy", "Every entity gains 500 Kernels of value.", { type: "value_add", amount: 500 }),
  event("EVENT-010", "Audit Fee", "Every agent pays the Records Division 500 Kernels.", { type: "kernels_all", amount: -500 }),
];
