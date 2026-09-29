// Shared deterministic 3D world primitives for CPI first-person games.
// The renderer owns meshes; this module owns simple server-authoritative spatial rules.

export interface Vec3 { x: number; y: number; z: number }
export interface Aabb { min: Vec3; max: Vec3 }
export interface Collider extends Aabb { id: string; solid?: boolean }

const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
const overlap = (aMin: number, aMax: number, bMin: number, bMax: number) => aMin < bMax && aMax > bMin;

export function pointInside(point: Vec3, box: Aabb): boolean {
  return point.x >= box.min.x && point.x <= box.max.x &&
    point.y >= box.min.y && point.y <= box.max.y &&
    point.z >= box.min.z && point.z <= box.max.z;
}

export function overlaps(a: Aabb, b: Aabb): boolean {
  return overlap(a.min.x, a.max.x, b.min.x, b.max.x) &&
    overlap(a.min.y, a.max.y, b.min.y, b.max.y) &&
    overlap(a.min.z, a.max.z, b.min.z, b.max.z);
}

export function makeAabb(center: Vec3, halfExtents: Vec3): Aabb {
  const x = Math.max(0, finite(halfExtents.x));
  const y = Math.max(0, finite(halfExtents.y));
  const z = Math.max(0, finite(halfExtents.z));
  return {
    min: { x: center.x - x, y: center.y - y, z: center.z - z },
    max: { x: center.x + x, y: center.y + y, z: center.z + z },
  };
}

export interface CharacterCollider {
  radius: number;
  height: number;
}

export interface CollisionResult {
  position: Vec3;
  grounded: boolean;
  hitIds: string[];
}

// Resolve a standing capsule approximately as a vertical cylinder against world boxes.
// It intentionally favors stable, readable movement over mesh-accurate collision.
export function resolveCharacterCollision(
  position: Vec3,
  collider: CharacterCollider,
  solids: Collider[],
  previousY = position.y,
): CollisionResult {
  let result = { ...position };
  let grounded = false;
  const hitIds: string[] = [];
  const radius = Math.max(0.05, finite(collider.radius, 0.35));
  const height = Math.max(radius, finite(collider.height, 1.8));

  for (const solid of solids) {
    if (solid.solid === false) continue;
    const expanded: Aabb = {
      min: { x: solid.min.x - radius, y: solid.min.y, z: solid.min.z - radius },
      max: { x: solid.max.x + radius, y: solid.max.y + height, z: solid.max.z + radius },
    };
    const body = makeAabb({ x: result.x, y: result.y + height / 2, z: result.z }, { x: radius, y: height / 2, z: radius });
    if (!overlaps(body, expanded)) continue;

    hitIds.push(solid.id);
    const wasAbove = previousY >= solid.max.y - 0.05;
    if (wasAbove && result.y < solid.max.y) {
      result.y = solid.max.y;
      grounded = true;
      continue;
    }

    const pushX = Math.min(Math.abs(expanded.max.x - result.x), Math.abs(result.x - expanded.min.x));
    const pushZ = Math.min(Math.abs(expanded.max.z - result.z), Math.abs(result.z - expanded.min.z));
    if (pushX < pushZ) {
      result.x = result.x < (expanded.min.x + expanded.max.x) / 2 ? expanded.min.x : expanded.max.x;
    } else {
      result.z = result.z < (expanded.min.z + expanded.max.z) / 2 ? expanded.min.z : expanded.max.z;
    }
  }

  return { position: result, grounded, hitIds };
}

export function rayAabb(origin: Vec3, direction: Vec3, box: Aabb, maxDistance = Infinity): number | null {
  let tMin = 0;
  let tMax = maxDistance;
  for (const axis of ["x", "y", "z"] as const) {
    const o = origin[axis];
    const d = direction[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < box.min[axis] || o > box.max[axis]) return null;
      continue;
    }
    let t1 = (box.min[axis] - o) / d;
    let t2 = (box.max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin <= maxDistance ? tMin : null;
}
