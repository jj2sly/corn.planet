export interface RenderQuality {
  id: string;
  pixelRatio: number;
  shadows: boolean;
  particles: boolean;
  maxDynamicObjects: number;
  textureScale: number;
}

export interface RenderObject {
  id: string;
  mesh?: string;
  material?: string;
  zoneId?: string;
  visible?: boolean;
}

export interface RendererAdapter {
  readonly kind: string;
  initialize(options: { canvas?: unknown; quality: RenderQuality }): void;
  resize(width: number, height: number, pixelRatio: number): void;
  beginFrame(timeSeconds: number): void;
  draw(objects: readonly RenderObject[]): void;
  endFrame(): void;
  dispose(): void;
}

export interface AssetHandle<T = unknown> {
  id: string;
  value: T;
  dispose?: () => void;
}

export interface AssetLoader<T = unknown> {
  load(id: string, source: string): Promise<AssetHandle<T>>;
}
