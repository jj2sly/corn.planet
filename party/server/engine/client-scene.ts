export interface SceneAsset {
  id: string;
  url: string;
  kind: "texture" | "model" | "audio" | "material";
  preload: boolean;
}

export class SceneAssetManifest {
  private readonly assets = new Map<string, SceneAsset>();

  add(asset: SceneAsset): boolean {
    if (this.assets.has(asset.id)) return false;
    this.assets.set(asset.id, { ...asset });
    return true;
  }

  preload(): SceneAsset[] {
    return [...this.assets.values()].filter(asset => asset.preload);
  }

  all(): SceneAsset[] {
    return [...this.assets.values()];
  }
}
