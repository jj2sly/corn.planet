export type AssetKind = "mesh" | "material" | "texture" | "audio" | "animation" | "data";

export interface AssetDefinition {
  id: string;
  kind: AssetKind;
  source: string;
  preload?: boolean;
}

export class AssetRegistry {
  private readonly definitions = new Map<string, AssetDefinition>();

  register(definition: AssetDefinition): AssetDefinition {
    if (!definition.id || !definition.source) throw new Error("Asset definitions require id and source");
    if (this.definitions.has(definition.id)) throw new Error("Duplicate asset: " + definition.id);
    this.definitions.set(definition.id, { ...definition });
    return definition;
  }

  registerMany(definitions: readonly AssetDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  get(id: string): AssetDefinition | null {
    return this.definitions.get(id) ?? null;
  }

  list(kind?: AssetKind): AssetDefinition[] {
    return [...this.definitions.values()].filter(asset => !kind || asset.kind === kind);
  }

  preload(): AssetDefinition[] {
    return this.list().filter(asset => asset.preload);
  }

  clear(): void {
    this.definitions.clear();
  }
}
