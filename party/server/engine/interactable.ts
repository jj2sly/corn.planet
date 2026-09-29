import { rayAabb, type Aabb, type Vec3 } from "./world.ts";

export interface Interactable {
  id: string;
  name: string;
  bounds: Aabb;
  enabled?: boolean;
  prompt?: string;
  action?: string;
}

export interface InteractionHit {
  id: string;
  distance: number;
  prompt: string;
  action: string;
}

export function findInteraction(origin: Vec3, direction: Vec3, interactables: Interactable[], maxDistance = 2.5): InteractionHit | null {
  let best: InteractionHit | null = null;
  for (const item of interactables) {
    if (item.enabled === false) continue;
    const distance = rayAabb(origin, direction, item.bounds, maxDistance);
    if (distance === null) continue;
    if (!best || distance < best.distance) {
      best = { id: item.id, distance, prompt: item.prompt ?? ("Interact with " + item.name), action: item.action ?? "INTERACT" };
    }
  }
  return best;
}

export function interactionAction(hit: InteractionHit | null, requestedAction: string): { id: string; action: string } | null {
  if (!hit || requestedAction !== hit.action) return null;
  return { id: hit.id, action: hit.action };
}
