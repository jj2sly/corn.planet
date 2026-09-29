export type EntityKind = "machine" | "door" | "food" | "item" | "environment" | "npc" | "checkpoint" | "other";

export interface WorldEntity<State extends object = Record<string, unknown>> {
  id: string;
  kind: EntityKind;
  name: string;
  state: State;
  enabled: boolean;
}

export type EntityPatch<State extends object> = Partial<State>;

export class EntityRegistry<State extends object = Record<string, unknown>> {
  private readonly entities = new Map<string, WorldEntity<State>>();

  add(entity: WorldEntity<State>): boolean {
    if (this.entities.has(entity.id)) return false;
    this.entities.set(entity.id, structuredClone(entity));
    return true;
  }

  remove(id: string): boolean { return this.entities.delete(id); }
  has(id: string): boolean { return this.entities.has(id); }
  get(id: string): WorldEntity<State> | null { return this.entities.get(id) ?? null; }
  list(kind?: EntityKind): WorldEntity<State>[] {
    const values = [...this.entities.values()];
    return kind ? values.filter(entity => entity.kind === kind) : values;
  }

  patch(id: string, patch: EntityPatch<State>): WorldEntity<State> | null {
    const entity = this.entities.get(id);
    if (!entity) return null;
    entity.state = { ...entity.state, ...patch };
    return entity;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    entity.enabled = enabled;
    return true;
  }

  snapshot(): WorldEntity<State>[] { return structuredClone([...this.entities.values()]); }
}
