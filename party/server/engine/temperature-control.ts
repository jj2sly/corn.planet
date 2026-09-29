import { setTemperatureTarget, TemperatureZone } from "./temperature.ts";

export interface TemperatureControl {
  id: string;
  zoneId: string;
  enabled: boolean;
  minTarget: number;
  maxTarget: number;
  step: number;
}

export function adjustTemperature(control: TemperatureControl, zone: TemperatureZone, direction: -1 | 1): number | null {
  if (!control.enabled || zone.id !== control.zoneId) return null;
  const target = zone.target + direction * control.step;
  return setTemperatureTarget(zone, Math.max(control.minTarget, Math.min(control.maxTarget, target)));
}
