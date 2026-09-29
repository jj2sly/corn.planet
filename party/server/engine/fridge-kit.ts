import { SceneGraph, SceneNode, SceneTransform, identityTransform } from "./scene.ts";
import { Interactable } from "./interactable.ts";
import { TemperatureZone } from "./temperature.ts";

export interface FridgeModule {
  id: string;
  type: "shelf" | "drawer" | "vent" | "pipe" | "panel" | "door" | "floor" | "wall" | "ceiling" | "light" | "machine";
  zoneId: string;
  transform: SceneTransform;
  properties?: Record<string, unknown>;
}

export interface FridgeRoom {
  id: string;
  name: string;
  zoneId: string;
  modules: FridgeModule[];
}

export function createFridgeRoom(id: string, name: string, zoneId: string): FridgeRoom {
  return { id, name, zoneId, modules: [] };
}

export function addFridgeModule(room: FridgeRoom, module: FridgeModule): void {
  room.modules.push(structuredClone(module));
}

export function buildRoomScene(room: FridgeRoom, scene = new SceneGraph()): SceneGraph {
  for (const module of room.modules) {
    const node: SceneNode = {
      id: module.id,
      kind: module.type === "light" ? "light" : module.type === "floor" || module.type === "wall" || module.type === "ceiling" ? "box" : "mesh",
      transform: module.transform,
      visible: true,
      properties: { zoneId: room.zoneId, ...module.properties },
    };
    scene.add(node);
  }
  return scene;
}

export interface RepairPanelDefinition {
  id: string;
  name: string;
  repairId: string;
  zoneId: string;
  interaction: Interactable;
}

export function makeTransform(x = 0, y = 0, z = 0): SceneTransform {
  return { ...identityTransform(), x, y, z };
}
