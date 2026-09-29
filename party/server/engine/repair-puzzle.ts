export type RepairPuzzleType = "SEQUENCE" | "MATCH" | "TIMING" | "COMPONENT";

export interface RepairPuzzle {
  id: string;
  type: RepairPuzzleType;
  steps: string[];
  currentStep: number;
  completed: boolean;
}

export function createRepairPuzzle(id: string, type: RepairPuzzleType, steps: string[]): RepairPuzzle {
  return { id, type, steps: [...steps], currentStep: 0, completed: steps.length === 0 };
}

export function advanceRepairPuzzle(puzzle: RepairPuzzle, step: string): boolean {
  if (puzzle.completed || puzzle.steps[puzzle.currentStep] !== step) return false;
  puzzle.currentStep++;
  puzzle.completed = puzzle.currentStep >= puzzle.steps.length;
  return true;
}

export function resetRepairPuzzle(puzzle: RepairPuzzle): void {
  puzzle.currentStep = 0;
  puzzle.completed = puzzle.steps.length === 0;
}
