export interface WorldZone {
  id: string;
  name: string;
  tags: string[];
  connections: string[];
}

export class ZoneGraph {
  private readonly zones = new Map<string, WorldZone>();

  add(zone: WorldZone): boolean {
    if (this.zones.has(zone.id)) return false;
    this.zones.set(zone.id, structuredClone(zone));
    return true;
  }

  connect(a: string, b: string): boolean {
    const first = this.zones.get(a);
    const second = this.zones.get(b);
    if (!first || !second || a === b) return false;
    if (!first.connections.includes(b)) first.connections.push(b);
    if (!second.connections.includes(a)) second.connections.push(a);
    return true;
  }

  get(id: string): WorldZone | null { return this.zones.get(id) ?? null; }

  neighbors(id: string): WorldZone[] {
    const zone = this.zones.get(id);
    if (!zone) return [];
    return zone.connections.map(connection => this.zones.get(connection)).filter((value): value is WorldZone => Boolean(value));
  }

  list(): WorldZone[] { return structuredClone([...this.zones.values()]); }
}
