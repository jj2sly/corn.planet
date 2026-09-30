// Types for map.js, so tests (TypeScript) can import the map the browser draws.

export type Rect = [number, number, number, number];

export interface ZoneDef {
  id: string;
  name: string;
  temp: number;
  dark: number;
  floor: string;
  wall: string;
  safe?: boolean;
}
export interface DoorDef { id: string; zone: string; x: number; y: number; w: number; h: number; kind: string }
export interface ObstacleDef { kind: string; x: number; y: number; w: number; h: number }
export interface StationDef { id: string; zone: string; x: number; y: number; r: number; kind: "tap" | "hold" | "panel"; dur?: number; face?: string }
export interface HeaterDef { id: string; x: number; y: number; r: number; temp: number }
export interface CheckpointDef { id: string; zone: string; x: number; y: number }
export interface ThreatDef { id: string; kind: "milk" | "icecream"; leash: string; x: number; y: number }
export interface PickupDef { id: string; kind: "heatpack" | "fieldkit"; x: number; y: number }
export interface HazardDef { id: string; kind: "spark" | "vent"; x: number; y: number; w?: number; h?: number; r?: number; period: number; phase: number }
export interface PortalDef { id: string; door: string; rect: Rect; to: { x: number; y: number; facing: number }; offsetX?: number; kind: "fridge" | "lift" }
export interface LightDef { x: number; y: number; r: number; color: string; power: number; when: string; beacon?: boolean }

export interface ColdCaseMap {
  w: number;
  h: number;
  floor: Uint8Array;
  zone: Uint8Array;
  wall: Uint8Array;
  block: Int16Array;
  door: Int16Array;
  ice: Uint8Array;
  rooms: { id: string; rects: Rect[] }[];
  zones: readonly ZoneDef[];
  doors: readonly DoorDef[];
  obstacles: readonly ObstacleDef[];
  stations: readonly StationDef[];
  heaters: readonly HeaterDef[];
  checkpoints: readonly CheckpointDef[];
  threats: readonly ThreatDef[];
  pickups: readonly PickupDef[];
  hazards: readonly HazardDef[];
  portals: readonly PortalDef[];
  lights: readonly LightDef[];
  start: { x: number; y: number; facing: number };
  core: { x: number; y: number };
  zoneAt(x: number, y: number): number;
  inRect(x: number, y: number, rect: Rect): boolean;
}

export declare const MAP_W: number;
export declare const MAP_H: number;
export declare const ZONES: readonly ZoneDef[];
export declare const ZONE_INDEX: Readonly<Record<string, number>>;
export declare const DOORS: readonly DoorDef[];
export declare const OBSTACLES: readonly ObstacleDef[];
export declare const ICE: readonly Rect[];
export declare const STATIONS: readonly StationDef[];
export declare const HEATERS: readonly HeaterDef[];
export declare const CHECKPOINTS: readonly CheckpointDef[];
export declare const THREATS: readonly ThreatDef[];
export declare const PICKUPS: readonly PickupDef[];
export declare const HAZARDS: readonly HazardDef[];
export declare const PORTALS: readonly PortalDef[];
export declare const LIGHTS: readonly LightDef[];
export declare const START: { x: number; y: number; facing: number };
export declare const CORE_CENTER: { x: number; y: number };
export declare function buildMap(): ColdCaseMap;
