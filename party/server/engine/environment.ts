export type EnvironmentEffect = "COLD" | "HEAT" | "DARK" | "LOW_OXYGEN" | "INSTABILITY" | "NONE";

export interface EnvironmentZone {
  id: string;
  name: string;
  effects: Set<EnvironmentEffect>;
  intensity: number;
}

export interface ExposureState {
  effect: EnvironmentEffect;
  intensity: number;
  seconds: number;
}

export function createEnvironmentZone(id: string, name: string, effects: EnvironmentEffect[] = [], intensity = 0): EnvironmentZone {
  return { id, name, effects: new Set(effects), intensity: Math.max(0, Math.min(1, intensity)) };
}

export function applyExposure(current: ExposureState | null, effect: EnvironmentEffect, intensity: number, dt: number): ExposureState {
  const nextIntensity = Math.max(0, Math.min(1, intensity));
  const seconds = current?.effect === effect ? current.seconds + Math.max(0, dt) : Math.max(0, dt);
  return { effect, intensity: nextIntensity, seconds };
}

export function clearExposure(current: ExposureState | null): ExposureState | null {
  return current ? { ...current, intensity: 0 } : null;
}

export function hasEffect(zone: EnvironmentZone, effect: EnvironmentEffect): boolean {
  return zone.effects.has(effect);
}
