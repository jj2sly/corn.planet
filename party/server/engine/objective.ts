export type ObjectiveState = "LOCKED" | "ACTIVE" | "COMPLETE" | "FAILED";

export interface Objective {
  id: string;
  name: string;
  description: string;
  state: ObjectiveState;
  dependencies?: string[];
}

export class ObjectiveTracker {
  private readonly objectives = new Map<string, Objective>();

  add(objective: Objective): boolean {
    if (this.objectives.has(objective.id)) return false;
    this.objectives.set(objective.id, structuredClone(objective));
    return true;
  }

  get(id: string): Objective | null { return this.objectives.get(id) ?? null; }

  activate(id: string): boolean {
    const objective = this.objectives.get(id);
    if (!objective || objective.state !== "LOCKED") return false;
    if ((objective.dependencies ?? []).some(dep => this.objectives.get(dep)?.state !== "COMPLETE")) return false;
    objective.state = "ACTIVE";
    return true;
  }

  complete(id: string): boolean {
    const objective = this.objectives.get(id);
    if (!objective || objective.state !== "ACTIVE") return false;
    objective.state = "COMPLETE";
    return true;
  }

  fail(id: string): boolean {
    const objective = this.objectives.get(id);
    if (!objective || objective.state === "COMPLETE") return false;
    objective.state = "FAILED";
    return true;
  }

  list(): Objective[] { return structuredClone([...this.objectives.values()]); }
}
