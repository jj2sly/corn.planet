import { EntityRegistry, type WorldEntity } from "./entity.ts";

export type FoodBehavior = "IDLE" | "FLEE" | "HUNT" | "AMBUSH" | "TRAP" | "MUTATE";

export interface FoodState {
  behavior: FoodBehavior;
  preferredMin: number;
  preferredMax: number;
  extremeThreshold: number;
  defeated: boolean;
  threat: number;
}

export type FoodEntity = WorldEntity<FoodState> & { kind: "food" };

export function foodTemperatureResponse(food: FoodState, temperature: number): FoodBehavior {
  if (food.defeated) return "IDLE";
  if (temperature < food.preferredMin - food.extremeThreshold || temperature > food.preferredMax + food.extremeThreshold) return "MUTATE";
  if (temperature < food.preferredMin || temperature > food.preferredMax) return "FLEE";
  return food.behavior === "IDLE" ? "HUNT" : food.behavior;
}

export function defeatFood(registry: EntityRegistry<FoodState>, id: string): boolean {
  const food = registry.get(id);
  if (!food || food.kind !== "food") return false;
  registry.patch(id, { defeated: true, behavior: "IDLE", threat: 0 });
  return true;
}
