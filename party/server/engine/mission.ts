// Shared mission/debrief contracts for CPI Party's exploration and mission games.
//
// This is data-only on purpose. A game owns the actual mission rules; the runtime can persist or
// display these records without knowing what "repair", "temperature", or another game mechanic means.

export type MissionStatus = "ACTIVE" | "STABILIZED" | "FAILED";

export interface MissionCheckpoint {
  id: string;
  name: string;
}

export interface MissionRecord {
  kind: string;
  status: MissionStatus;
  elapsedMs: number;
  checkpointsReached: MissionCheckpoint[];
  systemsCompleted: string[];
  discoveries: string[];
  playerEvents: Record<string, number>;
  notesFound: number;
  secretsFound: number;
}

export function missionStatus(status: MissionStatus): MissionStatus {
  return status;
}
