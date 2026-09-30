import { EntityRegistry } from "./entity.ts";
import type { FoodState } from "./food.ts";

export interface FoodSpawnDefinition {
  idPrefix: string;
  name: string;
  zoneId: string;
  count: number;
  state: FoodState;
}

export function spawnFood(registry: EntityRegistry<FoodState>, definition: FoodSpawnDefinition): string[] {
  const ids: string[] = [];
  for (let i = 0; i < Math.max(0, definition.count); i++) {
    const id = definition.count === 1 ? definition.idPrefix : `${definition.idPrefix}-${i + 1}`;
    if (registry.add({ id, kind: "food", name: definition.name, enabled: true, state: structuredClone(definition.state) })) ids.push(id);
  }
  return ids;
}
