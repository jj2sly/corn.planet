// Shared validation helpers for game actions.
//
// These helpers validate the shape of an action, not whether a player is allowed to perform it.
// Game-specific rules (distance, temperature, phase, required item, repair state, etc.) remain in
// the game implementation.

export interface ActionPayload {
  readonly action: string;
  readonly payload: unknown;
}

export function actionRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Action payload must be an object.");
  }
  return payload as Record<string, unknown>;
}

export function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${key}.`);
  return value;
}

export function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${key}.`);
  return value;
}

export function finiteNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${key}.`);
  return value;
}

export function booleanValue(payload: Record<string, unknown>, key: string): boolean {
  const value = payload[key];
  if (typeof value !== "boolean") throw new Error(`Invalid ${key}.`);
  return value;
}
