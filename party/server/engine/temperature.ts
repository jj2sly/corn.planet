export interface TemperatureZone {
  id: string; name: string; temperature: number; target: number; min: number; max: number; rate: number;
}
export interface TemperatureReading { zoneId: string; temperature: number; delta: number; state: "COLD" | "NORMAL" | "WARM" | "EXTREME"; }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function temperatureState(temperature: number): TemperatureReading["state"] {
  if (temperature <= -10) return "EXTREME";
  if (temperature < 3) return "COLD";
  if (temperature <= 8) return "NORMAL";
  if (temperature <= 18) return "WARM";
  return "EXTREME";
}
export function stepTemperature(zone: TemperatureZone, dt: number): TemperatureReading {
  const safeDt = Math.max(0, Math.min(dt, 1));
  const previous = zone.temperature;
  const next = clamp(previous + (zone.target - previous) * zone.rate * safeDt, zone.min, zone.max);
  zone.temperature = next;
  return { zoneId: zone.id, temperature: next, delta: next - previous, state: temperatureState(next) };
}
export function setTemperatureTarget(zone: TemperatureZone, target: number): number {
  zone.target = clamp(target, zone.min, zone.max);
  return zone.target;
}
