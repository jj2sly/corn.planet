import type { GameDefinition } from "./game.ts";

export interface RuntimeGameDescriptor {
  id: string; name: string; description: string;
  minPlayers: number; maxPlayers: number;
  runtime: "party-2d" | "party-3d" | "hybrid";
  capabilities: readonly RuntimeCapability[];
}
export type RuntimeCapability =
  | "keyboard" | "mouse" | "touch" | "controller" | "first-person"
  | "multiplayer" | "streaming" | "physics" | "temperature" | "repair" | "inventory";

export function describeGame(
  definition: GameDefinition,
  runtime: RuntimeGameDescriptor["runtime"] = "party-2d",
  capabilities: readonly RuntimeCapability[] = [],
): RuntimeGameDescriptor {
  return { id: definition.id, name: definition.name, description: definition.description,
    minPlayers: definition.minPlayers, maxPlayers: definition.maxPlayers, runtime, capabilities };
}
