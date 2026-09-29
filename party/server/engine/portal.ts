export type DoorState = "OPEN" | "CLOSED" | "LOCKED";

export interface Door {
  id: string;
  name: string;
  state: DoorState;
  requires?: string[];
  destination?: string;
}

export interface Portal {
  id: string;
  from: string;
  to: string;
  enabled?: boolean;
  requires?: string[];
}

export interface PortalContext {
  completedSystems?: Set<string>;
  discoveries?: Set<string>;
  flags?: Set<string>;
}

export function canUsePortal(portal: Portal, context: PortalContext = {}): boolean {
  if (portal.enabled === false) return false;
  return (portal.requires ?? []).every(requirement =>
    context.completedSystems?.has(requirement) || context.discoveries?.has(requirement) || context.flags?.has(requirement),
  );
}

export function canOpenDoor(door: Door, context: PortalContext = {}): boolean {
  if (door.state === "OPEN") return true;
  if (door.state === "LOCKED") return (door.requires ?? []).every(requirement =>
    context.completedSystems?.has(requirement) || context.discoveries?.has(requirement) || context.flags?.has(requirement),
  );
  return true;
}

export function toggleDoor(door: Door, context: PortalContext = {}): Door {
  if (!canOpenDoor(door, context)) return door;
  return { ...door, state: door.state === "OPEN" ? "CLOSED" : "OPEN" };
}
