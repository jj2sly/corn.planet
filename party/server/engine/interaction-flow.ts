import { RepairTracker } from "./repair.ts";

export interface InteractionRequest {
  playerId: string;
  targetId: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface InteractionResult {
  accepted: boolean;
  reason?: string;
}

export function validateInteraction(request: InteractionRequest, targetExists: boolean, enabled = true): InteractionResult {
  if (!targetExists) return { accepted: false, reason: "TARGET_NOT_FOUND" };
  if (!enabled) return { accepted: false, reason: "TARGET_DISABLED" };
  if (!request.playerId || !request.targetId || !request.action) return { accepted: false, reason: "INVALID_REQUEST" };
  return { accepted: true };
}

export function startRepair(tracker: RepairTracker, systemId: string): InteractionResult {
  try {
    tracker.start(systemId);
    return { accepted: true };
  } catch {
    return { accepted: false, reason: "REPAIR_NOT_AVAILABLE" };
  }
}

export function completeRepair(tracker: RepairTracker, systemId: string): InteractionResult {
  try {
    tracker.complete(systemId);
    return { accepted: true };
  } catch {
    return { accepted: false, reason: "REPAIR_NOT_IN_PROGRESS" };
  }
}
