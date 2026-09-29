import type { Vec3 } from "./world.ts";

export interface SpawnPoint { id: string; position: Vec3; yaw?: number; pitch?: number; }
export interface Checkpoint extends SpawnPoint { name: string; active: boolean; }

export class SpawnRegistry {
  protected readonly spawns = new Map<string, SpawnPoint>();
  add(spawn: SpawnPoint): void { this.spawns.set(spawn.id, spawn); }
  get(id: string): SpawnPoint | null { return this.spawns.get(id) ?? null; }
  list(): SpawnPoint[] { return [...this.spawns.values()]; }
}

export class CheckpointRegistry extends SpawnRegistry {
  private readonly checkpoints = new Map<string, Checkpoint>();
  private activeId: string | null = null;
  addCheckpoint(checkpoint: Checkpoint): void {
    this.checkpoints.set(checkpoint.id, { ...checkpoint, active: false });
    this.add(checkpoint);
    if (checkpoint.active || this.activeId === null) this.activeId = checkpoint.id;
  }
  activate(id: string): boolean { if (!this.checkpoints.has(id)) return false; this.activeId = id; return true; }
  active(): Checkpoint | null {
    if (!this.activeId) return null;
    const checkpoint = this.checkpoints.get(this.activeId);
    return checkpoint ? { ...checkpoint, active: true } : null;
  }
  activeIdValue(): string | null { return this.activeId; }
  checkpointsList(): Checkpoint[] { return [...this.checkpoints.values()].map(c => ({ ...c, active: c.id === this.activeId })); }
}