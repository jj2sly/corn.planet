import { CheckpointRegistry } from "./checkpoint.ts";

export interface RespawnState {
  checkpointId: string | null;
  deaths: number;
}

export function activateCheckpoint(registry: CheckpointRegistry, checkpointId: string, respawn: RespawnState): boolean {
  const activated = registry.activate(checkpointId);
  if (!activated) return false;
  respawn.checkpointId = checkpointId;
  return true;
}

export function recordDeath(respawn: RespawnState): void {
  respawn.deaths++;
}

export function respawnAtCheckpoint(respawn: RespawnState): string | null {
  return respawn.checkpointId;
}
