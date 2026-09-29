import { FoodState } from "./food.ts";

export interface FoodDecision { behavior: FoodState["behavior"]; targetPlayerId: string | null; }

export function chooseFoodBehavior(food: FoodState, playerIds: string[], temperature: number): FoodDecision {
  if (food.defeated) return { behavior: "IDLE", targetPlayerId: null };
  if (temperature < food.preferredMin - food.extremeThreshold || temperature > food.preferredMax + food.extremeThreshold) {
    return { behavior: "MUTATE", targetPlayerId: null };
  }
  if (playerIds.length === 0) return { behavior: "IDLE", targetPlayerId: null };
  if (food.behavior === "FLEE") return { behavior: "FLEE", targetPlayerId: null };
  const target = playerIds[0];
  return { behavior: "HUNT", targetPlayerId: target };
}
