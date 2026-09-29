export interface ZoneDefinition {
  id: string;
  preload?: string[];
  unload?: string[];
}

export interface ZoneStreamState {
  active: string | null;
  loaded: string[];
}

export class WorldStreamer {
  private readonly zones = new Map<string, ZoneDefinition>();
  private loaded = new Set<string>();
  private active: string | null = null;

  register(zone: ZoneDefinition): void {
    if (!zone.id) throw new Error("Zones require an id");
    this.zones.set(zone.id, { ...zone, preload: [...(zone.preload ?? [])], unload: [...(zone.unload ?? [])] });
  }

  activate(zoneId: string): ZoneStreamState {
    const zone = this.zones.get(zoneId);
    if (!zone) throw new Error("Unknown zone: " + zoneId);

    const wanted = new Set([zoneId, ...(zone.preload ?? [])]);
    for (const id of zone.unload ?? []) this.loaded.delete(id);
    for (const id of wanted) {
      if (this.zones.has(id)) this.loaded.add(id);
    }
    this.active = zoneId;
    return this.snapshot();
  }

  isLoaded(zoneId: string): boolean {
    return this.loaded.has(zoneId);
  }

  snapshot(): ZoneStreamState {
    return { active: this.active, loaded: [...this.loaded].sort() };
  }

  clear(): void {
    this.loaded.clear();
    this.active = null;
  }
}
