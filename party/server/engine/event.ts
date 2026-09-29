export interface GameEvent<T = unknown> {
  id: number;
  type: string;
  timestamp: number;
  payload: T;
}

export class EventLog<T = unknown> {
  private nextId = 1;
  private readonly events: GameEvent<T>[] = [];

  emit(type: string, payload: T, timestamp = Date.now()): GameEvent<T> {
    const event = { id: this.nextId++, type, timestamp, payload };
    this.events.push(event);
    return event;
  }

  recent(limit = 50): GameEvent<T>[] {
    return this.events.slice(Math.max(0, this.events.length - Math.max(0, limit)));
  }

  since(id: number): GameEvent<T>[] {
    return this.events.filter(event => event.id > id);
  }

  clear(): void {
    this.events.length = 0;
  }
}
