import type { EnvironmentZone } from "./environment.ts";
import { type HealthState, StatusTracker, applyDamage } from "./status.ts";

export interface HazardResult {
  damage: number;
  effects: string[];
}

export function processHazard(zone: EnvironmentZone, dt: number, health: HealthState, statuses: StatusTracker): HazardResult {
  const seconds = Math.max(0, dt);
  let damage = 0;
  const effects: string[] = [];
  if (zone.effects.has("COLD") && zone.intensity > 0.7) {
    statuses.apply("COLD", zone.intensity, Math.max(1, seconds + 1));
    damage += zone.intensity * seconds;
    effects.push("COLD");
  }
  if (zone.effects.has("HEAT") && zone.intensity > 0.7) {
    statuses.apply("HEAT", zone.intensity, Math.max(1, seconds + 1));
    damage += zone.intensity * seconds;
    effects.push("HEAT");
  }
  if (zone.effects.has("DARK") && zone.intensity > 0.8) {
    statuses.apply("DISORIENTED", zone.intensity, Math.max(1, seconds + 1));
    effects.push("DARK");
  }
  if (zone.effects.has("LOW_OXYGEN") && zone.intensity > 0.5) {
    damage += zone.intensity * seconds * 0.5;
    effects.push("LOW_OXYGEN");
  }
  applyDamage(health, damage);
  return { damage, effects };
}
