export interface PlayerSpawn {
  id: string;
  zoneId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class PlayerSpawnRegistry {
  private readonly spawns = new Map<string, PlayerSpawn[]>();
  private readonly cursors = new Map<string, number>();

  add(spawn: PlayerSpawn): boolean {
    const list = this.spawns.get(spawn.zoneId) ?? [];
    if (list.some(value => value.id === spawn.id)) return false;
    list.push(structuredClone(spawn));
    this.spawns.set(spawn.zoneId, list);
    return true;
  }

  next(zoneId: string): PlayerSpawn | null {
    const list = this.spawns.get(zoneId);
    if (!list?.length) return null;
    const cursor = this.cursors.get(zoneId) ?? 0;
    const spawn = list[cursor % list.length];
    this.cursors.set(zoneId, cursor + 1);
    return structuredClone(spawn);
  }
}
