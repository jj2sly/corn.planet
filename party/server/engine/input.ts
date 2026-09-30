// Platform-neutral input primitives for CPI games.
//
// A game should reason about logical actions (MOVE, LOOK, INTERACT, USE_TOOL, etc.), not about
// keyboards, touchscreens, mice, or native controllers. Platform adapters translate physical input
// into these actions so the game receives one consistent action shape.

export type InputSource = "keyboard" | "mouse" | "touch" | "gamepad" | "motion" | "native" | "unknown";

export interface GameInput {
  readonly action: string;
  readonly value?: number;
  readonly x?: number;
  readonly y?: number;
  readonly pressed?: boolean;
  readonly source: InputSource;
}

export interface InputBinding {
  readonly action: string;
  readonly source: InputSource;
  readonly code: string;
}

export interface InputMap {
  readonly bindings: readonly InputBinding[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function createInputMap(bindings: readonly InputBinding[] = []): InputMap {
  for (const binding of bindings) {
    if (!binding.action || !binding.code) throw new Error("Input bindings require an action and code.");
  }
  return Object.freeze({ bindings: Object.freeze([...bindings]) });
}

export function resolveInput(map: InputMap, source: InputSource, code: string): string | null {
  return map.bindings.find((binding) => binding.source === source && binding.code === code)?.action ?? null;
}

export function normalizeInput(input: {
  action: string;
  source: InputSource;
  value?: unknown;
  x?: unknown;
  y?: unknown;
  pressed?: unknown;
}): GameInput {
  if (!input.action) throw new Error("Input action is required.");
  if (!input.source) throw new Error("Input source is required.");
  const out: { -readonly [K in keyof GameInput]: GameInput[K] } = { action: input.action, source: input.source };
  if (input.value !== undefined) { if (!finite(input.value)) throw new Error("Input value must be finite."); out.value = input.value; }
  if (input.x !== undefined) { if (!finite(input.x)) throw new Error("Input x must be finite."); out.x = input.x; }
  if (input.y !== undefined) { if (!finite(input.y)) throw new Error("Input y must be finite."); out.y = input.y; }
  if (input.pressed !== undefined) { if (typeof input.pressed !== "boolean") throw new Error("Input pressed must be boolean."); out.pressed = input.pressed; }
  return out;
}