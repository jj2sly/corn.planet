export interface PersistedMission<T = unknown> {
  missionId: string;
  checkpointId: string | null;
  elapsed: number;
  state: T;
}

export interface MissionPersistence<T = unknown> {
  save(record: PersistedMission<T>): void;
  load(missionId: string): PersistedMission<T> | null;
  clear(missionId: string): void;
}

export class MemoryMissionPersistence<T = unknown> implements MissionPersistence<T> {
  private readonly records = new Map<string, PersistedMission<T>>();

  save(record: PersistedMission<T>): void {
    this.records.set(record.missionId, structuredClone(record));
  }

  load(missionId: string): PersistedMission<T> | null {
    const record = this.records.get(missionId);
    return record ? structuredClone(record) : null;
  }

  clear(missionId: string): void {
    this.records.delete(missionId);
  }
}
