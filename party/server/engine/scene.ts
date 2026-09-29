export interface SceneTransform { x: number; y: number; z: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number; }

export interface SceneNode {
  id: string;
  kind: "group" | "box" | "plane" | "mesh" | "light" | "spawn";
  transform: SceneTransform;
  visible: boolean;
  properties: Record<string, unknown>;
}

export const identityTransform = (): SceneTransform => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 });

export class SceneGraph {
  private readonly nodes = new Map<string, SceneNode>();

  add(node: SceneNode): boolean {
    if (this.nodes.has(node.id)) return false;
    this.nodes.set(node.id, structuredClone(node));
    return true;
  }

  get(id: string): SceneNode | null { return this.nodes.get(id) ?? null; }
  remove(id: string): boolean { return this.nodes.delete(id); }
  list(kind?: SceneNode["kind"]): SceneNode[] {
    const nodes = [...this.nodes.values()];
    return kind ? nodes.filter(node => node.kind === kind) : nodes;
  }
}
