// Reusable repair-system model for CPI mission games.
//
// This tracks progression only. Interactive puzzle mechanics stay in the game so Cold Case can
// make each repair feel different instead of turning every repair into a generic progress bar.

export type RepairState = "LOCKED" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETE";

export interface RepairSystem {
  id: string;
  name: string;
  state: RepairState;
  dependencies?: string[];
}

export class RepairTracker {
  private readonly systems = new Map<string, RepairSystem>();

  constructor(systems: RepairSystem[]) {
    for (const system of systems) {
      if (this.systems.has(system.id)) throw new Error(`Duplicate repair system: ${system.id}`);
      this.systems.set(system.id, { ...system });
    }
    this.refreshAvailability();
  }

  get(id: string): RepairSystem | null {
    const system = this.systems.get(id);
    return system ? { ...system, dependencies: system.dependencies ? [...system.dependencies] : undefined } : null;
  }

  list(): RepairSystem[] {
    return [...this.systems.values()].map((system) => ({
      ...system,
      dependencies: system.dependencies ? [...system.dependencies] : undefined,
    }));
  }

  start(id: string): boolean {
    const system = this.systems.get(id);
    if (!system || system.state !== "AVAILABLE") return false;
    system.state = "IN_PROGRESS";
    return true;
  }

  complete(id: string): boolean {
    const system = this.systems.get(id);
    if (!system || system.state !== "IN_PROGRESS") return false;
    system.state = "COMPLETE";
    this.refreshAvailability();
    return true;
  }

  private refreshAvailability(): void {
    for (const system of this.systems.values()) {
      if (system.state !== "LOCKED") continue;
      const dependencies = system.dependencies ?? [];
      if (dependencies.every((id) => this.systems.get(id)?.state === "COMPLETE")) system.state = "AVAILABLE";
    }
  }

  completed(): string[] {
    return [...this.systems.values()].filter((s) => s.state === "COMPLETE").map((s) => s.id);
  }
}
