import type { Vec3 } from "./world.ts";

export interface SpawnPoint {
  id: string;
  position: Vec3;
  yaw?: number;
  pitch?: number;
}

export interface Checkpoint extends SpawnPoint {
  name: string;
  active: boolean;
}

export class SpawnRegistry {
  private readonly spawns = new Map<string, SpawnPoint>();
  add(spawn: SpawnPoint): void { this.spawns.set(spawn.id, spawn); }
  get(id: string): SpawnPoint | null { return this.spawns.get(id) ?? null; }
  list(): SpawnPoint[] { return [...this.spawns.values()]; }
}

export class CheckpointRegistry extends SpawnRegistry {
  private activeId: string | null = null;

  addCheckpoint(checkpoint: Checkpoint): void { this.add(checkpoint); if (checkpoint.active) this.activeId = checkpoint.id; }

  activate(id: string): boolean {
    if (!this.get(id)) return false;
    this.activeId = id;
    return true;
  }

  active(): Checkpoint | null {
    if (!this.activeId) return null;
    const spawn = this.get(this.activeId);
    return spawn ? { ...spawn, name: this.activeId, active: true } : null;
  }

  activeIdValue(): string | null { return this.activeId; }
}
