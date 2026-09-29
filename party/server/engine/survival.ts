// Reusable player-survival primitives for CPI mission-style games.
//
// These classes are deliberately framework-only: they do not know about Room, Socket.IO, timers,
// rendering, or a particular game. A game owns timing and decides when damage/revive/respawn occur.

export type SurvivalState = "ALIVE" | "DOWNED";

export class DownedPlayer {
  private current: SurvivalState = "ALIVE";

  get state(): SurvivalState {
    return this.current;
  }

  get downed(): boolean {
    return this.current === "DOWNED";
  }

  down(): boolean {
    if (this.current === "DOWNED") return false;
    this.current = "DOWNED";
    return true;
  }

  revive(): boolean {
    if (this.current === "ALIVE") return false;
    this.current = "ALIVE";
    return true;
  }

  reset(): void {
    this.current = "ALIVE";
  }
}

export interface Checkpoint<T> {
  id: string;
  value: T;
}

export class CheckpointTracker<T> {
  private current: Checkpoint<T> | null = null;

  get checkpoint(): Checkpoint<T> | null {
    return this.current;
  }

  activate(checkpoint: Checkpoint<T>): boolean {
    if (this.current?.id === checkpoint.id) return false;
    this.current = checkpoint;
    return true;
  }

  clear(): void {
    this.current = null;
  }
}

export class Inventory<Item extends string> {
  private readonly capacity: number;
  private readonly items: Item[] = [];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("Inventory capacity must be a positive integer.");
    this.capacity = capacity;
  }

  get size(): number {
    return this.items.length;
  }

  get maxSize(): number {
    return this.capacity;
  }

  has(item: Item): boolean {
    return this.items.includes(item);
  }

  list(): Item[] {
    return [...this.items];
  }

  add(item: Item): boolean {
    if (this.items.length >= this.capacity || this.items.includes(item)) return false;
    this.items.push(item);
    return true;
  }

  remove(item: Item): boolean {
    const index = this.items.indexOf(item);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  clear(): void {
    this.items.length = 0;
  }
}
