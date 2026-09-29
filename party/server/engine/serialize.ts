export interface SerializableState {
  [key: string]: unknown;
}

export function serializeState<T extends SerializableState>(state: T): string {
  return JSON.stringify(state);
}

export function deserializeState<T extends SerializableState>(value: string): T {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_STATE");
  return parsed as T;
}
