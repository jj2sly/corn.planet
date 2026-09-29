export interface LightPreset { id: string; intensity: number; temperature: number; flicker: number; emergency: boolean; }

export const LIGHT_PRESETS = {
  kitchen: { id: "kitchen", intensity: 1, temperature: 4500, flicker: 0, emergency: false },
  fluorescent: { id: "fluorescent", intensity: 0.8, temperature: 5200, flicker: 0.08, emergency: false },
  freezer: { id: "freezer", intensity: 0.55, temperature: 6500, flicker: 0.03, emergency: false },
  emergency: { id: "emergency", intensity: 0.35, temperature: 3000, flicker: 0.18, emergency: true },
  core: { id: "core", intensity: 0.7, temperature: 7000, flicker: 0.12, emergency: true },
} as const satisfies Record<string, LightPreset>;

export function scaleLight(preset: LightPreset, multiplier: number): LightPreset {
  return { ...preset, intensity: Math.max(0, preset.intensity * multiplier) };
}
