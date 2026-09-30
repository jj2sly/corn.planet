import { EventLog, type GameEvent } from "./event.ts";
import { type InteractionRequest, type InteractionResult, validateInteraction } from "./interaction-flow.ts";

export interface InteractionEventPayload {
  request: InteractionRequest;
  result: InteractionResult;
}

export function processInteraction(log: EventLog<InteractionEventPayload>, request: InteractionRequest, targetExists: boolean, enabled = true): GameEvent<InteractionEventPayload> {
  const result = validateInteraction(request, targetExists, enabled);
  return log.emit(result.accepted ? "interaction.accepted" : "interaction.rejected", { request, result });
}
