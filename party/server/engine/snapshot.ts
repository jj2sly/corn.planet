export interface ClientSnapshot<T = unknown> {
  version: number;
  timestamp: number;
  state: T;
}

export function makeSnapshot<T>(version: number, state: T, timestamp = Date.now()): ClientSnapshot<T> {
  return { version, timestamp, state: structuredClone(state) };
}

export function isNewerSnapshot(a: ClientSnapshot, b: ClientSnapshot): boolean {
  return a.version > b.version || (a.version === b.version && a.timestamp > b.timestamp);
}
