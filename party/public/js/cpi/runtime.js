// CPI Party Runtime — browser-side foundation.
// Game-specific code and renderer adapters sit on top of this layer.

export const RUNTIME_VERSION = "0.1";

export class InputMap {
  #actions = new Map();
  #listeners = new Set();
  bind(action, keys) { this.#actions.set(action, new Set(keys)); return this; }
  isBound(action, key) { return this.#actions.get(action)?.has(key) ?? false; }
  onAction(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  emit(action, value = 1) { for (const listener of this.#listeners) listener({ action, value }); }
}

export class QualityProfile {
  constructor(overrides = {}) {
    this.id = overrides.id ?? "medium";
    this.pixelRatio = overrides.pixelRatio ?? 1;
    this.shadows = overrides.shadows ?? true;
    this.particles = overrides.particles ?? true;
    this.maxDynamicObjects = overrides.maxDynamicObjects ?? 300;
    this.textureScale = overrides.textureScale ?? 1;
  }
}
export const QUALITY_PROFILES = Object.freeze({
  low: new QualityProfile({ id:"low", pixelRatio:.75, shadows:false, particles:false, maxDynamicObjects:120, textureScale:.5 }),
  medium: new QualityProfile({ id:"medium", pixelRatio:1, shadows:true, particles:true, maxDynamicObjects:300, textureScale:1 }),
  high: new QualityProfile({ id:"high", pixelRatio:1.25, shadows:true, particles:true, maxDynamicObjects:700, textureScale:1.5 }),
});

export class SceneRuntime {
  constructor() { this.objects = new Map(); this.activeZone = null; this.loadedZones = new Set(); }
  add(object) { if (!object?.id) throw new Error("Scene objects require an id"); this.objects.set(object.id, object); return object; }
  remove(id) { this.objects.delete(id); }
  setActiveZone(zoneId, nearbyZones = []) {
    this.activeZone = zoneId; this.loadedZones = new Set([zoneId, ...nearbyZones].filter(Boolean));
    for (const object of this.objects.values()) object.visible = !object.zoneId || this.loadedZones.has(object.zoneId);
  }
  visibleObjects() { return [...this.objects.values()].filter(object => object.visible !== false); }
  clear() { this.objects.clear(); this.loadedZones.clear(); this.activeZone = null; }
}

export class CPIRuntime {
  constructor({ canvas = null, quality = QUALITY_PROFILES.medium } = {}) {
    this.canvas = canvas; this.quality = quality; this.input = new InputMap(); this.scene = new SceneRuntime();
    this.running = false; this.lastFrame = 0; this.elapsed = 0; this.frame = 0; this.listeners = new Set();
  }
  configureQuality(profile) {
    this.quality = typeof profile === "string" ? QUALITY_PROFILES[profile] ?? QUALITY_PROFILES.medium : profile;
    this.resize(); return this.quality;
  }
  onFrame(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  start() {
    if (this.running) return; this.running = true; this.lastFrame = performance.now();
    requestAnimationFrame(now => this.#frame(now));
  }
  stop() { this.running = false; }
  resize() {
    if (!this.canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * this.quality.pixelRatio;
    this.canvas.width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    this.canvas.height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
  }
  #frame(now) {
    if (!this.running) return;
    const dt = Math.min(.1, Math.max(0, (now - this.lastFrame) / 1000)); this.lastFrame = now;
    this.elapsed += dt; this.frame++;
    const frame = { dt, elapsed:this.elapsed, frame:this.frame, scene:this.scene, quality:this.quality };
    for (const listener of this.listeners) listener(frame);
    requestAnimationFrame(next => this.#frame(next));
  }
}
export function createCPIRuntime(options) { return new CPIRuntime(options); }
