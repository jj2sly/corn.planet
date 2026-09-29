import { RespawnState, activateCheckpoint } from "./checkpoint-state.ts";
import { CheckpointRegistry } from "./checkpoint.ts";

export interface CheckpointStation { id: string; checkpointId: string; name: string; enabled: boolean; }

export function useCheckpointStation(station: CheckpointStation, registry: CheckpointRegistry, respawn: RespawnState): boolean {
  if (!station.enabled) return false;
  return activateCheckpoint(registry, station.checkpointId, respawn);
}
