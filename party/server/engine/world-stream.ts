import type { Collider, Vec3 } from "./world.ts";

export interface WorldChunk {
  id: string;
  origin: Vec3;
  size: number;
  colliders: Collider[];
  interactableIds: string[];
}

export interface ChunkCoord { x: number; z: number }

export function chunkCoord(position: Vec3, chunkSize: number): ChunkCoord {
  const size = Math.max(1, chunkSize);
  return { x: Math.floor(position.x / size), z: Math.floor(position.z / size) };
}

export function chunkId(coord: ChunkCoord): string {
  return coord.x + ":" + coord.z;
}

export function nearbyChunkCoords(position: Vec3, chunkSize: number, radius = 1): ChunkCoord[] {
  const center = chunkCoord(position, chunkSize);
  const r = Math.max(0, Math.floor(radius));
  const result: ChunkCoord[] = [];
  for (let z = center.z - r; z <= center.z + r; z++) {
    for (let x = center.x - r; x <= center.x + r; x++) result.push({ x, z });
  }
  return result;
}

export class WorldChunkRegistry {
  private readonly chunks = new Map<string, WorldChunk>();

  add(chunk: WorldChunk): void { this.chunks.set(chunk.id, chunk); }
  remove(id: string): boolean { return this.chunks.delete(id); }
  get(id: string): WorldChunk | null { return this.chunks.get(id) ?? null; }
  loaded(): WorldChunk[] { return [...this.chunks.values()]; }

  active(position: Vec3, chunkSize: number, radius = 1): WorldChunk[] {
    const ids = new Set(nearbyChunkCoords(position, chunkSize, radius).map(chunkId));
    return this.loaded().filter(chunk => ids.has(chunk.id));
  }
}
