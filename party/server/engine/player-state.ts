import { type HealthState, StatusTracker, createHealth } from "./status.ts";
import { Inventory } from "./survival.ts";
import { AuthoritativeState } from "./sync.ts";

export interface PlayerRuntimeState {
  playerId: string;
  health: HealthState;
  temperature: number;
  checkpointId: string | null;
  alive: boolean;
}

export function createPlayerRuntimeState(playerId: string, inventoryCapacity = 6): PlayerRuntimeState & { inventory: Inventory<string>; statuses: StatusTracker; sync: AuthoritativeState<PlayerRuntimeState> } {
  const state = { playerId, health: createHealth(), temperature: 8, checkpointId: null, alive: true };
  return { ...state, inventory: new Inventory<string>(inventoryCapacity), statuses: new StatusTracker(), sync: new AuthoritativeState(state) };
}
